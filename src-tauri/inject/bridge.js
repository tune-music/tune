// Мост оболочки для интерфейса Яндекс Музыки.
// Интерфейс официального клиента ждёт от Electron-оболочки объект
// window.musicDesktop (данные устройства, вход, окно, плеер). Здесь он
// реализован поверх Tune. window.__TUNE_CLIENT__ подставляет Rust.
(() => {
  if (window.top !== window) return;
  // Страницы входа Яндекс ID: у официального клиента там есть кнопка «закрыть окно входа».
  if (/^(oauth|passport|sso\.passport)\.yandex\.(ru|com|kz|by|uz)$|^sso\.ya\.(ru|com|kz|by|uz)$/.test(location.hostname)) {
    window.musicDesktopCommon = Object.freeze({
      window: Object.freeze({ close: () => location.replace('https://music.yandex.ru/') }),
    });
    return;
  }
  if (location.origin !== 'https://music.yandex.ru' || window.musicDesktop) return;
  const cfg = window.__TUNE_CLIENT__;
  if (!cfg) return;

  const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
  const noop = () => {};
  const listeners = { playerAction: new Set(), deeplink: new Set() };
  const subscribe = (set) => (fn) => {
    set.add(fn);
    return () => set.delete(fn);
  };
  const never = () => noop;

  const readCookie = (name) => {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.$?*|{}()[\]\\/+^]/g, '\\$&') + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : undefined;
  };
  // Часть cookie Яндекса недоступна из JS (HttpOnly) — тогда спрашиваем у оболочки.
  const cookie = async (name) => readCookie(name) || (await invoke('page_cookie', { name }).catch(() => undefined)) || undefined;

  const runtime = Object.freeze({
    version: cfg.version,
    branch: cfg.branch,
    platform: 'win32',
    deviceHostname: cfg.hostname,
    deviceInfo: Object.freeze({
      manufacturer: '',
      model: '',
      uuid: cfg.uuid,
      os: 'win32',
      os_version: '',
      device_id: cfg.deviceId,
      clid: 0,
    }),
  });

  const bridge = {
    runtime,
    window: {
      minimize: () => invoke('page_window', { action: 'minimize' }),
      maximize: () => invoke('page_window', { action: 'maximize' }),
      close: () => invoke('page_window', { action: 'close' }),
    },
    app: {
      ready: noop,
      setTheme: noop,
      installUpdate: noop,
      onUpdateAvailable: never,
      onRefreshData: never,
      onFirstLaunch: never,
      onProbabilityBucket: never,
      onLoadReleaseNotes: never,
    },
    authorization: {
      getPassportLogin: () => cookie('yandex_login'),
      getYandexUid: () => cookie('yandexuid'),
      reportDiagnostic: noop,
    },
    player: {
      reportState: (state) => {
        window.__tunePlayerState = state;
      },
      onAction: subscribe(listeners.playerAction),
    },
    navigation: {
      onOpenDeeplink: subscribe(listeners.deeplink),
    },
    offline: {
      notifyTracksAvailabilityUpdated: noop,
      notifyRepositoryMetaUpdated: noop,
      onRefreshTracksAvailability: never,
      onRefreshRepositoryMeta: never,
    },
    files: {
      savePng: noop,
    },
  };

  Object.defineProperty(window, 'musicDesktop', { value: Object.freeze(bridge), configurable: false });

  // Для рантайма Tune: управление плеером тем же путём, что у официальной оболочки.
  window.__tuneDesktop = {
    playerAction(action) {
      if (!listeners.playerAction.size) return false;
      listeners.playerAction.forEach((fn) => fn(action));
      return true;
    },
    openDeeplink(path) {
      listeners.deeplink.forEach((fn) => fn(path));
    },
  };

  // Вход через Яндекс ID возвращает на music-application://desktop/oauth —
  // адрес, зарегистрированный для официального клиента. Интерфейс строит его
  // из глобального origin, а переход на него Tune перехватывает (main.rs).
  try {
    Object.defineProperty(window, 'origin', { value: 'music-application://desktop', configurable: true });
  } catch (e) {}

  // В локальном интерфейсе service worker'ов нет. Оставшийся от сайта music.yandex.ru
  // перехватывал бы запросы и слал их на настоящий сервер, поэтому удаляем его,
  // а если он уже управляет страницей — один раз перезагружаемся без него.
  if (navigator.serviceWorker) {
    const sw = navigator.serviceWorker;
    sw.register = () => Promise.reject(new DOMException('Service workers are disabled in Tune', 'SecurityError'));
    const controlled = !!sw.controller;
    sw.getRegistrations()
      .then((rs) => Promise.all(rs.map((r) => r.unregister())))
      .then(() => {
        if (controlled && !sessionStorage.getItem('tune:sw-reset')) {
          sessionStorage.setItem('tune:sw-reset', '1');
          location.reload();
        }
      })
      .catch(noop);
  }
})();
