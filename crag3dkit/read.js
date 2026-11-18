// 讀 3D 岩場：從 Climbio 格式 v2 的檔案（組合、畫面、圖層）找出一個模型和播放需要的東西。純函式，沒有 DOM，Node 也能跑。
// 資料的寫法見 format/VOCABULARY.md 的「3D 岩場」。
// English: derive everything the player needs (model, routes, areas with cameras, overview) from format v2 documents; pure, no DOM.
import { pickName } from './text.js';

const itemId = (item) => item.id ?? item.href?.replace(/\.json$/, '');

/**
 * Topo（有路線的照片畫面）都是同一個模型的快照時，回傳那個模型畫面的 id，否則回 null。
 * 部分是模型快照、部分不是，照一般 Topo 看；一個岩場多個模型還沒有定義。
 */
export function sharedModelId(views) {
  const id = views[0]?.props?.model?.id;
  return id && views.every((v) => v?.props?.model?.id === id) ? id : null;
}

/**
 * docs：這個岩場所有檔案（組合、畫面、圖層，順序不拘）；modelId：模型畫面的 id；lang：名稱的語言。
 * 回傳 null（找不到模型畫面）或
 * { model, layers, marks, sight, nodes, owners, areas, overview }：
 * - marks：模型上路線的 LineString 標註；sight：路線遮擋表的規格（圖層的 props.sight）；
 * - nodes：包著這個模型的組合的節點（收過同一個岩場的別的版本時，路線 id 可能一樣，所以只讀包著這個模型的組合）；
 * - areas：[{ id, name, camera, aspect, routes: Set(路線 id), snapshot }]，每面有快照的岩壁一個，照岩壁節點的 props.order 排（沿著岩壁走的順序）；
 * - overview：全區快照（掛在岩場或分區節點、同一個模型），沒有就是 undefined。
 */
export function readCrag3d(docs, modelId, { lang } = {}) {
  const all = [...docs];
  const model = all.find((d) => d.id === modelId && d.kind === 'view' && d.surface === 'model');
  if (!model) return null;
  const layers = all.filter((d) => d.kind === 'layer' && d.on === model.id);
  const marks = layers.flatMap((l) => l.marks ?? []);
  const sight = layers.find((l) => l.props?.sight)?.props.sight;
  const owners = all.filter((d) => d.kind === 'set' && d.items?.some((i) => itemId(i) === model.id));
  const nodes = owners.flatMap((s) => s.nodes ?? []);
  const byNode = new Map(nodes.map((n) => [n.id, n]));
  const shots = all.filter((d) => d.kind === 'view' && d.surface === 'photo' && d.props?.model?.id === model.id);
  const walls = [...new Map(shots.filter((v) => byNode.get(v.props.node)?.type === 'wall').map((v) => [v.props.node, v])).values()]
    .sort((a, b) => (byNode.get(a.props.node).props?.order ?? 0) - (byNode.get(b.props.node).props?.order ?? 0));
  const areas = walls.map((v) => ({
    id: v.props.node, name: pickName(byNode.get(v.props.node).name, lang), camera: v.props.model.camera, aspect: v.w / v.h, snapshot: v,
    routes: new Set(nodes.filter((n) => n.type === 'route' && n.parent === v.props.node).map((n) => n.id)),
  }));
  const overview = shots.find((v) => ['crag', 'area'].includes(byNode.get(v.props.node)?.type));
  return { model, layers, marks, sight, nodes, owners, areas, overview };
}
