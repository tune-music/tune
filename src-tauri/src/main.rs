// Без консольного окна в релизной сборке под Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod addons;
mod asar;
mod client;
mod discord;
mod download;
mod intercept;
mod media;
mod mixer;
mod proxy;
mod repo;
mod store;

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex, OnceLock};

use addons::{Addon, Addons, Kind, Origin};
use base64::Engine;
use serde::Serialize;
use serde_json::{json, Value};
use store::{Settings, Store};
use tauri::image::Image;
use tauri::menu::{IconMenuItem, Menu, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

const BRIDGE_JS: &str = include_str!("../inject/bridge.js");
const RUNTIME_JS: &str = include_str!("../inject/runtime.js");
const COMPAT_JS: &str = include_str!("../inject/compat.js");
const FEATURES_JS: &str = include_str!("../inject/features.js");

// Аргументы движка должны совпадать у всех окон: WebView2 делит один процесс браузера.
// Первые три флага — значения Tauri по умолчанию. HardwareMediaKeyHandling выключает
// собственную медиасессию WebView2, вместо неё работает media.rs от имени Tune Music.
const BASE_BROWSER_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,HardwareMediaKeyHandling";

/// Скрытый отладочный режим: `tune-music.exe --tune-debug` (или TUNE_DEBUG=1) открывает
/// DevTools-порт 9333 на localhost. Без ключа релизная сборка порт не открывает: через
/// него доступна вся страница вместе с cookie аккаунта.
fn debug_mode() -> bool {
    cfg!(debug_assertions)
        || std::env::args().any(|a| a == "--tune-debug")
        || std::env::var("TUNE_DEBUG").is_ok_and(|v| v == "1")
}

static BROWSER_ARGS: OnceLock<String> = OnceLock::new();

/// Аргументы движка вычисляются один раз при запуске: у всех окон они должны совпадать.
fn init_browser_args(route_through_tune: bool) {
    let mut args = BASE_BROWSER_ARGS.to_string();
    if route_through_tune {
        match proxy::start() {
            Ok(port) => args.push_str(&format!(" --proxy-server=http://127.0.0.1:{port}")),
            Err(e) => eprintln!("tune: локальный прокси не запустился, движок пойдёт в сеть напрямую: {e}"),
        }
    }
    if debug_mode() {
        args.push_str(" --remote-debugging-port=9333");
    }
    let _ = BROWSER_ARGS.set(args);
}

fn browser_args() -> String {
    BROWSER_ARGS.get().cloned().unwrap_or_else(|| BASE_BROWSER_ARGS.to_string())
}

/// Что уже загружено в открытую страницу — чтобы понять, нужна ли перезагрузка.
#[derive(Default)]
struct PageState {
    /// "аддон/файл" → хеш выполненного скрипта.
    ran: BTreeMap<String, String>,
    /// Флаги интерфейса, с которыми страница загрузилась.
    experiments: BTreeMap<String, String>,
}

struct AppState {
    store: Store,
    addons: Addons,
    settings: Mutex<Settings>,
    discord: discord::Handle,
    client: Mutex<ClientState>,
    page: Mutex<PageState>,
}

/// Состояние локального интерфейса Яндекс Музыки.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "state")]
enum ClientState {
    Installing { progress: Option<client::Progress> },
    Failed { error: String },
    Ready,
}

impl AppState {
    fn settings(&self) -> Settings {
        self.settings.lock().unwrap().clone()
    }

    fn update_settings(&self, f: impl FnOnce(&mut Settings)) -> Result<Settings, String> {
        let mut s = self.settings.lock().unwrap();
        f(&mut s);
        self.store.save_settings(&s)?;
        Ok(s.clone())
    }

    fn enabled(&self) -> Vec<String> {
        let s = self.settings();
        s.enabled_addons.into_iter().filter(|id| self.addons.exists(id)).collect()
    }

    /// Флаги всех включённых аддонов; при совпадении побеждает включённый позже.
    fn experiments(&self) -> BTreeMap<String, String> {
        let mut out = BTreeMap::new();
        for id in self.enabled() {
            out.extend(self.addons.experiments(&id));
        }
        out
    }

    /// Скрипты, которые должны работать на странице: "аддон/файл" → хеш.
    fn wanted_scripts(&self) -> BTreeMap<String, String> {
        let mut out = BTreeMap::new();
        for id in self.enabled() {
            let Some(p) = self.addons.page_payload(&id) else { continue };
            for js in p["js"].as_array().into_iter().flatten() {
                let file = js["file"].as_str().unwrap_or_default();
                out.insert(format!("{id}/{file}"), fnv(js["code"].as_str().unwrap_or_default()));
            }
        }
        out
    }

    /// Перезагрузка нужна, если выключен или изменён уже запущенный скрипт
    /// (чужие скрипты не умеют выгружаться) или поменялись флаги интерфейса.
    fn reload_needed(&self) -> bool {
        let wanted = self.wanted_scripts();
        let experiments = self.experiments();
        let page = self.page.lock().unwrap();
        page.ran.iter().any(|(k, h)| wanted.get(k) != Some(h)) || page.experiments != experiments
    }
}

fn fnv(s: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.bytes() {
        h = (h ^ b as u64).wrapping_mul(0x100000001b3);
    }
    format!("{h:x}")
}

// ---------------------------------------------------------------------------
// Внедрение аддонов в страницу
// ---------------------------------------------------------------------------

/// Отправляет в страницу включённые аддоны и настройки улучшений.
/// Каждый скрипт исполняется отдельным eval, чтобы ошибка в одном не ломала остальные.
/// eval идёт через движок WebView и не упирается в CSP сайта.
fn push_payload(win: &WebviewWindow, state: &AppState) {
    let payloads: Vec<Value> = state.enabled().iter().filter_map(|id| state.addons.page_payload(id)).collect();
    let page: Vec<Value> = payloads
        .iter()
        .map(|p| json!({ "id": p["id"], "name": p["name"], "aliases": p["aliases"], "theme": p["theme"], "css": p["css"], "settings": p["settings"] }))
        .collect();
    let features = serde_json::to_string(&state.settings().features).unwrap_or_else(|_| "{}".into());
    let _ = win.eval(format!(
        "window.__tune&&(window.__tune._applyAddons({}),window.__tune._features({features}));",
        serde_json::to_string(&page).unwrap()
    ));

    for p in &payloads {
        let id = p["id"].as_str().unwrap_or_default();
        for js in p["js"].as_array().into_iter().flatten() {
            let file = js["file"].as_str().unwrap_or_default();
            let code = js["code"].as_str().unwrap_or_default();
            let source = format!("tune-addon/{}/{}", id.replace(' ', "_"), file.replace(' ', "_"));
            let _ = win.eval(format!(
                "window.__tune&&window.__tune._script({},{},{},function(){{\n{code}\n}});\n//# sourceURL={source}",
                serde_json::to_string(id).unwrap(),
                serde_json::to_string(file).unwrap(),
                serde_json::to_string(&fnv(code)).unwrap(),
            ));
        }
    }
}

fn refresh_client(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        push_payload(&win, &app.state::<AppState>());
    }
    notify_reload(app);
}

