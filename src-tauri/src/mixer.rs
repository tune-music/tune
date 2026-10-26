//! Имя и значок Tune в микшере громкости Windows.
//!
//! Звук играет не tune-music.exe, а служебный процесс WebView2 (msedgewebview2.exe),
//! поэтому микшер подписывал его «Microsoft Edge WebView2». Tune находит звуковые
//! сессии своих дочерних процессов и задаёт им своё имя и значок.

#[cfg(windows)]
mod imp {
    use std::collections::{HashMap, HashSet};
    use std::time::Duration;

    use windows::core::{Interface, GUID, HSTRING};
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::Media::Audio::{
        eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
    use windows::Win32::System::Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS};

    const NAME: &str = "Tune Music";

    /// Процессы, запущенные Tune (на любой глубине), включая сам Tune.
    fn own_processes(root: u32) -> HashSet<u32> {
        let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
        unsafe {
            let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return HashSet::from([root]) };
            let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
            if Process32FirstW(snap, &mut e).is_ok() {
                loop {
                    children.entry(e.th32ParentProcessID).or_default().push(e.th32ProcessID);
                    if Process32NextW(snap, &mut e).is_err() {
                        break;
                    }
                }
            }
            let _ = CloseHandle(snap);
        }
        let mut out = HashSet::from([root]);
        let mut stack = vec![root];
        while let Some(p) = stack.pop() {
            for &c in children.get(&p).into_iter().flatten() {
                if c != p && out.insert(c) {
                    stack.push(c);
                }
            }
        }
        out
    }

    /// Подписывает звуковые сессии процессов Tune на всех устройствах вывода.
    /// Возвращает, сколько сессий переименовано.
    pub fn label_sessions() -> windows::core::Result<usize> {
        label_sessions_of(std::process::id())
    }

    pub fn label_sessions_of(root: u32) -> windows::core::Result<usize> {
        let own = own_processes(root);
        let icon = std::env::current_exe().map(|p| format!("{},0", p.display())).unwrap_or_default();
        let mut done = 0;
        unsafe {
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let devices = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)?;
            for i in 0..devices.GetCount()? {
                let Ok(device) = devices.Item(i) else { continue };
                let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else { continue };
                let Ok(sessions) = manager.GetSessionEnumerator() else { continue };
                for j in 0..sessions.GetCount().unwrap_or(0) {
                    let Ok(control) = sessions.GetSession(j) else { continue };
                    let Ok(control) = control.cast::<IAudioSessionControl2>() else { continue };
                    let Ok(pid) = control.GetProcessId() else { continue };
                    if pid == 0 || !own.contains(&pid) {
                        continue;
                    }
                    let current = control.GetDisplayName().ok().map(|s| s.to_string().unwrap_or_default()).unwrap_or_default();
                    if current != NAME {
                        control.SetDisplayName(&HSTRING::from(NAME), &GUID::zeroed())?;
                        if !icon.is_empty() {
                            let _ = control.SetIconPath(&HSTRING::from(icon.as_str()), &GUID::zeroed());
                        }
                        done += 1;
                    }
                }
            }
        }
        Ok(done)
    }

    /// Фоновый поток: сессия появляется, когда начинается звук, и пересоздаётся
    /// при смене устройства — проверяем раз в несколько секунд.
    pub fn spawn() {
        let _ = std::thread::Builder::new().name("mixer-label".into()).spawn(|| {
            unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            }
            loop {
                let _ = label_sessions();
                std::thread::sleep(Duration::from_secs(4));
            }
        });
    }
}

#[cfg(windows)]
pub use imp::spawn;

#[cfg(not(windows))]
pub fn spawn() {}

#[cfg(all(test, windows))]
mod tests {
    #[test]
    fn enumerates_sessions() {
        unsafe {
            let _ = windows::Win32::System::Com::CoInitializeEx(None, windows::Win32::System::Com::COINIT_MULTITHREADED);
        }
        // У тестового процесса своих звуковых сессий нет — главное, что перебор не падает.
        assert!(super::imp::label_sessions().is_ok());
    }

    /// Ручная проверка на запущенном Tune: TUNE_PID=<pid> cargo test label_running -- --ignored
    #[test]
    #[ignore]
    fn label_running() {
        unsafe {
            let _ = windows::Win32::System::Com::CoInitializeEx(None, windows::Win32::System::Com::COINIT_MULTITHREADED);
        }
        let pid: u32 = std::env::var("TUNE_PID").unwrap().parse().unwrap();
        println!("LABELED={}", super::imp::label_sessions_of(pid).unwrap());
    }
}
