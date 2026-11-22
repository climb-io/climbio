// 拍照位置與朝向的幾何：照片歸岩壁、推估牆線、牆線的朝向。座標一律 [經度, 緯度]（v2、GeoJSON 的順序）。

const R = 6371008.8, RAD = Math.PI / 180;

/** 照片歸同一面岩壁的門檻：拍照位置相距幾公尺內、鏡頭朝向相差幾度內 */
export const GROUP_RADIUS = 15;
export const GROUP_ANGLE = 40;
/** 沒有拍照位置的照片：跟有位置的照片拍攝時間相差幾毫秒內，就歸到那張的岩壁 */
export const GROUP_TIME = 60_000;
/** 推估牆線：岩壁離拍照點多遠（公尺，可調；抱石、小岩壁大多在 5 公尺內）；沒有焦距時當成手機主鏡頭的等效 26mm */
export const WALL_DISTANCE = 5;
/** 拍照位置的水平誤差超過幾公尺就不用（樹林裡、剛開定位時常有幾十到上千公尺的誤差） */
export const MAX_ACCURACY = 10;

/** 拍照位置用得上：有位置，而且沒有標示誤差或誤差在 MAX_ACCURACY 內 */
export const located = (camera) => !!camera?.position && !(camera.accuracy > MAX_ACCURACY);
export const DEFAULT_FOCAL = 26;

export const norm360 = (deg) => ((deg % 360) + 360) % 360;
/** 兩個方位角相差幾度（0–180） */
export const angleBetween = (a, b) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);

/** 兩點的距離（公尺） */
export function distance([lng1, lat1], [lng2, lat2]) {
  const a = Math.sin(((lat2 - lat1) * RAD) / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(((lng2 - lng1) * RAD) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** 以 origin 為原點的平面座標（公尺，x 向東、y 向北）；幾百公尺內誤差可以忽略 */
export function local(origin) {
  const k = Math.cos(origin[1] * RAD) * R * RAD;
  return {
    to: ([lng, lat]) => [(lng - origin[0]) * k, (lat - origin[1]) * R * RAD],
    from: ([x, y]) => [origin[0] + x / k, origin[1] + y / (R * RAD)],
  };
}

/** 方位角的平均（圓形平均）；沒有值時 undefined */
export function meanBearing(list) {
  const x = list.reduce((s, b) => s + Math.sin(b * RAD), 0), y = list.reduce((s, b) => s + Math.cos(b * RAD), 0);
  if (!list.length || Math.hypot(x, y) < 1e-9) return undefined;
  return norm360(Math.atan2(x, y) / RAD);
}

/**
 * 新照片歸到哪一面岩壁：跟某面岩壁裡任何一張照片的拍照位置在 radius 內、朝向在 angle 內（有一邊沒有朝向就只看位置），
 * 取最近的那面；都不符合（或照片沒有位置）時 undefined。walls：[{ id, cameras: [camera…] }]
 */
export function pickWall(camera, walls, { radius = GROUP_RADIUS, angle = GROUP_ANGLE } = {}) {
  if (!located(camera)) return undefined;
  let best, bestD = Infinity;
  for (const w of walls) {
    for (const c of w.cameras) {
      if (!located(c)) continue;
      const d = distance(camera.position, c.position);
      const sameWay = camera.heading === undefined || c.heading === undefined || angleBetween(camera.heading, c.heading) <= angle;
      if (d <= radius && sameWay && d < bestD) { best = w.id; bestD = d; }
    }
  }
  return best;
}

/** 照片拍到的寬度（公尺）：等效 35mm 焦距算水平視角，乘上距離。直拍的照片寬是底片的 24mm、橫拍 36mm */
export function viewWidth(dist, focal = DEFAULT_FOCAL, portrait = false) {
  return (dist * (portrait ? 24 : 36)) / (focal || DEFAULT_FOCAL);
}

/** 地圖上畫的照片視錐：拍照位置、朝向（度，正北順時針）、水平視角（度）；位置用不上或沒有朝向的不畫（null） */
export function photoWedge(camera, portrait = false) {
  if (!located(camera) || camera.heading === undefined) return null;
  return { position: camera.position.slice(0, 2), heading: camera.heading, fov: (2 * Math.atan(viewWidth(1, camera.focal, portrait) / 2)) / RAD };
}

/**
 * 從一面岩壁的照片推估牆線：每張照片從拍照點沿鏡頭方向推 dist 公尺，得到拍到的範圍；牆線垂直於平均朝向，蓋住所有範圍。
 * 點的順序照 v2 岩壁線的約定：沿著點前進，岩壁面朝右手邊（就是從照片看過去由左到右）。aspect 是鏡頭方向的反方向。
 * shots：[{ camera, portrait }]，只用位置用得上（located）而且有朝向的；一張都沒有時 undefined
 */
export function estimateWall(shots, dist = WALL_DISTANCE) {
  const ok = shots.filter(s => located(s.camera) && s.camera.heading !== undefined);
  if (!ok.length) return undefined;
  const heading = meanBearing(ok.map(s => s.camera.heading));
  if (heading === undefined) return undefined;
  const plane = local(ok[0].camera.position);
  const right = [Math.sin((heading + 90) * RAD), Math.cos((heading + 90) * RAD)];
  const spans = ok.map(({ camera, portrait }) => {
    const [x, y] = plane.to(camera.position);
    const center = [x + dist * Math.sin(camera.heading * RAD), y + dist * Math.cos(camera.heading * RAD)];
    return { center, half: viewWidth(dist, camera.focal, portrait) / 2 };
  });
  const mid = [spans.reduce((s, p) => s + p.center[0], 0) / spans.length, spans.reduce((s, p) => s + p.center[1], 0) / spans.length];
  const along = spans.map(p => (p.center[0] - mid[0]) * right[0] + (p.center[1] - mid[1]) * right[1]);
  const from = Math.min(...spans.map((p, i) => along[i] - p.half)), to = Math.max(...spans.map((p, i) => along[i] + p.half));
  const at = (s) => roundPos(plane.from([mid[0] + s * right[0], mid[1] + s * right[1]]));
  return { line: [at(from), at(to)], aspect: Math.round(norm360(heading + 180)) % 360 };
}

export const roundPos = ([lng, lat]) => [Math.round(lng * 1e7) / 1e7, Math.round(lat * 1e7) / 1e7];

/** 牆線的朝向（度）：沿著點前進，岩壁面朝右手邊；各段依長度加權平均。線長為 0 時 undefined */
export function lineAspect(line) {
  if (!line || line.length < 2) return undefined;
  const plane = local(line[0]), pts = line.map(plane.to);
  let x = 0, y = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0], dy = pts[i][1] - pts[i - 1][1], len = Math.hypot(dx, dy);
    if (!len) continue;
    const face = norm360(Math.atan2(dx, dy) / RAD + 90);
    x += Math.sin(face * RAD) * len; y += Math.cos(face * RAD) * len;
  }
  if (Math.hypot(x, y) < 1e-9) return undefined;
  return Math.round(norm360(Math.atan2(x, y) / RAD)) % 360;
}
