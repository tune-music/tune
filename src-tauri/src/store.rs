//! Настройки Tune — %APPDATA%\dev.tune.music\settings.json.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DiscordSettings {
    pub enabled: bool,
    /// Название активности: «Слушает <name>».
    pub name: String,
    /// Что показывать в списке участников: "name" | "details" (трек) | "state" (исполнитель).
    pub status_display: String,
    /// Куда ведёт клик по названию, исполнителю, обложке и значку:
    /// "track" | "album" | "artist" | "custom" | "none". Для "custom" — ссылка из *_url.
    pub title_link: String,
    pub title_url: String,
    pub artist_link: String,
    pub artist_url: String,
    pub cover_link: String,
    pub cover_url: String,
    pub icon_link: String,
    pub icon_link_url: String,
    /// Кнопка «Tune Music» со ссылкой на сайт Tune.
    pub site_button: bool,
    pub show_cover: bool,
    pub show_progress: bool,
    /// На паузе: true — показывать «Пауза», false — убирать статус.
    pub show_paused: bool,
    pub small_icon: bool,
    /// Своя картинка для значка (ссылка https). Пусто — значок Tune.
    pub icon_url: String,
    /// Своё приложение Discord (необязательно). Пусто — встроенное.
    pub app_id: String,
}

impl Default for DiscordSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            name: "Tune Music".into(),
            status_display: "name".into(),
            title_link: "track".into(),
            title_url: String::new(),
            artist_link: "artist".into(),
            artist_url: String::new(),
            cover_link: "track".into(),
            cover_url: String::new(),
            icon_link: "tune".into(),
            icon_link_url: String::new(),
            site_button: true,
            show_cover: true,
            show_progress: true,
            show_paused: false,
            small_icon: true,
            icon_url: String::new(),
            app_id: String::new(),
        }
    }
}

/// Встроенные улучшения интерфейса (inject/features.js).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Features {
    /// Синхронный текст из LRCLIB, когда у Яндекса его нет.
    pub lyrics: bool,
    /// Искать текст и для треков, у которых он есть в Яндексе.
    pub lyrics_always: bool,
    /// Искать текст в LRCLIB.
    pub lyrics_lrclib: bool,
    /// Искать текст в NetEase Cloud Music.
    pub lyrics_netease: bool,
    /// Порядок источников текста: кто выше, у того и ищем раньше ("lrclib", "netease").
    pub lyrics_order: Vec<String>,
    pub lyrics_font_size: u32,
    /// Колесо мыши над плеером меняет громкость.
    pub wheel_volume: bool,
    /// Кнопка скорости воспроизведения в плеере.
    pub speed_control: bool,
    /// Шаг кнопки скорости: 0,05 / 0,1 / 0,25.
    pub speed_step: f64,
    /// Тон меняется вместе со скоростью — найткор (быстрее и выше) и слоуд (медленнее и ниже).
    pub pitch_with_speed: bool,
    /// Реверб, 0–100 %: доля «зала» в звуке. 0 — выключен.
    pub reverb: u32,
    /// Шаг громкости колесом и Ctrl+↑/↓, в процентах.
    pub volume_step: u32,
    /// «Исполнитель — трек» в заголовке окна и на панели задач.
    pub window_title: bool,
    /// Пробел, стрелки и т.п. в окне музыки.
    pub hotkeys: bool,
    /// Не выделять текст интерфейса мышью, как в нативном приложении.
    pub no_select: bool,
    /// Скачивание файла трека в «Загрузки» (пункт «Скачать трек» в меню «…» плеера).
    pub download: bool,
    /// Ещё и отдельная кнопка в панели плеера.
    pub download_button: bool,
    /// Версии треков без цензуры из открытого списка FckCensor.
    pub uncensor: bool,
    /// Восстановленные «Без цензуры» треки, удалённые из Яндекса, попадаются в «Моей волне».
    pub uncensor_wave: bool,
    /// Свои (загруженные) треки из «Мне нравится» попадаются в «Моей волне».
    pub local_in_wave: bool,
    /// Помнить последний трек и очередь, если Ynison не отдал их при запуске.
    pub keep_track: bool,
    /// Кнопка Станций и колонок Яндекса в локальной сети на верхней панели.
    pub stations: bool,
}

