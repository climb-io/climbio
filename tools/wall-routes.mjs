#!/usr/bin/env node
// 代理替岩館把路線寫進岩點貓的公開牆（雲端函式 walls 的 put／withdraw），用一把固定的「代發金鑰」簽章：
// 同一把金鑰發的線，同一把金鑰才能更新、刪除（別的金鑰回 taken）；每條線的 author 各自帶岩友暱稱，u 是固定的代發 id。
//   node tools/wall-routes.mjs keygen <金鑰檔>                        產生一把代發金鑰（不進版控；只印 kid）
//   node tools/wall-routes.mjs put <牆 id> <路線檔> --key <金鑰檔>    寫入或更新；路線檔 [{ id, name, grade: { v }, holds: { 岩點 id: 's'|'h'|'t' }, shapes?, author, t, u }]
//   node tools/wall-routes.mjs del <牆 id> <路線 id…> --key <金鑰檔>  刪除自己（這把金鑰）發的線
//   node tools/wall-routes.mjs unpublish <牆 id>                       手動下架（只有維護者身分）：拿掉找牆面的入口和所有人的線；資料集已公開的檔案留著，重新用 Studio 發佈同一個牆 id 就回來
// 沒有網頁可以拿 App Check 權杖，用擁有者身分代替（CLIMBIO_STUDIO_KEY，或本機 gh 登入且是 repo 協作者；tools/studio-auth.mjs）。
// 全部會自己結束：每個網路請求 60 秒逾時；失敗以非 0 結束並印出原因。
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { generateKeyPairSync, createHash, createPrivateKey, randomBytes, sign } from 'node:crypto';
import { studioAuth } from './studio-auth.mjs';
import { createService } from '../studio/service.js';

const require = createRequire(import.meta.url);
const RK = require('../routekit/format.js');
const { message, kidOf } = require('../functions/device-key.js');

const SITE = process.env.CLIMBIO_SITE || 'https://climbio.app';
const DATASETS = process.env.CLIMBIO_PUBLISH_URL || 'https://asia-east1-firebase-climbio.cloudfunctions.net/datasets';
const FN = process.env.CLIMBIO_WALLS_URL || 'https://asia-east1-firebase-climbio.cloudfunctions.net/walls';
const die = (m) => { console.error(m); process.exit(1); };
const get = async (url, json = true) => { const r = await fetch(url, { signal: AbortSignal.timeout(60000), redirect: 'follow' }); if (!r.ok) die(`讀 ${url} 失敗：${r.status}`); return json ? { data: await r.json(), url: r.url } : r; };

function keygen(file) {
  if (!file) die('用法：keygen <金鑰檔>');
  if (existsSync(file)) die(`${file} 已經存在，不覆蓋`);
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const pub = publicKey.export({ format: 'jwk' }), priv = privateKey.export({ format: 'jwk' });
  writeFileSync(file, JSON.stringify({ kid: kidOf(pub), pub: { kty: 'EC', crv: 'P-256', x: pub.x, y: pub.y }, priv }), { mode: 0o600 });
  console.log(`代發金鑰 kid=${kidOf(pub)}（${file}，請存在版控外、備份）`);
}

// 牆 id ＝ 照片編號（畫面的 id），不是資料集的包 id：路線登記在照片編號，用包 id 寫會另開一面沒有岩點的空牆。
// 畫面直接讀資料集的現行版（App 也是讀這裡；/w/<id>/shared.json 已不是 App 讀的檔，線上可能是 404）。
async function baseOf(pid) {
  const st = await (await fetch(FN, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'routes', pid }), signal: AbortSignal.timeout(60000) })).json();
  if (!st.published || !st.src) die(`牆 ${pid} 不是公開牆（路線登記在照片編號；包 id 不是牆 id，查畫面檔 <照片編號>.json 的 id）`);
  const dir = `https://huggingface.co/datasets/climbio/walls/resolve/main/walls/${st.src.project}/current/`, bust = `?x=${Date.now()}`;
  const { data: layer } = await get(`${dir}${st.src.path}${bust}`);
  const { data: view } = await get(`${dir}${layer.href.split('/').pop()}${bust}`);
  if (view.id !== pid) die(`${pid} 不是這面牆的照片編號（畫面的 id 是 ${view.id}）：路線要用 ${view.id} 當牆 id`);
  const retired = new Set(view.nodes.filter(n => n.type === 'hold' && n.props && n.props.retired).map(n => n.id));
  return { ...RK.fromFormat(view, []), retired };   // { w, h, holds, retired }；停用的岩點路線不能用（put 會擋）
}

