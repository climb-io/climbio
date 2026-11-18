// 外觀基準的場景載入：?scene=<名稱> 讀 <名稱>.scene.json 與 longdong-map.json → MapViewer，畫面直接設成場景的 view。
// 場景與基準圖由龍洞的 npm run test:map-shots -- --update 產生（龍洞的 ScaleMap），這裡照抄。
import { MapViewer } from '../view.js';
import { readMap } from '../data.js';

/** 龍洞地圖右下角的版權標示（各語言） */
const CREDIT = { zh: '© 內政部國土測繪中心', en: '© NLSC, Taiwan', ja: '© 台湾内政部国土測絵センター' };

const name = new URLSearchParams(location.search).get('scene');
if (name) {
  const [s, view] = await Promise.all([`${name}.scene.json`, 'longdong-map.json'].map(async (f) => (await fetch(f)).json()));
  const host = document.querySelector('#scene');
  host.style.width = `${s.frame.w}px`;
  host.style.height = `${s.frame.h}px`;
  const viewer = new MapViewer(host, {
    lang: s.lang,
    attribution: [{ text: '© TOCC' }, { text: CREDIT[s.lang] }, { text: '© OpenStreetMap', href: 'https://www.openstreetmap.org/copyright' }],
    walls: !!s.walls,
    sectorLabels: !!s.sectorLabels,
    selected: s.selected,
    dim: s.dim,
    hideAreas: s.hideAreas,
    draft: s.draft,
    marks: s.marks,
    here: s.here,
    pin: s.pick,
    locate: !!s.here,
  });
  window.viewer = viewer;
  viewer.setData({ view });
  if (s.edit) {
    const m = readMap(view);
    const unproject = (r) => r.map(m.proj.unproject);
    const area = m.areas.find((a) => a.id === s.edit.node);
    const wall = m.walls.find((w) => w.id === s.edit.node);
    // 步道：救援資訊圖的步道（第一個 trail 標註，同龍洞編輯的對象）
    const trail = view.marks.find((k) => k.props?.kind === 'trail').geometry.coordinates;
    viewer.editing = { rings: area ? area.rings.map(unproject) : wall ? wall.lngLat : trail, closed: !!area, selected: s.edit.selected, faces: !!s.edit.faces };
  }
  viewer.setView(s.view);
  await document.fonts.ready;
  await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok)));
  document.body.dataset.done = '1';
}
