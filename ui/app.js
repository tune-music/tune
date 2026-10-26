const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;
const appWindow = window.__TAURI__.window.getCurrentWindow();
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const KIND = { theme: 'Тема', script: 'Скрипт' };

const state = {
  view: 'catalog',
  tab: 'installed',
  kind: 'all',
  query: '',
  installed: [],
  catalog: null,
  catalogError: '',
  catalogLoading: false,
  busy: new Set(),
  settings: null,
  editing: null,
};

// ---------------------------------------------------------------------------
// Общее
// ---------------------------------------------------------------------------

let toastTimer = 0;
function toast(text, error = false) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.toggle('error', error);
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), error ? 5000 : 2600);
}
const fail = (e) => toast(String(e && e.message ? e.message : e), true);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}
function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
const localUrl = (id, rel) => (rel ? `http://tuneaddon.localhost/${encodeURIComponent(id)}/${rel.split('/').map(encodeURIComponent).join('/')}` : null);

function setReload(needed) {
  $('#reload-bar').classList.toggle('hidden', !needed);
}
function afterChange(res) {
  if (res && typeof res.reload === 'boolean') setReload(res.reload);
}

// ---------------------------------------------------------------------------
// Окно
// ---------------------------------------------------------------------------

$$('[data-win]').forEach((b) => b.addEventListener('click', () => appWindow[b.dataset.win]()));
$('#show-client').addEventListener('click', () => invoke('show_client'));
const reloadPage = async () => {
  await invoke('reload_client');
  setReload(false);
  toast('Страница музыки перезагружается');
};
$('#reload-now').addEventListener('click', reloadPage);
$('#reload-client').addEventListener('click', reloadPage);
$('#open-data').addEventListener('click', () => invoke('open_folder', { id: 'data' }).catch(fail));
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link], a[href^="https://"]');
  if (a) {
    e.preventDefault();
    invoke('open_link', { url: a.dataset.link || a.href }).catch(fail);
  }
});
listen('reload-needed', (e) => setReload(!!e.payload));

$$('.nav-item').forEach((b) =>
  b.addEventListener('click', () => {
    state.view = b.dataset.view;
    $$('.nav-item').forEach((x) => x.classList.toggle('active', x === b));
    $('#view-catalog').classList.toggle('hidden', state.view !== 'catalog');
    $('#view-settings').classList.toggle('hidden', state.view !== 'settings');
  })
);

// ---------------------------------------------------------------------------
// Каталог
// ---------------------------------------------------------------------------

$$('.tab').forEach((t) =>
  t.addEventListener('click', () => {
    state.tab = t.dataset.tab;
    $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
    $('#refresh-catalog').classList.toggle('hidden', state.tab !== 'browse');
    if (state.tab === 'browse' && !state.catalog && !state.catalogLoading) loadCatalog(false);
    render();
  })
);
$$('#kind-filter button').forEach((b) =>
  b.addEventListener('click', () => {
    state.kind = b.dataset.kind;
    $$('#kind-filter button').forEach((x) => x.classList.toggle('active', x === b));
    render();
  })
);
$('#search').addEventListener('input', (e) => {
  state.query = e.target.value.trim().toLowerCase();
  render();
});
$('#refresh-catalog').addEventListener('click', () => loadCatalog(true));

async function loadInstalled() {
  state.installed = await invoke('list_addons');
  $('#count-installed').textContent = state.installed.length || '';
  render();
}

async function loadCatalog(force) {
  state.catalogLoading = true;
  state.catalogError = '';
  render();
  try {
    state.catalog = await invoke('catalog', { force });
  } catch (e) {
    state.catalogError = String(e);
  }
  state.catalogLoading = false;
  render();
}

const matches = (a) => {
  if (state.kind !== 'all' && a.kind !== state.kind) return false;
  if (!state.query) return true;
  return [a.name, a.author, a.description, ...(a.tags || [])].join(' ').toLowerCase().includes(state.query);
};

