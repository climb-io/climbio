// 公開格式的「放法與連結」檢查（規則見 format/README.md 的「放法與連結」）：一棵檔案樹（組合、畫面、圖層）裡
//   1. 節點 id 不重複（同一個東西只放一處）；
//   2. 標註的 node、節點的 parent 都找得到（先找同一個檔案，再找整棵樹）；
//   3. Topo 圖層不放路線節點（路線在組合裡），只放 bolt、確保站，上層是路線；岩點牆的圖層（路線由 props.holds 定義）除外；
//   4. 路線的線段標註、bolt 的上層指到的是路線；
//   5. 層次：主區域（area、crag）的上層是主區域；子區域（sector、wall）的上層是主區域；路線的上層是子區域（岩場也可以當子區域用）；
//      照片畫面的 props.node 指到子區域；
//   6. 子集完整：單獨拿一包（例如分享一個 Topo）檢查時，標註指到的路線、照片指到的區域都在這一包裡（第 2 點的「找不到」就是這個）；
//   7. 不存可以從 nodes 數出來的數字（岩壁數、路線數）和預覽圖的複本（入口照片）。
// English: checks the placement/linking rules of the open format on a file tree.
const localId = (id) => (typeof id === 'string' ? id.split('#').pop() : id);

/** docs：[{ path, doc }] 或 doc 陣列；回傳問題的說明陣列（空的就是沒問題） */
export function placementProblems(input) {
  const docs = input.map((d) => d.doc ?? d), problems = [];
  const where = new Map();   // 節點 id → 定義它的檔案
  const owners = new Map();
  for (const d of docs) {
    for (const n of d.nodes ?? []) {
      // 全域 id（16 碼）整棵樹唯一；本地 id（bolt）在各檔案內唯一，不同檔案可以重複
      const global = /^[0-9a-z]{12,}$/.test(n.id);
      if (global && where.has(n.id)) problems.push(`節點 ${n.id} 在 ${where.get(n.id)} 和 ${d.id} 重複定義`);
      if (global) where.set(n.id, d.id);
      owners.set(`${d.id}#${n.id}`, n);
      if (!global) owners.set(n.id, owners.get(n.id) ?? n);   // 本地 id 的備援查找
      if (global) owners.set(n.id, n);
    }
  }
  const find = (d, id) => owners.get(`${d.id}#${localId(id)}`) ?? owners.get(localId(id));
  for (const d of docs) {
    if (d.kind === 'set' && d.type === 'guidebook') {
      for (const k of ['walls', 'routes', 'cover']) if (d.props && k in d.props) problems.push(`${d.id} 的 props.${k} 是可以從 nodes 數出來的複本，不要存`);
    }
    const holdRoutes = d.kind === 'layer' && (d.nodes ?? []).some((n) => n.type === 'route' && n.props?.holds);
    if (d.kind === 'layer' && !holdRoutes) {
      for (const n of d.nodes ?? []) {
        if (n.type === 'route') problems.push(`圖層 ${d.id} 裡有路線節點 ${n.id}：路線節點放在組合的 nodes，圖層只放 bolt、確保站`);
      }
    }
    if (d.kind === 'view' && d.surface === 'photo' && d.props?.node && !['crag', 'area', 'sector', 'wall'].includes(find(d, d.props.node)?.type)) problems.push(`照片 ${d.id} 的 props.node ${d.props.node} 找不到或不是區域`);
    for (const n of d.nodes ?? []) {
      if (n.parent && !find(d, n.parent)) problems.push(`節點 ${n.id} 的 parent ${n.parent} 找不到`);
      const up = n.parent && find(d, n.parent)?.type;
      if (up && ['crag', 'area'].includes(n.type) && !['crag', 'area'].includes(up)) problems.push(`主區域 ${n.id}（${n.type}）的上層是 ${up}，應該是主區域`);
      if (up && ['sector', 'wall'].includes(n.type) && !['crag', 'area'].includes(up)) problems.push(`子區域 ${n.id}（${n.type}）的上層是 ${up}，應該是主區域`);
      if (up && n.type === 'route' && !['crag', 'area', 'sector', 'wall'].includes(up)) problems.push(`路線 ${n.id} 的上層是 ${up}，應該是子區域`);
      if ((n.type === 'bolt' || n.type === 'anchor') && find(d, n.parent)?.type !== 'route') problems.push(`${n.type} ${n.id} 的 parent 不是路線`);
    }
    // 路線號碼（指向路線的 Point 標註）只給沒有線的路線：同一個圖層裡同一條路線有線又有號碼位置，以線為準，不該兩個都寫
    const lined = new Set((d.marks ?? []).filter((m) => m.geometry?.type === 'LineString' && m.node).map((m) => m.node));
    for (const m of d.marks ?? []) if (m.geometry?.type === 'Point' && lined.has(m.node) && find(d, m.node)?.type === 'route') problems.push(`${d.id} 的路線 ${m.node} 有線又有號碼位置標註，有線時不寫號碼位置`);
    for (const m of d.marks ?? []) {
      if (!m.node) continue;
      const n = find(d, m.node);
      if (!n) problems.push(`${d.id} 的標註指到找不到的節點 ${m.node}`);
      else if (m.geometry?.type === 'LineString' && d.kind === 'layer' && n.type !== 'route') problems.push(`${d.id} 的線段指到 ${n.type} 節點 ${m.node}，應該是路線`);
    }
  }
  return problems;
}
