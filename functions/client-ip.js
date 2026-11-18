'use strict';
// 請求的網路來源。x-forwarded-for 的前面幾欄是客戶端自己填的（能偽造），最後一欄才是 Google 前端附上的連線來源；額度只認這一欄
function clientIp(req) {
  const parts = String((req.get && req.get('x-forwarded-for')) || '').split(',').map(s => s.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(req.ip || '');
}

module.exports = { clientIp };
