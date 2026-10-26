//! Чтение архива Electron (app.asar) без распаковки на диск.
//!
//! Формат: 16 байт заголовка (pickle), затем JSON с деревом файлов,
//! затем содержимое файлов подряд. У каждого файла в JSON — offset и size
//! относительно начала области данных.

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::Mutex;

use serde_json::Value;

pub struct Asar {
    file: Mutex<File>,
    base: u64,
    files: HashMap<String, (u64, u64)>,
    dirs: HashSet<String>,
}

impl Asar {
    pub fn open(path: &Path) -> Result<Self, String> {
        let mut file = File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
        let mut head = [0u8; 16];
        file.read_exact(&mut head).map_err(|e| e.to_string())?;
        let header_size = u32::from_le_bytes(head[4..8].try_into().unwrap()) as u64;
        let json_size = u32::from_le_bytes(head[12..16].try_into().unwrap()) as usize;
        let mut json = vec![0u8; json_size];
        file.read_exact(&mut json).map_err(|e| e.to_string())?;
        let header: Value = serde_json::from_slice(&json).map_err(|e| format!("заголовок asar: {e}"))?;

        let mut asar = Self {
            file: Mutex::new(file),
            base: 8 + header_size,
            files: HashMap::new(),
            dirs: HashSet::new(),
        };
        asar.walk(&header, String::new());
        if asar.files.is_empty() {
            return Err("архив пуст".into());
        }
        Ok(asar)
    }

    fn walk(&mut self, node: &Value, prefix: String) {
        let Some(children) = node.get("files").and_then(Value::as_object) else { return };
        for (name, child) in children {
            let path = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
            if child.get("files").is_some() {
                self.dirs.insert(path.clone());
                self.walk(child, path);
            } else if child.get("unpacked").and_then(Value::as_bool) != Some(true) {
                let size = child.get("size").and_then(Value::as_u64).unwrap_or(0);
                let offset = match child.get("offset") {
                    Some(Value::String(s)) => s.parse().unwrap_or(0),
                    Some(v) => v.as_u64().unwrap_or(0),
                    None => continue,
                };
                self.files.insert(path, (offset, size));
            }
        }
    }

    pub fn is_file(&self, path: &str) -> bool {
        self.files.contains_key(path)
    }

    pub fn is_dir(&self, path: &str) -> bool {
        self.dirs.contains(path)
    }

    pub fn read(&self, path: &str) -> Option<Vec<u8>> {
        let &(offset, size) = self.files.get(path)?;
        let mut buf = vec![0u8; size as usize];
        let mut file = self.file.lock().ok()?;
        file.seek(SeekFrom::Start(self.base + offset)).ok()?;
        file.read_exact(&mut buf).ok()?;
        Some(buf)
    }

    #[cfg(test)]
    pub fn read_string(&self, path: &str) -> Option<String> {
        String::from_utf8(self.read(path)?).ok()
    }
}

pub struct Served {
    pub status: u16,
    pub mime: &'static str,
    pub body: Vec<u8>,
}

pub fn mime(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json",
        "txt" => "text/plain; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "ogg" => "audio/ogg",
        "wav" => "audio/wav",
        "avif" => "image/avif",
        "wasm" => "application/wasm",
        "mp3" => "audio/mpeg",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "lottie" => "application/zip",
        _ => "application/octet-stream",
    }
}

pub fn percent_decode(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = s.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

impl Asar {
    /// Сопоставляет путь запроса с файлом сборки так же, как официальный клиент:
    /// `/album` → `app/album.html`, каталог → `index.html`, неизвестная страница →
    /// `not-found.html`, неизвестный ресурс → 404.
    pub fn serve(&self, pathname: &str) -> Served {
        let not_found = || Served { status: 404, mime: "text/plain", body: b"Not found".to_vec() };
        let Some(decoded) = percent_decode(pathname) else { return not_found() };
        if decoded.split('/').any(|seg| seg == ".." || seg.contains('\\')) {
            return not_found();
        }
        let rel = decoded.trim_start_matches('/').trim_end_matches('/');
        let file_path = if rel.is_empty() { "app".to_string() } else { format!("app/{rel}") };
        let ext = Path::new(rel).extension().map(|e| e.to_string_lossy().to_ascii_lowercase());

        let resolved = {
            let candidate = if ext.is_some() { file_path.clone() } else { format!("{file_path}.html") };
            if self.is_file(&candidate) {
                Some(candidate)
            } else if self.is_dir(&candidate) || self.is_dir(&file_path) {
                let dir = if self.is_dir(&candidate) { &candidate } else { &file_path };
                Some(format!("{dir}/index.html")).filter(|p| self.is_file(p))
            } else {
                None
            }
        };

        let path = match resolved {
            Some(p) => p,
            None if ext.is_none() || ext.as_deref() == Some("html") => {
                if rel.is_empty() { "app/index.html".into() } else { "app/not-found.html".into() }
            }
            None => return not_found(),
        };
        match self.read(&path) {
            Some(body) => Served { status: 200, mime: mime(&path), body },
            None => not_found(),
        }
    }
}
