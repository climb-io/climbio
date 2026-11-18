// 部署前的開機檢查（每次部署都先跑，開發版也一樣）：
// 用手機尺寸瀏覽器（Pixel 7）打開，主程式不能有語法或執行錯誤，畫面要真的畫出來。
// 抓的就是 v2203 那種情況：app.js 重複宣告 seeded，整支腳本不執行，只剩右下角地球按鈕的白畫面。
import { test, expect } from './fixtures.mjs';

const watch = (page) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  return errors;
};

test('紅點貓開機：沒有腳本錯誤，有頁面畫出來', async ({ page }) => {
  const errors = watch(page);
  await page.goto('/redpoint/', { waitUntil: 'load' });
  expect(errors).toEqual([]);   // 先看錯誤：失敗時直接顯示錯誤訊息
  await expect(page.locator('section.page:not([hidden])').first()).toBeVisible();   // 開哪一頁看狀態，至少要有一頁顯示
  expect(errors).toEqual([]);
});

test('岩點貓開機：沒有腳本錯誤，主程式有載入', async ({ page }) => {
  const errors = watch(page);
  await page.goto('/hold/');
  await page.waitForFunction(() => typeof toggleHomeMenu === 'function');
  expect(errors).toEqual([]);
});
