// Climbio 的雲端函式。儲存區用專案的預設儲存區；站台網域在 site.js
// cleanSnaps：每天清掉附近交換的過期資料、重建找牆面的岩館索引。
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onRequest } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { getFirestore } = require('firebase-admin/firestore');
admin.initializeApp();
const bucket = admin.storage().bucket();   // 專案的預設儲存區
const { HOSTS, ORIGINS, EMBED_ORIGINS } = require('./site');
const { createHandler: nearbyHandler, cleanNearby } = require('./nearby');
const { applyBudget, whenUploadsOn } = require('./budget');

// nearby：附近交換（見 nearby.js）：同一個網路的手機互相找到、轉送 WebRTC 連線訊息，資料不經過這裡；poll 會保持開著等變動，所以要 cpu: 1 才能設並行
exports.nearby = onRequest({ region: 'asia-east1', invoker: 'public', cors: ORIGINS, memory: '512MiB', cpu: 1, concurrency: 80, maxInstances: 5, timeoutSeconds: 70 }, nearbyHandler({ db: getFirestore('climbio') }));
// App Check：Climbio 網頁才拿得到的權杖（標頭 X-Firebase-AppCheck）；walls 的發佈、通報、寫線要它
const appChecked = async (req) => { try { await admin.appCheck().verifyToken(req.get('x-firebase-appcheck') || ''); return true; } catch (e) { return false; } };

const { updateGymWall, updateGymWallsOf, registerWall3d } = require('./gym-walls');
// walls：Climbio Studio 的 Wall 發佈到找牆面的索引、通報失效連結、刪牆、列出自己發佈的牆（見 walls.js）。照片和畫面在發佈的包裡（發佈者的 Google Drive），這裡只有索引和不公開的訓練副本。
const { defineSecret, defineString } = require('firebase-functions/params');
const { createHandler: wallsDatasetHandler, createHf } = require('./walls-dataset');
const { KINDS } = require('./crags-dataset');
const HF_TOKEN = defineSecret('HF_TOKEN');   // 開放資料集（climbio/walls、climbio/crags）的寫入權杖，只能寫那兩個倉庫
// STUDIO_KEY：Studio 同步金鑰（自架的人各自設定），只有擁有者的裝置和代理有；發佈時可以代替 App Check（命令列、無畫面瀏覽器拿不到 App Check）
const STUDIO_KEY = defineSecret('STUDIO_KEY');
// STUDIO_GITHUB_REPO：owner/repo，這個 repo 的協作者用自己的 GitHub 權杖（gh auth token）也算擁有者的代理；空的就只認金鑰（設定放 functions/.env.<專案 id>）
const STUDIO_GITHUB_REPO = defineString('STUDIO_GITHUB_REPO', { default: '' });
const { githubMember, ownerAuth } = require('./studio-sync');
let member;
const studioMember = (token) => (member ||= githubMember({ repo: STUDIO_GITHUB_REPO.value() }))(token);
const ownerKey = ownerAuth({ key: () => STUDIO_KEY.value(), member: studioMember });
const { createHandler: wallsHandler, expire: expireWalls } = require('./walls');
const { publishPublic } = require('./hf-public');
const wallsDb = getFirestore('climbio');
// 擁有者的同步金鑰（或協作者的 GitHub 權杖，標頭 X-Studio-Key）可以代替 App Check：代理（命令列）替岩館匯入路線、發佈時沒有網頁可以拿權杖；寫線仍要裝置金鑰簽章
// 公開牆的靜態資料（routes.json、index/world.json）寫進 Hugging Face：路線有變動就馬上寫（hf-public.js）
const hfWalls = createHf({ token: () => HF_TOKEN.value() });
const publishRoutes = pid => publishPublic({ db: wallsDb, hf: hfWalls, pid });
exports.walls = onRequest({ region: 'asia-east1', invoker: 'public', cors: [...ORIGINS, ...EMBED_ORIGINS], memory: '512MiB', maxInstances: 3, timeoutSeconds: 60, secrets: [STUDIO_KEY, HF_TOKEN] }, whenUploadsOn(wallsDb, wallsHandler({
  db: wallsDb,
  refreshGym: pid => updateGymWall({ db: wallsDb, pid }),
  publishRoutes,
  appChecked: async (req) => (await ownerKey(req)) || appChecked(req),
  isOwner: ownerKey,
})));
// datasets：公開的天然岩場、3D 牆、3D 岩場、岩點貓公開牆（檔案在開放資料集，這裡只有索引；Hosting 的 /p/{id}/{檔} 直接導向資料集，見 firebase.json、projects.js、walls-dataset.js）。
// 同一個函式：op publishWall 是公開牆（walls-dataset.js），其他是岩場、3D（projects.js）
const { createHandler: projectsHandler, writeWorld } = require('./projects');
const { buildWorldJson } = require('./world');
const { publishWorldIndex } = require('./hf-world');
const cragsHf = createHf({ token: () => HF_TOKEN.value(), repo: KINDS.guidebook.repo });
const saveWorld = () => writeWorld({ db: wallsDb, buildWorld: projects => buildWorldJson({ projects }), publishIndex: args => publishWorldIndex({ hf: cragsHf, ...args }), save: (path, data, cacheControl, opts = {}) => bucket.file(path).save(data, { contentType: 'application/json', resumable: false, gzip: !!opts.gzip, metadata: { cacheControl } }) });
const cragsHandler = projectsHandler({
  db: wallsDb,
  // 公開的岩場、3D 牆、3D 岩場放進各自的開放資料集（crags-dataset.js 的 KINDS）
  datasets: Object.fromEntries(Object.entries(KINDS).map(([type, k]) => [type, createHf({ token: () => HF_TOKEN.value(), repo: k.repo })])),
  saveWorld,
  registerWall: o => registerWall3d({ db: wallsDb, ...o }),
});
const wallsDataHandler = wallsDatasetHandler({ db: wallsDb, hf: createHf({ token: () => HF_TOKEN.value() }), refreshGyms: async project => {   // 現行版可能換了：gymWalls 重算，index 的 v 也跟著換
    await updateGymWallsOf({ db: wallsDb, project });
    for (const d of (await wallsDb.collection('gymWalls').where('src.project', '==', String(project)).get()).docs) await publishRoutes(d.id);
  } });
