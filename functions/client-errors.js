// 測試版的錯誤回報（clientError）：測試版網站（開發版、Eric 的站、它們的預覽頻道）沒接住的錯誤送到這裡，
// 寫成 Error Reporting 認得的結構化紀錄（同樣的錯誤自動歸成一組，Google Cloud 主控台的 Error Reporting 看）。正式版不送（appkit/errors.js）。
// 只收測試版的來源；欄位截短，不收照片、路線、帳號資料。
const TEST_SITES = ['climbio-dev', 'climbio-eric'];
const isTestOrigin = (origin) => TEST_SITES.some(s => new RegExp(`^https://${s}(--[a-z0-9-]+)?\\.web\\.app$`).test(origin || ''));
const cut = (v, n) => String(v ?? '').slice(0, n);

/** 收到的一筆 → Error Reporting 的紀錄（ReportedErrorEvent）；不合格回 null */
function toEvent(origin, b) {
  if (!b || typeof b !== 'object') return null;
  const msg = cut(b.msg, 500), stack = cut(b.stack, 4000);
  if (!msg && !stack) return null;
  const app = /^[a-z0-9-]{1,20}$/.test(b.app || '') ? b.app : 'web';
  const page = cut(b.page, 200);
  return {
    severity: 'ERROR',
    '@type': 'type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent',
    message: stack && stack.includes(msg) ? stack : [msg, stack].filter(Boolean).join('\n'),
    serviceContext: { service: `web-${app}`, version: cut(b.v, 40) || 'unknown' },
    context: {
      httpRequest: { url: origin + page, userAgent: cut(b.ua, 300) },
      reportLocation: { filePath: cut(b.file, 200) || page || '-', lineNumber: Number(b.line) || 0, functionName: cut(b.kind, 40) || 'error' },
    },
  };
}

function createHandler({ log = (line) => console.error(line) } = {}) {
  return (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).send('POST only');
    const origin = req.get('origin') || '';
    if (!isTestOrigin(origin)) return res.status(403).send('test sites only');
    let b = req.body;
    if (typeof b === 'string' || Buffer.isBuffer(b)) { try { b = JSON.parse(String(b)); } catch { b = null; } }   // sendBeacon 送 text/plain（不用 CORS 預檢）
    const ev = toEvent(origin, b);
    if (!ev) return res.status(400).send('bad report');
    log(JSON.stringify(ev));
    return res.status(204).send('');
  };
}

module.exports = { createHandler, toEvent, isTestOrigin };
