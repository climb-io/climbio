import { test as base, expect, devices } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const test = base.extend({
  // 紅點貓一般流程模擬主畫面 App；瀏覽器直開、安裝提示等情境用 test.use({ inBrowser: true })。兩種模式都能直接收岩場。
  inBrowser: [false, { option: true }],
  page: async ({ page, inBrowser }, use) => {
    if (!inBrowser) await page.addInitScript(() => { if (location.pathname.startsWith('/redpoint/')) Object.defineProperty(navigator, 'standalone', { get: () => true }); });
    // 本機預覽預設不接後端（site.js）；測試要主網的後端介面，各例再換成假的
    await page.addInitScript(() => { localStorage.setItem('climbio.site.main', '1'); });
    // 分享的替身（Backend.shareRoutes：牆的照片由第一個發佈的人傳到他的 Drive、線存在 Climbio）：fakeShare(每條路線的假伺服器)。
    // 假伺服器拿到 { pid, gym, wall, route, photo, base, signature }，回 false＝更新（不是新建），
    // 丟錯＝整次呼叫失敗（跟伺服器回錯一樣）。Drive 授權當作已經有（driveReady），不連 Google、Firebase
    await page.addInitScript(() => {
      let fake = null, unshare = null;
      const offline = () => {
        window.listedCalls = []; Backend.unlistWall = async (pid) => { listedCalls.push({ pid, listed: false }); };   // 刪掉公開的牆：收回公開
        Backend.primeShared = async () => {};
      };
      window.fakeShare = (fn) => {
        fake = fn; offline();
        Backend.shareRoutes = async ({ routes, ...body }) => {
          const results = {};
          for (const { route } of routes) {
            const r = await fake({ ...body, route });
            results[route.id] = r && typeof r === 'object' ? { ok: true, made: r.made !== false, ...r } : { ok: true, made: r !== false };
          }
          return { results };
        };
      };
      window.fakeUnshare = (fn) => { unshare = fn; offline(); Backend.unshareRoutes = async (pid, rids) => { for (const rid of rids) await (unshare || (async () => {}))(pid, rid); }; };
    });
    await use(page);
  },
  context: async ({ context, browserName, playwright, baseURL, locale, timezoneId }, use) => {
    if (browserName !== 'webkit') return use(context);
    // WebKit 非持久 context 無法寫入 Blob；每例獨立目錄仍維持資料隔離。
    const dir = await mkdtemp(join(tmpdir(), 'climbio-webkit-'));
    let persistent;
    try {
      persistent = await playwright.webkit.launchPersistentContext(dir, {
        ...devices['iPhone 13'], baseURL, locale, timezoneId,
      });
      await use(persistent);
    }
    finally {
      await persistent?.close();
      // Windows：WebKit 關掉後檔案（Service Worker 的 sqlite）可能還被鎖一下，EBUSY 時重試
      await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  },
});
export { expect };
