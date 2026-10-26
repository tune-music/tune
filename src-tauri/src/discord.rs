//! Discord Rich Presence — «Слушает Яндекс Музыку».
//!
//! Работает в отдельном потоке: страница присылает текущий трек, поток
//! держит соединение с локальным Discord и сам переподключается, если
//! Discord запустили позже или перезапустили.
//!
//! Регистрировать своё приложение не нужно: название активности задаётся полем `name`,
//! картинки — прямыми ссылками, поэтому подходит любое приложение Discord.

use crate::store::DiscordSettings;
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use serde::Deserialize;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Приложение Discord по умолчанию. Его собственное название не видно: Tune
/// подменяет его своим (`name`), поэтому выбор приложения ни на что не влияет.
const DEFAULT_APP_ID: &str = "1300258490815741952";
/// Сайт Tune: сюда по умолчанию ведёт значок в углу обложки.
pub const TUNE_SITE: &str = "https://tune-music.github.io/tune/";
/// Значок Tune из репозитория github.com/tune-music/tune (Discord берёт картинки только по ссылке).
const TUNE_ICON: &str = "https://raw.githubusercontent.com/tune-music/tune/main/src-tauri/icons/128x128@2x.png";

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Track {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub cover: String,
    pub url: String,
    pub album_url: String,
    pub artist_url: String,
    pub playing: bool,
    /// Секунды от начала трека.
    pub position: f64,
    /// Длительность в секундах, 0 — неизвестна.
    pub duration: f64,
}

enum Msg {
    Config(DiscordSettings),
    Track(Option<Track>),
}

#[derive(Clone)]
pub struct Handle(Sender<Msg>);

impl Handle {
    pub fn configure(&self, settings: &DiscordSettings) {
        let _ = self.0.send(Msg::Config(settings.clone()));
    }

    pub fn update(&self, track: Option<Track>) {
        let _ = self.0.send(Msg::Track(track));
    }
}

fn app_id(s: &DiscordSettings) -> String {
    let id = s.app_id.trim();
    if !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()) {
        id.to_string()
    } else {
        DEFAULT_APP_ID.to_string()
    }
}

pub fn spawn() -> Handle {
    let (tx, rx) = mpsc::channel::<Msg>();
    thread::Builder::new()
        .name("discord-rpc".into())
        .spawn(move || {
            let mut cfg = DiscordSettings { enabled: false, ..Default::default() };
            let mut track: Option<Track> = None;
            let mut client: Option<DiscordIpcClient> = None;
            let mut dirty = false;

            loop {
                match rx.recv_timeout(Duration::from_secs(15)) {
                    Ok(Msg::Config(c)) => {
                        if app_id(&c) != app_id(&cfg) || !c.enabled {
                            disconnect(&mut client);
                        }
                        cfg = c;
                        dirty = true;
                    }
                    Ok(Msg::Track(t)) => {
                        if t != track {
                            track = t;
                            dirty = true;
                        }
                    }
                    // Периодически пробуем переподключиться, если Discord был закрыт.
                    Err(RecvTimeoutError::Timeout) => dirty |= client.is_none(),
                    Err(RecvTimeoutError::Disconnected) => break,
                }

                if !dirty || !cfg.enabled {
                    continue;
                }
                if client.is_none() {
                    client = connect(&app_id(&cfg));
                }
                if let Some(c) = client.as_mut() {
                    let result = match &track {
                        Some(t) if !t.title.is_empty() && (t.playing || cfg.show_paused) => c.set_activity(build_activity(t, &cfg)),
                        _ => c.clear_activity(),
                    };
                    if result.is_err() {
                        disconnect(&mut client);
                    } else {
                        dirty = false;
                    }
                }
            }
            disconnect(&mut client);
        })
        .expect("failed to spawn discord thread");
    Handle(tx)
}

fn connect(client_id: &str) -> Option<DiscordIpcClient> {
    let mut c = DiscordIpcClient::new(client_id);
    c.connect().ok()?;
    Some(c)
}

fn disconnect(client: &mut Option<DiscordIpcClient>) {
    if let Some(mut c) = client.take() {
        let _ = c.clear_activity();
        let _ = c.close();
    }
}

/// Первые `max` байт UTF-8 строки, не разрезая символ.
fn clip_bytes(s: &str, max: usize) -> String {
    let mut end = 0;
    for (i, c) in s.char_indices() {
        if i + c.len_utf8() > max {
            break;
        }
        end = i + c.len_utf8();
    }
    s[..end].trim_end().to_string()
}

