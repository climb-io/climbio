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
    const added = !r.holds[id];
    if (added) r.holds[id] = 'h';
    (r.seq || (r.seq = [])).push(id);
    return added;
  }
  // 收回最後一手；added：那一手是 appendSeq 順便加進來的岩點，一起拿掉
  function popSeq(r, added) {
    const id = r.seq.pop();
    if (!r.seq.length) delete r.seq;
    if (added && r.holds[id] === 'h') delete r.holds[id];
  }
  // 岩點從路線拿掉時，出手順序裡的也拿掉
  function dropSeq(r, id) {
    if (!r.seq) return;
    r.seq = r.seq.filter(x => x !== id);
    if (!r.seq.length) delete r.seq;
  }
  return { MAX_START, startCount, tapHold, appendSeq, popSeq, dropSeq };
});
