// Lab 的 3D 牆頁（中文 lab/wall3d/、英文 lab/wall3d/en/ 共用）：「怎麼做」的步驟卡是 3D 重建流程的實際量測，讀開放資料集 climbio/wall3d-lab 的 pipeline/*-summary.json，
// 跟 Studio、Hold Lab 的報告同一個框架（studio/report-frame.js）；數字算法在 studio/wall3d/report.js。
(() => {
  'use strict';
  const EN = document.documentElement.lang === 'en';
  const BASE = 'https://huggingface.co/datasets/climbio/wall3d-lab/resolve/main/pipeline/';
  const TEXT = AppKit.i18n.packs['studio-wall3d'][EN ? 'en' : 'zh'];   // 文字跟 Studio 3D 牆共用語言包
  const T = (k, ...a) => { const v = TEXT[k]; return typeof v === 'function' ? v(...a) : v ?? k; };
  const ol = document.getElementById('w3steps'), notes = document.getElementById('w3notes');
  ClimbioWall3dReport.load(BASE).then(m => {
    const r = ClimbioWall3dReport.build(m, T);
    ClimbioReportFrame.steps(ol, r.steps);
    ClimbioReportFrame.notes(notes, { defn: r.defn });
  }).catch(e => { console.error(e); ClimbioReportFrame.notes(notes, { defn: T('w3rFail') }); });
})();
