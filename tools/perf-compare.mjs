#!/usr/bin/env node
// 把 perf-hold-view.mjs 的多次輸出（JSON 檔）取中位數；兩組檔案比對：node tools/perf-compare.mjs 前1.json 前2.json -- 後1.json 後2.json
import { readFileSync } from 'node:fs';
const args = process.argv.slice(2), i = args.indexOf('--');
const load = (fs) => fs.map((f) => JSON.parse(readFileSync(f, 'utf8')));
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
const sets = i < 0 ? [load(args)] : [load(args.slice(0, i)), load(args.slice(i + 1))];
for (const sec of ['看路線圖', '定線']) for (const k of Object.keys(sets[0][0][sec])) {
  if (k === 'holds') continue;
  const m = sets.map((s) => med(s.map((r) => r[sec][k])));
  console.log(`${sec} ${k}: ${m.join(' → ')}${m.length === 2 ? `（${((m[1] / m[0] - 1) * 100).toFixed(0)}%）` : ''}`);
}