const letter = (name) => esc(((name || '?').trim()[0] || '?').toUpperCase());
function iconHtml(src, name) {
  return src
    ? `<img class="card-icon" src="${esc(src)}" alt="" loading="lazy" data-letter="${letter(name)}" />`
    : `<div class="card-icon">${letter(name)}</div>`;
}
// Картинка не загрузилась — первая буква названия.
document.addEventListener(
  'error',
  (e) => {
    const img = e.target;
    if (img instanceof HTMLImageElement && img.classList.contains('card-icon')) {
      img.replaceWith(el(`<div class="card-icon">${img.dataset.letter || '?'}</div>`));
    }
  },
  true
);
function bannerHtml(src, cls = 'card-banner') {
  return src
    ? `<div class="${cls}" style="background-image:url('${esc(src).replace(/'/g, '%27')}')"></div>`
    : `<div class="${cls} placeholder"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 15l5-4 4 3 3-2 6 4"/></svg></div>`;
}

function originLabel(o) {
  return { store: 'из каталога', link: 'по ссылке', file: 'из файла', import: 'из другого мода', local: 'свой' }[o && o.source] || '';
}

const SETTINGS_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>';
const MORE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';

function installedCard(a) {
  const icon = localUrl(a.id, a.image);
  const banner = localUrl(a.id, a.banner) || icon;
  return el(`
    <article class="card-addon${a.enabled ? '' : ' off'}" data-id="${esc(a.id)}">
      <div style="position:relative">${bannerHtml(banner)}<div class="badges"><span class="badge">${KIND[a.kind]}</span></div></div>
      <div class="card-body">
        ${iconHtml(icon, a.name)}
        <div class="card-name" title="${esc(a.name)}">${esc(a.name)}</div>
        <div class="card-author">${esc(a.author || originLabel(a.origin))}${a.version ? ' · ' + esc(a.version) : ''}</div>
        <div class="card-desc">${esc(a.description || 'Без описания')}</div>
        <div class="card-foot">
          <input type="checkbox" class="switch" ${a.enabled ? 'checked' : ''} aria-label="Включить" data-act="toggle" />
          <span class="spacer"></span>
          ${a.hasSettings ? `<button class="btn btn-ghost icon-btn" data-act="settings" title="Настройки аддона">${SETTINGS_ICON}</button>` : ''}
          <div class="menu-wrap"><button class="btn btn-ghost icon-btn" data-act="more" title="Ещё">${MORE_ICON}</button></div>
        </div>
      </div>
    </article>`);
}

function catalogCard(e) {
  const busy = state.busy.has(e.id);
  const action = busy
    ? '<button class="btn btn-sm" disabled>Устанавливается…</button>'
    : e.update
      ? '<button class="btn btn-primary btn-sm" data-act="install">Обновить</button>'
      : e.installed
        ? '<span class="badge">Установлено</span>'
        : '<button class="btn btn-primary btn-sm" data-act="install">Установить</button>';
  return el(`
    <article class="card-addon" data-id="${esc(e.id)}">
      <div style="position:relative">${bannerHtml(e.banner || e.image)}<div class="badges"><span class="badge">${KIND[e.kind]}</span></div></div>
      <div class="card-body">
        ${iconHtml(e.image, e.name)}
        <div class="card-name" title="${esc(e.name)}">${esc(e.name)}</div>
        <div class="card-author">${esc(e.author || e.repo.split('/')[0])}${e.version ? ' · ' + esc(e.version) : ''}</div>
        <div class="card-desc">${esc(e.description || 'Без описания')}</div>
        <div class="card-foot">${action}<span class="spacer"></span>${e.update ? '<span class="badge update">Есть обновление</span>' : ''}</div>
      </div>
    </article>`);
}

function render() {
  const grid = $('#grid');
  const empty = $('#empty');
  grid.textContent = '';
  empty.classList.add('hidden');
  $('#source-note').classList.toggle('hidden', state.tab !== 'browse');

  if (state.tab === 'installed') {
    const list = state.installed.filter(matches);
    list.forEach((a) => grid.appendChild(installedCard(a)));
    if (!list.length) {
      empty.classList.remove('hidden');
      empty.innerHTML = state.installed.length
        ? '<strong>Ничего не нашлось</strong>Попробуйте другой запрос или фильтр.'
        : '<strong>Пока ничего не установлено</strong>Темы и скрипты — во вкладке «Обзор».<br><button class="btn" data-empty="browse">Открыть обзор</button>';
    }
    return;
  }

  if (state.catalogLoading && !state.catalog) {
    for (let i = 0; i < 6; i++) grid.appendChild(el('<div class="skeleton"></div>'));
    return;
  }
  if (!state.catalog) {
    empty.classList.remove('hidden');
    empty.innerHTML = `<strong>Не удалось загрузить каталог</strong>${esc(state.catalogError)}<br><button class="btn" data-empty="retry">Повторить</button>`;
    return;
  }
  const list = state.catalog.filter(matches);
  list.forEach((e) => grid.appendChild(catalogCard(e)));
  if (!list.length) {
    empty.classList.remove('hidden');
    empty.innerHTML = '<strong>Ничего не нашлось</strong>Попробуйте другой запрос или фильтр.';
  }
}

