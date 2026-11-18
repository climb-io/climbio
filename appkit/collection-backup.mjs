// v2 組合的選擇性備份／復原範圍；資料由呼叫端給，不依賴任何 App。
const itemId = i => i.id ?? i.href.replace(/\.json$/, '').split('/').pop();
const req = r => new Promise((ok, bad) => { r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); });
/** 匯出選中的組合，保留其照片與紀錄，不把未勾選的內容藏在快照裡。 */
export function exportCollections(snapshot, ids, logKey) {
  const groups = snapshot.groups.filter(g => ids.includes(g.id)), keys = new Set(groups.flatMap(g => g.records.docs || []));
  const meta = Object.fromEntries(snapshot.rows.meta.map(r => [r.key, r.value]));
  const rows = Object.fromEntries(Object.entries(snapshot.rows).map(([name, records]) => {
    const selected = new Set(groups.flatMap(g => g.records[name] || []));
    return [name, records.filter(r => selected.has(r.key))];
  }));
  const home = snapshot.rows.docs.find(r => r.key === meta.home);
  if (home) rows.docs.push({ ...home, value: { ...home.value, items: home.value.items.filter(i => keys.has(itemId(i))) } });
  const metadata = new Map(rows.meta.map(r => [r.key, r]));
  metadata.set('home', { key: 'home', value: meta.home });
  for (const key of ['sources', 'collected', 'listed']) metadata.set(key, { key, value: Object.fromEntries(Object.entries(meta[key] || {}).filter(([id]) => keys.has(id))) });
  metadata.set('mine', { key: 'mine', value: (meta.mine || []).filter(id => keys.has(id)) });
  rows.meta = [...metadata.values()];
  const logs = JSON.parse(snapshot.prefs[logKey] || '{}');
  return { ...snapshot, rows, groups, prefs: { [logKey]: JSON.stringify(Object.fromEntries(Object.entries(logs).filter(([id]) => keys.has(id)))) } };
}
export function collectionGroups(snapshot, { nameOf, otherName }) {
  const docs = snapshot.rows.docs.map(r => r.value), meta = Object.fromEntries(snapshot.rows.meta.map(r => [r.key, r.value]));
  const byId = new Map(docs.map(d => [d.id, d]));
  const home = byId.get(meta.home), roots = new Set((home?.items || []).map(itemId));
  const used = new Set();
  const groups = docs.filter(d => d.kind === 'set' && d.id !== meta.home && roots.has(d.id)).map(set => {
    const ids = new Set([set.id]);
    const visit = id => {
      if (ids.has(id)) return;
      ids.add(id);
      const doc = byId.get(id);
      if (doc?.kind === 'set') doc.items.forEach(i => visit(itemId(i)));
    };
    set.items.forEach(i => visit(itemId(i)));
    for (const d of docs) if (d.kind === 'layer' && ids.has(d.on)) ids.add(d.id);
    ids.forEach(id => used.add(id));
    return { id: set.id, name: nameOf(set), records: Object.fromEntries(['docs', 'photos'].map(store => [store, snapshot.rows[store].filter(r => ids.has(r.key)).map(r => r.key)])) };
  });
  const extra = Object.fromEntries(['docs', 'photos'].map(store => [store, snapshot.rows[store].filter(r => !used.has(r.key) && r.key !== meta.home).map(r => r.key)]));
  extra.meta = snapshot.rows.meta.filter(r => !['home', 'mine', 'sources', 'collected', 'listed'].includes(r.key)).map(r => r.key);
  if (Object.values(extra).some(keys => keys.length)) groups.push({ id: 'local-extras', name: otherName, records: extra });
  return groups;
}

/** 先計算本地首頁、來源、擁有權及紀錄的合併結果，再交給同一筆復原交易。 */
export async function collectionRestorePlan(snapshot, selected, rows, { db, storage, logKey, check }) {
  const ids = new Set(selected.map(g => g.id)), oldMeta = Object.fromEntries(snapshot.rows.meta.map(r => [r.key, r.value]));
  const stores = ['docs', 'meta', 'photos'], t = db.transaction(stores, 'readonly');
  const current = Object.fromEntries(await Promise.all(stores.map(async name => {
    const store = t.objectStore(name), [keys, values] = await Promise.all([req(store.getAllKeys()), req(store.getAll())]);
    return [name, keys.map((key, i) => ({ key, value: values[i] }))];
  })));
  const docs = current.docs.map(r => r.value), meta = Object.fromEntries(current.meta.map(r => [r.key, r.value]));
  const currentGroups = collectionGroups({ rows: current }, { nameOf: d => d.id, otherName: '' });
  const deletes = Object.fromEntries(stores.map(name => {
    const protectedKeys = new Set(currentGroups.filter(g => !ids.has(g.id)).flatMap(g => g.records[name] || []));
    return [name, currentGroups.filter(g => ids.has(g.id)).flatMap(g => g.records[name] || []).filter(key => !protectedKeys.has(key))];
  }));
  const home = docs.find(d => d.id === meta.home);
  if (!home) throw new Error('找不到本地首頁');
  const sets = snapshot.rows.docs.filter(r => ids.has(r.key) && r.value.kind === 'set').map(r => r.value);
  const restoredIds = new Set(sets.map(s => s.id));
  rows.docs.push({ key: home.id, value: check({ ...home, items: [...home.items.filter(i => !restoredIds.has(itemId(i))), ...sets.map(s => ({ id: s.id, href: `${s.id}.json`, ...(s.name ? { name: s.name } : {}) }))], t: Date.now() }) });
  for (const key of ['sources', 'collected', 'listed']) {
    const next = { ...(meta[key] || {}) };
    for (const id of ids) { delete next[id]; if (Object.hasOwn(oldMeta[key] || {}, id)) next[id] = oldMeta[key][id]; }
    rows.meta.push({ key, value: next });
  }
  const restoredDocs = new Set([...rows.docs.map(r => r.key), ...(deletes.docs || [])]);
  rows.meta.push({ key: 'mine', value: [...new Set([...(meta.mine || []).filter(id => !restoredDocs.has(id)), ...(oldMeta.mine || []).filter(id => restoredDocs.has(id))])] });
  const logs = JSON.parse(snapshot.prefs[logKey] || '{}'), nextLogs = JSON.parse(storage.getItem(logKey) || '{}');
  for (const id of ids) { delete nextLogs[id]; if (Object.hasOwn(logs, id)) nextLogs[id] = logs[id]; }
  return { rows, prefs: { [logKey]: JSON.stringify(nextLogs) }, deletes };
}
