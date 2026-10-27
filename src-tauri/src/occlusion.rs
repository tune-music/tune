//! Окно Tune целиком закрыто другими окнами — WebView2 перестаёт рисовать, как при
//! сворачивании. Обычный Chrome это умеет сам, а WebView2 в чужом окне — нет.
//!
//! Поток подписывается на события окон Windows (перемещение, показ, скрытие, смена
//! активного окна) и пересчитывает, осталась ли от окна Tune видимая часть. Прозрачные
//! окна (оверлеи, тени) и окна других рабочих столов закрывающими не считаются: лучше
//! лишний раз рисовать, чем спрятать то, что видно.

#[cfg(windows)]
mod imp {
    use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
    use std::time::{Duration, Instant};

    use tauri::{AppHandle, Manager};
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
    use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
    use windows::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, GetForegroundWindow, GetMessageW, GetSystemMetrics, GetWindow, GetWindowLongW, GetWindowRect, IsIconic,
        IsWindow, IsWindowVisible, SetTimer, GWL_EXSTYLE, GW_HWNDPREV, MSG, SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_XVIRTUALSCREEN,
        SM_YVIRTUALSCREEN, WINEVENT_OUTOFCONTEXT, WS_EX_LAYERED, WS_EX_TRANSPARENT,
    };

    /// Окно Tune, за которым следим.
    static MAIN: AtomicIsize = AtomicIsize::new(0);
    /// Страница догрузилась — без кадров интерфейс Яндекса не дорисуется, до этого не прячем.
    static LOADED: AtomicBool = AtomicBool::new(false);
    /// Страницу спрятали мы, потому что окно закрыто.
    static HIDDEN: AtomicBool = AtomicBool::new(false);
    /// Что-то в раскладке окон поменялось — пересчитать.
    static DIRTY: AtomicBool = AtomicBool::new(true);
    static STARTED: AtomicBool = AtomicBool::new(false);

    /// Закрыто дольше этого — прячем (Alt+Tab и пролетающие окна не в счёт).
    const HIDE_AFTER: Duration = Duration::from_millis(1500);

    pub fn watch(app: &AppHandle, hwnd: isize) {
        MAIN.store(hwnd, Ordering::Relaxed);
        DIRTY.store(true, Ordering::Relaxed);
        if STARTED.swap(true, Ordering::Relaxed) {
            return;
        }
        let app = app.clone();
        let _ = std::thread::Builder::new().name("occlusion".into()).spawn(move || run(app));
    }

    pub fn set_loaded(loaded: bool) {
        LOADED.store(loaded, Ordering::Relaxed);
        DIRTY.store(true, Ordering::Relaxed);
    }

    /// Видимость страницы решили явно (свернули, трей, показали) — наше решение больше не действует.
    pub fn forget() {
        HIDDEN.store(false, Ordering::Relaxed);
        DIRTY.store(true, Ordering::Relaxed);
    }

    pub fn hidden() -> bool {
        HIDDEN.load(Ordering::Relaxed)
    }

    unsafe extern "system" fn on_event(_: HWINEVENTHOOK, _event: u32, _hwnd: HWND, id_object: i32, id_child: i32, _: u32, _: u32) {
        // Только сами окна: курсор, каретка и элементы внутри окон шлют те же события.
        if id_object == 0 && id_child == 0 {
            DIRTY.store(true, Ordering::Relaxed);
        }
    }

    fn run(app: AppHandle) {
        unsafe {
            // Свои окна тоже: перетащили или активировали само окно Tune.
            let flags = WINEVENT_OUTOFCONTEXT;
            // EVENT_SYSTEM_FOREGROUND … EVENT_SYSTEM_MINIMIZEEND и EVENT_OBJECT_CREATE … EVENT_OBJECT_UNCLOAKED.
            let _ = SetWinEventHook(0x0003, 0x0017, None, Some(on_event), 0, 0, flags);
            let _ = SetWinEventHook(0x8000, 0x8018, None, Some(on_event), 0, 0, flags);
            SetTimer(None, 0, 100, None);
            let mut covered_since: Option<Instant> = None;
            let mut checked = Instant::now();
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                DispatchMessageW(&msg);
                // Пока окно закрыто, ждём, когда оно продержится закрытым HIDE_AFTER; заодно
                // раз в пару секунд проверяем без событий — на случай пропущенного.
                let pending = covered_since.is_some() && !HIDDEN.load(Ordering::Relaxed);
                if !DIRTY.swap(false, Ordering::Relaxed) && !pending && checked.elapsed() < Duration::from_secs(2) {
                    continue;
                }
                checked = Instant::now();
                let hwnd = HWND(MAIN.load(Ordering::Relaxed) as *mut _);
                match covered(hwnd) {
                    // Свёрнуто или в трее — этим занимается main.rs.
                    None => {
                        HIDDEN.store(false, Ordering::Relaxed);
                        covered_since = None;
                    }
                    Some(true) => {
                        let since = *covered_since.get_or_insert_with(Instant::now);
                        if !HIDDEN.load(Ordering::Relaxed) && LOADED.load(Ordering::Relaxed) && since.elapsed() >= HIDE_AFTER {
                            HIDDEN.store(true, Ordering::Relaxed);
                            draw(&app, false);
                        }
                    }
                    Some(false) => {
                        covered_since = None;
                        if HIDDEN.swap(false, Ordering::Relaxed) {
                            draw(&app, true);
                        }
                    }
                }
            }
        }
    }

    fn draw(app: &AppHandle, on: bool) {
        if let Some(w) = app.get_webview_window("main") {
            crate::intercept::set_drawing(&w, on);
        }
    }

    /// Закрыто ли окно целиком; None — окна не видно и без того (свёрнуто, скрыто).
    unsafe fn covered(hwnd: HWND) -> Option<bool> {
        unsafe {
            if hwnd.is_invalid() || !IsWindow(Some(hwnd)).as_bool() || !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
                return None;
            }
            if GetForegroundWindow() == hwnd {
                return Some(false);
            }
            let screen = RECT {
                left: GetSystemMetrics(SM_XVIRTUALSCREEN),
                top: GetSystemMetrics(SM_YVIRTUALSCREEN),
                right: GetSystemMetrics(SM_XVIRTUALSCREEN) + GetSystemMetrics(SM_CXVIRTUALSCREEN),
                bottom: GetSystemMetrics(SM_YVIRTUALSCREEN) + GetSystemMetrics(SM_CYVIRTUALSCREEN),
            };
            let Some(own) = bounds(hwnd).and_then(|r| intersect(r, screen)) else { return Some(false) };
            let mut open = vec![own];
            let mut w = GetWindow(hwnd, GW_HWNDPREV);
            let mut steps = 0;
            while let Ok(above) = w {
                if above.is_invalid() || open.is_empty() || steps > 1000 {
                    break;
                }
                steps += 1;
                if let Some(r) = opaque_bounds(above) {
                    open = open.into_iter().flat_map(|o| subtract(o, r)).collect();
                    // Слишком мелкая нарезка — считаем окно видимым.
                    if open.len() > 256 {
                        return Some(false);
                    }
                }
                w = GetWindow(above, GW_HWNDPREV);
            }
            Some(open.is_empty())
        }
    }

    /// Границы окна, которое точно что-то закрывает: видимое, не свёрнутое, не на
    /// другом рабочем столе и не прозрачное.
    unsafe fn opaque_bounds(hwnd: HWND) -> Option<RECT> {
        unsafe {
            if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
                return None;
            }
            let ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
            if ex & (WS_EX_LAYERED.0 | WS_EX_TRANSPARENT.0) != 0 {
                return None;
            }
            let mut cloaked = 0u32;
            let ok = DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut _, 4).is_ok();
            if !ok || cloaked != 0 {
                return None;
            }
            bounds(hwnd)
        }
    }

    /// Видимые границы окна, без невидимой рамки для растягивания.
    unsafe fn bounds(hwnd: HWND) -> Option<RECT> {
        unsafe {
            let mut r = RECT::default();
            if DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &mut r as *mut RECT as *mut _, std::mem::size_of::<RECT>() as u32).is_err() {
                GetWindowRect(hwnd, &mut r).ok()?;
            }
            (r.right > r.left && r.bottom > r.top).then_some(r)
        }
    }

    fn intersect(a: RECT, b: RECT) -> Option<RECT> {
        let r = RECT { left: a.left.max(b.left), top: a.top.max(b.top), right: a.right.min(b.right), bottom: a.bottom.min(b.bottom) };
        (r.right > r.left && r.bottom > r.top).then_some(r)
    }

    /// a минус b: до четырёх прямоугольников.
    pub(super) fn subtract(a: RECT, b: RECT) -> Vec<RECT> {
        let Some(c) = intersect(a, b) else { return vec![a] };
        let mut out = Vec::with_capacity(4);
        if c.top > a.top {
            out.push(RECT { bottom: c.top, ..a });
        }
        if c.bottom < a.bottom {
            out.push(RECT { top: c.bottom, ..a });
        }
        if c.left > a.left {
            out.push(RECT { left: a.left, right: c.left, top: c.top, bottom: c.bottom });
        }
        if c.right < a.right {
            out.push(RECT { left: c.right, right: a.right, top: c.top, bottom: c.bottom });
        }
        out
    }
}

