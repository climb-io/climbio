// 3D 牆的報告：3D 重建流程的量測檔（sfm、fusion、surface、validation 四份 *-summary.json）和 AI 逐顆檢查（review.js 的 status）→ 報告框架（studio/report-frame.js）的步驟卡。
// 數字都從檔案讀，不寫死；Lab 的 3D 牆頁讀開放資料集 climbio/wall3d-lab 的 pipeline/。發佈的標準是每顆岩點都檢查過（AI 逐顆看），量測數字只是重建的說明，不是門檻。
// ClimbioWall3dReport.load(資料夾網址) → { sfm, fusion, surface, validation }
// ClimbioWall3dReport.build(量測或 null, T, AI 檢查的 status?) → { steps, defn }
(function (root) {
  'use strict';
  const FILES = ['sfm', 'fusion', 'surface', 'validation'];
  const pct = v => Math.round(v * 100);

  async function load(base) {
    const got = await Promise.all(FILES.map(async n => { const r = await fetch(`${base}${n}-summary.json`); if (!r.ok) throw new Error(`${n}-summary.json ${r.status}`); return r.json(); }));
    return Object.fromEntries(FILES.map((n, i) => [n, got[i]]));
  }

  // T(key, ...參數)：介面文字（key 前綴 w3r）；n(數字) 千分位
  function build(m, T, review) {
    const n = v => Number(v).toLocaleString('en-US'), steps = [];
    if (m) {
      const { sfm, fusion, surface, validation } = m, model = (sfm.models || [])[0] || {};
      const dropped = (fusion.candidateHolds3Views || 0) - (surface.holds || 0);
      const sec = Object.values(sfm.seconds || {}).reduce((a, b) => a + b, 0) + (fusion.seconds || 0) + (surface.seconds || 0);
      steps.push(
        { name: T('w3rShoot'), where: T('w3rYou'), value: n(sfm.inputImages), unit: T('w3rPhotos'), lines: [{ text: T('w3rRegistered', n(model.registeredImages || 0)) }] },
        { name: T('w3rDetect'), where: T('w3rComputer'), value: n(fusion.detections), unit: T('w3rBoxes'), lines: [{ text: T('w3rCandidates', n(fusion.candidateHolds3Views)) }] },
        { name: T('w3rModel'), where: T('w3rComputer'), value: n(model.points3D || 0), unit: T('w3rPoints'), lines: [{ text: T('w3rReproj', (model.meanReprojectionErrorPx || 0).toFixed(2)) }, { text: T('w3rMinutes', Math.max(1, Math.round(sec / 60))) }] },
        { name: T('w3rVote'), where: T('w3rComputer'), value: n(surface.holds), unit: T('w3rHolds'), lines: [{ text: T('w3rObservations', n(surface.observations)) }, ...(dropped > 0 ? [{ text: T('w3rDropped', n(dropped)), tone: 'warn' }] : [])] },
        { name: T('w3rCheck'), where: T('w3rComputer'), value: `${pct(validation.medianIoU)}%`, unit: T('w3rOverlap'), lines: [{ text: T('w3rAnchors', pct(validation.anchorInsideMaskRate)) }, { text: T('w3rUndetected', n(validation.holdoutUndetected || 0)), tone: validation.holdoutUndetected ? 'warn' : '' }] },
      );
    }
    if (review) {
      const left = review.need.length;
      steps.push({ name: T('w3rAi'), where: 'AI', value: `${n(review.looked)}/${n(review.total)}`, unit: T('w3rLooked'), lines: [
        { text: T('w3rAiOff', n(review.off)) }, { text: T('w3rAiReshaped', n(review.reshaped)) },
        ...(review.retake.length ? [{ text: T('w3rAiRetake', n(review.retake.length)), tone: 'warn' }] : []),
        ...(left ? [{ text: T('w3rAiLeft', n(left)), tone: 'bad' }] : []),
      ] });
    }
    return { steps, defn: m ? T('w3rDefn', n(m.validation.heldoutPairs)) : '' };
  }

  const api = { FILES, load, build };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ClimbioWall3dReport = api;
})(globalThis);
