import { existsSync } from 'node:fs';
import { chromium, defineConfig, devices } from '@playwright/test';

// 雲端工作階段預裝的 Chromium 跟這裡的 Playwright 版本不同：沒裝自己的瀏覽器時改用預裝的
const PRESET_CHROMIUM = '/opt/pw-browsers/chromium';
const chromiumLaunch = !existsSync(chromium.executablePath()) && existsSync(PRESET_CHROMIUM) ? { executablePath: PRESET_CHROMIUM } : {};

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,   // 部署前的驗證在本機跑：留著 test.only 會只測一部分卻當成通過
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:8876',
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'android-chromium', use: { ...devices['Pixel 7'], browserName: 'chromium', launchOptions: chromiumLaunch } },
    { name: 'ios-webkit', use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  webServer: {
    // 內部流程（tools/e2e.py）傳自己的 Python（Windows 的 python3 是商店的替身，不能用）；直接跑 playwright 時用 python3
    command: `"${process.env.CLIMBIO_E2E_PYTHON ?? 'python3'}" tools/serve-test.py`,
    url: 'http://127.0.0.1:8876',
    reuseExistingServer: false,
    stdout: 'ignore',
    stderr: 'ignore',
  },
});
