// 外觀基準的場景（龍洞 scripts/topo-shots.ts 產生的 <名稱>.scene.json，座標是照片像素）→ v2 的照片畫面＋圖層。
// 照片用程式產生的格線（和龍洞的基準圖同一張），不依賴圖檔。瀏覽器與 Node 都能載入。

/** 場景 → v2 的畫面與圖層 */
export function sceneData(s) {
  const photoSvg = (() => {
    const { w, h } = s.photo, lines = [];
    for (let x = 0; x <= w; x += w / 10) lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${h}"/>`);
    for (let y = 0; y <= h; y += h / 10) lines.push(`<line x1="0" y1="${y}" x2="${w}" y2="${y}"/>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8d8f86"/><stop offset="1" stop-color="#4f5a4a"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><g stroke="#ffffff" stroke-opacity="0.18" stroke-width="${w / 400}">${lines.join('')}</g></svg>`;
  })();
  const view = {
    climbio: 2, kind: 'view', surface: 'photo', id: 'scene',
    href: `data:image/svg+xml;base64,${btoa(photoSvg)}`, w: s.photo.w, h: s.photo.h,
    ...(s.crop ? { props: { crop: s.crop } } : {}),
  };
  const nodes = [], marks = [];
  for (const r of s.routes) {
    nodes.push({ id: r.id, type: 'route', name: r.name, props: { style: r.kind === 'sport' ? 'sport' : 'toprope', ...(r.grade ? { grade: { yds: r.grade } } : {}) } });
    if (r.line) marks.push({ node: r.id, geometry: { type: 'LineString', coordinates: r.line }, props: { label: r.label } });
    for (const [pos, b] of Object.entries(r.bolts ?? {})) {
      const id = `${r.id}-${pos}`;
      nodes.push({ id, type: pos.startsWith('A') ? 'anchor' : 'bolt', parent: r.id, name: pos });
      marks.push({ node: id, geometry: { type: 'Point', coordinates: b.at }, ...(b.note ? { props: { label: b.note } } : {}) });
    }
  }
  return { view, layers: [{ climbio: 2, kind: 'layer', id: 'layer', on: 'scene', nodes, marks }] };
}
