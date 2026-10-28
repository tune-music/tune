//! Текст песен из NetEase Cloud Music — второй источник после LRCLIB.
//!
//! Синхронных текстов там много, в том числе у русских исполнителей, но поиск отдаёт и
//! чужие треки: берём только совпадение по названию, исполнителю и длительности. Запросы
//! идут отсюда, а не со страницы: NetEase не отвечает заголовками CORS.

use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Found {
    pub synced_lyrics: String,
}

fn get(url: &str) -> Result<Value, String> {
    let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(10))).build().into();
    let mut resp = agent
        .get(url)
        .header("User-Agent", UA)
        .header("Referer", "https://music.163.com/")
        .call()
        .map_err(|e| e.to_string())?;
    let text = resp.body_mut().with_config().limit(4 * 1024 * 1024).read_to_string().map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

/// Для сравнения названий: без регистра, «ё», скобок с пометками и знаков.
pub fn norm(s: &str) -> String {
    let mut out = String::new();
    let mut depth = 0;
    for c in s.to_lowercase().replace('ё', "е").chars() {
        match c {
            '(' | '[' | '（' => depth += 1,
            ')' | ']' | '）' => depth = (depth - 1).max(0),
            _ if depth > 0 => {}
            c if c.is_alphanumeric() => out.push(c),
            _ => {}
        }
    }
    out
}

/// Строки с авторами и прочим, что NetEase и LRCLIB ставят в начало текста: «作词 : …»,
/// «Lyrics by …», «Текст: …».
pub fn is_credit(line: &str) -> bool {
    let t = line.trim();
    let head: String = t.chars().take_while(|&c| c != ':' && c != '：').collect();
    if head.len() == t.len() || head.chars().count() > 24 {
        return false;
    }
    let h = head.trim().to_lowercase();
    h.chars().any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c))
        || [
            "lyrics", "lyricist", "composer", "composed", "written", "producer", "produced", "arranger", "arranged", "mixing", "mixed",
            "mastering", "текст", "слова", "музыка", "автор", "аранжировка", "сведение", "мастеринг",
        ]
        .iter()
        .any(|w| h.starts_with(w))
}

/// Убирает строки с авторами из LRC-текста.
fn clean(lrc: &str) -> String {
    lrc.lines()
        .filter(|l| {
            let body = l.rsplit(']').next().unwrap_or(l);
            !is_credit(body)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn matches(song: &Value, title: &str, artists: &[String], duration: u64) -> bool {
    let name = norm(song["name"].as_str().unwrap_or_default());
    let want = norm(title);
    if name.is_empty() || want.is_empty() || name != want {
        return false;
    }
    let theirs: Vec<String> = song["artists"].as_array().into_iter().flatten().map(|a| norm(a["name"].as_str().unwrap_or_default())).collect();
    // «Miyagi & Andy Panda» у NetEase — один исполнитель, у Яндекса — два.
    let artist_ok = artists
        .iter()
        .map(|a| norm(a))
        .any(|a| !a.is_empty() && theirs.iter().any(|t| !t.is_empty() && (t.contains(&a) || a.contains(t.as_str()))));
    let secs = song["duration"].as_u64().unwrap_or(0) / 1000;
    artist_ok && (duration == 0 || secs.abs_diff(duration) <= 6)
}

/// Синхронный текст трека, если NetEase знает именно его.
pub fn netease(title: &str, artists: &[String], duration: u64) -> Result<Option<Found>, String> {
    let query = format!("{} {}", artists.first().map(String::as_str).unwrap_or_default(), title);
    let res = get(&format!("https://music.163.com/api/search/get?s={}&type=1&limit=10", enc(query.trim())))?;
    for song in res["result"]["songs"].as_array().into_iter().flatten().filter(|s| matches(s, title, artists, duration)).take(3) {
        let Some(id) = song["id"].as_u64() else { continue };
        let lyric = get(&format!("https://music.163.com/api/song/lyric?id={id}&lv=1"))?;
        let lrc = clean(lyric["lrc"]["lyric"].as_str().unwrap_or_default());
        // Хотя бы несколько строк со временем — иначе это пустышка или «纯音乐».
        if lrc.lines().filter(|l| l.starts_with('[') && l.len() > 11).count() >= 4 {
            return Ok(Some(Found { synced_lyrics: lrc }));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::{is_credit, norm};

    #[test]
    fn normalizes_titles() {
        assert_eq!(norm("Мотылёк (Remastered)"), "мотылек");
        assert_eq!(norm("I Got Love!"), "igotlove");
    }

    #[test]
    fn detects_credits() {
        assert!(is_credit(" 作词 : Макс Корж"));
        assert!(is_credit("Lyrics by: Someone"));
        assert!(is_credit("Текст: Автор"));
        assert!(!is_credit("Ну, что ты братишка притих... Обида залита в груди"));
        assert!(!is_credit("Time: is running out, she said to me tonight and then"));
    }
}
