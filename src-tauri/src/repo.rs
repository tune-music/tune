//! Каталог аддонов из открытых репозиториев.
//!
//! Источники — репозитории на GitHub:
//!   * сборники с папками тем и аддонов (Next Music Extensions, темы dundut); часть папок —
//!     подключённые репозитории авторов (git submodule);
//!   * отдельные репозитории аддонов PulseSync (магазин PulseSync без входа закрыт).
//! Аддоны оттуда совместимы с Tune (см. addons.rs). Список кешируется на диске на 6 часов:
//! у GitHub API без входа лимит 60 запросов в час, а каталог тратит около двадцати.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Сборники: (репозиторий, префикс id, папка тем, папка аддонов).
const COLLECTIONS: &[(&str, &str, &str, &str)] = &[
    ("Web-Next-Music/Next-Music-Extensions", "nm", "Themes", "Addons"),
    ("tune-music/next-music-themes", "dundut", "themes", "addons"),
];

/// Репозиторий в id записей сборника. Темы dundut переехали в организацию tune-music,
/// а id установленных тем остаются прежними — по ним Tune находит их обновления.
fn id_repo(repo: &str) -> &str {
    if repo == "tune-music/next-music-themes" { "absolute2007/next-music-themes" } else { repo }
}

/// Отдельные репозитории аддонов PulseSync: (репозиторий, название, это тема).
/// Ставятся из готового пакета в выпусках или прямо из репозитория, если там уже лежит аддон.
const SINGLES: &[(&str, &str, bool)] = &[
    ("Hazzz895/FckCensor", "FckCensor", false),
    ("Desai0/ChromaSync", "ChromaSync", true),
    ("Imperiadicks/Colorize-2", "Colorize 2", true),
    ("dieughh/MinimalisticWaveTab", "Minimalistic Wave Tab", false),
    ("PulseSync-LLC/BetterPlayer-addon", "BetterPlayer", false),
];
const CACHE_TTL: u64 = 6 * 3600;
pub const UA: &str = concat!("TuneMusic/", env!("CARGO_PKG_VERSION"), " (+https://github.com/tune-music/tune)");

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Entry {
    /// "nm:Themes/Loves Green Lemon"
    pub id: String,
    pub name: String,
    pub kind: crate::addons::Kind,
    pub description: String,
    pub author: String,
    pub version: String,
    pub image: Option<String>,
    pub banner: Option<String>,
    pub readme: Option<String>,
    pub tags: Vec<String>,
    /// Ссылка на страницу аддона.
    pub homepage: String,
    /// Репозиторий, где лежат файлы, и папка в нём ("" — весь репозиторий).
    pub repo: String,
    pub path: String,
    /// Версия источника: sha папки или коммита.
    pub sha: String,
    /// Файлы папки (для аддонов прямо в основном репозитории).
    pub files: Vec<String>,
}

