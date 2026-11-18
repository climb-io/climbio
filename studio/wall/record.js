// 岩點精修的研究記錄：只存「自動結果跟最後結果的差異」，不存編輯過程（拖曳、復原、平滑、旗標、花多久都不記）。
// base：自動偵測加重描的結果 { 岩點 id: { poly, flags } }；holds：最後的岩點。差異在公開時才算，編輯器不用即時記錄。
(function (root) {
  'use strict';
  const G = typeof module !== 'undefined' && module.exports ? require('./geometry.js') : root.RefineGeo;
  const SAME = 0.9;   // 重疊（IoU）不到這個值才算重描；小修不記

  function polyIou(a, b, W, H) {
    const A = G.polyMask(a, W, H, 0), B = G.polyMask(b, W, H, 0);
    const x0 = Math.min(A.ox, B.ox), y0 = Math.min(A.oy, B.oy), x1 = Math.max(A.ox + A.m.w, B.ox + B.m.w), y1 = Math.max(A.oy + A.m.h, B.oy + B.m.h);
    const ma = G.mk(x1 - x0, y1 - y0), mb = G.mk(x1 - x0, y1 - y0);
    G.fillPoly(ma, a, x0, y0); G.fillPoly(mb, b, x0, y0);
    let i = 0, u = 0;
    for (let k = 0; k < ma.d.length; k++) { i += ma.d[k] & mb.d[k]; u += ma.d[k] | mb.d[k]; }
    return u ? i / u : 0;
  }

  // 沒有 base（匯入的牆、沒做過自動偵測）回 null：沒有「自動 → 人修」可以配對
  // deleted：誤偵測（留自動的外框）；added：漏偵測（外框在 holds）；reshaped：邊界不準（留自動的外框和 iou）；
  // flagged：自動結果標了要看的岩點（校準信心用，沒改的也留）；sam：SAM2 跟原外框不同的岩點，人選了哪一個（外框、重疊、旗標、選擇）；reviewed：人逐顆看完，沒有它「沒改」不能當正確答案。
  function buildRecord({ id, sha256, license, reviewed, tools, base, holds, w, h }) {
    if (!base || !Object.keys(base).length) return null;
    const final = new Map(holds.map(x => [x.id, x]));
    const deleted = [], reshaped = [], flagged = {};
    for (const [hid, b] of Object.entries(base)) {
      if (b.flags && b.flags.length) flagged[hid] = b.flags;
      const f = final.get(hid);
      if (!f) { deleted.push({ id: hid, poly: b.poly }); continue; }
      const iou = polyIou(b.poly, f.poly, w, h);
      if (iou < SAME) reshaped.push({ id: hid, poly: b.poly, iou: Math.round(iou * 1000) / 1000 });
    }
    const added = holds.filter(x => !base[x.id]).map(x => x.id);
    const sam = {};   // SAM2 重描跟原外框不同時人的選擇：sam（採用 SAM2）、keep（保留原外框）、edited（自己修）；一致就直接採用的不記
    for (const x of holds) if (x.sam && x.sam.pick && x.sam.pick !== 'auto') sam[x.id] = { poly: x.sam.poly, iou: x.sam.iou, flags: x.sam.flags, pick: x.sam.pick };
    return { holdlab: 1, wall: id, sha256, license, reviewed: !!reviewed, tools, flagged, deleted, reshaped, added, sam };
  }

  const api = { buildRecord, polyIou, SAME };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RefineRecord = api;
})(globalThis);