exports.datasets = onRequest({ region: 'asia-east1', invoker: 'public', cors: ORIGINS, memory: '512MiB', maxInstances: 3, timeoutSeconds: 120, secrets: [HF_TOKEN, STUDIO_KEY] },
  whenUploadsOn(wallsDb, async (req, res) => {
    // 會寫入的 op（準備上傳、發佈）要 App Check 權杖，或擁有者的同步金鑰（代理用）；files 是公開的唯讀查詢
    const op = req.body && req.body.op;
    if (req.method === 'POST' && op !== 'files' && !(await ownerKey(req)) && !(await appChecked(req))) return res.status(401).json({ error: 'app check' });
    return (op === 'publishWall' ? wallsDataHandler : cragsHandler)(req, res);
  }));
// 分享連結的預覽頁：/r/{照片編號}/{路線 id}/、/r/{照片編號}/、/p/{專案 id}（firebase.json 的 Hosting rewrites 轉過來，見 route-page.js）；只讀資料集，不查資料庫
const { createPageHandler } = require('./route-page');
exports.routePage = onRequest({ region: 'asia-east1', invoker: 'public', memory: '256MiB', maxInstances: 3 }, createPageHandler({ hosts: HOSTS }));
// studioSync：Studio 同步服務（見 studio-sync.js）：代理和收件匣共用的工作紀錄與檔案；只認同步金鑰（STUDIO_KEY），只有擁有者自己用
exports.studioSync = onRequest({ region: 'asia-east1', invoker: 'public', cors: true, memory: '512MiB', maxInstances: 2, timeoutSeconds: 120, secrets: [STUDIO_KEY] },
  require('./studio-sync').createHandler({ db: getFirestore('climbio'), bucket, key: () => STUDIO_KEY.value(), member: studioMember }));

// 超過預算就停止上傳（見 budget.js）：Cloud Billing 預算接到 Pub/Sub 主題 billing-budget
const { onMessagePublished } = require('firebase-functions/v2/pubsub');
exports.budgetGuard = onMessagePublished({ topic: 'billing-budget', region: 'asia-east1', maxInstances: 1 }, async event => {
  await applyBudget(getFirestore('climbio'), event.data.message.json, Date.now());
});

// 每天一個排程（凌晨 4:30），依序做完這幾件事；一件失敗不擋後面的，最後有失敗就丟錯讓排程標失敗：
//   1. 附近交換過期的房間與訊息（nearby.js）  2. 90 天沒動靜的公開牆下架（walls.js expire）
//   3. 紅點貓世界清單與 index 補寫一次（發佈時已寫過，這是保險；也會抓到 OpenClimbing 的更新）
//   4. 資料集的目錄路線數與統計 stats.json（dataset-export.js）
const { exportDataset, hubInfo } = require('./dataset-export');
exports.daily = onSchedule({ schedule: 'every day 04:30', timeZone: 'Asia/Taipei', region: 'asia-east1', secrets: [HF_TOKEN], memory: '512MiB', timeoutSeconds: 540 }, async () => {
  const token = () => HF_TOKEN.value(), failed = [];
  const step = async (name, f) => { try { const r = await f(); console.log('daily', name, r === undefined ? 'ok' : r); } catch (e) { console.error('daily', name, e); failed.push(name); } };
  await step('nearby', () => cleanNearby(getFirestore('climbio'), admin.firestore.Timestamp.now().toMillis()));
  await step('expireWalls', () => expireWalls({ db: wallsDb, refreshGym: pid => updateGymWall({ db: wallsDb, pid }), publishRoutes }));
  await step('world', saveWorld);
  await step('exportDataset', () => exportDataset({ db: wallsDb, hf: createHf({ token }), hub: hubInfo({ token }),
    others: Object.fromEntries(Object.values(KINDS).map(k => [k.name, { hf: createHf({ token, repo: k.repo }), index: k.index, hub: hubInfo({ token, repo: k.repo }) }])) }));
  if (failed.length) throw new Error(`daily 失敗：${failed.join('、')}`);
});
