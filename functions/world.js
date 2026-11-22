// 紅點貓「世界」的預先合成檔 public/world.json：OpenClimbing 索引（開放資料集 climbio/crags）＋ Studio 發佈的 Guidebook，
// 合成國家 → 地區 → 岩場三層樹（合成程式在 redpoint/world-data.mjs，部署時複製進 vendor/，本機直接讀 repo）。
const fs = require('node:fs'), path = require('node:path'), { pathToFileURL } = require('node:url');
const VENDOR = path.join(__dirname, 'vendor', 'world-data.mjs');
const loadData = () => import(pathToFileURL(fs.existsSync(VENDOR) ? VENDOR : path.join(__dirname, '..', 'redpoint', 'world-data.mjs')).href);
const OC_INDEX = 'https://huggingface.co/datasets/climbio/crags/resolve/main/openclimbing/index.json';
const WORLD_BUILT_FILE = 'public/world.json';

/** 抓 OpenClimbing 索引；抓不到就丟錯（呼叫端保留上一份 world.json，不用沒有岩場的檔蓋掉） */
async function fetchOcIndex(fetchImpl = fetch) {
  const res = await fetchImpl(OC_INDEX, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`openclimbing index ${res.status}`);
  return res.json();
}

/** projects：世界清單的項目（listPublic 的結果）；只取 Guidebook */
async function buildWorldJson({ projects, fetchImpl, now = Date.now }) {
  const { buildWorldFile } = await loadData();
  return JSON.stringify(buildWorldFile(projects.filter(p => p.type === 'guidebook'), await fetchOcIndex(fetchImpl), now()));
}

module.exports = { buildWorldJson, fetchOcIndex, WORLD_BUILT_FILE, OC_INDEX };
