// 天然岩場的報告：3D 重建流程輸出的 lab.json（Guidebook 包的 props.lab 指到它）→ 報告框架（studio/report-frame.js）的步驟卡。
// 數字都從 lab.json 讀：每區的模型（zones）、留出照片認牆的實測（evaluation）。Lab 的天然岩場頁讀包裡的 lab.json；沒有就不顯示。
// ClimbioCragLabReport.build(lab, T) → { steps, defn }；T(key, ...參數) 是介面文字（key 前綴 clr）
(function (root) {
  'use strict';
  function build(lab, T) {
    const zones = lab.zones || [], ev = lab.evaluation || {}, n = v => Number(v).toLocaleString('en-US');
    const mb = zones.reduce((s, z) => s + (z.modelBytes || 0), 0) / 1e6, faces = zones.reduce((s, z) => s + (z.faces || 0), 0);
    const steps = [{ name: T('clrModel'), where: T('clrComputer'), value: zones.length, unit: T('clrZones'), lines: [{ text: T('clrSize', mb.toFixed(1)) }, { text: T('clrFaces', n(faces)) }] }];
    if (ev.holdoutTotal) {
      const wrong = (ev.crossWallFalsePositive || 0) + (ev.negativeFalsePositive || 0);
      steps.push({ name: T('clrRecognize'), where: T('clrPhone'), value: `${Math.round(ev.holdoutCorrectWall / ev.holdoutTotal * 100)}%`, unit: T('clrCorrect'), lines: [{ text: T('clrHoldout', ev.holdoutCorrectWall, ev.holdoutTotal) }, { text: T('clrWrong', ev.crossWallFalsePositive || 0, ev.negativeFalsePositive || 0), tone: wrong ? 'bad' : '' }] });
    }
    if (ev.medianRoutePx != null) steps.push({ name: T('clrProject'), where: T('clrPhone'), value: ev.medianRoutePx, unit: T('clrPx'), lines: [{ text: T('clrMedian') }] });
    return { steps, defn: ev.holdoutTotal ? T('clrDefn') : '' };
  }
  const api = { build };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ClimbioCragLabReport = api;
})(globalThis);