$('#empty').addEventListener('click', (e) => {
  const act = e.target.closest('[data-empty]')?.dataset.empty;
  if (act === 'browse') $('.tab[data-tab="browse"]').click();
  if (act === 'retry') loadCatalog(true);
});

$('#grid').addEventListener('click', (e) => {
  const card = e.target.closest('.card-addon');
  if (!card || e.target.closest('.menu')) return;
  const id = card.dataset.id;
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (state.tab === 'installed') {
    const a = state.installed.find((x) => x.id === id);
    if (!a) return;
    if (act === 'toggle') return toggleAddon(a, e.target.checked);
    if (act === 'settings') return openAddonSettings(a);
    if (act === 'more') return openMoreMenu(a, e.target.closest('.menu-wrap'));
    if (!act) openInstalledDrawer(a);
  } else {
    const entry = state.catalog.find((x) => x.id === id);
    if (!entry) return;
    if (act === 'install') return installEntry(entry);
    if (!act) openCatalogDrawer(entry);
  }
});

async function toggleAddon(a, on) {
  try {
    const res = await invoke('set_addon_enabled', { id: a.id, enabled: on });
    afterChange(res);
    a.enabled = on;
    $(`.card-addon[data-id="${CSS.escape(a.id)}"]`)?.classList.toggle('off', !on);
    const sw = $(`.card-addon[data-id="${CSS.escape(a.id)}"] .switch`);
    if (sw) sw.checked = on;
    if (res.reload) toast(on ? `«${a.name}» включён — перезагрузите страницу, чтобы применить всё` : `«${a.name}» выключен — перезагрузите страницу, чтобы убрать его скрипт`);
  } catch (err) {
    fail(err);
    loadInstalled();
  }
}

async function installEntry(entry) {
  state.busy.add(entry.id);
  render();
  if ($('#drawer').dataset.id === entry.id) openCatalogDrawer(entry);
  try {
    const res = await invoke('install_from_catalog', { id: entry.id });
    afterChange(res);
    entry.installed = res.id;
    entry.update = false;
    toast(`«${entry.name}» установлен и включён`);
    await loadInstalled();
  } catch (err) {
    fail(err);
  }
  state.busy.delete(entry.id);
  render();
  if ($('#drawer').dataset.id === entry.id) openCatalogDrawer(entry);
}

// --- меню «ещё» ----------------------------------------------------------------

let openMenu = null;
function closeMenus() {
  openMenu?.remove();
  openMenu = null;
  $('#add-menu').classList.add('hidden');
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu-wrap, .menu-floating')) closeMenus();
});
$('#grid').addEventListener('scroll', closeMenus, true);
$('#view-catalog').addEventListener('scroll', () => openMenu && closeMenus());
window.addEventListener('resize', () => openMenu && closeMenus());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeMenus();
    closeDrawer();
    closeModal();
  }
});

function openMoreMenu(a, wrap) {
  const wasOpen = openMenu && openMenu.dataset.owner === a.id;
  closeMenus();
  if (wasOpen) return;
  const menu = el('<div class="menu" role="menu"></div>');
  const items = [
    ['folder', 'Открыть папку'],
    ...(a.hasCss || a.hasJs ? [['edit', 'Редактировать код']] : []),
    ...(a.hasSettings ? [['settings', 'Настройки']] : []),
    ...(a.origin && a.origin.source === 'store' ? [['page', 'Страница в каталоге']] : []),
    ['delete', 'Удалить', 'danger'],
  ];
  for (const [act, label, cls] of items) {
    const b = el(`<button class="${cls || ''}">${esc(label)}</button>`);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      closeMenus();
      addonAction(a, act);
    });
    menu.appendChild(b);
  }
  document.body.appendChild(menu);
  menu.classList.add('menu-floating');
  const r = wrap.getBoundingClientRect();
  const h = menu.offsetHeight;
  const w = menu.offsetWidth;
  const up = r.bottom + 6 + h > window.innerHeight - 8;
  menu.style.top = `${up ? Math.max(8, r.top - 6 - h) : r.bottom + 6}px`;
  menu.style.left = `${Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8))}px`;
  menu.dataset.owner = a.id;
  openMenu = menu;
}

