const { FieldValue } = require('firebase-admin/firestore');

// 岩館的公開牆面清單 gymWalls/{牆 id}：公開牆發佈、改線、收回、過期之後整理（只有 Admin SDK 寫，App 只讀）。
// { gym, name, n: 公開路線數（wallRoutes/{牆 id} 裡的線）, t: 最後活動時間（毫秒）, src: { project, path }, hf: 資料集裡的資料夾 }；
// 只列公開的牆：shared/{牆 id} 有 src（發佈的包在 datasets）、有岩館、資料集的包還在。名稱用 shared 文件的。
// 有牆的岩館索引 gymIndex/all：{ gyms: { 岩館: { n: 公開牆面數, t: 最新時間 } } }，找牆面進來只讀這一筆，沒有牆的岩館不在裡面。
// 牆面清單變動時重算受影響的岩館（各一次 count＋最新一筆）；每日清理整份重建，漏掉的也補得回來
async function refreshGymIndex(db, gyms) {
  const col = db.collection('gymWalls'), out = {};
  for (const g of new Set(gyms.filter(Boolean))) {
    const q = col.where('gym', '==', g);
    const [c, last] = await Promise.all([q.count().get(), q.orderBy('t', 'desc').limit(1).get()]);
    out[g] = c.data().count ? { n: c.data().count, t: last.docs[0].get('t') } : FieldValue.delete();
  }
  if (Object.keys(out).length) await db.collection('gymIndex').doc('all').set({ gyms: out }, { merge: true });
}
async function rebuildGymIndex(db) {
  const gyms = {};
  for (const d of (await db.collection('gymWalls').select('gym', 't').get()).docs) {
    const g = d.get('gym'), t = d.get('t'), x = gyms[g] || (gyms[g] = { n: 0, t: 0 });
    x.n++; x.t = Math.max(x.t, t);
  }
  await db.collection('gymIndex').doc('all').set({ gyms });
}
async function dropGymWall(db, pid) {
  const ref = db.collection('gymWalls').doc(pid), old = await ref.get();
  await ref.delete();
  if (old.exists) await refreshGymIndex(db, [old.get('gym')]);
}
async function updateGymWall({ db, pid }) {
  const ref = db.collection('gymWalls').doc(pid);
  const [old, wall, routes] = await Promise.all([ref.get(), db.collection('shared').doc(pid).get(), db.collection('wallRoutes').doc(pid).get()]);
  const gym = wall.exists ? String(wall.get('gym') || '') : '', s = wall.exists && wall.get('src');
  const ds = gym && s ? await db.collection('datasets').doc(String(s.project)).get() : null;
  if (!ds || !ds.exists) { await dropGymWall(db, pid); return null; }
  const own = routes.exists ? Object.values(routes.get('routes') || {}) : [];
  const v = { gym, name: String(wall.get('name') || '').slice(0, 60), n: own.length, t: Math.max(Number(wall.get('activeAt')) || 0, Number(wall.get('publishedAt')) || 0, ...own.map(x => x.t || 0)),
    src: { project: String(s.project), path: String(s.path) }, hf: `walls/${s.project}/v${ds.get('version')}/` };
  await ref.set(v);
  await refreshGymIndex(db, [gym, old.exists ? old.get('gym') : '']);
  return v;
}

module.exports = { updateGymWall, dropGymWall, rebuildGymIndex };
