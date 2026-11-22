// 3D 牆的 AI 逐顆檢查：要發佈的每一顆岩點都由 AI 判斷，跟人在 Studio 逐顆修是同一個標準（2D 的 AI 檢查同一套：保留、刪掉、重描）。
// AI 自己判斷到底，不把看不準的交給人；人只在發佈時確認，唯一例外是照片明顯不夠、要補拍（retake，合併成一題問人）。
// 紀錄在工作資料夾的 review3d.json：{ format: 'climbio-3d-review/1', holds: { 岩點 id: { v, by, at, sig, re?, note? } } }
//   v：keep 是岩點、範圍對；off 不是岩點（wall.json 的 holds[].off）；reshape AI 重描了範圍（記成修點，跟人修的同一種，要再看一次）；
//   retake 這一區照片不夠、看不清（note 寫哪裡不夠）
//   sig：判斷當時這顆的狀態（off、修點）；之後又改了就要重看。re：AI 重描過幾次
// ClimbioWall3dReview.status(wall.json, review3d.json) → { total, looked, need, retake, off, reshaped }
(function (root) {
  'use strict';
  const FORMAT = 'climbio-3d-review/1';
  const empty = () => ({ format: FORMAT, holds: {} });

  /** 這顆現在的狀態：off、修點；跟判斷當時的一樣才算看過 */
  function sig(doc, id) {
    const h = doc.holds.find(x => x.id === id), e = (doc.edits || []).find(x => x.id === id);
    return JSON.stringify([h && h.off ? 1 : 0, e ? e.m3 : null]);
  }
  /** 要發佈的岩點：沒標成不是岩點的，加上補畫的（修點的 id 不在原本岩點裡） */
  function exported(doc) {
    const base = new Set(doc.holds.map(h => h.id));
    return [...doc.holds.filter(h => !h.off).map(h => h.id), ...(doc.edits || []).map(e => e.id).filter(id => !base.has(id))];
  }

  function status(doc, review) {
    const R = (review && review.holds) || {}, ids = exported(doc), need = [], retake = [];
    for (const id of ids) {
      const r = R[id];
      if (!r || r.sig !== sig(doc, id) || r.v === 'reshape') need.push(id);   // 沒看過、看過之後又改了、重描完還沒確認
      else if (r.v === 'retake') retake.push(id);
    }
    const off = doc.holds.filter(h => h.off && R[h.id] && R[h.id].v === 'off').length;
    const reshaped = ids.filter(id => R[id] && R[id].re).length;
    return { total: ids.length, looked: ids.length - need.length, need, retake, off, reshaped };
  }

  const api = { FORMAT, empty, sig, exported, status };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ClimbioWall3dReview = api;
})(globalThis);