impl Default for Features {
    fn default() -> Self {
        Self {
            lyrics: true,
            lyrics_always: false,
            lyrics_lrclib: true,
            lyrics_netease: true,
            lyrics_order: vec!["lrclib".into(), "netease".into()],
            lyrics_font_size: 22,
            wheel_volume: true,
            speed_control: false,
            speed_step: 0.25,
            pitch_with_speed: false,
            reverb: 0,
            volume_step: 5,
            window_title: true,
            hotkeys: true,
            no_select: true,
            download: true,
            download_button: false,
            uncensor: true,
            uncensor_wave: true,
            local_in_wave: true,
            keep_track: true,
            stations: true,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub enabled_addons: Vec<String>,
    pub discord: DiscordSettings,
    pub features: Features,
    pub media_keys: bool,
    pub close_to_tray: bool,
    /// Пускать трафик движка через локальный прокси в процессе Tune (см. proxy.rs).
    pub route_through_tune: bool,
    pub autostart: bool,
    pub start_minimized: bool,
    /// Масштаб интерфейса музыки, 1.0 — 100 %.
    pub zoom: f64,
    /// Проверять обновления Tune при запуске.
    pub auto_update: bool,
    /// Идентификаторы устройства для интерфейса Яндекса (как у официального клиента).
    pub device_uuid: String,
    pub device_id: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            enabled_addons: Vec::new(),
            discord: DiscordSettings::default(),
            features: Features::default(),
            media_keys: true,
            close_to_tray: true,
            route_through_tune: true,
            autostart: false,
            start_minimized: false,
            zoom: 1.0,
            auto_update: true,
            device_uuid: String::new(),
            device_id: String::new(),
        }
    }
}

impl Settings {
    pub fn set_enabled(&mut self, id: &str, on: bool) {
        self.enabled_addons.retain(|x| x != id);
        if on {
            self.enabled_addons.push(id.to_string());
        }
    }
}

pub struct Store {
    root: PathBuf,
}

impl Store {
    pub fn new(root: PathBuf) -> std::io::Result<Self> {
        fs::create_dir_all(&root)?;
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn load_settings(&self) -> Settings {
        let Some(raw) = fs::read_to_string(self.root.join("settings.json")).ok().and_then(|s| serde_json::from_str::<Value>(&s).ok()) else {
            return Settings::default();
        };
        let mut s: Settings = serde_json::from_value(raw.clone()).unwrap_or_default();
        // Tune 0.1: discordEnabled/discordClientId и плагины встроенного каталога.
        if raw.get("discord").is_none() {
            if let Some(id) = raw.get("discordClientId").and_then(|v| v.as_str()) {
                s.discord.app_id = id.trim().to_string();
            }
        }
        if raw.get("features").is_none() {
            let had = |id: &str| raw.get("enabledPlugins").and_then(|v| v.as_array()).is_some_and(|a| a.iter().any(|x| x == id));
            s.features.speed_control = had("playback-speed");
            s.features.wheel_volume = s.features.wheel_volume || had("wheel-volume");
        }
        if !(0.5..=2.0).contains(&s.zoom) {
            s.zoom = 1.0;
        }
        s
    }

    pub fn save_settings(&self, settings: &Settings) -> Result<(), String> {
        let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
        fs::write(self.root.join("settings.json"), json).map_err(|e| e.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_old_settings() {
        let dir = std::env::temp_dir().join(format!("tune-store-{}", std::process::id()));
        let store = Store::new(dir.clone()).unwrap();
        fs::write(dir.join("settings.json"), r#"{"enabledPlugins":["playback-speed"],"discordClientId":" 42 ","closeToTray":false}"#).unwrap();
        let s = store.load_settings();
        assert!(s.features.speed_control);
        assert_eq!(s.discord.app_id, "42");
        assert!(!s.close_to_tray);
        assert!(s.discord.enabled);
        let _ = fs::remove_dir_all(dir);
    }
}
