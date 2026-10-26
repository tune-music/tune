//! Аддоны — темы и скрипты в формате PulseSync и Next Music.
//!
//! Каждый аддон — папка в %APPDATA%\dev.tune.music\addons:
//!   metadata.json        — название, автор, тип ("theme" | "script" | "addon"), файлы css/script
//!   *.css, *.js          — стили и скрипты (без metadata.json берутся все файлы, кроме assets/)
//!   assets/              — картинки, шрифты; страница получает их с http://127.0.0.1:2007/assets/…
//!   handleEvents.json    — схема настроек аддона
//!   experiments.override — флаги интерфейса Яндекса, которые нужны теме (формат Next Music)
//!   tune.settings.json   — значения настроек (Tune)
//!   .tune.json           — откуда установлен (Tune)
//!
//! Так папку из PulseSync или Next Music можно просто скопировать — она заработает как есть.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Theme,
    #[default]
    Script,
}

/// Откуда аддон появился у пользователя.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Origin {
    /// "store" — каталог, "link" — по ссылке, "file" — из файла, "import" — из другого мода, "local" — создан в Tune.
    pub source: String,
    /// Идентификатор в каталоге (store.rs) или исходная ссылка.
    pub store_id: String,
    /// Версия источника на момент установки (sha дерева или коммита) — для обновлений.
    pub sha: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Addon {
    pub id: String,
    pub name: String,
    pub description: String,
    pub author: String,
    pub version: String,
    pub kind: Kind,
    pub image: Option<String>,
    pub banner: Option<String>,
    pub has_css: bool,
    pub has_js: bool,
    pub has_settings: bool,
    pub has_experiments: bool,
    pub enabled: bool,
    pub origin: Origin,
    /// Почему аддон не заработает в Tune (например, требует SDK PulseSync 2).
    pub warning: Option<String>,
}

const SKIP_DIRS: &[&str] = &["assets", "node_modules", ".git", "src"];

fn skip_dir(name: &str) -> bool {
    name.starts_with('.') || SKIP_DIRS.iter().any(|d| d.eq_ignore_ascii_case(name))
}

/// Файлы с расширением `ext` в папке аддона (рекурсивно, без assets и т.п.), по алфавиту.
fn collect(dir: &Path, ext: &str, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let path = e.path();
        let name = e.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            if !skip_dir(&name) {
                collect(&path, ext, out);
            }
        } else if path.extension().is_some_and(|x| x.eq_ignore_ascii_case(ext)) && !name.ends_with(".d.ts") {
            out.push(path);
        }
    }
}

fn find_dir_ci(parent: &Path, name: &str) -> Option<PathBuf> {
    fs::read_dir(parent)
        .ok()?
        .flatten()
        .find(|e| e.path().is_dir() && e.file_name().to_string_lossy().eq_ignore_ascii_case(name))
        .map(|e| e.path())
}

fn find_file_rec(dir: &Path, name: &str, depth: usize) -> Option<PathBuf> {
    let entries: Vec<_> = fs::read_dir(dir).ok()?.flatten().collect();
    for e in &entries {
        if e.path().is_file() && e.file_name().to_string_lossy().eq_ignore_ascii_case(name) {
            return Some(e.path());
        }
    }
    if depth == 0 {
        return None;
    }
    entries
        .iter()
        .filter(|e| e.path().is_dir() && !e.file_name().to_string_lossy().starts_with('.'))
        .find_map(|e| find_file_rec(&e.path(), name, depth - 1))
}

fn read_json(path: &Path) -> Option<Value> {
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()
}

fn str_field(v: &Value, key: &str) -> String {
    match v.get(key) {
        Some(Value::String(s)) => s.trim().to_string(),
        Some(Value::Array(a)) => a.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(", "),
        Some(Value::Number(n)) => n.to_string(),
        _ => String::new(),
    }
}

