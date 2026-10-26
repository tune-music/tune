//! Системная медиапанель Windows (SMTC) от имени Tune Music.
//!
//! Встроенная медиасессия WebView2 отключена (см. BROWSER_ARGS в main.rs),
//! иначе Windows показывала бы «Microsoft Edge WebView2». Вместо неё сессию
//! регистрирует наше окно: в панели громкости видно «Tune Music», трек и обложку,
//! а медиаклавиши приходят сюда без глобального перехвата клавиатуры.

use std::cell::RefCell;
use std::time::Duration;

use souvlaki::{MediaControlEvent, MediaControls, MediaMetadata, MediaPlayback, MediaPosition, PlatformConfig};
use tauri::{AppHandle, Manager};

use crate::discord::Track;

thread_local! {
    // Объекты SMTC привязаны к главному потоку, поэтому живут в thread_local
    // и трогаются только через run_on_main_thread.
    static CONTROLS: RefCell<Option<MediaControls>> = const { RefCell::new(None) };
}

fn on_event(app: &AppHandle, event: MediaControlEvent) {
    let js = match event {
        MediaControlEvent::Play => "play()".to_string(),
        MediaControlEvent::Pause | MediaControlEvent::Stop => "pause()".to_string(),
        MediaControlEvent::Toggle => "toggle()".to_string(),
        MediaControlEvent::Next => "next()".to_string(),
        MediaControlEvent::Previous => "prev()".to_string(),
        MediaControlEvent::SetPosition(MediaPosition(pos)) => format!("seek({})", pos.as_secs_f64()),
        MediaControlEvent::Raise => {
            crate::show_main(app);
            return;
        }
        _ => return,
    };
    crate::eval_client(app, &format!("window.__tune&&window.__tune.player.{js}"));
}

fn create(app: &AppHandle) -> Option<MediaControls> {
    let win = app.get_webview_window("main")?;
    #[cfg(target_os = "windows")]
    let hwnd = Some(win.hwnd().ok()?.0 as *mut std::ffi::c_void);
    #[cfg(not(target_os = "windows"))]
    let hwnd = {
        let _ = &win;
        None
    };

    let mut controls = MediaControls::new(PlatformConfig {
        display_name: "Tune Music",
        dbus_name: "tune_music",
        hwnd,
    })
    .map_err(|e| eprintln!("tune: медиапанель недоступна: {e:?}"))
    .ok()?;

    let handle = app.clone();
    controls
        .attach(move |event| on_event(&handle, event))
        .map_err(|e| eprintln!("tune: медиапанель: {e:?}"))
        .ok()?;
    Some(controls)
}

/// Включает или убирает нашу сессию из системной медиапанели.
pub fn set_enabled(app: &AppHandle, enabled: bool) {
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || {
        CONTROLS.with(|c| {
            let mut c = c.borrow_mut();
            if enabled && c.is_none() {
                *c = create(&handle);
            } else if !enabled {
                *c = None;
            }
        });
    });
}

pub fn update(app: &AppHandle, track: Option<Track>) {
    let _ = app.run_on_main_thread(move || {
        CONTROLS.with(|c| {
            let mut c = c.borrow_mut();
            let Some(controls) = c.as_mut() else { return };
            let Some(t) = track.filter(|t| !t.title.is_empty()) else {
                let _ = controls.set_playback(MediaPlayback::Stopped);
                return;
            };
            let _ = controls.set_metadata(MediaMetadata {
                title: Some(&t.title),
                artist: Some(&t.artist).filter(|s| !s.is_empty()).map(|s| s.as_str()),
                album: Some(&t.album).filter(|s| !s.is_empty()).map(|s| s.as_str()),
                cover_url: Some(&t.cover).filter(|s| s.starts_with("https://")).map(|s| s.as_str()),
                duration: (t.duration > 0.0).then(|| Duration::from_secs_f64(t.duration)),
            });
            let progress = Some(MediaPosition(Duration::from_secs_f64(t.position.max(0.0))));
            let _ = controls.set_playback(if t.playing {
                MediaPlayback::Playing { progress }
            } else {
                MediaPlayback::Paused { progress }
            });
        });
    });
}
