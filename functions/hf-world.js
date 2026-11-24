// 紅點貓的公開資料（Hugging Face 的 climbio/crags，客戶端直接讀固定網址，不經過函式）：
//   index/redpoint.json        進 App 只讀這一個：{ climbio: 2, kind: 'index', t, world: { v }, projects: [世界清單的每個專案：id、type、name、t、url、preview…] }
//                              projects 就是原本 public/projects.json 的內容（url 本來就直接指到資料集）；本機收下的岩場比 t（版本），新的才另外讀
//   index/world.<v>.json       世界的三層樹（國家 → 地區 → 岩場，world-data.mjs 合成），v＝內容雜湊前 12 碼：網址帶版本、永遠不變，world.v 變了才重讀
// 發佈、下架之後和每天排程（writeWorld）重寫；內容沒變（清單和世界都一樣）不 commit。衝突（別的 commit 先進去了）用 parentCommit 重讀重寫。
const { createHash } = require('node:crypto');

const INDEX = 'index/redpoint.json', WORLD = (v) => `index/world.${v}.json`, WORLD_RE = /^index\/world\.[0-9a-f]{12}\.json$/;
const vOf = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12);
const sameList = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function readJson(hf, path) { try { return JSON.parse(await hf.read(path)); } catch (e) { return null; } }

/** projects：listPublic 的結果；world：這次合成的世界檔（JSON 字串，合成失敗是 null：沿用上一份的 world.v）。回 { changed } */
async function publishWorldIndex({ hf, projects, world = null, now = Date.now, tries = 4 }) {
  for (let i = 0; ; i++) {
    const parent = await hf.head(), old = await readJson(hf, INDEX), v = world ? vOf(world) : old && old.world && old.world.v;
    if (!v) return { changed: false };   // 還沒有世界檔、這次也合成不出來：不寫（客戶端會退回在手機上合成）
    if (old && old.world && old.world.v === v && sameList(old.projects, projects)) return { changed: false };
    // 世界檔換了：新的放進去，舊的只留上一份（正在讀舊 index 的人還拿得到）；一樣就不重寫
    const files = [];
    const have = new Set((await hf.tree('index').catch(() => [])).map(f => f.path));
    if (world && !have.has(WORLD(v))) files.push({ path: WORLD(v), bytes: Buffer.from(world) });
    const keep = new Set([WORLD(v), old && old.world && WORLD(old.world.v)]);
    for (const p of have) if (WORLD_RE.test(p) && !keep.has(p)) files.push({ path: p, deleted: true });
    files.push({ path: INDEX, bytes: Buffer.from(JSON.stringify({ climbio: 2, kind: 'index', t: now(), world: { v }, projects })) });
    try { await hf.commit('紅點貓的 index', files, { parentCommit: parent }); return { changed: true }; }
    catch (e) { if (!e.conflict || i >= tries - 1) throw e; }
  }
}

module.exports = { INDEX, WORLD, WORLD_RE, vOf, publishWorldIndex };