/// Строки experiments.override: `WebNextNewWaveTab = "default"`.
pub fn parse_experiments(text: &str) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with("//") {
            continue;
        }
        let Some((k, v)) = line.split_once('=') else { continue };
        let k = k.trim();
        let v = v.trim().trim_matches('"');
        if !k.is_empty() && k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') && matches!(v, "on" | "default" | "unset") {
            out.insert(k.to_string(), v.to_string());
        }
    }
    out
}

/// Допустимое имя папки аддона.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 96
        && id != "."
        && id != ".."
        && !id.starts_with('.')
        && !id.chars().any(|c| matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control())
}

/// Имя папки из названия: без запрещённых символов и «!» в начале (у Next Music это «выключен»).
pub fn folder_name(name: &str) -> String {
    let cleaned: String = name
        .trim()
        .trim_start_matches('!')
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() { '-' } else { c })
        .take(64)
        .collect();
    let cleaned = cleaned.trim().trim_matches('.').trim().to_string();
    if cleaned.is_empty() { "Addon".into() } else { cleaned }
}

/// Одно поле настроек из handleEvents.json: (id, текущее, по умолчанию).
fn schema_items(schema: &Value) -> Vec<(String, Value, Value)> {
    let mut out = Vec::new();
    let Some(sections) = schema.get("sections").and_then(|s| s.as_array()) else { return out };
    for item in sections.iter().filter_map(|s| s.get("items")?.as_array()).flatten() {
        let push = |out: &mut Vec<(String, Value, Value)>, it: &Value| {
            let Some(id) = it.get("id").and_then(|x| x.as_str()) else { return };
            let cur = ["value", "input", "text"].iter().find_map(|k| it.get(*k).cloned()).unwrap_or(Value::Null);
            let def = ["defaultValue", "defaultParameter"].iter().find_map(|k| it.get(*k).cloned()).unwrap_or_else(|| cur.clone());
            out.push((id.to_string(), cur, def));
        };
        // У поля "text" бывает несколько строк ввода в "buttons".
        match item.get("buttons").and_then(|b| b.as_array()) {
            Some(buttons) if item.get("type").and_then(|t| t.as_str()) == Some("text") => {
                for b in buttons {
                    push(&mut out, b);
                }
            }
            _ => push(&mut out, item),
        }
    }
    out
}

pub struct Addons {
    dir: PathBuf,
}

/// Прочитанный с диска аддон.
struct Loaded {
    id: String,
    path: PathBuf,
    meta: Value,
}

impl Loaded {
    fn name(&self) -> String {
        let n = str_field(&self.meta, "name");
        if n.is_empty() { self.id.trim_start_matches('!').to_string() } else { n }
    }

    /// Аддоны под SDK PulseSync 2 (web host) сами проверяют его при запуске и без него
    /// падают с «webhost-incompatible»: таких API в Tune нет.
    fn warning(&self) -> Option<String> {
        let needs_web_host = self.files("script", "js").iter().any(|f| {
            fs::read_to_string(f).is_ok_and(|code| code.contains("__PULSESYNC_WEB_HOST__") && code.contains("webhost-incompatible"))
        });
        if !needs_web_host {
            return None;
        }
        let mut text = "Аддон рассчитан на новый PulseSync (SDK web host) и в Tune не запускается.".to_string();
        if self.name().to_lowercase().contains("fckcensor") {
            text.push_str(" Вместо него включите «Без цензуры» в настройках Tune — там те же подмены треков.");
        }
        Some(text)
    }

    fn files(&self, key: &str, ext: &str) -> Vec<PathBuf> {
        // PulseSync берёт ровно файл из metadata.json, Next Music — все файлы папки.
        let named = str_field(&self.meta, key);
        if !named.is_empty() {
            let p = self.path.join(&named);
            if p.is_file() && p.starts_with(&self.path) {
                // Next Music всё равно подхватит остальные: повторяем, но названный файл — первым.
                let mut all = Vec::new();
                collect(&self.path, ext, &mut all);
                all.retain(|x| x != &p);
                all.insert(0, p);
                return all;
            }
        }
        let mut all = Vec::new();
        collect(&self.path, ext, &mut all);
        all
    }

