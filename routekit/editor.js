// RouteKit editor：定線的規則——點岩點加進路線、改類型、拿掉，出手順序。只改路線資料，不碰畫面。
// 瀏覽器用 <script> 依序載入，掛在全域 RouteKit；Node 用 require。不依賴任何 App 的狀態，資料都從參數傳入。
// English: RouteKit editor: route-setting rules (tap to add / change / remove holds, move order).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else Object.assign(root.RouteKit || (root.RouteKit = {}), factory());
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MAX_START = 2;   // 起攀最多 2 個
  const startCount = (r) => Object.values(r.holds).filter(x => x === 's').length;
  // 點一顆岩點，type＝目前選的類型（s 起攀、h 手點、f 腳點、t 完攀）：
  // 不在路線上就加進來；類型不同就改成 type；類型一樣就拿掉（出手順序裡的也拿掉）。
  // 起攀滿了（maxStart）：新的點改成手點；已在路線上的不動，回傳 'full'。
  // justAdded：這顆剛被加進來（快速點兩下）：不算拿掉，回傳 'ignored'。
  // 起攀上限 maxStart 預設 2（岩點貓），有的岩館規定 4。
  // 回傳 'added'、'changed'、'removed'、'full'、'ignored'
  function tapHold(r, id, type, { maxStart = MAX_START, justAdded = false } = {}) {
    const cur = r.holds[id];
    if (type === 's' && cur !== 's' && startCount(r) >= maxStart) {
      if (cur) return 'full';
      type = 'h';
    }
    if (cur === type) {
      if (justAdded) return 'ignored';
      delete r.holds[id]; dropSeq(r, id);
      return 'removed';
    }
    r.holds[id] = type;
    return cur ? 'changed' : 'added';
  }
  // 出手順序（選用）：r.seq＝依序出手的岩點 id，同一顆可以出現好幾次（例如換手）。
  // 追加一手：不在路線上的岩點先當手點加進來；回傳有沒有加進來（popSeq 收回時要用）
  function appendSeq(r, id) {
    return insertSeq(r, id, r.seq ? r.seq.length : 0);
  }
  // 插在出手順序的 at 位置（0 起算：0 插在最前、等於長度就是最後），後面的手順自動順延；回傳同 appendSeq
  function insertSeq(r, id, at) {
    const added = !r.holds[id];
    if (added) r.holds[id] = 'h';
    const seq = r.seq || (r.seq = []);
    seq.splice(Math.max(0, Math.min(at, seq.length)), 0, id);
    return added;
  }
  // 收回 at 位置的那一手（預設最後一手）；added：那一手是 appendSeq／insertSeq 順便加進來的岩點，一起拿掉
  function popSeq(r, added, at = r.seq.length - 1) {
    const [id] = r.seq.splice(at, 1);
    if (!r.seq.length) delete r.seq;
    if (added && r.holds[id] === 'h') delete r.holds[id];
  }
  // 拿掉路線上所有腳點（也移出 seq）；回傳拿掉幾顆
  function clearFeet(r) {
    const ids = Object.keys(r.holds).filter(id => r.holds[id] === 'f');
    for (const id of ids) { delete r.holds[id]; dropSeq(r, id); }
    return ids.length;
  }
  // 不限腳（r.feetFree）：這條路線的腳點不指定；切換後回傳現在是不是不限腳
  function toggleFeetFree(r) {
    if (r.feetFree) delete r.feetFree; else r.feetFree = true;
    return !!r.feetFree;
  }
  // 岩點從路線拿掉時，出手順序裡的也拿掉
  function dropSeq(r, id) {
    if (!r.seq) return;
    r.seq = r.seq.filter(x => x !== id);
    if (!r.seq.length) delete r.seq;
  }
  // 點完之後下一個要用的類型：起攀滿了（maxStart）就切到手點（岩點貓：第 2 個起攀加進去後自動切到手點）；其他不變
  function nextType(r, type, maxStart = MAX_START) { return type === 's' && startCount(r) >= maxStart ? 'h' : type; }
  // 熱圖：這面牆的其他路線（不含正在定的 current）各用了每顆岩點幾次。回傳 { use: Map(id → 次數), max }，max 至少當 3 次算
  function holdUse(routes, current) {
    const use = new Map();
    for (const x of routes) if (x !== current && (!current || x.id !== current.id)) for (const id of Object.keys(x.holds)) use.set(id, (use.get(id) || 0) + 1);
    return { use, max: Math.max(3, ...use.values()) };
  }
  // 0＝沒用過（白框），用過的 1 次起跳、最多那顆（至少當 3 次算）是 1
  function heatLevel(heat, id) { const n = heat.use.get(id) || 0; return n && (0.25 + 0.75 * (n - 1) / (heat.max - 1)); }

  // 出手順序的編輯工作階段（岩點貓和內嵌頁共用）：每次點選追加一手；長按有編號的岩點可以「在它之後插入」或「刪掉某一手」；
  // 復原一路收回（每一手的來源記著）；離開順序模式、換路線就作廢。路線資料自己傳進來，這裡只管規則和游標（insertAt）
  function orderSession() {
    let hist = { r: null, list: [] }, ins = null;   // ins：{ r, at } 插入游標（一顆顆插在 at、at+1…）
    const log = (r, e) => { if (hist.r !== r) hist = { r, list: [] }; hist.list.push(e); };
    const cursor = (r) => (ins && ins.r === r ? ins : null);
    return {
      reset() { hist = { r: null, list: [] }; ins = null; },
      insertAt(r) { const i = cursor(r); return i ? Math.min(i.at, r.seq ? r.seq.length : 0) : null; },   // null＝接在最後
      canUndo(r) { return !!r && hist.r === r && hist.list.length > 0; },
      // 點選：追加一手（有插入游標就插在游標，之後游標往後一格）；回傳這一手是第幾手（1 起算）
      tap(r, id) {
        const i = cursor(r), len = r.seq ? r.seq.length : 0, at = i ? Math.min(i.at, len) : len;
        const added = insertSeq(r, id, at);
        log(r, { op: 'add', at, added, ins: !!i });
        if (i) i.at = at + 1;
        return at + 1;
      },
      // 收回最近一步（點選或刪除都能收回）；回傳有沒有收回
      undo(r) {
        const e = r && hist.r === r ? hist.list.pop() : null; if (!e) return false;
        const i = cursor(r);
        if (e.op === 'del') { insertSeq(r, e.id, e.at); if (i && i.at > e.at) i.at++; }
        else if (r.seq && e.at < r.seq.length) { popSeq(r, e.added, e.at); if (e.ins && i) i.at = e.at; }
        return true;
      },
      // 這顆岩點在順序裡的第幾手（1 起算，可能好幾手）
      numbers(r, id) { return r && r.seq ? r.seq.flatMap((x, k) => (x === id ? [k + 1] : [])) : []; },
      // 選在第 n 手之後插入（n＝0：插在最前面）
      startInsert(r, n) { ins = { r, at: n }; },
      endInsert() { ins = null; },
      // 刪掉第 n 手（1 起算）；手點沒有編號了就一起拿掉，起攀、完攀、腳點留著
      remove(r, n) {
        const at = n - 1, id = r.seq[at], i = cursor(r);
        popSeq(r, false, at);
        if (!(r.seq || []).includes(id) && r.holds[id] === 'h') delete r.holds[id];
        log(r, { op: 'del', at, id });
        if (i && i.at > at) i.at--;
      },
      // 清掉整條路線的順序
      clear(r) { delete r.seq; ins = null; hist = { r: null, list: [] }; },
    };
  }
  return { MAX_START, startCount, nextType, holdUse, heatLevel, orderSession, tapHold, appendSeq, insertSeq, popSeq, dropSeq, clearFeet, toggleFeetFree };
});
