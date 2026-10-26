// Встроенные улучшения Tune: синхронный текст из LRCLIB, громкость колесом мыши,
// скорость воспроизведения, горячие клавиши. Включаются в Tune → Настройки.
(() => {
  const T = window.__tune;
  if (!T || window.__tuneFeatures) return;
  window.__tuneFeatures = true;
  const { ym, player } = T;

  let cfg = {};
  const sheet = new CSSStyleSheet();
  const adopt = () => {
    if (!document.adoptedStyleSheets.includes(sheet)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  };
  sheet.replaceSync(`
    .tune-pb-btn { position: relative; }
    .tune-pb-btn svg { width: 20px; height: 20px; }
    .tune-pb-btn.tune-on { color: var(--ym-controls-color-primary-text-enabled, #fc3); }
    .tune-speed-label { font: 600 12px/1 system-ui, sans-serif; min-width: 26px; text-align: center; }
    #tune-lyrics {
      --tune-ly-bg: var(--ym-background-color-primary-enabled-player, #141414);
      --tune-ly-fg: var(--ym-controls-color-secondary-text-enabled_variant, #fff);
      position: fixed; top: var(--tune-ly-top, 44px); right: var(--tune-ly-right, 16px); bottom: var(--tune-ly-bottom, 112px);
      width: min(460px, 42vw); z-index: 2147481000;
      display: flex; flex-direction: column; overflow: hidden; isolation: isolate;
      border: var(--tune-ly-border, 0); border-radius: var(--tune-ly-radius, var(--ym-radius-size-xxl, 24px));
      background: var(--tune-ly-surface, color-mix(in srgb, var(--tune-ly-bg) 94%, transparent));
      backdrop-filter: var(--tune-ly-blur, blur(32px));
      box-shadow: var(--tune-ly-shadow, 0 16px 48px rgba(0,0,0,.4)); color: var(--tune-ly-fg);
      font-family: var(--ym-font-text, "YS Text", system-ui, sans-serif);
      transition: background-color .8s;
      animation: tune-ly-in .35s cubic-bezier(.2,.8,.2,1);
    }
    #tune-lyrics[hidden] { display: none; }
    @keyframes tune-ly-in { from { opacity: 0; transform: translateY(16px); } }
    .tune-ly-actions { display: flex; gap: var(--ym-spacer-size-xxs, 6px); flex: none; }
    .tune-ly-tool svg { width: 16px; height: 16px; }
    .tune-ly-fsonly { display: none !important; }
    /* Весь экран — полноэкранный плеер Яндекса: обложка с кнопками уезжает влево,
       справа наш текст, как у родного текста Яндекса. Фон и тема — самого плеера. */
    #tune-lyrics.tune-full {
      top: 120px; left: 50%; right: 0; bottom: 0; width: auto;
      background: none; backdrop-filter: none; border: 0; border-radius: 0; box-shadow: none;
      animation: tune-ly-fs .8s cubic-bezier(.2,.8,.2,1);
    }
    @keyframes tune-ly-fs { from { opacity: 0; transform: translateX(48px); } }
    .tune-full .tune-ly-head { display: none; }
    .tune-full .tune-ly-fsonly { display: inline-flex !important; }
    .tune-full .tune-ly-body { font-size: 1.5em; padding: 20vh 4% 45vh; mask-image: linear-gradient(transparent, #000 14%, #000 74%, transparent); }
    .tune-full .tune-ly-line { max-width: 92%; }
    .tune-full .tune-ly-foot { padding: var(--ym-spacer-size-l, 16px) var(--ym-spacer-size-xxxl, 32px) var(--ym-spacer-size-xxl, 24px); }
    [data-test-id="FULLSCREEN_PLAYER_FULLSCREEN_CONTENT"] { transition: transform .8s cubic-bezier(.2,.8,.2,1); }
    [data-tune-fs] [data-test-id="FULLSCREEN_PLAYER_FULLSCREEN_CONTENT"] { transform: translateX(-24vw); }
    .tune-ly-head { display: flex; align-items: center; gap: var(--ym-spacer-size-m, 12px); padding: var(--ym-spacer-size-l, 16px); }
    .tune-ly-head img { width: 48px; height: 48px; border-radius: var(--ym-radius-size-m, 8px); object-fit: cover; flex: none; }
    .tune-ly-head img:not([src]), .tune-ly-head img[src=""] { visibility: hidden; }
    .tune-ly-meta { flex: 1; min-width: 0; }
    .tune-ly-title { font-weight: var(--ym-font-weight-medium, 500); font-size: var(--ym-font-size-label-l, 16px); line-height: var(--ym-font-line-height-label-l, 1.5rem); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tune-ly-sub { font-size: var(--ym-font-size-label-m, 14px); line-height: var(--ym-font-line-height-label-m, 1.25rem); opacity: .5; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .tune-ly-tool { display: inline-flex; align-items: center; justify-content: center; border: 0; color: inherit; cursor: pointer; height: 32px; padding: 0 var(--ym-spacer-size-m, 12px); border-radius: var(--ym-radius-size-xxxl, 100px); background: rgba(255,255,255,.08); font: var(--ym-font-weight-medium, 500) 12px/1 var(--ym-font-text, system-ui, sans-serif); opacity: .7; transition: opacity .2s, background-color .2s, transform .2s; }
    .tune-ly-tool:hover { opacity: 1; background: rgba(255,255,255,.16); }
    .tune-ly-tool:active { transform: scale(.95); }
    .tune-ly-tool[data-act="close"] { width: 32px; padding: 0; font-size: 14px; flex: none; }
    .tune-ly-body { flex: 1; overflow-y: auto; padding: 35% var(--ym-spacer-size-xxl, 24px) 50%; scrollbar-width: none; mask-image: linear-gradient(transparent, #000 18%, #000 78%, transparent); }
    .tune-ly-body::-webkit-scrollbar { display: none; }
    [data-tune^="lyrics"].tune-on { color: var(--ym-controls-color-secondary-text-enabled_variant, #fff) !important; opacity: 1 !important; }
    .tune-ly-line { margin: 0 auto .7em; max-width: 86%; text-align: center; font-family: var(--ym-font-heading, var(--ym-font-text, inherit)); font-weight: var(--ym-font-weight-bold, 700); line-height: 1.25; letter-spacing: var(--ym-letter-spacing-m, normal); opacity: .22; cursor: pointer; transition: opacity .45s, transform .45s; transform-origin: center; }
    .tune-ly-line:hover { opacity: .65; }
    .tune-ly-line.tune-past { opacity: .3; }
    .tune-ly-line.tune-now { opacity: 1; transform: scale(1.12); }
    .tune-ly-line.tune-now + .tune-ly-line { opacity: .5; }
    .tune-ly-line.tune-gap { letter-spacing: .3em; }
    .tune-ly-plain { white-space: pre-wrap; text-align: center; font-family: var(--ym-font-heading, var(--ym-font-text, inherit)); font-weight: var(--ym-font-weight-bold, 700); line-height: 1.45; opacity: .85; }
    .tune-ly-status { padding: var(--ym-spacer-size-xxl, 24px); text-align: center; opacity: .5; font-size: var(--ym-font-size-label-l, 16px); font-weight: var(--ym-font-weight-medium, 500); line-height: 1.4; }
    .tune-ly-dots { display: flex; justify-content: center; gap: 10px; height: 40px; align-items: center; }
    .tune-ly-dots i { width: 12px; height: 12px; border-radius: 50%; background: currentColor; opacity: .1; animation: tune-ly-pulse .6s linear infinite alternate, tune-ly-fade .6s linear infinite alternate; }
    .tune-ly-dots i:nth-child(2) { animation-delay: .2s; }
    .tune-ly-dots i:nth-child(3) { animation-delay: .4s; }
    @keyframes tune-ly-pulse { 0% { transform: scale(1) translateY(50%); } 50% { transform: scale(1.3) translateY(0); } 100% { transform: scale(1) translateY(-50%); } }
    @keyframes tune-ly-fade { to { opacity: .5; } }
    .tune-ly-foot { display: flex; align-items: center; justify-content: space-between; gap: var(--ym-spacer-size-xs, 8px); padding: var(--ym-spacer-size-m, 12px) var(--ym-spacer-size-l, 16px); font-size: var(--ym-font-size-label-s, 13px); }
    .tune-ly-src { opacity: .4; }
    .tune-ly-shift { display: inline-flex; align-items: center; gap: var(--ym-spacer-size-xxxs, 4px); }
    .tune-ly-offset { padding: 0 var(--ym-spacer-size-xxs, 6px); font-weight: var(--ym-font-weight-medium, 500); }
    .tune-ly-offset:empty { display: none; }
    body.tune-no-select, body.tune-no-select * { user-select: none; }
    body.tune-no-select input, body.tune-no-select textarea, body.tune-no-select [contenteditable="true"], body.tune-no-select [contenteditable="true"] * { user-select: text; }
  `);

  // ---------------------------------------------------------------------------
  // Кнопка скорости встаёт перед кнопкой громкости и берёт её классы, поэтому
  // выглядит как родная и в обычном плеере, и в плеере «Моей волны».
  // ---------------------------------------------------------------------------
  const makeButton = (key, label, html, onClick) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.tune = key;
    btn.setAttribute('aria-label', label);
    btn.title = label;
    btn.innerHTML = html;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick(e, btn);
    });
    return btn;
  };

  // Классы выключенной кнопки Яндекса без класса «включена» — берём их у соседней
  // включённой кнопки того же вида (у неё те же классы плюс этот), иначе копия серая.
  const enabledClasses = (native) => {
    const own = native.className.split(/\s+/).filter(Boolean);
    for (const b of native.parentElement.children) {
      if (b === native || b.tagName !== 'BUTTON' || b.dataset.tune || b.disabled || b.dataset.disabled === 'true') continue;
      const cls = b.className.split(/\s+/).filter(Boolean);
      if (own.every((c) => cls.includes(c))) return cls.filter((c) => !c.includes('__') && !c.startsWith('tune-')).join(' ');
    }
    return native.className;
  };

  // Кнопка текста — копия родной кнопки Яндекса «Текст» (та выключена, когда у Яндекса
  // текста нет). Появляется, только если текст нашёлся в LRCLIB.
  const mountLyricsButtons = () => {
    const show = cfg.lyrics && lyricsAvailable;
    for (const native of document.querySelectorAll('[data-test-id$="SYNC_LYRICS_BUTTON"]:not([data-tune])')) {
      const prev = native.previousElementSibling;
      let ours = prev && prev.dataset.tune === 'lyrics' ? prev : null;
      const replace = show && (native.disabled || cfg.lyricsAlways);
      if (!replace) {
        if (ours) ours.remove();
        if (native.dataset.tuneHidden) {
          native.style.display = '';
          delete native.dataset.tuneHidden;
        }
        continue;
      }
      if (!ours) {
        ours = native.cloneNode(true);
        ours.removeAttribute('data-test-id');
        ours.removeAttribute('disabled');
        ours.removeAttribute('aria-disabled');
        ours.removeAttribute('aria-hidden');
        delete ours.dataset.disabled;
        ours.dataset.tune = 'lyrics';
        ours.setAttribute('aria-label', 'Текст песни');
        ours.title = 'Текст песни';
        ours.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleLyrics();
        });
        native.parentElement.insertBefore(ours, native);
      }
      native.style.display = 'none';
      native.dataset.tuneHidden = '1';
      const cls = `${enabledClasses(native)}${lyricsOpen ? ' tune-on' : ''}`;
      if (ours.className !== cls) ours.className = cls;
    }
  };

  // В полноэкранном плеере Яндекс не рисует кнопку «Текст», если у него текста нет, —
  // ставим свою туда же, где стоит родная (сетка 3×3, середина нижнего ряда).
  const SYNC_ICON = '/icons/sprite.svg#syncLyrics_xs';
  const setIcon = (el, href) => {
    const use = el.querySelector('svg use');
    if (use) use.setAttribute('xlink:href', href);
  };
  const mountFullscreenLyrics = () => {
    const show = cfg.lyrics && lyricsAvailable;
    for (const root of document.querySelectorAll('[class*="FullscreenPlayerDesktopControls_root"]')) {
      let ours = root.querySelector(':scope > [data-tune="lyrics-full"]');
      const ref = root.querySelector('[data-test-id="FULLSCREEN_PLAYER_CONTEXT_MENU_BUTTON"]');
      if (!show || !ref || root.querySelector('[data-test-id$="SYNC_LYRICS_BUTTON"]')) {
        if (ours) ours.remove();
        continue;
      }
      if (!ours) {
        ours = ref.cloneNode(true);
        ours.removeAttribute('data-test-id');
        ours.dataset.tune = 'lyrics-full';
        ours.setAttribute('aria-label', 'Текст песни');
        ours.title = 'Текст песни';
        setIcon(ours, SYNC_ICON);
        Object.assign(ours.style, { gridColumn: '2', gridRow: '3', alignSelf: 'flex-end', justifySelf: 'center', marginBlockEnd: 'var(--ym-spacer-size-l)' });
        ours.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (lyricsOpen && lyricsFull) return toggleLyrics(false);
          if (!lyricsOpen) toggleLyrics(true);
          toggleFull(true);
        });
        root.appendChild(ours);
      }
      ours.classList.toggle('tune-on', lyricsOpen);
    }
  };

  // Пункт «Текст песни» в меню «…» — только в меню, открытом из плеера: там речь о текущем треке.
  const PLAYER_MENU_BUTTONS = '[data-test-id="PLAYERBAR_DESKTOP_CONTEXT_MENU_BUTTON"], [data-test-id="FULLSCREEN_PLAYER_CONTEXT_MENU_BUTTON"]';
  let playerMenuAt = 0;
  document.addEventListener(
    'click',
    (e) => {
      if (e.target instanceof Element && e.target.closest(PLAYER_MENU_BUTTONS)) playerMenuAt = performance.now();
    },
    true
  );
  const mountMenuLyrics = () => {
    if (!cfg.lyrics || !lyricsAvailable || performance.now() - playerMenuAt > 2000) return;
    const menu = document.querySelector('[role="menu"]');
    const about = menu && menu.querySelector('[data-test-id="TRACK_CONTEXT_MENU_ABOUT_TRACK_BUTTON"]');
    if (!about || menu.querySelector('[data-tune="lyrics-menu"]')) return;
    const item = about.cloneNode(true);
    item.removeAttribute('data-test-id');
    item.dataset.tune = 'lyrics-menu';
    setIcon(item, SYNC_ICON);
    const label = item.querySelector('span') || item;
    for (const n of [...label.childNodes]) if (n.nodeType === Node.TEXT_NODE) n.remove();
    label.append('Текст песни');
    item.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      setTimeout(() => {
        toggleLyrics(true);
        if (fsModal()) toggleFull(true);
      }, 0);
    });
    about.parentElement.insertBefore(item, about);
  };

  const mountPlayerButtons = () => {
    mountLyricsButtons();
    mountFullscreenLyrics();
    for (const vol of document.querySelectorAll('[data-test-id="CHANGE_VOLUME_BUTTON"]')) {
      const anchor = vol.closest('[class*="ChangeVolume_root"]') || vol;
      const parent = anchor.parentElement;
      if (!parent) continue;
      const existing = parent.querySelector(':scope > [data-tune="speed"]');
      if (!cfg.speedControl) {
        if (existing) existing.remove();
        continue;
      }
      if (existing) continue;
      const btn = makeButton('speed', 'Скорость воспроизведения', `<span class="tune-speed-label">${fmtSpeed(speed)}</span>`, (e) => stepSpeed(e.shiftKey ? -1 : 1));
      btn.className = `${vol.className} tune-pb-btn`;
      parent.insertBefore(btn, anchor);
    }
  };

  // ---------------------------------------------------------------------------
  // Скорость
  // ---------------------------------------------------------------------------
  const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  const fmtSpeed = (v) => `${String(v).replace('.', ',')}×`;
  let speed = 1;
  try {
    speed = Number(localStorage.getItem('tune:speed')) || 1;
  } catch (e) {}
  // Интерфейс Яндекса сбрасывает скорость при переходах между страницами — пока кнопка
  // скорости включена, его вызовы setSpeed получают выбранное значение.
  let guarded = null;
  let speedWasOn = false;
  const guardSpeed = () => {
    const p = ym.player();
    if (!p || p === guarded || typeof p.setSpeed !== 'function') return;
    const orig = p.setSpeed;
    p.setSpeed = function (v, ...rest) {
      return orig.call(this, cfg.speedControl ? speed : v, ...rest);
    };
    guarded = p;
  };
  const applySpeed = () => {
    if (!cfg.speedControl) {
      if (speedWasOn && Math.abs((player.speed() || 1) - 1) > 0.001) player.speed(1);
      speedWasOn = false;
      return;
    }
    speedWasOn = true;
    guardSpeed();
    if (Math.abs((player.speed() || 1) - speed) > 0.001) player.speed(speed);
    document.querySelectorAll('.tune-speed-label').forEach((l) => (l.textContent = fmtSpeed(speed)));
  };
  const stepSpeed = (dir) => {
    const i = SPEEDS.indexOf(speed);
    speed = SPEEDS[(i < 0 ? 2 : i + dir + SPEEDS.length) % SPEEDS.length];
    try {
      localStorage.setItem('tune:speed', String(speed));
    } catch (e) {}
    applySpeed();
    T.toast(`Скорость ${fmtSpeed(speed)}`, { ms: 1200 });
  };

  // ---------------------------------------------------------------------------
  // Громкость колесом над плеером
  // ---------------------------------------------------------------------------
  const PLAYER_BARS = '[data-test-id="PLAYERBAR_DESKTOP"], [data-test-id="VIBE_PLAYERBAR"], [class*="PlayerBarDesktop_root"], [data-test-id="FULLSCREEN_PLAYER_MODAL"]';
  window.addEventListener(
    'wheel',
    (e) => {
      if (!cfg.wheelVolume || !(e.target instanceof Element) || !e.target.closest(PLAYER_BARS)) return;
      if (e.target.closest('[role="slider"], input[type="range"]')) return;
      const v = player.volume();
      if (typeof v !== 'number') return;
      e.preventDefault();
      const next = Math.min(1, Math.max(0, v + (e.deltaY < 0 ? 0.05 : -0.05)));
      player.volume(next);
      T.toast(`Громкость ${Math.round(next * 100)} %`, { ms: 900 });
    },
    { passive: false, capture: true }
  );

  // ---------------------------------------------------------------------------
  // Горячие клавиши
  // ---------------------------------------------------------------------------
  const typing = (el) => el instanceof Element && !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]');
  window.addEventListener('keydown', (e) => {
    if (!cfg.hotkeys || typing(e.target) || e.altKey || e.metaKey) return;
    const ctrl = e.ctrlKey;
    let handled = true;
    if (ctrl && e.code === 'ArrowRight') player.next();
    else if (ctrl && e.code === 'ArrowLeft') player.prev();
    else if (ctrl && (e.code === 'ArrowUp' || e.code === 'ArrowDown')) {
      const v = player.volume();
      if (typeof v === 'number') {
        const next = Math.min(1, Math.max(0, v + (e.code === 'ArrowUp' ? 0.05 : -0.05)));
        player.volume(next);
        T.toast(`Громкость ${Math.round(next * 100)} %`, { ms: 900 });
      }
    } else if (ctrl && e.code === 'KeyL' && cfg.lyrics && lyricsAvailable) toggleLyrics();
    else if (!ctrl && e.code === 'Space' && !e.repeat && !(e.target instanceof HTMLButtonElement)) {
      // Пробел — только если интерфейс сам его не обработал.
      setTimeout(() => {
        if (!e.defaultPrevented) player.toggle();
      }, 0);
      return;
    } else handled = false;
    if (handled) e.preventDefault();
  });

  // ---------------------------------------------------------------------------
  // Синхронный текст (LRCLIB)
  // ---------------------------------------------------------------------------
  let lyricsOpen = false;
  let panel = null;
  let lines = []; // { t, text }
  let plain = '';
  let lyricsFor = '';
  let status = '';
  const SEARCHING = 'Ищем текст…';
  let offset = 0;
  let userScrollAt = 0;
  let activeIndex = -1;
  const cache = new Map();

  let lyricsAvailable = false;
  const yandexHasSync = () => {
    const m = ym.meta();
    return !!(m && m.lyricsInfo && m.lyricsInfo.hasAvailableSyncLyrics);
  };
  const lyricsWanted = () => cfg.lyrics && !!ym.meta() && (cfg.lyricsAlways || !yandexHasSync());

  const parseLrc = (text) => {
    const out = [];
    for (const raw of text.split(/\r?\n/)) {
      const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:[.,]\d+)?)\]/g)];
      if (!stamps.length) continue;
      const body = raw.replace(/\[[^\]]*\]/g, '').trim();
      for (const s of stamps) out.push({ t: Number(s[1]) * 60 + Number(s[2].replace(',', '.')), text: body });
    }
    return out.sort((a, b) => a.t - b.t);
  };

  const lrclib = async (meta) => {
    const artist = (meta.artists || []).map((a) => a.name).join(', ');
    const firstArtist = ((meta.artists || [])[0] || {}).name || artist;
    const title = meta.title;
    const album = ((meta.albums || [])[0] || {}).title || '';
    const duration = Math.round((meta.durationMs || 0) / 1000);
    const q = (o) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const get = async (url) => {
      const r = await fetch(url, { headers: { 'Lrclib-Client': 'Tune Music' } });
      return r.ok ? r.json() : null;
    };
    let hit = await get(`https://lrclib.net/api/get?${q({ track_name: title, artist_name: firstArtist, album_name: album, duration })}`).catch(() => null);
    if (!hit || (!hit.syncedLyrics && !hit.plainLyrics)) {
      const list = (await get(`https://lrclib.net/api/search?${q({ track_name: title, artist_name: firstArtist })}`).catch(() => null)) || [];
      const scored = list
        .filter((x) => x.syncedLyrics || x.plainLyrics)
        .map((x) => ({ x, d: Math.abs((x.duration || 0) - duration) + (x.syncedLyrics ? 0 : 30) }))
        .sort((a, b) => a.d - b.d);
      hit = scored.length && scored[0].d < 45 ? scored[0].x : null;
    }
    return hit;
  };

  const loadLyrics = async () => {
    const meta = ym.meta();
    if (!meta) return;
    const key = String(meta.id);
    if (key === lyricsFor) return;
    lyricsFor = key;
    lines = [];
    plain = '';
    activeIndex = -1;
    status = SEARCHING;
    render();
    let hit = cache.get(key);
    if (hit === undefined) {
      hit = await lrclib(meta).catch(() => null);
      cache.set(key, hit);
    }
    if (lyricsFor !== key) return;
    lyricsAvailable = !!(hit && (hit.syncedLyrics || hit.plainLyrics));
    mountPlayerButtons();
    if (lyricsOpen && !lyricsAvailable) toggleLyrics(false);
    if (hit && hit.syncedLyrics) {
      lines = parseLrc(hit.syncedLyrics);
      status = '';
    } else if (hit && hit.plainLyrics) {
      plain = hit.plainLyrics;
      status = '';
    } else if (hit && hit.instrumental) {
      status = 'Инструментальный трек';
    } else {
      status = 'Текст не найден';
    }
    render();
  };

  const ensurePanel = () => {
    if (panel && panel.isConnected) return panel;
    panel = document.createElement('section');
    panel.id = 'tune-lyrics';
    panel.hidden = true;
    panel.innerHTML = `
      <div class="tune-ly-head">
        <img alt="" />
        <div class="tune-ly-meta"><div class="tune-ly-title"></div><div class="tune-ly-sub"></div></div>
        <div class="tune-ly-actions">
          <button class="tune-ly-tool" data-act="full"></button>
          <button class="tune-ly-tool" data-act="close" aria-label="Закрыть" title="Закрыть">✕</button>
        </div>
      </div>
      <div class="tune-ly-body"></div>
      <div class="tune-ly-foot">
        <span class="tune-ly-src">Синхронизация</span>
        <span class="tune-ly-shift">
          <button class="tune-ly-tool" data-act="earlier" title="Строки раньше">−0,5 с</button>
          <span class="tune-ly-offset"></span>
          <button class="tune-ly-tool" data-act="later" title="Строки позже">+0,5 с</button>
          <button class="tune-ly-tool tune-ly-fsonly" data-act="full"></button>
        </span>
      </div>`;
    panel.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') toggleLyrics(false);
      if (act === 'full') lyricsFull ? leaveFull() : toggleFull(true);
      if (act === 'earlier' || act === 'later') {
        offset = Math.round((offset + (act === 'later' ? 0.5 : -0.5)) * 10) / 10;
        renderOffset();
      }
      const line = e.target.closest('.tune-ly-line');
      if (line && line.dataset.t) player.seek(Math.max(0, Number(line.dataset.t) - offset));
    });
    panel.querySelector('.tune-ly-body').addEventListener('wheel', () => (userScrollAt = performance.now()), { passive: true });
    document.body.appendChild(panel);
    return panel;
  };

  const renderOffset = () => {
    if (!panel) return;
    panel.querySelector('.tune-ly-offset').textContent = offset ? `${offset > 0 ? '+' : ''}${String(offset).replace('.', ',')} с` : '';
  };

  const render = () => {
    if (!lyricsOpen) return;
    const p = ensurePanel();
    const meta = ym.meta();
    p.style.fontSize = `${cfg.lyricsFontSize || 22}px`;
    p.querySelector('img').src = meta ? ym.cover(meta, '100x100') : '';
    // Фон — средний цвет обложки, как у родного текста Яндекса в полноэкранном плеере.
    const bar = document.querySelector('[class*="PlayerBarDesktop"]');
    const avg = bar ? getComputedStyle(bar).getPropertyValue('--player-average-color-background').trim() : '';
    p.style.setProperty('--tune-ly-bg', avg || '');
    layout();
    p.querySelector('.tune-ly-title').textContent = meta ? meta.title : '';
    p.querySelector('.tune-ly-sub').textContent = meta ? (meta.artists || []).map((a) => a.name).join(', ') : '';
    const body = p.querySelector('.tune-ly-body');
    body.textContent = '';
    if (status) {
      const s = document.createElement('div');
      s.className = 'tune-ly-status';
      if (status === SEARCHING) {
        s.className = 'tune-ly-dots';
        s.innerHTML = '<i></i><i></i><i></i>';
        s.title = status;
      } else s.textContent = status;
      body.appendChild(s);
    } else if (lines.length) {
      for (const l of lines) {
        const el = document.createElement('p');
        el.className = 'tune-ly-line' + (l.text ? '' : ' tune-gap');
        el.dataset.t = String(l.t);
        el.textContent = l.text || '♪';
        body.appendChild(el);
      }
    } else if (plain) {
      const el = document.createElement('div');
      el.className = 'tune-ly-plain';
      el.textContent = plain;
      body.appendChild(el);
    }
    renderOffset();
    activeIndex = -1;
  };

  // Позиция: прогресс Яндекса + время с последнего обновления, пока играет.
  let lastPos = 0;
  let lastAt = 0;
  const position = () => {
    const prog = ym.progress();
    const pos = prog ? prog.position || 0 : 0;
    const now = performance.now();
    if (pos !== lastPos) {
      lastPos = pos;
      lastAt = now;
    }
    return player.isPlaying() ? lastPos + Math.min(1.5, (now - lastAt) / 1000) * (player.speed() || 1) : lastPos;
  };

  const frame = () => {
    if (lyricsOpen && lines.length && panel) {
      const t = position() + offset;
      let i = -1;
      for (let k = 0; k < lines.length; k++) {
        if (lines[k].t <= t + 0.05) i = k;
        else break;
      }
      if (i !== activeIndex) {
        const els = panel.querySelectorAll('.tune-ly-line');
        els.forEach((el, k) => {
          el.classList.toggle('tune-now', k === i);
          el.classList.toggle('tune-past', k < i);
        });
        activeIndex = i;
        const el = els[Math.max(0, i)];
        if (el && performance.now() - userScrollAt > 3000) {
          const body = panel.querySelector('.tune-ly-body');
          body.scrollTo({ top: el.offsetTop - body.clientHeight * 0.38, behavior: 'smooth' });
        }
      }
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Окно встаёт в область контента и, если включена тема, берёт у неё фон, размытие,
  // рамку, скругление и цвет текста — темы перекрашивают именно эту область.
  const layout = () => {
    if (!panel) return;
    const p = panel;
    const set = (k, v) => (v ? p.style.setProperty(k, v) : p.style.removeProperty(k));
    const main = document.querySelector('[class*="Content_main"]');
    const r = main && main.getBoundingClientRect();
    const placed = r && r.width > 0;
    set('--tune-ly-top', placed ? `${Math.round(r.top + 12)}px` : '');
    set('--tune-ly-bottom', placed ? `${Math.round(innerHeight - r.bottom + 12)}px` : '');
    set('--tune-ly-right', placed ? `${Math.round(innerWidth - r.right + 12)}px` : '');
    const c = main && document.querySelector('style[data-tune-addon]') ? getComputedStyle(main) : null;
    set('--tune-ly-surface', c ? `linear-gradient(${c.backgroundColor}, ${c.backgroundColor}), rgba(0,0,0,.18)` : '');
    set('--tune-ly-blur', c && c.backdropFilter !== 'none' ? c.backdropFilter : '');
    set('--tune-ly-border', c && c.borderTopStyle !== 'none' ? `${c.borderTopWidth} ${c.borderTopStyle} ${c.borderTopColor}` : '');
    set('--tune-ly-radius', c && c.borderTopLeftRadius !== '0px' ? c.borderTopLeftRadius : '');
    set('--tune-ly-shadow', c && c.boxShadow !== 'none' ? c.boxShadow : '');
    set('--tune-ly-fg', c ? c.color : '');
  };
  window.addEventListener('resize', () => lyricsOpen && layout());

  const FULL_ICONS = {
    open: '<path d="M10 2.5h3.5V6M6 13.5H2.5V10M13.5 2.5 9 7M2.5 13.5 7 9"/>',
    close: '<path d="M13.5 6H10V2.5M2.5 10H6v3.5M10 6l3.5-3.5M6 10l-3.5 3.5"/>',
  };
  // Весь экран — это полноэкранный плеер Яндекса с нашим текстом справа.
  const fsModal = () => document.querySelector('[data-test-id="FULLSCREEN_PLAYER_MODAL"]');
  let lyricsFull = false;
  let fsOpenedByUs = false; // плеер открыли мы — при выходе закрываем его и возвращаем окно
  let fsSeen = false;
  const markFs = () => {
    const m = fsModal();
    const on = lyricsOpen && lyricsFull && !!m;
    for (const el of document.querySelectorAll('[data-tune-fs]')) if (!on || el !== m) delete el.dataset.tuneFs;
    if (on && !m.dataset.tuneFs) m.dataset.tuneFs = '1';
  };
  const toggleFull = (force) => {
    const want = typeof force === 'boolean' ? force : !lyricsFull;
    if (want && !lyricsFull && !fsModal()) {
      const open = document.querySelector('[data-test-id="FULLSCREEN_PLAYER_BUTTON"]');
      if (!open) return;
      fsOpenedByUs = true;
      open.click();
    }
    if (!want && lyricsFull && fsOpenedByUs) {
      const m = fsModal();
      const close = m && m.querySelector('[data-test-id="FULLSCREEN_PLAYER_CLOSE_BUTTON"]');
      if (close) close.click();
    }
    if (!want) fsOpenedByUs = false;
    lyricsFull = want;
    fsSeen = false;
    const p = ensurePanel();
    p.classList.toggle('tune-full', lyricsFull);
    for (const btn of p.querySelectorAll('[data-act="full"]')) {
      btn.title = lyricsFull ? 'Свернуть' : 'На весь экран';
      btn.setAttribute('aria-label', btn.title);
      btn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${FULL_ICONS[lyricsFull ? 'close' : 'open']}</svg>`;
    }
    markFs();
    render();
  };
  // Выход из полного экрана: если плеер открыли мы — назад к окну, иначе просто прячем текст.
  const leaveFull = () => (fsOpenedByUs ? toggleFull(false) : toggleLyrics(false));

  // Открылось другое меню или окно Яндекса (очередь, «…», настройки звука) — убираем текст.
  const POPUPS = '[role="menu"], [role="dialog"]:not(.UserWidget-Dialog), [aria-modal="true"]';
  const openPopups = () =>
    [...document.querySelectorAll(POPUPS)].filter(
      (e) => !(panel && panel.contains(e)) && !(lyricsFull && e.dataset.testId === 'FULLSCREEN_PLAYER_MODAL') && e.getClientRects().length
    );
  let popupsSeen = new Set();
  let domCheck = 0;
  // Следит за страницей постоянно: сразу ставит кнопку в открывшийся полноэкранный плеер
  // и пункт в меню, а открытое окно текста убирает при появлении другого меню.
  const domWatch = new MutationObserver(() => {
    if (domCheck) return;
    domCheck = requestAnimationFrame(() => {
      domCheck = 0;
      mountFullscreenLyrics();
      mountMenuLyrics();
      if (!lyricsOpen) return;
      if (lyricsFull) {
        // Плеер закрыли кнопкой Яндекса — выходим из полного экрана вместе с ним.
        if (fsModal()) {
          fsSeen = true;
          markFs();
        } else if (fsSeen) {
          fsSeen = false;
          if (fsOpenedByUs) toggleFull(false);
          else toggleLyrics(false);
          return;
        }
      }
      const now = openPopups();
      if (now.some((e) => !popupsSeen.has(e))) toggleLyrics(false);
      popupsSeen = new Set(now);
    });
  });
  window.addEventListener(
    'keydown',
    (e) => {
      if (!lyricsOpen || e.key !== 'Escape' || typing(e.target) || openPopups().some((p) => !popupsSeen.has(p))) return;
      e.preventDefault();
      e.stopPropagation();
      if (lyricsFull) leaveFull();
      else toggleLyrics(false);
    },
    true
  );

  const toggleLyrics = (force) => {
    lyricsOpen = typeof force === 'boolean' ? force : !lyricsOpen;
    const p = ensurePanel();
    p.hidden = !lyricsOpen;
    if (lyricsOpen) {
      if (!p.querySelector('[data-act="full"] svg')) toggleFull(lyricsFull);
      render();
      popupsSeen = new Set(openPopups());
    } else if (lyricsFull) {
      // Полноэкранный плеер Яндекса остаётся открытым — убираем только текст.
      fsOpenedByUs = false;
      toggleFull(false);
    }
    markFs();
    mountPlayerButtons();
  };

  // Текст ищем сразу при смене трека: кнопка появляется, только если он есть.
  const refreshLyrics = () => {
    const meta = ym.meta();
    if (!meta || String(meta.id) === lyricsFor) return;
    lyricsAvailable = false;
    mountPlayerButtons();
    if (lyricsWanted()) loadLyrics();
    else {
      lyricsFor = String(meta.id);
      if (lyricsOpen) toggleLyrics(false);
    }
  };
  T.onTrack(() => {
    offset = 0;
    applySpeed();
    refreshLyrics();
  });

  // ---------------------------------------------------------------------------
  let watching = false;
  const apply = () => {
    adopt();
    if (!watching && document.body) {
      domWatch.observe(document.body, { childList: true, subtree: true });
      watching = true;
    }
    document.body && document.body.classList.toggle('tune-no-select', !!cfg.noSelect);
    if (!cfg.lyrics && lyricsOpen) toggleLyrics(false);
    if (cfg.lyrics) refreshLyrics();
    mountPlayerButtons();
    applySpeed();
  };
  window.addEventListener('tune:features', (e) => {
    cfg = e.detail || {};
    apply();
  });
  setInterval(() => {
    if (!document.body) return;
    apply();
  }, 1000);
})();
