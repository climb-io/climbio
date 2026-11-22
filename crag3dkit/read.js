// 讀 3D 岩場：從 Climbio 格式 v2 的檔案（組合、畫面、圖層）找出一個模型和播放需要的東西。純函式，沒有 DOM，Node 也能跑。
// 資料的寫法見 format/VOCABULARY.md 的「3D 岩場」。
// English: derive everything the player needs (model, routes, areas with cameras, overview) from format v2 documents; pure, no DOM.
import { pickName } from './text.js';

const itemId = (item) => item.id ?? item.href?.replace(/\.json$/, '');

/**
 * Topo（有路線的照片畫面）都是同一個模型的快照時，回傳那個模型畫面的 id，否則回 null。
 * 部分是模型快照、部分不是，或各區拆成多段模型時回 null（多段請用 cragModelIds）。
 */
export function sharedModelId(views) {
  const id = views[0]?.props?.model?.id;
  return id && views.every((v) => v?.props?.model?.id === id) ? id : null;
}

/**
 * 所有 Topo 都有指定 3D 模型時，依出現順序回傳去重後的模型畫面 id 陣列（單模型 1 個、分段多模型多個），否則回空陣列。
 */
export function cragModelIds(views) {
  if (!views.length || !views.every((v) => v?.props?.model?.id)) return [];
  return [...new Set(views.map((v) => v.props.model.id))];
}

/**
 * docs：這個岩場所有檔案（組合、畫面、圖層，順序不拘）；modelId：模型畫面的 id（單一字串或分段模型 id 陣列）；lang：名稱的語言。
 * 回傳 null（找不到模型畫面）或
 * { model, models, segments, layers, marks, sight, nodes, owners, areas, overview }：
 * - models：模型畫面陣列（model 為第一個）；
 * - segments：照岩壁順序的分段模型資訊 [{ id, model, from, to, areaIndices }]；
 * - marks：模型上路線的 LineString 標註；sight：路線遮擋表的規格（圖層的 props.sight）；
 * - nodes：包著這些模型的組合的去重節點（收過同一個岩場的別的版本時，路線 id 可能一樣，所以只讀包著這組模型的組合）；
 * - areas：[{ id, name, camera, aspect, routes: Set(路線 id), snapshot, modelId }]，每面有快照的岩壁一個，照岩壁節點的 props.order 排（沿著岩壁走的順序）；
 * - overview：全區快照（掛在岩場或分區節點、對應其中一段模型），沒有就是 undefined。
 */
export function readCrag3d(docs, modelId, { lang } = {}) {
  const all = [...docs];
  const ids = [...new Set((Array.isArray(modelId) ? modelId : [modelId]).filter(Boolean))];
  if (!ids.length) return null;
  const models = ids.map((id) => all.find((d) => d.id === id && d.kind === 'view' && d.surface === 'model')).filter(Boolean);
  if (models.length !== ids.length) return null;
  const modelSet = new Set(ids);
  const layers = all.filter((d) => d.kind === 'layer' && modelSet.has(d.on));
  const marks = layers.flatMap((l) => l.marks ?? []);
  const sight = layers.find((l) => l.props?.sight)?.props.sight;
  const owners = all.filter((d) => d.kind === 'set' && d.items?.some((i) => modelSet.has(itemId(i))));
  const nodeMap = new Map();
  for (const s of owners) for (const n of s.nodes ?? []) if (!nodeMap.has(n.id)) nodeMap.set(n.id, n);
  const nodes = [...nodeMap.values()];
  const byNode = new Map(nodes.map((n) => [n.id, n]));
  const shots = all.filter((d) => d.kind === 'view' && d.surface === 'photo' && modelSet.has(d.props?.model?.id));
  const walls = [...new Map(shots.filter((v) => byNode.get(v.props.node)?.type === 'wall').map((v) => [v.props.node, v])).values()]
    .sort((a, b) => (byNode.get(a.props.node).props?.order ?? 0) - (byNode.get(b.props.node).props?.order ?? 0));
  const areas = walls.map((v) => ({
    id: v.props.node, name: pickName(byNode.get(v.props.node).name, lang), camera: v.props.model.camera, aspect: v.w / v.h, snapshot: v, modelId: v.props.model.id,
    routes: new Set(nodes.filter((n) => n.type === 'route' && n.parent === v.props.node).map((n) => n.id)),
  }));
  const byModel = new Map(models.map((m) => [m.id, m]));
  const segMap = new Map();
  areas.forEach((a, i) => {
    let seg = segMap.get(a.modelId);
    if (!seg) segMap.set(a.modelId, seg = { id: a.modelId, model: byModel.get(a.modelId), from: i, to: i, areaIndices: [] });
    seg.from = Math.min(seg.from, i); seg.to = Math.max(seg.to, i); seg.areaIndices.push(i);
  });
  const segments = segMap.size ? [...segMap.values()].sort((a, b) => a.from - b.from) : models.map((m) => ({ id: m.id, model: m, from: 0, to: 0, areaIndices: [] }));
  const overview = shots.find((v) => ['crag', 'area'].includes(byNode.get(v.props.node)?.type));
  return { model: models[0], models, segments, layers, marks, sight, nodes, owners, areas, overview };
}
