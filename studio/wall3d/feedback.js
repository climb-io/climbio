// 3D 牆發佈前的人工試用：人在 Studio 的「試用」步驟看過這一版，有問題點那裡寫一句回報；代理修完記下怎麼處理，人再試用，沒問題才問要不要發佈。
// 紀錄在工作資料夾的 feedback3d.json：
//   { format: 'climbio-3d-feedback/1', items: [{ id, at, hold?, kind?, point, camera, aspect, text, done? }], tried?: { sig, at } }
//   kind：cantPick 有點沒辦法點（量體上的小點、漏掉的岩點）、outline 外框不對（光暈溢出、缺一塊、兩顆連在一起、不是岩點）；舊紀錄可能是別的值或沒有，照 text 看
//   hold：回報的岩點 id（點在牆上沒有岩點的地方就沒有，例如漏掉的岩點）；point：點到的位置（模型座標）；camera：當時的鏡頭 [位置 xyz, 四元數 xyzw]
//   done：代理處理完 { at, by, note }；tried：人按「試用完」時這一版的指紋（內容又改了就要再試用）
// 指紋只看最終決定（不是岩點、修點、隱藏的面、裁切平面），跟發佈的 patch 同一組內容；瀏覽器和命令列算出來一樣
// ClimbioWall3dFeedback.status(wall.json, feedback3d.json) → { open, done, tried }
(function (root) {
  'use strict';
  const FORMAT = 'climbio-3d-feedback/1';
  const empty = () => ({ format: FORMAT, items: [] });

  // FNV-1a 32 位元，base36（studio/work/ledger.js 的 hash 同一個算法）
  function hash(s) {
    let h = 0x811c9dc5;
    for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(36);
  }
  /** 這一版的指紋：哪些不是岩點、修點、隱藏的面、裁切平面 */
  function sig(doc) {
    const off = doc.holds.filter(h => h.off).map(h => h.id).sort();
    const edits = (doc.edits || []).map(e => [e.id, e.m3]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const hidden = doc.surfaces.list.flatMap((x, i) => (x.hidden ? [i] : []));
    return hash(JSON.stringify([off, edits, hidden, doc.surfaces.frame.planes]));
  }
  const newId = () => 'f' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
  /** 加一筆回報（回傳新的紀錄，不改傳進來的） */
  function add(fb, item) {
    const cur = fb || empty();
    return { ...cur, items: [...cur.items, { id: newId(), at: new Date().toISOString(), ...item }] };
  }
  /** 代理處理完一筆 */
  function resolve(fb, id, by, note) {
    const it = fb.items.find(x => x.id === id);
    if (!it) throw new Error(`找不到回報 ${id}`);
    it.done = { at: new Date().toISOString(), by, note };
    return fb;
  }
  /** 人試用完這一版 */
  const markTried = (fb, doc) => ({ ...(fb || empty()), tried: { sig: sig(doc), at: new Date().toISOString() } });

  function status(doc, fb) {
    const items = (fb && fb.items) || [];
    return { open: items.filter(x => !x.done), done: items.filter(x => x.done), tried: !!(fb && fb.tried && fb.tried.sig === sig(doc)) };
  }

  const api = { FORMAT, empty, sig, add, resolve, markTried, status };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ClimbioWall3dFeedback = api;
})(globalThis);
