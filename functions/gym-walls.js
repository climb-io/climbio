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
  // 3D 牆（Studio 發佈，type wall3d）跟公開牆同一套清單：資料夾直接用資料集索引的 hf.dir（不分版本），m3d 標出是 3D、repo 是它的資料集倉庫
  const m3d = ds.get('type') === 'wall3d', hf = ds.get('hf') || {};
  const v = { gym, name: String(wall.get('name') || '').slice(0, 60), n: own.length, t: Math.max(Number(wall.get('activeAt')) || 0, Number(wall.get('publishedAt')) || 0, ...own.map(x => x.t || 0)),
    src: { project: String(s.project), path: String(s.path) }, hf: m3d ? String(hf.dir || '') : `walls/${s.project}/v${ds.get('version')}/`, ...(m3d ? { m3d: 1, repo: String(hf.repo || 'walls3d') } : {}) };
  await ref.set(v);
  await refreshGymIndex(db, [gym, old.exists ? old.get('gym') : '']);
  return v;
}

// 資料集的包發佈了新版本（現行版可能換了）：用到這個包的公開牆重算，清單才會指到現行版，不是停在收進清單時的那一版
async function updateGymWallsOf({ db, project }) {
  const q = await db.collection('gymWalls').where('src.project', '==', String(project)).get();
  for (const d of q.docs) await updateGymWall({ db, pid: d.id });
}

// Studio 發佈 3D 牆：登記到公開牆的清單（shared/{牆 id}，牆 id＝專案 id）。同一面牆（root）的舊版本拿掉入口，清單每面牆只列最新發佈的那一版；沒有岩館的不登記
async function registerWall3d({ db, id, name, gym, root, now = Date.now }) {
  if (!gym) return;
  const olds = (await db.collection('shared').where('root', '==', root).get()).docs.filter(d => d.id !== id && d.get('src'));
  for (const d of olds) await db.collection('shared').doc(d.id).set({ name: d.get('name') || '' });
  await db.collection('shared').doc(id).set({ name: String(name).slice(0, 60), gym, src: { project: id, path: 'index.json' }, root, publishedAt: now(), activeAt: now() });
  for (const pid of [...olds.map(d => d.id), id]) await updateGymWall({ db, pid });
}

module.exports = { updateGymWall, updateGymWallsOf, dropGymWall, registerWall3d };
