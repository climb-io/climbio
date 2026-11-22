#!/usr/bin/env node
// 代理替岩館把路線寫進岩點貓的公開牆（雲端函式 walls 的 put／withdraw），用一把固定的「代發金鑰」簽章：
// 同一把金鑰發的線，同一把金鑰才能更新、刪除（別的金鑰回 taken）；每條線的 author 各自帶岩友暱稱，u 是固定的代發 id。
//   node tools/wall-routes.mjs keygen <金鑰檔>                        產生一把代發金鑰（不進版控；只印 kid）
//   node tools/wall-routes.mjs put <牆 id> <路線檔> --key <金鑰檔>    寫入或更新；路線檔 [{ id, name, grade: { v }, holds: { 岩點 id: 's'|'h'|'t' }, shapes?, author, t, u }]
//   node tools/wall-routes.mjs del <牆 id> <路線 id…> --key <金鑰檔>  刪除自己（這把金鑰）發的線
//   node tools/wall-routes.mjs unpublish <牆 id> [--key 發佈金鑰檔]    手動下架：拿掉找牆面的入口和所有人的線（擁有者的發佈金鑰或維護者；資料集已公開的檔案留著，重新用 Studio 發佈就回來）
//   node tools/wall-routes.mjs transfer <包 id> <新 kid> [--key 檔]    把牆的擁有者轉給新的發佈金鑰（岩館換 AI 代理；維護者可認領沒有擁有者的舊牆）
//   node tools/wall-routes.mjs kid --key <檔>                          印出金鑰檔的 kid
//   node tools/wall-routes.mjs claim-all <新 kid>                     維護者一次認領目錄裡所有牆（上線擁有者檢查時用）
// 沒有網頁可以拿 App Check 權杖，用擁有者身分代替（CLIMBIO_STUDIO_KEY，或本機 gh 登入且是 repo 協作者；tools/studio-auth.mjs）。
// 全部會自己結束：每個網路請求 60 秒逾時；失敗以非 0 結束並印出原因。
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { generateKeyPairSync, createHash, createPrivateKey, randomBytes, sign } from 'node:crypto';
import { studioAuth } from './studio-auth.mjs';
import { createService } from '../studio/service.js';
import { loadKey, signerFor } from './publisher-auth.mjs';

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

async function baseOf(pid) {
  const { data: st } = await get(`${SITE}/w/${pid}/shared.json`);
  if (!st.published || !st.src) die(`牆 ${pid} 不是公開牆`);
  const layerUrl = `${SITE}/p/${st.src.project}/${st.src.path}`, { data: layer } = await get(layerUrl);   // 相對網址照 /p/ 的位置解（轉址後的網址路徑不同）
  const { data: view } = await get(new URL(layer.href, layerUrl).href);
  return RK.fromFormat(view, []);   // { w, h, holds }
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
} else if (cmd === 'unpublish' || cmd === 'transfer' || cmd === 'kid') {
  // 公開牆的擁有者操作：發佈金鑰（--key，預設 ~/.climbio/publisher-key.json）簽章，或維護者身分（不給 --key 時只用維護者）
  if (cmd === 'kid') { console.log(loadKey(keyFile || undefined, { create: false }).kid); process.exit(0); }
  const auth0 = studioAuth(), key = keyFile ? loadKey(keyFile, { create: false }) : null;
  if (!key && !auth0.key) die('要擁有者身分：--key <發佈金鑰檔>，或維護者身分（CLIMBIO_STUDIO_KEY／gh auth login）');
  const svc = createService({ url: DATASETS, studioKey: async () => auth0.key, sign: key ? signerFor(key) : null });
  try {
    if (cmd === 'unpublish') {
      const [pid] = rest; if (!pid) die('用法：unpublish <牆 id> [--key <發佈金鑰檔>]');
      const j = await svc.unpublishWall(pid); console.log(j.removed ? `已下架 ${pid}` : `${pid} 本來就沒有公開`);
    } else {
      const [id, newKid] = rest; if (!id || !newKid) die('用法：transfer <包 id> <新 kid> [--key <現在擁有者的發佈金鑰檔>]（維護者可認領沒有擁有者的舊牆）');
      const j = await svc.transferWall(id, newKid); console.log(`${j.id} 的擁有者現在是 ${j.owner}`);
    }
  } catch (e) { die(`失敗：${e.status || ''} ${e.message}`); }
} else if (cmd === 'claim-all') {
  // 維護者一次認領所有還沒有擁有者的舊牆（上線擁有者檢查時用：不然下一個發佈的人會變成擁有者）；已經有擁有者的牆，維護者轉交會改掉擁有者，所以先只看目錄裡的牆
  const [newKid] = rest; if (!newKid) die('用法：claim-all <新 kid>（維護者身分）');
  const auth0 = studioAuth(); if (!auth0.key) die('要維護者身分：CLIMBIO_STUDIO_KEY 或 gh auth login');
  const svc = createService({ url: DATASETS, studioKey: async () => auth0.key });
  const text = await (await get('https://huggingface.co/datasets/climbio/walls/resolve/main/walls.jsonl', false)).text();
  const ids = text.split(String.fromCharCode(10)).filter(Boolean).map(l => JSON.parse(l).id);
  let ok = 0;
  for (const id of ids) { try { await svc.transferWall(id, newKid); ok++; console.log(`認領 ${id}`); } catch (e) { console.error(`${id}：${e.status || ''} ${e.message}`); } }
  console.log(`${ok}/${ids.length} 面牆的擁有者是 ${newKid}`); if (ok < ids.length) process.exit(1);
} else die('用法：keygen | put | del | unpublish | transfer | kid | claim-all（見檔案開頭）');
