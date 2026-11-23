// 分享連結的預覽內容（標題、說明）：路線、天然岩場（含 Topo）、3D 牆共用同一套組句，讓貼進聊天軟體的卡片都帶有用的資訊。
// 只組文字，不碰 Firestore 與網路；讀資料的人（route-page.js、projects.js）把欄位傳進來。
const text = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? String(v['zh-Hant'] || Object.values(v)[0] || '') : '');
// 難度 { v | dan | font } → 字串
const gradeText = (g) => (g && typeof g === 'object' ? String(g.v || g.dan || g.font || '') : '');
const join = (parts) => parts.filter(Boolean).join('・');

// 岩點貓的一條路線。node：路線節點（name、props.grade、props.holds、author）；wall：{ name, gym }
function routePreview({ node, wall = {} }) {
  const p = (node && node.props) || {}, grade = gradeText(p.grade), name = text(node && node.name), holds = Object.keys(p.holds || {}).length;
  return {
    title: [name, grade].filter(Boolean).join(' ') || 'Climbio',
    description: join([wall.gym && wall.name && wall.name.includes(wall.gym) ? '' : wall.gym, wall.name, holds ? `${holds} 顆岩點` : '', node && node.author ? `定線 ${node.author}` : '']) || 'Climbio',
  };
}
// 岩點貓的一面公開牆（連結 /r/<牆 id>/）。wall：{ name, gym, n: 公開路線數 }
function wallPreview({ name, gym, n } = {}) {
  return { title: name || gym || 'Climbio', description: join([gym && name && name.includes(gym) ? '' : gym, n ? `${n} 條路線` : '', '岩點貓']) };
}
// 天然岩場。set：索引（組合）；view：分享的是其中一張 Topo 時，那張照片畫面（沒有就是整個岩場）
function cragPreview({ name, set, view }) {
  const nodes = (set && set.nodes) || [], routes = nodes.filter((n) => n.type === 'route').length;
  const crag = text(nodes.find((n) => n.type === 'crag')?.name) || text(set && set.name) || name;
  const topo = view ? text(view.name) : '';
  return {
    title: topo || name || crag || 'Guidebook',
    description: join([topo ? name || crag : crag !== (name || crag) ? crag : '', routes ? `${routes} 條路線` : '', '紅點貓 Topo']),
  };
}
// 3D 牆（wall3d）、3D 岩場（crag3d）。gym：岩館（有的才有）
function model3dPreview({ type, name, gym }) {
  return { title: name || '3D', description: join([gym, type === 'crag3d' ? '3D 岩場' : '3D 牆', '岩點貓']) };
}
module.exports = { text, gradeText, join, routePreview, wallPreview, cragPreview, model3dPreview };
