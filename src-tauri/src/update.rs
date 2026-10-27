//! Обновление Tune из релизов github.com/tune-music/tune.
//!
//! Установленный Tune скачивает установщик и запускает его в тихом режиме
//! (`/P /R /UPDATE`): установщик Tauri сам закрывает Tune, ставит новую версию
//! и запускает её. Переносная версия подменяет свой exe: работающий файл в Windows
//! можно переименовать, но не перезаписать, поэтому старый уходит в `.old`.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use std::time::{Duration, Instant};

use serde::Serialize;

const LATEST: &str = "https://api.github.com/repos/tune-music/tune/releases/latest";
/// Файлы берём только из релизов самого Tune.
const DOWNLOADS: &str = "https://github.com/tune-music/tune/releases/download/";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Release {
    pub version: String,
    pub notes: String,
    pub url: String,
    pub size: u64,
}

/// "v0.2.10" → [0, 2, 10]; всё после первой не-цифры в части отбрасывается.
fn parse_version(v: &str) -> Vec<u64> {
    v.trim().trim_start_matches(['v', 'V']).split('.').map(|p| p.chars().take_while(char::is_ascii_digit).collect::<String>().parse().unwrap_or(0)).collect()
}

fn newer(latest: &str, current: &str) -> bool {
    let (mut a, mut b) = (parse_version(latest), parse_version(current));
    let n = a.len().max(b.len());
    a.resize(n, 0);
    b.resize(n, 0);
    a > b
}

/// Переносная версия — exe без деинсталлятора рядом.
pub fn portable() -> bool {
    let Ok(exe) = std::env::current_exe() else { return false };
    !exe.with_file_name("uninstall.exe").exists()
}

/// Последний релиз, если он новее запущенного Tune.
pub fn check() -> Result<Option<Release>, String> {
    let rel = crate::repo::get_json(LATEST)?;
    let version = rel["tag_name"].as_str().unwrap_or_default().trim_start_matches(['v', 'V']).to_string();
    if version.is_empty() || !newer(&version, env!("CARGO_PKG_VERSION")) {
        return Ok(None);
    }
    let suffix = if portable() { "-portable.exe" } else { "-setup.exe" };
    let asset = rel["assets"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|a| a["name"].as_str().is_some_and(|n| n.ends_with(suffix)))
        .ok_or("В новом релизе нет файла для этой версии Tune")?;
    let url = asset["browser_download_url"].as_str().unwrap_or_default().to_string();
    if !url.starts_with(DOWNLOADS) {
        return Err("Ссылка на файл обновления ведёт не в релизы Tune".into());
    }
    Ok(Some(Release {
        version,
        notes: rel["body"].as_str().unwrap_or_default().trim().to_string(),
        url,
        size: asset["size"].as_u64().unwrap_or(0),
    }))
}

/// Скачивает файл релиза; `progress(loaded, total)`.
fn fetch(rel: &Release, dest: &Path, progress: &impl Fn(u64, u64)) -> Result<(), String> {
    let agent: ureq::Agent = ureq::Agent::config_builder().timeout_connect(Some(Duration::from_secs(20))).build().into();
    let mut resp = agent
        .get(&rel.url)
        .header("User-Agent", crate::repo::UA)
        .call()
        .map_err(|e| format!("Не удалось скачать обновление: {e}"))?;
    let total = rel.size;
    let part = dest.with_extension("part");
    let result = (|| {
        let mut out = File::create(&part).map_err(|e| e.to_string())?;
        let mut body = resp.body_mut().with_config().limit(512 * 1024 * 1024).reader();
        let mut buf = vec![0u8; 64 * 1024];
        let mut loaded = 0u64;
        let mut last = Instant::now();
        progress(0, total);
        loop {
            let n = body.read(&mut buf).map_err(|e| format!("Загрузка прервалась: {e}"))?;
            if n == 0 {
                break;
            }
            out.write_all(&buf[..n]).map_err(|e| e.to_string())?;
            loaded += n as u64;
            if last.elapsed() >= Duration::from_millis(120) {
                progress(loaded, total);
                last = Instant::now();
            }
        }
        progress(loaded, total.max(loaded));
        out.flush().map_err(|e| e.to_string())?;
        // Размер из релиза — защита от оборванной загрузки.
        if total > 0 && loaded != total {
            return Err("Файл обновления скачался не полностью".to_string());
        }
        Ok(())
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&part);
        return Err(e);
    }
    fs::rename(&part, dest).map_err(|e| e.to_string())
}

/// Скачивает и ставит обновление. После `Ok` Tune должен сразу выйти:
/// для установленной версии новый Tune запустит установщик, для переносной — `restart`.
pub fn install(rel: &Release, progress: impl Fn(u64, u64)) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    if portable() {
        let new = exe.with_extension("new");
        fetch(rel, &new, &progress)?;
        let old = exe.with_extension("old");
        let _ = fs::remove_file(&old);
        fs::rename(&exe, &old).map_err(|e| format!("Не удалось заменить Tune: {e}"))?;
        if let Err(e) = fs::rename(&new, &exe) {
            let _ = fs::rename(&old, &exe);
            return Err(format!("Не удалось заменить Tune: {e}"));
        }
        return Ok(());
    }
    let dir = std::env::temp_dir().join("tune-update");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let setup = dir.join(format!("Tune-Music-{}-setup.exe", rel.version));
    fetch(rel, &setup, &progress)?;
    // /P — без вопросов, только полоса установки; /R — запустить Tune после установки.
    std::process::Command::new(&setup)
        .args(["/P", "/R", "/UPDATE"])
        .spawn()
        .map_err(|e| format!("Не удалось запустить установщик: {e}"))?;
    Ok(())
}

/// Уборка после прошлого обновления: старый exe переносной версии и скачанные установщики.
pub fn cleanup() {
    if let Ok(exe) = std::env::current_exe() {
        let _ = fs::remove_file(exe.with_extension("old"));
    }
    let _ = fs::remove_dir_all(std::env::temp_dir().join("tune-update"));
}

#[cfg(test)]
mod tests {
    use super::newer;

    #[test]
    fn compares_versions() {
        assert!(newer("0.2.0", "0.1.0"));
        assert!(newer("v0.1.10", "0.1.9"));
        assert!(newer("1.0", "0.9.9"));
        assert!(!newer("0.1.0", "0.1.0"));
        assert!(!newer("0.1", "0.1.0"));
        assert!(!newer("0.0.9", "0.1.0"));
    }
}
