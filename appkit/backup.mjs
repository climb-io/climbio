// 手動備份：本機快照與復原，備份是使用者自己存的 .climbio 檔（gzip），不需要帳號。
const request = r => new Promise((ok, bad) => { r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error); });
const complete = t => new Promise((ok, bad) => { t.oncomplete = ok; t.onabort = t.onerror = () => bad(t.error || new Error('資料寫入失敗')); });
const binaryTypes = { Uint8Array, Uint8ClampedArray, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array, DataView };
async function encode(v) {
  if (v instanceof Blob) return ['blob', v.type, await encode(await v.arrayBuffer())];
  if (v instanceof ArrayBuffer) {
    let s = ''; const bytes = new Uint8Array(v);
    for (let i = 0; i < bytes.length; i += 16384) s += String.fromCharCode(...bytes.subarray(i, i + 16384));
    return ['bytes', btoa(s)];
  }
  if (ArrayBuffer.isView(v)) return ['typed', v.constructor.name, await encode(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength))];
  if (v === undefined) return ['undefined'];
  if (v instanceof Date) return ['date', v.toISOString()];
  if (Array.isArray(v)) return ['array', await Promise.all(v.map(encode))];
  if (v && typeof v === 'object') return ['object', await Promise.all(Object.entries(v).map(async ([k, x]) => [k, await encode(x)]))];
  return ['value', v];
}
function decode(v) {
  if (!Array.isArray(v)) throw new Error('備份內容不完整');
  switch (v[0]) {
    case 'value': return v[1];
    case 'undefined': return undefined;
    case 'date': return new Date(v[1]);
    case 'bytes': return Uint8Array.from(atob(v[1]), c => c.charCodeAt(0)).buffer;
    case 'blob': return new Blob([decode(v[2])], { type: v[1] });
    case 'typed': { const Type = binaryTypes[v[1]]; if (!Type) throw new Error('不支援的二進位資料'); return new Type(decode(v[2])); }
    case 'array': return v[1].map(decode);
    case 'object': return Object.fromEntries(v[1].map(([k, x]) => [k, decode(x)]));
    default: throw new Error('備份格式不正確');
  }
}

/** 同一筆唯讀交易擷取資料，避免照片和路線來自不同時間。groups 只描述選擇性復原的範圍。 */
export async function capture({ app, db, stores, preferences, storage, groups = [] }) {
  const t = db.transaction(stores, 'readonly'), finished = complete(t);
  const rows = Object.fromEntries(await Promise.all(stores.map(async name => {
    const s = t.objectStore(name), [keys, values] = await Promise.all([request(s.getAllKeys()), request(s.getAll())]);
    return [name, keys.map((key, i) => ({ key, value: values[i] }))];
  })));
  await finished;
  const keys = typeof preferences === 'function' ? Object.keys(storage).filter(preferences) : preferences;
  const prefs = Object.fromEntries(keys.map(k => [k, storage.getItem(k)]));
  return { format: 'climbio-backup', version: 1, app, created: Date.now(), rows, prefs, groups };
}

export async function packBackup(snapshot) {
  const json = new Blob([JSON.stringify(await encode(snapshot))]);
  return new Response(json.stream().pipeThrough(new CompressionStream('gzip'))).blob();
}

export async function readBackup(blob, { app, stores, preferences }) {
  const json = await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).json();
  const s = decode(json);
  if (s.format !== 'climbio-backup' || s.version !== 1 || s.app !== app || !s.rows || !s.prefs || !Array.isArray(s.groups)) throw new Error('這不是此 App 的備份檔');
  if (Object.keys(s.rows).some(k => !stores.includes(k)) || stores.some(k => !Array.isArray(s.rows[k])) || Object.keys(s.prefs).some(k => !(typeof preferences === 'function' ? preferences(k) : preferences.includes(k)))) throw new Error('備份的資料範圍不正確');
  for (const rows of Object.values(s.rows)) for (const r of rows) if (!r || !Object.hasOwn(r, 'key') || !Object.hasOwn(r, 'value')) throw new Error('備份資料不完整');
  const ids = new Set();
  for (const g of s.groups) {
    if (!g || typeof g.id !== 'string' || typeof g.name !== 'string' || ids.has(g.id) || !g.records || Object.entries(g.records).some(([k, v]) => !stores.includes(k) || !Array.isArray(v))) throw new Error('備份的岩場清單不正確');
    ids.add(g.id);
  }
  return s;
}

/** 全部復原以單一交易取代；選擇性復原只寫入勾選群組，保留其他群組。 */
export async function restoreBackup(s, { db, stores, preferences, storage, ids = null, prepare = x => x, prepareRestore }) {
  const selected = ids === null ? null : s.groups.filter(g => ids.includes(g.id));
  if (selected && selected.length !== new Set(ids).size) throw new Error('找不到勾選的資料');
  let rows = Object.fromEntries(stores.map(name => {
    // 複合鍵要比內容；每個 store 建一次索引，避免大型備份逐筆掃描整份清單。
    const keys = selected && new Set(selected.flatMap(g => (g.records[name] || []).map(k => JSON.stringify(k))));
    return [name, s.rows[name].filter(r => !keys || keys.has(JSON.stringify(r.key)))];
  }));
  let prefs = selected ? {} : Object.fromEntries([...new Set([...Object.keys(s.prefs), ...Object.keys(storage).filter(k => typeof preferences === 'function' ? preferences(k) : preferences.includes(k))])].map(k => [k, s.prefs[k] ?? null]));
  let deletes = {};
  if (prepareRestore) ({ rows, prefs, deletes = {} } = await prepareRestore(s, selected, rows, { db, storage }));
  // 在開交易前先驗證、準備所有資料；驗證失敗不會清除現有內容。
  for (const name of stores) rows[name] = rows[name].map(r => ({ ...r, value: prepare(r.value, name) }));
  const previousPrefs = Object.fromEntries(Object.keys(prefs).map(k => [k, storage.getItem(k)]));
  const writePrefs = values => { for (const [k, v] of Object.entries(values)) v == null ? storage.removeItem(k) : storage.setItem(k, v); };
  const t = db.transaction(stores, 'readwrite'), finished = complete(t);
  try {
    for (const name of stores) {
      const store = t.objectStore(name);
      if (!selected) store.clear();
      else for (const key of deletes[name] || []) store.delete(key);
      for (const r of rows[name]) store.keyPath === null ? store.put(r.value, r.key) : store.put(r.value);
    }
    writePrefs(prefs);
  } catch (e) { t.abort(); await finished.catch(() => {}); writePrefs(previousPrefs); throw e; }
  try { await finished; } catch (e) { writePrefs(previousPrefs); throw e; }
  return selected;
}