fn notify_reload(app: &AppHandle) {
    let needed = app.state::<AppState>().reload_needed();
    let _ = app.emit_to("manager", "reload-needed", needed);
}

fn eval_client(app: &AppHandle, js: &str) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.eval(js);
    }
}

/// Скрипт в <head> страницы: переопределения флагов интерфейса (experiments.override).
fn head_script(app: &AppHandle) -> String {
    let state = app.state::<AppState>();
    let exp = state.experiments();
    let json = serde_json::to_string(&exp).unwrap_or_else(|_| "{}".into());
    // Новая загрузка страницы: скрипты прошлой загрузки больше не работают.
    {
        let mut page = state.page.lock().unwrap();
        page.experiments = exp;
        page.ran.clear();
    }
    format!(
        "window.__TUNE_EXP__={json};window.__tuneExp=function(m,n){{var o=window.__TUNE_EXP__[n],c=m&&m[n];\
         if(!o||o==='unset')return c;return Object.assign({{}},c,{{group:o,value:Object.assign({{}},c&&c.value,{{title:o}})}})}};"
    )
}

/// Ответы «сервера» http://127.0.0.1:2007 для аддонов (формат PulseSync и Next Music).
fn addon_server(app: &AppHandle, path: &str, query: &str) -> asar::Served {
    let state = app.state::<AppState>();
    let param = |key: &str| {
        query.split('&').find_map(|kv| {
            let (k, v) = kv.split_once('=').unwrap_or((kv, ""));
            (k == key).then(|| asar::percent_decode(&v.replace('+', " ")).unwrap_or_default())
        })
    };
    let not_found = || asar::Served { status: 404, mime: "text/plain; charset=utf-8", body: b"Not found".to_vec() };
    let json_resp = |v: Value| asar::Served { status: 200, mime: "application/json", body: v.to_string().into_bytes() };
    let Some(name) = param("name").filter(|n| !n.is_empty()) else {
        return asar::Served { status: 400, mime: "text/plain; charset=utf-8", body: b"Missing name parameter".to_vec() };
    };
    match path.trim_end_matches('/') {
        "/assets" => state.addons.asset_list(&name).map(json_resp).unwrap_or_else(not_found),
        "/get_handle" => state.addons.handle(&name).map(json_resp).unwrap_or_else(not_found),
        p if p.starts_with("/assets/") => {
            let file = asar::percent_decode(&p["/assets/".len()..]).unwrap_or_default();
            match state.addons.asset(&name, &file).and_then(|f| Some((std::fs::read(&f).ok()?, f))) {
                Some((body, f)) => asar::Served { status: 200, mime: asar::mime(&f.to_string_lossy()), body },
                None => not_found(),
            }
        }
        _ => not_found(),
    }
}

// ---------------------------------------------------------------------------
// Окна
// ---------------------------------------------------------------------------

fn show_window(win: &WebviewWindow) {
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
    intercept::set_page_visible(win, true);
}

fn show_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        show_window(&win);
    }
}

fn show_manager(app: &AppHandle) -> tauri::Result<()> {
    if let Some(win) = app.get_webview_window("manager") {
        show_window(&win);
        return Ok(());
    }
    let win = WebviewWindowBuilder::new(app, "manager", WebviewUrl::App("index.html".into()))
        .title("Tune")
        .inner_size(1080.0, 720.0)
        .min_inner_size(780.0, 520.0)
        // Свой заголовок, как у клиента музыки (ui/index.html).
        .decorations(false)
        .additional_browser_args(&browser_args())
        .center()
        .build()?;
    intercept::app_like(&win, debug_mode());
    Ok(())
}

fn init_script(state: &AppState) -> String {
    let s = state.settings();
    let hostname = std::env::var("COMPUTERNAME").unwrap_or_else(|_| "Tune".into());
    let cfg = json!({
        "version": client::VERSION,
        "branch": client::BRANCH,
        "uuid": s.device_uuid,
        "deviceId": s.device_id,
        "hostname": hostname.chars().take(50).collect::<String>(),
    });
    format!("window.__TUNE_CLIENT__={cfg};\n{BRIDGE_JS}\n{RUNTIME_JS}\n{COMPAT_JS}\n{FEATURES_JS}")
}

/// music-application://desktop/oauth?…#token → https://music.yandex.ru/oauth?…#token
fn desktop_to_local(url: &tauri::Url) -> String {
    let mut target = format!("{}{}", intercept::ORIGIN, url.path());
    if let Some(q) = url.query() {
        target.push('?');
        target.push_str(q);
    }
    if let Some(f) = url.fragment() {
        target.push('#');
        target.push_str(f);
    }
    target
}

