// 重畫之後的動態：編號牌、說明換了位置就從原來的位置滑過去，說明新出現就淡入。
// TopoViewer 每次重畫都是整個 SVG 重建，所以不用 CSS transition，而是記著每塊牌子上次顯示的位置，每個畫面算一次位移與透明度。
// 沒有 DOM 的環境（Node）不會用到；座標是照片像素。
const DURATION_MS = 220;
// 位置變動超過這麼多螢幕像素才算「換位置」（縮放時沿用位置的細微移動不動畫）
const MOVE_PX = 6;
const ease = (p) => 1 - (1 - p) ** 3;

/**
 * svg：剛重畫完的 SVG 元素；memory：上一次的回傳值（第一次傳 undefined）；k：一個螢幕像素等於幾個照片像素；now：目前時間（毫秒）
 * 回傳 { memory, busy }：memory 給下一次用；busy 為真表示還有動畫在跑，要再重畫一次
 */
export function animateChanges(svg, memory, k, now) {
  const seen = new Map();
  for (const route of svg.querySelectorAll('g.topo-route[data-route]')) {
    const id = route.dataset.route;
    const badge = route.querySelector(':scope > g.topo-badge');
    const box = badge?.firstElementChild;
    if (box) seen.set(`b:${id}`, { el: badge, x: +box.getAttribute('x') + box.getAttribute('width') / 2, y: +box.getAttribute('y') + box.getAttribute('height') / 2 });
    const note = route.querySelector(':scope > text.topo-note'), line = note?.firstElementChild;
    if (line) seen.set(`n:${id}`, { el: note, x: +line.getAttribute('x'), y: +line.getAttribute('y'), fade: true });
  }
  let busy = false;
  for (const [key, cur] of seen) {
    const prev = memory?.get(key);
    let anim = prev?.anim;
    if (memory?.size) {
      if (!prev) { if (cur.fade) anim = { t0: now, dx: 0, dy: 0, fade: true }; }
      else if (Math.hypot(cur.x - prev.vx, cur.y - prev.vy) / k > MOVE_PX && (!anim || Math.hypot(cur.x - prev.x, cur.y - prev.y) / k > MOVE_PX)) {
        // 換位置：從現在顯示的位置滑過去；動畫還在跑、目的地沒變就繼續，不重來
        anim = { t0: now, dx: prev.vx - cur.x, dy: prev.vy - cur.y, fade: false };
      }
    }
    const p = anim ? (now - anim.t0) / DURATION_MS : 1;
    if (!anim || p >= 1) { cur.vx = cur.x; cur.vy = cur.y; continue; }
    const rest = 1 - ease(p);
    cur.anim = anim;
    cur.vx = cur.x + anim.dx * rest;
    cur.vy = cur.y + anim.dy * rest;
    if (anim.dx || anim.dy) cur.el.setAttribute('transform', `translate(${anim.dx * rest} ${anim.dy * rest})`);
    if (anim.fade) cur.el.style.opacity = String(1 - rest);
    busy = true;
  }
  return { memory: seen, busy };
}
