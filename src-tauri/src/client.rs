//! Интерфейс Яндекс Музыки, на котором работает Tune.
//!
//! Tune не распространяет файлы Яндекса. При первом запуске он скачивает
//! закреплённую версию официального установщика с сервера обновлений Яндекса,
//! сверяет SHA-512 и достаёт из него только `resources/app.asar`, в котором
//! лежит интерфейс. Сам официальный клиент не устанавливается.
//!
//! Чтобы перейти на новую версию: поменять VERSION и SHA512 (значение `sha512`
//! из https://desktop.app.music.yandex.net/stable/latest.yml), проверить моды
//! и выпустить релиз Tune.

use std::fs::{self, File};
use std::io::{self, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use base64::Engine;
use serde::Serialize;
use sha2::{Digest, Sha512};

pub const VERSION: &str = "5.120.0";
pub const BRANCH: &str = "r21186494";
const SHA512: &str = "9Z43BtBjUo1nnFwbgXmK1rMPa6aVZn1uF9S6qERifQFUZs7UuBd8ove+gZiYmgfp/tjDVV6YkPehHGB2XvDnGA==";
const BASE_URL: &str = "https://desktop.app.music.yandex.net/stable/";
const ASAR_ENTRY: &str = "resources/app.asar";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    /// download | verify | extract | done
    pub stage: &'static str,
    pub done: u64,
    pub total: u64,
}

fn installer_name() -> String {
    format!("Yandex_Music_x64_{VERSION}.exe")
}

fn client_dir(root: &Path) -> PathBuf {
    root.join("client")
}

pub fn asar_path(root: &Path) -> PathBuf {
    client_dir(root).join(VERSION).join("app.asar")
}

pub fn is_installed(root: &Path) -> bool {
    asar_path(root).is_file()
}

/// Скачивает, проверяет и распаковывает закреплённую версию.
pub fn install(root: &Path, progress: &dyn Fn(Progress)) -> Result<PathBuf, String> {
    let dir = client_dir(root);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let installer = dir.join(format!("{}.part", installer_name()));

    // Если файл уже скачан целиком (например, после сбоя на распаковке) — не качаем заново.
    if sha512_file(&installer, &|_, _| {}).ok().as_deref() != Some(SHA512) {
        download(&format!("{BASE_URL}{}", installer_name()), &installer, progress)?;
        let hash = sha512_file(&installer, &|done, total| {
            progress(Progress { stage: "verify", done, total })
        })?;
        if hash != SHA512 {
            let _ = fs::remove_file(&installer);
            return Err("Скачанный файл не совпадает с ожидаемым (SHA-512). Попробуйте ещё раз.".into());
        }
    }

    let target = asar_path(root);
    fs::create_dir_all(target.parent().unwrap()).map_err(|e| e.to_string())?;
    let tmp = target.with_extension("asar.part");
    extract_asar(&installer, &tmp, progress)?;
    crate::asar::Asar::open(&tmp).map_err(|e| format!("Распакованный архив повреждён: {e}"))?;
    fs::rename(&tmp, &target).map_err(|e| e.to_string())?;
    let _ = fs::remove_file(&installer);

    // Старые версии больше не нужны.
    if let Ok(entries) = fs::read_dir(&dir) {
        for e in entries.flatten() {
            if e.path().is_dir() && e.file_name() != VERSION {
                let _ = fs::remove_dir_all(e.path());
            }
        }
    }
    progress(Progress { stage: "done", done: 1, total: 1 });
    Ok(target)
}

fn download(url: &str, path: &Path, progress: &dyn Fn(Progress)) -> Result<(), String> {
    let mut last_err = String::new();
    for _attempt in 0..5 {
        let have = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        let mut req = ureq::get(url).header("User-Agent", "TuneMusic");
        if have > 0 {
            req = req.header("Range", format!("bytes={have}-"));
        }
        let resp = match req.call() {
            Ok(r) => r,
            Err(e) => {
                last_err = e.to_string();
                continue;
            }
        };
        let resumed = resp.status() == 206;
        let len: u64 = resp
            .headers()
            .get("Content-Length")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        let (mut done, total) = if resumed { (have, have + len) } else { (0, len) };
        let mut file = if resumed {
            fs::OpenOptions::new().append(true).open(path)
        } else {
            File::create(path)
        }
        .map_err(|e| e.to_string())?;

        let mut body = resp.into_body();
        let mut reader = body.as_reader();
        let mut buf = vec![0u8; 256 * 1024];
        let mut last_report = 0u64;
        let result: io::Result<()> = (|| loop {
            let n = reader.read(&mut buf)?;
            if n == 0 {
                return Ok(());
            }
            file.write_all(&buf[..n])?;
            done += n as u64;
            if done - last_report >= 512 * 1024 || done == total {
                last_report = done;
                progress(Progress { stage: "download", done, total });
            }
        })();
        match result {
            Ok(()) if total == 0 || done >= total => return Ok(()),
            Ok(()) => last_err = "соединение оборвалось".into(),
            Err(e) => last_err = e.to_string(),
        }
    }
    Err(format!("Не удалось скачать клиент Яндекс Музыки: {last_err}"))
}

