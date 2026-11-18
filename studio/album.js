// English: Fetch original photos from a Google Photos shared album link.
// 從 Google 相簿分享連結（photos.app.goo.gl 或 photos.google.com/share）抓原始照片（=d 保留完整 EXIF 與 GPS）。
// 透過 Climbio Chrome 擴充功能或伺服器轉發端點（/album）繞過瀏覽器對 Google 相簿的 CORS 限制。

const T = (...a) => globalThis.AppKit.i18n.t(...a);   // 文字在呼叫時才查
export const EXT_ID = 'clpjfehckclgenaackpklkceejlbcbnh';   // 自行載入的版本（manifest 的 key 固定）
export const STORE_EXT_ID = '';   // Chrome 線上應用程式商店的版本：拿到 ID 後填在這裡（同 redpoint/extension.js）

const ENTRY_RE = /\["(AF1Qip[\w-]+)",\["(https:\/\/lh3\.googleusercontent\.com\/pw\/[\w-]+)",(\d+),(\d+)/g;
const TS_RE = /\]\],(\d{13}),"[^"]*",(-?\d+)/;
const IMG_EXT = /\.(jpe?g|png|webp|hei[cf])$/i;

const unescapeHtml = (s) => String(s || '')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

export function checkAlbumUrl(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/https:\/\/(?:photos\.app\.goo\.gl\/[\w-]+|photos\.google\.com\/share\/[\w-]+(?:\?[^\s"'<>]*)?)/);
  let u;
  try { u = new URL(m ? m[0] : s); } catch { throw new Error(T('stAlbumLink')); }
  const okHost = (u.hostname === 'photos.app.goo.gl' && /^\/[\w-]+$/.test(u.pathname))
    || (u.hostname === 'photos.google.com' && /^\/share\/[\w-]+/.test(u.pathname));
  if (u.protocol !== 'https:' || !okHost) throw new Error(T('stAlbumLink'));
  return u.href;
}

export function isAlbumUrl(raw) {
  try { checkAlbumUrl(raw); return true; } catch { return false; }
}

function fmtTimestamp(ms, tzMs) {
  const d = new Date(ms + (Number.isFinite(tzMs) ? tzMs : 0));
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

export function parseAlbumPage(html) {
  const text = String(html || '');
  const titleMatch = text.match(/data-title="([^"]+)"/)
    || text.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i)
    || text.match(/<title>([^<]+?)\s*-\s*Google\s*(?:Photos|相簿)<\/title>/i);
  const rawTitle = titleMatch ? unescapeHtml(titleMatch[1]).replace(/\s*·.*$/, '').trim() : '';
  const title = /^Google\s*(?:Photos|相簿)$/i.test(rawTitle) ? '' : rawTitle;

  const seen = new Set(), items = [];
  ENTRY_RE.lastIndex = 0;
  let m;
  while ((m = ENTRY_RE.exec(text)) !== null) {
    const [, id, src, w, h] = m;
    if (seen.has(id)) continue;
    seen.add(id);
    const tail = text.slice(m.index + m[0].length, m.index + m[0].length + 500);
    const ts = tail.match(TS_RE);
    const t = ts ? Number(ts[1]) : 0, tz = ts ? Number(ts[2]) : 0;
    items.push({ id, src, width: Number(w), height: Number(h), t, tz, idx: items.length });
  }
  items.sort((a, b) => (a.t - b.t) || (a.idx - b.idx));

  const used = new Map();
  const photos = items.map((p, i) => {
    const stem = p.t > 0 ? fmtTimestamp(p.t, p.tz) : `photo_${String(i + 1).padStart(3, '0')}`;
    const n = (used.get(stem) || 0) + 1;
    used.set(stem, n);
    const name = `${n > 1 ? `${stem}_${n}` : stem}.jpg`;
    return { id: p.id, url: `${p.src}=d`, name, width: p.width, height: p.height, t: p.t };
  });
  return { title, photos };
}

export function fileNameFromHeader(cd) {
  if (!cd) return '';
  const star = cd.match(/filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;\r\n]+)/);
  if (star) {
    try {
      const name = decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')).split(/[\\/]/).pop();
      if (IMG_EXT.test(name)) return name;
    } catch { /* ignore malformed encoding */ }
  }
  const plain = cd.match(/filename\s*=\s*"([^"]+)"/i) || cd.match(/filename\s*=\s*([^;\s]+)/i);
  if (plain) {
    const name = plain[1].trim().split(/[\\/]/).pop();
    if (IMG_EXT.test(name)) return name;
  }
  return '';
}

