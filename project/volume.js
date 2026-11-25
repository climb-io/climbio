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

// 原岩南港照片上的黑色量體與七顆岩點，座標對應原始牆照。
const outlines = {
  volume: [[720,59],[739,76],[763,95],[782,113],[810,137],[792,154],[774,169],[757,185],[745,182],[731,175],[720,165],[705,147],[704,137],[709,117],[714,94],[717,75]],
  redTop: [[731,74],[735,74],[741,78],[747,84],[748,89],[743,90],[736,86],[730,81]],
  blue: [[724,84],[728,87],[728,97],[725,106],[721,114],[716,119],[712,118],[715,108],[717,96],[718,87]],
  teal: [[731,105],[737,107],[739,112],[736,120],[731,128],[722,135],[712,139],[705,137],[707,129],[713,120],[720,112],[725,106]],
  red: [[744,97],[752,96],[763,103],[774,108],[783,117],[786,127],[782,136],[775,140],[765,137],[755,129],[745,127],[740,119],[739,110]],
  lime: [[755,135],[761,136],[772,142],[774,146],[771,150],[765,151],[758,148],[754,143]],
  redRing: [[734,144],[740,142],[748,146],[756,151],[758,158],[751,163],[742,166],[733,164],[729,159],[729,152]],
  yellow: [[758,160],[765,154],[775,150],[781,148],[784,150],[782,156],[777,163],[769,169],[760,172],[755,170],[755,166]],
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

  const editor = new kit.RouteEditor(preview, { scene: kit.scene(source, holds), route: { holds: {} }, type: 'h', mode: 'dim', glow: true, zoom: true });
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
