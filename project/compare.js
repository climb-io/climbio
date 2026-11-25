import '../routekit/geometry.js';
import '../routekit/labels.js';
import '../routekit/base.js';
import '../routekit/scene.js';
import '../routekit/image.js';
import '../routekit/circles.js';

// 原岩南港 Spray Wall 示範線。外框依現有牆照描繪，兩種呈現共用這些岩點。
(() => {
  'use strict';

  const figure = document.querySelector('.pg-compare');
  const photo = figure.querySelector('img');
  const [outlines, circles] = figure.querySelectorAll('canvas');
  const slider = figure.querySelector('input');
  const wall = [
    ['s', [[100,432],[109,426],[121,421],[130,422],[138,428],[143,437],[142,444],[134,450],[123,453],[113,449],[105,445],[100,440]]],
    ['s', [[195,480],[205,473],[218,473],[232,481],[240,490],[253,497],[260,507],[258,521],[250,531],[233,535],[215,533],[201,524],[192,509],[191,492]]],
    ['h', [[205,357],[214,355],[220,361],[226,371],[242,383],[257,393],[257,402],[249,406],[238,402],[221,392],[209,380],[202,366]]],
    ['h', [[268,382],[279,378],[292,383],[306,393],[321,395],[347,394],[361,400],[373,410],[378,420],[371,429],[348,431],[322,436],[305,439],[290,432],[282,419],[271,409],[265,394]]],
    ['h', [[335,345],[348,342],[359,348],[369,359],[376,372],[376,382],[369,390],[352,395],[337,392],[326,384],[322,372],[325,359]]],
    ['h', [[404,267],[419,253],[434,242],[449,241],[463,247],[472,257],[483,277],[488,291],[482,305],[471,313],[455,316],[435,311],[420,307],[411,300],[405,286]]],
    ['h', [[465,211],[478,210],[495,217],[504,226],[511,242],[522,258],[536,268],[538,275],[527,279],[511,276],[496,270],[484,258],[474,238],[467,224]]],
    ['h', [[603,200],[617,197],[629,204],[641,218],[655,228],[676,233],[700,235],[712,242],[718,254],[713,270],[699,281],[679,287],[654,290],[630,287],[614,278],[601,264],[597,244],[596,225]]],
    ['h', [[554,131],[565,119],[578,120],[591,127],[612,136],[638,145],[665,151],[691,145],[704,141],[713,153],[717,177],[711,188],[697,197],[678,200],[651,196],[620,188],[595,178],[577,165],[559,150]]],
    ['h', [[771,197],[784,181],[804,172],[830,163],[856,158],[876,160],[887,171],[893,184],[891,203],[880,219],[863,231],[837,240],[812,245],[786,247],[770,244],[761,237],[760,225]]],
    ['t', [[770,11],[791,3],[824,3],[859,0],[888,4],[903,11],[906,24],[900,42],[890,64],[878,88],[862,108],[844,120],[826,125],[808,119],[795,105],[778,85],[767,62],[760,39],[761,24]]],
  ];

  photo.decode().then(() => {
    const kit = window.RouteKit;
    const source = document.createElement('canvas');
    const w = source.width = photo.naturalWidth;
    const h = source.height = photo.naturalHeight;
    source.getContext('2d').drawImage(photo, 0, 0);
    const holds = wall.map(([, poly], id) => ({ id: String(id), poly }));
    const route = { holds: Object.fromEntries(wall.map(([type], id) => [String(id), type])) };
    const colors = kit.THEME.colors;
    for (const canvas of [circles, outlines]) {
      canvas.width = w;
      canvas.height = h;
    }

    const before = circles.getContext('2d');
    before.drawImage(source, 0, 0);
    for (const { x, y, t, r } of kit.toCircles(route, holds, w, h)) {
      before.beginPath();
      before.arc(x * w / 100, y * h / 100, kit.CIRCLE_DIAMETER[r] * w / 2, 0, 2 * Math.PI);
      before.strokeStyle = 'rgba(0,0,0,.7)';
      before.lineWidth = 8;
      before.stroke();
      before.strokeStyle = colors[t];
      before.lineWidth = 5;
      before.stroke();
    }

    const scene = kit.scene(source, holds);
    kit.drawRoute(outlines.getContext('2d'), scene, route, holds, {
      mode: 'dim', tint: false, tape: false, glow: { roles: route.holds, colors, dpr: 2 },
    });
    scene.release();
    slider.addEventListener('input', () => figure.style.setProperty('--split', `${slider.value}%`));
    figure.dataset.ready = '';
    slider.disabled = false;
  }, () => {});
})();