fn sha512_file(path: &Path, progress: &dyn Fn(u64, u64)) -> Result<String, String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let total = file.metadata().map(|m| m.len()).unwrap_or(0);
    let mut hasher = Sha512::new();
    let mut buf = vec![0u8; 1024 * 1024];
    let mut done = 0u64;
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        done += n as u64;
        progress(done, total);
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(hasher.finalize()))
}

/// Окно файла: даёт читать кусок большого файла как отдельный файл.
struct Window {
    inner: BufReader<File>,
    start: u64,
    len: u64,
    pos: u64,
}

impl Read for Window {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let left = self.len.saturating_sub(self.pos) as usize;
        if left == 0 {
            return Ok(0);
        }
        let cap = buf.len().min(left);
        let n = self.inner.read(&mut buf[..cap])?;
        self.pos += n as u64;
        Ok(n)
    }
}

impl Seek for Window {
    fn seek(&mut self, to: SeekFrom) -> io::Result<u64> {
        let pos = match to {
            SeekFrom::Start(p) => p as i64,
            SeekFrom::Current(d) => self.pos as i64 + d,
            SeekFrom::End(d) => self.len as i64 + d,
        };
        if pos < 0 {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "seek before start"));
        }
        self.pos = pos as u64;
        self.inner.seek(SeekFrom::Start(self.start + self.pos))?;
        Ok(self.pos)
    }
}

/// Установщик electron-builder — это NSIS-заглушка, внутри которой без сжатия
/// лежит 7z-архив с приложением. Находим его по сигнатуре и достаём app.asar.
fn extract_asar(installer: &Path, out: &Path, progress: &dyn Fn(Progress)) -> Result<(), String> {
    const SIG: [u8; 6] = [b'7', b'z', 0xBC, 0xAF, 0x27, 0x1C];
    let mut file = File::open(installer).map_err(|e| e.to_string())?;
    let size = file.metadata().map_err(|e| e.to_string())?.len();

    // Сигнатура может встретиться случайно, поэтому проверяем, что
    // следующий заголовок 7z укладывается в файл.
    let mut start = None;
    let mut buf = vec![0u8; 4 * 1024 * 1024];
    let mut offset = 0u64;
    'scan: while offset < size {
        file.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n < 32 {
            break;
        }
        for i in 0..n - 32 {
            if buf[i..i + 6] == SIG {
                let next_off = u64::from_le_bytes(buf[i + 12..i + 20].try_into().unwrap());
                let next_len = u64::from_le_bytes(buf[i + 20..i + 28].try_into().unwrap());
                let pos = offset + i as u64;
                if pos + 32 + next_off + next_len <= size && next_len > 0 {
                    start = Some(pos);
                    break 'scan;
                }
            }
        }
        offset += (n - 32) as u64;
    }
    let start = start.ok_or("В установщике не найден архив приложения")?;

    let window = Window {
        inner: BufReader::new(file),
        start,
        len: size - start,
        pos: 0,
    };
    let mut reader = sevenz_rust2::ArchiveReader::new(window, sevenz_rust2::Password::empty())
        .map_err(|e| format!("Архив приложения не читается: {e}"))?;

    let mut found = false;
    let mut error = None;
    reader
        .for_each_entries(|entry, data| {
            let name = entry.name().replace('\\', "/");
            if name != ASAR_ENTRY {
                // В solid-архиве данные идут потоком, пропускать их всё равно нужно чтением.
                io::copy(data, &mut io::sink())?;
                return Ok(true);
            }
            let total = entry.size();
            let mut dst = match File::create(out) {
                Ok(f) => f,
                Err(e) => {
                    error = Some(e.to_string());
                    return Ok(false);
                }
            };
            let mut buf = vec![0u8; 1024 * 1024];
            let mut done = 0u64;
            loop {
                let n = data.read(&mut buf)?;
                if n == 0 {
                    break;
                }
                dst.write_all(&buf[..n])?;
                done += n as u64;
                progress(Progress { stage: "extract", done, total });
            }
            found = true;
            Ok(false)
        })
        .map_err(|e| format!("Ошибка распаковки: {e}"))?;

    if let Some(e) = error {
        return Err(e);
    }
    if !found {
        return Err(format!("В архиве нет {ASAR_ENTRY}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// TUNE_TEST_INSTALLER=<путь к Yandex_Music_x64_*.exe> cargo test extract -- --ignored
    #[test]
    #[ignore]
    fn extract_from_local_installer() {
        let installer = PathBuf::from(std::env::var("TUNE_TEST_INSTALLER").unwrap());
        let out = std::env::temp_dir().join("tune-test-app.asar");
        extract_asar(&installer, &out, &|_| {}).unwrap();
        let asar = crate::asar::Asar::open(&out).unwrap();
        assert!(asar.is_file("app/index.html"));
        assert!(asar.read_string("package.json").unwrap().contains("YandexMusic"));
        let page = asar.serve("/album");
        assert_eq!(page.status, 200);
        assert_eq!(asar.serve("/").mime, "text/html; charset=utf-8");
        assert_eq!(asar.serve("/nope.js").status, 404);
    }
}
