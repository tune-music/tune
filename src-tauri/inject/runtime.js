// Tune runtime — внедряется в страницы главного окна до их загрузки.
// На music.yandex.ru: кнопка Tune в сайдбаре, аддоны (темы и скрипты), управление
// плеером, передача трека в Discord и панель Windows. На страницах входа — только
// кнопки окна (окно без системной рамки).
(() => {
  if (window.top !== window || window.__tune) return;
  const isMusic = location.origin === 'https://music.yandex.ru';
  const isAuth = /(^|\.)(passport|oauth|sso)\.|^sso\.ya\./.test(location.hostname);
  if (!isMusic && !isAuth) return;

  const invoke = (cmd, args) => {
    const ipc = window.__TAURI_INTERNALS__;
    return ipc ? ipc.invoke(cmd, args) : Promise.reject(new Error('Tauri IPC недоступен'));
  };
  const log = (...a) => console.log('%c[tune]', 'color:#facc15', ...a);
  const onReady = (fn) => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn, { once: true }) : fn());

  // -------------------------------------------------------------------------
  // Свои стили Tune: constructable stylesheet, чтобы не смешиваться со стилями тем
  // -------------------------------------------------------------------------
  const ownSheet = new CSSStyleSheet();
  const adoptOwn = () => {
    if (!document.adoptedStyleSheets.includes(ownSheet)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, ownSheet];
  };
  ownSheet.replaceSync(`
    #tune-titlebar {
      position: fixed; top: 0; left: 0; right: 0; height: 32px; z-index: 2147482000;
      display: flex; justify-content: flex-end; app-region: drag; -webkit-app-region: drag; pointer-events: none;
    }
    #tune-titlebar .tune-wbtn { pointer-events: auto; }
    .tune-wbtn {
      width: 46px; height: 32px; padding: 0; border: 0; background: transparent; cursor: default;
      display: flex; align-items: center; justify-content: center;
      color: var(--ym-controls-color-secondary-text-enabled, rgba(127,127,127,.9));
      app-region: no-drag; -webkit-app-region: no-drag;
    }
    .tune-wbtn:hover { background: rgba(127,127,127,.18); color: var(--ym-controls-color-secondary-text-hovered, currentColor); }
    .tune-wbtn-close:hover { background: #c42b1c; color: #fff; }
    /* Уведомления: одна колонка по центру над плеером. Обычное уведомление одно и плавно
       сменяется следующим; карточки с ходом дела (скачивание) стоят над ним. */
    #tune-toasts {
      position: fixed; left: 50%; bottom: 110px; transform: translateX(-50%); width: max-content; max-width: min(560px, 80vw);
      display: flex; flex-direction: column; align-items: center; gap: 8px; pointer-events: none; z-index: 2147483001;
    }
    .tune-toast {
      position: relative; box-sizing: border-box; max-width: min(560px, 80vw); overflow: hidden;
      padding: 10px 14px; border-radius: 10px; background: rgba(24,24,27,.96); color: #fafafa;
      border: 1px solid rgba(255,255,255,.1); box-shadow: 0 8px 30px rgba(0,0,0,.35);
      font: 500 13px/1.4 system-ui, sans-serif; pointer-events: auto; transition: border-color .2s;
    }
    .tune-toast.tune-error { border-color: rgba(248,113,113,.5); }
    .tune-toast-body { display: flex; align-items: center; gap: 10px; white-space: nowrap; }
    .tune-toast-body.tune-leaving { position: absolute; left: 14px; top: 10px; }
    .tune-toast-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
    .tune-toast img { width: 32px; height: 32px; border-radius: 4px; object-fit: cover; flex: none; }
    .tune-toast.tune-task { width: min(360px, 80vw); }
    .tune-toast.tune-task .tune-toast-body { display: grid; grid-template-columns: 32px minmax(0, 1fr) auto; grid-template-rows: auto auto; column-gap: 10px; row-gap: 6px; }
    .tune-toast.tune-task img { grid-row: 1 / 3; }
    .tune-toast.tune-task.tune-nocover .tune-toast-body { grid-template-columns: minmax(0, 1fr) auto; }
    .tune-toast.tune-task.tune-nocover img { display: none; }
    .tune-toast.tune-task.tune-nocover .tune-toast-bar { grid-column: 1 / 3; }
    .tune-toast.tune-task .tune-toast-info { opacity: .6; font-variant-numeric: tabular-nums; }
    .tune-toast-bar { grid-column: 2 / 4; height: 4px; border-radius: 2px; background: rgba(255,255,255,.14); overflow: hidden; }
    .tune-toast-bar i { display: block; height: 100%; width: 0; border-radius: inherit; background: var(--ym-controls-color-primary-text-enabled, #fc3); transition: width .15s linear, background-color .2s; }
    .tune-toast-bar.tune-wait i { width: 30%; animation: tune-toast-wait 1s ease-in-out infinite alternate; }
    @keyframes tune-toast-wait { from { margin-left: 0; } to { margin-left: 70%; } }
    .tune-toast.tune-ok .tune-toast-bar i { background: #4ade80; }
    .tune-toast.tune-error .tune-toast-bar { display: none; }
    .tune-toast.tune-error .tune-toast-info { color: #fca5a5; opacity: 1; }
    .tune-toast.tune-task.tune-error .tune-toast-text { white-space: normal; }
    .tune-toast.tune-clickable { cursor: pointer; }
    .tune-toast.tune-clickable:hover { background: rgba(39,39,42,.97); }
    .tune-toast-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
    .tune-toast-actions button {
      padding: 6px 14px; border-radius: 8px; border: 1px solid rgba(255,255,255,.14); background: transparent; color: inherit;
      font: inherit; cursor: pointer;
    }
    .tune-toast-actions button:hover { background: rgba(255,255,255,.08); }
    .tune-toast-actions button.tune-primary {
      background: var(--ym-controls-color-primary-text-enabled, #fc3); border-color: transparent; color: #000; font-weight: 600;
    }
    .tune-toast-actions button.tune-primary:hover { filter: brightness(1.08); }
  `);

  // -------------------------------------------------------------------------
  // Кнопки окна. Окно без системной рамки, как у официального клиента; свой заголовок
  // интерфейс Яндекса рисует не на всех экранах — на остальных встаёт наш.
  // -------------------------------------------------------------------------
  const WIN_ICONS = {
    minimize: '<svg viewBox="0 0 10 10" width="10" height="10"><path d="M0 5h10" stroke="currentColor"/></svg>',
    maximize: '<svg viewBox="0 0 10 10" width="10" height="10"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor"/></svg>',
    close: '<svg viewBox="0 0 10 10" width="10" height="10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor"/></svg>',
  };
  const mountTitleBar = () => {
    const ours = document.getElementById('tune-titlebar');
    if (isMusic && document.querySelector('[class*="TitleBar_root"]')) {
      ours?.remove();
      return;
    }
    if (ours || !document.body) return;
    const bar = document.createElement('div');
    bar.id = 'tune-titlebar';
    for (const [action, label] of [['minimize', 'Свернуть'], ['maximize', 'Развернуть'], ['close', 'Закрыть']]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `tune-wbtn tune-wbtn-${action}`;
      b.setAttribute('aria-label', label);
      b.innerHTML = WIN_ICONS[action];
      b.addEventListener('click', () => invoke('page_window', { action }).catch(() => {}));
      bar.appendChild(b);
    }
    document.body.appendChild(bar);
  };

  if (!isMusic) {
    onReady(() => {
      adoptOwn();
      mountTitleBar();
      new MutationObserver(mountTitleBar).observe(document.body, { childList: true });
    });
    return;
  }

  // -------------------------------------------------------------------------
  // Плеер Яндекса изнутри: контроллер воспроизведения из контекста React.
  // Его же используют аддоны PulseSync (pulsesyncApi.playerInstance).
  // -------------------------------------------------------------------------
  let controller = null;
  let lastSearch = 0;
  const findController = () => {
    if (controller && controller.playbacks instanceof Map && controller.playbacks.size) return controller;
    const now = performance.now();
    if (now - lastSearch < 700) return null;
    lastSearch = now;
    // Контекст плеера — выше по дереву от любого блока основного интерфейса.
    const starts = document.querySelectorAll('main, [class*="CommonLayout"], [class*="NavbarDesktop_root"], [data-test-id$="PLAYERBAR"], [data-test-id="PLAYERBAR_DESKTOP"]');
    for (const start of starts) {
      const key = Object.keys(start).find((k) => k.startsWith('__reactFiber'));
      let f = key && start[key];
      for (let i = 0; f && i < 400; i++, f = f.return) {
        const v = f.memoizedProps && f.memoizedProps.value;
        const c = v && v.playbackController;
        if (c && c.playbacks instanceof Map) {
          controller = c;
          return c;
        }
      }
    }
    return null;
  };

  const ym = {
    controller: findController,
    /** Основной плеер (MAIN) — у него очередь, трек и прогресс. */
    player() {
      const c = findController();
      return c ? c.playbacks.get('MAIN') || (c.activePlayback && c.activePlayback.value) || null : null;
    },
    state() {
      const p = ym.player();
      return p ? p.state || p.playbackState || null : null;
    },
    entity() {
      const s = ym.state();
      return s && s.queueState && s.queueState.currentEntity && s.queueState.currentEntity.value
        ? s.queueState.currentEntity.value.entity
        : null;
    },
    meta() {
      const e = ym.entity();
      return (e && e.entityData && e.entityData.meta) || null;
    },
    status() {
      const s = ym.state();
      return s && s.playerState && s.playerState.status ? s.playerState.status.value : undefined;
    },
    progress() {
      const s = ym.state();
      return (s && s.playerState && s.playerState.progress && s.playerState.progress.value) || null;
    },
    cover(meta, size = '400x400') {
      const uri = meta && (meta.coverUri || meta.ogImage);
      if (!uri) return '';
      return /^https?:/.test(uri) ? uri : 'https://' + uri.replace('%%', size);
    },
  };

  // -------------------------------------------------------------------------
  // Запасной путь: mediaSession и <audio>, если контроллер не нашёлся
  // -------------------------------------------------------------------------
  const actionHandlers = {};
  const mediaElements = new Set();
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    const setActionHandler = ms.setActionHandler.bind(ms);
    ms.setActionHandler = (action, handler) => {
      actionHandlers[action] = handler;
      return setActionHandler(action, handler);
    };
  }
  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    mediaElements.add(this);
    return origPlay.apply(this, args);
  };
  const currentMedia = () => {
    let best = null;
    for (const el of mediaElements) {
      if (!el.src && !el.currentSrc) {
        mediaElements.delete(el);
        continue;
      }
      if (!el.paused) return el;
      best = el;
    }
    return best || document.querySelector('audio, video');
  };
  const runAction = (name, extra) => {
    const h = actionHandlers[name];
    if (!h) return false;
    try {
      h({ action: name, ...extra });
      return true;
    } catch (e) {
      return false;
    }
  };

  const isPlaying = () => {
    const st = ym.status();
    if (st) return st === 'playing';
    const m = currentMedia();
    return !!(m && !m.paused);
  };

  const call = (method, ...args) => {
    const p = ym.player();
    if (!p || typeof p[method] !== 'function') return false;
    try {
      p[method](...args);
      return true;
    } catch (e) {
      console.error('[tune] player.' + method, e);
      return false;
    }
  };

  const player = {
    isPlaying,
    play() {
      if (isPlaying()) return;
      call('resume') || call('togglePause') || runAction('play') || (currentMedia() && currentMedia().play());
    },
    pause() {
      if (!isPlaying()) return;
      call('pause') || call('togglePause') || runAction('pause') || (currentMedia() && currentMedia().pause());
    },
    toggle() {
      call('togglePause') || (isPlaying() ? player.pause() : player.play());
    },
    next() {
      call('moveForward') || runAction('nexttrack');
    },
    prev() {
      call('moveBackward') || runAction('previoustrack');
    },
    seek(seconds) {
      if (call('setProgress', Math.max(0, seconds))) return;
      runAction('seekto', { seekTime: seconds }) || (currentMedia() && (currentMedia().currentTime = seconds));
    },
    volume(v) {
      if (v === undefined) {
        const s = ym.state();
        return s && s.playerState && s.playerState.exponentVolume ? s.playerState.exponentVolume.value : undefined;
      }
      call('setExponentVolume', Math.min(1, Math.max(0, v)));
    },
    speed(v) {
      if (v === undefined) {
        const s = ym.state();
        return s && s.playerState && s.playerState.speed ? s.playerState.speed.value : 1;
      }
      call('setSpeed', v);
    },
    media: currentMedia,
  };

  // -------------------------------------------------------------------------
  // Текущий трек → Discord, панель Windows, заголовок окна
  // -------------------------------------------------------------------------
  const BASE = 'https://music.yandex.ru';
  const readTrack = () => {
    const meta = ym.meta();
    if (meta && meta.title) {
      const prog = ym.progress() || {};
      const album = (meta.albums || [])[0];
      const artist = (meta.artists || [])[0];
      const id = String(meta.id || '').split(':')[0];
      return {
        title: meta.version ? `${meta.title} (${meta.version})` : meta.title,
        artist: (meta.artists || []).map((a) => a.name).filter(Boolean).join(', '),
        album: album ? album.title || '' : '',
        cover: ym.cover(meta),
        url: id ? (album ? `${BASE}/album/${album.id}/track/${id}` : `${BASE}/track/${id}`) : '',
        albumUrl: album ? `${BASE}/album/${album.id}` : '',
        artistUrl: artist && artist.id ? `${BASE}/artist/${artist.id}` : '',
        playing: ym.status() === 'playing',
        position: Math.max(0, prog.position || 0),
        duration: Math.max(0, prog.duration || (meta.durationMs ? meta.durationMs / 1000 : 0)),
        id,
      };
    }
    const md = navigator.mediaSession && navigator.mediaSession.metadata;
    if (!md || !md.title) return null;
    const media = currentMedia();
    const art = [...(md.artwork || [])].sort((a, b) => parseInt(b.sizes || '0', 10) - parseInt(a.sizes || '0', 10))[0];
    return {
      title: md.title || '',
      artist: md.artist || '',
      album: md.album || '',
      cover: art ? new URL(art.src, location.href).href : '',
      url: '',
      albumUrl: '',
      artistUrl: '',
      playing: media ? !media.paused : navigator.mediaSession.playbackState === 'playing',
      position: media ? media.currentTime || 0 : 0,
      duration: media && isFinite(media.duration) ? media.duration : 0,
      id: '',
    };
  };

  const trackListeners = new Set();
  const navListeners = new Set();
  let current = null;
  let lastSent = null;
  let lastSentAt = 0;
  let lastHref = location.href;
  // Обложка и ссылки сравниваются тоже: сразу после загрузки трек приходит из mediaSession
  // без них, а позже — из плеера Яндекса, и Discord должен получить полную версию.
  const same = (a, b) =>
    !!a && !!b && a.title === b.title && a.artist === b.artist && a.playing === b.playing && a.cover === b.cover && a.url === b.url;

  const tick = () => {
    const t = readTrack();
    const changed = t || current ? !same(t, current) : false;
    const trackChanged = (t && t.id) !== (current && current.id) || (t && t.title) !== (current && current.title);
    current = t;
    if (trackChanged) {
      for (const cb of trackListeners) {
        try {
          cb(t);
        } catch (e) {
          console.error('[tune] onTrack', e);
        }
      }
    }
    // В Discord отправляем при смене трека/паузы и при перемотке.
    const now = performance.now();
    let seeked = false;
    if (t && lastSent && t.playing && same(t, lastSent)) {
      const expected = lastSent.position + (now - lastSentAt) / 1000;
      seeked = Math.abs(expected - t.position) > 3;
    }
    if (changed || seeked || (t && !lastSent)) {
      lastSent = t;
      lastSentAt = now;
      invoke('page_track', { track: t }).catch(() => {});
    }
    if (location.href !== lastHref) {
      lastHref = location.href;
      for (const cb of navListeners) {
        try {
          cb(lastHref);
        } catch (e) {
          console.error('[tune] onNavigate', e);
        }
      }
    }
  };

  // -------------------------------------------------------------------------
  // Уведомление
  // -------------------------------------------------------------------------
  const EASE = 'cubic-bezier(.2,.8,.2,1)';
  const toastHost = () => {
    let host = document.getElementById('tune-toasts');
    if (!host) {
      host = document.createElement('div');
      host.id = 'tune-toasts';
      host.setAttribute('role', 'status');
    }
    if (!host.isConnected) document.body.appendChild(host);
    return host;
  };
  const animateIn = (el) => el.animate([{ opacity: 0, transform: 'translateY(10px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: EASE });
  // Уходящая карточка схлопывается по высоте, чтобы соседние съезжали плавно.
  const animateOut = (el) => {
    if (el.dataset.leaving) return;
    el.dataset.leaving = '1';
    const h = el.offsetHeight;
    el.animate(
      [
        { opacity: 1, transform: 'none', height: `${h}px`, marginTop: '0px' },
        { opacity: 0, transform: 'translateY(-6px) scale(.97)', height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: '-8px' },
      ],
      { duration: 220, easing: EASE, fill: 'forwards' }
    ).onfinish = () => el.remove();
  };
  const toastBody = (text, cover) => {
    const body = document.createElement('div');
    body.className = 'tune-toast-body';
    if (cover) {
      const img = document.createElement('img');
      img.src = cover;
      img.alt = '';
      body.appendChild(img);
    }
    const span = document.createElement('span');
    span.className = 'tune-toast-text';
    span.textContent = typeof text === 'string' ? text : String(text && text.textContent ? text.textContent : text);
    body.appendChild(span);
    return body;
  };
  // Смена содержимого: старое уходит вверх, новое приходит снизу, ширина карточки тянется.
  const swapBody = (card, body) => {
    const old = card.querySelector(':scope > .tune-toast-body:not(.tune-leaving)');
    const from = card.offsetWidth;
    if (old) {
      old.classList.add('tune-leaving');
      old.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-10px)' }], { duration: 180, easing: EASE, fill: 'forwards' }).onfinish = () => old.remove();
    }
    card.appendChild(body);
    const to = card.offsetWidth;
    if (old) {
      body.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: EASE });
      if (from !== to) card.animate([{ width: `${from}px` }, { width: `${to}px` }], { duration: 220, easing: EASE });
    }
  };

  let toastCard = null;
  let toastTimer = 0;
  let toastWord = '';
  const toast = (text, opts = {}) => {
    if (!document.body) return null;
    const host = toastHost();
    const str = typeof text === 'string' ? text : String(text && text.textContent ? text.textContent : text);
    const word = str.split(' ')[0];
    const alive = toastCard && toastCard.isConnected && !toastCard.dataset.leaving;
    if (alive && !opts.cover && !toastCard.querySelector('img') && word === toastWord && !!opts.error === toastCard.classList.contains('tune-error')) {
      // «Громкость 45 %» → «Громкость 50 %»: то же уведомление, меняется только текст.
      toastCard.querySelector('.tune-toast-body:not(.tune-leaving) .tune-toast-text').textContent = str;
    } else if (alive) {
      toastCard.classList.toggle('tune-error', !!opts.error);
      swapBody(toastCard, toastBody(str, opts.cover));
    } else {
      toastCard = document.createElement('div');
      toastCard.className = 'tune-toast';
      toastCard.classList.toggle('tune-error', !!opts.error);
      toastCard.appendChild(toastBody(str, opts.cover));
      host.appendChild(toastCard);
      animateIn(toastCard);
    }
    toastWord = word;
    // Обычное уведомление всегда ниже карточек с ходом дела — ближе к плееру.
    if (host.lastElementChild !== toastCard) host.appendChild(toastCard);
    clearTimeout(toastTimer);
    const card = toastCard;
    toastTimer = setTimeout(() => animateOut(card), opts.ms || 2600);
    return 'tune-toast';
  };

  // Карточка с ходом дела (скачивание): живёт, пока её не закроют.
  // set({ text, info, progress: 0..1 | null (неизвестно) | undefined (без полосы), cover, error, ok, onClick })
  const task = (init = {}) => {
    const card = document.createElement('div');
    card.className = 'tune-toast tune-task';
    const body = document.createElement('div');
    body.className = 'tune-toast-body';
    body.innerHTML = '<img alt="" /><span class="tune-toast-text"></span><span class="tune-toast-info"></span><div class="tune-toast-bar"><i></i></div>';
    card.appendChild(body);
    let onClick = null;
    card.addEventListener('click', () => onClick && onClick());
    let timer = 0;
    const handle = {
      el: card,
      set(o) {
        if ('text' in o) body.querySelector('.tune-toast-text').textContent = o.text || '';
        if ('info' in o) body.querySelector('.tune-toast-info').textContent = o.info || '';
        if ('title' in o) card.title = o.title || '';
        if ('cover' in o) {
          const img = body.querySelector('img');
          if (o.cover) img.src = o.cover;
          img.style.visibility = o.cover ? '' : 'hidden';
        }
        if ('progress' in o) {
          const bar = body.querySelector('.tune-toast-bar');
          bar.style.display = o.progress === undefined ? 'none' : '';
          bar.classList.toggle('tune-wait', o.progress === null);
          if (typeof o.progress === 'number') bar.firstChild.style.width = `${Math.min(100, o.progress * 100).toFixed(1)}%`;
        }
        if ('error' in o) card.classList.toggle('tune-error', !!o.error);
        if ('ok' in o) card.classList.toggle('tune-ok', !!o.ok);
        if ('onClick' in o) {
          onClick = o.onClick || null;
          card.classList.toggle('tune-clickable', !!onClick);
        }
        return handle;
      },
      close(ms = 0) {
        clearTimeout(timer);
        timer = setTimeout(() => animateOut(card), ms);
      },
    };
    handle.set({ progress: null, cover: '', ...init });
    if (document.body) {
      const host = toastHost();
      host.insertBefore(card, toastCard && toastCard.parentNode === host ? toastCard : null);
      animateIn(card);
    }
    return handle;
  };

  // -------------------------------------------------------------------------
  // Аддоны: стили — элементы <style> в конце body (после стилей интерфейса, @import
  // работает), скрипты — один раз за загрузку страницы, когда интерфейс готов.
  // -------------------------------------------------------------------------
  const addonStyles = new Map(); // id -> [HTMLStyleElement]
  const styleHost = () => document.body || document.documentElement;
  const keepStyles = () => {
    for (const list of addonStyles.values()) for (const s of list) if (!s.isConnected) styleHost().appendChild(s);
  };
  const settingsListeners = new Set();
  const addonSettings = new Map(); // alias -> values
  const addonInfo = new Map(); // id -> { name, aliases }

  const applyAddons = (list) => {
    const ids = new Set(list.map((a) => a.id));
    for (const [id, styles] of addonStyles) {
      if (!ids.has(id)) {
        styles.forEach((s) => s.remove());
        addonStyles.delete(id);
      }
    }
    for (const a of list) {
      addonInfo.set(a.id, { name: a.name, aliases: a.aliases });
      setAddonSettings(a.id, a.settings || {}, false);
      const old = addonStyles.get(a.id) || [];
      const next = a.css.map((c, i) => {
        const el = old[i] || document.createElement('style');
        el.dataset.tuneAddon = a.id;
        el.dataset.file = c.file;
        // Тема перекрашивает интерфейс — по этому признаку окна Tune подстраиваются под неё.
        if (a.theme) el.dataset.tuneTheme = '1';
        else delete el.dataset.tuneTheme;
        if (el.textContent !== c.text) el.textContent = c.text;
        return el;
      });
      old.slice(next.length).forEach((s) => s.remove());
      addonStyles.set(a.id, next);
    }
    onReady(keepStyles);
  };

  const setAddonSettings = (id, values, notify = true) => {
    const info = addonInfo.get(id);
    const names = info ? [id, ...info.aliases] : [id];
    for (const n of names) addonSettings.set(n, values);
    if (notify) {
      for (const fn of settingsListeners) {
        try {
          fn(names, values);
        } catch (e) {
          console.error('[tune] настройки аддона', e);
        }
      }
    }
  };

  // Скрипты ждут, пока загрузится webpack-рантайм интерфейса и появится плеер:
  // аддоны PulseSync и Next Music ищут модули через webpackChunk_N_E.
  const appReady = () => {
    const chunk = window.webpackChunk_N_E;
    return document.readyState === 'complete' && chunk && chunk.push !== Array.prototype.push;
  };
  const queue = [];
  let readySince = 0;
  const flushQueue = () => {
    if (!queue.length) return;
    if (!appReady()) return;
    readySince = readySince || performance.now();
    // Даём интерфейсу дорисоваться: до 4 секунд ждём контроллер плеера.
    if (!findController() && performance.now() - readySince < 4000) return;
    while (queue.length) queue.shift()();
  };
  const ran = {}; // id -> hash
  const runScript = (id, file, hash, fn) => {
    const key = `${id}/${file}`;
    if (ran[key] !== undefined) return;
    ran[key] = hash;
    queue.push(() => {
      try {
        fn();
        log(`аддон «${id}»: ${file}`);
      } catch (e) {
        console.error(`[tune] аддон ${id} (${file}) упал при запуске`, e);
      }
      invoke('page_scripts', { ran: Object.entries(ran).map(([k, h]) => [k, h]) }).catch(() => {});
    });
    flushQueue();
  };

  // -------------------------------------------------------------------------
  // Кнопка Tune в сайдбаре — копия соседнего пункта навигации Яндекса: те же классы,
  // отступы и поведение при свёрнутом сайдбаре. Меняются только иконка и подпись.
  // Нет сайдбара (заставка, вход) — нет и кнопки.
  // -------------------------------------------------------------------------
  const ICON =
    '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/>' +
    '<line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/>' +
    '<line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>' +
    '<line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>';

  const openManager = (e) => {
    e.preventDefault();
    e.stopPropagation();
    invoke('open_manager').catch((err) => console.error('[tune]', err));
  };

  const buildNavItem = (template) => {
    const li = template.cloneNode(true);
    li.id = 'tune-nav-item';
    li.setAttribute('aria-current', 'false');
    li.removeAttribute('data-intersection-property-id');
    const link = li.querySelector('a, button') || li;
    link.removeAttribute('href');
    link.setAttribute('role', 'button');
    link.setAttribute('aria-label', 'Tune — темы и плагины');
    link.setAttribute('data-test-id', 'TUNE_NAV_ITEM');
    link.style.cursor = 'pointer';
    const svg = link.querySelector('svg');
    if (svg) {
      const holder = document.createElement('span');
      holder.innerHTML = ICON;
      const icon = holder.firstChild;
      icon.setAttribute('class', svg.getAttribute('class') || '');
      icon.removeAttribute('width');
      icon.removeAttribute('height');
      svg.replaceWith(icon);
    }
    const label = link.querySelector('span[title]') || link.querySelector('span');
    if (label) {
      label.title = 'Tune';
      label.textContent = 'Tune';
    }
    link.addEventListener('click', openManager);
    return li;
  };

  const pickTemplate = (list, mounted) => {
    const items = [...list.children].filter((li) => li !== mounted && li.getAttribute('aria-current') !== 'page' && li.getAttribute('aria-current') !== 'true');
    const href = (li) => (li.querySelector('a') || {}).getAttribute?.('href') || '';
    return items.find((li) => href(li) === '/collection') || items.find((li) => href(li).startsWith('/') && !/plus/i.test(href(li))) || items[0];
  };
  const classSignature = (el) => [el, ...el.querySelectorAll('*')].map((n) => n.getAttribute('class') || '').join('|');

  const mountButton = () => {
    adoptOwn();
    mountTitleBar();
    keepStyles();
    // Список пунктов навигации: у разных вариантов интерфейса (и с темами) классы разные,
    // а data-test-id пунктов одинаковые.
    const navItem = document.querySelector('[data-test-id^="NAVBAR_NAVIGATION_ITEM_"]:not([data-test-id$="_SEARCH"])');
    const list = (navItem && navItem.closest('li') && navItem.closest('li').parentElement) || document.querySelector('[class*="NavbarDesktop_navigationGroup"]');
    const mounted = document.getElementById('tune-nav-item');
    // Сайдбар есть и под заставкой загрузки — ждём, пока он станет видимым.
    if (!list || !list.getClientRects().length || document.querySelector('[class*="SplashScreen_root"], [class*="Splash_root"]')) {
      if (mounted && (!list || !mounted.isConnected)) mounted.remove();
      return;
    }
    const template = pickTemplate(list, mounted);
    if (!template) return;
    const sig = classSignature(template);
    if (mounted && mounted.parentElement === list && list.lastElementChild === mounted && mounted.dataset.sig === sig) return;
    mounted?.remove();
    const item = buildNavItem(template);
    item.dataset.sig = sig;
    list.appendChild(item);
  };

  // -------------------------------------------------------------------------
  // Старт
  // -------------------------------------------------------------------------
  window.__tune = Object.freeze({
    version: '0.1.0',
    ym,
    player,
    toast,
    task,
    invoke,
    get track() {
      return current;
    },
    onTrack(cb) {
      trackListeners.add(cb);
      return () => trackListeners.delete(cb);
    },
    onNavigate(cb) {
      navListeners.add(cb);
      return () => navListeners.delete(cb);
    },
    onAddonSettings(cb) {
      settingsListeners.add(cb);
      return () => settingsListeners.delete(cb);
    },
    addonSettings: (name) => addonSettings.get(String(name || '').trim()),
    addonNames: () => [...addonInfo.values()].map((a) => a.name),
    _applyAddons: applyAddons,
    _settings: setAddonSettings,
    _script: runScript,
    _features: (f) => window.dispatchEvent(new CustomEvent('tune:features', { detail: f })),
  });

  onReady(() => {
    let scheduled = false;
    new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        mountButton();
      });
    }).observe(document.body, { childList: true, subtree: true });
    mountButton();
    setInterval(tick, 1000);
    // Интерфейс загрузился (заставка ушла, кнопка Tune в сайдбаре) — в трее Tune
    // после этого перестаёт рисовать страницу.
    let loadedSent = false;
    setInterval(() => {
      mountButton();
      flushQueue();
      if (!loadedSent && document.getElementById('tune-nav-item')) {
        loadedSent = true;
        invoke('page_ready', { loaded: true }).catch(() => {});
      }
    }, 500);
    window.addEventListener('load', flushQueue);
    invoke('page_ready').catch((e) => console.error('[tune] page_ready', e));
    log('runtime запущен');
  });
})();
