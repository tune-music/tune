//! Скачивание файла текущего трека в «Загрузки».
//!
//! Ссылку и ключ даёт сам плеер Яндекса: ответ get-file-info лежит у текущего трека
//! (entity.mediaSourceData). Файл с transport=encraw зашифрован AES-CTR с нулевым
//! счётчиком — так его расшифровывает и интерфейс Яндекса. Ход загрузки уходит в
//! страницу событием tune:download.

use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use aes::cipher::{KeyIvInit, StreamCipher};
use serde_json::json;

type Ctr128 = ctr::Ctr128BE<aes::Aes128>;
type Ctr256 = ctr::Ctr128BE<aes::Aes256>;

static NEXT_ID: AtomicU64 = AtomicU64::new(1);
/// Файлы, скачанные за этот запуск, — только их страница может показать в проводнике.
static SAVED: Mutex<Vec<(u64, PathBuf)>> = Mutex::new(Vec::new());

pub struct Job {
    pub url: String,
    pub key: Option<String>,
    pub codec: String,
    pub name: String,
}

enum Cipher {
    None,
    Aes128(Ctr128),
    Aes256(Ctr256),
}

impl Cipher {
    fn new(key: Option<&str>) -> Result<Self, String> {
        let Some(hex) = key.filter(|k| !k.is_empty()) else { return Ok(Cipher::None) };
        let bytes = (0..hex.len())
            .step_by(2)
            .map(|i| hex.get(i..i + 2).and_then(|h| u8::from_str_radix(h, 16).ok()))
            .collect::<Option<Vec<u8>>>()
            .ok_or("Неверный ключ файла")?;
        let iv = [0u8; 16];
        match bytes.len() {
            16 => Ok(Cipher::Aes128(Ctr128::new(bytes.as_slice().into(), &iv.into()))),
            32 => Ok(Cipher::Aes256(Ctr256::new(bytes.as_slice().into(), &iv.into()))),
            _ => Err("Неверный ключ файла".into()),
        }
    }

    fn apply(&mut self, buf: &mut [u8]) {
        match self {
            Cipher::None => {}
            Cipher::Aes128(c) => c.apply_keystream(buf),
            Cipher::Aes256(c) => c.apply_keystream(buf),
        }
    }
}

/// Ссылки только на хранилище Яндекса и версии без цензуры FckCensor (GitHub или его
/// зеркало jsDelivr): команду может вызвать и скрипт аддона.
pub fn allowed_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else { return false };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("").split(':').next().unwrap_or("");
    host == "yandex.net"
        || host.ends_with(".yandex.net")
        || host.ends_with(".yandex.ru")
        || ((rest.starts_with("raw.githubusercontent.com/Hazzz895/FckCensorData/") || rest.starts_with("cdn.jsdelivr.net/gh/Hazzz895/FckCensorData@"))
            && !rest.contains(".."))
}

fn extension(codec: &str) -> &'static str {
    match codec {
        "flac" => "flac",
        "mp3" => "mp3",
        "aac" | "he-aac" => "aac",
        // flac-mp4, aac-mp4, he-aac-mp4 — контейнер MP4.
        _ => "m4a",
    }
}

fn safe_name(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if c.is_control() || r#"<>:"/\|?*"#.contains(c) { '_' } else { c })
        .collect();
    let s = s.trim().trim_end_matches(['.', ' ']).to_string();
    let s: String = s.chars().take(150).collect();
    if s.is_empty() { "Трек".into() } else { s }
}

fn free_path(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let mut p = dir.join(format!("{stem}.{ext}"));
    let mut n = 2;
    while p.exists() {
        p = dir.join(format!("{stem} ({n}).{ext}"));
        n += 1;
    }
    p
}

/// Скачивает файл в фоне; `report` получает JSON для события tune:download.
pub fn start(job: Job, dir: PathBuf, report: impl Fn(serde_json::Value) + Send + 'static) -> u64 {
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    std::thread::spawn(move || {
        let name = job.name.clone();
        report(json!({ "id": id, "name": name, "state": "start" }));
        match fetch(&job, &dir, |loaded, total| report(json!({ "id": id, "name": name, "state": "progress", "loaded": loaded, "total": total }))) {
            Ok(path) => {
                SAVED.lock().unwrap().push((id, path.clone()));
                report(json!({ "id": id, "name": name, "state": "done", "file": path.file_name().map(|f| f.to_string_lossy().to_string()) }));
            }
            Err(e) => report(json!({ "id": id, "name": name, "state": "error", "error": e })),
        }
    });
    id
}

