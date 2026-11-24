import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// wall-batch.mjs publish：岩館金鑰簽章，直接發佈。跟伺服器的 publishWall（functions/walls-dataset.js）接起來跑一遍，確認簽章的內容兩邊一致
const require = createRequire(import.meta.url);
const { createHandler } = require('../functions/walls-dataset.js');
const CLI = fileURLToPath(new URL('./wall-batch.mjs', import.meta.url)), VIEW = 'a1b2c3d4e5f60718', PACK = '0123456789abcdef';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const sq = (x, y, s = 40) => [[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]];

function work() {
  const dir = mkdtempSync(join(tmpdir(), 'wall-pub-')), pack = join(dir, 'w1', 'pack');
  mkdirSync(pack, { recursive: true });
  writeFileSync(join(dir, 'w1', 'run.json'), '{}'); writeFileSync(join(dir, 'w1', 'result.json'), '{}');
  writeFileSync(join(pack, 'index.json'), JSON.stringify({ climbio: 2, kind: 'set', type: 'walls', id: PACK, name: '主牆' }));
  const hs = [0, 1, 2].map(i => [`h${i}`, sq(20 + i * 60, 40)]);
  writeFileSync(join(pack, `${VIEW}.json`), JSON.stringify({ climbio: 2, kind: 'view', surface: 'photo', id: VIEW, name: '主牆', w: 640, h: 480,
    nodes: hs.map(([id]) => ({ id, type: 'hold' })), marks: hs.map(([id, p]) => ({ node: id, geometry: { type: 'Polygon', coordinates: [p] } })) }));
  writeFileSync(join(pack, `${VIEW}.jpg`), JPEG);
  return dir;
}
// 伺服器：真的 publishWall，資料庫和資料集換成記憶體
function server() {
  const docs = new Map(), commits = [];
  const snap = v => ({ exists: v !== undefined, get: k => (v || {})[k] });
  const db = { collection: c => ({ doc: id => ({ get: async () => snap(docs.get(`${c}/${id}`)), set: async v => { docs.set(`${c}/${id}`, structuredClone(v)); } }) }) };
  const hf = { read: async () => null, commit: async (summary, fs) => { commits.push(summary); } };
  const handler = createHandler({ db, hf });
  const http = createServer((req, res) => {
    let raw = ''; req.on('data', c => { raw += c; }); req.on('end', async () => {
      const r = { statusCode: 200, set() { return this; }, status(c) { this.statusCode = c; return this; }, json(d) { res.writeHead(this.statusCode, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); return this; } };
      await handler({ method: req.method, body: raw ? JSON.parse(raw) : {}, get: () => '1.1.1.1' }, r);
    });
  });
  return { http, docs, commits };
}
const run = (args, env) => new Promise(resolve => { const p = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...env }, windowsHide: true }); let out = '', err = ''; p.stdout.on('data', d => { out += d; }); p.stderr.on('data', d => { err += d; }); p.on('close', status => resolve({ status, out, err })); });

test('publish：岩館金鑰簽章，伺服器驗得過、發佈成新版本並記下 kid；沒給金鑰、牆沒過 verify 都不發', async () => {
  const dir = work(), keyFile = join(dir, 'gym-key.json'), s = server();
  await new Promise(r => s.http.listen(0, '127.0.0.1', r));
  const env = { CLIMBIO_PUBLISH_URL: `http://127.0.0.1:${s.http.address().port}/` };
  try {
    const kg = spawnSync(process.execPath, [fileURLToPath(new URL('./wall-routes.mjs', import.meta.url)), 'keygen', keyFile], { encoding: 'utf8', windowsHide: true });
    assert.equal(kg.status, 0, kg.stderr);
    const noKey = await run(['publish', dir, '--gym', '測試館'], env);
    assert.notEqual(noKey.status, 0); assert.match(noKey.err, /--key/);
    const r = await run(['publish', dir, '--gym', '測試館', '--key', keyFile], env);
    assert.equal(r.status, 0, r.err);
    assert.match(r.out, new RegExp(`wallId ${PACK}/${VIEW}`)); assert.match(r.out, /第 1 版/);
    const doc = s.docs.get(`datasets/${PACK}`);
    assert.deepEqual([doc.type, doc.version, /^[0-9a-f]{32}$/.test(doc.kid)], ['walls', 1, true]);
    assert.match(s.commits[0], /金鑰/);
    const again = await run(['publish', dir, '--gym', '測試館', '--key', keyFile], env);   // 內容一樣：伺服器回 same，不新增版本
    assert.equal(again.status, 0, again.err); assert.match(again.out, /沒有新版本/);
    assert.equal(s.commits.length, 1);
  } finally { s.http.close(); rmSync(dir, { recursive: true, force: true }); }
});