async function call(op, pid, keyFile, fields) {
  const k = JSON.parse(readFileSync(keyFile, 'utf8')), auth0 = studioAuth();
  if (!auth0.key) die('沒有擁有者身分：設 CLIMBIO_STUDIO_KEY，或 gh auth login（帳號要是 repo 的協作者）');
  const body = { pid, ...fields }, ts = Date.now(), nonce = randomBytes(12).toString('base64url');
  body.auth = { kid: k.kid, pub: k.pub, ts, nonce };
  const sig = sign('sha256', Buffer.from(message(op, body)), { key: createPrivateKey({ key: k.priv, format: 'jwk' }), dsaEncoding: 'ieee-p1363' });
  body.auth.sig = sig.toString('base64url');
  const r = await fetch(FN, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio-Key': auth0.key }, body: JSON.stringify({ op, ...body }), signal: AbortSignal.timeout(60000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) die(`${op} 失敗：${r.status} ${j.error || ''}`);
  return j;
}

const [cmd, ...rest] = process.argv.slice(2);
const flag = (n) => { const i = rest.indexOf(n); if (i < 0) return ''; const v = rest[i + 1]; rest.splice(i, 2); return v; };
const keyFile = flag('--key');
if (cmd === 'keygen') keygen(rest[0]);
else if (cmd === 'put') {
  const [pid, file] = rest; if (!pid || !file || !keyFile) die('用法：put <牆 id> <路線檔> --key <金鑰檔>');
  const routes = JSON.parse(readFileSync(file, 'utf8')), b = await baseOf(pid), all = [];
  for (const x of routes) {
    const dead = Object.keys(x.holds || {}).filter(h => b.retired.has(h) || !b.holds.some(k => k.id === h));
    if (dead.length) die(`路線「${x.name || x.id}」用到不存在或已停用的岩點：${dead.join('、')}（先在牆的新版本改回有效，或換掉這些點）`);
    const l = RK.routesLayer({ id: pid, pid, href: `${pid}.json`, w: b.w, h: b.h, holds: b.holds, routes: [x], t: 0 });
    all.push({ id: x.id, r: JSON.stringify({ nodes: l.nodes, marks: l.marks }) });
  }
  let bad = 0;
  for (let i = 0; i < all.length; i += 100) {
    const out = await call('put', pid, keyFile, { routes: all.slice(i, i + 100) });
    for (const [id, v] of Object.entries(out.results)) if (v !== 'ok') { bad++; console.error(`${id}：${v}`); }
  }
  console.log(`${all.length - bad}/${all.length} 條已寫入牆 ${pid}`); if (bad) process.exit(1);
} else if (cmd === 'del') {
  const [pid, ...ids] = rest; if (!pid || !ids.length || !keyFile) die('用法：del <牆 id> <路線 id…> --key <金鑰檔>');
  const out = await call('put', pid, keyFile, { del: ids });
  console.log(JSON.stringify(out.results));
} else if (cmd === 'unpublish') {
  // 只有維護者身分（CLIMBIO_STUDIO_KEY，或本機 gh 登入且是 repo 協作者）
  const auth0 = studioAuth(), [pid] = rest;
  if (!pid) die('用法：unpublish <牆 id>');
  if (!auth0.key) die('要維護者身分：CLIMBIO_STUDIO_KEY 或 gh auth login');
  try { const j = await createService({ url: DATASETS, studioKey: async () => auth0.key }).unpublishWall(pid); console.log(j.removed ? `已下架 ${pid}` : `${pid} 本來就沒有公開`); }
  catch (e) { die(`失敗：${e.status || ''} ${e.message}`); }
} else die('用法：keygen | put | del | unpublish（見檔案開頭）');