async function sendExt(msg) {
  const rt = globalThis.chrome && globalThis.chrome.runtime;
  if (!rt || typeof rt.sendMessage !== 'function') return null;
  for (const id of [EXT_ID, STORE_EXT_ID].filter(Boolean)) {
    const res = await new Promise((resolve) => {
      try {
        rt.sendMessage(id, msg, (r) => resolve(rt.lastError || !r ? null : r));
      } catch { resolve(null); }
    });
    if (res) return res;
  }
  return null;
}

function b64ToBlob(b64, type) {
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: type || 'image/jpeg' });
}

async function defaultGetText(url) {
  const ext = await sendExt({ op: 'album-text', url });
  if (ext && ext.ok && typeof ext.text === 'string') return ext.text;
  let r;
  try { r = await fetch(`/album?url=${encodeURIComponent(url)}`); } catch { r = null; }
  if (r && r.ok) {
    const ct = r.headers.get('content-type') || '';
    const text = await r.text();
    if (!ct.includes('text/html') || text.includes('AF1Qip') || text.includes('photos.google.com')) return text;
  }
  if (ext && ext.error) throw new Error(ext.error);
  throw new Error(T('stAlbumConnect'));
}

async function defaultGetBlob(url) {
  const ext = await sendExt({ op: 'album-blob', url });
  if (ext && ext.ok && typeof ext.b64 === 'string') {
    return { blob: b64ToBlob(ext.b64, ext.type), name: fileNameFromHeader(ext.disposition || '') || (IMG_EXT.test(ext.name || '') ? ext.name : '') };
  }
  let r;
  try { r = await fetch(`/album?url=${encodeURIComponent(url)}`); } catch { r = null; }
  if (r && r.ok) {
    const name = fileNameFromHeader(r.headers.get('content-disposition') || '') || (IMG_EXT.test(r.headers.get('x-album-filename') || '') ? r.headers.get('x-album-filename') : '');
    return { blob: await r.blob(), name };
  }
  if (ext && ext.error) throw new Error(ext.error);
  throw new Error(T('stAlbumDownloadFailed'));
}

function uniqueName(rawName, used) {
  const clean = IMG_EXT.test(rawName || '') ? rawName : `${(rawName || 'photo').replace(/\.[^.]+$/, '')}.jpg`;
  const dot = clean.lastIndexOf('.'), stem = clean.slice(0, dot), ext = clean.slice(dot);
  let candidate = clean, n = 1;
  while (used.has(candidate.toLowerCase())) candidate = `${stem}_${++n}${ext}`;
  used.add(candidate.toLowerCase());
  return candidate;
}

const mimeOf = (name, fallback) => /png$/i.test(name) ? 'image/png' : /webp$/i.test(name) ? 'image/webp' : /hei[cf]$/i.test(name) ? 'image/heic' : (fallback && fallback.startsWith('image/') ? fallback : 'image/jpeg');

export async function fetchAlbum(rawUrl, { getText = defaultGetText, getBlob = defaultGetBlob, onProgress, concurrency = 4 } = {}) {
  const url = checkAlbumUrl(rawUrl);
  if (onProgress) onProgress(0, 0, '');
  const html = await getText(url);
  const { title, photos } = parseAlbumPage(html);
  if (!photos.length) throw new Error(T('stAlbumEmpty'));

  const out = new Array(photos.length);
  let next = 0, done = 0;
  if (onProgress) onProgress(0, photos.length, title);
  const workers = Array.from({ length: Math.max(1, Math.min(concurrency, photos.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= photos.length) break;
      const p = photos[i];
      const r = await getBlob(p.url);
      const blob = r && r.blob ? r.blob : r;
      const rawName = (r && r.name) || p.name;
      out[i] = { blob, rawName, t: p.t };
      done++;
      if (onProgress) onProgress(done, photos.length, title);
    }
  });
  await Promise.all(workers);

  const used = new Set();
  const files = out.map(({ blob, rawName, t }) => {
    const name = uniqueName(rawName, used);
    return new File([blob], name, { type: mimeOf(name, blob.type), ...(t ? { lastModified: t } : {}) });
  });
  return { title, files };
}
