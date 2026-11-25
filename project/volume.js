import '../routekit/geometry.js';
import '../routekit/labels.js';
import '../routekit/base.js';
import '../routekit/scene.js';
import '../routekit/image.js';
import '../routekit/fit.js';
import '../routekit/editor.js';
import '../routekit/viewport.js';
import '../routekit/viewer.js';
import '../routekit/circles.js';

// 原岩南港照片上的黑色 Volume 與七顆岩點：示範圖（nangang-wall.webp）的像素，由開放資料集的岩點檔換算。
const outlines = {
  volume: [[721,59],[809,138],[749,183],[705,140]],
  redTop: [[731,75],[740,77],[743,79],[745,81],[747,86],[748,89],[747,90],[744,90],[740,88],[731,82],[730,80],[729,78],[730,76]],
  blue: [[722,83],[725,84],[727,88],[727,90],[726,96],[722,109],[718,114],[713,118],[712,118],[711,116],[713,111],[718,96],[718,89],[718,86],[719,84]],
  teal: [[728,105],[733,106],[737,111],[736,117],[730,129],[725,136],[720,138],[713,140],[707,139],[705,135],[707,129],[724,108]],
  red: [[747,96],[771,108],[780,114],[786,126],[779,140],[769,139],[743,126],[741,119],[741,104]],
  lime: [[758,135],[772,140],[772,144],[770,149],[769,150],[765,149],[761,147],[757,144],[756,140],[756,136]],
  redRing: [[739,142],[744,143],[754,152],[756,158],[755,162],[740,167],[734,166],[729,163],[729,151],[733,145]],
  yellow: [[780,148],[783,149],[783,155],[780,161],[773,168],[766,172],[758,172],[755,170],[755,166],[757,162],[763,156],[772,150]],
};

const photo = document.querySelector('.pg-compare-stage img');
const demo = document.querySelector('.pg-volume');
const [circles, preview] = demo.querySelectorAll('canvas');
const replay = demo.querySelector('button');

photo.decode().then(() => {
  const kit = window.RouteKit;
  const crop = { x: 621, y: 14, w: 268, h: 226 };
  const source = document.createElement('canvas');
  source.width = circles.width = crop.w;
  source.height = circles.height = crop.h;
  source.getContext('2d').drawImage(photo, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
  const holds = Object.entries(outlines).map(([id, poly]) => ({ id, poly: poly.map(([x, y]) => [x - crop.x, y - crop.y]) }));
  const target = holds.find(h => h.id === 'lime');
  const box = kit.bbox(target.poly), x = (box.x0 + box.x1) / 2, y = (box.y0 + box.y1) / 2;
  const candidates = kit.holdsUnder(holds, x, y);

  const ctx = circles.getContext('2d');
  ctx.drawImage(source, 0, 0);
  ctx.beginPath();
  ctx.arc(x, y, kit.CIRCLE_DIAMETER[1] * photo.naturalWidth / 2, 0, 2 * Math.PI);
  ctx.strokeStyle = '#0c1c2b'; ctx.lineWidth = 4; ctx.stroke();
  ctx.strokeStyle = kit.THEME.colors.h; ctx.lineWidth = 2.5; ctx.stroke();

  const editor = new kit.RouteEditor(preview, { scene: kit.scene(source, holds), route: { holds: {} }, type: 'h', mode: 'gray', glow: true, zoom: true });
  const show = () => {
    editor.setRoute({ holds: {} });
    editor.openPick(candidates, target);
  };
  replay.disabled = false;
  replay.addEventListener('click', show);
  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); show(); }
  });
  observer.observe(preview);
}, () => {});