#[cfg(windows)]
pub use imp::{forget, hidden, set_loaded, watch};

#[cfg(not(windows))]
pub fn watch(_app: &tauri::AppHandle, _hwnd: isize) {}
#[cfg(not(windows))]
pub fn set_loaded(_loaded: bool) {}
#[cfg(not(windows))]
pub fn forget() {}
#[cfg(not(windows))]
pub fn hidden() -> bool {
    false
}

#[cfg(all(test, windows))]
mod tests {
    use windows::Win32::Foundation::RECT;

    fn area(v: &[RECT]) -> i32 {
        v.iter().map(|r| (r.right - r.left) * (r.bottom - r.top)).sum()
    }

    #[test]
    fn subtract_cuts_out_overlap() {
        let a = RECT { left: 0, top: 0, right: 100, bottom: 100 };
        assert_eq!(area(&super::imp::subtract(a, RECT { left: 25, top: 25, right: 75, bottom: 75 })), 10000 - 2500);
        assert!(super::imp::subtract(a, RECT { left: -10, top: -10, right: 110, bottom: 110 }).is_empty());
        assert_eq!(area(&super::imp::subtract(a, RECT { left: 200, top: 0, right: 300, bottom: 100 })), 10000);
        assert_eq!(area(&super::imp::subtract(a, RECT { left: 50, top: -10, right: 150, bottom: 110 })), 5000);
    }
}
