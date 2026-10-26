// Совместимость с аддонами PulseSync и Next Music.
// Те же объекты, что дают эти моды: window.pulsesyncApi и window.nextmusicApi.
// Реализация своя — поверх плеера Яндекса, который находит runtime.js (window.__tune.ym).
(() => {
  const T = window.__tune;
  if (!T || window.pulsesyncApi) return;
  const { ym, player } = T;

  const clone = (v) => {
    try {
      return structuredClone(v);
    } catch (e) {
      return JSON.parse(JSON.stringify(v || {}));
    }
  };

  // Плеер появляется не сразу — вызовы до этого копятся.
  const pending = [];
  const waitForPlayer = (fn) => {
    const p = ym.player();
    if (p) {
      try {
        fn(p);
      } catch (e) {
        console.error('[tune] pulsesyncApi', e);
      }
    } else pending.push(fn);
  };
  const flushPending = () => {
    const p = ym.player();
    if (!p || !pending.length) return;
    while (pending.length) {
      const fn = pending.shift();
      try {
        fn(p);
      } catch (e) {
        console.error('[tune] pulsesyncApi', e);
      }
    }
  };

  // Наблюдение за observable-полями плеера ({ value, onChange }).
  const observe = (pick, cb) => {
    let stop = null;
    let cancelled = false;
    const attach = () => {
      if (cancelled) return;
      const p = ym.player();
      const obs = p && pick(p.state || p.playbackState);
      if (obs && typeof obs.onChange === 'function') {
        stop = obs.onChange((v) => {
          try {
            cb(v === undefined ? obs.value : v);
          } catch (e) {
            console.error('[tune] подписка аддона', e);
          }
        });
      } else setTimeout(attach, 500);
    };
    attach();
    return () => {
      cancelled = true;
      if (typeof stop === 'function') stop();
    };
  };

  // --- настройки аддонов -----------------------------------------------------
  const settingsFor = (name) => {
    const key = String(name || '').trim();
    return {
      getCurrent: () => clone(T.addonSettings(key) || {}),
      onChange(cb) {
        if (typeof cb !== 'function') return () => {};
        const off = T.onAddonSettings((names, values) => {
          if (names.includes(key)) cb(clone(values));
        });
        const now = T.addonSettings(key);
        if (now) setTimeout(() => cb(clone(now)), 0);
        return off;
      },
    };
  };

  // --- трек -------------------------------------------------------------------
  const queueEntities = () => {
    const s = ym.state();
    return (s && s.queueState && s.queueState.entityList && s.queueState.entityList.value) || [];
  };
  const withAlbum = (id, albumId) => (albumId ? `${id}:${albumId}` : String(id));

  const playTrackById = (id, opts = {}) =>
    waitForPlayer((p) => {
      const full = withAlbum(id, opts.albumId);
      const list = queueEntities();
      const idx = list.findIndex((e) => {
        const m = e && (e.entity || e).entityData && (e.entity || e).entityData.meta;
        return m && (m.id === full || String(m.id).split(':')[0] === String(id));
      });
      if (idx >= 0 && typeof p.setEntityByIndex === 'function') return p.setEntityByIndex(idx);
      if (typeof p.playContext === 'function') {
        p.playContext({
          contextData: { type: 'various', meta: { id: full }, from: opts.from || 'tune' },
          queueParams: { entityId: full },
          loadContextMeta: true,
          entitiesData: [{ type: 'unloaded', meta: { id: full } }],
        });
      }
    });

  const likeStore = () => {
    const e = ym.entity();
    return e && e.likeStore;
  };
  const tryMethods = (obj, names, ...args) => {
    for (const n of names) {
      if (obj && typeof obj[n] === 'function') {
        try {
          return obj[n](...args);
        } catch (e) {}
      }
    }
    return false;
  };

  // ===========================================================================
  // window.pulsesyncApi
  // ===========================================================================
  const ps = {
    get playerInstance() {
      return ym.player();
    },
    _waitForPlayer: waitForPlayer,
    play: () => player.play(),
    pause: () => player.pause(),
    togglePlayPause: () => player.toggle(),
    next: () => player.next(),
    previous: () => player.prev(),
    setRepeatMode: (m) => waitForPlayer((p) => p.setRepeatMode && p.setRepeatMode(m)),
    toggleShuffle: () => waitForPlayer((p) => p.toggleShuffle && p.toggleShuffle()),
    setVolume: (v) => player.volume(v > 1 ? v / 100 : v),
    setProgress: (sec) => player.seek(sec),
    playTrackById,
    playPlaylistById: (id, opts = {}) =>
      waitForPlayer((p) => p.playContext && p.playContext({ contextData: { type: 'playlist', meta: opts.uuid ? { id, uuid: opts.uuid } : { id }, from: opts.from || 'tune' }, loadContextMeta: true })),
    addTrackToQueueById: (id, opts = {}) =>
      waitForPlayer((p) => {
        const entitiesData = [{ type: 'unloaded', meta: { id: withAlbum(id, opts.albumId) } }];
        if (opts.position === 'next' && typeof p.injectNext === 'function') p.injectNext({ entitiesData });
        else if (typeof p.injectLast === 'function') p.injectLast({ entitiesData });
      }),
    likeTrack: (id, o = {}) => tryMethods(likeStore(), ['likeTrack', 'setTrackLiked', 'addTrackLike', 'toggleTrackLike'], id ? withAlbum(id, o.albumId) : ym.meta() && ym.meta().id),
    unlikeTrack: (id, o = {}) => tryMethods(likeStore(), ['unlikeTrack', 'removeTrackLike', 'setTrackUnliked'], id ? withAlbum(id, o.albumId) : ym.meta() && ym.meta().id),
    dislikeTrack: (id, o = {}) => tryMethods(likeStore(), ['dislikeTrack', 'setTrackDisliked', 'addTrackDislike', 'toggleTrackDislike'], id ? withAlbum(id, o.albumId) : ym.meta() && ym.meta().id),
    undislikeTrack: (id, o = {}) => tryMethods(likeStore(), ['undislikeTrack', 'removeTrackDislike', 'setTrackUndisliked'], id ? withAlbum(id, o.albumId) : ym.meta() && ym.meta().id),
    isTrackLiked: (id, albumId) => {
      const s = likeStore();
      const key = id ? withAlbum(id, albumId) : ym.meta() && ym.meta().id;
      return !!(key && s && s.isTrackLiked && s.isTrackLiked(key));
    },
    isTrackDisliked: (id, albumId) => {
      const s = likeStore();
      const key = id ? withAlbum(id, albumId) : ym.meta() && ym.meta().id;
      return !!(key && s && s.isTrackDisliked && s.isTrackDisliked(key));
    },
    getState: () => ym.state(),
    isPlaying: () => player.isPlaying(),
    getCurrentTrack: () => ym.meta(),
    getQueue: () => queueEntities(),
    getProgress: () => ym.progress(),
    getDuration: () => {
      const m = ym.meta();
      return m ? m.duration || (m.durationMs ? m.durationMs / 1000 : undefined) : undefined;
    },
    getVolume: () => player.volume(),
    getRepeatMode: () => {
      const s = ym.state();
      return s && s.queueState && s.queueState.repeat && s.queueState.repeat.value;
    },
    isShuffle: () => {
      const s = ym.state();
      return s && s.queueState && s.queueState.shuffle && s.queueState.shuffle.value;
    },
    getSettings: settingsFor,
    setPlayerInstance: () => {},
  };

  // ===========================================================================
  // window.nextmusicApi
  // ===========================================================================
  const nmTrack = () => {
    const m = ym.meta();
    if (!m) return null;
    const artists = (m.artists || []).map((a) => ({ id: a.id, name: a.name }));
    const album = (m.albums || [])[0];
    return {
      id: m.id,
      realId: m.realId,
      title: m.title,
      version: m.version || null,
      artists,
      artistIds: artists.map((a) => a.id),
      artistNames: artists.map((a) => a.name),
      albumId: album ? album.id : null,
      albumTitle: album ? album.title : null,
      year: album ? album.year || null : null,
      coverUrl: ym.cover(m) || null,
      trackUrl: `https://music.yandex.ru/track/${String(m.id).split(':')[0]}`,
      durationMs: m.durationMs || null,
      contentWarning: m.contentWarning || null,
      r128: m.r128 || null,
    };
  };
  const nmState = () => {
    const p = ym.player();
    const s = ym.state();
    if (!p || !s) return null;
    const ps_ = s.playerState || {};
    const qs = s.queueState || {};
    return {
      playerId: p.id,
      status: ps_.status && ps_.status.value,
      progress: ps_.progress && ps_.progress.value,
      volume: ps_.volume && ps_.volume.value,
      shuffle: qs.shuffle && qs.shuffle.value,
      repeat: qs.repeat && qs.repeat.value,
    };
  };
  const audioEl = () => {
    const m = player.media();
    if (m) return m;
    const list = [...document.querySelectorAll('audio, video')];
    return list.find((a) => !a.paused) || list[0] || null;
  };
  const styleTags = new Map();
  const containerIds = { INFO: 'INFO', ERROR: 'ERROR', IMPORTANT: 'IMPORTANT', FULLSCREEN_INFO: 'FULLSCREEN_INFO', FULLSCREEN_ERROR: 'FULLSCREEN_ERROR', AD_INFO: 'AD_INFO' };

  const playerHandle = (id) => {
    const get = () => {
      const c = ym.controller();
      return c ? c.playbacks.get(id) : null;
    };
    const run = (m, ...a) => {
      const p = get();
      if (p && typeof p[m] === 'function') p[m](...a);
    };
    return {
      id,
      exists: () => !!get(),
      getState: () => {
        const p = get();
        const s = p && (p.state || p.playbackState);
        return s ? { playerId: id, status: s.playerState.status.value, progress: s.playerState.progress.value, volume: s.playerState.volume.value } : null;
      },
      setProgress: (v) => run('setProgress', v),
      setVolume: (v) => run('setExponentVolume', v),
      setSpeed: (v) => run('setSpeed', v),
      play: () => run('resume'),
      pause: () => run('pause'),
      resume: () => run('resume'),
      togglePause: () => run('togglePause'),
      next: () => run('moveForward'),
      prev: () => run('moveBackward'),
    };
  };

  const nm = {
    ContainerId: containerIds,
    getSettings: settingsFor,
    waitForApi(cb) {
      setTimeout(cb, 0);
      return () => {};
    },
    wsReconnect(url, o = {}) {
      let ws = null;
      let closed = false;
      let timer = 0;
      const open = () => {
        if (closed) return;
        ws = new WebSocket(url);
        ws.onopen = (e) => o.onOpen && o.onOpen(e, ws);
        ws.onmessage = (e) => o.onMessage && o.onMessage(e, ws);
        ws.onerror = (e) => o.onError && o.onError(e, ws);
        ws.onclose = (e) => {
          o.onClose && o.onClose(e, ws);
          if (!closed) timer = setTimeout(open, o.reconnectDelay || 3000);
        };
      };
      open();
      return {
        close() {
          closed = true;
          clearTimeout(timer);
          ws && ws.close();
        },
        send: (d) => ws && ws.readyState === 1 && ws.send(d),
      };
    },
    injectStyleTag(id, css) {
      let el = styleTags.get(id);
      if (!el) {
        el = document.createElement('style');
        el.dataset.tuneStyle = id;
        styleTags.set(id, el);
      }
      el.textContent = css;
      if (!el.isConnected) (document.body || document.head).appendChild(el);
      return el;
    },
    removeStyleTag(id) {
      const el = styleTags.get(id);
      if (el) el.remove();
      styleTags.delete(id);
    },
    showToast: (message, _c, _e, cover) => T.toast(message, { cover }),
    showCopyToast: (title) => T.toast(`Ссылка на «${title}» скопирована`),
    showErrorToast: (text) => T.toast(text, { error: true }),
    dismissToast: () => {},
    getCurrentYandexMusicVersion: () => (window.__TUNE_CLIENT__ && window.__TUNE_CLIENT__.version) || null,
    getCurrentMp3Url: () => {
      const a = audioEl();
      return a ? a.currentSrc || a.src || null : null;
    },
    getCurrentTrackKey: () => '',
    getCurrentTrackCodec: () => '',
    nextText(text) {
      // В Next Music это подпись в его заголовке окна; у Tune её нет — кладём в title.
      const el = document.querySelector('.TitleBar_nextText');
      if (el) el.textContent = text;
    },
    playTrackById: (id) => playTrackById(id),
    getCurrentTrack: nmTrack,
    getState: nmState,
    getCurrentAverageColor: () => {
      const m = ym.meta();
      return (m && m.derivedColors && (m.derivedColors.average || m.derivedColors.accent)) || null;
    },
    getQueueSnapshot: () => queueEntities().map((e) => {
      const m = (e.entity || e).entityData && (e.entity || e).entityData.meta;
      return m ? { id: m.id, title: m.title } : null;
    }),
    onQueueChange: (cb) => observe((s) => s && s.queueState && s.queueState.entityList, cb),
    getPlayers: () => {
      const c = ym.controller();
      return c ? [...c.playbacks.keys()].map((id) => playerHandle(id).getState()).filter(Boolean) : [];
    },
    getActivePlayerId: () => {
      const c = ym.controller();
      const a = c && c.activePlayback && c.activePlayback.value;
      return a ? a.id : null;
    },
    pauseAll: () => {
      const c = ym.controller();
      if (c) for (const id of c.playbacks.keys()) playerHandle(id).pause();
    },
    player: playerHandle,
    onStatusChange: (cb) => observe((s) => s && s.playerState && s.playerState.status, cb),
    onProgressChange: (cb) => observe((s) => s && s.playerState && s.playerState.progress, cb),
    onTrackChange: (cb) => {
      let last;
      return observe(
        (s) => s && s.queueState && s.queueState.currentEntity,
        () => {
          const t = nmTrack();
          const id = t ? t.id : null;
          if (id !== last) {
            last = id;
            cb(t);
          }
        }
      );
    },
    onActivePlayerChange: (cb) => {
      let stop = null;
      const attach = () => {
        const c = ym.controller();
        if (c && c.activePlayback && c.activePlayback.onChange) stop = c.activePlayback.onChange((p) => cb(p ? p.id : null));
        else setTimeout(attach, 500);
      };
      attach();
      return () => stop && stop();
    },
    getActiveAudioElement: audioEl,
    getAudioTime: () => {
      const a = audioEl();
      return a ? a.currentTime : null;
    },
    onAudioEvent(cb) {
      const types = ['play', 'pause', 'timeupdate', 'ended', 'seeked', 'loadedmetadata', 'volumechange', 'ratechange'];
      const handler = (e) => {
        if (e.target instanceof HTMLMediaElement) cb(e, e.target);
      };
      types.forEach((t) => document.addEventListener(t, handler, true));
      return () => types.forEach((t) => document.removeEventListener(t, handler, true));
    },
    setSpeed: (v) => player.speed(v),
    setProgress: (v) => player.seek(v),
    setVolume: (v) => player.volume(v),
    play: () => player.play(),
    pause: () => player.pause(),
    resume: () => player.play(),
    togglePause: () => player.toggle(),
    next: () => player.next(),
    prev: () => player.prev(),
    getSiteComponents: () => ({ components: { React: window.React }, missing: [] }),
    getSiteContexts: () => [],
    wrapWithSiteContexts: (el) => el,
    getComponentFromElement: () => null,
    renderInSiteContext: () => null,
    mountUgcShareButton: () => {},
    unmountUgcShareButton: () => {},
    mountDownloadButton: () => {},
    unmountDownloadButton: () => {},
    updateDownloadButtonState: () => {},
    mountListenAlongPanel: () => {},
    unmountListenAlongPanel: () => {},
    updateListenAlongPanel: () => {},
    encodeTrackKey: () => '',
    decodeTrackKey: () => null,
    downloadAsset: () => Promise.reject(new Error('downloadAsset не поддерживается в Tune')),
    playCustomTrack: () => {},
    playUgcTrack: () => {},
    applyIncomingQueue: () => {},
    visualizer: { setAccentColor: () => {}, clearAccentColor: () => {} },
  };

  Object.defineProperty(window, 'pulsesyncApi', { value: ps, configurable: true });
  Object.defineProperty(window, 'nextmusicApi', { value: nm, configurable: true });

  setInterval(flushPending, 500);
})();