async function addonAction(a, act) {
  if (act === 'folder') return invoke('open_folder', { id: a.id }).catch(fail);
  if (act === 'edit') return openEditor(a);
  if (act === 'settings') return openAddonSettings(a);
  if (act === 'page') {
    if (!state.catalog) await loadCatalog(false);
    const entry = state.catalog && state.catalog.find((x) => x.id === a.origin.storeId);
    if (entry) openCatalogDrawer(entry);
    return;
  }
  if (act === 'delete') {
    const ok = await confirmModal(`Удалить «${a.name}»?`, 'Папка аддона будет удалена вместе с его настройками.', 'Удалить');
    if (!ok) return;
    try {
      afterChange(await invoke('delete_addon', { id: a.id }));
      closeDrawer();
      toast(`«${a.name}» удалён`);
      if (state.catalog) state.catalog.forEach((x) => x.installed === a.id && (x.installed = null));
      await loadInstalled();
    } catch (err) {
      fail(err);
    }
  }
}

// --- добавление ------------------------------------------------------------------

$('#add-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  const m = $('#add-menu');
  const wasHidden = m.classList.contains('hidden');
  closeMenus();
  m.classList.toggle('hidden', !wasHidden);
});
$('#add-menu').addEventListener('click', (e) => {
  const act = e.target.closest('[data-add]')?.dataset.add;
  if (!act) return;
  closeMenus();
  if (act === 'file') $('#file-input').click();
  if (act === 'folder') $('#folder-input').click();
  if (act === 'url') installFromUrl();
  if (act === 'theme' || act === 'script') createAddon(act);
});

const readB64 = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

