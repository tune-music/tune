// Встроенные улучшения Tune: синхронный текст из LRCLIB, громкость колесом мыши,
// скорость воспроизведения, горячие клавиши, скачивание трека. Включаются в Tune → Настройки.
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
    [data-tune]:focus:not(:focus-visible), [data-tune].tune-mouse-focus:focus-visible { outline: none !important; box-shadow: none !important; }
    .tune-speed-label { font: 600 12px/1 system-ui, sans-serif; min-width: 26px; text-align: center; }
    /* В плеере «Моей волны» кнопки — круги 48×48: скорость тоже круг, иначе ряд перекашивается. */
    [data-test-id="VIBE_PLAYERBAR"] [data-tune="speed"] { width: 48px; height: 48px; padding: 0; flex: none; display: inline-flex; align-items: center; justify-content: center; }
    [data-test-id="VIBE_PLAYERBAR"] [data-tune="speed"] .tune-speed-label { min-width: 0; font-size: 11px; }
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
    /* Там, где полноэкранного плеера нет (главная «Моей волны»), — своя такая же страница. */
    #tune-lyrics.tune-full.tune-own {
      top: 0; left: 0; right: 0; bottom: 0; border-radius: 0; padding-top: var(--tune-ly-tb, 32px);
      display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr) auto;
      background: var(--tune-ly-bg);
    }
    /* Затемнение поверх цвета обложки: со светлой обложкой белый текст иначе не читается. */
    #tune-lyrics.tune-own::after { content: ''; position: absolute; inset: 0; z-index: -1; background: rgba(0,0,0,.4); pointer-events: none; }
    /* Страница — на всё окно, а прозрачная полоса заголовка с кнопками окна — поверх неё,
       иначе сверху просвечивает фон страницы. */
    body.tune-ly-own-on [class*="TitleBar_root"] { z-index: 2147481001 !important; }
    .tune-ly-art { display: none; }
    .tune-own .tune-ly-art { display: block; position: absolute; inset: -120px; z-index: -1; background: center / cover no-repeat; filter: blur(90px) saturate(1.4); opacity: .5; }
    .tune-own .tune-ly-head { display: flex; grid-row: 1 / 3; flex-direction: column; justify-content: center; text-align: center; gap: var(--ym-spacer-size-xxl, 24px); padding: 48px 32px; }
    .tune-own .tune-ly-head img { width: min(30vw, 50vh); height: min(30vw, 50vh); border-radius: var(--ym-radius-size-xl, 16px); box-shadow: 0 24px 64px rgba(0,0,0,.45); }
    .tune-own .tune-ly-meta { flex: none; max-width: 100%; }
    .tune-own .tune-ly-title { font-size: var(--ym-font-size-headline-m, 24px); font-weight: var(--ym-font-weight-bold, 700); line-height: 1.25; white-space: normal; }
    .tune-own .tune-ly-sub { margin-top: 6px; font-size: var(--ym-font-size-label-l, 16px); }
    .tune-own .tune-ly-head .tune-ly-actions { position: absolute; top: calc(var(--tune-ly-tb, 32px) + 12px); right: 16px; z-index: 1; }
    .tune-own .tune-ly-head [data-act="full"] { display: none; }
    .tune-own .tune-ly-foot { grid-column: 2; }
    /* Закрытие — та же анимация появления в обратную сторону. */
    #tune-lyrics.tune-closing { animation: tune-ly-out .25s cubic-bezier(.4,0,1,1) forwards; pointer-events: none; }
    #tune-lyrics.tune-full.tune-closing { animation-name: tune-ly-fs-out; }
    @keyframes tune-ly-out { to { opacity: 0; transform: translateY(16px); } }
    @keyframes tune-ly-fs-out { to { opacity: 0; transform: translateX(48px); } }
    /* Плеер Яндекса стоит на top: 50% со сдвигом transform: translate(-50%, -50%). При
       масштабе 125% половина высоты дробная, и сверху просвечивает полоска страницы в пиксель.
       Ставим его в 0 и гасим сдвиг через translate — сдвиги взаимно сокращаются ровно, а
       анимация открытия Яндекса (через transform) остаётся. Тонкую рамку тоже убираем. */
    [data-test-id="FULLSCREEN_PLAYER_MODAL"] { inset-block-start: 0 !important; inset-inline-start: 0 !important; translate: 50% 50%; border: 0 !important; }
    /* translate, а не transform: Яндекс сам ставит обложку через transform, сдвиг складывается с ним. */
    [data-test-id="FULLSCREEN_PLAYER_FULLSCREEN_CONTENT"] { transition: translate .8s cubic-bezier(.2,.8,.2,1); }
    [data-tune-fs] [data-test-id="FULLSCREEN_PLAYER_FULLSCREEN_CONTENT"] { translate: -25vw 0; }
    /* Очередь или текст Яндекса: обложку сдвигает сам Яндекс (на ту же четверть экрана),
       наш сдвиг не добавляется — иначе она уезжает на полэкрана. */
    [data-test-id="FULLSCREEN_PLAYER_FULLSCREEN_CONTENT"][class*="fullscreenContent_enter"] { translate: 0 0; }
    /* Смена нашего текста на очередь и обратно: обложка и там и там на одном месте —
       стоит, а не съезжает в центр и обратно. */
    [data-tune-handoff] [data-test-id="FULLSCREEN_PLAYER_FULLSCREEN_CONTENT"] { animation-duration: 0s !important; transition: none !important; }
    /* …но с лёгким покачиванием, как у переходов Яндекса: обложка и кнопки чуть уходят
       влево и возвращаются. Качается содержимое блока: анимация самого блока у Яндекса
       держит его на месте. */
    [data-tune-handoff] [data-test-id="FULLSCREEN_PLAYER_FULLSCREEN_CONTENT"] > * { animation: tune-fs-nudge .7s cubic-bezier(.2,.8,.2,1); }
    @keyframes tune-fs-nudge { 0%, 100% { translate: 0 0; } 40% { translate: -1.5vw 0; } }
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
    /* Управление треком: в окне — рядом с названием, на своей полноэкранной странице — на обложке. */
    .tune-ly-cover { position: relative; flex: none; border-radius: var(--ym-radius-size-m, 8px); }
    .tune-ly-ctrl { display: flex; align-items: center; gap: 4px; flex: none; }
    .tune-ly-ctrl .tune-ly-tool { width: 32px; padding: 0; }
    .tune-ly-ctrl [data-act="play"], .tune-ly-ctrl [data-act="play"]:hover { opacity: 1; background: var(--tune-ly-fg, #fff); color: rgba(0,0,0,.85); }
    .tune-ly-ctrl [data-act="play"]:hover { transform: scale(1.06); }
    .tune-ly-ico-pause { display: none; }
    .tune-playing .tune-ly-ico-pause { display: inline; }
    .tune-playing .tune-ly-ico-play { display: none; }
    .tune-ly-oncover { display: none; }
    .tune-own .tune-ly-mini { display: none; }
    .tune-own .tune-ly-cover { border-radius: var(--ym-radius-size-xl, 16px); }
    .tune-own .tune-ly-oncover { display: flex; position: absolute; inset: 0; justify-content: center; gap: 20px; border-radius: inherit; background: rgba(0,0,0,.35); opacity: 0; transition: opacity .25s; }
    .tune-own .tune-ly-cover:hover .tune-ly-oncover, .tune-own:not(.tune-playing) .tune-ly-oncover { opacity: 1; }
    .tune-own .tune-ly-oncover .tune-ly-tool { width: 56px; height: 56px; opacity: .9; background: rgba(255,255,255,.16); color: #fff; }
    .tune-own .tune-ly-oncover [data-act="play"] { width: 72px; height: 72px; background: #fff; color: #000; }
    .tune-own .tune-ly-oncover svg { width: 24px; height: 24px; }
    .tune-ly-body { flex: 1; overflow-y: auto; padding: 35% var(--ym-spacer-size-xxl, 24px) 50%; scrollbar-width: none; mask-image: linear-gradient(transparent, #000 18%, #000 78%, transparent); }
    .tune-ly-body::-webkit-scrollbar { display: none; }
    [data-tune^="lyrics"].tune-on { color: var(--ym-controls-color-secondary-text-enabled_variant, #fff) !important; opacity: 1 !important; }
    [data-tune^="lyrics"]:disabled { opacity: .35 !important; cursor: default; }
    .tune-ly-line { margin: 0 auto .7em; max-width: 86%; text-align: center; font-family: var(--ym-font-heading, var(--ym-font-text, inherit)); font-weight: var(--ym-font-weight-bold, 700); line-height: 1.25; letter-spacing: var(--ym-letter-spacing-m, normal); opacity: .22; cursor: pointer; transition: opacity .45s, transform .45s; transform-origin: center; }
    .tune-ly-line:hover { opacity: .65; }
    .tune-static .tune-ly-line, .tune-static .tune-ly-line:hover { opacity: .85; cursor: default; }
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
    .tune-pb-btn.tune-busy { opacity: .5; pointer-events: none; }
    /* Значок «без цензуры» — в ряд с меткой 18+ Яндекса, того же размера и цвета. */
    .tune-uc { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 18px; height: 18px; margin-inline-start: var(--ym-spacer-size-xxxs, 4px); vertical-align: middle; color: inherit; }
    .tune-uc svg { width: 15px; height: 15px; }
    .tune-uc-alone { position: absolute; inset-block-start: 50%; inset-inline-end: var(--ym-spacer-size-l, 16px); transform: translateY(-50%); z-index: 1; color: rgba(255,255,255,.7); }
    #tune-tip {
      position: fixed; z-index: 2147483002; pointer-events: none; max-width: 260px; padding: 6px 10px; border-radius: 8px;
      background: rgba(24,24,27,.96); color: #fafafa; border: 1px solid rgba(255,255,255,.1); box-shadow: 0 6px 20px rgba(0,0,0,.35);
      font: 500 12px/1.35 system-ui, sans-serif; opacity: 0; transform: translate(-50%, calc(-100% + 4px)); transition: opacity .12s, transform .12s;
    }
    #tune-tip.tune-visible { opacity: 1; transform: translate(-50%, -100%); }
    body.tune-no-select, body.tune-no-select * { user-select: none; }
    body.tune-no-select input, body.tune-no-select textarea, body.tune-no-select [contenteditable="true"], body.tune-no-select [contenteditable="true"] * { user-select: text; }
  `);

  // Кнопки Tune после клика мышью не держат фокус: иначе любая клавиша (например, Shift)
  // включает у них браузерную обводку фокуса. С клавиатуры они работают как прежде.
  document.addEventListener(
    'pointerdown',
    (e) => {
      const btn = e.target instanceof Element && e.target.closest('[data-tune]');
      if (!btn) return;
      btn.classList.add('tune-mouse-focus');
      setTimeout(() => btn.blur(), 0);
    },
    true
  );
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') document.querySelectorAll('.tune-mouse-focus').forEach((b) => b.classList.remove('tune-mouse-focus'));
  });

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

  // Кнопка текста — копия родной кнопки Яндекса «Текст»: открывает окно текста Tune,
  // а не страницу Яндекса. Появляется, когда текст нашёлся — у Яндекса или в LRCLIB.
  const mountLyricsButtons = () => {
    const show = cfg.lyrics && lyricsAvailable;
    for (const native of document.querySelectorAll('[data-test-id$="SYNC_LYRICS_BUTTON"]:not([data-tune])')) {
      const prev = native.previousElementSibling;
      let ours = prev && prev.dataset.tune === 'lyrics' ? prev : null;
      const replace = show;
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
          // В полноэкранном плеере текст открывается во весь экран, а не мини-окном.
          if (ours.closest('[data-test-id="FULLSCREEN_PLAYER_MODAL"]')) toggleFullLyrics();
          else toggleLyrics();
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
  // Пока текст ищется или его не нашлось, кнопка остаётся на месте — серой и неактивной.
  const lyricsButtonState = (btn) => {
    const off = !lyricsAvailable;
    if (btn.disabled !== off) btn.disabled = off;
    const title = !off ? 'Текст песни' : status === SEARCHING ? SEARCHING : 'Текст не найден';
    if (btn.title !== title) btn.title = title;
    btn.classList.toggle('tune-on', lyricsOpen && !off);
  };
  // Кнопка «Текст» в полноэкранном плеере: текст во весь экран или убрать его.
  const toggleFullLyrics = () => {
    if (other && lyricsOpen) return showCurrent();
    if (lyricsOpen && lyricsFull) return toggleLyrics(false);
    if (!lyricsOpen) toggleLyrics(true);
    toggleFull(true);
  };
  const mountFullscreenLyrics = () => {
    const show = cfg.lyrics;
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
          toggleFullLyrics();
        });
        root.appendChild(ours);
      }
      lyricsButtonState(ours);
    }
  };

  // В плеере «Моей волны» своей кнопки «Текст» нет вовсе, если у Яндекса текста нет, —
  // ставим свою перед «…», в стиле соседней кнопки громкости.
  const mountVibeLyrics = () => {
    const show = cfg.lyrics;
    for (const bar of document.querySelectorAll('[data-test-id="VIBE_PLAYERBAR"]')) {
      let ours = bar.querySelector('[data-tune="lyrics-vibe"]');
      const menu = bar.querySelector('[data-test-id="VIBE_CONTEXT_MENU_BUTTON"]');
      const ref = bar.querySelector('[data-test-id="CHANGE_VOLUME_BUTTON"]');
      if (!show || !menu || !ref || bar.querySelector('[data-test-id$="SYNC_LYRICS_BUTTON"]')) {
        if (ours) ours.remove();
        continue;
      }
      const anchor = menu.parentElement !== bar && !menu.parentElement.className ? menu.parentElement : menu;
      if (!ours) {
        ours = ref.cloneNode(true);
        ours.removeAttribute('data-test-id');
        ours.dataset.tune = 'lyrics-vibe';
        ours.setAttribute('aria-label', 'Текст песни');
        ours.title = 'Текст песни';
        ours.className = ref.className.split(/\s+/).filter((c) => c && !c.startsWith('ChangeVolume_')).join(' ');
        setIcon(ours, SYNC_ICON);
        ours.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          toggleLyrics();
        });
      }
      if (ours.nextElementSibling !== anchor) anchor.parentElement.insertBefore(ours, anchor);
      lyricsButtonState(ours);
    }
  };

  // Пункты «Текст песни» и «Скачать трек» в меню «…» — только в меню, открытом из плеера:
  // там речь о текущем треке.
  const PLAYER_MENU_BUTTONS =
    '[data-test-id="PLAYERBAR_DESKTOP_CONTEXT_MENU_BUTTON"], [data-test-id="FULLSCREEN_PLAYER_CONTEXT_MENU_BUTTON"], [data-test-id="VIBE_CONTEXT_MENU_BUTTON"]';
  let playerMenuAt = 0;
  // Трек, у которого открыли «…» в списке: его объект лежит в свойствах React у строки.
  let listMenuTrack = null;
  let listMenuAt = 0;
  const trackOfButton = (btn) => {
    const key = Object.keys(btn).find((k) => k.startsWith('__reactFiber'));
    let f = key && btn[key];
    for (let i = 0; f && i < 40; i++, f = f.return) {
      const t = f.memoizedProps && f.memoizedProps.track;
      if (t && t.id && t.title) return t;
    }
    return null;
  };
  // Меню Яндекса открываются уже на нажатии: click потом приходит в само меню, не в кнопку.
  for (const type of ['pointerdown', 'click', 'keydown']) {
    document.addEventListener(
      type,
      (e) => {
        if (!(e.target instanceof Element)) return;
        if (e.target.closest(PLAYER_MENU_BUTTONS)) playerMenuAt = performance.now();
        const listBtn = e.target.closest('[data-test-id="TRACK_CONTEXT_MENU_BUTTON"]');
        if (listBtn) {
          listMenuTrack = trackOfButton(listBtn);
          listMenuAt = performance.now();
        }
      },
      true
    );
  }
  const menuItem = (menu, ref, key, icon, text, run) => {
    const item = ref.cloneNode(true);
    item.removeAttribute('data-test-id');
    item.dataset.tune = key;
    setIcon(item, icon);
    const label = item.querySelector('span') || item;
    for (const n of [...label.childNodes]) if (n.nodeType === Node.TEXT_NODE) n.remove();
    label.append(text);
    item.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
      setTimeout(run, 0);
    });
    return item;
  };
  // «Текст песни» в меню «…» любого трека в списке — всегда наш: свой пункт Яндекса
  // («Показать текст песни») прячем. Текст ищется по всем источникам, в том числе у Яндекса.
  const mountListLyricsItem = () => {
    const menu = document.querySelector('[role="menu"]');
    if (!menu || !cfg.lyrics || menu.querySelector('[data-tune="lyrics-menu"]')) return;
    const about = menu.querySelector('[data-test-id="TRACK_CONTEXT_MENU_ABOUT_TRACK_BUTTON"]');
    const ref = about || [...menu.querySelectorAll('[role="menuitem"]')].pop();
    if (!ref) return;
    const track = listMenuTrack;
    const item = menuItem(menu, ref, 'lyrics-menu', SYNC_ICON, 'Текст песни', () => {
      const meta = ym.meta();
      if (meta && String(meta.id) === String(track.id)) {
        if (other) showCurrent();
        if (!lyricsOpen) toggleLyrics(true);
      } else showOther(trackMeta(track));
    });
    if (about) about.before(item);
    else ref.after(item);
  };
  // Пункты текста Яндекса («Показать текст песни» и т. п.) открывают его панель, порой
  // пустую, — рядом с нашим «Текст песни» они лишние. Прячем, а не удаляем: элементы меню
  // принадлежат React.
  const YM_SYNC_LYRICS_ITEMS =
    '[data-test-id="TRACK_CONTEXT_MENU_LYRICS_BUTTON"], [data-test-id="TRACK_CONTEXT_MENU_SHOW_SYNC_LYRICS_BUTTON"], [data-test-id="TRACK_CONTEXT_MENU_HIDE_SYNC_LYRICS_BUTTON"], [data-test-id="VIBE_CONTEXT_MENU_SYNC_LYRICS_ITEM"]';
  const hideYandexLyricsItems = () => {
    const menu = document.querySelector('[role="menu"]');
    if (!menu || !cfg.lyrics || !menu.querySelector('[data-tune="lyrics-menu"]')) return;
    for (const el of menu.querySelectorAll(YM_SYNC_LYRICS_ITEMS)) if (el.style.display !== 'none') el.style.display = 'none';
  };
  const mountMenuItems = () => {
    mountMenuItemsInner();
    mountSpoofMenuItem();
    hideYandexLyricsItems();
  };
  const mountMenuItemsInner = () => {
    if (performance.now() - listMenuAt < 2000 && listMenuTrack) return mountListLyricsItem();
    if (performance.now() - playerMenuAt > 2000) return;
    const menu = document.querySelector('[role="menu"]');
    if (!menu) return;
    // Обычно — перед «О треке»; в меню «Моей волны» его нет, там — после «Перейти к исполнителю».
    const about = menu.querySelector('[data-test-id="TRACK_CONTEXT_MENU_ABOUT_TRACK_BUTTON"]');
    const ref = about || menu.querySelector('[data-test-id="TRACK_CONTEXT_MENU_NAVIGATE_TO_ARTIST"]') || [...menu.querySelectorAll('[role="menuitem"]')].pop();
    if (!ref) return;
    let last = about ? null : ref;
    const place = (item) => {
      if (about) about.before(item);
      else last.after(item);
      last = item;
    };
    const lyricsItem = menu.querySelector('[data-tune="lyrics-menu"]');
    if (lyricsItem) last = about ? null : lyricsItem;
    else if (cfg.lyrics && lyricsAvailable)
      place(
        menuItem(menu, ref, 'lyrics-menu', SYNC_ICON, 'Текст песни', () => {
          toggleLyrics(true);
          if (fsModal()) toggleFull(true);
        })
      );
    if (cfg.download && !menu.querySelector('[data-tune="download-menu"]')) place(menuItem(menu, ref, 'download-menu', DOWNLOAD_SPRITE, 'Скачать файл', () => downloadTrack()));
  };

  const mountPlayerButtons = () => {
    mountLyricsButtons();
    mountFullscreenLyrics();
    mountVibeLyrics();
    for (const vol of document.querySelectorAll('[data-test-id="CHANGE_VOLUME_BUTTON"]')) {
      const anchor = vol.closest('[class*="ChangeVolume_root"]') || vol;
      const parent = anchor.parentElement;
      if (!parent) continue;
      const dl = parent.querySelector(':scope > [data-tune="download"]');
      if (!cfg.download || !cfg.downloadButton) {
        if (dl) dl.remove();
      } else if (!dl) {
        const btn = makeButton('download', 'Скачать трек', DOWNLOAD_ICON, () => downloadTrack());
        btn.className = `${vol.className} tune-pb-btn`;
        parent.insertBefore(btn, anchor);
      }
      const existing = parent.querySelector(':scope > [data-tune="speed"]');
      if (!cfg.speedControl) {
        if (existing) existing.remove();
        continue;
      }
      if (existing) continue;
      const btn = makeButton('speed', 'Скорость: клик — быстрее, Shift+клик — медленнее, колесо — по шагу, правый клик — 1×', `<span class="tune-speed-label">${fmtSpeed(speed)}</span>`, (e) => stepSpeed(e.shiftKey ? -1 : 1));
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        stepSpeed(0);
      });
      btn.className = `${vol.className} tune-pb-btn`;
      parent.insertBefore(btn, anchor);
    }
  };

  // ---------------------------------------------------------------------------
  // Скачивание трека. Ссылку и ключ файла плеер Яндекса уже получил (get-file-info) —
  // они лежат у текущего трека. Качает и расшифровывает Tune (download.rs), сюда
  // приходит ход загрузки событием tune:download.
  // ---------------------------------------------------------------------------
  const DOWNLOAD_SPRITE = '/icons/sprite.svg#download_xxs';
  const DOWNLOAD_ICON =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14"/></svg>';
  const downloads = new Map(); // id → карточка T.task
  let pending = null; // название и обложка, пока команда не вернула id
  const fmtMb = (b) => `${(b / 1048576).toFixed(1).replace('.', ',')} МБ`;
  const trackName = (meta) => {
    const artists = (meta.artists || []).map((a) => a.name).filter(Boolean).join(', ');
    const title = meta.version ? `${meta.title} (${meta.version})` : meta.title;
    return artists ? `${artists} — ${title}` : title;
  };
  const dlCard = (id, name, cover) => {
    const card = T.task({ text: name, info: 'Подключение…', cover });
    downloads.set(id, card);
    return card;
  };
  const setBusy = (on) => document.querySelectorAll('[data-tune="download"]').forEach((b) => b.classList.toggle('tune-busy', on));
  const downloadTrack = async () => {
    const meta = ym.meta();
    const entity = ym.entity();
    const src = entity && entity.mediaSourceData;
    const data = src && src.data;
    if (!meta || !data || 'error' in data || !data.urls || !data.urls[0]) {
      T.toast('Файл трека ещё не получен — включите трек и попробуйте снова', { error: true });
      return;
    }
    let url = data.urls[0];
    try {
      url = String(src.src || url).split('#')[0];
    } catch (e) {}
    if (url.startsWith('blob:')) {
      T.toast('Этот трек играет из кеша Яндекса — скачать его отсюда нельзя', { error: true });
      return;
    }
    const name = trackName(meta);
    const cover = ym.cover(meta, '100x100');
    setBusy(true);
    pending = { name, cover };
    try {
      const key = data.transport === 'encraw' ? data.key || null : null;
      const id = await T.invoke('page_download', { url, key, codec: String(data.codec || ''), name });
      if (!downloads.has(id)) dlCard(id, name, cover);
    } catch (e) {
      T.toast(String(e), { error: true });
    } finally {
      pending = null;
      setTimeout(() => setBusy(false), 600);
    }
  };
  window.addEventListener('tune:download', (e) => {
    const ev = e.detail || {};
    const card = downloads.get(ev.id) || dlCard(ev.id, ev.name || (pending && pending.name) || 'Трек', pending && pending.cover);
    if (ev.state === 'progress') {
      const known = ev.total > 0;
      card.set({
        progress: known ? ev.loaded / ev.total : null,
        info: known ? `${Math.floor((ev.loaded / ev.total) * 100)} %` : fmtMb(ev.loaded || 0),
        title: known ? `${fmtMb(ev.loaded)} из ${fmtMb(ev.total)}` : '',
      });
    } else if (ev.state === 'done') {
      card.set({
        ok: true,
        progress: 1,
        info: 'Показать',
        title: `Сохранено в «Загрузки»: ${ev.file || ''}`,
        onClick: () => T.invoke('page_reveal_download', { id: ev.id }).catch((err) => T.toast(String(err), { error: true })),
      });
      card.close(6000);
      downloads.delete(ev.id);
    } else if (ev.state === 'error') {
      card.set({ error: true, progress: undefined, text: ev.error || 'Не удалось скачать', info: '', title: ev.name || '' });
      card.close(8000);
      downloads.delete(ev.id);
    }
  });

  // ---------------------------------------------------------------------------
  // Обновление Tune: при запуске Tune находит новую версию и спрашивает здесь —
  // «Обновить» скачивает и ставит её сам, «Пропустить» больше не спрашивает о ней.
  // ---------------------------------------------------------------------------
  let updateCard = null;
  const updateButtons = (release) => {
    const row = document.createElement('div');
    row.className = 'tune-toast-actions';
    const skip = document.createElement('button');
    skip.textContent = 'Пропустить';
    skip.onclick = () => {
      T.invoke('skip_update', { version: release.version }).catch((err) => T.toast(String(err), { error: true }));
    };
    const go = document.createElement('button');
    go.className = 'tune-primary';
    go.textContent = 'Обновить';
    go.onclick = () => {
      row.remove();
      updateCard.set({ text: `Скачивание Tune ${release.version}`, info: '', progress: null, error: false });
      // Ошибка придёт и событием tune:update.
      T.invoke('install_update').catch(() => {});
    };
    row.append(skip, go);
    return row;
  };
  window.addEventListener('tune:update', (e) => {
    const ev = e.detail || {};
    if (ev.state === 'available') {
      if (updateCard && updateCard.el.isConnected) return;
      const r = ev.release;
      updateCard = T.task({ text: `Вышел Tune ${r.version}`, info: ev.current ? `у вас ${ev.current}` : '', progress: undefined, title: r.notes || '' });
      updateCard.el.classList.add('tune-nocover');
      updateCard.el.appendChild(updateButtons(r));
      return;
    }
    if (!updateCard) return;
    if (ev.state === 'skipped') {
      updateCard.close();
      updateCard = null;
    } else if (ev.state === 'progress') {
      const known = ev.total > 0;
      updateCard.set({ progress: known ? ev.loaded / ev.total : null, info: known ? `${Math.floor((ev.loaded / ev.total) * 100)} %` : fmtMb(ev.loaded || 0) });
    } else if (ev.state === 'installing') {
      updateCard.set({ ok: true, progress: 1, text: 'Установка — Tune перезапустится', info: '' });
    } else if (ev.state === 'error') {
      updateCard.set({ error: true, progress: undefined, text: ev.error || 'Не удалось обновить Tune', info: '' });
      updateCard.close(8000);
      updateCard = null;
    }
  });

  // ---------------------------------------------------------------------------
  // Без цензуры — по открытым данным FckCensor (github.com/Hazzz895/FckCensorData).
  // Аудио: для треков из списка ответ get-file-info подменяется ссылкой на версию без
  // цензуры, плеер Яндекса сам качает и играет её, как обычный файл (mp3, transport=raw).
  // Данные: в ответах API Яндекса у треков и альбомов из списка подменяются названия,
  // исполнители, обложки и длительность, а в альбомы возвращаются удалённые треки.
  // Список и файлы лежат на GitHub; если он недоступен — берём их с зеркала jsDelivr.
  // Сам аддон FckCensor 2 требует SDK PulseSync 2, которого в Tune нет.
  // ---------------------------------------------------------------------------
  const origFetch = window.fetch.bind(window);
  const UC_MIRRORS = ['https://raw.githubusercontent.com/Hazzz895/FckCensorData/refs/heads/main/', 'https://cdn.jsdelivr.net/gh/Hazzz895/FckCensorData@main/'];
  // Список дополняют авторы FckCensor — перечитываем его раз в час, пока Tune открыт.
  const UNCENSOR_TTL = 3600 * 1000;
  let cfgReady;
  const cfgLoaded = new Promise((r) => (cfgReady = r));
  // files: id → ссылка на файл без цензуры; tracks / albums: id → подменённые поля.
  let uc = null;
  let uncensorAt = 0;
  let uncensorLoading = null;
  // Зеркало, с которого в последний раз пришёл список, — с него же качаем и треки.
  let ucMirror = 0;
  const ucUrl = (url) => {
    const full = /^https?:\/\//.test(url) ? url : `https://${url}`;
    return ucMirror && full.startsWith(UC_MIRRORS[0]) ? UC_MIRRORS[ucMirror] + full.slice(UC_MIRRORS[0].length) : full;
  };
  // Свои подмены из окна «Подменить…»: { track | album | artist: { id: поля } }. Поля — как
  // у FckCensor (title / name, artists, coverUri, durationMs, volumes, releaseDate), плюс
  // audio — свой файл трека, insert — треки и альбомы в профиле исполнителя, noAuto —
  // автоподмена из списка для этого id выключена. Свои поля важнее автоматических.
  const OWN_KEY = 'tune:spoofs';
  let own = { track: {}, album: {}, artist: {} };
  try {
    const v = JSON.parse(localStorage.getItem(OWN_KEY) || 'null');
    if (v && typeof v === 'object') own = { track: {}, album: {}, artist: {}, ...v };
  } catch (e) {}
  // Прежний пункт «Играть с цензурой» выключал подмену без возможности вернуть её у
  // скрытых Яндексом треков — его настройку сбрасываем.
  try {
    localStorage.removeItem('tune:uncensor-off');
  } catch (e) {}
  const saveOwn = () => {
    try {
      localStorage.setItem(OWN_KEY, JSON.stringify(own));
      return true;
    } catch (e) {
      T.toast('Не удалось сохранить подмену', { error: true });
      return false;
    }
  };
  const spoofFileUrl = (name) => `${location.origin}/__tune/spoof/${name}`;
  const AUTO_MAPS = { track: 'tracks', album: 'albums', artist: 'artists' };
  const autoOn = (type, id) => !(own[type][id] && own[type][id].noAuto);
  const autoSpoof = (type, id) => (uc && autoOn(type, id) && uc[AUTO_MAPS[type]].get(String(id))) || null;
  const spoofOf = (type, id) => {
    id = String(id);
    const auto = autoSpoof(type, id);
    const o = own[type][id];
    if (!auto && !o) return null;
    const { noAuto, audio, insert, ...mine } = o || {};
    const merged = { ...auto, ...mine };
    return Object.keys(merged).length ? merged : null;
  };
  // Файл трека: свой из окна подмены, иначе версия без цензуры из списка.
  const AUDIO_CODECS = { mp3: 'mp3', flac: 'flac', ogg: 'ogg', opus: 'ogg', wav: 'wav', m4a: 'aac', aac: 'aac' };
  const ucFile = (id) => {
    if (!id) return null;
    id = String(id);
    const o = own.track[id];
    if (o && o.audio && o.audio.file) return { url: spoofFileUrl(o.audio.file), codec: o.audio.codec || 'mp3', own: true };
    const url = uc && autoOn('track', id) && uc.files.get(id);
    return url ? { url: ucUrl(url), codec: 'mp3' } : null;
  };
  // Треки и альбомы, добавленные в профиль исполнителя: свои или из списка.
  const insertsOf = (artistId) => {
    artistId = String(artistId);
    const o = own.artist[artistId];
    if (o && o.insert) return o.insert;
    return (uc && autoOn('artist', artistId) && uc.inserts.get(artistId)) || null;
  };

  // Формат list_v2: в sources — подмены полей (tracks, albums) и хранилища файлов
  // (tracksStorages: trackIds по шаблону ссылки или tracks: id → номер файла / ссылка).
  // Как у FckCensor: поля — из первого источника, где они есть, файлы — из последнего.
  const parseUncensor = (list) => {
    const files = new Map();
    const tracks = new Map();
    const albums = new Map();
    const artists = new Map();
    const inserts = new Map();
    const isId = (id) => /^\d+$/.test(id);
    const idList = (list) => (Array.isArray(list) ? list : []).map((x) => String(x && typeof x === 'object' ? x.releaseId || x.id : x)).filter(isId);
    const addTrack = (id, data) => tracks.set(id, { ...tracks.get(id), ...data });
    for (const src of (list && list.sources) || []) {
      for (const [id, t] of Object.entries(src.tracks || {})) if (isId(id) && t && typeof t === 'object' && !tracks.has(id)) tracks.set(id, { ...t });
      for (const [id, a] of Object.entries(src.albums || {})) if (isId(id) && a && typeof a === 'object' && !albums.has(id)) albums.set(id, a);
      for (const [id, a] of Object.entries(src.artists || {})) if (isId(id) && a && typeof a === 'object' && !artists.has(id)) artists.set(id, a);
      for (const [id, ins] of Object.entries(src.artistsInsertions || {}))
        if (isId(id) && ins && typeof ins === 'object' && !inserts.has(id)) inserts.set(id, { tracks: idList(ins.tracks), albums: idList(ins.albums) });
      for (const st of src.tracksStorages || []) {
        if (!st) continue;
        const tpl = typeof st.urlTemplate === 'string' ? st.urlTemplate : '';
        const resolve = (raw) => (typeof raw === 'number' || (typeof raw === 'string' && !raw.includes('://'))) && tpl ? tpl.replace('%%', String(raw)) : raw;
        if (tpl)
          for (const t of st.trackIds || []) {
            const id = String(t && typeof t === 'object' ? t.id : t);
            if (!isId(id)) continue;
            files.set(id, tpl.replace('%%', id));
            if (t && typeof t.durationMs === 'number') addTrack(id, { durationMs: t.durationMs });
          }
        for (const [id, r] of Object.entries(st.tracks || {})) {
          if (!isId(id)) continue;
          const url = resolve(r && typeof r === 'object' ? r.url : r);
          if (typeof url === 'string' && url) files.set(id, url);
          if (r && typeof r.durationMs === 'number') addTrack(id, { durationMs: r.durationMs });
        }
      }
    }
    // Треки подменённого альбома без своей обложки берут обложку альбома.
    for (const a of albums.values()) {
      if (!a.coverUri || !Array.isArray(a.volumes)) continue;
      for (const ref of a.volumes.flat()) {
        const id = String(ref && ref.id);
        if (isId(id) && !(tracks.get(id) || {}).coverUri) addTrack(id, { coverUri: a.coverUri });
      }
    }
    return { files, tracks, albums, artists, inserts };
  };
  const fetchUncensor = async () => {
    let lastErr;
    // Сначала зеркало, которое сработало в прошлый раз.
    for (const i of [ucMirror, ...UC_MIRRORS.keys()].filter((v, k, a) => a.indexOf(v) === k)) {
      try {
        // no-cache, а не no-store: браузер переспрашивает с ETag, и неизменный список
        // приходит ответом 304 без тела.
        const r = await origFetch(`${UC_MIRRORS[i]}list_v2.json`, { cache: 'no-cache', signal: AbortSignal.timeout(15000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const list = await r.json();
        ucMirror = i;
        try {
          localStorage.setItem('tune:uncensor', JSON.stringify({ at: Date.now(), mirror: i, list }));
        } catch (e) {}
        uc = parseUncensor(list);
        uncensorAt = Date.now();
        badgesDirty = true;
        return uc;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  };
  const readUncensorCache = () => {
    if (uc) return;
    try {
      const cached = JSON.parse(localStorage.getItem('tune:uncensor') || 'null');
      if (!cached || !cached.list) return;
      uc = parseUncensor(cached.list);
      uncensorAt = cached.at || 0;
      ucMirror = UC_MIRRORS[cached.mirror] ? cached.mirror : 0;
      badgesDirty = true;
    } catch (e) {}
  };
  // Свежий список — сразу; устаревший — отдаём, а новый качаем в фоне.
  const loadUncensor = () => {
    readUncensorCache();
    if (uc && Date.now() - uncensorAt < UNCENSOR_TTL) return Promise.resolve(uc);
    if (!uncensorLoading)
      uncensorLoading = fetchUncensor()
        .catch((e) => {
          console.warn('[tune] список FckCensor', e);
          uncensorAt = Date.now() - UNCENSOR_TTL + 10 * 60 * 1000; // повтор через 10 минут
          return uc;
        })
        .finally(() => (uncensorLoading = null));
    return uc ? Promise.resolve(uc) : uncensorLoading.then((v) => v || parseUncensor(null));
  };
  // Значок «без цензуры» у названий треков из списка: в списках, поиске и плеере.
  let badgesDirty = true;
  const UC_TITLE = 'Без цензуры: играет оригинальная версия (список FckCensor)';
  const UC_ICON =
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7.25" width="10" height="6.75" rx="1.75"/><path d="M5.5 7.25V5.1a2.5 2.5 0 0 1 4.85-.85"/><path d="M8 10v1.25"/></svg>';
  // id трека: из ссылки «/track/<id>», иначе из свойств React у строки.
  const trackIdOf = (el) => {
    const a = el.closest('a[href*="/track/"]') || el.querySelector('a[href*="/track/"]');
    const m = a && a.getAttribute('href').match(/\/track\/(\d+)/);
    if (m) return m[1];
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
    let f = key && el[key];
    for (let i = 0; f && i < 25; i++, f = f.return) {
      const p = f.memoizedProps;
      if (!p || typeof p !== 'object') continue;
      for (const v of [p, p.track, p.entity, p.trackData, p.data, p.meta]) {
        if (v && typeof v === 'object' && v.id != null && typeof v.title === 'string' && Array.isArray(v.artists) && /^\d+$/.test(String(v.id))) return String(v.id);
      }
    }
    return '';
  };
  const ucBadge = () => {
    const b = document.createElement('span');
    b.className = 'tune-uc';
    b.dataset.tune = 'uc';
    b.setAttribute('aria-label', UC_TITLE);
    b.innerHTML = UC_ICON;
    return b;
  };
  // Место значка: перед меткой 18+, если она есть (в «Моей волне» она в своём контейнере
  // у правого края), иначе сразу после названия.
  const placeBadge = (el, badge) => {
    const parent = el.parentElement;
    const box = parent.querySelector(':scope > [class*="explicitMarkContainer"]');
    const mark = box ? null : parent.querySelector(':scope > [data-test-id="EXPLICIT_MARK_ICON"]');
    const vibe = el.dataset.testId === 'VIBE_PLAYERBAR_TRACK_NAME';
    if (box) {
      if (badge.parentElement !== box || box.firstElementChild !== badge) box.prepend(badge);
    } else if (mark) {
      if (mark.previousElementSibling !== badge) mark.before(badge);
    } else if (el.nextElementSibling !== badge) el.after(badge);
    badge.classList.toggle('tune-uc-alone', vibe && !box);
  };
  // Своя подсказка: над названием в «Моей волне» лежит ползунок перемотки, и обычный title
  // до значка не доходит. Ищем значок под курсором по координатам.
  let tip = null;
  let tipFor = null;
  const hideTip = () => {
    if (tip) tip.classList.remove('tune-visible');
    tipFor = null;
  };
  document.addEventListener(
    'pointermove',
    (e) => {
      const badges = document.querySelectorAll('[data-tune="uc"]');
      let hit = null;
      for (const b of badges) {
        const r = b.getBoundingClientRect();
        if (e.clientX >= r.left - 2 && e.clientX <= r.right + 2 && e.clientY >= r.top - 2 && e.clientY <= r.bottom + 2) {
          hit = b;
          break;
        }
      }
      if (!hit) return tipFor && hideTip();
      if (hit === tipFor) return;
      tipFor = hit;
      if (!tip || !tip.isConnected) {
        tip = document.createElement('div');
        tip.id = 'tune-tip';
        tip.setAttribute('role', 'tooltip');
        document.body.appendChild(tip);
      }
      tip.textContent = UC_TITLE;
      const r = hit.getBoundingClientRect();
      const half = Math.min(130, tip.offsetWidth / 2 || 130);
      tip.style.left = `${Math.max(half + 8, Math.min(innerWidth - half - 8, r.left + r.width / 2))}px`;
      tip.style.top = `${r.top - 6}px`;
      requestAnimationFrame(() => tip.classList.add('tune-visible'));
    },
    { passive: true }
  );
  window.addEventListener('scroll', hideTip, true);

  const UC_TARGETS = '[data-test-id="TRACK_TITLE"], [data-test-id="VIBE_PLAYERBAR_TRACK_NAME"]';
  const mountUncensorBadges = () => {
    if (!cfg.uncensor) {
      document.querySelectorAll('[data-tune="uc"]').forEach((b) => b.remove());
      return;
    }
    const meta = ym.meta();
    const current = meta ? String(meta.id) : '';
    for (const el of document.querySelectorAll(UC_TARGETS)) {
      let id;
      if (el.dataset.testId === 'VIBE_PLAYERBAR_TRACK_NAME') id = current;
      else {
        // Списки переиспользуют строки — id пересчитываем, только когда строка сменилась.
        const key = `${el.getAttribute('href') || ''}|${el.textContent}`;
        if (badgesDirty || el.dataset.tuneUcKey !== key) {
          el.dataset.tuneUcKey = key;
          el.dataset.tuneUcId = trackIdOf(el);
        }
        id = el.dataset.tuneUcId;
      }
      const has = !!ucFile(id);
      const parent = el.parentElement;
      let badge = parent && parent.querySelector(':scope > [data-tune="uc"], :scope > [class*="explicitMarkContainer"] > [data-tune="uc"]');
      if (!has) {
        if (badge) badge.remove();
        continue;
      }
      badge = badge || ucBadge();
      placeBadge(el, badge);
    }
    badgesDirty = false;
  };

  // ---------------------------------------------------------------------------
  // API Яндекса от имени клиента: заголовки (авторизацию) берём у его же последнего
  // запроса. Ответы — без подмены: окну подмены нужны исходные данные.
  // ---------------------------------------------------------------------------
  let apiHeaders = null;
  let apiBase = 'https://api.music.yandex.net/';
  let myUid = '';
  const apiFetch = async (path, init = {}) => {
    const headers = new Headers(apiHeaders || undefined);
    headers.delete('content-type');
    headers.delete('content-length');
    const r = await origFetch(apiBase + path, { ...init, headers, credentials: 'include' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    return j && typeof j === 'object' && 'result' in j && 'invocationInfo' in j ? j.result : j;
  };
  const apiTracks = async (ids) => {
    const out = [];
    for (let i = 0; i < ids.length; i += 250) {
      const form = new FormData();
      for (const id of ids.slice(i, i + 250)) form.append('trackIds', id);
      const got = await apiFetch('tracks', { method: 'POST', body: form });
      if (Array.isArray(got)) out.push(...got);
    }
    return out;
  };
  const apiAlbums = async (ids) => (ids.length ? (await apiFetch(`albums?albumIds=${ids.join(',')}`)) || [] : []);
  const uidOf = async () => {
    if (myUid) return myUid;
    const s = await apiFetch('account/status');
    myUid = String((s && s.account && s.account.uid) || '');
    return myUid;
  };

  // ---------------------------------------------------------------------------
  // Ручная подмена — пункт «Подменить трек / альбом / исполнителя» в меню «…».
  // Окно как у FckCensor: название, исполнители, обложка, свой аудиофайл, список треков
  // альбома, треки и альбомы в профиле исполнителя, автоподмена из списка и поля JSON.
  // ---------------------------------------------------------------------------
  const EDIT_SPRITE = '/icons/sprite.svg#edit_xxs';
  const TYPE_WORD = { track: 'трек', album: 'альбом', artist: 'исполнителя' };
  let albumMenu = null;
  let artistMenu = null;
  // Альбом или исполнитель, у которого открыли «…»: из свойств React у кнопки, из ссылки
  // рядом или из адреса страницы (кнопка в шапке).
  const entityOfButton = (btn, kind) => {
    const key = Object.keys(btn).find((k) => k.startsWith('__reactFiber'));
    let f = key && btn[key];
    for (let i = 0; f && i < 40; i++, f = f.return) {
      const p = f.memoizedProps;
      if (!p || typeof p !== 'object') continue;
      for (const v of [p[kind], p.entity, p.data, p.meta]) {
        if (v && typeof v === 'object' && v.id != null && /^\d+$/.test(String(v.id)) && (kind === 'artist' ? typeof v.name === 'string' : typeof v.title === 'string'))
          return { id: String(v.id), name: kind === 'artist' ? v.name : v.title };
      }
    }
    const param = kind === 'album' ? 'albumId' : 'artistId';
    let el = btn;
    for (let i = 0; el && i < 8; i++, el = el.parentElement) {
      const a = el.querySelector(`a[href*="${param}="]`);
      const m = a && a.getAttribute('href').match(new RegExp(`${param}=(\\d+)`));
      if (m) return { id: m[1], name: '' };
    }
    const m = location.search.match(new RegExp(`${param}=(\\d+)`));
    return m ? { id: m[1], name: '' } : null;
  };
  for (const type of ['pointerdown', 'keydown']) {
    document.addEventListener(
      type,
      (e) => {
        if (!(e.target instanceof Element)) return;
        const al = e.target.closest('[data-test-id="ALBUM_CONTEXT_MENU_BUTTON"], [data-test-id="ALBUM_HEADER_CONTEXT_MENU_BUTTON"]');
        if (al) albumMenu = { at: performance.now(), entity: entityOfButton(al, 'album') };
        const ar = e.target.closest('[data-test-id="ARTIST_CONTEXT_MENU_BUTTON"], [data-test-id="ARTIST_HEADER_CONTEXT_MENU_BUTTON"]');
        if (ar) artistMenu = { at: performance.now(), entity: entityOfButton(ar, 'artist') };
      },
      true
    );
  }
  const mountSpoofMenuItem = () => {
    if (!cfg.uncensor) return;
    const menu = document.querySelector('[role="menu"]');
    if (!menu || menu.querySelector('[data-tune="spoof-menu"]')) return;
    const now = performance.now();
    let type = null;
    let id = null;
    if (now - listMenuAt < 2000 && listMenuTrack) [type, id] = ['track', listMenuTrack.id];
    else if (now - playerMenuAt < 2000 && ym.meta()) [type, id] = ['track', ym.meta().id];
    else if (albumMenu && now - albumMenu.at < 2000 && albumMenu.entity) [type, id] = ['album', albumMenu.entity.id];
    else if (artistMenu && now - artistMenu.at < 2000 && artistMenu.entity) [type, id] = ['artist', artistMenu.entity.id];
    if (!type || id == null || !/^\d+$/.test(String(id))) return; // свои загруженные треки (uuid) не подменяются
    const items = [...menu.querySelectorAll('[role="menuitem"]')].filter((i) => !i.dataset.tune);
    const ref = menu.querySelector('[data-test-id="TRACK_CONTEXT_MENU_ABOUT_TRACK_BUTTON"], [data-test-id="ARTIST_CONTEXT_MENU_ABOUT_ARTIST_BUTTON"]') || items.pop();
    if (!ref) return;
    const item = menuItem(menu, ref, 'spoof-menu', EDIT_SPRITE, `Подменить ${TYPE_WORD[type]}`, () => openSpoofEditor(type, String(id)));
    if (ref.dataset.testId && /ABOUT/.test(ref.dataset.testId)) ref.before(item);
    else ref.after(item);
  };

  const spoofSheet = new CSSStyleSheet();
  spoofSheet.replaceSync(`
    #tune-spoof { position: fixed; inset: 0; z-index: 2147482000; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.55); animation: tune-sp-fade .2s; }
    @keyframes tune-sp-fade { from { opacity: 0; } }
    #tune-spoof .tsp-card { width: min(620px, calc(100vw - 32px)); max-height: calc(100vh - 64px); display: flex; flex-direction: column; border-radius: var(--ym-radius-size-xl, 16px);
      background: var(--ym-background-color-primary-enabled-popover, var(--ym-background-color-primary-enabled-basic, #1f1f1f)); color: var(--ym-controls-color-primary-text-enabled_variant, #fff);
      box-shadow: 0 24px 64px rgba(0,0,0,.5); font-family: var(--ym-font-text, system-ui, sans-serif); font-size: 14px; animation: tune-ly-in .25s cubic-bezier(.2,.8,.2,1); }
    #tune-spoof .tsp-head { display: flex; align-items: center; gap: 12px; padding: 20px 24px 12px; }
    #tune-spoof h2 { flex: 1; margin: 0; font-size: 20px; font-weight: 700; }
    #tune-spoof .tsp-body { overflow-y: auto; padding: 4px 24px 16px; display: flex; flex-direction: column; gap: 16px; }
    #tune-spoof .tsp-top { display: grid; grid-template-columns: 112px 1fr; gap: 16px; align-items: start; }
    #tune-spoof .tsp-cover { position: relative; width: 112px; height: 112px; border-radius: 10px; overflow: hidden; background: rgba(255,255,255,.08); }
    #tune-spoof .tsp-cover.tsp-round { border-radius: 50%; }
    #tune-spoof .tsp-cover img { width: 100%; height: 100%; object-fit: cover; display: block; }
    #tune-spoof .tsp-cover img:not([src]), #tune-spoof .tsp-cover img[src=""] { visibility: hidden; }
    #tune-spoof .tsp-col { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
    #tune-spoof label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; opacity: .85; }
    #tune-spoof .tsp-label { font-size: 12px; opacity: .6; }
    #tune-spoof input[type="text"], #tune-spoof textarea { width: 100%; box-sizing: border-box; border: 1px solid rgba(255,255,255,.12); border-radius: 8px; padding: 9px 12px; background: rgba(255,255,255,.06); color: inherit; font: inherit; font-size: 14px; outline: none; }
    #tune-spoof input[type="text"]:focus, #tune-spoof textarea:focus { border-color: var(--ym-controls-color-primary-text-enabled, #fc3); }
    #tune-spoof textarea { min-height: 120px; font-family: ui-monospace, Consolas, monospace; font-size: 12px; resize: vertical; }
    #tune-spoof .tsp-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    #tune-spoof .tsp-note { font-size: 12px; opacity: .6; line-height: 1.4; }
    #tune-spoof button.tsp-btn { border: 0; border-radius: 100px; padding: 8px 14px; background: rgba(255,255,255,.1); color: inherit; font: 500 13px/1 var(--ym-font-text, system-ui); cursor: pointer; transition: background-color .15s, transform .15s; }
    #tune-spoof button.tsp-btn:hover { background: rgba(255,255,255,.18); }
    #tune-spoof button.tsp-btn:active { transform: scale(.97); }
    #tune-spoof button.tsp-btn:disabled { opacity: .4; pointer-events: none; }
    #tune-spoof button.tsp-primary { background: var(--ym-controls-color-primary-text-enabled, #fc3); color: #000; }
    #tune-spoof button.tsp-primary:hover { background: var(--ym-controls-color-primary-text-hovered, #ffd84d); }
    #tune-spoof button.tsp-icon { width: 30px; height: 30px; padding: 0; display: inline-flex; align-items: center; justify-content: center; }
    #tune-spoof .tsp-chip { display: inline-flex; align-items: center; gap: 6px; padding: 5px 6px 5px 12px; border-radius: 100px; background: rgba(255,255,255,.1); font-size: 13px; }
    #tune-spoof .tsp-chip button { border: 0; background: none; color: inherit; opacity: .6; cursor: pointer; font-size: 14px; padding: 0 4px; }
    #tune-spoof .tsp-search { position: relative; }
    #tune-spoof .tsp-sugg { position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 2; max-height: 240px; overflow-y: auto; border-radius: 10px; background: var(--ym-background-color-primary-enabled-popover, #262626); box-shadow: 0 12px 32px rgba(0,0,0,.5); }
    #tune-spoof .tsp-sugg:empty { display: none; }
    #tune-spoof .tsp-opt { display: flex; align-items: center; gap: 10px; padding: 8px 12px; cursor: pointer; }
    #tune-spoof .tsp-opt:hover, #tune-spoof .tsp-opt.tsp-active { background: rgba(255,255,255,.08); }
    #tune-spoof .tsp-opt img { width: 32px; height: 32px; border-radius: 6px; object-fit: cover; flex: none; background: rgba(255,255,255,.08); }
    #tune-spoof .tsp-opt span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #tune-spoof .tsp-opt small { opacity: .55; }
    #tune-spoof .tsp-list { display: flex; flex-direction: column; border-radius: 10px; background: rgba(255,255,255,.04); max-height: 280px; overflow-y: auto; }
    #tune-spoof .tsp-list:empty::before { content: attr(data-empty); padding: 12px; opacity: .5; font-size: 13px; }
    #tune-spoof .tsp-item { display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 12px; }
    #tune-spoof .tsp-item + .tsp-item { border-top: 1px solid rgba(255,255,255,.05); }
    #tune-spoof .tsp-item .tsp-n { width: 22px; flex: none; opacity: .5; font-variant-numeric: tabular-nums; }
    #tune-spoof .tsp-item .tsp-t { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #tune-spoof .tsp-item .tsp-t small { opacity: .55; }
    #tune-spoof .tsp-item .tsp-new { color: var(--ym-controls-color-primary-text-enabled, #fc3); }
    #tune-spoof .tsp-item button { border: 0; background: none; color: inherit; opacity: .55; cursor: pointer; width: 26px; height: 26px; border-radius: 50%; }
    #tune-spoof .tsp-item button:hover { opacity: 1; background: rgba(255,255,255,.1); }
    #tune-spoof .tsp-disc { padding: 8px 12px 4px; font-size: 12px; opacity: .55; }
    #tune-spoof .tsp-switch { display: flex; flex-direction: row; align-items: center; justify-content: space-between; gap: 12px; font-size: 14px; opacity: 1; cursor: pointer; }
    #tune-spoof .tsp-switch input { width: 18px; height: 18px; accent-color: var(--ym-controls-color-primary-text-enabled, #fc3); }
    #tune-spoof details summary { cursor: pointer; font-size: 13px; opacity: .7; }
    #tune-spoof details[open] summary { margin-bottom: 8px; }
    #tune-spoof .tsp-foot { display: flex; align-items: center; gap: 8px; padding: 12px 24px 20px; }
    #tune-spoof .tsp-foot .tsp-gap { flex: 1; }
    #tune-spoof .tsp-loading { padding: 40px; text-align: center; opacity: .6; }
    .tune-toast.tune-task.tune-notice { width: min(400px, 86vw); padding: 12px 14px; }
    .tune-toast.tune-task.tune-notice .tune-toast-body { display: flex; align-items: flex-start; gap: 12px; }
    .tune-toast.tune-task.tune-notice .tune-toast-bar { display: none; }
    .tune-toast.tune-task.tune-notice .tune-toast-text { display: flex; flex-direction: column; gap: 3px; white-space: normal; font-weight: 600; line-height: 1.35; }
    .tune-toast.tune-task.tune-notice .tune-notice-sub { font-weight: 400; font-size: 12px; opacity: .65; }
    .tune-toast.tune-task.tune-notice .tune-toast-info { display: none; }
    .tune-toast.tune-task.tune-notice img { width: 40px; height: 40px; border-radius: 6px; flex: none; }
    .tune-toast.tune-task.tune-notice .tune-toast-text { flex: 1; min-width: 0; }
  `);
  const h = (tag, props, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k in el && k !== 'list') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
    return el;
  };
  const coverSrc = (uri, size = '200x200') => (uri ? `https://${String(uri).replace(/^https?:\/\//, '').replace('%%', size)}` : '');
  const namesOf = (list) => (list || []).map((a) => a && a.name).filter(Boolean).join(', ');
  const readB64 = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  const pickFile = (accept) =>
    new Promise((resolve) => {
      const input = h('input', { type: 'file', accept, style: 'display:none' });
      input.addEventListener('change', () => resolve(input.files[0] || null));
      document.body.append(input);
      input.click();
      setTimeout(() => input.remove(), 60000);
    });
  const saveSpoofFile = async (file) => {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    return T.invoke('page_spoof_save', { ext, data: await readB64(file) });
  };
  const audioDuration = (file) =>
    new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const a = new Audio();
      const done = (v) => {
        URL.revokeObjectURL(url);
        resolve(v);
      };
      a.preload = 'metadata';
      a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? Math.round(a.duration * 1000) : 0);
      a.onerror = () => done(0);
      a.src = url;
    });
  // id из ссылки или числа: «…albumId=1&trackId=2», «/track/2», «2».
  const idFromText = (text, kind) => {
    const t = String(text || '').trim();
    const param = { track: 'trackId', album: 'albumId', artist: 'artistId' }[kind];
    const m = t.match(new RegExp(`${param}=(\\d+)`)) || t.match(new RegExp(`/${kind}/(\\d+)(?:[/?#]|$)`)) || t.match(/^(\d+)$/);
    return m ? m[1] : null;
  };
  // Поле поиска с подсказками: исполнители, треки или альбомы Яндекса; ссылка или id — сразу.
  const searchField = (kind, placeholder, onPick) => {
    const sugg = h('div', { class: 'tsp-sugg' });
    const input = h('input', { type: 'text', placeholder });
    let timer = 0;
    let seq = 0;
    let active = -1;
    const options = () => [...sugg.children];
    const setActive = (i) => {
      const list = options();
      active = Math.max(-1, Math.min(list.length - 1, i));
      list.forEach((o, k) => o.classList.toggle('tsp-active', k === active));
    };
    const pick = (entity) => {
      sugg.textContent = '';
      input.value = '';
      onPick(entity);
    };
    const run = async () => {
      const text = input.value.trim();
      const my = ++seq;
      if (!text) return (sugg.textContent = '');
      const id = idFromText(text, kind);
      let found = [];
      try {
        if (id) {
          if (kind === 'track') found = await apiTracks([id]);
          else if (kind === 'album') found = await apiAlbums([id]);
          else found = [(await apiFetch(`artists/${id}/brief-info`)).artist];
        } else {
          const res = await apiFetch(`search?text=${encodeURIComponent(text)}&type=${kind}&page=0&nocorrect=false`);
          found = ((res && res[`${kind}s`] && res[`${kind}s`].results) || []).slice(0, 8);
        }
      } catch (e) {
        found = [];
      }
      if (my !== seq) return;
      sugg.textContent = '';
      active = -1;
      for (const e of found.filter(Boolean)) {
        const cover = kind === 'artist' ? e.cover && e.cover.uri : e.coverUri || (e.albums && e.albums[0] && e.albums[0].coverUri);
        const sub = kind === 'artist' ? (e.genres || []).slice(0, 2).join(', ') : `${namesOf(e.artists)}${kind === 'album' && e.year ? ` · ${e.year}` : ''}`;
        sugg.append(h('div', { class: 'tsp-opt', onmousedown: (ev) => (ev.preventDefault(), pick(e)) }, h('img', { src: coverSrc(cover, '50x50') }), h('span', {}, kind === 'artist' ? e.name : e.title, ' ', h('small', {}, sub))));
      }
      if (!found.length) sugg.append(h('div', { class: 'tsp-opt' }, h('span', {}, h('small', {}, 'Ничего не нашлось'))));
    };
    input.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(run, 280);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') setActive(active + 1);
      else if (e.key === 'ArrowUp') setActive(active - 1);
      else if (e.key === 'Enter') {
        e.preventDefault();
        const o = options()[active < 0 ? 0 : active];
        if (o) o.dispatchEvent(new MouseEvent('mousedown'));
      } else return;
      e.preventDefault();
    });
    input.addEventListener('blur', () => setTimeout(() => (sugg.textContent = ''), 150));
    return h('div', { class: 'tsp-search' }, input, sugg);
  };
  // Список сущностей с порядком (треки альбома, вставки исполнителя).
  const entityList = (kind, items, empty, { discs = false } = {}) => {
    const box = h('div', { class: 'tsp-list', 'data-empty': empty });
    const render = () => {
      box.textContent = '';
      let disc = null;
      items.forEach((it, i) => {
        if (discs && items.some((x) => x.disc !== items[0].disc) && it.disc !== disc) box.append(h('div', { class: 'tsp-disc' }, `Диск ${it.disc + 1}`));
        disc = it.disc;
        const move = (d) => {
          const j = i + d;
          if (j < 0 || j >= items.length) return;
          [items[i], items[j]] = [items[j], items[i]];
          if (discs) [items[i].disc, items[j].disc] = [items[j].disc, items[i].disc];
          render();
        };
        box.append(
          h(
            'div',
            { class: 'tsp-item', 'data-id': it.id },
            h('span', { class: 'tsp-n' }, String(i + 1)),
            h('span', { class: 'tsp-t' }, h('span', { class: it.added ? 'tsp-new' : '' }, it.title || `id ${it.id}`), ' ', h('small', {}, it.sub || '')),
            h('button', { title: 'Выше', onclick: () => move(-1) }, '↑'),
            h('button', { title: 'Ниже', onclick: () => move(1) }, '↓'),
            h('button', { title: 'Убрать', onclick: () => (items.splice(i, 1), render()) }, '✕')
          )
        );
      });
    };
    render();
    const add = (e) => {
      const id = String(e.id);
      if (items.some((x) => x.id === id)) return T.toast('Уже в списке');
      items.push({ id, title: e.title || e.name, sub: namesOf(e.artists), added: true, disc: items.length ? items[items.length - 1].disc : 0 });
      render();
      box.scrollTop = box.scrollHeight;
    };
    return { el: box, add, render };
  };

  let spoofOpen = null;
  const closeSpoof = () => {
    if (spoofOpen) spoofOpen.remove();
    spoofOpen = null;
  };
  document.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Escape' && spoofOpen && !e.defaultPrevented) {
        e.stopPropagation();
        closeSpoof();
      }
    },
    true
  );
  const openSpoofEditor = async (type, id) => {
    if (!document.adoptedStyleSheets.includes(spoofSheet)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, spoofSheet];
    closeSpoof();
    const title = `Подмена ${type === 'track' ? 'трека' : type === 'album' ? 'альбома' : 'исполнителя'}`;
    const body = h('div', { class: 'tsp-body' }, h('div', { class: 'tsp-loading' }, 'Загрузка…'));
    const foot = h('div', { class: 'tsp-foot' });
    const card = h('div', { class: 'tsp-card', role: 'dialog', 'aria-label': title }, h('div', { class: 'tsp-head' }, h('h2', {}, title), h('button', { class: 'tsp-btn tsp-icon', title: 'Закрыть', onclick: closeSpoof }, '✕')), body, foot);
    const root = h('div', { id: 'tune-spoof', onmousedown: (e) => e.target === root && closeSpoof() }, card);
    document.body.append(root);
    spoofOpen = root;
    await loadUncensor();

    // Исходные данные Яндекса и то, что сейчас стоит поверх них.
    let raw;
    try {
      if (type === 'track') raw = (await apiTracks([id]))[0];
      else if (type === 'album') raw = await apiFetch(`albums/${id}/with-tracks?richTracks=true`);
      else raw = (await apiFetch(`artists/${id}/brief-info`)).artist;
    } catch (e) {
      raw = null;
    }
    if (!raw || spoofOpen !== root) {
      if (spoofOpen === root) body.firstChild.textContent = 'Не удалось получить данные из Яндекса — проверьте сеть и попробуйте ещё раз.';
      return;
    }
    const nameKey = type === 'artist' ? 'name' : 'title';
    const auto = autoSpoof(type, id) || {};
    const mine = own[type][id] || {};
    const base = { ...raw, ...auto }; // без своих полей
    const cur = { ...base, ...spoofOf(type, id) };
    const rawCover = type === 'artist' ? raw.cover && raw.cover.uri : raw.coverUri;
    const curCover = cur.coverUri || rawCover;
    const state = {
      name: cur[nameKey] || '',
      cover: curCover || '',
      artists: (cur.artists || []).map((a) => ({ id: String(a.id), name: a.name })),
      audio: mine.audio || null,
      durationMs: mine.durationMs,
      noAuto: !!mine.noAuto,
    };

    // Обложка и название.
    const img = h('img', { src: coverSrc(state.cover) });
    const setCover = (uri) => {
      state.cover = uri;
      img.src = coverSrc(uri);
    };
    const coverUrl = h('input', { type: 'text', placeholder: 'Ссылка на картинку', style: 'display:none' });
    coverUrl.addEventListener('change', () => {
      const v = coverUrl.value.trim();
      if (v) setCover(v.replace(/^https?:\/\//, ''));
    });
    const nameInput = h('input', { type: 'text', value: state.name });
    body.textContent = '';
    body.append(
      h(
        'div',
        { class: 'tsp-top' },
        h('div', { class: `tsp-cover${type === 'artist' ? ' tsp-round' : ''}` }, img),
        h(
          'div',
          { class: 'tsp-col' },
          h('label', {}, type === 'artist' ? 'Имя исполнителя' : 'Название', nameInput),
          h(
            'div',
            { class: 'tsp-row' },
            h(
              'button',
              {
                class: 'tsp-btn',
                onclick: async () => {
                  const file = await pickFile('image/png,image/jpeg,image/webp,image/gif,image/avif');
                  if (!file) return;
                  try {
                    setCover(`${location.host}/__tune/spoof/${await saveSpoofFile(file)}?s=%%`);
                  } catch (e) {
                    T.toast(String(e), { error: true });
                  }
                },
              },
              'Обложка из файла…'
            ),
            h('button', { class: 'tsp-btn', onclick: () => ((coverUrl.style.display = ''), coverUrl.focus()) }, 'По ссылке'),
            h('button', { class: 'tsp-btn', onclick: () => setCover(base.coverUri || rawCover || '') }, 'Исходная')
          ),
          coverUrl
        )
      )
    );

    // Исполнители трека или альбома.
    let renderArtists = null;
    let refreshAudio = () => {};
    if (type !== 'artist') {
      const chips = h('div', { class: 'tsp-row' });
      renderArtists = () => {
        chips.textContent = '';
        state.artists.forEach((a, i) => chips.append(h('span', { class: 'tsp-chip' }, a.name, h('button', { title: 'Убрать', onclick: () => (state.artists.splice(i, 1), renderArtists()) }, '✕'))));
      };
      renderArtists();
      body.append(
        h(
          'div',
          { class: 'tsp-col' },
          h('span', { class: 'tsp-label' }, 'Исполнители'),
          chips,
          searchField('artist', 'Добавить исполнителя: имя или ссылка', (a) => {
            if (!state.artists.some((x) => x.id === String(a.id))) state.artists.push({ id: String(a.id), name: a.name });
            renderArtists();
          })
        )
      );
    }

    // Аудио трека.
    if (type === 'track') {
      const status = h('span', { class: 'tsp-note' });
      const fileBtn = h('button', { class: 'tsp-btn' });
      const renderAudio = () => {
        const autoFile = uc && uc.files.has(id) && !state.noAuto;
        status.textContent = state.audio ? `Свой файл: ${state.audio.name || state.audio.file}` : autoFile ? 'Играет версия без цензуры из списка FckCensor' : 'Играет файл Яндекса';
        fileBtn.textContent = state.audio ? 'Убрать свой файл' : 'Свой аудиофайл…';
      };
      fileBtn.addEventListener('click', async () => {
        if (state.audio) {
          state.audio = null;
          state.durationMs = undefined;
          return renderAudio();
        }
        const file = await pickFile('audio/*,.mp3,.flac,.ogg,.opus,.wav,.m4a,.aac');
        if (!file) return;
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        if (!AUDIO_CODECS[ext]) return T.toast('Нужен файл mp3, flac, ogg, opus, wav или m4a', { error: true });
        fileBtn.disabled = true;
        status.textContent = 'Сохранение…';
        try {
          const [name, durationMs] = await Promise.all([saveSpoofFile(file), audioDuration(file)]);
          state.audio = { file: name, codec: AUDIO_CODECS[ext], name: file.name };
          state.durationMs = durationMs || undefined;
        } catch (e) {
          T.toast(String(e), { error: true });
        }
        fileBtn.disabled = false;
        renderAudio();
      });
      renderAudio();
      refreshAudio = renderAudio;
      body.append(h('div', { class: 'tsp-col' }, h('span', { class: 'tsp-label' }, 'Аудио'), h('div', { class: 'tsp-row' }, fileBtn, status)));
    }

    // Список треков альбома.
    let albumList = null;
    if (type === 'album') {
      const rawVolumes = (raw.volumes || []).map((v) => v.map((t) => String(t.id)));
      const volumes = cur.volumes ? cur.volumes.map((v) => v.map((t) => String(t && typeof t === 'object' ? t.id : t))) : rawVolumes;
      const known = new Map((raw.volumes || []).flat().map((t) => [String(t.id), t]));
      const missing = [...new Set(volumes.flat())].filter((x) => !known.has(x));
      try {
        for (const t of await apiTracks(missing)) known.set(String(t.id), t);
      } catch (e) {}
      const rawSet = new Set(rawVolumes.flat());
      const items = [];
      volumes.forEach((v, disc) =>
        v.forEach((tid) => {
          const t = known.get(tid) || {};
          const s = spoofOf('track', tid) || {};
          items.push({ id: tid, title: s.title || t.title, sub: namesOf(s.artists || t.artists), added: !rawSet.has(tid), disc });
        })
      );
      albumList = { items, rawVolumes, ...entityList('track', items, 'В альбоме нет треков', { discs: true }) };
      body.append(
        h(
          'div',
          { class: 'tsp-col' },
          h('span', { class: 'tsp-label' }, 'Треки альбома — новые подсвечены'),
          albumList.el,
          searchField('track', 'Добавить трек: название или ссылка на трек', (t) => albumList.add(t)),
          h('button', { class: 'tsp-btn', style: 'align-self:flex-start', onclick: () => (items.splice(0, items.length, ...rawVolumes.flatMap((v, disc) => v.map((tid) => ({ id: tid, title: (known.get(tid) || {}).title, sub: namesOf((known.get(tid) || {}).artists), disc })))), albumList.render()) }, 'Как в Яндексе')
        )
      );
    }

    // Треки и альбомы в профиле исполнителя.
    let artistLists = null;
    if (type === 'artist') {
      const ins = insertsOf(id) || { tracks: [], albums: [] };
      const [tr, al] = await Promise.all([apiTracks(ins.tracks || []).catch(() => []), apiAlbums(ins.albums || []).catch(() => [])]);
      const toItem = (e) => ({ id: String(e.id), title: e.title, sub: namesOf(e.artists) });
      const tracks = entityList('track', tr.map(toItem), 'Не добавлено ни одного трека');
      const albums = entityList('album', al.map(toItem), 'Не добавлено ни одного альбома');
      artistLists = { tracks, albums, initial: JSON.stringify({ tracks: ins.tracks || [], albums: ins.albums || [] }) };
      body.append(
        h('div', { class: 'tsp-col' }, h('span', { class: 'tsp-label' }, 'Треки в профиле — сверху «Популярных треков»'), tracks.el, searchField('track', 'Добавить трек: название или ссылка', (t) => tracks.add(t))),
        h('div', { class: 'tsp-col' }, h('span', { class: 'tsp-label' }, 'Альбомы в профиле'), albums.el, searchField('album', 'Добавить альбом: название или ссылка', (a) => albums.add(a)))
      );
    }

    // Автоподмена из списка.
    const hasAuto = !!(uc && (uc[AUTO_MAPS[type]].has(id) || (type === 'track' && uc.files.has(id)) || (type === 'artist' && uc.inserts.has(id))));
    if (hasAuto) {
      // Трек, удалённый из Яндекса, без автоподмены снова пропадёт — вместе с этим окном.
      const locked = type === 'track' && raw.available === false && uc.files.has(id);
      if (locked) state.noAuto = false;
      const box = h('input', { type: 'checkbox', checked: !state.noAuto, disabled: locked });
      box.addEventListener('change', () => {
        state.noAuto = !box.checked;
        refreshAudio();
      });
      const note = locked
        ? 'Трек удалён из Яндекса и играет только благодаря списку — без автоподмены он пропадёт, поэтому её не выключить. Свою версию можно поставить кнопкой «Свой аудиофайл…».'
        : 'Выключите, если версия из списка не нравится: останутся только ваши правки.';
      body.append(h('label', { class: 'tsp-switch' }, h('span', {}, 'Автоподмена из списка FckCensor', h('br'), h('small', { class: 'tsp-note' }, note)), box));
    }

    // Дополнительные поля — JSON своих полей, как «Дополнительные поля» у FckCensor.
    const extraKeys = (o) => {
      const { title, name, artists, coverUri, audio, durationMs, noAuto, volumes, insert, ...rest } = o || {};
      return rest;
    };
    const json = h('textarea', { spellcheck: false, value: JSON.stringify(extraKeys(mine), null, 2) });
    body.append(
      h(
        'details',
        {},
        h('summary', {}, 'Дополнительные поля (JSON)'),
        h('div', { class: 'tsp-note', style: 'margin-bottom:8px' }, 'Любые поля объекта Яндекса, например { "releaseDate": "2020-01-01T00:00:00+03:00", "contentWarning": "explicit" }.'),
        json
      )
    );

    // Сохранение: в свои поля попадает только то, что отличается от Яндекса со списком.
    const apply = () => {
      let extra = {};
      try {
        extra = JSON.parse(json.value.trim() || '{}');
        if (!extra || typeof extra !== 'object' || Array.isArray(extra)) throw new Error();
      } catch (e) {
        return T.toast('В дополнительных полях — неверный JSON', { error: true });
      }
      const next = { ...extra };
      const nm = nameInput.value.trim();
      if (nm && nm !== base[nameKey]) next[nameKey] = nm;
      if (state.cover && state.cover !== (base.coverUri || rawCover)) next.coverUri = state.cover;
      if (type !== 'artist') {
        const ids = state.artists.map((a) => a.id).join(',');
        if (ids !== (base.artists || []).map((a) => String(a.id)).join(',') && state.artists.length) next.artists = state.artists.map((a) => ({ id: Number(a.id) || a.id, name: a.name }));
      }
      if (type === 'track') {
        if (state.audio) next.audio = state.audio;
        if (state.audio && state.durationMs) next.durationMs = state.durationMs;
      }
      if (albumList) {
        const vols = [];
        for (const it of albumList.items) (vols[it.disc] = vols[it.disc] || []).push({ id: Number(it.id) });
        const volumes = vols.filter((v) => v && v.length);
        const baseVols = (base.volumes ? base.volumes.map((v) => v.map((t) => String(t && typeof t === 'object' ? t.id : t))) : albumList.rawVolumes).map((v) => v.join(',')).join('|');
        if (volumes.map((v) => v.map((t) => t.id).join(',')).join('|') !== baseVols) next.volumes = volumes;
      }
      if (artistLists) {
        const insert = { tracks: collectIds(artistLists.tracks.el), albums: collectIds(artistLists.albums.el) };
        if (JSON.stringify(insert) !== artistLists.initial) next.insert = insert;
      }
      if (state.noAuto) next.noAuto = true;
      const had = !!own[type][id];
      const prevAudio = mine.audio && mine.audio.file;
      if (Object.keys(next).length) own[type][id] = next;
      else delete own[type][id];
      if (!saveOwn()) return;
      if (prevAudio && (!next.audio || next.audio.file !== prevAudio) && !Object.values(own.track).some((o) => o.audio && o.audio.file === prevAudio))
        T.invoke('page_spoof_remove', { name: prevAudio }).catch(() => {});
      closeSpoof();
      spoofChanged(type, id, Object.keys(next).length ? 'Подмена сохранена' : had ? 'Подмена удалена' : 'Изменений нет', coverSrc(state.cover, '100x100'));
    };
    // Порядок в списке — по id из строк, которые нарисовал entityList.
    const collectIds = (listEl) => [...listEl.querySelectorAll('.tsp-item')].map((row) => row.dataset.id).filter(Boolean);
    const remove = () => {
      if (!own[type][id]) return closeSpoof();
      const prevAudio = own[type][id].audio && own[type][id].audio.file;
      delete own[type][id];
      if (!saveOwn()) return;
      if (prevAudio && !Object.values(own.track).some((o) => o.audio && o.audio.file === prevAudio)) T.invoke('page_spoof_remove', { name: prevAudio }).catch(() => {});
      closeSpoof();
      spoofChanged(type, id, 'Подмена удалена', coverSrc(base.coverUri || rawCover, '100x100'));
    };
    foot.append(
      h('button', { class: 'tsp-btn', disabled: !own[type][id], onclick: remove }, 'Удалить подмену'),
      h('span', { class: 'tsp-gap' }),
      h('button', { class: 'tsp-btn', onclick: closeSpoof }, 'Отмена'),
      h('button', { class: 'tsp-btn tsp-primary', onclick: apply }, 'Применить')
    );
    nameInput.focus();
  };
  // Данные уже лежат в хранилищах клиента — они обновятся, когда он перечитает их из API.
  // Играющий трек меняет файл со следующего запуска.
  const spoofChanged = (type, id, text, cover) => {
    badgesDirty = true;
    mountUncensorBadges();
    const meta = ym.meta();
    const playing = type === 'track' && meta && String(meta.id) === id;
    if (text === 'Изменений нет') return T.toast(text);
    notice({
      text,
      sub: playing ? 'Новый файл заиграет со следующего запуска трека, название и обложка — после обновления страницы.' : 'Изменения появятся после обновления страницы.',
      cover,
      action: 'Обновить',
      run: () => location.reload(),
    });
  };
  // Уведомление с пояснением и кнопками: заголовок, вторая строка мельче, «Позже» и действие.
  const notice = ({ text, sub, cover, action, run, ms = 10000 }) => {
    if (!document.adoptedStyleSheets.includes(spoofSheet)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, spoofSheet];
    const card = T.task({ text, info: '', progress: undefined, cover: cover || '' });
    card.el.classList.add('tune-notice');
    if (!cover) card.el.classList.add('tune-nocover');
    if (sub) card.el.querySelector('.tune-toast-text').append(h('span', { class: 'tune-notice-sub' }, sub));
    card.el.append(
      h(
        'div',
        { class: 'tune-toast-actions' },
        h('button', { onclick: () => card.close() }, 'Позже'),
        action && h('button', { class: 'tune-primary', onclick: () => (card.close(), run()) }, action)
      )
    );
    card.close(ms);
    return card;
  };

  // ---------------------------------------------------------------------------
  // Файлы треков: get-file-info.
  // ---------------------------------------------------------------------------
  const uncensoredInfo = (info, file) => {
    const { error, ...rest } = info;
    return { ...rest, codec: file.codec, bitrate: 320, transport: 'raw', key: undefined, urls: [file.url], url: file.url, realId: rest.realId || String(rest.trackId) };
  };
  const jsonResponse = (body, resp) => {
    const headers = new Headers(resp.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.set('content-type', 'application/json; charset=utf-8');
    return new Response(JSON.stringify(body), { status: 200, statusText: 'OK', headers });
  };
  // Ответы get-file-info и get-file-info/batch: { downloadInfo } и { downloadInfos | fileInfos }.
  // Ответ с ошибкой тоже подменяем: так играют треки, которые Яндекс удалил или закрыл.
  const patchFileInfo = async (resp, reqUrl) => {
    await loadUncensor();
    const fileOf = (id) => ucFile(String(id).split(':')[0]);
    let body = null;
    if (resp.ok) {
      try {
        body = await resp.clone().json();
      } catch (e) {
        return resp;
      }
    } else {
      // Ответа нет — собираем его сами, если для всех треков запроса есть файл.
      const q = new URL(reqUrl).searchParams;
      const ids = (q.get('trackIds') || q.get('trackId') || '').split(',').filter(Boolean);
      if (!ids.length || !ids.every(fileOf)) return resp;
      const infos = ids.map((trackId) => ({ trackId, quality: q.get('quality') || 'nq', error: 'unavailable' }));
      body = /\/batch\?/.test(reqUrl) ? { downloadInfos: infos } : { downloadInfo: infos[0] };
    }
    let changed = !resp.ok;
    const swap = (info) => {
      const file = info && fileOf(info.trackId);
      if (!file) return info;
      changed = true;
      return uncensoredInfo(info, file);
    };
    if (body.downloadInfo) body.downloadInfo = swap(body.downloadInfo);
    for (const k of ['downloadInfos', 'fileInfos']) if (Array.isArray(body[k])) body[k] = body[k].map(swap);
    return changed ? jsonResponse(body, resp) : resp;
  };

  // ---------------------------------------------------------------------------
  // Данные треков, альбомов и исполнителей в любом ответе API: объекты узнаём по форме,
  // а не по адресу — они приходят из десятков ручек (альбомы, плейлисты, поиск, волна).
  // ---------------------------------------------------------------------------
  const isTrackObj = (o) => typeof o.title === 'string' && Array.isArray(o.artists) && ('durationMs' in o || Array.isArray(o.albums));
  const isAlbumObj = (o) => typeof o.title === 'string' && ('trackCount' in o || 'volumes' in o || ('year' in o && !('durationMs' in o)));
  const isArtistObj = (o) => typeof o.name === 'string' && !('title' in o) && ('various' in o || 'composer' in o || 'genres' in o || 'counts' in o);
  const spoofArtists = (orig, list) =>
    list.map((a) => {
      const same = Array.isArray(orig) && orig.find((x) => x && String(x.id) === String(a.id));
      return same ? { ...same, ...a } : { various: false, composer: false, genres: [], disclaimers: [], available: true, ...a };
    });
  // Поля подмены поверх объекта. Служебные поля FckCensor (__fckCensor) и свои (audio,
  // insert, noAuto, volumes) сюда не попадают.
  const SKIP_KEYS = new Set(['__fckCensor', 'audio', 'insert', 'noAuto', 'volumes', 'id']);
  const applySpoof = (o, s) => {
    let changed = false;
    for (const [k, v] of Object.entries(s)) {
      if (SKIP_KEYS.has(k) || v === undefined) continue;
      if (k === 'artists') {
        if (!Array.isArray(v) || !v.length) continue;
        o.artists = spoofArtists(o.artists, v);
        changed = true;
      } else if (k === 'coverUri') {
        if (o.coverUri !== v) changed = true;
        o.coverUri = v;
        if ('ogImage' in o) o.ogImage = v;
        if (o.cover && typeof o.cover === 'object') o.cover = { ...o.cover, uri: v, prefix: undefined };
        else if (isArtistObj(o)) o.cover = { type: 'from-album-cover', uri: v };
        // Цвета под обложку Яндекс считает по своей — у подменённой они будут чужими.
        if (o.derivedColors) delete o.derivedColors;
      } else if (JSON.stringify(o[k]) !== JSON.stringify(v)) {
        o[k] = v;
        changed = true;
      }
    }
    return changed;
  };
  // Альбом, в который подмена вернула трек: { id, title, … } для track.albums.
  const albumSeen = new Map();
  const albumOfTrack = (trackId) => {
    const ids = new Set([...Object.keys(own.album), ...(uc ? uc.albums.keys() : [])]);
    for (const albumId of ids) {
      const s = spoofOf('album', albumId);
      const vols = s && Array.isArray(s.volumes) ? s.volumes : null;
      if (!vols) continue;
      for (let v = 0; v < vols.length; v++) {
        const at = (vols[v] || []).findIndex((r) => String(r && typeof r === 'object' ? r.id : r) === trackId);
        if (at < 0) continue;
        const seen = albumSeen.get(albumId) || {};
        return { id: Number(albumId), title: s.title || seen.title || '', coverUri: s.coverUri || seen.coverUri, artists: s.artists || seen.artists || [], year: seen.year, genre: seen.genre, available: true, trackPosition: { volume: v + 1, index: at + 1 } };
      }
    }
    return null;
  };
  // Ссылка плеера на трек без альбома (/track?trackId=…) ведёт на страницу, которой в
  // клиенте нет: страница перезагружается или клик теряется. Ведём в альбом, куда трек
  // вернула подмена, а если его нет — объясняем.
  document.addEventListener(
    'click',
    (e) => {
      const a = e.target instanceof Element && e.target.closest('a[href^="/track?"]');
      const m = a && a.getAttribute('href').match(/trackId=(\d+)/);
      if (!m || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const home = albumOfTrack(m[1]);
      if (home && window.next && window.next.router) window.next.router.push(`/album/track?albumId=${home.id}&trackId=${m[1]}`);
      else T.toast('Этот трек удалён из Яндекса — своей страницы у него нет');
    },
    true
  );
  const spoofData = (root) => {
    let changed = false;
    const seen = new Set();
    const walk = (node, depth) => {
      if (!node || typeof node !== 'object' || depth > 14 || seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) {
        for (const v of node) walk(v, depth + 1);
        return;
      }
      const id = node.id != null ? String(node.id) : '';
      if (/^\d+$/.test(id)) {
        if (isTrackObj(node)) {
          const s = spoofOf('track', id);
          if (s && applySpoof(node, s)) changed = true;
          // Удалённый или закрытый в Яндексе трек, у которого есть файл, снова доступен.
          if (node.available === false && ucFile(id)) {
            node.available = true;
            delete node.error;
            changed = true;
          }
          // У удалённого трека Яндекс не отдаёт альбом, и плеер ведёт на несуществующую
          // страницу /track. Если трек вернули в альбом — ставим этот альбом.
          if (Array.isArray(node.albums) && !node.albums.length) {
            const home = albumOfTrack(id);
            if (home) {
              node.albums = [home];
              changed = true;
            }
          }
        } else if (isAlbumObj(node)) {
          const s = spoofOf('album', id);
          if (s && applySpoof(node, s)) changed = true;
          albumSeen.set(id, { title: node.title, coverUri: node.coverUri, artists: node.artists, year: node.year, genre: node.genre });
        } else if (isArtistObj(node)) {
          const s = spoofOf('artist', id);
          if (s && applySpoof(node, s)) changed = true;
        }
      }
      for (const k in node) {
        const v = node[k];
        if (v && typeof v === 'object') walk(v, depth + 1);
      }
    };
    walk(root, 0);
    return changed;
  };
  // Альбом с подменённым списком треков: недостающие (в том числе удалённые Яндексом)
  // треки дозапрашиваем той же ручкой, что и клиент, — POST /tracks.
  const restoreVolumes = async (album) => {
    const s = spoofOf('album', album.id);
    if (!s || !Array.isArray(s.volumes) || !Array.isArray(album.volumes)) return false;
    const want = s.volumes.map((v) => (Array.isArray(v) ? v : []).map((r) => String(r && typeof r === 'object' ? r.id : r)).filter((id) => /^\d+$/.test(id)));
    const count = (volumes) => {
      const n = volumes.reduce((k, v) => k + v.length, 0);
      album.trackCount = n;
      if (album.pager && typeof album.pager === 'object' && 'total' in album.pager) album.pager.total = n;
    };
    const flat = album.volumes.flat();
    // richTracks=false: в ответе только { id } — подставляем свои id, сами треки клиент
    // дозапросит через POST /tracks, где их данные подменятся как у всех.
    if (flat.every((t) => t && typeof t === 'object' && typeof t.title !== 'string')) {
      album.volumes = want.map((v) => v.map((id) => ({ id: Number(id) }))).filter((v) => v.length);
      count(album.volumes);
      return album.volumes.length > 0;
    }
    const have = new Map();
    for (const t of flat) {
      if (!t || typeof t !== 'object' || typeof t.title !== 'string') return false; // ответ смешанный — не трогаем
      have.set(String(t.id), t);
    }
    const missing = [...new Set(want.flat())].filter((id) => !have.has(id));
    for (const t of await apiTracks(missing)) if (t && t.id != null) have.set(String(t.id), t);
    const volumes = want.map((v) => v.map((id) => have.get(id)).filter(Boolean)).filter((v) => v.length);
    if (!volumes.length) return false;
    album.volumes = volumes;
    count(volumes);
    return true;
  };
  // Профиль исполнителя: добавленные треки — в начало списков треков, альбомы — в начало
  // списков альбомов (brief-info, artists/<id>/tracks, …/direct-albums).
  const insertIntoArtist = async (body, artistId, page0) => {
    const ins = insertsOf(artistId);
    if (!ins || (!ins.tracks.length && !ins.albums.length)) return false;
    let changed = false;
    const lists = (key, test) => {
      const out = [];
      for (const k of key) if (Array.isArray(body[k]) && (!body[k].length || body[k].every((x) => x && typeof x === 'object' && test(x)))) out.push(body[k]);
      return out;
    };
    const trackLists = page0 ? lists(['popularTracks', 'tracks'], isTrackObj) : [];
    const albumLists = page0 ? lists(['albums', 'directAlbums', 'alsoAlbums'].slice(0, 2), isAlbumObj) : [];
    if (trackLists.length && ins.tracks.length) {
      const got = await apiTracks(ins.tracks);
      for (const list of trackLists) {
        const add = got.filter((t) => !list.some((x) => String(x.id) === String(t.id)));
        list.unshift(...add);
        if (add.length) changed = true;
      }
      if (changed && body.pager && typeof body.pager.total === 'number') body.pager.total += ins.tracks.length;
    }
    if (albumLists.length && ins.albums.length) {
      const got = await apiAlbums(ins.albums);
      for (const list of albumLists) {
        const add = got.filter((a) => !list.some((x) => String(x.id) === String(a.id)));
        list.unshift(...add);
        if (add.length) changed = true;
      }
    }
    return changed;
  };

  // ---------------------------------------------------------------------------
  // «Моя волна»: свои загруженные треки и восстановленные «Без цензуры» иногда
  // встают в очередь волны рядом с её рекомендациями. Пачки волны приходят ответом
  // rotor/session/new и rotor/session/<id>/tracks — { sequence: [{ type, track, liked, trackParameters }] }.
  // ---------------------------------------------------------------------------
  const WAVE_TTL = 30 * 60 * 1000;
  let waveLocal = { at: 0, list: [], loading: null };
  const waveUsed = new Set();
  const waveRecent = []; // исполнители и жанры последних пачек волны
  const localWaveTracks = () => {
    if (Date.now() - waveLocal.at < WAVE_TTL) return Promise.resolve(waveLocal.list);
    if (!waveLocal.loading)
      waveLocal.loading = (async () => {
        const uid = await uidOf();
        const likes = await apiFetch(`users/${uid}/likes/tracks`);
        const ids = ((likes && likes.library && likes.library.tracks) || []).map((t) => String(t.id)).filter((id) => !/^\d+$/.test(id));
        const got = ids.length ? await apiTracks(ids) : [];
        waveLocal = { at: Date.now(), list: got.filter((t) => t && t.available !== false && (t.state == null || t.state === 'playable')), loading: null };
        return waveLocal.list;
      })().catch((e) => {
        console.warn('[tune] свои треки для волны', e);
        waveLocal = { at: Date.now() - WAVE_TTL + 5 * 60 * 1000, list: waveLocal.list, loading: null };
        return waveLocal.list;
      });
    return waveLocal.loading;
  };
  // Восстановленные треки: какие из треков списка в Яндексе недоступны, с исполнителями
  // и жанром — раз в сутки, в localStorage.
  const RESTORED_KEY = 'tune:uc-restored';
  let restored = null;
  let restoredLoading = null;
  const restoredTracks = () => {
    if (!restored)
      try {
        restored = JSON.parse(localStorage.getItem(RESTORED_KEY) || 'null');
      } catch (e) {}
    const sig = uc ? uc.files.size : 0;
    if (restored && restored.sig === sig && Date.now() - restored.at < 24 * 3600 * 1000) return Promise.resolve(restored.items);
    if (!restoredLoading)
      restoredLoading = apiTracks([...uc.files.keys()])
        .then((got) => {
          const items = got
            .filter((t) => t && t.available === false)
            .map((t) => ({ id: String(t.id), artists: (t.artists || []).map((a) => String(a.id)), genre: (t.albums && t.albums[0] && t.albums[0].genre) || '' }));
          restored = { at: Date.now(), sig, items };
          try {
            localStorage.setItem(RESTORED_KEY, JSON.stringify(restored));
          } catch (e) {}
          return items;
        })
        .catch((e) => {
          console.warn('[tune] восстановленные треки для волны', e);
          return (restored && restored.items) || [];
        })
        .finally(() => (restoredLoading = null));
    return restoredLoading;
  };
  const pickRandom = (list) => list[Math.floor(Math.random() * list.length)];
  const injectWave = async (seq) => {
    const tracks = seq.map((x) => x && x.track).filter(Boolean);
    if (!tracks.length) return false;
    const artists = new Set(tracks.flatMap((t) => (t.artists || []).map((a) => String(a.id))));
    const genres = new Set(tracks.map((t) => t.albums && t.albums[0] && t.albums[0].genre).filter(Boolean));
    waveRecent.push({ artists, genres });
    if (waveRecent.length > 6) waveRecent.shift();
    const near = (item) => waveRecent.some((r) => item.artists.some((a) => r.artists.has(a)));
    const sameGenre = (item) => !!item.genre && waveRecent.some((r) => r.genres.has(item.genre));
    const add = [];
    if (cfg.localInWave && Math.random() < 0.35) {
      const pool = (await localWaveTracks()).filter((t) => !waveUsed.has(String(t.id)));
      if (pool.length) add.push({ track: pickRandom(pool), liked: true });
    }
    if (cfg.uncensor && cfg.uncensorWave && uc && uc.files.size) {
      const pool = (await restoredTracks()).filter((t) => !waveUsed.has(t.id) && ucFile(t.id));
      const close = pool.filter(near);
      const genre = pool.filter(sameGenre);
      const choice = close.length && Math.random() < 0.5 ? pickRandom(close) : genre.length && Math.random() < 0.2 ? pickRandom(genre) : null;
      if (choice) {
        const [t] = await apiTracks([choice.id]);
        if (t) add.push({ track: t, liked: false });
      }
    }
    if (!add.length) return false;
    const params = (seq.find((x) => x && x.trackParameters) || {}).trackParameters;
    for (const a of add) {
      waveUsed.add(String(a.track.id));
      const at = 1 + Math.floor(Math.random() * Math.max(1, seq.length - 1));
      seq.splice(at, 0, { type: 'track', track: a.track, liked: a.liked, ...(params ? { trackParameters: { ...params } } : {}) });
    }
    return true;
  };

  // Выключенная автоподмена у трека, который Яндекс удалил, прятала его насовсем — вместе
  // с меню, где её можно вернуть. Такие отметки снимаем при запуске.
  let healStarted = false;
  const healNoAuto = async () => {
    await loadUncensor();
    const off = Object.keys(own.track).filter((id) => own.track[id].noAuto && uc && uc.files.has(id));
    if (!off.length) return;
    let back = 0;
    for (const t of await apiTracks(off)) {
      const id = String(t && t.id);
      if (!t || t.available !== false || !own.track[id]) continue;
      delete own.track[id].noAuto;
      if (!Object.keys(own.track[id]).length) delete own.track[id];
      back++;
    }
    if (!back || !saveOwn()) return;
    badgesDirty = true;
    notice({
      text: back > 1 ? `Удалённые треки снова без цензуры: ${back}` : 'Удалённый трек снова без цензуры',
      sub: 'Без автоподмены такие треки пропадают из Яндекса, поэтому она снова включена. Трек появится после обновления страницы.',
      action: 'Обновить',
      run: () => location.reload(),
      ms: 15000,
    });
  };
  const API_HOST = /^https:\/\/api\.music\.yandex\.[a-z]+\//;
  const patchApiData = async (resp, reqUrl) => {
    const type = resp.headers.get('content-type') || '';
    if (!type.includes('json')) return resp;
    const wave = /\/rotor\/session\/(?:new|[^/?#]+\/tracks)(?:[?#]|$)/.test(reqUrl);
    const uncensorOn = !!cfg.uncensor;
    if (!uncensorOn && !(wave && cfg.localInWave)) return resp;
    if (uncensorOn) await Promise.race([loadUncensor(), new Promise((r) => setTimeout(r, 3000))]);
    let body;
    try {
      body = await resp.clone().json();
    } catch (e) {
      return resp;
    }
    const data = body && typeof body === 'object' && 'result' in body && 'invocationInfo' in body ? body.result : body;
    if (!data || typeof data !== 'object') return resp;
    let changed = false;
    const step = async (what, fn) => {
      try {
        if (await fn()) changed = true;
      } catch (e) {
        console.warn(`[tune] ${what}`, e);
      }
    };
    if (wave && Array.isArray(data.sequence)) await step('волна', () => injectWave(data.sequence));
    if (uncensorOn) {
      if (/\/albums\/\d+\/with-tracks/.test(reqUrl)) await step('треки альбома', () => restoreVolumes(data));
      const art = reqUrl.match(/\/artists\/(\d+)\/(brief-info|tracks|direct-albums|safe-direct-albums)(?:[?#]|$)/);
      if (art) await step('профиль исполнителя', () => insertIntoArtist(data, art[1], !/[?&]page=(?!0(?:&|$))\d+/.test(reqUrl)));
      if (spoofData(data)) changed = true;
    }
    return changed ? jsonResponse(body, resp) : resp;
  };

  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
    const fileInfo = /^https:\/\/[^/?#]*\.yandex\.[a-z]+\/(?:[^?#]*\/)?get-file-info(?:\/batch)?\?/.test(url);
    const api = !fileInfo && API_HOST.test(url);
    if (!fileInfo && !api) return origFetch(input, init);
    // Заголовки запроса (авторизация) — до вызова: тело Request потом уже прочитано.
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    if (init && init.headers) new Headers(init.headers).forEach((v, k) => headers.set(k, v));
    if (api && headers.has('authorization')) {
      apiHeaders = headers;
      apiBase = url.match(API_HOST)[0];
      const uid = url.match(/\/users\/(\d+)\//);
      if (uid) myUid = uid[1];
      if (!healStarted) {
        healStarted = true;
        setTimeout(() => healNoAuto().catch((e) => console.warn('[tune] автоподмена удалённых треков', e)), 3000);
      }
    }
    return origFetch(input, init).then(async (resp) => {
      await Promise.race([cfgLoaded, new Promise((r) => setTimeout(r, fileInfo ? 4000 : 1500))]);
      if (fileInfo) return cfg.uncensor ? patchFileInfo(resp, url).catch(() => resp) : resp;
      return resp.ok ? patchApiData(resp, url).catch(() => resp) : resp;
    });
  };

  // ---------------------------------------------------------------------------
  // Последний трек после перезапуска. Очередь и трек клиент Яндекса восстанавливает
  // из ответа Ynison на своё первое сообщение (update_full_state). Если Ynison
  // отвечает ошибкой (у части аккаунтов — 503 «temporary unavailable» с запретом
  // переподключаться час), восстанавливать нечего и плеер пустой. Tune сам запоминает
  // очередь и трек из плеера и при такой ошибке подставляет перед ней ответ в формате
  // Ynison — клиент применяет его своим обычным путём, на паузе.
  // ---------------------------------------------------------------------------
  const YNISON_KEY = 'tune:last-queue';
  const NativeWebSocket = window.WebSocket;
  let ynisonAnswered = false; // Ynison прислал своё состояние — подменять нечего
  let ynisonRestored = false;
  const ENTITY_TYPES = { album: 'ALBUM', playlist: 'PLAYLIST', artist: 'ARTIST' };
  // Состояние плеера в виде player_state Ynison — так же его собирает сам клиент.
  const playerStateNow = () => {
    const s = ym.state();
    const qs = s && s.queueState;
    const list = qs && qs.entityList && qs.entityList.value;
    const cur = qs && qs.currentEntity && qs.currentEntity.value;
    if (!Array.isArray(list) || !list.length || !cur) return null;
    const ctx = s.currentContext && s.currentContext.value && s.currentContext.value.data;
    const from = (ctx && ctx.from) || '';
    const playables = [];
    let index = -1;
    for (const item of list) {
      const data = item && item.entity && item.entity.data;
      const meta = data && data.meta;
      if (!meta || meta.id == null || meta.id === '') continue;
      if (item === cur || item.entity === cur.entity) index = playables.length;
      const album = (meta.albums || [])[0];
      playables.push({
        playable_id: String(meta.id),
        album_id_optional: album && album.id != null ? String(album.id) : meta.albumId != null ? String(meta.albumId) : null,
        playable_type: 'TRACK',
        from,
        title: meta.title || '',
        cover_url_optional: meta.coverUri || null,
      });
    }
    if (index < 0) {
      const curId = cur.entity && cur.entity.data && cur.entity.data.meta && String(cur.entity.data.meta.id);
      index = playables.findIndex((p) => p.playable_id === curId);
    }
    if (index < 0) return null;
    // Альбом, плейлист и исполнитель восстанавливаются целиком; остальное (волна,
    // подборки) — набором треков из очереди.
    let entityType = 'VARIOUS';
    let entityId = '';
    const cmeta = ctx && ctx.meta;
    if (ctx && ENTITY_TYPES[ctx.type] && cmeta) {
      const id = ctx.type === 'playlist' && cmeta.uid != null && cmeta.kind != null ? `${cmeta.uid}:${cmeta.kind}` : String(cmeta.id ?? '');
      if (id && (ctx.type !== 'playlist' || id.includes(':'))) {
        entityType = ENTITY_TYPES[ctx.type];
        entityId = id;
      }
    }
    const prog = ym.progress() || {};
    const now = Date.now();
    const version = { device_id: 'tune', version: 0, timestamp_ms: now };
    return {
      player_queue: {
        current_playable_index: index,
        entity_id: entityId,
        entity_type: entityType,
        playable_list: playables,
        options: { repeat_mode: 'NONE' },
        shuffle_optional: null,
        entity_context: 'BASED_ON_ENTITY_BY_DEFAULT',
        version,
        from_optional: from,
        initial_entity_optional: null,
        adding_options_optional: null,
        queue: null,
      },
      status: {
        duration_ms: Math.round((prog.duration || 0) * 1000),
        paused: true,
        playback_speed: 1,
        progress_ms: Math.round((prog.position || 0) * 1000),
        version,
      },
    };
  };
  const saveQueue = () => {
    const ps = playerStateNow();
    if (!ps) return;
    try {
      localStorage.setItem(YNISON_KEY, JSON.stringify(ps));
    } catch (e) {}
  };
  // Трек сменился — сразу; позиция — раз в 10 секунд, пока играет (и раз после паузы),
  // и при закрытии.
  T.onTrack(saveQueue);
  let queueWasPlaying = false;
  setInterval(() => {
    const playing = player.isPlaying();
    if (playing || queueWasPlaying) saveQueue();
    queueWasPlaying = playing;
  }, 10000);
  window.addEventListener('pagehide', saveQueue);
  const watchYnison = (ws) => {
    let fullRid = null;
    let device = null;
    ws.send = function (data) {
      try {
        const msg = JSON.parse(data);
        if (msg.update_full_state) {
          fullRid = msg.rid;
          device = msg.update_full_state.device;
        }
      } catch (e) {}
      return NativeWebSocket.prototype.send.call(this, data);
    };
    const ours = new WeakSet();
    const emit = (data) => {
      const ev = new MessageEvent('message', { data });
      ours.add(ev);
      ws.dispatchEvent(ev);
    };
    // Слушатель из конструктора стоит первым — раньше onmessage и слушателей клиента.
    ws.addEventListener('message', (e) => {
      if (ours.has(e) || typeof e.data !== 'string') return;
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch (err) {
        return;
      }
      if (!msg.error) {
        if (msg.player_state) ynisonAnswered = true;
        return;
      }
      if (cfg.keepTrack === false || ynisonAnswered || ynisonRestored || !fullRid || !device) return;
      let state = null;
      try {
        state = JSON.parse(localStorage.getItem(YNISON_KEY) || 'null');
      } catch (err) {}
      if (!state || !state.player_queue || !state.status) return;
      ynisonRestored = true;
      e.stopImmediatePropagation();
      const now = Date.now();
      const deviceId = device.info && device.info.device_id;
      // Версии новее начального пустого состояния клиента (timestamp_ms 0), иначе он
      // сочтёт их устаревшими и не применит.
      const version = { device_id: deviceId, version: Math.floor(Math.random() * 1e15), timestamp_ms: now };
      state.player_queue.version = version;
      state.status = { ...state.status, paused: true, version };
      emit(JSON.stringify({ player_state: state, devices: [device], active_device_id_optional: deviceId, timestamp_ms: now, rid: fullRid }));
      emit(e.data);
    });
  };
  window.WebSocket = class extends NativeWebSocket {
    constructor(url, protocols) {
      super(url, protocols);
      if (/\/ynison_state\.YnisonStateService\/PutYnisonState/.test(String(url))) watchYnison(this);
    }
  };

  // ---------------------------------------------------------------------------
  // Скорость
  // ---------------------------------------------------------------------------
  const SPEED_MIN = 0.5;
  const SPEED_MAX = 2;
  const fmtSpeed = (v) => `${String(Math.round(v * 100) / 100).replace('.', ',')}×`;
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
    // Запись того же текста всё равно меняет DOM и будит наблюдателей страницы.
    const label = fmtSpeed(speed);
    document.querySelectorAll('.tune-speed-label').forEach((l) => l.textContent !== label && (l.textContent = label));
  };
  // Шаг скорости — из настроек (0,05 / 0,1 / 0,25). Клик идёт по кругу от 0,5× до 2×,
  // колесо над кнопкой упирается в края, 0 — сброс на 1×.
  const setSpeed = (v) => {
    speed = Math.round(Math.min(SPEED_MAX, Math.max(SPEED_MIN, v)) * 100) / 100;
    try {
      localStorage.setItem('tune:speed', String(speed));
    } catch (e) {}
    applySpeed();
    applyPitch();
    T.toast(`Скорость ${fmtSpeed(speed)}`, { ms: 1200 });
  };
  const speedStep = () => Number(cfg.speedStep) || 0.25;
  const stepSpeed = (dir, wrap = true) => {
    if (dir === 0) return setSpeed(1);
    const st = speedStep();
    // Сначала на ближайшее деление сетки шага, потом дальше.
    let next = dir > 0 ? Math.floor(speed / st + 1e-6) * st + st : Math.ceil(speed / st - 1e-6) * st - st;
    if (wrap && next > SPEED_MAX + 1e-6) next = SPEED_MIN;
    else if (wrap && next < SPEED_MIN - 1e-6) next = SPEED_MAX;
    setSpeed(next);
  };

  // ---------------------------------------------------------------------------
  // Найткор / слоуд и реверб. Тон вслед за скоростью — preservesPitch = false у аудио
  // плеера. Реверб — свой узел между звуковым графом Яндекса (эквалайзер, кроссфейд)
  // и динамиками: подключение к destination перехватывается и идёт через него.
  // ---------------------------------------------------------------------------
  const mediaEls = new Set();
  const applyPitch = () => {
    const keep = !(cfg.speedControl && cfg.pitchWithSpeed);
    for (const el of mediaEls) if (el.preservesPitch !== keep) el.preservesPitch = keep;
  };
  const trackMedia = (el) => {
    if (!(el instanceof HTMLMediaElement) || mediaEls.has(el)) return;
    mediaEls.add(el);
    el.preservesPitch = !(cfg.speedControl && cfg.pitchWithSpeed);
  };
  const origPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...args) {
    trackMedia(this);
    return origPlay.apply(this, args);
  };
  const origMediaSource = AudioContext.prototype.createMediaElementSource;
  AudioContext.prototype.createMediaElementSource = function (el) {
    trackMedia(el);
    return origMediaSource.call(this, el);
  };

  const fxList = new Set();
  const origConnect = AudioNode.prototype.connect;
  const origDisconnect = AudioNode.prototype.disconnect;
  // Импульс зала: стерео-шум с плавным затуханием, у каналов свой шум — звук шире.
  const makeImpulse = (ctx) => {
    const len = Math.floor(ctx.sampleRate * 3.2);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8);
    }
    return buf;
  };
  const applyFx = (fx) => {
    const mix = Math.min(100, Math.max(0, Number(cfg.reverb) || 0)) / 100;
    if (mix > 0 && !fx.conv.buffer) fx.conv.buffer = makeImpulse(fx.ctx);
    const t = fx.ctx.currentTime;
    fx.wet.gain.setTargetAtTime(mix * 0.8, t, 0.05);
    fx.dry.gain.setTargetAtTime(1 - mix * 0.4, t, 0.05);
  };
  const fxFor = (ctx) => {
    for (const fx of fxList) if (fx.ctx === ctx) return fx;
    const fx = { ctx, input: ctx.createGain(), dry: ctx.createGain(), wet: ctx.createGain(), conv: ctx.createConvolver() };
    fx.wet.gain.value = 0;
    origConnect.call(fx.input, fx.dry);
    origConnect.call(fx.dry, ctx.destination);
    origConnect.call(fx.input, fx.conv);
    origConnect.call(fx.conv, fx.wet);
    origConnect.call(fx.wet, ctx.destination);
    fxList.add(fx);
    applyFx(fx);
    return fx;
  };
  const isOutput = (dest) => typeof AudioDestinationNode !== 'undefined' && dest instanceof AudioDestinationNode && dest.context instanceof AudioContext;
  AudioNode.prototype.connect = function (dest, ...rest) {
    if (isOutput(dest)) {
      origConnect.call(this, fxFor(dest.context).input, ...rest);
      return dest;
    }
    return origConnect.call(this, dest, ...rest);
  };
  AudioNode.prototype.disconnect = function (dest, ...rest) {
    if (isOutput(dest)) return origDisconnect.call(this, fxFor(dest.context).input, ...rest);
    return origDisconnect.apply(this, arguments);
  };
  const applyAudioFx = () => {
    applyPitch();
    for (const fx of fxList) {
      if (fx.ctx.state === 'closed') fxList.delete(fx);
      else applyFx(fx);
    }
  };

  // ---------------------------------------------------------------------------
  // Громкость колесом над плеером
  // ---------------------------------------------------------------------------
  const PLAYER_BARS = '[data-test-id="PLAYERBAR_DESKTOP"], [data-test-id="VIBE_PLAYERBAR"], [class*="PlayerBarDesktop_root"], [data-test-id="FULLSCREEN_PLAYER_MODAL"]';
  // Громкость Яндекса логарифмическая: ползунок показывает exponentVolume (0…1), а звук —
  // 0,01^(1 − x). Шагаем по сетке 5 % в процентах ползунка: прибавление ±0,05 к дробному
  // значению копило ошибку и застревало у нуля.
  const volumeStep = () => Math.min(25, Math.max(1, Math.round(Number(cfg.volumeStep) || 5)));
  const showVolume = () => {
    const v = player.volume();
    if (typeof v === 'number') T.toast(`Громкость ${Math.round(v * 100)} %`, { ms: 900 });
  };
  const stepVolume = (dir, steps = 1) => {
    const v = player.volume();
    if (typeof v !== 'number') return;
    const cur = Math.round(v * 100);
    const st = volumeStep();
    const by = st * steps;
    const next = dir > 0 ? Math.min(100, Math.floor(cur / st) * st + by) : Math.max(0, Math.ceil(cur / st) * st - by);
    player.volume(next / 100);
    // Показываем, что плеер в итоге применил, а не что мы просили.
    setTimeout(showVolume, 30);
  };
  // Колёса с плавной прокруткой и тачпады шлют много мелких событий — копим до «щелчка».
  let wheelAcc = 0;
  let speedWheelAt = 0;
  let wheelAt = 0;
  window.addEventListener(
    'wheel',
    (e) => {
      if (!e.deltaY || !(e.target instanceof Element)) return;
      // Над кнопкой скорости колесо меняет скорость.
      if (cfg.speedControl && e.target.closest('[data-tune="speed"]')) {
        e.preventDefault();
        e.stopPropagation();
        const now = performance.now();
        if (now - speedWheelAt < 120) return;
        speedWheelAt = now;
        stepSpeed(e.deltaY < 0 ? 1 : -1, false);
        return;
      }
      if (!cfg.wheelVolume || !e.target.closest(PLAYER_BARS)) return;
      if (e.target.closest('#tune-lyrics')) return;
      if (typeof player.volume() !== 'number') return;
      // Свой обработчик колеса (шаг 1 %) есть у кнопки и ползунка громкости Яндекса —
      // гасим событие, чтобы во всей панели работал один шаг.
      e.preventDefault();
      e.stopPropagation();
      const now = performance.now();
      if (now - wheelAt > 400 || Math.sign(wheelAcc) !== Math.sign(e.deltaY)) wheelAcc = 0;
      wheelAt = now;
      wheelAcc += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 100 : e.deltaY;
      // Обычный щелчок колеса в Windows — 100 px; мелкие порции копятся до него.
      if (Math.abs(wheelAcc) < 50) return;
      const notches = Math.max(1, Math.min(4, Math.round(Math.abs(wheelAcc) / 100)));
      const dir = wheelAcc < 0 ? 1 : -1;
      wheelAcc = 0;
      stepVolume(dir, notches);
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
      stepVolume(e.code === 'ArrowUp' ? 1 : -1);
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
  let snapScroll = false;
  let activeIndex = -1;
  const cache = new Map();

  let lyricsAvailable = false;
  const lyricsWanted = () => cfg.lyrics && !!ym.meta();
  // Свой синхронный текст Яндекса берём у Яндекса, если не просили искать и для таких треков.
  const yandexSync = (meta) => !!(meta && meta.lyricsInfo && meta.lyricsInfo.hasAvailableSyncLyrics);
  const fromYandex = (meta) => !cfg.lyricsAlways && yandexSync(meta);
  // Поколение настроек источников: поиск, начатый до их смены, свой ответ не отдаёт.
  let lyricsGen = 0;
  const lyricsKey = (meta) => `${lyricsGen}:${fromYandex(meta) ? 'ym' : 'ext'}:${meta.id}`;

  // Строки с авторами, которые источники ставят в начало текста: «作词 : …»,
  // «Lyrics by: …», «Текст: …». Это не слова песни.
  const CREDIT_WORDS = /^(lyrics|lyricist|composer|composed|written|producer|produced|arrang|mix|master|текст|слова|музыка|автор|аранжировка|сведение|мастеринг)/;
  const isCredit = (line) => {
    const m = /^\s*([^:：]{1,24})[:：]/.exec(line);
    if (!m) return false;
    const head = m[1].trim().toLowerCase();
    return /[\u4e00-\u9fff]/.test(head) || CREDIT_WORDS.test(head);
  };
  const parseLrc = (text) => {
    const out = [];
    for (const raw of text.split(/\r?\n/)) {
      const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:[.,]\d+)?)\]/g)];
      if (!stamps.length) continue;
      const body = raw.replace(/\[[^\]]*\]/g, '').trim();
      if (isCredit(body)) continue;
      for (const s of stamps) out.push({ t: Number(s[1]) * 60 + Number(s[2].replace(',', '.')), text: body });
    }
    return out.sort((a, b) => a.t - b.t);
  };

  // Для сравнения названий: без регистра, «ё», скобок с пометками и знаков.
  const normName = (v) =>
    String(v || '')
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[([（][^)\]）]*[)\]）]/g, '')
      .replace(/[^\p{L}\p{N}]/gu, '');
  const artistNames = (meta) => (meta.artists || []).map((a) => a.name).filter(Boolean);
  // Чужой трек с похожим названием хуже, чем никакого: берём только тот же трек.
  const sameTrack = (meta, title, artist, seconds) => {
    if (!title || normName(title) !== normName(meta.title)) return false;
    const theirs = normName(artist);
    const artistOk = !theirs || artistNames(meta).some((n) => {
      const mine = normName(n);
      return mine && (theirs.includes(mine) || mine.includes(theirs));
    });
    const duration = Math.round((meta.durationMs || 0) / 1000);
    return artistOk && (!duration || !seconds || Math.abs(seconds - duration) <= 6);
  };

  const lrclib = async (meta) => {
    const firstArtist = artistNames(meta)[0] || '';
    const title = meta.title;
    const album = ((meta.albums || [])[0] || {}).title || '';
    const duration = Math.round((meta.durationMs || 0) / 1000);
    const q = (o) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    const get = async (url) => {
      const r = await fetch(url, { headers: { 'Lrclib-Client': 'Tune Music' } });
      return r.ok ? r.json() : null;
    };
    const exact = await get(`https://lrclib.net/api/get?${q({ track_name: title, artist_name: firstArtist, album_name: album, duration })}`).catch(() => null);
    if (exact && exact.syncedLyrics) return exact;
    const list = (await get(`https://lrclib.net/api/search?${q({ track_name: title, artist_name: firstArtist })}`).catch(() => null)) || [];
    const same = list.filter((x) => (x.syncedLyrics || x.plainLyrics || x.instrumental) && sameTrack(meta, x.trackName, x.artistName, x.duration));
    return same.find((x) => x.syncedLyrics) || exact || same[0] || null;
  };

  // NetEase: много синхронных текстов, в том числе русских. Запрос идёт через Tune —
  // со страницы NetEase не пускает (нет заголовков CORS).
  const netease = (meta) =>
    T.invoke('page_lyrics', { title: meta.title, artists: artistNames(meta), duration: Math.round((meta.durationMs || 0) / 1000) }).catch(() => null);

  // Текст Яндекса качает его же хранилище (подпись запроса знает только клиент). Хранилище
  // одно на все треки, поэтому запросы идут по очереди.
  const fmtStamp = (sec) => {
    const m = Math.floor(sec / 60);
    const rest = (sec - m * 60).toFixed(2).padStart(5, '0');
    return `[${String(m).padStart(2, '0')}:${rest}]`;
  };
  let yandexQueue = Promise.resolve();
  const yandexLyrics = (meta) => {
    const run = async () => {
      // Сразу после запуска интерфейс ещё собирается и хранилища нет — ждём его до 10 секунд.
      for (let i = 0; i < 40 && !fsStore(); i++) await new Promise((r) => setTimeout(r, 250));
      const sync = fsStore() && fsStore().syncLyrics;
      if (!sync || typeof sync.getData !== 'function') return null;
      await sync.getData(meta.id);
      if (String(sync.currentTrackId) !== String(meta.id) || !sync.lines || !sync.lines.length) return null;
      return { syncedLyrics: sync.lines.map((l) => `${fmtStamp(l.fromSec)}${l.text}`).join('\n') };
    };
    const job = yandexQueue.then(run, run);
    yandexQueue = job.catch(() => null);
    return job;
  };
  // Яндекс (если выбран), затем LRCLIB и NetEase в порядке из настроек; каждый можно выключить. Синхронный текст лучше простого: простой из
  // LRCLIB берём, только если синхронного не нашлось нигде.
  // Обычный текст Яндекса (без времени) качает хранилище trackLyrics — то, что
  // показывает его окно текста; окно для этого не открываем.
  const yandexText = async (meta) => {
    for (let i = 0; i < 40 && !rootStore(); i++) await new Promise((r) => setTimeout(r, 250));
    const tl = rootStore() && rootStore().trackLyrics;
    if (!tl || typeof tl.getLyrics !== 'function') return null;
    await tl.getLyrics(meta.id);
    for (let i = 0; i < 40 && tl.isLoading; i++) await new Promise((r) => setTimeout(r, 100));
    return String(tl.currentTrackId) === String(meta.id) && tl.lyrics ? { plainLyrics: tl.lyrics } : null;
  };

  const findLyrics = async (meta) => {
    if (fromYandex(meta)) {
      const hit = await yandexLyrics(meta).catch(() => null);
      if (hit) return hit;
    }
    const search = { lrclib: () => lrclib(meta), netease: () => netease(meta) };
    const enabled = { lrclib: cfg.lyricsLrclib !== false, netease: cfg.lyricsNetease !== false };
    const order = [...(cfg.lyricsOrder || []), 'lrclib', 'netease'].filter((s, i, a) => search[s] && a.indexOf(s) === i);
    let fallback = null;
    for (const src of order) {
      if (!enabled[src]) continue;
      const hit = await search[src]().catch(() => null);
      if (hit && hit.syncedLyrics) return hit;
      fallback = fallback || hit;
    }
    // Нигде нет синхронного, а у Яндекса есть — берём его: текст всё равно откроется в окне
    // Tune, а не на странице Яндекса.
    if (yandexSync(meta) && !fromYandex(meta)) {
      const own = await yandexLyrics(meta).catch(() => null);
      if (own) return own;
    }
    // Синхронного нет нигде — обычный текст Яндекса лучше простого из LRCLIB.
    if (meta.lyricsInfo && meta.lyricsInfo.hasAvailableTextLyrics) {
      const text = await yandexText(meta).catch(() => null);
      if (text) return text;
    }
    return fallback;
  };

  // Один запрос на трек: и текущий, и заранее подгружаемый следующий.
  const lyricsPending = new Map();
  const fetchLyrics = (meta) => {
    const key = lyricsKey(meta);
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    if (!lyricsPending.has(key)) {
      lyricsPending.set(
        key,
        findLyrics(meta)
          .catch(() => null)
          .then((hit) => {
            cache.set(key, hit);
            lyricsPending.delete(key);
            return hit;
          })
      );
    }
    return lyricsPending.get(key);
  };

  // Следующий трек очереди — его текст ищем заранее, чтобы при переключении он был сразу.
  const nextMeta = () => {
    const s = ym.state();
    const q = s && s.queueState;
    if (!q) return null;
    const pick = (v) => {
      const e = v && (v.entity || v);
      return (e && e.entityData && e.entityData.meta) || null;
    };
    const next = pick(q.nextEntity && q.nextEntity.value);
    if (next) return next;
    const list = q.entityList && q.entityList.value;
    const i = q.nextIndex && q.nextIndex.value;
    return list && typeof i === 'number' ? pick(list[i]) : null;
  };
  const prefetchNext = () => {
    const meta = cfg.lyrics && nextMeta();
    if (!meta || !meta.id || !meta.title) return;
    fetchLyrics(meta);
  };

  const viewOf = (hit) => {
    if (hit && hit.syncedLyrics) return { lines: parseLrc(hit.syncedLyrics), plain: '', status: '' };
    if (hit && hit.plainLyrics) {
      const text = hit.plainLyrics.split(/\r?\n/).filter((l) => !isCredit(l)).join('\n').trim();
      return { lines: [], plain: text, status: '' };
    }
    return { lines: [], plain: '', status: hit && hit.instrumental ? 'Инструментальный трек' : 'Текст не найден' };
  };

  // Текст другого трека — из меню «…» в списке. Без подсветки и перемотки: трек не играет.
  // Кнопка «Текст» в плеере возвращает окно к играющему треку.
  let other = null;
  // Снимок трека из хранилища Яндекса: название, исполнители, обложка, длительность.
  // Признаки текста там — hasLyrics и hasSyncLyrics, а не lyricsInfo, как у играющего.
  const trackMeta = (t) => {
    const snap = JSON.parse(JSON.stringify(t));
    const lyricsInfo = snap.lyricsInfo || { hasAvailableSyncLyrics: !!snap.hasSyncLyrics, hasAvailableTextLyrics: snap.hasLyrics !== false };
    return { ...snap, lyricsInfo };
  };
  const showOther = async (meta) => {
    other = { meta, lines: [], plain: '', status: SEARCHING };
    const mine = other;
    if (!lyricsOpen) toggleLyrics(true);
    else render();
    const hit = await findLyrics(meta).catch(() => null);
    if (other !== mine) return;
    Object.assign(other, viewOf(hit));
    render();
  };
  const showCurrent = () => {
    other = null;
    render();
    mountPlayerButtons();
  };

  const loadLyrics = async () => {
    const meta = ym.meta();
    if (!meta) return;
    const key = String(meta.id);
    if (key === lyricsFor) return;
    lyricsFor = key;
    const gen = lyricsGen;
    let hit = cache.get(lyricsKey(meta));
    if (hit === undefined) {
      lines = [];
      plain = '';
      activeIndex = -1;
      status = SEARCHING;
      render();
      mountPlayerButtons();
      hit = await fetchLyrics(meta);
      if (lyricsFor !== key || gen !== lyricsGen) return;
    }
    lyricsAvailable = !!(hit && (hit.syncedLyrics || hit.plainLyrics));
    // Текста у нового трека нет — окно плавно уходит со старым текстом, без «Текст не найден».
    if (lyricsOpen && !lyricsAvailable && !other) toggleLyrics(false);
    activeIndex = -1;
    ({ lines, plain, status } = viewOf(hit));
    mountPlayerButtons();
    render();
    prefetchNext();
  };

  const ensurePanel = () => {
    if (panel && panel.isConnected) return panel;
    panel = document.createElement('section');
    panel.id = 'tune-lyrics';
    panel.hidden = true;
    const svg = (d) => `<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">${d}</svg>`;
    const ctrl = (cls) => `
      <div class="tune-ly-ctrl ${cls}">
        <button class="tune-ly-tool" data-act="prev" title="Предыдущая песня">${svg('<path d="M3 3h1.6v10H3zM13 3.6v8.8L5.8 8z"/>')}</button>
        <button class="tune-ly-tool" data-act="play" title="Пауза / воспроизведение">${svg('<path class="tune-ly-ico-play" d="M4.6 2.8v10.4L13 8z"/><path class="tune-ly-ico-pause" d="M4 3h2.8v10H4zm5.2 0H12v10H9.2z"/>')}</button>
        <button class="tune-ly-tool" data-act="next" title="Следующая песня">${svg('<path d="M11.4 3H13v10h-1.6zM3 3.6v8.8L10.2 8z"/>')}</button>
      </div>`;
    panel.innerHTML = `
      <div class="tune-ly-art"></div>
      <div class="tune-ly-head">
        <div class="tune-ly-cover"><img alt="" />${ctrl('tune-ly-oncover')}</div>
        <div class="tune-ly-meta"><div class="tune-ly-title"></div><div class="tune-ly-sub"></div></div>
        ${ctrl('tune-ly-mini')}
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
      if (act === 'full') lyricsFull ? collapseFull() : toggleFull(true);
      if (act === 'prev') player.prev();
      if (act === 'next') player.next();
      if (act === 'play') player.toggle();
      if (act === 'earlier' || act === 'later') {
        offset = Math.round((offset + (act === 'later' ? 0.5 : -0.5)) * 10) / 10;
        renderOffset();
      }
      const line = e.target.closest('.tune-ly-line');
      if (line && line.dataset.t && !other) player.seek(Math.max(0, Number(line.dataset.t) - offset));
    });
    const lyBody = panel.querySelector('.tune-ly-body');
    lyBody.addEventListener(
      'wheel',
      (e) => {
        userScrollAt = performance.now();
        // Полноэкранный плеер Яндекса глушит колесо вне себя — на весь экран крутим сами.
        if (!lyricsFull) return;
        e.preventDefault();
        e.stopPropagation();
        lyBody.scrollTop += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
      },
      { passive: false }
    );
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
    // Текст трека из меню «…» (не играющего) или играющего сейчас.
    const view = other || { meta: ym.meta(), lines, plain, status };
    const meta = view.meta;
    p.classList.toggle('tune-static', !!other);
    p.style.fontSize = `${cfg.lyricsFontSize || 22}px`;
    const cover = meta ? ym.cover(meta, lyricsOwn ? '400x400' : '100x100') : '';
    p.querySelector('img').src = cover;
    p.querySelector('.tune-ly-art').style.backgroundImage = lyricsOwn && cover ? `url("${cover}")` : '';
    // Фон — средний цвет обложки, как у родного текста Яндекса в полноэкранном плеере.
    const bar = document.querySelector('[class*="PlayerBarDesktop"]');
    const avg = bar ? getComputedStyle(bar).getPropertyValue('--player-average-color-background').trim() : '';
    p.style.setProperty('--tune-ly-bg', avg || '');
    layout();
    p.querySelector('.tune-ly-title').textContent = meta ? meta.title : '';
    p.querySelector('.tune-ly-sub').textContent = meta ? (meta.artists || []).map((a) => a.name).join(', ') : '';
    const body = p.querySelector('.tune-ly-body');
    body.textContent = '';
    if (view.status) {
      const s = document.createElement('div');
      s.className = 'tune-ly-status';
      if (view.status === SEARCHING) {
        s.className = 'tune-ly-dots';
        s.innerHTML = '<i></i><i></i><i></i>';
        s.title = view.status;
      } else s.textContent = view.status;
      body.appendChild(s);
    } else if (view.lines.length) {
      for (const l of view.lines) {
        const el = document.createElement('p');
        // Имена классов — как у родного текста Яндекса: темы оформляют его по
        // [class*="SyncLyricsLine_root"] и т. п., так они оформят и этот.
        el.className = 'tune-ly-line SyncLyricsScroller_line' + (l.text ? '' : ' tune-gap');
        el.dataset.t = String(l.t);
        const span = document.createElement('span');
        span.className = 'SyncLyricsLine_root';
        span.textContent = l.text || '♪';
        el.appendChild(span);
        body.appendChild(el);
      }
    } else if (view.plain) {
      const el = document.createElement('div');
      el.className = 'tune-ly-plain';
      el.textContent = view.plain;
      body.appendChild(el);
    }
    // Без синхронных строк прокручивать не к чему — текст с начала.
    if (!view.lines.length || other) body.scrollTop = 0;
    renderOffset();
    // Текст пересобран — строку ищем заново и ставим на место сразу, без прокрутки через
    // весь текст (прокрутка могла остаться внизу от прошлого трека).
    activeIndex = -2;
    snapScroll = true;
    userScrollAt = 0;
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

  // Кадры крутятся, только пока окно текста открыто: пустой цикл requestAnimationFrame
  // заставляет WebView2 готовить каждый кадр монитора и при закрытом окне.
  let frameId = 0;
  let frameAt = 0;
  const startFrames = () => {
    if (!frameId) frameId = requestAnimationFrame(frame);
  };
  // Окно снова видно (развернули, показали из трея, открыли из-под других окон): кадр,
  // заказанный, пока оно было скрыто, WebView2 может так и не отдать, и цикл замирает.
  // Заказываем заново, а текст сразу ставим на текущую строку, без прокрутки через весь текст.
  const resumeFrames = () => {
    if (!lyricsOpen || document.hidden) return;
    cancelAnimationFrame(frameId);
    frameId = 0;
    activeIndex = -2;
    snapScroll = true;
    startFrames();
  };
  document.addEventListener('visibilitychange', resumeFrames);
  // Страховка: окно видно, текст открыт, а кадров нет дольше полсекунды.
  setInterval(() => {
    if (lyricsOpen && !document.hidden && performance.now() - frameAt > 500) resumeFrames();
  }, 1000);
  const frame = () => {
    frameId = 0;
    frameAt = performance.now();
    if (!lyricsOpen) return;
    if (panel) {
      const playing = !!player.isPlaying();
      if (panel.classList.contains('tune-playing') !== playing) panel.classList.toggle('tune-playing', playing);
    }
    if (lyricsOpen && lines.length && panel && !other) {
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
          el.classList.toggle('SyncLyricsScroller_line_active', k === i);
          el.classList.toggle('tune-past', k < i);
        });
        activeIndex = i;
        const el = els[Math.max(0, i)];
        if (el && performance.now() - userScrollAt > 3000) {
          const body = panel.querySelector('.tune-ly-body');
          body.scrollTo({ top: el.offsetTop - body.clientHeight * 0.38, behavior: snapScroll ? 'instant' : 'smooth' });
          snapScroll = false;
        }
      }
    }
    startFrames();
  };

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
    const tb = document.querySelector('[class*="TitleBar_root"], #tune-titlebar');
    set('--tune-ly-tb', tb ? `${Math.round(tb.getBoundingClientRect().bottom)}px` : '');
    const c = main && document.querySelector('style[data-tune-theme]') ? getComputedStyle(main) : null;
    set('--tune-ly-surface', c ? `linear-gradient(${c.backgroundColor}, ${c.backgroundColor}), rgba(0,0,0,.18)` : '');
    set('--tune-ly-blur', c && c.backdropFilter !== 'none' ? c.backdropFilter : '');
    set('--tune-ly-border', c && c.borderTopStyle !== 'none' ? `${c.borderTopWidth} ${c.borderTopStyle} ${c.borderTopColor}` : '');
    set('--tune-ly-radius', c && c.borderTopLeftRadius !== '0px' ? c.borderTopLeftRadius : '');
    set('--tune-ly-shadow', c && c.boxShadow !== 'none' ? c.boxShadow : '');
    // Цвет текста темы без прозрачности: яркость строк задаём сами через opacity.
    set('--tune-ly-fg', c ? c.color.replace(/^rgba\(([^,]+),([^,]+),([^,]+),[^)]*\)$/, 'rgb($1,$2,$3)') : '');
  };
  window.addEventListener('resize', () => lyricsOpen && layout());

  const FULL_ICONS = {
    open: '<path d="M10 2.5h3.5V6M6 13.5H2.5V10M13.5 2.5 9 7M2.5 13.5 7 9"/>',
    close: '<path d="M13.5 6H10V2.5M2.5 10H6v3.5M10 6l3.5-3.5M6 10l-3.5 3.5"/>',
  };
  // Весь экран — это полноэкранный плеер Яндекса с нашим текстом справа.
  const fsModal = () => document.querySelector('[data-test-id="FULLSCREEN_PLAYER_MODAL"]');
  let lyricsFull = false;
  let lyricsOwn = false; // полноэкранного плеера на странице нет — своя страница текста
  let fsOpenedByUs = false; // плеер открыли мы — при выходе закрываем его и возвращаем окно
  let fsSeen = false;
  // Хранилище полноэкранного плеера Яндекса (fullscreenPlayer): открывает плеер с любой
  // страницы, даже с главной «Моей волны», где кнопки «на весь экран» нет, и знает про очередь.
  let fsStoreCache = null;
  let rootStoreCache = null;
  const rootStore = () => (fsStore(), rootStoreCache);
  const fsStore = () => {
    if (fsStoreCache) return fsStoreCache;
    for (const start of document.querySelectorAll('main, [class*="CommonLayout"]')) {
      const key = Object.keys(start).find((k) => k.startsWith('__reactFiber'));
      let f = key && start[key];
      for (let i = 0; f && i < 600; i++, f = f.return) {
        const v = f.memoizedProps && f.memoizedProps.value;
        if (v && typeof v === 'object' && v.fullscreenPlayer && typeof v.fullscreenPlayer.showFullscreenPlayerModal === 'function') {
          rootStoreCache = v;
          return (fsStoreCache = v.fullscreenPlayer);
        }
      }
    }
    return null;
  };
  let fsShifted = false;
  let handoffTimer = 0;
  const markFs = () => {
    const m = fsModal();
    const on = lyricsOpen && lyricsFull && !lyricsOwn && !!m;
    // Наш текст сменяется очередью Яндекса (или наоборот) — сдвиг обложки переходит от
    // нас к Яндексу без анимации: она уже стоит там, где нужно.
    const store = fsStore();
    const split = !!(store && store.playQueue && store.playQueue.isVisible) || !!(m && m.querySelector('[class*="fullscreenContent_enter"]'));
    if (m && on !== fsShifted && (on ? split : !!(store && store.playQueue && store.playQueue.isVisible))) {
      m.dataset.tuneHandoff = '1';
      clearTimeout(handoffTimer);
      handoffTimer = setTimeout(() => {
        const cur = fsModal();
        if (cur) delete cur.dataset.tuneHandoff;
      }, 1000);
    }
    fsShifted = on;
    for (const el of document.querySelectorAll('[data-tune-fs]')) if (!on || el !== m) delete el.dataset.tuneFs;
    if (on && !m.dataset.tuneFs) m.dataset.tuneFs = '1';
    // Текст живёт внутри плеера Яндекса: иначе клик по строке для плеера — «клик мимо»,
    // и он закрывается, а колесо и фокус он гасит.
    if (!panel) return;
    const host = on ? m : document.body;
    if (panel.parentElement !== host) {
      // Перенос сбрасывает прокрутку в начало. Возвращаем её сразу: при закрытии текст
      // уходит с анимацией с того же места, а не прыгает сначала к началу.
      const body = panel.querySelector('.tune-ly-body');
      const top = body ? body.scrollTop : 0;
      host.appendChild(panel);
      if (body) body.scrollTop = top;
      activeIndex = -2;
      snapScroll = true;
    }
  };
  const toggleFull = (force) => {
    const want = typeof force === 'boolean' ? force : !lyricsFull;
    if (want && !lyricsFull && !fsModal()) {
      const store = fsStore();
      const open = [...document.querySelectorAll('[data-test-id="FULLSCREEN_PLAYER_BUTTON"]')].find((b) => b.getClientRects().length);
      fsOpenedByUs = true;
      lyricsOwn = !store && !open;
      if (store) store.showFullscreenPlayerModal();
      else if (open) open.click();
    }
    // Текст и очередь в плеере сменяют друг друга, как у Яндекса.
    const store = fsStore();
    if (want && store && store.playQueue && store.playQueue.isVisible) store.hidePlayQueue();
    if (!want) lyricsOwn = false;
    if (!want && lyricsFull && fsOpenedByUs) {
      const m = fsModal();
      const close = m && m.querySelector('[data-test-id="FULLSCREEN_PLAYER_CLOSE_BUTTON"]');
      if (store && store.modal && store.modal.isOpened) store.modal.close();
      else if (close) close.click();
    }
    if (!want) fsOpenedByUs = false;
    lyricsFull = want;
    fsSeen = false;
    const p = ensurePanel();
    p.classList.toggle('tune-full', lyricsFull);
    p.classList.toggle('tune-own', lyricsOwn);
    document.body.classList.toggle('tune-ly-own-on', lyricsOwn);
    for (const btn of p.querySelectorAll('[data-act="full"]')) {
      btn.title = lyricsFull ? 'Свернуть' : 'На весь экран';
      btn.setAttribute('aria-label', btn.title);
      btn.innerHTML = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${FULL_ICONS[lyricsFull ? 'close' : 'open']}</svg>`;
    }
    markFs();
    render();
    // Закрывающийся плеер Яндекса не должен считаться новым меню и убирать окно.
    popupsSeen = new Set([...popupsSeen, ...document.querySelectorAll('[data-test-id="FULLSCREEN_PLAYER_MODAL"]')]);
  };
  // Выход из полного экрана: если плеер открыли мы — назад к окну, иначе просто прячем текст.
  const leaveFull = () => (fsOpenedByUs ? toggleFull(false) : toggleLyrics(false));
  // Кнопка «Свернуть»: текст уходит в окно, а полноэкранный плеер закрывается, кто бы его
  // ни открыл, — иначе окно оказалось бы под ним.
  const collapseFull = () => {
    fsOpenedByUs = true;
    toggleFull(false);
  };
  // Кнопка закрытия плеера Яндекса: переходим к окну сразу, вместе с его анимацией, а не
  // рывком после того, как плеер исчезнет. Плеер он закрывает сам.
  document.addEventListener(
    'click',
    (e) => {
      if (!lyricsOpen || !lyricsFull || lyricsOwn) return;
      if (!(e.target instanceof Element) || !e.target.closest('[data-test-id="FULLSCREEN_PLAYER_CLOSE_BUTTON"]')) return;
      fsOpenedByUs = false;
      toggleFull(false);
    },
    true
  );

  // Открылось другое меню или окно Яндекса (очередь, «…», настройки звука) — убираем текст.
  const POPUPS = '[role="menu"], [role="dialog"]:not(.UserWidget-Dialog), [aria-modal="true"]';
  const openPopups = () =>
    [...document.querySelectorAll(POPUPS)].filter(
      (e) => !(panel && panel.contains(e)) && !(lyricsFull && e.dataset.testId === 'FULLSCREEN_PLAYER_MODAL') && e.getClientRects().length
    );
  // Меню «…» полноэкранного плеера открывается поверх текста во весь экран и не убирает его.
  const keepsFull = (e) => lyricsFull && (e.matches('[role="menu"]') || !!e.querySelector('[role="menu"]'));
  let popupsSeen = new Set();
  let domCheck = 0;
  // Текст Яндекса в полноэкранном плеере или его окно с текстом играющего трека —
  // закрываем и открываем текст Tune (сбоку или во весь экран, как было у Яндекса).
  const replaceYandexLyrics = () => {
    if (!cfg.lyrics) return;
    const store = fsStore();
    if (store && store.isSyncLyricsMode) {
      store.hideSyncLyrics();
      if (!lyricsOpen) toggleLyrics(true);
      toggleFull(true);
      return;
    }
    const root = rootStore();
    const tl = root && root.trackLyrics;
    const meta = ym.meta();
    if (!tl || !tl.modal || !tl.modal.isOpened || !meta) return;
    const id = tl.trackId != null ? tl.trackId : tl.track && tl.track.id;
    if (id == null) return; // не знаем, чей это текст, — пусть покажет Яндекс
    tl.modal.close();
    if (String(id) !== String(meta.id)) {
      // Снимок трека из хранилища Яндекса: название, исполнители, обложка, длительность.
      return showOther(trackMeta(tl.track || { id }));
    }
    if (other) showCurrent();
    if (!lyricsOpen) toggleLyrics(true);
  };
  // Следит за страницей постоянно: сразу ставит кнопку в открывшийся полноэкранный плеер
  // и пункт в меню, а открытое окно текста убирает при появлении другого меню.
  const domWatch = new MutationObserver(() => {
    if (domCheck) return;
    domCheck = requestAnimationFrame(() => {
      domCheck = 0;
      mountFullscreenLyrics();
      mountVibeLyrics();
      mountMenuItems();
      mountUncensorBadges();
      replaceYandexLyrics();
      if (!lyricsOpen) return;
      if (lyricsFull) {
        // Плеер закрыли кнопкой Яндекса — выходим из полного экрана вместе с ним.
        if (fsModal()) {
          fsSeen = true;
          markFs();
          // В плеере открыли очередь — наш текст уступает место.
          const store = fsStore();
          if (store && store.playQueue && store.playQueue.isVisible) {
            toggleLyrics(false);
            return;
          }
        } else if (fsSeen) {
          fsSeen = false;
          fsOpenedByUs = false;
          toggleFull(false);
          return;
        }
      }
      const now = openPopups();
      if (now.some((e) => !popupsSeen.has(e) && !keepsFull(e))) toggleLyrics(false);
      popupsSeen = new Set(now);
    });
  });
  window.addEventListener(
    'keydown',
    (e) => {
      if (!lyricsOpen || e.key !== 'Escape' || typing(e.target) || openPopups().some((p) => !popupsSeen.has(p) || keepsFull(p))) return;
      e.preventDefault();
      e.stopPropagation();
      if (lyricsFull) leaveFull();
      else toggleLyrics(false);
    },
    true
  );

  let closeTimer = 0;
  const toggleLyrics = (force) => {
    // Открыт текст другого трека — кнопка «Текст» сначала возвращает к играющему.
    if (other && lyricsOpen && force === undefined) return showCurrent();
    lyricsOpen = typeof force === 'boolean' ? force : !lyricsOpen;
    const p = ensurePanel();
    const wasShown = !p.hidden;
    clearTimeout(closeTimer);
    p.classList.remove('tune-closing');
    if (lyricsOpen) {
      p.hidden = false;
      if (!p.querySelector('[data-act="full"] svg')) toggleFull(lyricsFull);
      // Полный экран без открытого плеера Яндекса (закрыли, пока текст был скрыт) — обычное окно.
      if (lyricsFull && !lyricsOwn && !fsModal()) {
        fsOpenedByUs = false;
        toggleFull(false);
      }
      render();
      popupsSeen = new Set(openPopups());
      startFrames();
    }
    markFs();
    mountPlayerButtons();
    if (lyricsOpen) return;
    // Окно уходит с анимацией и только потом прячется. С полного экрана — на месте, а
    // полноэкранный плеер Яндекса остаётся открытым: убираем только текст.
    const hide = () => {
      p.classList.remove('tune-closing');
      if (lyricsOpen) return;
      p.hidden = true;
      other = null;
      if (lyricsFull) {
        fsOpenedByUs = false;
        toggleFull(false);
      }
    };
    if (!wasShown) return hide();
    p.classList.add('tune-closing');
    closeTimer = setTimeout(hide, 250);
  };

  // Текст ищем сразу при смене трека: пока ищем или если его нет, кнопка серая.
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
    if (cfg.lyrics) {
      refreshLyrics();
      prefetchNext();
    }
    mountPlayerButtons();
    applySpeed();
    if (cfg.uncensor) loadUncensor();
    mountUncensorBadges();
  };
  window.addEventListener('tune:features', (e) => {
    // Сменили источники текста — найденное раньше больше не годится.
    const sources = (c) => [c.lyricsAlways, c.lyricsLrclib, c.lyricsNetease, c.lyricsOrder].join();
    const before = cfg.lyricsAlways === undefined ? null : sources(cfg);
    cfg = e.detail || {};
    if (before !== null && before !== sources(cfg)) {
      lyricsGen++;
      cache.clear();
      lyricsFor = '';
    }
    cfgReady();
    if (cfg.uncensor) loadUncensor();
    apply();
    // Размер шрифта виден сразу, пока двигают ползунок в настройках. Только размер:
    // полная перерисовка сбросила бы подсвеченную строку.
    if (panel) panel.style.fontSize = `${cfg.lyricsFontSize || 22}px`;
    // Реверб и тон зависят только от настроек: новые узлы и плееры получают их сами.
    applyAudioFx();
  });
  // Окно свёрнуто или спрятано в трей — страницу никто не видит, проверки подождут.
  setInterval(() => {
    if (!document.body || document.hidden) return;
    apply();
  }, 1000);
  document.addEventListener('visibilitychange', () => document.body && !document.hidden && apply());
})();
