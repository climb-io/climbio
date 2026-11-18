// 產生岩館清單 gyms/：OpenStreetMap 的室內攀岩館（ODbL）＋自己整理的國家清單（tools/gyms/<國碼>.json，該國不用 OSM）。
// 每個國家一個檔 gyms/<國碼>.json（[[名稱, 緯度, 經度], …]），gyms/index.json 是各國岩館的範圍，App 只載入位置所在的國家。
// 用法：node tools/gyms.mjs [--osm 下載好的 Overpass JSON]。規則見 docs/gyms.md
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { northToSouth } from './gym-order.mjs';

const root = new URL('../', import.meta.url);
const file = (p) => new URL(p, root);
const UA = 'climbio-gyms/1.0 (https://climbio.app)';
// 自己整理的國家：OSM 在這些國家過時、缺漏，該國的 OSM 岩館不收
const LOCAL = ['tw'];
const QUERY = '[out:json][timeout:300];nwr["sport"~"(^|;)climbing(;|$)"]["leisure"~"^(sports_centre|fitness_centre|sports_hall)$"]["name"];out center tags;';
const PAD = 0.3;   // 國家範圍往外多約 30 公里：岩館選單列 30 公里內的，國界附近也看得到隔壁國家的

const arg = (name) => { const i = process.argv.indexOf(name); return i < 0 ? null : process.argv[i + 1]; };
async function overpass(data) {
  let res;
  for (let wait = 30000; ; wait *= 2) {   // 伺服器忙（429、5xx）等一下再試
    res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'User-Agent': UA }, body: new URLSearchParams({ data }) });
    if (res.ok || (res.status !== 429 && res.status < 500) || wait > 240000) break;
    await new Promise(r => setTimeout(r, wait));
  }
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  const json = await res.json();
  if (json.remark) throw new Error(`Overpass：${json.remark}`);   // 逾時等錯誤會回 200 加 remark
  return json;
}
// 每個點所在的行政區：levels 是要的層級（2 是國家，4–8 是省到市鎮），回傳 { id: 標籤 }（最小的那一層）
async function areas(points, levels) {
  const found = {};
  for (let i = 0; i < points.length; i += 1000) {
    const q = '[out:json][timeout:600];' + points.slice(i, i + 1000).map(g => `make g id="${g.id}";out;is_in(${g.lat},${g.lon})->.a;area.a["boundary"="administrative"]["admin_level"~"^(${levels})$"]["name"];out tags;`).join('');
    let cur = null;
    for (const el of (await overpass(q)).elements) {
      if (el.type === 'g') { cur = el.tags.id; continue; }
      if (cur && +el.tags.admin_level >= +(found[cur]?.admin_level || 0)) found[cur] = el.tags;
    }
  }
  return found;
}
const osm = arg('--osm') ? JSON.parse(readFileSync(arg('--osm'), 'utf8')) : await overpass(QUERY);
const round = (v) => Math.round(v * 1e4) / 1e4;   // 約 10 公尺，判斷 300 公尺內夠用

// 自己整理的國家：{ name, lat, lon, address, … }，名稱是 App 裡顯示、分享用的簡稱
// 從北到南、同系列放一起（tools/gym-order.mjs）：App 沒有定位時照檔案順序列
const local = LOCAL.flatMap(cc => northToSouth(JSON.parse(readFileSync(file(`tools/gyms/${cc}.json`), 'utf8'))).map(g => ({ cc, name: g.name, lat: round(g.lat), lon: round(g.lon) })));
// 名稱就是岩館的識別（牆面、分享、找牆面都用名稱）：OSM 編號 → [名稱, 國碼] 記在 tools/gyms/osm.json，重新產生時沿用，OSM 改名也不變
const prev = new Map(Object.entries(existsSync(file('tools/gyms/osm.json')) ? JSON.parse(readFileSync(file('tools/gyms/osm.json'), 'utf8')) : {}));
let gyms = osm.elements.filter(e => e.tags.name?.trim()).map(e => ({ id: e.type[0] + e.id, name: e.tags.name.trim(), lat: round((e.center || e).lat), lon: round((e.center || e).lon), city: e.tags['addr:city'] || '' }));
const fresh = gyms.filter(g => !prev.has(g.id));
const country = await areas(fresh, '2');
for (const g of gyms) g.cc = prev.has(g.id) ? prev.get(g.id)[1] : (country[g.id]?.['ISO3166-1'] || 'zz').toLowerCase();   // 不在任何國家（爭議地區）放 zz
gyms = gyms.filter(g => !LOCAL.includes(g.cc));

// 新的岩館跟別的同名就加城市：OSM 有寫 addr:city 就用，沒有就查所在的行政區；還是同名再加編號
const taken = new Set([...local.map(g => g.name), ...[...prev.values()].map(([name]) => name)]);
const count = new Map();
for (const g of gyms) { if (prev.has(g.id)) g.name = prev.get(g.id)[0]; count.set(g.name, (count.get(g.name) || 0) + 1); }
const clash = gyms.filter(g => !prev.has(g.id) && (count.get(g.name) > 1 || taken.has(g.name)));
const towns = await areas(clash.filter(g => !g.city), '4|5|6|7|8');
for (const g of clash.sort((a, b) => a.id.localeCompare(b.id))) {
  const city = g.city || towns[g.id]?.['name:en'] || towns[g.id]?.name;
  const base = city ? `${g.name}（${city}）` : g.name;
  let name = base;
  for (let i = 2; taken.has(name) || (name === g.name && count.get(g.name) > 1); i++) name = `${base} ${i}`;
  taken.add(g.name = name);
}
writeFileSync(file('tools/gyms/osm.json'), '{\n' + gyms.map(g => `${JSON.stringify(g.id)}:${JSON.stringify([g.name, g.cc])}`).join(',\n') + '\n}\n');

// 每國一個檔；index 的範圍按 10 度的格子分開算（海外領土不會讓一國的範圍蓋住半個地球）
const all = [...local, ...gyms], byCc = Map.groupBy(all, g => g.cc), boxes = new Map();
mkdirSync(file('gyms/'), { recursive: true });
for (const f of readdirSync(file('gyms/'))) rmSync(file(`gyms/${f}`));
for (const [cc, list] of [...byCc].sort()) {
  writeFileSync(file(`gyms/${cc}.json`), '[\n' + list.map(g => JSON.stringify([g.name, g.lat, g.lon])).join(',\n') + '\n]\n');
  for (const g of list) {
    const k = `${cc} ${Math.floor(g.lat / 10)} ${Math.floor(g.lon / 10)}`, b = boxes.get(k) || [cc, 90, 180, -90, -180];
    boxes.set(k, [cc, Math.min(b[1], g.lat), Math.min(b[2], g.lon), Math.max(b[3], g.lat), Math.max(b[4], g.lon)]);
  }
}
const index = [...boxes.values()].map(([cc, s, w, n, e]) => [cc, round(s - PAD), round(w - PAD), round(n + PAD), round(e + PAD)]);
writeFileSync(file('gyms/index.json'), '[\n' + index.map(b => JSON.stringify(b)).join(',\n') + '\n]\n');
console.log(`gyms/：${byCc.size} 個國家、${all.length} 間（自己整理 ${local.length} 間，OSM ${gyms.length} 間，新的 ${fresh.length} 間）`);