    fn kind(&self) -> Kind {
        match str_field(&self.meta, "type").to_lowercase().as_str() {
            "theme" => Kind::Theme,
            "script" | "addon" | "plugin" => Kind::Script,
            _ if self.files("script", "js").is_empty() => Kind::Theme,
            _ => Kind::Script,
        }
    }

    fn schema_path(&self) -> Option<PathBuf> {
        let direct = self.path.join("handleEvents.json");
        if direct.is_file() {
            return Some(direct);
        }
        find_dir_ci(&self.path, "assets")
            .map(|a| a.join("handleEvents.json"))
            .filter(|p| p.is_file())
            .or_else(|| find_file_rec(&self.path, "handleEvents.json", 2))
    }

    fn schema(&self) -> Option<Value> {
        let v = read_json(&self.schema_path()?)?;
        v.get("sections").and_then(|s| s.as_array()).filter(|s| !s.is_empty())?;
        Some(v)
    }

    fn origin(&self) -> Origin {
        read_json(&self.path.join(".tune.json"))
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default()
    }

    fn image(&self, key: &str, fallbacks: &[&str]) -> Option<String> {
        let named = str_field(&self.meta, key);
        if !named.is_empty() && !named.contains("://") && self.path.join(&named).is_file() {
            return Some(named.replace('\\', "/"));
        }
        for f in fallbacks {
            if self.path.join(f).is_file() {
                return Some(f.to_string());
            }
        }
        None
    }
}

impl Addons {
    pub fn new(root: &Path) -> std::io::Result<Self> {
        let dir = root.join("addons");
        fs::create_dir_all(&dir)?;
        Ok(Self { dir })
    }

    pub fn dir(&self) -> &Path {
        &self.dir
    }

    fn load(&self, id: &str) -> Option<Loaded> {
        if !valid_id(id) {
            return None;
        }
        let path = self.dir.join(id);
        if !path.is_dir() {
            return None;
        }
        let meta = read_json(&path.join("metadata.json")).unwrap_or_else(|| json!({}));
        Some(Loaded { id: id.to_string(), path, meta })
    }

    fn all(&self) -> Vec<Loaded> {
        let Ok(entries) = fs::read_dir(&self.dir) else { return Vec::new() };
        entries
            .flatten()
            .filter(|e| e.path().is_dir())
            .filter_map(|e| self.load(&e.file_name().to_string_lossy()))
            .collect()
    }

    pub fn exists(&self, id: &str) -> bool {
        self.load(id).is_some()
    }

    pub fn path(&self, id: &str) -> Option<PathBuf> {
        self.load(id).map(|l| l.path)
    }

    pub fn list(&self, enabled: &[String]) -> Vec<Addon> {
        let mut out: Vec<Addon> = self
            .all()
            .into_iter()
            .map(|l| {
                let kind = l.kind();
                Addon {
                    name: l.name(),
                    description: str_field(&l.meta, "description"),
                    author: str_field(&l.meta, "author"),
                    version: str_field(&l.meta, "version"),
                    kind,
                    image: l.image("image", &["icon.png", "icon.webp", "icon.jpg", "logo.png", "image.png", "image.webp"])
                        .or_else(|| l.image("icon", &[])),
                    banner: l.image("banner", &["banner.png", "banner.webp", "banner.jpg"]),
                    has_css: !l.files("css", "css").is_empty(),
                    has_js: !l.files("script", "js").is_empty(),
                    has_settings: l.schema().is_some(),
                    has_experiments: l.path.join("experiments.override").is_file(),
                    enabled: enabled.contains(&l.id),
                    origin: l.origin(),
                    warning: l.warning(),
                    id: l.id,
                }
            })
            .collect();
        out.sort_by_key(|a| a.name.to_lowercase());
        out
    }

