//! Имя и значок Tune в микшере громкости Windows.
//!
//! Звук играет не tune-music.exe, а служебный процесс WebView2 (msedgewebview2.exe),
//! поэтому микшер подписывал его «Microsoft Edge WebView2». Tune находит звуковые
//! сессии своих дочерних процессов и задаёт им своё имя и значок.
//!
//! У Electron-клиентов такого нет: их служебные процессы — копии самого exe
//! приложения. WebView2 же общий для системы, и его процессы — msedgewebview2.exe,
//! поэтому имя приходится ставить уже созданной сессии. Чтобы микшер не успевал
//! показать чужое имя, Tune подписывает сессию по событию её создания.

#[cfg(windows)]
mod imp {
    use std::collections::{HashMap, HashSet};
    use std::sync::mpsc::{channel, Sender};
    use std::sync::Mutex;
    use std::time::Duration;

    use windows::core::{Interface, GUID, HSTRING};
    use windows_core::{implement, Ref};
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::Media::Audio::{
        eRender, IAudioSessionControl, IAudioSessionControl2, IAudioSessionManager2, IAudioSessionNotification, IAudioSessionNotification_Impl,
        IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE,
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
    #[cfg(test)]
    pub fn label_sessions() -> windows::core::Result<usize> {
        label_sessions_of(std::process::id(), &mut Known::default())
    }

    /// Уже разобранные процессы: дерево строим заново, только встретив новый PID.
    #[derive(Default)]
    pub struct Known {
        own: HashSet<u32>,
        foreign: HashSet<u32>,
    }

    pub fn label_sessions_of(root: u32, known: &mut Known) -> windows::core::Result<usize> {
        // Сначала только неподписанные сессии: дерево процессов строим, лишь когда
        // есть кого подписывать, — так проверку можно гонять часто.
        let mut unlabeled = Vec::new();
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
                    if pid == 0 {
                        continue;
                    }
                    let current = control.GetDisplayName().ok().map(|s| s.to_string().unwrap_or_default()).unwrap_or_default();
                    if current != NAME && !known.foreign.contains(&pid) {
                        unlabeled.push((pid, control));
                    }
                }
            }
        }
        if unlabeled.is_empty() {
            return Ok(0);
        }
        if unlabeled.iter().any(|(pid, _)| !known.own.contains(pid)) {
            known.own = own_processes(root);
        }
        let icon = std::env::current_exe().map(|p| format!("{},0", p.display())).unwrap_or_default();
        let mut done = 0;
        for (pid, control) in unlabeled {
            if !known.own.contains(&pid) {
                known.foreign.insert(pid);
                continue;
            }
            // Ошибка на одной сессии (например, уже закрытой) не мешает остальным.
            unsafe {
                if control.SetDisplayName(&HSTRING::from(NAME), &GUID::zeroed()).is_err() {
                    continue;
                }
                if !icon.is_empty() {
                    let _ = control.SetIconPath(&HSTRING::from(icon.as_str()), &GUID::zeroed());
                }
            }
            done += 1;
        }
        Ok(done)
    }

    /// Уведомление Windows о новой звуковой сессии. Сессию подписывает поток
    /// mixer-label: в самом обработчике долгие вызовы делать нельзя.
    #[implement(IAudioSessionNotification)]
    struct SessionCreated(Mutex<Sender<()>>);

    impl IAudioSessionNotification_Impl for SessionCreated_Impl {
        fn OnSessionCreated(&self, _session: Ref<IAudioSessionControl>) -> windows::core::Result<()> {
            if let Ok(tx) = self.0.lock() {
                let _ = tx.send(());
            }
            Ok(())
        }
    }

    /// Подписка на новые сессии каждого устройства вывода; новые устройства
    /// добавляются при следующей проверке.
    fn watch_devices(watched: &mut HashMap<String, IAudioSessionManager2>, notify: &IAudioSessionNotification) -> windows::core::Result<()> {
        unsafe {
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let devices = enumerator.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)?;
            for i in 0..devices.GetCount()? {
                let Ok(device) = devices.Item(i) else { continue };
                let Ok(id) = device.GetId() else { continue };
                let id = id.to_string().unwrap_or_default();
                if watched.contains_key(&id) {
                    continue;
                }
                let Ok(manager) = device.Activate::<IAudioSessionManager2>(CLSCTX_ALL, None) else { continue };
                // Без перечисления сессий Windows уведомления не присылает.
                let _ = manager.GetSessionEnumerator();
                if manager.RegisterSessionNotification(notify).is_ok() {
                    watched.insert(id, manager);
                }
            }
        }
        Ok(())
    }

    /// Фоновый поток: сессия появляется, когда начинается звук, и пересоздаётся
    /// при смене устройства. Подписываем её сразу по уведомлению о создании, а раз в
    /// секунду — проверка на случай пропущенного уведомления и новых устройств.
    pub fn spawn() {
        let _ = std::thread::Builder::new().name("mixer-label".into()).spawn(|| {
            unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            }
            let (tx, rx) = channel();
            let notify: IAudioSessionNotification = SessionCreated(Mutex::new(tx)).into();
            let mut watched = HashMap::new();
            let mut known = Known::default();
            loop {
                let _ = watch_devices(&mut watched, &notify);
                let _ = label_sessions_of(std::process::id(), &mut known);
                // Пачку уведомлений (сессия на каждом устройстве) обрабатываем одной проверкой.
                if rx.recv_timeout(Duration::from_secs(1)).is_ok() {
                    while rx.try_recv().is_ok() {}
                }
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
        println!("LABELED={}", super::imp::label_sessions_of(pid, &mut Default::default()).unwrap());
    }
}