#[derive(Default, Serialize, Deserialize)]
struct Cache {
    fetched_at: u64,
    entries: Vec<Entry>,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn agent() -> ureq::Agent {
    ureq::Agent::config_builder()
        .timeout_global(Some(Duration::from_secs(30)))
        .build()
        .into()
}

fn get_text(url: &str) -> Result<String, String> {
    let mut resp = agent()
        .get(url)
        .header("User-Agent", UA)
        .header("Accept", "application/vnd.github+json")
        .call()
        .map_err(|e| match e {
            ureq::Error::StatusCode(403) | ureq::Error::StatusCode(429) => "GitHub временно ограничил запросы, попробуйте через час".to_string(),
            e => format!("{url}: {e}"),
        })?;
    resp.body_mut().with_config().limit(16 * 1024 * 1024).read_to_string().map_err(|e| e.to_string())
}

pub fn get_bytes(url: &str) -> Result<Vec<u8>, String> {
    let mut resp = agent()
        .get(url)
        .header("User-Agent", UA)
        .call()
        .map_err(|e| format!("Не удалось скачать {url}: {e}"))?;
    resp.body_mut().with_config().limit(200 * 1024 * 1024).read_to_vec().map_err(|e| e.to_string())
}

pub fn get_json(url: &str) -> Result<Value, String> {
    serde_json::from_str(&get_text(url)?).map_err(|e| e.to_string())
}

fn enc(path: &str) -> String {
    path.split('/')
        .map(|seg| {
            seg.bytes()
                .map(|b| match b {
                    b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
                    _ => format!("%{b:02X}"),
                })
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("/")
}

pub fn raw_url(repo: &str, path: &str) -> String {
    format!("https://raw.githubusercontent.com/{repo}/HEAD/{}", enc(path))
}

/// owner/name из https://github.com/owner/name(.git)(/)
pub fn parse_repo(url: &str) -> Option<String> {
    let rest = url.trim().trim_end_matches('/').strip_prefix("https://github.com/")?;
    let mut parts = rest.split('/');
    let owner = parts.next()?;
    let name = parts.next()?.trim_end_matches(".git");
    (!owner.is_empty() && !name.is_empty()).then(|| format!("{owner}/{name}"))
}

fn parse_gitmodules(text: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut path = None;
    for line in text.lines() {
        let line = line.trim();
        if line.starts_with("[submodule") {
            path = None;
        } else if let Some(v) = line.strip_prefix("path").and_then(|r| r.trim_start().strip_prefix('=')) {
            path = Some(v.trim().to_string());
        } else if let Some(v) = line.strip_prefix("url").and_then(|r| r.trim_start().strip_prefix('=')) {
            if let (Some(p), Some(repo)) = (path.take(), parse_repo(v.trim())) {
                out.push((p, repo));
            }
        }
    }
    out
}

/// [текст](ссылка) → текст, без пометок вроде [!IMPORTANT].
fn strip_markdown(s: &str) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find('[') {
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        let Some(close) = after.find(']') else {
            out.push_str(&rest[i..]);
            return out.trim().to_string();
        };
        let text = &after[..close];
        let mut tail = &after[close + 1..];
        if let Some(link) = tail.strip_prefix('(') {
            tail = link.find(')').map(|j| &link[j + 1..]).unwrap_or(link);
        }
        if !text.starts_with('!') {
            out.push_str(text);
        }
        rest = tail;
    }
    out.push_str(rest);
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Первый абзац README без заголовков и картинок — как описание.
fn readme_summary(md: &str) -> String {
    let mut para = String::new();
    for line in md.lines() {
        let l = line.trim();
        if l.is_empty() {
            if !para.is_empty() {
                break;
            }
            continue;
        }
        if l.starts_with('#') || l.starts_with('!') || l.starts_with('<') || l.starts_with("[!") || l.starts_with('|') || l.starts_with("---") || l.starts_with("```") {
            if !para.is_empty() {
                break;
            }
            continue;
        }
        if !para.is_empty() {
            para.push(' ');
        }
        para.push_str(l.trim_start_matches(['-', '*', '>', ' ']));
    }
    let clean = strip_markdown(&para.replace("**", "").replace('`', ""));
    clean.chars().take(240).collect()
}

fn str_field(v: &Value, key: &str) -> String {
    match v.get(key) {
        Some(Value::String(s)) => s.trim().to_string(),
        Some(Value::Array(a)) => a.iter().filter_map(|x| x.as_str()).collect::<Vec<_>>().join(", "),
        _ => String::new(),
    }
}

fn pick_image(files: &[String], base: &str, named: &str, candidates: &[&str]) -> Option<String> {
    if !named.is_empty() && !named.contains("://") {
        let full = if base.is_empty() { named.to_string() } else { format!("{base}/{named}") };
        if files.contains(&full) {
            return Some(full);
        }
    }
    for c in candidates {
        let found = files.iter().find(|f| {
            let rel = f.strip_prefix(base).unwrap_or(f).trim_start_matches('/');
            let file = rel.rsplit('/').next().unwrap_or(rel).to_lowercase();
            file.starts_with(c) && [".png", ".jpg", ".jpeg", ".webp", ".gif"].iter().any(|x| file.ends_with(x))
        });
        if let Some(f) = found {
            return Some(f.clone());
        }
    }
    None
}

/// Дополняет запись данными из metadata.json, README и картинок.
fn enrich(e: &mut Entry, files: &[String], base: &str) {
    let rel = |name: &str| if base.is_empty() { name.to_string() } else { format!("{base}/{name}") };
    let meta = files
        .iter()
        .find(|f| f.as_str() == rel("metadata.json"))
        .and_then(|f| get_json(&raw_url(&e.repo, f)).ok());
    if let Some(m) = &meta {
        let n = str_field(m, "name");
        if !n.is_empty() {
            e.name = n;
        }
        e.description = str_field(m, "description");
        e.author = str_field(m, "author");
        e.version = str_field(m, "version");
        if let Some(tags) = m.get("tags").and_then(|t| t.as_array()) {
            e.tags = tags.iter().filter_map(|t| t.as_str().map(String::from)).take(6).collect();
        }
        if str_field(m, "type").eq_ignore_ascii_case("theme") {
            e.kind = crate::addons::Kind::Theme;
        }
    }
    let meta = meta.unwrap_or(Value::Null);
    let readme = files.iter().find(|f| f.eq_ignore_ascii_case(&rel("README.md"))).cloned();
    if let Some(r) = &readme {
        e.readme = Some(raw_url(&e.repo, r));
        if e.description.is_empty() {
            if let Ok(md) = get_text(&raw_url(&e.repo, r)) {
                e.description = readme_summary(&md);
            }
        }
    }
    let img = pick_image(files, base, &str_field(&meta, "image"), &["icon", "logo", "image", "preview", "cover"]);
    e.image = img.map(|p| raw_url(&e.repo, &p));
    let banner = pick_image(files, base, &str_field(&meta, "banner"), &["banner"]);
    e.banner = banner.map(|p| raw_url(&e.repo, &p));
}

fn blob_paths(tree: &Value) -> Vec<(String, String, String)> {
    tree.get("tree")
        .and_then(|t| t.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|n| {
                    Some((
                        n.get("path")?.as_str()?.to_string(),
                        n.get("type")?.as_str()?.to_string(),
                        n.get("sha").and_then(|s| s.as_str()).unwrap_or("").to_string(),
                    ))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Записи одного сборника: папки тем и аддонов, включая подключённые репозитории.
fn collection_entries(repo: &str, prefix: &str, themes: &str, addons: &str) -> Result<Vec<Entry>, String> {
    let tree = get_json(&format!("https://api.github.com/repos/{repo}/git/trees/HEAD?recursive=1"))?;
    let nodes = blob_paths(&tree);
    let modules = get_text(&raw_url(repo, ".gitmodules")).map(|t| parse_gitmodules(&t)).unwrap_or_default();

    let mut jobs: Vec<Entry> = Vec::new();
    for (path, ty, sha) in &nodes {
        let mut parts = path.splitn(3, '/');
        let (Some(top), Some(name), None) = (parts.next(), parts.next(), parts.next()) else { continue };
        let kind = if top == themes {
            crate::addons::Kind::Theme
        } else if top == addons {
            crate::addons::Kind::Script
        } else {
            continue;
        };
        // id сборника Next Music без репозитория — так он записан у уже установленных аддонов.
        let id = if prefix == "nm" { format!("nm:{path}") } else { format!("{prefix}:{}/{path}", id_repo(repo)) };
        let mut e = Entry { id, name: name.to_string(), kind, sha: sha.clone(), ..Default::default() };
        match ty.as_str() {
            "tree" => {
                e.repo = repo.into();
                e.path = path.clone();
                e.homepage = format!("https://github.com/{repo}/tree/HEAD/{}", enc(path));
                e.files = nodes
                    .iter()
                    .filter(|(p, t, _)| t == "blob" && p.starts_with(&format!("{path}/")))
                    .map(|(p, _, _)| p.clone())
                    .collect();
            }
            "commit" => {
                let Some((_, repo)) = modules.iter().find(|(p, _)| p == path) else { continue };
                e.repo = repo.clone();
                e.homepage = format!("https://github.com/{repo}");
            }
            _ => continue,
        }
        jobs.push(e);
    }
    Ok(jobs)
}

fn fetch_all() -> Result<Vec<Entry>, String> {
    let mut jobs: Vec<Entry> = Vec::new();
    let mut errors = Vec::new();
    for (repo, prefix, themes, addons) in COLLECTIONS {
        match collection_entries(repo, prefix, themes, addons) {
            Ok(list) => jobs.extend(list),
            Err(e) => errors.push(e),
        }
    }
    for (repo, name, theme) in SINGLES {
        jobs.push(Entry {
            id: format!("gh:{repo}"),
            name: name.to_string(),
            kind: if *theme { crate::addons::Kind::Theme } else { crate::addons::Kind::Script },
            repo: repo.to_string(),
            homepage: format!("https://github.com/{repo}"),
            ..Default::default()
        });
    }
    if jobs.len() == SINGLES.len() {
        return Err(errors.join("; "));
    }

    // Подробности качаем параллельно: raw.githubusercontent.com не тратит лимит API.
    let handles: Vec<_> = jobs
        .into_iter()
        .map(|mut e| {
            thread::spawn(move || {
                if !e.files.is_empty() {
                    let files = e.files.clone();
                    let base = e.path.clone();
                    enrich(&mut e, &files, &base);
                } else if let Ok(t) = get_json(&format!("https://api.github.com/repos/{}/git/trees/HEAD?recursive=1", e.repo)) {
                    if e.sha.is_empty() {
                        e.sha = t.get("sha").and_then(|s| s.as_str()).unwrap_or_default().to_string();
                    }
                    let files: Vec<String> = blob_paths(&t).into_iter().filter(|(_, ty, _)| ty == "blob").map(|(p, _, _)| p).collect();
                    // Аддон может лежать в подпапке репозитория (например, «Colorful III/»).
                    let base = files
                        .iter()
                        .filter(|f| f.ends_with("metadata.json") && !f.contains("node_modules"))
                        .min_by_key(|f| f.matches('/').count())
                        .map(|f| f.trim_end_matches("metadata.json").trim_end_matches('/').to_string())
                        .unwrap_or_default();
                    enrich(&mut e, &files, &base);
                    if e.image.is_none() {
                        let all_img = pick_image(&files, "", "", &["icon", "logo"]);
                        e.image = all_img.map(|p| raw_url(&e.repo, &p));
                    }
                    if e.readme.is_none() && files.iter().any(|f| f == "README.md") {
                        e.readme = Some(raw_url(&e.repo, "README.md"));
                        if e.description.is_empty() {
                            if let Ok(md) = get_text(&raw_url(&e.repo, "README.md")) {
                                e.description = readme_summary(&md);
                            }
                        }
                    }
                }
                e
            })
        })
        .collect();
    let mut entries: Vec<Entry> = handles.into_iter().filter_map(|h| h.join().ok()).collect();
    entries.sort_by_key(|e| e.name.to_lowercase());
    Ok(entries)
}

fn cache_path(root: &Path) -> PathBuf {
    root.join("cache").join("catalog-v2.json")
}

/// Каталог: из кеша, если он свежий, иначе с GitHub. При ошибке сети отдаёт старый кеш.
pub fn entries(root: &Path, force: bool) -> Result<Vec<Entry>, String> {
    let cached: Option<Cache> = fs::read_to_string(cache_path(root)).ok().and_then(|t| serde_json::from_str(&t).ok());
    if let Some(c) = &cached {
        if !force && now().saturating_sub(c.fetched_at) < CACHE_TTL && !c.entries.is_empty() {
            return Ok(c.entries.clone());
        }
    }
    match fetch_all() {
        Ok(entries) => {
            let _ = fs::create_dir_all(root.join("cache"));
            let cache = Cache { fetched_at: now(), entries: entries.clone() };
            let _ = fs::write(cache_path(root), serde_json::to_string(&cache).unwrap_or_default());
            Ok(entries)
        }
        Err(e) => match cached {
            Some(c) if !c.entries.is_empty() => Ok(c.entries),
            _ => Err(e),
        },
    }
}

pub fn find(root: &Path, id: &str) -> Option<Entry> {
    entries(root, false).ok()?.into_iter().find(|e| e.id == id)
}

/// Скачивает файлы аддона во временную папку и возвращает путь к ней.
pub fn download(e: &Entry, tmp: &Path) -> Result<Download, String> {
    let _ = fs::remove_dir_all(tmp);
    fs::create_dir_all(tmp).map_err(|e| e.to_string())?;
    if !e.files.is_empty() {
        for f in &e.files {
            let rel = f.strip_prefix(&format!("{}/", e.path)).unwrap_or(f);
            let dst = tmp.join(rel.replace('/', std::path::MAIN_SEPARATOR_STR));
            if let Some(parent) = dst.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::write(&dst, get_bytes(&raw_url(&e.repo, f))?).map_err(|e| e.to_string())?;
        }
        return Ok(Download::Dir(tmp.to_path_buf()));
    }
    github_package(&e.repo)
}

pub enum Download {
    Dir(PathBuf),
    Archive { name: String, data: Vec<u8> },
}

/// Готовый пакет репозитория: архив из последнего релиза, иначе архив ветки по умолчанию.
pub fn github_package(repo: &str) -> Result<Download, String> {
    if let Ok(rel) = get_json(&format!("https://api.github.com/repos/{repo}/releases/latest")) {
        let assets: Vec<(String, String)> = rel
            .get("assets")
            .and_then(|a| a.as_array())
            .map(|a| {
                a.iter()
                    .filter_map(|x| Some((x.get("name")?.as_str()?.to_string(), x.get("browser_download_url")?.as_str()?.to_string())))
                    .collect()
            })
            .unwrap_or_default();
        let score = |n: &str| {
            let n = n.to_lowercase();
            if n.ends_with("_nm.tar.gz") { 0 } else if n.ends_with(".pext") { 1 } else if n.ends_with(".zip") { 2 } else if n.ends_with(".tar.gz") || n.ends_with(".tgz") { 3 } else { 9 }
        };
        if let Some((name, url)) = assets.iter().filter(|(n, _)| score(n) < 9).min_by_key(|(n, _)| score(n)) {
            return Ok(Download::Archive { name: name.clone(), data: get_bytes(url)? });
        }
    }
    let data = get_bytes(&format!("https://codeload.github.com/{repo}/zip/HEAD"))?;
    Ok(Download::Archive { name: format!("{}.zip", repo.rsplit('/').next().unwrap_or("addon")), data })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gitmodules() {
        let m = parse_gitmodules("[submodule \"Themes/Colorful\"]\n    path = Themes/Colorful\n    url = https://github.com/Diramix/Colorful\n");
        assert_eq!(m, vec![("Themes/Colorful".to_string(), "Diramix/Colorful".to_string())]);
    }

    #[test]
    fn encodes_paths() {
        assert_eq!(enc("Themes/Vocaloid Miku!/a b.png"), "Themes/Vocaloid%20Miku%21/a%20b.png");
    }

    #[test]
    fn summary() {
        assert_eq!(readme_summary("# Title\n![img](x)\n\nHello **world**\nline two\n\nmore"), "Hello world line two");
        assert_eq!(strip_markdown("[!IMPORTANT] Спасибо [Diramix](https://github.com/Diramix) за помощь"), "Спасибо Diramix за помощь");
    }
}