    /// Имя → папка. Скрипты PulseSync зовут себя по metadata.name, Next Music — по имени папки.
    fn find_by_name(&self, name: &str) -> Option<Loaded> {
        let name = name.trim();
        if let Some(l) = self.load(name) {
            return Some(l);
        }
        let key = name.trim_start_matches('!').to_lowercase();
        self.all().into_iter().find(|l| {
            l.id.trim_start_matches('!').to_lowercase() == key
                || l.name().to_lowercase() == key
                || str_field(&l.meta, "id").to_lowercase() == key
        })
    }

    /// Всё, что нужно странице: стили, скрипты, настройки.
    pub fn page_payload(&self, id: &str) -> Option<Value> {
        let l = self.load(id)?;
        let rel = |p: &Path| p.strip_prefix(&l.path).unwrap_or(p).to_string_lossy().replace('\\', "/");
        let css: Vec<Value> = l
            .files("css", "css")
            .iter()
            .filter_map(|p| Some(json!({ "file": rel(p), "text": fs::read_to_string(p).ok()? })))
            .collect();
        let js: Vec<Value> = l
            .files("script", "js")
            .iter()
            .filter_map(|p| Some(json!({ "file": rel(p), "code": fs::read_to_string(p).ok()? })))
            .collect();
        let mut aliases = vec![l.id.clone(), l.id.trim_start_matches('!').to_string(), l.name()];
        let meta_id = str_field(&l.meta, "id");
        if !meta_id.is_empty() {
            aliases.push(meta_id);
        }
        aliases.dedup();
        Some(json!({
            "id": l.id,
            "name": l.name(),
            "aliases": aliases,
            "theme": l.kind() == Kind::Theme,
            "css": css,
            "js": js,
            "settings": self.settings_values(id).unwrap_or_default(),
        }))
    }

    pub fn experiments(&self, id: &str) -> BTreeMap<String, String> {
        self.load(id)
            .and_then(|l| fs::read_to_string(l.path.join("experiments.override")).ok())
            .map(|t| parse_experiments(&t))
            .unwrap_or_default()
    }

    // --- настройки аддона --------------------------------------------------

    pub fn settings_schema(&self, id: &str) -> Option<Value> {
        self.load(id)?.schema()
    }

    fn stored_values(l: &Loaded) -> Map<String, Value> {
        if let Some(Value::Object(m)) = read_json(&l.path.join("tune.settings.json")) {
            return m;
        }
        // Значения, сохранённые PulseSync, переносим как есть.
        if let Some(Value::Object(m)) = read_json(&l.path.join("pulsesync.settings.json")) {
            return m;
        }
        Map::new()
    }

    /// Значения в формате, который ждут скрипты обоих модов: {id: {value, default}}.
    pub fn settings_values(&self, id: &str) -> Option<Map<String, Value>> {
        let l = self.load(id)?;
        let schema = l.schema()?;
        let stored = Self::stored_values(&l);
        let mut out = Map::new();
        for (key, cur, def) in schema_items(&schema) {
            let value = stored.get(&key).cloned().unwrap_or(cur);
            out.insert(key, json!({ "value": value, "default": def }));
        }
        Some(out)
    }

    pub fn set_setting(&self, id: &str, key: &str, value: Value) -> Result<(), String> {
        let l = self.load(id).ok_or("Аддон не найден")?;
        let mut stored = Self::stored_values(&l);
        stored.insert(key.to_string(), value);
        let text = serde_json::to_string_pretty(&Value::Object(stored)).map_err(|e| e.to_string())?;
        fs::write(l.path.join("tune.settings.json"), text).map_err(|e| e.to_string())
    }

