// Candidate collection groups from source-declared ancestry, never inferred geography.
// Only currently visible, independent sets are eligible. Existing merged sets and
// every member of those sets are excluded, including when a member appears on Home.
export function autoMergeCandidates(home, docs) {
  const byId = new Map(docs.map((doc) => [doc.id, doc]));
  const itemId = (item) => item.id ?? item.href?.replace(/\.json$/, '');
  const protectedIds = new Set();
  for (const doc of docs) {
    if (doc.kind !== 'set' || doc.props?.merged !== true) continue;
    protectedIds.add(doc.id);
    for (const item of doc.items ?? []) protectedIds.add(itemId(item));
  }
  const candidates = new Map();
  for (const item of home?.items ?? []) {
    const doc = byId.get(itemId(item));
    if (doc?.kind !== 'set' || protectedIds.has(doc.id) || doc.props?.merged) continue;
    const path = doc.props?.sourceHierarchy;
    if (!Array.isArray(path) || path.length < 2) continue;
    // Each ancestor is an alternative grouping level, root through immediate parent.
    for (let depth = 0; depth < path.length - 1; depth++) {
      const ancestor = path[depth];
      if (!ancestor?.id || !ancestor?.name || path.slice(depth + 1).some((p) => !p?.id)) continue;
      // The group key is the whole path from the root: same-named or even same-id levels under
      // different sources are different groups and must not be mixed.
      const key = path.slice(0, depth + 1).map((p) => String(p.id)).join('/');
      if (!candidates.has(key)) candidates.set(key, {
        id: String(ancestor.id), name: ancestor.name, depth, ids: [], names: [], branches: new Set(),
      });
      const group = candidates.get(key);
      if (group.ids.includes(doc.id)) continue;
      group.ids.push(doc.id);
      group.names.push(typeof doc.name === 'string' ? doc.name : Object.values(doc.name ?? {})[0] ?? globalThis.AppKit?.i18n?.t('unnamedCrag') ?? '未命名岩場');
      group.branches.add(String(path[depth + 1].id));
    }
  }
  return [...candidates.values()]
    .filter((g) => g.ids.length >= 2 && g.branches.size >= 2)
    .map(({ branches, ...rest }) => rest)
    .sort((a, b) => b.depth - a.depth || a.name.localeCompare(b.name));
}