fn open_external(url: &str) {
    #[cfg(windows)]
    let _ = std::process::Command::new("rundll32").args(["url.dll,FileProtocolHandler", url]).spawn();
    #[cfg(target_os = "macos")]
    let _ = std::process::Command::new("open").arg(url).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let _ = std::process::Command::new("xdg-open").arg(url).spawn();
}

fn create_main(app: &AppHandle, visible: bool) -> tauri::Result<()> {
    let state = app.state::<AppState>();
    let ready = matches!(*state.client.lock().unwrap(), ClientState::Ready);
    // Интерфейс открывается только после включения перехвата (attach_client).
    let url = if ready {
        WebviewUrl::External("about:blank".parse().unwrap())
    } else {
        WebviewUrl::App("setup.html".into())
    };

    let nav_handle = app.clone();
    let win = WebviewWindowBuilder::new(app, "main", url)
        .title("Tune Music")
        .inner_size(1280.0, 820.0)
        .min_inner_size(800.0, 560.0)
        // Интерфейс Яндекса рисует свой заголовок с кнопками окна (app-region: drag).
        .decorations(false)
        .visible(visible)
        .additional_browser_args(&browser_args())
        .initialization_script(init_script(&state))
        .on_navigation(move |url| {
            if url.scheme() != "music-application" {
                return true;
            }
            // Возврат после входа на адрес официального клиента — открываем его локально.
            let target = desktop_to_local(url);
            let handle = nav_handle.clone();
            std::thread::spawn(move || {
                if let (Some(w), Ok(u)) = (handle.get_webview_window("main"), target.parse()) {
                    let _ = w.navigate(u);
                }
            });
            false
        })
        .on_new_window(|url, _features| {
            if matches!(url.scheme(), "http" | "https") {
                open_external(url.as_str());
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .build()?;
    intercept::app_like(&win, debug_mode());
    let zoom = state.settings().zoom;
    if (zoom - 1.0).abs() > 0.001 {
        let _ = win.set_zoom(zoom);
    }

    if ready {
        if let Err(error) = attach_client(app, &win) {
            // Архив повреждён — скачаем заново.
            eprintln!("tune: {error}");
            *state.client.lock().unwrap() = ClientState::Failed { error };
            let setup = if cfg!(windows) { "http://tauri.localhost/setup.html" } else { "tauri://localhost/setup.html" };
            let _ = win.navigate(setup.parse().unwrap());
        }
    }

    let handle = app.clone();
    let minimized = std::sync::atomic::AtomicBool::new(false);
    win.on_window_event(move |event| match event {
        WindowEvent::CloseRequested { api, .. } => {
            if handle.state::<AppState>().settings().close_to_tray {
                api.prevent_close();
                if let Some(w) = handle.get_webview_window("main") {
                    let _ = w.hide();
                    intercept::set_page_visible(&w, false);
                }
            } else {
                handle.exit(0);
            }
        }
        // Свернули или развернули (кнопкой, с панели задач, Win+D) — WebView2 узнаёт об этом от нас.
        WindowEvent::Resized(_) => {
            let Some(w) = handle.get_webview_window("main") else { return };
            let now = w.is_minimized().unwrap_or(false);
            if minimized.swap(now, std::sync::atomic::Ordering::Relaxed) != now {
                intercept::set_page_visible(&w, !now);
            }
        }
        _ => {}
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// Локальный интерфейс Яндекс Музыки
// ---------------------------------------------------------------------------

fn attach_client(app: &AppHandle, win: &WebviewWindow) -> Result<(), String> {
    let root = app.state::<AppState>().store.root().to_path_buf();
    let asar = asar::Asar::open(&client::asar_path(&root))?;
    let (h1, h2) = (app.clone(), app.clone());
    let hooks = intercept::Hooks {
        head_script: Box::new(move || head_script(&h1)),
        addon_server: Box::new(move |path, query| addon_server(&h2, path, query)),
    };
    intercept::install(win, Arc::new(asar), hooks).map_err(|e| e.to_string())
}

fn set_client_state(app: &AppHandle, s: ClientState) {
    *app.state::<AppState>().client.lock().unwrap() = s.clone();
    let _ = app.emit_to("main", "client-state", s);
}

/// Скачивает интерфейс в фоне, показывая прогресс на setup.html, затем открывает его.
fn start_client_install(app: &AppHandle) {
    {
        let state = app.state::<AppState>();
        let mut c = state.client.lock().unwrap();
        if matches!(*c, ClientState::Installing { progress: Some(_) } | ClientState::Ready) {
            return;
        }
        *c = ClientState::Installing { progress: None };
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        let root = handle.state::<AppState>().store.root().to_path_buf();
        let report = |p: client::Progress| set_client_state(&handle, ClientState::Installing { progress: Some(p) });
        match client::install(&root, &report) {
            Ok(_) => {
                let h = handle.clone();
                let _ = handle.run_on_main_thread(move || {
                    let Some(win) = h.get_webview_window("main") else { return };
                    match attach_client(&h, &win) {
                        Ok(()) => set_client_state(&h, ClientState::Ready),
                        Err(error) => set_client_state(&h, ClientState::Failed { error }),
                    }
                });
            }
            Err(error) => set_client_state(&handle, ClientState::Failed { error }),
        }
    });
}

/// Иконки меню трея: маски прозрачности из icons/menu (make.py) в размерах 16/20/24/32.
const MENU_ICONS: &[(&str, [&[u8]; 4])] = &[
    ("music", [include_bytes!("../icons/menu/music_16.a8"), include_bytes!("../icons/menu/music_20.a8"), include_bytes!("../icons/menu/music_24.a8"), include_bytes!("../icons/menu/music_32.a8")]),
    ("tune", [include_bytes!("../icons/menu/tune_16.a8"), include_bytes!("../icons/menu/tune_20.a8"), include_bytes!("../icons/menu/tune_24.a8"), include_bytes!("../icons/menu/tune_32.a8")]),
    ("reload", [include_bytes!("../icons/menu/reload_16.a8"), include_bytes!("../icons/menu/reload_20.a8"), include_bytes!("../icons/menu/reload_24.a8"), include_bytes!("../icons/menu/reload_32.a8")]),
    ("toggle", [include_bytes!("../icons/menu/toggle_16.a8"), include_bytes!("../icons/menu/toggle_20.a8"), include_bytes!("../icons/menu/toggle_24.a8"), include_bytes!("../icons/menu/toggle_32.a8")]),
    ("next", [include_bytes!("../icons/menu/next_16.a8"), include_bytes!("../icons/menu/next_20.a8"), include_bytes!("../icons/menu/next_24.a8"), include_bytes!("../icons/menu/next_32.a8")]),
    ("prev", [include_bytes!("../icons/menu/prev_16.a8"), include_bytes!("../icons/menu/prev_20.a8"), include_bytes!("../icons/menu/prev_24.a8"), include_bytes!("../icons/menu/prev_32.a8")]),
    ("quit", [include_bytes!("../icons/menu/quit_16.a8"), include_bytes!("../icons/menu/quit_20.a8"), include_bytes!("../icons/menu/quit_24.a8"), include_bytes!("../icons/menu/quit_32.a8")]),
];
const MENU_ICON_SIZES: [u32; 4] = [16, 20, 24, 32];

/// Светлая ли тема приложений Windows: меню трея рисуется в ней.
fn light_theme() -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let out = std::process::Command::new("reg")
            .args(["query", r"HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "/v", "AppsUseLightTheme"])
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .output();
        if let Ok(o) = out {
            return String::from_utf8_lossy(&o.stdout).contains("0x1");
        }
    }
    false
}

/// Иконка пункта меню под масштаб экрана и цвет текста меню.
fn menu_icon(name: &str, scale: f64, light: bool) -> Option<Image<'static>> {
    let (_, masks) = MENU_ICONS.iter().find(|(n, _)| *n == name)?;
    let want = (16.0 * scale).round() as u32;
    let i = MENU_ICON_SIZES.iter().position(|&s| s >= want).unwrap_or(MENU_ICON_SIZES.len() - 1);
    let size = MENU_ICON_SIZES[i];
    let (r, g, b) = if light { (0x2b, 0x2b, 0x2b) } else { (0xe6, 0xe6, 0xe6) };
    let rgba: Vec<u8> = masks[i].iter().flat_map(|&a| [r, g, b, a]).collect();
    Some(Image::new_owned(rgba, size, size))
}

fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let scale = app.primary_monitor().ok().flatten().map(|m| m.scale_factor()).unwrap_or(1.0);
    let light = light_theme();
    let item = |id: &str, text: &str, icon: &str| IconMenuItem::with_id(app, id, text, true, menu_icon(icon, scale, light), None::<&str>);
    let menu = Menu::with_items(
        app,
        &[
            &item("show", "Открыть Яндекс Музыку", "music")?,
            &item("tune", "Tune — темы и плагины", "tune")?,
            &item("restart", "Перезапустить Tune", "reload")?,
            &PredefinedMenuItem::separator(app)?,
            &item("toggle", "Пауза / продолжить", "toggle")?,
            &item("next", "Следующий трек", "next")?,
            &item("prev", "Предыдущий трек", "prev")?,
            &PredefinedMenuItem::separator(app)?,
            &item("quit", "Выход", "quit")?,
        ],
    )?;

    let mut tray = TrayIconBuilder::with_id("tray")
        .tooltip("Tune Music")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main(app),
            "tune" => {
                let _ = show_manager(app);
            }
            "restart" => restart_app(app),
            "toggle" => eval_client(app, "window.__tune&&window.__tune.player.toggle()"),
            "next" => eval_client(app, "window.__tune&&window.__tune.player.next()"),
            "prev" => eval_client(app, "window.__tune&&window.__tune.player.prev()"),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// Полный перезапуск: новый процесс с теми же ключами и `--tune-restart=<pid>`, затем выход.
/// Новый процесс ждёт, пока этот завершится, — иначе single-instance отдаст запуск старому.
fn restart_app(app: &AppHandle) {
    let Ok(exe) = std::env::current_exe() else { return };
    let mut args: Vec<String> = std::env::args().skip(1).filter(|a| !a.starts_with("--tune-restart")).collect();
    args.push(format!("--tune-restart={}", std::process::id()));
    if std::process::Command::new(exe).args(&args).spawn().is_ok() {
        app.exit(0);
    }
}

/// После перезапуска из трея: ждём выхода прежнего процесса (до 10 секунд).
fn wait_previous_instance() {
    let Some(pid) = std::env::args().find_map(|a| a.strip_prefix("--tune-restart=").and_then(|p| p.parse::<u32>().ok())) else { return };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let started = std::time::Instant::now();
        while started.elapsed() < std::time::Duration::from_secs(10) {
            let out = std::process::Command::new("tasklist")
                .args(["/FI", &format!("PID eq {pid}"), "/NH", "/FO", "CSV"])
                .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
                .output();
            match out {
                Ok(o) if String::from_utf8_lossy(&o.stdout).contains(&format!("\"{pid}\"")) => std::thread::sleep(std::time::Duration::from_millis(200)),
                _ => return,
            }
        }
    }
    #[cfg(not(windows))]
    let _ = pid;
}

/// Автозапуск с Windows: значение в HKCU\…\Run.
fn set_autostart(on: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const NO_WINDOW: u32 = 0x0800_0000;
        let key = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let mut cmd = std::process::Command::new("reg");
        if on {
            let value = format!("\"{}\" --minimized", exe.display());
            cmd.args(["add", key, "/v", "Tune Music", "/t", "REG_SZ", "/f", "/d", &value]);
        } else {
            cmd.args(["delete", key, "/v", "Tune Music", "/f"]);
        }
        let status = cmd.creation_flags(NO_WINDOW).status().map_err(|e| e.to_string())?;
        if on && !status.success() {
            return Err("Не удалось включить автозапуск".into());
        }
    }
    #[cfg(not(windows))]
    let _ = on;
    Ok(())
}

// ---------------------------------------------------------------------------
// Команды страницы Яндекс Музыки
// ---------------------------------------------------------------------------

#[tauri::command]
fn page_ready(window: WebviewWindow, state: State<AppState>, loaded: Option<bool>) {
    let hidden = window.label() == "main" && (!window.is_visible().unwrap_or(true) || window.is_minimized().unwrap_or(false));
    // Интерфейс Яндекса догрузился — окно в трее или свёрнуто, кадры больше не нужны.
    if loaded == Some(true) {
        if hidden {
            intercept::set_page_visible(&window, false);
        }
        return;
    }
    // Страница начала грузиться (запуск в трей, перезагрузка), а без кадров интерфейс
    // Яндекса не дорисуется и плеер не появится — до загрузки WebView2 видимый.
    if hidden {
        intercept::set_page_visible(&window, true);
    }
    push_payload(&window, &state);
}

#[tauri::command]
fn page_track(app: AppHandle, window: WebviewWindow, track: Option<discord::Track>, state: State<AppState>) {
    let title = match &track {
        Some(t) if state.settings().features.window_title && !t.title.is_empty() => {
            if t.artist.is_empty() { t.title.clone() } else { format!("{} — {}", t.artist, t.title) }
        }
        _ => "Tune Music".to_string(),
    };
    let _ = window.set_title(&title);
    state.discord.update(track.clone());
    media::update(&app, track);
}

/// Какие скрипты аддонов страница уже выполнила.
#[tauri::command]
fn page_scripts(app: AppHandle, ran: Vec<(String, String)>, state: State<AppState>) {
    state.page.lock().unwrap().ran = ran.into_iter().collect();
    notify_reload(&app);
}

// async обязателен: создание окна из синхронной команды на Windows блокирует главный поток.
#[tauri::command]
async fn open_manager(app: AppHandle) -> Result<(), String> {
    show_manager(&app).map_err(|e| e.to_string())
}

/// Кнопки окна из интерфейса Яндекса (musicDesktop.window) и на страницах входа.
#[tauri::command]
fn page_window(window: WebviewWindow, action: String) {
    let _ = match action.as_str() {
        "minimize" => window.minimize(),
        "maximize" if window.is_maximized().unwrap_or(false) => window.unmaximize(),
        "maximize" => window.maximize(),
        "close" => window.close(),
        _ => Ok(()),
    };
}

/// Cookie Яндекса, которые интерфейсу нужны для входа. Сессионные cookie
/// странице (и плагинам) не отдаются — только логин и yandexuid.
///
/// Только async: синхронная команда выполняется внутри обработчика запроса WebView2,
/// а cookies_for_url ждёт ответа от того же WebView2 — главный поток зависал навсегда
/// (интерфейс не догружался, вход и меню трея переставали работать).
#[tauri::command]
async fn page_cookie(window: WebviewWindow, name: String) -> Option<String> {
    if !matches!(name.as_str(), "yandex_login" | "yandexuid") {
        return None;
    }
    let url = "https://passport.yandex.ru/".parse().ok()?;
    window
        .cookies_for_url(url)
        .ok()?
        .into_iter()
        .find(|c| c.name() == name)
        .map(|c| c.value().to_string())
}

/// Кнопка «Скачать» в плеере: файл текущего трека в «Загрузки».
#[tauri::command]
fn page_download(app: AppHandle, url: String, key: Option<String>, codec: String, name: String, state: State<AppState>) -> Result<u64, String> {
    if !state.settings().features.download {
        return Err("Скачивание выключено в настройках Tune".into());
    }
    if !download::allowed_url(&url) {
        return Err("Ссылка не на хранилище Яндекса".into());
    }
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    let handle = app.clone();
    Ok(download::start(download::Job { url, key, codec, name }, dir, move |ev| {
        eval_client(&handle, &format!("window.dispatchEvent(new CustomEvent('tune:download',{{detail:{ev}}}))"));
    }))
}

/// Показывает скачанный файл в проводнике.
#[tauri::command]
fn page_reveal_download(id: u64) -> Result<(), String> {
    let path = download::saved(id).ok_or("Файл не найден")?;
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("explorer.exe")
            .raw_arg(format!("/select,\"{}\"", path.display()))
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Ok(())
    }
}

#[tauri::command]
fn client_status(state: State<AppState>) -> Value {
    let s = state.client.lock().unwrap().clone();
    json!({ "version": client::VERSION, "status": s })
}

#[tauri::command]
fn client_retry(app: AppHandle) {
    start_client_install(&app);
}

// ---------------------------------------------------------------------------
// Команды окна Tune
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Changed {
    id: String,
    reload: bool,
}

fn changed(app: &AppHandle, id: String) -> Changed {
    refresh_client(app);
    Changed { id, reload: app.state::<AppState>().reload_needed() }
}

#[tauri::command]
fn list_addons(state: State<AppState>) -> Vec<Addon> {
    state.addons.list(&state.settings().enabled_addons)
}

#[tauri::command]
fn set_addon_enabled(app: AppHandle, id: String, enabled: bool, state: State<AppState>) -> Result<Changed, String> {
    if !state.addons.exists(&id) {
        return Err("Аддон не найден".into());
    }
    state.update_settings(|s| s.set_enabled(&id, enabled))?;
    Ok(changed(&app, id))
}

#[tauri::command]
fn delete_addon(app: AppHandle, id: String, state: State<AppState>) -> Result<Changed, String> {
    state.addons.delete(&id)?;
    state.update_settings(|s| s.set_enabled(&id, false))?;
    Ok(changed(&app, id))
}

#[tauri::command]
fn addon_settings(id: String, state: State<AppState>) -> Result<Value, String> {
    let schema = state.addons.settings_schema(&id).ok_or("У аддона нет настроек")?;
    Ok(json!({ "schema": schema, "values": state.addons.settings_values(&id).unwrap_or_default() }))
}

fn push_addon_settings(app: &AppHandle, id: &str) {
    let state = app.state::<AppState>();
    let values = state.addons.settings_values(id).unwrap_or_default();
    eval_client(
        app,
        &format!("window.__tune&&window.__tune._settings({},{})", serde_json::to_string(id).unwrap(), Value::Object(values)),
    );
}

#[tauri::command]
fn set_addon_setting(app: AppHandle, id: String, key: String, value: Value, state: State<AppState>) -> Result<(), String> {
    state.addons.set_setting(&id, &key, value)?;
    push_addon_settings(&app, &id);
    Ok(())
}

#[tauri::command]
fn reset_addon_settings(app: AppHandle, id: String, state: State<AppState>) -> Result<(), String> {
    state.addons.reset_settings(&id)?;
    push_addon_settings(&app, &id);
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CatalogEntry {
    #[serde(flatten)]
    entry: repo::Entry,
    installed: Option<String>,
    update: bool,
}

#[tauri::command]
async fn catalog(app: AppHandle, force: bool) -> Result<Vec<CatalogEntry>, String> {
    let root = app.state::<AppState>().store.root().to_path_buf();
    let entries = tauri::async_runtime::spawn_blocking(move || repo::entries(&root, force))
        .await
        .map_err(|e| e.to_string())??;
    let state = app.state::<AppState>();
    let installed = state.addons.list(&[]);
    Ok(entries
        .into_iter()
        .map(|e| {
            let found = installed.iter().find(|a| a.origin.store_id == e.id);
            CatalogEntry {
                installed: found.map(|a| a.id.clone()),
                update: found.is_some_and(|a| !a.origin.sha.is_empty() && !e.sha.is_empty() && a.origin.sha != e.sha),
                entry: e,
            }
        })
        .collect())
}

fn install_download(app: &AppHandle, dl: repo::Download, name: &str, origin: Origin) -> Result<String, String> {
    let state = app.state::<AppState>();
    match dl {
        repo::Download::Dir(dir) => {
            let r = state.addons.install_dir(&dir, name, origin);
            let _ = std::fs::remove_dir_all(dir);
            r
        }
        repo::Download::Archive { name, data } => state.addons.install_bytes(&name, &data, origin),
    }
}

fn enable_new(app: &AppHandle, id: &str) -> Result<(), String> {
    app.state::<AppState>().update_settings(|s| s.set_enabled(id, true)).map(|_| ())
}

#[tauri::command]
async fn install_from_catalog(app: AppHandle, id: String) -> Result<Changed, String> {
    let root = app.state::<AppState>().store.root().to_path_buf();
    let a = app.clone();
    let new_id = tauri::async_runtime::spawn_blocking(move || {
        let entry = repo::find(&root, &id).ok_or("Аддона нет в каталоге — обновите список")?;
        let tmp = root.join("cache").join("download");
        let dl = repo::download(&entry, &tmp)?;
        let origin = Origin { source: "store".into(), store_id: entry.id.clone(), sha: entry.sha.clone() };
        install_download(&a, dl, &entry.name, origin)
    })
    .await
    .map_err(|e| e.to_string())??;
    enable_new(&app, &new_id)?;
    Ok(changed(&app, new_id))
}

/// Ссылка на репозиторий GitHub или прямая ссылка на архив/файл.
#[tauri::command]
async fn install_from_url(app: AppHandle, url: String) -> Result<Changed, String> {
    let url = url.trim().to_string();
    if !url.starts_with("https://") {
        return Err("Нужна ссылка https://".into());
    }
    let a = app.clone();
    let new_id = tauri::async_runtime::spawn_blocking(move || {
        let origin = Origin { source: "link".into(), store_id: url.clone(), sha: String::new() };
        let bare = url.split(['?', '#']).next().unwrap_or("").to_lowercase();
        let direct = [".zip", ".pext", ".tar.gz", ".tgz", ".css", ".js"].iter().any(|x| bare.ends_with(x));
        if direct {
            let data = repo::get_bytes(&url)?;
            let name = url.split(['?', '#']).next().unwrap_or(&url).rsplit('/').next().unwrap_or("addon").to_string();
            return a.state::<AppState>().addons.install_bytes(&name, &data, origin);
        }
        let repo_name = repo::parse_repo(&url).ok_or("Поддерживаются ссылки на репозиторий GitHub и на файлы .zip, .pext, .tar.gz, .css, .js")?;
        let dl = repo::github_package(&repo_name)?;
        install_download(&a, dl, repo_name.rsplit('/').next().unwrap_or("Addon"), origin)
    })
    .await
    .map_err(|e| e.to_string())??;
    enable_new(&app, &new_id)?;
    Ok(changed(&app, new_id))
}

#[derive(serde::Deserialize)]
struct UploadFile {
    path: String,
    data: String,
}

/// Файлы, выбранные в окне Tune: архив, .css/.js или папка целиком.
#[tauri::command]
fn install_upload(app: AppHandle, files: Vec<UploadFile>, state: State<AppState>) -> Result<Changed, String> {
    let b64 = base64::engine::general_purpose::STANDARD;
    let origin = Origin { source: "file".into(), ..Default::default() };
    let id = if files.len() == 1 && !files[0].path.contains('/') {
        let data = b64.decode(&files[0].data).map_err(|e| e.to_string())?;
        state.addons.install_bytes(&files[0].path, &data, origin)?
    } else {
        let tmp = state.store.root().join("cache").join("upload");
        let _ = std::fs::remove_dir_all(&tmp);
        for f in &files {
            let rel: Vec<&str> = f.path.split('/').filter(|p| !p.is_empty() && *p != "." && *p != "..").collect();
            if rel.is_empty() {
                continue;
            }
            let dst = rel.iter().fold(tmp.clone(), |p, s| p.join(s));
            if let Some(parent) = dst.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::write(&dst, b64.decode(&f.data).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        }
        // Выбирают саму папку аддона — её имя первое в путях.
        let top = files.first().and_then(|f| f.path.split('/').next()).unwrap_or("Addon").to_string();
        let src = tmp.join(&top);
        let r = state.addons.install_dir(if src.is_dir() { &src } else { &tmp }, &top, origin);
        let _ = std::fs::remove_dir_all(&tmp);
        r?
    };
    enable_new(&app, &id)?;
    Ok(changed(&app, id))
}

#[tauri::command]
fn create_addon(app: AppHandle, kind: Kind, name: String, state: State<AppState>) -> Result<Changed, String> {
    let name = if name.trim().is_empty() { "Без названия".to_string() } else { name.trim().to_string() };
    let id = state.addons.create(kind, &name)?;
    enable_new(&app, &id)?;
    Ok(changed(&app, id))
}

#[tauri::command]
fn read_addon_file(id: String, state: State<AppState>) -> Result<Value, String> {
    let path = state.addons.main_file(&id).ok_or("В аддоне нет .css или .js")?;
    let dir = state.addons.path(&id).ok_or("Аддон не найден")?;
    let rel = path.strip_prefix(&dir).unwrap_or(&path).to_string_lossy().replace('\\', "/");
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    Ok(json!({ "file": rel, "content": content }))
}

#[tauri::command]
fn write_addon_file(app: AppHandle, id: String, content: String, state: State<AppState>) -> Result<Changed, String> {
    let path = state.addons.main_file(&id).ok_or("В аддоне нет .css или .js")?;
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(changed(&app, id))
}

#[tauri::command]
fn open_folder(id: Option<String>, state: State<AppState>) -> Result<(), String> {
    let dir = match id.as_deref() {
        Some("data") => state.store.root().to_path_buf(),
        Some(id) => state.addons.path(id).ok_or("Аддон не найден")?,
        None => state.addons.dir().to_path_buf(),
    };
    // explorer.exe с путём в аргументе иногда отвечает «Файл недоступен» — открываем через оболочку.
    #[cfg(target_os = "windows")]
    unsafe {
        use windows::core::{w, HSTRING};
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let res = ShellExecuteW(None, w!("open"), &HSTRING::from(dir.as_os_str()), None, None, SW_SHOWNORMAL);
        return if res.0 as isize > 32 { Ok(()) } else { Err(format!("Не удалось открыть папку (код {})", res.0 as isize)) };
    }
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(all(unix, not(target_os = "macos")))]
    let program = "xdg-open";
    #[cfg(not(target_os = "windows"))]
    return std::process::Command::new(program).arg(dir).spawn().map(|_| ()).map_err(|e| e.to_string());
}

#[tauri::command]
fn open_link(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("Только ссылки https://".into());
    }
    open_external(&url);
    Ok(())
}

#[tauri::command]
fn reload_status(state: State<AppState>) -> bool {
    state.reload_needed()
}

#[tauri::command]
fn reload_client(app: AppHandle) {
    eval_client(&app, "location.reload()");
}

#[tauri::command]
fn show_client(app: AppHandle) {
    show_main(&app);
}

#[tauri::command]
fn get_settings(state: State<AppState>) -> Settings {
    state.settings()
}

#[tauri::command]
fn app_info(state: State<AppState>) -> Value {
    json!({
        "version": env!("CARGO_PKG_VERSION"),
        "client": client::VERSION,
        "dataDir": state.store.root().to_string_lossy(),
        "debug": debug_mode(),
    })
}

#[tauri::command]
fn set_settings(app: AppHandle, settings: Settings, state: State<AppState>) -> Result<(), String> {
    let before = state.settings();
    if settings.autostart != before.autostart {
        set_autostart(settings.autostart)?;
    }
    // Список включённых аддонов и идентификаторы устройства управляются отдельно.
    let s = state.update_settings(|s| {
        s.discord = settings.discord;
        s.features = settings.features;
        s.media_keys = settings.media_keys;
        s.close_to_tray = settings.close_to_tray;
        s.route_through_tune = settings.route_through_tune;
        s.autostart = settings.autostart;
        s.start_minimized = settings.start_minimized;
        s.zoom = settings.zoom.clamp(0.5, 2.0);
    })?;
    state.discord.configure(&s.discord);
    media::set_enabled(&app, s.media_keys);
    if let Some(win) = app.get_webview_window("main") {
        if (s.zoom - before.zoom).abs() > 0.001 {
            let _ = win.set_zoom(s.zoom);
        }
        if s.features != before.features {
            let features = serde_json::to_string(&s.features).unwrap_or_default();
            let _ = win.eval(format!("window.__tune&&window.__tune._features({features})"));
            if !s.features.window_title {
                let _ = win.set_title("Tune Music");
            }
        }
    }
    Ok(())
}

/// Имя и значок приложения для Windows: без них медиапанель и уведомления пишут
/// «Неизвестное приложение». Идентификатор совпадает с ярлыком установщика (identifier),
/// а для переносной версии имя и значок регистрируются в HKCU\Software\Classes\AppUserModelId.
#[cfg(windows)]
fn register_app_identity(root: &std::path::Path) {
    use std::os::windows::process::CommandExt;
    use windows::core::w;
    const AUMID: &str = "dev.tune.music";
    unsafe {
        let _ = windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID(w!("dev.tune.music"));
    }
    let icon = root.join("tune-music.png");
    let _ = std::fs::write(&icon, include_bytes!("../icons/128x128@2x.png"));
    let key = format!(r"HKCU\Software\Classes\AppUserModelId\{AUMID}");
    for (name, value) in [("DisplayName", "Tune Music".to_string()), ("IconUri", icon.to_string_lossy().to_string())] {
        let _ = std::process::Command::new("reg")
            .args(["add", &key, "/v", name, "/t", "REG_EXPAND_SZ", "/d", &value, "/f"])
            .creation_flags(0x0800_0000)
            .status();
    }
    if let Err(e) = start_menu_shortcut(AUMID) {
        eprintln!("tune: ярлык в меню «Пуск» не создан: {e}");
    }
}

/// Медиапанель Windows берёт имя и значок обычного (не магазинного) приложения из ярлыка
/// в меню «Пуск» с тем же AppUserModelID — так же устроены Chrome и Spotify. Установщик
/// создаёт такой ярлык сам; для переносной версии его создаёт Tune.
#[cfg(windows)]
fn start_menu_shortcut(aumid: &str) -> windows::core::Result<()> {
    use windows::core::{Interface, HSTRING};
    use windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_ID;
    use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

    let exe = std::env::current_exe().map_err(|e| windows::core::Error::new(windows::core::HRESULT(-1), e.to_string()))?;
    let Ok(appdata) = std::env::var("APPDATA") else { return Ok(()) };
    let dir = std::path::Path::new(&appdata).join(r"Microsoft\Windows\Start Menu\Programs");
    let lnk = dir.join("Tune Music.lnk");
    unsafe {
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
        link.SetPath(&HSTRING::from(exe.as_os_str()))?;
        if let Some(parent) = exe.parent() {
            link.SetWorkingDirectory(&HSTRING::from(parent.as_os_str()))?;
        }
        link.SetIconLocation(&HSTRING::from(exe.as_os_str()), 0)?;
        link.SetDescription(&HSTRING::from("Tune Music"))?;
        let store: IPropertyStore = link.cast()?;
        store.SetValue(&PKEY_AppUserModel_ID, &PROPVARIANT::from(aumid))?;
        store.Commit()?;
        let file: IPersistFile = link.cast()?;
        file.Save(&HSTRING::from(lnk.as_os_str()), true)?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn register_app_identity(_root: &std::path::Path) {}

/// Случайные идентификаторы устройства в формате официального клиента:
/// UUID v4 и 64 hex-символа.
fn new_device_ids() -> (String, String) {
    use sha2::{Digest, Sha256};
    let local = 0u8;
    let seed = format!("{:?}{}{:p}", std::time::SystemTime::now(), std::process::id(), &local);
    let a = Sha256::digest(format!("uuid{seed}").as_bytes());
    let b = Sha256::digest(format!("device{seed}").as_bytes());
    let mut u = [0u8; 16];
    u.copy_from_slice(&a[..16]);
    u[6] = (u[6] & 0x0f) | 0x40;
    u[8] = (u[8] & 0x3f) | 0x80;
    let hex = |bytes: &[u8]| bytes.iter().map(|x| format!("{x:02x}")).collect::<String>();
    let h = hex(&u);
    let uuid = format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..32]);
    (uuid, hex(&b))
}

/// Картинки аддонов для окна Tune: http://tuneaddon.localhost/<аддон>/<файл>.
fn addon_file_protocol(app: &AppHandle, uri: &str) -> tauri::http::Response<Vec<u8>> {
    let not_found = || tauri::http::Response::builder().status(404).body(Vec::new()).unwrap();
    let path = uri.split("://").nth(1).and_then(|r| r.split_once('/')).map(|(_, p)| p).unwrap_or("");
    let path = path.split(['?', '#']).next().unwrap_or("");
    let Some(path) = asar::percent_decode(path) else { return not_found() };
    let Some((id, rel)) = path.split_once('/') else { return not_found() };
    let state = app.state::<AppState>();
    let Some(dir) = state.addons.path(id) else { return not_found() };
    let file = rel.split('/').filter(|p| !p.is_empty() && *p != "..").fold(dir.clone(), |p, s| p.join(s));
    match std::fs::read(&file) {
        Ok(body) if file.starts_with(&dir) => tauri::http::Response::builder()
            .header("Content-Type", asar::mime(&file.to_string_lossy()))
            .body(body)
            .unwrap(),
        _ => not_found(),
    }
}

fn main() {
    wait_previous_instance();
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .register_uri_scheme_protocol("tuneaddon", |ctx, req| addon_file_protocol(ctx.app_handle(), &req.uri().to_string()))
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            let store = Store::new(root)?;
            register_app_identity(store.root());
            let addons = Addons::new(store.root())?;
            addons.migrate_legacy(store.root());
            let mut settings = store.load_settings();
            if settings.device_uuid.is_empty() || settings.device_id.is_empty() {
                let (uuid, id) = new_device_ids();
                settings.device_uuid = uuid;
                settings.device_id = id;
            }
            let _ = store.save_settings(&settings);
            let client_state = if client::is_installed(store.root()) {
                ClientState::Ready
            } else {
                ClientState::Installing { progress: None }
            };
            let discord = discord::spawn();
            discord.configure(&settings.discord);
            let media_keys = settings.media_keys;
            let hidden = std::env::args().any(|a| a == "--minimized") || settings.start_minimized;
            init_browser_args(settings.route_through_tune);
            app.manage(AppState {
                store,
                addons,
                settings: Mutex::new(settings),
                discord,
                client: Mutex::new(client_state.clone()),
                page: Mutex::new(PageState::default()),
            });

            let handle = app.handle();
            // Первый запуск (интерфейс ещё качается) показываем всегда.
            create_main(handle, !hidden || !matches!(client_state, ClientState::Ready))?;
            if !matches!(client_state, ClientState::Ready) {
                start_client_install(handle);
            }
            create_tray(handle)?;
            media::set_enabled(handle, media_keys);
            mixer::spawn();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            page_ready,
            page_track,
            page_scripts,
            open_manager,
            page_window,
            page_cookie,
            page_download,
            page_reveal_download,
            client_status,
            client_retry,
            list_addons,
            set_addon_enabled,
            delete_addon,
            addon_settings,
            set_addon_setting,
            reset_addon_settings,
            catalog,
            install_from_catalog,
            install_from_url,
            install_upload,
            create_addon,
            read_addon_file,
            write_addon_file,
            open_folder,
            open_link,
            reload_status,
            reload_client,
            show_client,
            get_settings,
            app_info,
            set_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tune Music");
}