fn fetch(job: &Job, dir: &Path, progress: impl Fn(u64, u64)) -> Result<PathBuf, String> {
    let mut cipher = Cipher::new(job.key.as_deref())?;
    let agent: ureq::Agent = ureq::Agent::config_builder()
        .timeout_connect(Some(Duration::from_secs(20)))
        .build()
        .into();
    let mut resp = agent
        .get(&job.url)
        .header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) YandexMusic")
        .header("Origin", crate::intercept::ORIGIN)
        .header("Referer", "https://music.yandex.ru/")
        .call()
        .map_err(|e| format!("Не удалось скачать трек: {e}"))?;
    let total: u64 = resp
        .headers()
        .get("content-length")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse().ok())
        .unwrap_or(0);

    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = free_path(dir, &safe_name(&job.name), extension(&job.codec));
    let part = path.with_extension("part");
    let result = (|| {
        let mut out = File::create(&part).map_err(|e| e.to_string())?;
        let mut body = resp.body_mut().with_config().limit(1024 * 1024 * 1024).reader();
        let mut buf = vec![0u8; 64 * 1024];
        let mut loaded = 0u64;
        let mut last = Instant::now();
        progress(0, total);
        loop {
            let n = body.read(&mut buf).map_err(|e| format!("Загрузка прервалась: {e}"))?;
            if n == 0 {
                break;
            }
            // Поток CTR непрерывный, поэтому кусок любой длины расшифровывается на месте.
            cipher.apply(&mut buf[..n]);
            out.write_all(&buf[..n]).map_err(|e| e.to_string())?;
            loaded += n as u64;
            if last.elapsed() >= Duration::from_millis(120) {
                progress(loaded, total);
                last = Instant::now();
            }
        }
        progress(loaded, total.max(loaded));
        out.flush().map_err(|e| e.to_string())
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&part);
        return Err(e);
    }
    fs::rename(&part, &path).map_err(|e| e.to_string())?;
    Ok(path)
}

/// Путь скачанного за этот запуск файла.
pub fn saved(id: u64) -> Option<PathBuf> {
    SAVED.lock().unwrap().iter().find(|(i, _)| *i == id).map(|(_, p)| p.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_and_urls() {
        assert_eq!(safe_name(" AC/DC — Back: In Black?. "), "AC_DC — Back_ In Black_");
        assert_eq!(extension("flac-mp4"), "m4a");
        assert!(allowed_url("https://s123vla.strm.yandex.net/get-mp3/abc?x=1"));
        assert!(!allowed_url("https://evil.example/yandex.net"));
        assert!(!allowed_url("http://strm.yandex.net/x"));
        assert!(allowed_url("https://raw.githubusercontent.com/Hazzz895/FckCensorData/refs/heads/main/tracks/1"));
        assert!(!allowed_url("https://raw.githubusercontent.com/evil/x"));
        assert!(allowed_url("https://cdn.jsdelivr.net/gh/Hazzz895/FckCensorData@main/tracks/1"));
        assert!(!allowed_url("https://cdn.jsdelivr.net/gh/evil/x@main/tracks/1"));
    }

    #[test]
    fn decrypts_ctr_like_webcrypto() {
        // AES-128-CTR с нулевым счётчиком: шифрование и расшифровка — одно и то же.
        let key = "000102030405060708090a0b0c0d0e0f";
        let mut data = b"hello tune music, this is a test of ctr".to_vec();
        let orig = data.clone();
        let mut a = Cipher::new(Some(key)).unwrap();
        a.apply(&mut data[..7]);
        a.apply(&mut data[7..]);
        assert_ne!(data, orig);
        Cipher::new(Some(key)).unwrap().apply(&mut data);
        assert_eq!(data, orig);
    }
}
