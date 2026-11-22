#!/usr/bin/env node
// 牆的分享包（index.json 的 type 是 walls）的岩點：AI 代理不開 Studio 也能看、能改，改完用 tools/studio.mjs publish 發佈（同一個包的新版本）。
// 跟 Studio Wall 的編輯器改的是同一份資料（照片畫面的 hold 節點與外框標註），規則一樣：已公開的岩點拿掉＝停用。
//
//   node tools/wall.mjs holds <包資料夾> [--json]       每面牆的岩點：id、外接框（照片像素 x0,y0,x1,y1）、來源、停用
//   node tools/wall.mjs apply <包資料夾> <patch.json>    改岩點；改完每份過格式驗證才寫入
//
// patch.json：一個陣列，依序做（view 是照片畫面的 id；包裡只有一面牆時可以省略）：
//   { "op": "remove", "view": …, "holds": [id…] }            拿掉：停用（留在畫面裡、標 retired，別人的舊路線還指得到，新路線看不到）
//   { "op": "restore", "view": …, "holds": [id…] }           停用的拿回來
//   { "op": "add", "view": …, "poly": [[x, y]…], "id"?: … }  新增一顆（照片像素，至少三點，來源記 manual）；印出 id
//   { "op": "set", "view": …, "id": 岩點 id, "poly": [[x, y]…] }   換外框（來源記 edited）
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';

const { validate } = createRequire(import.meta.url)('../format/format.js');
const args = process.argv.slice(2);
const has = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const fail = (msg, code = 2) => { console.error(msg); process.exit(code); };
const ID = /^[0-9a-z][0-9a-z_-]{0,63}$/;
const newId = () => [...randomBytes(12)].map(b => '0123456789abcdefghijklmnopqrstuvwxyz'[b % 36]).join('');

/** 包：入口（walls 組合）與它列出的照片畫面 */
function loadPack(dir) {
  const entry = join(dir, 'index.json');
  if (!existsSync(entry)) fail(`${dir} 沒有 index.json`);
  const index = JSON.parse(readFileSync(entry, 'utf8'));
  if (index.type !== 'walls') fail(`${dir} 不是牆的分享包（index.json 的 type 是 ${index.type}）`);
  const docs = new Map();
  for (const it of index.items || []) {
    const f = join(dir, it.href);
    if (it.href?.endsWith('.json') && existsSync(f)) docs.set(it.href, JSON.parse(readFileSync(f, 'utf8')));
  }
  // 入口通常指到路線圖層，圖層的 href 指到照片畫面
  for (const d of [...docs.values()]) if (d.kind === 'layer' && d.href && !docs.has(d.href) && existsSync(join(dir, d.href))) docs.set(d.href, JSON.parse(readFileSync(join(dir, d.href), 'utf8')));
  const views = [...docs].filter(([, d]) => d.surface === 'photo');
  if (!views.length) fail(`${dir} 裡沒有照片畫面`);
  return { docs, views };
}
const bbox = (ring) => { const xs = ring.map(p => p[0]), ys = ring.map(p => p[1]); return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].map(v => Math.round(v)); };
const holdsOf = (v) => (v.nodes || []).filter(n => n.type === 'hold').map(n => ({ id: n.id, box: bbox(v.marks.find(m => m.node === n.id)?.geometry.coordinates[0] || [[0, 0]]), source: n.props?.source || '', retired: !!n.props?.retired }));

function holds(dir, json) {
  const { views } = loadPack(dir);
  const out = views.map(([path, v]) => ({ view: v.id, path, w: v.w, h: v.h, holds: holdsOf(v) }));
  if (json) { console.log(JSON.stringify(out, null, 1)); return true; }
  for (const v of out) {
    const live = v.holds.filter(h => !h.retired);
    console.log(`${v.view}（${v.path}，${v.w}×${v.h}）：${live.length} 顆${v.holds.length > live.length ? `，停用 ${v.holds.length - live.length} 顆` : ''}`);
    for (const h of v.holds) console.log(`  ${h.id}\t${h.box.join(',')}\t${h.source}${h.retired ? '\t停用' : ''}`);
  }
  return true;
}

function apply(dir, patchFile) {
  if (!dir || !patchFile) fail('用法：node tools/wall.mjs apply <包資料夾> <patch.json>');
  const { views } = loadPack(dir);
  const patch = JSON.parse(readFileSync(patchFile, 'utf8'));
  if (!Array.isArray(patch)) fail('patch.json 要是一個陣列');
  const changed = new Set(), added = [];
  const viewOf = (id) => {
    if (!id && views.length === 1) return views[0];
    return views.find(([, v]) => v.id === id) || fail(id ? `找不到照片畫面：${id}` : '包裡有好幾面牆：要寫 view');
  };
  const ring = (v, poly) => {
    if (!Array.isArray(poly) || poly.length < 3 || !poly.every(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))) fail(`外框至少三點：${JSON.stringify(poly)}`);
    if (poly.some(p => p[0] < 0 || p[1] < 0 || p[0] > v.w || p[1] > v.h)) fail(`外框超出照片（${v.w}×${v.h}）：${JSON.stringify(poly)}`);
    const pts = poly.map(p => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
    return { type: 'Polygon', coordinates: [[...pts, pts[0].slice()]] };
  };
  const node = (v, id) => (v.nodes || []).find(n => n.id === id && n.type === 'hold') || fail(`${v.id} 沒有岩點：${id}`);
  const tag = (n, k, val) => { n.props = { ...n.props }; if (val === undefined) delete n.props[k]; else n.props[k] = val; if (!Object.keys(n.props).length) delete n.props; };
  for (const p of patch) {
    const [path, v] = viewOf(p.view);
    v.nodes ||= []; v.marks ||= [];
    if (p.op === 'remove' || p.op === 'restore') for (const id of p.holds || []) tag(node(v, id), 'retired', p.op === 'remove' ? true : undefined);
    else if (p.op === 'add') {
      const id = p.id || newId();
      if (!ID.test(id) || v.nodes.some(n => n.id === id)) fail(`id 不能用：${id}`);
      v.nodes.push({ id, type: 'hold', props: { source: 'manual' } });
      v.marks.push({ node: id, geometry: ring(v, p.poly) });
      added.push(`${v.id} ${id}`);
    } else if (p.op === 'set') {
      const n = node(v, p.id), m = v.marks.find(x => x.node === p.id) || fail(`${p.id} 沒有外框`);
      m.geometry = ring(v, p.poly);
      if (n.props?.source !== 'manual') tag(n, 'source', 'edited');
    } else fail(`不認得的操作：${JSON.stringify(p)}`);
    changed.add(path);
  }
  const docOf = new Map(views);
  const problems = [...changed].flatMap(path => validate(docOf.get(path)).map(e => `${path} ${e}`));
  if (problems.length) fail(`改完不合格式，沒有寫入：\n${problems.join('\n')}`, 1);
  for (const path of changed) writeFileSync(join(dir, path), JSON.stringify(docOf.get(path)));
  console.log(`改了 ${[...changed].join('、') || '（沒有）'}`);
  for (const a of added) console.log(`新增 ${a}`);
  return true;
}

const cmd = args.shift(), json = has('--json');
let ok = true;
if (cmd === 'holds') { if (!args[0]) fail('用法：node tools/wall.mjs holds <包資料夾> [--json]'); ok = holds(args[0], json); }
else if (cmd === 'apply') ok = apply(args[0], args[1]);
else fail('用法：node tools/wall.mjs holds|apply …（說明在檔案開頭）');
process.exit(ok ? 0 : 1);
