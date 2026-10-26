//! Discord Rich Presence — «Слушает Яндекс Музыку».
//!
//! Работает в отдельном потоке: страница присылает текущий трек, поток
//! держит соединение с локальным Discord и сам переподключается, если
//! Discord запустили позже или перезапустили.
//!
//! Регистрировать своё приложение не нужно: название активности задаётся полем `name`,
//! картинки — прямыми ссылками, поэтому подходит любое приложение Discord.

use crate::store::{DiscordButton, DiscordSettings};
use discord_rich_presence::{activity, DiscordIpc, DiscordIpcClient};
use serde::Deserialize;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Приложение Discord по умолчанию. Его собственное название не видно: Tune
/// подменяет его своим (`name`), поэтому выбор приложения ни на что не влияет.
const DEFAULT_APP_ID: &str = "1300258490815741952";
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

/// Discord требует от 2 до 128 символов в текстовых полях.
fn fit(s: &str) -> String {
    let mut s: String = s.chars().take(128).collect();
    while s.chars().count() < 2 {
        s.push(' ');
    }
    s
}

fn link(t: &Track, target: &str) -> Option<String> {
    let url = match target {
        "track" => &t.url,
        "album" => &t.album_url,
        "artist" => &t.artist_url,
        _ => return None,
    };
    url.starts_with("https://").then(|| url.clone())
}

fn button(t: &Track, b: &DiscordButton) -> Option<activity::Button<'static>> {
    let url = match b.target.as_str() {
        "custom" => Some(b.url.trim().to_string()).filter(|u| u.starts_with("https://") || u.starts_with("http://")),
        other => link(t, other),
    }?;
    let label = if b.label.trim().is_empty() {
        match b.target.as_str() {
            "album" => "Альбом",
            "artist" => "Исполнитель",
            "custom" => "Ссылка",
            _ => "Слушать в Яндекс Музыке",
        }
        .to_string()
    } else {
        b.label.trim().chars().take(32).collect()
    };
    Some(activity::Button::new(label, url))
}

fn build_activity(t: &Track, cfg: &DiscordSettings) -> activity::Activity<'static> {
    let name = if cfg.name.trim().is_empty() { "Яндекс Музыка" } else { cfg.name.trim() };
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
    if cfg.small_icon {
        assets = assets
            .small_image(icon)
            .small_text(if t.playing { "Играет" } else { "Пауза" }.to_string());
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
    if let Some(u) = link(t, &cfg.title_link) {
        act = act.details_url(u);
    }
    if let Some(u) = link(t, &cfg.artist_link) {
        act = act.state_url(u);
    }

    if cfg.show_progress && t.playing && t.duration > 0.0 {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0);
        let start = now - (t.position * 1000.0) as i64;
        let end = start + (t.duration * 1000.0) as i64;
        act = act.timestamps(activity::Timestamps::new().start(start).end(end));
    }

    let buttons: Vec<_> = [&cfg.button1, &cfg.button2].into_iter().filter_map(|b| button(t, b)).collect();
    if !buttons.is_empty() {
        act = act.buttons(buttons);
    }
    act
}