    pub fn reset_settings(&self, id: &str) -> Result<(), String> {
        let l = self.load(id).ok_or("Аддон не найден")?;
        let _ = fs::remove_file(l.path.join("pulsesync.settings.json"));
        let path = l.path.join("tune.settings.json");
        if path.exists() {
            fs::remove_file(path).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    // --- сервер ассетов (http://127.0.0.1:2007) -----------------------------

    /// /assets/<file>?name=<addon> — ищет файл по имени в assets/ аддона, затем во всей папке.
    pub fn asset(&self, name: &str, file: &str) -> Option<PathBuf> {
        let l = self.find_by_name(name)?;
        let base = file.rsplit(['/', '\\']).next()?;
        if base.is_empty() || base == ".." {
            return None;
        }
        // Сначала точный путь внутри папки.
        let direct = l.path.join(file.trim_start_matches('/'));
        if direct.is_file() && direct.canonicalize().ok()?.starts_with(l.path.canonicalize().ok()?) {
            return Some(direct);
        }
        if let Some(assets) = find_dir_ci(&l.path, "assets") {
            if let Some(p) = find_file_rec(&assets, base, 6) {
                return Some(p);
            }
        }
        find_file_rec(&l.path, base, 4)
    }

    /// /assets?name=<addon> — список файлов assets/ (так его ждёт FckCensor).
    pub fn asset_list(&self, name: &str) -> Option<Value> {
        let l = self.find_by_name(name)?;
        let mut files = Map::new();
        if let Some(assets) = find_dir_ci(&l.path, "assets") {
            let mut stack = vec![assets];
            while let Some(d) = stack.pop() {
                for e in fs::read_dir(&d).into_iter().flatten().flatten() {
                    let p = e.path();
                    if p.is_dir() {
                        stack.push(p);
                    } else {
                        let size = e.metadata().map(|m| m.len()).unwrap_or(0);
                        files.insert(e.file_name().to_string_lossy().to_string(), json!({ "size": size }));
                    }
                }
            }
        }
        Some(json!({ "files": files }))
    }

    /// /get_handle?name=<addon> — схема настроек с текущими значениями.
    pub fn handle(&self, name: &str) -> Option<Value> {
        let l = self.find_by_name(name)?;
        let mut schema = l.schema()?;
        let values = self.settings_values(&l.id).unwrap_or_default();
        if let Some(sections) = schema.get_mut("sections").and_then(|s| s.as_array_mut()) {
            for item in sections.iter_mut().filter_map(|s| s.get_mut("items")?.as_array_mut()).flatten() {
                let Some(id) = item.get("id").and_then(|x| x.as_str()).map(String::from) else { continue };
                let Some(v) = values.get(&id).and_then(|v| v.get("value")).cloned() else { continue };
                let key = if item.get("value").is_some() { "value" } else if item.get("input").is_some() { "input" } else { "value" };
                item[key] = v;
            }
        }
        Some(json!({ "data": schema }))
    }

    // --- установка -----------------------------------------------------------

    fn free_id(&self, name: &str) -> String {
        let base = folder_name(name);
        let mut id = base.clone();
        let mut n = 2;
        while self.dir.join(&id).exists() {
            id = format!("{base} ({n})");
            n += 1;
        }
        id
    }

    fn write_origin(path: &Path, origin: &Origin) {
        if let Ok(text) = serde_json::to_string_pretty(origin) {
            let _ = fs::write(path.join(".tune.json"), text);
        }
    }

    /// Копирует готовую папку аддона. Если аддон из того же источника уже стоит — заменяет его.
    pub fn install_dir(&self, src: &Path, name_hint: &str, origin: Origin) -> Result<String, String> {
        let meta = read_json(&src.join("metadata.json")).unwrap_or_else(|| json!({}));
        let mut name = str_field(&meta, "name");
        if name.is_empty() {
            name = name_hint.to_string();
        }
        let existing = (!origin.store_id.is_empty())
            .then(|| self.all().into_iter().find(|l| l.origin().store_id == origin.store_id))
            .flatten();
        let id = match &existing {
            Some(l) => {
                // Обновление: сохраняем настройки пользователя.
                let keep = fs::read(l.path.join("tune.settings.json")).ok();
                fs::remove_dir_all(&l.path).map_err(|e| e.to_string())?;
                copy_dir(src, &l.path).map_err(|e| e.to_string())?;
                if let Some(k) = keep {
                    let _ = fs::write(l.path.join("tune.settings.json"), k);
                }
                l.id.clone()
            }
            None => {
                let id = self.free_id(&name);
                copy_dir(src, &self.dir.join(&id)).map_err(|e| e.to_string())?;
                id
            }
        };
        let path = self.dir.join(&id);
        if !path.join("metadata.json").exists() {
            let kind = if path.read_dir().map(|r| r.flatten().any(|e| e.path().extension().is_some_and(|x| x == "js"))).unwrap_or(false) { "script" } else { "theme" };
            let _ = fs::write(path.join("metadata.json"), serde_json::to_string_pretty(&json!({ "name": name, "type": kind })).unwrap());
        }
        Self::write_origin(&path, &origin);
        Ok(id)
    }

    /// Архив .zip / .pext / .tar.gz или одиночный .css / .js.
    pub fn install_bytes(&self, file_name: &str, data: &[u8], origin: Origin) -> Result<String, String> {
        let lower = file_name.to_lowercase();
        let stem = file_name
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or(file_name)
            .trim_end_matches(".tar.gz")
            .trim_end_matches(".tgz");
        let stem = stem.rsplit_once('.').map(|(s, _)| s).unwrap_or(stem).to_string();
        let tmp = self.dir.join(format!(".tmp-{}", std::process::id()));
        let _ = fs::remove_dir_all(&tmp);
        fs::create_dir_all(&tmp).map_err(|e| e.to_string())?;
        let result = (|| {
            if data.starts_with(b"PK") {
                extract_zip(data, &tmp)?;
            } else if data.starts_with(&[0x1f, 0x8b]) {
                let gz = flate2::read::GzDecoder::new(data);
                safe_untar(gz, &tmp)?;
            } else if lower.ends_with(".css") || lower.ends_with(".js") {
                let text = std::str::from_utf8(data).map_err(|_| "Файл не в UTF-8")?;
                let is_css = lower.ends_with(".css");
                fs::write(tmp.join(if is_css { "style.css" } else { "script.js" }), text).map_err(|e| e.to_string())?;
                let meta = json!({ "name": stem, "type": if is_css { "theme" } else { "script" }, "description": "" });
                fs::write(tmp.join("metadata.json"), serde_json::to_string_pretty(&meta).unwrap()).map_err(|e| e.to_string())?;
            } else {
                return Err("Поддерживаются .zip, .pext, .tar.gz, .css и .js".to_string());
            }
            let root = addon_root(&tmp).ok_or("В архиве нет аддона: не найдено ни metadata.json, ни .css/.js")?;
            let hint = if root == tmp { stem.clone() } else { root.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or(stem.clone()) };
            self.install_dir(&root, &hint, origin)
        })();
        let _ = fs::remove_dir_all(&tmp);
        result
    }

    /// Пустой аддон для своего кода.
    pub fn create(&self, kind: Kind, name: &str) -> Result<String, String> {
        let id = self.free_id(name);
        let path = self.dir.join(&id);
        fs::create_dir_all(path.join("assets")).map_err(|e| e.to_string())?;
        let (file, body, ty) = match kind {
            Kind::Theme => ("style.css", "/* Стили темы. Классы интерфейса удобно искать через DevTools (запуск с --tune-debug). */\n\n", "theme"),
            Kind::Script => ("script.js", "// Скрипт выполняется на странице Яндекс Музыки.\n// Доступны window.pulsesyncApi и window.nextmusicApi — как в PulseSync и Next Music.\n\n", "script"),
        };
        let meta = json!({ "name": name, "type": ty, "author": "", "description": "", "version": "1.0.0", "css": if kind == Kind::Theme { "style.css" } else { "" }, "script": if kind == Kind::Script { "script.js" } else { "" } });
        fs::write(path.join("metadata.json"), serde_json::to_string_pretty(&meta).unwrap()).map_err(|e| e.to_string())?;
        fs::write(path.join(file), body).map_err(|e| e.to_string())?;
        Self::write_origin(&path, &Origin { source: "local".into(), ..Default::default() });
        Ok(id)
    }

    /// Главный файл аддона для встроенного редактора.
    pub fn main_file(&self, id: &str) -> Option<PathBuf> {
        let l = self.load(id)?;
        let mut files = l.files("css", "css");
        if l.kind() == Kind::Script || files.is_empty() {
            let js = l.files("script", "js");
            if !js.is_empty() {
                files = js;
            }
        }
        files.into_iter().next()
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        let l = self.load(id).ok_or("Аддон не найден")?;
        fs::remove_dir_all(l.path).map_err(|e| e.to_string())
    }

    /// Старые одиночные файлы themes/*.css и plugins/*.js из Tune 0.1. Встроенный каталог
    /// больше не поставляется, его файлы удаляются; свои файлы становятся аддонами.
    pub fn migrate_legacy(&self, root: &Path) {
        const OLD_CATALOG: &[&str] = &["amoled", "compact-player", "accent-blue", "playback-speed", "wheel-volume", "track-title", "keyboard-shortcuts"];
        for (dir, ext) in [("themes", "css"), ("plugins", "js")] {
            let path = root.join(dir);
            if !path.is_dir() {
                continue;
            }
            let files: Vec<PathBuf> = fs::read_dir(&path).into_iter().flatten().flatten().map(|e| e.path()).collect();
            for p in files {
                let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
                let ours = p.extension().is_some_and(|x| x == ext) && !OLD_CATALOG.contains(&stem.as_str());
                if ours {
                    if let Ok(data) = fs::read(&p) {
                        let _ = self.install_bytes(&format!("{stem}.{ext}"), &data, Origin { source: "local".into(), ..Default::default() });
                    }
                }
                if let Err(e) = fs::remove_file(&p) {
                    eprintln!("tune: не удалось удалить {}: {e}", p.display());
                }
            }
            if let Err(e) = fs::remove_dir(&path) {
                eprintln!("tune: не удалось удалить {}: {e}", path.display());
            }
        }
    }
}

/// Папка внутри распакованного архива, где лежит сам аддон.
fn addon_root(dir: &Path) -> Option<PathBuf> {
    let mut queue = vec![(dir.to_path_buf(), 0)];
    let mut fallback = None;
    while !queue.is_empty() {
        let (d, depth) = queue.remove(0);
        if d.join("metadata.json").is_file() {
            return Some(d);
        }
        let entries: Vec<_> = fs::read_dir(&d).ok()?.flatten().collect();
        let has_code = entries.iter().any(|e| {
            e.path().is_file() && e.path().extension().is_some_and(|x| x.eq_ignore_ascii_case("css") || x.eq_ignore_ascii_case("js"))
        });
        if has_code && fallback.is_none() {
            fallback = Some(d.clone());
        }
        if depth < 4 {
            for e in entries {
                let name = e.file_name().to_string_lossy().to_string();
                if e.path().is_dir() && !name.starts_with('.') && !name.eq_ignore_ascii_case("node_modules") && !name.eq_ignore_ascii_case("assets") {
                    queue.push((e.path(), depth + 1));
                }
            }
        }
    }
    fallback
}

fn copy_dir(src: &Path, dst: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for e in fs::read_dir(src)?.flatten() {
        let name = e.file_name();
        if name == ".git" || name == "node_modules" {
            continue;
        }
        let from = e.path();
        let to = dst.join(&name);
        if from.is_dir() {
            copy_dir(&from, &to)?;
        } else {
            fs::copy(&from, &to)?;
        }
    }
    Ok(())
}

/// Путь внутри архива без выхода за пределы папки распаковки.
fn safe_join(base: &Path, name: &str) -> Option<PathBuf> {
    let mut out = base.to_path_buf();
    for part in name.split(['/', '\\']) {
        match part {
            "" | "." => {}
            ".." => return None,
            p if p.contains(':') => return None,
            p => out.push(p),
        }
    }
    (out != base).then_some(out)
}

fn extract_zip(data: &[u8], dst: &Path) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(std::io::Cursor::new(data)).map_err(|e| format!("Архив повреждён: {e}"))?;
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|e| e.to_string())?;
        let Some(path) = safe_join(dst, f.name()) else { continue };
        if f.is_dir() {
            fs::create_dir_all(&path).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut buf = Vec::new();
        f.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        fs::write(&path, buf).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn safe_untar(reader: impl Read, dst: &Path) -> Result<(), String> {
    let mut ar = tar::Archive::new(reader);
    for entry in ar.entries().map_err(|e| format!("Архив повреждён: {e}"))? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let name = entry.path().map_err(|e| e.to_string())?.to_string_lossy().to_string();
        let Some(path) = safe_join(dst, &name) else { continue };
        match entry.header().entry_type() {
            tar::EntryType::Directory => fs::create_dir_all(&path).map_err(|e| e.to_string())?,
            tar::EntryType::Regular => {
                if let Some(parent) = path.parent() {
                    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                }
                let mut buf = Vec::new();
                entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
                fs::write(&path, buf).map_err(|e| e.to_string())?;
            }
            _ => {}
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_experiments() {
        let e = parse_experiments("# c\nWebNextNewWaveTab = \"default\"\nBad = \"x\"\nWebNextA=\"on\"");
        assert_eq!(e.get("WebNextNewWaveTab").map(String::as_str), Some("default"));
        assert_eq!(e.get("WebNextA").map(String::as_str), Some("on"));
        assert!(!e.contains_key("Bad"));
    }

    #[test]
    fn rejects_traversal() {
        let base = Path::new("C:/x");
        assert!(safe_join(base, "../evil").is_none());
        assert!(safe_join(base, "a/../../evil").is_none());
        assert!(safe_join(base, "a/b.css").is_some());
    }

    #[test]
    fn folder_names() {
        assert_eq!(folder_name("!Night of Knights"), "Night of Knights");
        assert_eq!(folder_name("a/b:c"), "a-b-c");
        assert!(valid_id("Vocaloid Miku!"));
        assert!(!valid_id(".."));
    }

    #[test]
    fn schema_defaults() {
        let s = json!({"sections":[{"items":[
            {"id":"a","type":"button","value":true,"defaultValue":false},
            {"id":"c","type":"color","input":"#fff","defaultParameter":"#000"}
        ]}]});
        let items = schema_items(&s);
        assert_eq!(items[0], ("a".into(), json!(true), json!(false)));
        assert_eq!(items[1], ("c".into(), json!("#fff"), json!("#000")));
    }
}

#[cfg(test)]
mod migrate_tests {
    use super::*;

    #[test]
    fn removes_old_catalog_files() {
        let root = std::env::temp_dir().join(format!("tune-migrate-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("themes")).unwrap();
        fs::create_dir_all(root.join("plugins")).unwrap();
        fs::write(root.join("themes").join("compact-player.css"), "a{}").unwrap();
        fs::write(root.join("themes").join("mine.css"), "b{}").unwrap();
        fs::write(root.join("plugins").join("track-title.js"), "x").unwrap();
        let addons = Addons::new(&root).unwrap();
        addons.migrate_legacy(&root);
        assert!(!root.join("themes").exists());
        assert!(!root.join("plugins").exists());
        assert!(addons.exists("mine"));
        let _ = fs::remove_dir_all(&root);
    }
}
