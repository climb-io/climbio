// 八語首頁共用，點擊或左滑前進，右滑回上一幕，方向鍵也可換幕。
(() => {
  const frames = [...document.querySelectorAll('.reel-frame')];
  const reel = document.querySelector('.reel');
  if (!frames.length || !reel) return;

  const status = reel.querySelector('.reel-status');
  const stage = reel.querySelector('.reel-stage');
  const finale = frames.at(-1);
  const apps = finale.querySelector('#apps');
  const shortcut = reel.querySelector('.reel-shortcut');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const aliases = {
    hold: 'hold-private', 'hold-climb': 'hold-private', 'hold-share': 'friend-exchange',
    'hold-community-set': 'hold-public', 'hold-community-view': 'hold-public',
    redpoint: 'redpoint-climb', 'redpoint-guidebook': 'redpoint-climb', 'redpoint-climb': 'redpoint-climb', 'redpoint-share': 'friend-exchange', 'hold-public': 'climbio',
  };
  let current = 0;
  let playing = !motion.matches && !location.hash;
  let timer;
  let touchStart;

  function showApps(visible) {
    finale.toggleAttribute('data-apps-visible', visible);
    apps.inert = !visible;
    if (shortcut) shortcut.hidden = visible;
    if (visible) apps.removeAttribute('aria-hidden');
    else apps.setAttribute('aria-hidden', 'true');
  }

  function stop() {
    playing = false;
    clearTimeout(timer);
  }

  function schedule() {
    clearTimeout(timer);
    if (document.hidden) return;
    if (frames[current] === finale) {
      if (finale.hasAttribute('data-apps-visible')) return;
      if (motion.matches) advance();
      else timer = setTimeout(advance, 2400);
    } else if (playing) {
      timer = setTimeout(advance, 5500);
    }
  }

  function show(index, manual = false) {
    if (index !== current && frames[current].contains(document.activeElement)) reel.focus();
    current = index;
    showApps(false);
    for (const [i, frame] of frames.entries()) {
      const active = i === current;
      frame.toggleAttribute('data-active', active);
      frame.inert = !active;
      if (active) frame.removeAttribute('aria-hidden');
      else frame.setAttribute('aria-hidden', 'true');
    }
    frames.slice(current, current + 2).forEach(frame => {
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
      if (frames[current] !== finale) show(frames.length - 1);
      showApps(true);
      stop();
      return;
    }
    const target = Object.hasOwn(aliases, id) ? aliases[id] : id;
    const index = frames.findIndex(frame => frame.id === target);
    if (index >= 0) {
      stop();
      show(index);
    }
  }

  function advance(manual = false) {
    if (frames[current] !== finale) {
      show(current + 1, manual);
      return;
    }
    if (finale.hasAttribute('data-apps-visible')) return;
    if (manual) history.replaceState(null, '', '#apps');
    showApps(true);
    stop();
  }

  function previous() {
    if (current > 0) show(current - 1, true);
  }

  stage.addEventListener('focusin', stop);
  stage.addEventListener('click', event => {
    if (event.target.closest('a, button') || getSelection()?.isCollapsed === false) return;
    advance(true);
  });
  stage.addEventListener('touchstart', event => {
    touchStart = event.touches.length === 1 ? event.touches[0] : null;
  }, { passive: true });
  stage.addEventListener('touchend', event => {
    if (!touchStart || event.touches.length) return;
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
    if (event.altKey || event.ctrlKey || event.metaKey) return;
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

  show(0);
  showHash();
})();
