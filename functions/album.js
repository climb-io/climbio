// Google 相簿分享連結與原始照片（=d）的轉發端點（GET /album?url=…，Hosting rewrite 到 exports.album）：
// 讓手機、平板或未安裝擴充功能的電腦版 Studio 直接讀取相簿網頁與原始圖片位元組（保留完整 EXIF 與 GPS），繞過瀏覽器對 Google 相簿的 CORS 限制。
// 只允許抓 Google 相簿的三種公開網址（photos.app.goo.gl、photos.google.com/share/、lh3.googleusercontent.com/pw/），不轉發其他網站。

const MAX_URL = 2048;
const MAX_BYTES = 50 * 1024 * 1024;
const ALLOWED_FINAL_HOSTS = new Set(['photos.app.goo.gl', 'photos.google.com', 'lh3.googleusercontent.com']);

function checkAlbumTarget(raw) {
  if (typeof raw !== 'string' || !raw.length || raw.length > MAX_URL) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const ok = (u.hostname === 'photos.app.goo.gl' && /^\/[\w-]+$/.test(u.pathname))
    || (u.hostname === 'photos.google.com' && /^\/share\/[\w-]+/.test(u.pathname))
    || (u.hostname === 'lh3.googleusercontent.com' && /^\/pw\/[\w-=]+$/.test(u.pathname));
  return ok ? u : null;
}

function createAlbumHandler({ fetchImpl = fetch } = {}) {
  return async (req, res) => {
    if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
    const target = checkAlbumTarget(req.query && req.query.url);
    if (!target) return res.status(400).json({ error: 'bad album url' });
    try {
      const upstream = await fetchImpl(target.href, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Climbio/1.0)' },
        redirect: 'follow',
      });
      if (upstream.url) {
        let finalHost = '';
        try { finalHost = new URL(upstream.url).hostname; } catch { /* ignore */ }
        if (finalHost && !ALLOWED_FINAL_HOSTS.has(finalHost)) return res.status(400).json({ error: 'bad redirect host' });
      }
      if (!upstream.ok) return res.status(upstream.status === 404 ? 404 : 502).json({ error: `upstream ${upstream.status}` });
      const len = Number(upstream.headers.get('content-length') || 0);
      if (len > MAX_BYTES) return res.status(413).json({ error: 'file too large' });
      const buf = Buffer.from(await upstream.arrayBuffer());
      if (buf.length > MAX_BYTES) return res.status(413).json({ error: 'file too large' });
      const ctype = upstream.headers.get('content-type') || 'application/octet-stream';
      const cdisp = upstream.headers.get('content-disposition');
      res.set('Content-Type', ctype);
      res.set('Cache-Control', target.hostname === 'lh3.googleusercontent.com' ? 'private, max-age=3600' : 'no-store');
      if (cdisp) {
        res.set('Content-Disposition', cdisp);
        res.set('Access-Control-Expose-Headers', 'Content-Disposition');
      }
      return res.status(200).send(buf);
    } catch (e) {
      console.error('album', e);
      return res.status(502).json({ error: 'upstream error' });
    }
  };
}

module.exports = { MAX_BYTES, checkAlbumTarget, createAlbumHandler };