async function upload(files) {
  if (!files.length) return;
  toast('Устанавливаем…');
  try {
    const payload = [];
    for (const f of files) payload.push({ path: f.webkitRelativePath || f.name, data: await readB64(f) });
    afterChange(await invoke('install_upload', { files: payload }));
    await loadInstalled();
    showInstalledTab();
    toast('Аддон установлен и включён');
  } catch (err) {
    fail(err);
  }
}
$('#file-input').addEventListener('change', (e) => {
  upload([...e.target.files]);
  e.target.value = '';
});
$('#folder-input').addEventListener('change', (e) => {
  const files = [...e.target.files].filter((f) => !/(^|\/)(node_modules|\.git)\//.test(f.webkitRelativePath));
  upload(files);
  e.target.value = '';
});

function showInstalledTab() {
  if (state.tab !== 'installed') $('.tab[data-tab="installed"]').click();
}

async function installFromUrl() {
  const url = await promptModal('Установить по ссылке', 'Ссылка на репозиторий GitHub или прямая ссылка на .zip, .pext, .tar.gz, .css, .js.', 'https://github.com/автор/репозиторий', 'Установить');
  if (!url) return;
  toast('Скачиваем…');
  try {
    afterChange(await invoke('install_from_url', { url }));
    await loadInstalled();
    showInstalledTab();
    toast('Аддон установлен и включён');
  } catch (err) {
    fail(err);
  }
}

async function createAddon(kind) {
  const name = await promptModal(kind === 'theme' ? 'Новая тема' : 'Новый скрипт', 'Название можно поменять позже.', kind === 'theme' ? 'Моя тема' : 'Мой скрипт', 'Создать');
  if (name === null) return;
  try {
    const res = await invoke('create_addon', { kind, name });
    afterChange(res);
    await loadInstalled();
    showInstalledTab();
    const a = state.installed.find((x) => x.id === res.id);
    if (a) openEditor(a);
  } catch (err) {
    fail(err);
  }
}

// ---------------------------------------------------------------------------
// Подробности
// ---------------------------------------------------------------------------

function closeDrawer() {
  $('#drawer').classList.add('hidden');
  $('#drawer-backdrop').classList.add('hidden');
  $('#drawer').dataset.id = '';
}
$('#drawer-backdrop').addEventListener('click', closeDrawer);

function showDrawer(id, html) {
  const old = $('#drawer');
  // Пересоздаём панель, чтобы не копить обработчики.
  const d = old.cloneNode(false);
  old.replaceWith(d);
  d.dataset.id = id;
  d.innerHTML = html;
  d.classList.remove('hidden');
  $('#drawer-backdrop').classList.remove('hidden');
  $('[data-act="close"]', d)?.addEventListener('click', closeDrawer);
  return d;
}

function openCatalogDrawer(e) {
  const busy = state.busy.has(e.id);
  const d = showDrawer(
    e.id,
    `${bannerHtml(e.banner || e.image, 'drawer-banner')}
     <button class="btn btn-ghost icon-btn drawer-close" data-act="close" aria-label="Закрыть">✕</button>
     <div class="drawer-head">${iconHtml(e.image, e.name)}<div><div class="drawer-title">${esc(e.name)}</div>
       <div class="drawer-sub">${KIND[e.kind]} · ${esc(e.author || e.repo.split('/')[0])}${e.version ? ' · ' + esc(e.version) : ''}</div></div></div>
     <div class="drawer-actions">
       ${busy ? '<button class="btn" disabled>Устанавливается…</button>' : e.installed && !e.update ? '<button class="btn" disabled>Установлено</button>' : `<button class="btn btn-primary" data-act="install">${e.update ? 'Обновить' : 'Установить'}</button>`}
       <a class="btn btn-ghost" data-link="${esc(e.homepage)}" href="#">Открыть на GitHub</a>
     </div>
     ${e.tags && e.tags.length ? `<div class="drawer-tags">${e.tags.map((t) => `<span class="badge">${esc(t)}</span>`).join('')}</div>` : ''}
     <div class="readme">${e.description ? `<p>${esc(e.description)}</p>` : ''}${e.readme ? '<p class="row-desc" data-loading>Загружаем описание…</p>' : ''}</div>`
  );
  $('[data-act="install"]', d)?.addEventListener('click', () => installEntry(e));
  if (e.readme) {
    const base = `https://raw.githubusercontent.com/${e.repo}/HEAD/${e.path ? e.path.split('/').map(encodeURIComponent).join('/') + '/' : ''}`;
    fetch(e.readme)
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((md) => {
        $('[data-loading]', d)?.remove();
        $('.readme', d).insertAdjacentHTML('beforeend', markdown(md, (src) => (/^https?:/.test(src) ? src : base + src.replace(/^\.\//, ''))));
      })
      .catch(() => {
        const n = $('[data-loading]', d);
        if (n) n.textContent = 'Описание не загрузилось.';
      });
  }
}

function openInstalledDrawer(a) {
  const icon = localUrl(a.id, a.image);
  const d = showDrawer(
    a.id,
    `${bannerHtml(localUrl(a.id, a.banner) || icon, 'drawer-banner')}
     <button class="btn btn-ghost icon-btn drawer-close" data-act="close" aria-label="Закрыть">✕</button>
     <div class="drawer-head">${iconHtml(icon, a.name)}<div><div class="drawer-title">${esc(a.name)}</div>
       <div class="drawer-sub">${KIND[a.kind]}${a.author ? ' · ' + esc(a.author) : ''}${a.version ? ' · ' + esc(a.version) : ''} · ${esc(originLabel(a.origin))}</div></div></div>
     <div class="drawer-actions">
       <label class="btn"><input type="checkbox" class="switch" data-toggle ${a.enabled ? 'checked' : ''}/> ${a.enabled ? 'Включён' : 'Выключен'}</label>
       ${a.hasSettings ? '<button class="btn" data-act="settings">Настройки</button>' : ''}
       ${a.hasCss || a.hasJs ? '<button class="btn btn-ghost" data-act="edit">Код</button>' : ''}
       <button class="btn btn-ghost" data-act="folder">Папка</button>
       <button class="btn btn-ghost btn-danger" data-act="delete">Удалить</button>
     </div>
     <div class="readme">${a.description ? `<p>${esc(a.description)}</p>` : ''}${a.hasExperiments ? '<p class="row-desc">Часть изменений темы применяется после перезагрузки страницы.</p>' : ''}</div>`
  );
  $('[data-toggle]', d).addEventListener('change', (ev) => toggleAddon(a, ev.target.checked).then(() => openInstalledDrawer(a)));
  $$('[data-act]', d).forEach((b) => {
    if (b.dataset.act !== 'close') b.addEventListener('click', () => addonAction(a, b.dataset.act));
  });
  fetch(localUrl(a.id, 'README.md'))
    .then((r) => (r.ok ? r.text() : ''))
    .then((md) => {
      if (md && d.isConnected) $('.readme', d).insertAdjacentHTML('beforeend', markdown(md, (src) => (/^https?:/.test(src) ? src : localUrl(a.id, src.replace(/^\.\//, '')))));
    })
    .catch(() => {});
}

// Небольшой разбор Markdown для README: заголовки, списки, код, ссылки, картинки.
function markdown(src, resolveImg) {
  const inline = (s) =>
    esc(s)
      .replace(/!\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (_, alt, u) => `<img alt="${alt}" src="${esc(resolveImg(u.replace(/&amp;/g, '&')))}" loading="lazy" />`)
      .replace(/\[([^\]]+)\]\((https:[^)\s]+)\)/g, '<a href="$2">$1</a>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  const out = [];
  let list = null;
  let para = [];
  let code = null;
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
    if (list) out.push(`</${list}>`);
    list = null;
  };
  for (const raw of src.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/)) {
    if (code !== null) {
      if (/^\s*```/.test(raw)) {
        out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
        code = null;
      } else code.push(raw);
      continue;
    }
    const line = raw.trim();
    if (/^```/.test(line)) {
      flush();
      code = [];
      continue;
    }
    if (!line) {
      flush();
      continue;
    }
    const img = line.match(/<img[^>]*src=["']([^"']+)["']/i);
    if (img) {
      flush();
      out.push(`<p><img src="${esc(resolveImg(img[1]))}" alt="" loading="lazy" /></p>`);
      continue;
    }
    if (/^</.test(line)) continue;
    const h = line.match(/^(#{1,4})\s+(.*)/);
    if (h) {
      flush();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      continue;
    }
    const li = line.match(/^([-*+]|\d+\.)\s+(.*)/);
    if (li) {
      if (para.length) flush();
      const type = /\d/.test(li[1]) ? 'ol' : 'ul';
      if (list !== type) {
        if (list) out.push(`</${list}>`);
        out.push(`<${type}>`);
        list = type;
      }
      out.push(`<li>${inline(li[2])}</li>`);
      continue;
    }
    if (/^>/.test(line)) {
      flush();
      out.push(`<blockquote>${inline(line.replace(/^>\s?(\[![A-Z]+\])?/, ''))}</blockquote>`);
      continue;
    }
    if (/^(-{3,}|\*{3,}|\|)/.test(line)) {
      flush();
      continue;
    }
    if (list) flush();
    para.push(line);
  }
  flush();
  return out.join('');
}

// ---------------------------------------------------------------------------
// Модальные окна
// ---------------------------------------------------------------------------

let modalResolve = null;
function closeModal(value = null) {
  if ($('#modal-backdrop').classList.contains('hidden')) return;
  $('#modal-backdrop').classList.add('hidden');
  const r = modalResolve;
  modalResolve = null;
  if (r) r(value);
}
$('#modal-backdrop').addEventListener('mousedown', (e) => {
  if (e.target.id === 'modal-backdrop') closeModal();
});
function openModal(html) {
  const old = $('#modal');
  const m = old.cloneNode(false);
  old.replaceWith(m);
  m.innerHTML = html;
  $('#modal-backdrop').classList.remove('hidden');
  return new Promise((resolve) => (modalResolve = resolve));
}

function confirmModal(title, text, ok) {
  const p = openModal(`<div class="modal-head"><h3>${esc(title)}</h3></div><div class="modal-body"><p>${esc(text)}</p></div>
    <div class="modal-foot"><button class="btn btn-ghost" data-m="no">Отмена</button><button class="btn btn-primary" data-m="yes">${esc(ok)}</button></div>`);
  $('[data-m="no"]').onclick = () => closeModal(false);
  $('[data-m="yes"]').onclick = () => closeModal(true);
  return p;
}

function promptModal(title, text, placeholder, ok) {
  const p = openModal(`<div class="modal-head"><h3>${esc(title)}</h3></div><div class="modal-body"><p>${esc(text)}</p>
    <input class="input" id="modal-input" placeholder="${esc(placeholder)}" spellcheck="false" /></div>
    <div class="modal-foot"><button class="btn btn-ghost" data-m="no">Отмена</button><button class="btn btn-primary" data-m="yes">${esc(ok)}</button></div>`);
  const input = $('#modal-input');
  input.focus();
  const submit = () => closeModal(input.value.trim());
  input.addEventListener('keydown', (e) => e.key === 'Enter' && submit());
  $('[data-m="no"]').onclick = () => closeModal(null);
  $('[data-m="yes"]').onclick = submit;
  return p;
}

// Настройки аддона по handleEvents.json (формат PulseSync и Next Music).
async function openAddonSettings(a) {
  let data;
  try {
    data = await invoke('addon_settings', { id: a.id });
  } catch (err) {
    return fail(err);
  }
  const values = data.values || {};
  const val = (id) => (values[id] ? values[id].value : undefined);
  const parts = [];
  for (const section of data.schema.sections || []) {
    const rows = [];
    for (const it of section.items || []) {
      const items = it.type === 'text' && Array.isArray(it.buttons) ? it.buttons.map((b) => ({ ...b, type: 'text' })) : [it];
      for (const item of items) if (item && item.id) rows.push(settingRow(item, val(item.id)));
    }
    if (rows.length) parts.push(`${section.title ? `<div class="modal-section">${esc(section.title)}</div>` : ''}<div class="card">${rows.join('')}</div>`);
  }
  openModal(`<div class="modal-head"><h3>${esc(a.name)}</h3><button class="btn btn-ghost icon-btn" data-m="close" aria-label="Закрыть">✕</button></div>
    <div class="modal-body" id="addon-settings">${parts.join('')}</div>
    <div class="modal-foot"><button class="btn btn-ghost" data-m="reset">Сбросить</button><span class="spacer"></span><button class="btn btn-primary" data-m="close">Готово</button></div>`);
  $$('[data-m="close"]').forEach((b) => (b.onclick = () => closeModal()));
  $('[data-m="reset"]').onclick = async () => {
    await invoke('reset_addon_settings', { id: a.id }).catch(fail);
    closeModal();
    openAddonSettings(a);
  };
  const box = $('#addon-settings');
  const timers = {};
  const save = (key, value, delay = 0) => {
    clearTimeout(timers[key]);
    timers[key] = setTimeout(() => invoke('set_addon_setting', { id: a.id, key, value }).catch(fail), delay);
  };
  box.addEventListener('input', (e) => {
    const t = e.target;
    const key = t.dataset.setting;
    if (!key) return;
    if (t.type === 'checkbox') return save(key, t.checked);
    if (t.type === 'range') {
      $(`[data-range-of="${CSS.escape(key)}"]`, box).textContent = t.value;
      return save(key, Number(t.value), 120);
    }
    if (t.tagName === 'SELECT') return save(key, t.dataset.numeric && /^-?\d+$/.test(t.value) ? Number(t.value) : t.value);
    save(key, t.value, t.type === 'color' ? 120 : 400);
  });
}

function settingRow(it, value) {
  const id = esc(it.id);
  const title = `<div class="row-text"><div class="row-title">${esc(it.name || it.text || it.id)}</div>${it.description ? `<div class="row-desc">${esc(it.description)}</div>` : ''}</div>`;
  const v = value ?? it.value ?? it.input ?? it.defaultValue ?? it.defaultParameter;
  switch (it.type) {
    case 'button':
      return `<label class="row">${title}<input type="checkbox" class="switch" data-setting="${id}" ${v ? 'checked' : ''} /></label>`;
    case 'slider':
      return `<div class="row">${title}<div class="row-controls"><input type="range" min="${Number(it.min ?? 0)}" max="${Number(it.max ?? 100)}" step="${Number(it.step ?? 1)}" value="${Number(v ?? 0)}" data-setting="${id}" /><span class="range-value" data-range-of="${id}">${esc(v)}</span></div></div>`;
    case 'selector': {
      const numeric = typeof (it.defaultValue ?? it.value) === 'number';
      const opts = Object.entries(it.options || {})
        .map(([k, o]) => `<option value="${esc(k)}" ${String(v) === k ? 'selected' : ''}>${esc((o && o.name) || k)}</option>`)
        .join('');
      return `<div class="row">${title}<select class="input" data-setting="${id}" ${numeric ? 'data-numeric="1"' : ''}>${opts}</select></div>`;
    }
    case 'color':
      return `<div class="row">${title}<input type="color" data-setting="${id}" value="${esc(/^#[0-9a-f]{6}$/i.test(v) ? v : '#ffffff')}" /></div>`;
    default:
      return `<div class="row">${title}<input type="text" class="input" data-setting="${id}" value="${esc(v ?? '')}" spellcheck="false" /></div>`;
  }
}

// ---------------------------------------------------------------------------
// Редактор
// ---------------------------------------------------------------------------

async function openEditor(a) {
  try {
    const f = await invoke('read_addon_file', { id: a.id });
    state.editing = a;
    $('#editor-title').textContent = a.name;
    $('#editor-path').textContent = `${a.id}/${f.file}`;
    $('#editor').value = f.content;
    $('#editor-view').classList.remove('hidden');
    closeDrawer();
    $('#editor').focus();
    updatePos();
  } catch (err) {
    fail(err);
  }
}
async function saveEditor() {
  if (!state.editing) return;
  try {
    afterChange(await invoke('write_addon_file', { id: state.editing.id, content: $('#editor').value }));
    toast('Сохранено');
  } catch (err) {
    fail(err);
  }
}
$('#editor-save').addEventListener('click', saveEditor);
$('#editor-cancel').addEventListener('click', () => {
  $('#editor-view').classList.add('hidden');
  state.editing = null;
  loadInstalled();
});
const editor = $('#editor');
editor.addEventListener('keydown', (e) => {
  if (e.key === 's' && e.ctrlKey) {
    e.preventDefault();
    saveEditor();
  } else if (e.key === 'Tab') {
    e.preventDefault();
    editor.setRangeText('  ', editor.selectionStart, editor.selectionEnd, 'end');
  }
});
function updatePos() {
  const before = editor.value.slice(0, editor.selectionStart).split('\n');
  $('#editor-pos').textContent = `Стр ${before.length}, стлб ${before[before.length - 1].length + 1}`;
}
editor.addEventListener('keyup', updatePos);
editor.addEventListener('click', updatePos);

// ---------------------------------------------------------------------------
// Настройки
// ---------------------------------------------------------------------------

const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
const setPath = (obj, path, value) => {
  const keys = path.split('.');
  const last = keys.pop();
  keys.reduce((o, k) => (o[k] ??= {}), obj)[last] = value;
};

function fillSettings() {
  const s = state.settings;
  for (const input of $$('[data-key]', $('#settings-form'))) {
    const v = getPath(s, input.dataset.key);
    if (input.type === 'checkbox') input.checked = !!v;
    else if (input.tagName === 'SELECT' && input.dataset.type === 'number') {
      const opt = [...input.options].find((o) => Math.abs(Number(o.value) - Number(v)) < 0.001);
      input.value = opt ? opt.value : '1';
    } else input.value = v ?? '';
  }
  syncDeps();
}

function syncDeps() {
  const s = state.settings;
  for (const row of $$('[data-dep]')) row.classList.toggle('disabled', !getPath(s, row.dataset.dep));
  for (const row of $$('[data-custom]')) row.classList.toggle('hidden', !getPath(s, 'discord.enabled') || getPath(s, row.dataset.custom + '.target') !== 'custom');
  for (const span of $$('[data-value-of]')) span.textContent = `${getPath(s, span.dataset.valueOf)} px`;
}

let saveTimer = 0;
function saveSettings(delay) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await invoke('set_settings', { settings: state.settings });
    } catch (err) {
      fail(err);
      state.settings = await invoke('get_settings');
      fillSettings();
    }
  }, delay);
}

$('#settings-form').addEventListener('input', (e) => {
  const t = e.target;
  const key = t.dataset.key;
  if (!key || !state.settings) return;
  let value = t.value;
  if (t.type === 'checkbox') value = t.checked;
  else if (t.type === 'range' || t.dataset.type === 'number') value = Number(t.value);
  setPath(state.settings, key, value);
  syncDeps();
  saveSettings(t.type === 'text' || t.type === 'url' ? 500 : t.type === 'range' ? 150 : 0);
  if (key === 'routeThroughTune') toast('Применится после перезапуска Tune');
});

async function loadSettings() {
  state.settings = await invoke('get_settings');
  fillSettings();
  const info = await invoke('app_info');
  $('#about-version').textContent = `Tune Music ${info.version}`;
  $('#about-client').textContent = 'Клиент Яндекс Музыки с темами и плагинами';
  $('#about-data').textContent = info.dataDir;
}

// ---------------------------------------------------------------------------

loadInstalled().catch(fail);
loadSettings().catch(fail);
invoke('reload_status').then(setReload).catch(() => {});