/// Discord считает длину текстовых полей в байтах UTF-8: от 2 до 128. Русская буква —
/// два байта, поэтому обрезаем по байтам, иначе Discord отбрасывает поле.
fn fit(s: &str) -> String {
    let mut s = clip_bytes(s, 128);
    while s.chars().count() < 2 {
        s.push(' ');
    }
    s
}

fn web_url(u: &str) -> Option<String> {
    let u = u.trim();
    (u.starts_with("https://") || u.starts_with("http://")).then(|| u.to_string())
}

/// Куда ведёт клик: страница трека, альбома, исполнителя или своя ссылка.
fn link(t: &Track, target: &str, custom: &str) -> Option<String> {
    match target {
        "track" => web_url(&t.url),
        "album" => web_url(&t.album_url),
        "artist" => web_url(&t.artist_url),
        "tune" => Some(TUNE_SITE.to_string()),
        "custom" => web_url(custom),
        _ => None,
    }
}

fn build_activity(t: &Track, cfg: &DiscordSettings) -> activity::Activity<'static> {
    let name = if cfg.name.trim().is_empty() { "Tune Music" } else { cfg.name.trim() };
    let details = fit(&t.title);
    let state = fit(if t.artist.is_empty() { name } else { &t.artist });
    let album = fit(if t.album.is_empty() { &t.title } else { &t.album });

    let icon = Some(cfg.icon_url.trim())
        .filter(|u| u.starts_with("https://"))
        .unwrap_or(TUNE_ICON)
        .to_string();
    let mut assets = activity::Assets::new().large_text(album);
    if cfg.show_cover && t.cover.starts_with("https://") {
        assets = assets.large_image(t.cover.clone());
    } else {
        assets = assets.large_image(icon.clone());
    }
    if let Some(u) = link(t, &cfg.cover_link, &cfg.cover_url) {
        assets = assets.large_url(u);
    }
    if cfg.small_icon {
        assets = assets
            .small_image(icon)
            .small_text(if t.playing { "Играет" } else { "Пауза" }.to_string());
        if let Some(u) = link(t, &cfg.icon_link, &cfg.icon_link_url) {
            assets = assets.small_url(u);
        }
    }

    let display = match cfg.status_display.as_str() {
        "name" => activity::StatusDisplayType::Name,
        "state" => activity::StatusDisplayType::State,
        _ => activity::StatusDisplayType::Details,
    };
    let mut act = activity::Activity::new()
        .name(fit(name))
        .activity_type(activity::ActivityType::Listening)
        .status_display_type(display)
        .details(details)
        .state(if t.playing { state } else { fit(&format!("Пауза · {}", t.artist)) })
        .assets(assets);
    if let Some(u) = link(t, &cfg.title_link, &cfg.title_url) {
        act = act.details_url(u);
    }
    if let Some(u) = link(t, &cfg.artist_link, &cfg.artist_url) {
        act = act.state_url(u);
    }

    if cfg.show_progress && t.playing && t.duration > 0.0 {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
        let start = now - (t.position * 1000.0) as i64;
        let end = start + (t.duration * 1000.0) as i64;
        act = act.timestamps(activity::Timestamps::new().start(start).end(end));
    }

    act
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track() -> Track {
        Track {
            title: "Клей".into(),
            artist: "CUPSIZE".into(),
            cover: "https://avatars.yandex.net/x/400x400".into(),
            url: "https://music.yandex.ru/album/1/track/2".into(),
            album_url: "https://music.yandex.ru/album/1".into(),
            artist_url: "https://music.yandex.ru/artist/3".into(),
            playing: true,
            ..Default::default()
        }
    }

    #[test]
    fn links() {
        let mut cfg = DiscordSettings::default();
        cfg.cover_link = "custom".into();
        cfg.cover_url = " https://example.com/cover ".into();
        let json = serde_json::to_value(build_activity(&track(), &cfg)).unwrap();
        assert_eq!(json["details_url"], "https://music.yandex.ru/album/1/track/2");
        assert_eq!(json["assets"]["large_url"], "https://example.com/cover");
        assert!(json.get("buttons").is_none());
        // По умолчанию обложка ведёт на трек, значок — никуда.
        let json = serde_json::to_value(build_activity(&track(), &DiscordSettings::default())).unwrap();
        assert_eq!(json["assets"]["large_url"], "https://music.yandex.ru/album/1/track/2");
        assert_eq!(json["assets"]["small_url"], TUNE_SITE);
    }

    #[test]
    fn texts_fit_in_bytes() {
        assert_eq!(clip_bytes("Слушать в Яндекс Музыке", 32), "Слушать в Яндекс");
        assert!(fit(&"ё".repeat(100)).len() <= 128);
    }
}
