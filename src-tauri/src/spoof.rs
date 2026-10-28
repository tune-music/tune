//! Файлы ручной подмены «Без цензуры»: свои обложки и аудио треков.
//!
//! Страница присылает выбранный файл (команда page_spoof_save), Tune кладёт его в
//! <данные Tune>/spoof под именем из хеша содержимого и отдаёт по адресу
//! https://music.yandex.ru/__tune/spoof/<имя> — с того же адреса, что и интерфейс,
//! поэтому плееру и обложкам Яндекса не мешают ни CORS, ни смешанный контент.
//! Аудио отдаётся по частям (Range), чтобы работала перемотка.

use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::asar::{mime, Served};

pub const PREFIX: &str = "/__tune/spoof/";
const EXTS: &[&str] = &["mp3", "flac", "ogg", "wav", "m4a", "aac", "opus", "jpg", "jpeg", "png", "webp", "gif", "avif"];
/// Больше за раз не отдаём: плеер всё равно дочитывает файл следующими запросами.
const CHUNK: u64 = 4 << 20;

pub fn dir(root: &Path) -> PathBuf {
    root.join("spoof")
}

/// Имя файла из запроса: только то, что сохранил сам Tune.
fn valid(name: &str) -> bool {
    let Some((stem, ext)) = name.rsplit_once('.') else { return false };
    !stem.is_empty() && stem.chars().all(|c| c.is_ascii_hexdigit()) && EXTS.contains(&ext)
}

pub fn save(root: &Path, ext: &str, data: &[u8]) -> Result<String, String> {
    let ext = ext.trim_start_matches('.').to_ascii_lowercase();
    if !EXTS.contains(&ext.as_str()) {
        return Err(format!("Формат .{ext} не поддерживается"));
    }
    let hash = Sha256::digest(data);
    let name = format!("{}.{ext}", hash.iter().take(12).map(|b| format!("{b:02x}")).collect::<String>());
    let dir = dir(root);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(&name);
    if !path.exists() {
        fs::write(&path, data).map_err(|e| e.to_string())?;
    }
    Ok(name)
}

pub fn remove(root: &Path, name: &str) -> Result<(), String> {
    if !valid(name) {
        return Err("Неверное имя файла".into());
    }
    match fs::remove_file(dir(root).join(name)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

/// "bytes=10-" / "bytes=10-20" → (начало, конец включительно).
fn parse_range(range: &str, len: u64) -> Option<(u64, u64)> {
    let spec = range.trim().strip_prefix("bytes=")?.split(',').next()?.trim();
    let (a, b) = spec.split_once('-')?;
    let (start, end) = if a.is_empty() {
        let n: u64 = b.parse().ok()?;
        (len.saturating_sub(n), len.checked_sub(1)?)
    } else {
        let start: u64 = a.parse().ok()?;
        let end = if b.is_empty() { len.checked_sub(1)? } else { b.parse::<u64>().ok()?.min(len.checked_sub(1)?) };
        (start, end)
    };
    (start <= end && end < len).then_some((start, end))
}

/// Ответ на /__tune/spoof/<имя>: тело и, для части файла, заголовок Content-Range.
pub fn serve(root: &Path, name: &str, range: Option<&str>) -> (Served, Option<String>) {
    let not_found = || (Served { status: 404, mime: "text/plain; charset=utf-8", body: Vec::new() }, None);
    if !valid(name) {
        return not_found();
    }
    let Ok(mut file) = fs::File::open(dir(root).join(name)) else { return not_found() };
    let len = file.metadata().map(|m| m.len()).unwrap_or(0);
    let mime = mime(name);
    match range.and_then(|r| parse_range(r, len)) {
        Some((start, end)) => {
            let end = end.min(start + CHUNK - 1);
            let mut body = vec![0; (end - start + 1) as usize];
            if file.seek(SeekFrom::Start(start)).and_then(|_| file.read_exact(&mut body)).is_err() {
                return not_found();
            }
            (Served { status: 206, mime, body }, Some(format!("bytes {start}-{end}/{len}")))
        }
        None => {
            let mut body = Vec::with_capacity(len as usize);
            if file.read_to_end(&mut body).is_err() {
                return not_found();
            }
            (Served { status: 200, mime, body }, None)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_and_ranges() {
        assert!(valid("0a1b2c.mp3"));
        assert!(!valid("../x.mp3"));
        assert!(!valid("abc.exe"));
        assert_eq!(parse_range("bytes=0-", 10), Some((0, 9)));
        assert_eq!(parse_range("bytes=2-4", 10), Some((2, 4)));
        assert_eq!(parse_range("bytes=-3", 10), Some((7, 9)));
        assert_eq!(parse_range("bytes=12-", 10), None);
    }

    #[test]
    fn save_serve_remove() {
        let root = std::env::temp_dir().join(format!("tune-spoof-test-{}", std::process::id()));
        let name = save(&root, "mp3", b"0123456789").unwrap();
        let (full, cr) = serve(&root, &name, None);
        assert_eq!((full.status, full.body.len(), cr), (200, 10, None));
        let (part, cr) = serve(&root, &name, Some("bytes=3-5"));
        assert_eq!((part.status, part.body.as_slice(), cr.as_deref()), (206, &b"345"[..], Some("bytes 3-5/10")));
        remove(&root, &name).unwrap();
        assert_eq!(serve(&root, &name, None).0.status, 404);
        let _ = fs::remove_dir_all(&root);
    }
}
