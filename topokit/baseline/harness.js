// 外觀基準的場景載入：?scene=<名稱> 讀 <名稱>.scene.json（場景轉 v2 見 scene.js）→ TopoViewer。
// 龍洞的基準沒有 naturalEnds（線頭線尾的修飾），這裡關掉，比的是共用的排版；naturalEnds 在 test/unit.test.mjs 驗。
import { TopoViewer } from '../view.js';
import { sceneData } from './scene.js';

const name = new URLSearchParams(location.search).get('scene');
if (name) {
  const s = await (await fetch(`${name}.scene.json`)).json();
  const { width, zoom, focus, highlight, bolts, editing, solo, desktop, boltCodes, names } = s.view;
  const crop = s.crop ?? { x: 0, y: 0, w: s.photo.w, h: s.photo.h };
  const host = document.querySelector('#scene');
  host.style.width = `${width}px`;
  host.style.height = `${width * (crop.h / crop.w)}px`;
  const viewer = new TopoViewer(host, { highlight, bolts, editing, solo, boltCodes, names, ui: desktop ? 1.5 : 1, controls: false, naturalEnds: false });
  window.viewer = viewer;
  viewer.setData(sceneData(s));
  await new Promise((ok) => (host.dataset.ready ? ok() : viewer.addEventListener('ready', () => ok())));
  if (zoom > 1) {
    // 放大時以 focus 路線的中心為舞台中心（不超出照片邊緣）
    const pts = s.routes.find((r) => r.id === focus).line;
    const mx = (pts.reduce((a, p) => a + p[0], 0) / pts.length - crop.x) / crop.w, my = (pts.reduce((a, p) => a + p[1], 0) / pts.length - crop.y) / crop.h;
    const frameW = width * zoom, frameH = frameW * (crop.h / crop.w);
    // 比的是這個倍率直接排的樣子（龍洞的基準沒有縮放的過程）：清掉整張時記下的編號牌位置
    viewer.labelMemo.clear();
    viewer.setView({ scale: zoom, x: (0.5 - mx) * frameW, y: (0.5 - my) * frameH });
  }
  await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
  document.body.dataset.done = '1';
}
