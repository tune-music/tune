//! Подмена music.yandex.ru локальным интерфейсом.
//!
//! Запросы главного окна к https://music.yandex.ru/* перехватываются в WebView2
//! и обслуживаются из app.asar. Для движка страница остаётся на настоящем
//! адресе music.yandex.ru, поэтому API Яндекса, cookie и вход работают как у
//! официального клиента, а сервер сайта с гео-заглушкой не участвует.
//!
//! Здесь же — «сервер» ассетов аддонов на http://127.0.0.1:2007 (адрес, который
//! зашит в темах PulseSync и Next Music). Настоящий порт не открывается: запросы
//! к нему тоже перехватываются, поэтому Tune не конфликтует с запущенными модами.

use std::sync::Arc;

use crate::asar::{Asar, Served};

pub const ORIGIN: &str = "https://music.yandex.ru";
const ADDON_HOSTS: &[&str] = &["http://127.0.0.1:2007", "http://localhost:2007"];

/// Динамические части ответов.
pub struct Hooks {
    /// Скрипт, который встаёт первым в <head>: переопределения флагов интерфейса.
    pub head_script: Box<dyn Fn() -> String + Send + Sync>,
    /// Ответ сервера ассетов: (путь, строка запроса).
    pub addon_server: Box<dyn Fn(&str, &str) -> Served + Send + Sync>,
}

/// Правки кода интерфейса: флаги-эксперименты читаются через window.__tuneExp, чтобы
/// темы могли включать, например, классическую главную (experiments.override).
const JS_PATCHES: &[(&str, &str)] = &[
    (
        "getExperiment(a){var i;let l=e.experiments[a],",
        "getExperiment(a){var i;let l=window.__tuneExp?window.__tuneExp(e.experiments,a):e.experiments[a],",
    ),
    (
        "checkExperiment(t,a){let i=e.experiments[t],",
        "checkExperiment(t,a){let i=window.__tuneExp?window.__tuneExp(e.experiments,t):e.experiments[t],",
    ),
    // Второй экран загрузки (MainSuspenseLoader) — блок без класса со звездой Яндекса.
    // Класс нужен, чтобы SPLASH_CSS показал на нём ту же заставку Tune.
    (
        "zIndex:\"var(--ym-z-index-loader)\",alignItems:\"center\",justifyContent:\"center\",overflow:\"hidden\",background:\"var(--ym-background-color-primary-enabled-basic)\",...t};return(0,i.jsx)(\"div\",{style:a,children:",
        "zIndex:\"var(--ym-z-index-loader)\",alignItems:\"center\",justifyContent:\"center\",overflow:\"hidden\",background:\"var(--ym-background-color-primary-enabled-basic)\",...t};return(0,i.jsx)(\"div\",{style:a,className:\"tune-main-loader\",children:",
    ),
];

fn patch_js(body: Vec<u8>) -> Vec<u8> {
    let Ok(mut text) = String::from_utf8(body) else { return Vec::new() };
    for (from, to) in JS_PATCHES {
        if text.contains(from) {
            text = text.replacen(from, to, 1);
        }
    }
    text.into_bytes()
}

