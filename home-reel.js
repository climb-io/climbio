// 八語首頁共用，點擊或左滑前進，右滑回上一幕，方向鍵也可換幕。
if (/[?&]still\b/.test(location.search)) document.documentElement.classList.add('still'); // 截圖用：關掉轉場
(() => {
  const frames = [...document.querySelectorAll('.reel-frame')];
  const reel = document.querySelector('.reel');
  if (!frames.length || !reel) return;

  const status = reel.querySelector('.reel-status');
  const stage = reel.querySelector('.reel-stage');
  const menu = reel.querySelector('.reel-menu');
  const shortcut = menu.querySelector('summary');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const aliases = {
    hold: 'hold-private', 'hold-climb': 'hold-private', 'hold-share': 'friend-exchange',
    'hold-community-set': 'hold-public', 'hold-community-view': 'hold-public',
    redpoint: 'redpoint-climb', 'redpoint-guidebook': 'redpoint-climb', 'redpoint-climb': 'redpoint-climb', 'redpoint-share': 'friend-exchange', 'hold-public': 'climbio',
  };
  let current = 0;
  let playing = !motion.matches && !location.hash && !document.documentElement.classList.contains('still');
  let timer;
  let touchStart;

  // Story controls stay independent from the persistent product navigation.
  const labels = {
    zh: ['暫停播放', '播放故事'], 'zh-cn': ['暂停播放', '播放故事'],
    en: ['Pause story', 'Play story'], ja: ['一時停止', '再生'],
    fr: ['Mettre en pause', 'Lire'], ko: ['일시 정지', '재생'],
    es: ['Pausar historia', 'Reproducir historia'], de: ['Pausieren', 'Abspielen'],
  }[document.documentElement.dataset.homeLocale?.toLowerCase()] || ['Pause story', 'Play story'];
  const playback = document.createElement('button');
  playback.type = 'button';
  playback.className = 'reel-playback';
  menu.querySelector('#apps').append(playback);

  function syncPlayback() {
    playback.textContent = playing ? labels[0] : labels[1];
    playback.setAttribute('aria-label', playing ? labels[0] : labels[1]);
    playback.title = playing ? labels[0] : labels[1];
  }

  function stop() {
    playing = false;
    clearTimeout(timer);
    syncPlayback();
  }

  function schedule() {
    clearTimeout(timer);
    if (!playing || document.hidden || menu.open) return;
    timer = setTimeout(advance, 6500);
  }

  playback.addEventListener('click', () => {
    playing = !playing;
    syncPlayback();
    schedule();
  });

  function show(index, manual = false) {
    if (index !== current && frames[current].contains(document.activeElement)) reel.focus();
    current = index;
    for (const [i, frame] of frames.entries()) {
      const active = i === current;
      frame.toggleAttribute('data-active', active);
      frame.inert = !active;
      if (active) frame.removeAttribute('aria-hidden');
      else frame.setAttribute('aria-hidden', 'true');
    }
    [frames[current], frames[(current + 1) % frames.length]].forEach(frame => {
      frame.querySelector('.reel-photo').loading = 'eager';
    });
    if (manual) {
      history.replaceState(null, '', '#' + frames[current].id);
      status.textContent = frames[current].dataset.title;
    }
    schedule();
  }

  function showHash() {
    const id = location.hash.slice(1);
    const root = document.documentElement.dataset.homeRoot || './';
    const guideDir = document.documentElement.lang === 'en' ? 'guides/' : `${root}guides/`;
    const destinations = { developer: `${guideDir}#dev-title`, 'redpoint-data': `${guideDir}#crag-data-title`, studio: `${root}studio/` };
    if (Object.hasOwn(destinations, id)) {
      location.replace(destinations[id]);
      return;
    }
    if (id === 'apps') {
      menu.open = true;
      schedule();
      return;
    }
    menu.open = false;
    const target = Object.hasOwn(aliases, id) ? aliases[id] : id;
    const index = frames.findIndex(frame => frame.id === target);
    if (index >= 0) {
      stop();
      show(index);
    }
  }

  function advance(manual = false) {
    show((current + 1) % frames.length, manual);
  }

  function previous() {
    show((current - 1 + frames.length) % frames.length, true);
  }

  menu.addEventListener('toggle', () => {
    if (!menu.open && location.hash === '#apps') {
      history.replaceState(null, '', '#' + frames[current].id);
    }
    schedule();
  });
  document.addEventListener('click', event => {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  stage.addEventListener('focusin', stop);
  stage.addEventListener('click', event => {
    if (menu.open || event.target.closest('a, button') || getSelection()?.isCollapsed === false) return;
    advance(true);
  });
  stage.addEventListener('touchstart', event => {
    touchStart = event.touches.length === 1 ? event.touches[0] : null;
  }, { passive: true });
  stage.addEventListener('touchend', event => {
    if (menu.open || !touchStart || event.touches.length) return;
    const touch = event.changedTouches[0];
    const x = touch.clientX - touchStart.clientX;
    const y = touch.clientY - touchStart.clientY;
    touchStart = null;
    if (Math.abs(x) <= 50 || Math.abs(x) <= Math.abs(y) * 1.5) return;
    if (event.cancelable) event.preventDefault();
    if (x < 0) advance(true);
    else previous();
  });
  stage.addEventListener('touchcancel', () => { touchStart = null; });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && menu.open) {
      menu.open = false;
      shortcut.focus();
      return;
    }
    if (menu.open || event.altKey || event.ctrlKey || event.metaKey || event.target.closest('a, button, summary, input, textarea, select')) return;
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    if (event.key === 'ArrowRight') advance(true);
    else previous();
  });
  document.addEventListener('visibilitychange', schedule);
  motion.addEventListener('change', event => {
    if (event.matches) {
      stop();
      schedule();
    }
  });
  window.addEventListener('hashchange', showHash);

  syncPlayback();
  show(0);
  showHash();
})();
