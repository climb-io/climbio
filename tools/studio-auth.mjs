// 同步服務的網址與身分（tools/studio.mjs、tools/guidebook.mjs 共用）。
// 身分依序：環境變數 CLIMBIO_STUDIO_KEY（同步金鑰）→ GH_TOKEN／GITHUB_TOKEN → 本機 gh 登入的權杖（gh auth token）。
// GitHub 權杖要服務設了 STUDIO_GITHUB_REPO、而且這個人是那個 repo 的協作者才認（functions/studio-sync.js）；都沒有就不帶，
// 雲端環境用 Network secret 時金鑰由環境的代理加上。網址沒設時用主網的同步服務。
import { spawnSync } from 'node:child_process';

export const SYNC_URL = process.env.CLIMBIO_STUDIO_URL || 'https://asia-east1-firebase-climbio.cloudfunctions.net/studioSync';
/** 同步金鑰本身（給登不了 GitHub 的環境用） */
export const STATIC_KEY = process.env.CLIMBIO_STUDIO_KEY || '';

let cached;
/** { key, from }：帶在標頭 X-Studio-Key 的值和它的來源；都沒有時 key 是空字串 */
export function studioAuth() {
  if (cached) return cached;
  if (STATIC_KEY) return (cached = { key: STATIC_KEY, from: 'CLIMBIO_STUDIO_KEY' });
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN']) if (process.env[name]) return (cached = { key: process.env[name], from: name });
  let key = '';
  try { const r = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8', timeout: 10_000, windowsHide: true }); if (r.status === 0) key = r.stdout.trim(); } catch { /* 沒裝 gh */ }
  return (cached = { key, from: key ? 'gh auth token' : '' });
}