/// Заставка загрузки Tune вместо экранов Яндекса: видео первой заставки и звезда второго
/// экрана (tune-main-loader) скрыты, поверх — логотип и полоса загрузки. Элементы те же,
/// что у интерфейса, поэтому исчезают сами, когда музыка готова. На втором экране логотип
/// не анимируется заново — две заставки выглядят как одна.
/// Здесь же скрыта кнопка «Что нового» с версией клиента: клиент обновляется вместе с Tune.
const SPLASH_CSS: &str = r#"
[class*="SplashScreen_video"],.tune-main-loader>*{opacity:0!important}
[data-test-id="RELEASE_NOTES_BUTTON"]{display:none!important}
[class*="SplashScreen_root"],.tune-main-loader{background:var(--ym-background-color-primary-enabled-basic,#000)!important}
[class*="SplashScreen_root_light"]{background:#fff!important}
[class*="SplashScreen_root"]::before,.tune-main-loader::before{content:"";position:absolute;left:50%;top:50%;width:260px;height:150px;transform:translate(-50%,-62%);
background:no-repeat center/contain url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 260 150'%3E%3Cg transform='translate(98 6) scale(2.6)' fill='none' stroke='%23facc15' stroke-width='2.2' stroke-linecap='round'%3E%3Cpath d='M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6'/%3E%3C/g%3E%3Ctext x='130' y='132' text-anchor='middle' font-family='Segoe UI Variable Display,Segoe UI,sans-serif' font-size='30' font-weight='600' fill='%23fafafa' letter-spacing='.5'%3ETune Music%3C/text%3E%3C/svg%3E");
animation:tune-splash-in .5s ease-out both}
.tune-main-loader::before{animation:none}
[class*="SplashScreen_root_light"]::before,.ym-light-theme .tune-main-loader::before{filter:invert(1) hue-rotate(180deg)}
[class*="SplashScreen_root"]::after,.tune-main-loader::after{content:"";position:absolute;left:50%;top:50%;width:180px;height:3px;margin:72px 0 0 -90px;border-radius:2px;
background:rgba(127,127,127,.22) linear-gradient(90deg,transparent,#facc15,transparent) no-repeat;background-size:40% 100%;
animation:tune-splash-bar 1.1s ease-in-out infinite}
@keyframes tune-splash-bar{from{background-position:-80% 0}to{background-position:180% 0}}
@keyframes tune-splash-in{from{opacity:0;transform:translate(-50%,-56%)}to{opacity:1;transform:translate(-50%,-62%)}}
"#;

fn patch_html(body: Vec<u8>, script: &str) -> Vec<u8> {
    let Ok(text) = String::from_utf8(body) else { return Vec::new() };
    match text.find("<head>") {
        Some(i) => {
            let at = i + "<head>".len();
            format!("{}<script>{}</script><style id=\"tune-splash\">{}</style>{}", &text[..at], script, SPLASH_CSS, &text[at..]).into_bytes()
        }
        None => text.into_bytes(),
    }
}

fn serve_page(asar: &Asar, hooks: &Hooks, path: &str) -> Served {
    let mut served = asar.serve(path);
    if served.status == 200 {
        if served.mime.starts_with("text/html") {
            served.body = patch_html(std::mem::take(&mut served.body), &(hooks.head_script)());
        } else if served.mime.starts_with("text/javascript") && path.starts_with("/_next/static/chunks/") {
            let original = served.body.clone();
            let patched = patch_js(std::mem::take(&mut served.body));
            served.body = if patched.is_empty() { original } else { patched };
        }
    }
    served
}

/// Включает перехват и сразу после этого открывает интерфейс. Переход делается в том же
/// вызове, иначе первый запрос мог бы уйти на настоящий сервер раньше, чем включится перехват.
#[cfg(windows)]
pub fn install(win: &tauri::WebviewWindow, asar: Arc<Asar>, hooks: Hooks) -> tauri::Result<()> {
    use std::fmt::Write;
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::{take_pwstr, WebResourceRequestedEventHandler};
    use windows::core::{Interface, HSTRING, PWSTR};
    use windows::Win32::UI::Shell::SHCreateMemStream;

    win.with_webview(move |pw| unsafe {
        let result = (|| -> windows::core::Result<()> {
            let core = pw.controller().CoreWebView2()?;
            let env = pw.environment();
            let mut filters = vec![format!("{ORIGIN}/*")];
            filters.extend(ADDON_HOSTS.iter().map(|h| format!("{h}/*")));
            for f in filters {
                let filter = HSTRING::from(f);
                match core.cast::<ICoreWebView2_22>() {
                    // Новый API ловит и запросы service worker'ов.
                    Ok(core22) => core22.AddWebResourceRequestedFilterWithRequestSourceKinds(
                        &filter,
                        COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL,
                        COREWEBVIEW2_WEB_RESOURCE_REQUEST_SOURCE_KINDS_ALL,
                    )?,
                    Err(_) => core.AddWebResourceRequestedFilter(&filter, COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL)?,
                }
            }

            let handler = WebResourceRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let uri = {
                    let mut uri = PWSTR::null();
                    args.Request()?.Uri(&mut uri)?;
                    take_pwstr(uri)
                };
                let (served, cors) = if let Some(rest) = uri.strip_prefix(ORIGIN) {
                    let path = rest.split(['?', '#']).next().unwrap_or("/");
                    let path = if path.is_empty() { "/" } else { path };
                    (serve_page(&asar, &hooks, path), false)
                } else if let Some(rest) = ADDON_HOSTS.iter().find_map(|h| uri.strip_prefix(h)) {
                    let rest = rest.split('#').next().unwrap_or("");
                    let (path, query) = rest.split_once('?').unwrap_or((rest, ""));
                    ((hooks.addon_server)(if path.is_empty() { "/" } else { path }, query), true)
                } else {
                    return Ok(());
                };

                let mut headers = String::new();
                let _ = writeln!(headers, "Content-Type: {}", served.mime);
                let _ = writeln!(headers, "Cache-Control: no-cache");
                if cors {
                    let _ = writeln!(headers, "Access-Control-Allow-Origin: *");
                }
                let status = HSTRING::from(match served.status {
                    200 => "OK",
                    400 => "Bad Request",
                    _ => "Not Found",
                });
                let stream = (!served.body.is_empty()).then(|| SHCreateMemStream(Some(&served.body))).flatten();
                let response = env.CreateWebResourceResponse(
                    stream.as_ref(),
                    served.status as i32,
                    &status,
                    &HSTRING::from(headers),
                )?;
                args.SetResponse(&response)?;
                Ok(())
            }));
            let mut token = Default::default();
            core.add_WebResourceRequested(&handler, &mut token)?;
            core.Navigate(&HSTRING::from(format!("{ORIGIN}/")))?;
            Ok(())
        })();
        if let Err(e) = result {
            eprintln!("tune: не удалось включить локальный интерфейс: {e}");
        }
    })
}

#[cfg(not(windows))]
pub fn install(_win: &tauri::WebviewWindow, _asar: Arc<Asar>, _hooks: Hooks) -> tauri::Result<()> {
    Err(tauri::Error::WebviewNotFound)
}

/// Окно ведёт себя как приложение, а не как браузер: без контекстного меню браузера
/// (собственные меню Яндекса работают — это обработчики страницы), без строки статуса
/// со ссылками и без браузерных сочетаний вроде Ctrl+P, Ctrl+F, F5. В отладочном
/// режиме сочетания остаются — для F12.
#[cfg(windows)]
pub fn app_like(win: &tauri::WebviewWindow, keep_accelerators: bool) {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use windows::core::Interface;
    let _ = win.with_webview(move |pw| unsafe {
        let Ok(core) = pw.controller().CoreWebView2() else { return };
        let Ok(settings) = core.Settings() else { return };
        let _ = settings.SetAreDefaultContextMenusEnabled(false);
        let _ = settings.SetIsStatusBarEnabled(false);
        if !keep_accelerators {
            if let Ok(s3) = settings.cast::<ICoreWebView2Settings3>() {
                let _ = s3.SetAreBrowserAcceleratorKeysEnabled(false);
            }
        }
    });
}

#[cfg(not(windows))]
pub fn app_like(_win: &tauri::WebviewWindow, _keep_accelerators: bool) {}

/// Окно свёрнуто или спрятано в трей. Само окно WebView2 об этом не узнаёт и рисует
/// страницу дальше с частотой монитора — рендерер и GPU по пол-ядра. Скрытый WebView2 кадры
/// не готовит, а музыка в нём играет как прежде. Заодно просим его отдать лишнюю память.
#[cfg(windows)]
pub fn set_page_visible(win: &tauri::WebviewWindow, visible: bool) {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use windows::core::Interface;
    crate::occlusion::forget();
    set_drawing(win, visible);
    let _ = win.with_webview(move |pw| unsafe {
        let Ok(core) = pw.controller().CoreWebView2() else { return };
        if let Ok(c19) = core.cast::<ICoreWebView2_19>() {
            let level = if visible { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW };
            let _ = c19.SetMemoryUsageTargetLevel(level);
        }
    });
}

/// Только рисование, без памяти: окно закрыто другими и может открыться в любой момент.
#[cfg(windows)]
pub fn set_drawing(win: &tauri::WebviewWindow, on: bool) {
    let _ = win.with_webview(move |pw| unsafe {
        let _ = pw.controller().SetIsVisible(on);
    });
}

#[cfg(not(windows))]
pub fn set_drawing(_win: &tauri::WebviewWindow, _on: bool) {}

#[cfg(not(windows))]
pub fn set_page_visible(_win: &tauri::WebviewWindow, _visible: bool) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn patches_experiments() {
        let src = b"x={getExperiment(a){var i;let l=e.experiments[a],r=1}}".to_vec();
        let out = String::from_utf8(patch_js(src)).unwrap();
        assert!(out.contains("window.__tuneExp(e.experiments,a)"));
    }

    #[test]
    fn injects_head_script() {
        let out = String::from_utf8(patch_html(b"<html><head><meta/></head>".to_vec(), "X=1")).unwrap();
        assert!(out.starts_with("<html><head><script>X=1</script><style id=\"tune-splash\">"));
        assert!(out.ends_with("</style><meta/></head>"));
    }
}
