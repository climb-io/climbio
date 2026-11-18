// 舊名 spraywall 搬到 climbio：手機裡用舊名存的設定和快取，打開頁面時（在其他程式之前，同步載入）換到新名稱。
//   localStorage、sessionStorage 的 spraywall.* → climbio.*（新名稱已經有值就留新的），舊的刪掉。
//   岩點貓的模型快取 spraywall-models-hk… → hold-models-hk…（照原樣搬，不用重新下載）；其他 spraywall-… 快取（舊版本的頁面）、
//   重描用的照片特徵 spraywall-sam 刪掉，用到會重算。牆（IndexedDB spraywall-db）在 js/app.js 第一次打開資料庫時搬。
// English: One-time move of on-device data from the old spraywall.* names to climbio.* (storage keys, model cache); runs before any app script.
(function () {
  'use strict';
  const OLD = 'spraywall.', NEW = 'climbio.';
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      const s = self[name];
      for (const k of Object.keys(s)) {
        if (!k.startsWith(OLD)) continue;
        const to = NEW + k.slice(OLD.length);
        if (s.getItem(to) === null) s.setItem(to, s.getItem(k));
        s.removeItem(k);
      }
    } catch (e) { /* 不能用（隱私模式等）：沒有東西可搬 */ }
  }
  if (self.caches) {
    caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('spraywall-')).map(async k => {
      if (k.startsWith('spraywall-models')) {
        const from = await caches.open(k), to = await caches.open('hold-models' + k.slice('spraywall-models'.length));
        for (const req of await from.keys()) { const res = await from.match(req); if (res) await to.put(req, res); }
      }
      await caches.delete(k);
    }))).catch(e => console.warn('舊的快取沒搬完，下次再搬', e));
  }
  try { indexedDB.deleteDatabase('spraywall-sam'); } catch (e) { /* 沒有 IndexedDB */ }
})();
