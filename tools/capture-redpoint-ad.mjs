/**
 * Capture real Redpoint Cat browser UI (no hand-drawn interface or routes).
 * Local usage: python3 tools/serve-test.py
 *              node tools/capture-redpoint-ad.mjs
 * Output: demo/capture-redpoint/{mobile,desktop}-{home,crag,topo}.png and .webm
 * The selected OpenClimbing source and all Topo lines are downloaded by the same
 * importer and rendered by the same components as the actual application.
 */
import { chromium } from '@playwright/test';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

// Keep demo source, capture sizes and scene timing in one checked-in file.
const configPath = process.env.REDPOINT_DEMO_CONFIG || 'demo/redpoint-demo.config.json';
const config = JSON.parse(await readFile(configPath, 'utf8'));
if (!/^https:\/\/(?:www\.)?(?:openclimbing\.org|openstreetmap\.org)\/relation\/\d+$/i.test(config.source)) {
  throw new Error('Demo config source must be an OpenClimbing or OpenStreetMap relation URL');
}
const sceneOrder = ['home', 'openCrag', 'openTopo'];
if (!Array.isArray(config.scenes) || JSON.stringify(config.scenes.map(s => s.action)) !== JSON.stringify(sceneOrder)) {
  throw new Error('Demo config scenes must be home -> openCrag -> openTopo');
}
for (const scene of config.scenes) {
  if (!Number.isInteger(scene.holdMs) || scene.holdMs < 0 || scene.holdMs > 10000) {
    throw new Error(`Invalid holdMs for ${scene.action}`);
  }
}
const holds = Object.fromEntries(config.scenes.map(s => [s.action, s.holdMs]));
const cases = ['mobile', 'desktop'].map(name => {
  const t = config.targets?.[name];
  if (!t || !Number.isInteger(t.width) || !Number.isInteger(t.height) ||
      t.width < 320 || t.height < 320 || t.width > 4096 || t.height > 4096 ||
      !['portrait', 'landscape'].includes(t.preferredOrientation)) {
    throw new Error(`Invalid demo capture target: ${name}`);
  }
  return { name, width: t.width, height: t.height, portrait: t.preferredOrientation === 'portrait' };
});
const base = process.env.REDPOINT_CAPTURE_BASE || 'http://127.0.0.1:8876';
const source = config.source;
const output = process.env.REDPOINT_CAPTURE_OUT || 'demo/capture-redpoint';

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const target of cases) {
    const dir = join(output, `video-${target.name}`);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const context = await browser.newContext({
      viewport: { width: target.width, height: target.height },
      isMobile: target.portrait,
      hasTouch: target.portrait,
      deviceScaleFactor: 1,
      locale: 'zh-TW',
      timezoneId: 'Asia/Taipei',
      reducedMotion: 'reduce',
      recordVideo: { dir, size: { width: target.width, height: target.height } },
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      if (navigator.serviceWorker) navigator.serviceWorker.register = () => Promise.resolve();
    });
    try {
      await page.goto(`${base}/redpoint/`, { waitUntil: 'domcontentloaded' });
      await page.locator('#cards').waitFor({ state: 'visible' });
      await page.waitForFunction(() => !!document.getElementById('fabBtn')?.onclick);
      await page.waitForFunction(async () => !!await (await import('/redpoint/db.js')).getMeta('home'));
      const loaded = await page.evaluate(async (url) => {
        const { fromOpenClimbing } = await import('/redpoint/openclimbing.js');
        const db = await import('/redpoint/db.js');
        const result = await fromOpenClimbing(url);
        if (!result.photos.size) throw new Error('No real, licensed topo photos were downloaded');
        const homeId = await db.getMeta('home');
        const home = await db.getDoc(homeId);
        if (!home) throw new Error('Redpoint home did not initialize');
        if (!home.items.some(item => item.id === result.root.id)) {
          home.items.push({ href: `${result.root.id}.json`, id: result.root.id });
        }
        await db.putDocs([...result.docs.values(), home]);
        for (const [id, photo] of result.photos) await db.putPhoto(id, photo);
        await db.putPhoto(result.root.id, result.photos.values().next().value);
        return { name: result.root.name, photos: result.photos.size,
          routes: result.root.nodes?.filter((n) => n.type === 'route').length ?? 0 };
      }, source);
      if (loaded.photos < 2) throw new Error(`Need at least two genuine Topo photos, got ${loaded.photos}`);
      if (loaded.routes < 2) throw new Error(`Need at least two genuine annotated routes, got ${loaded.routes}`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      const crag = page.locator('#cards .card', { hasText: loaded.name }).first();
      await crag.waitFor({ state: 'visible', timeout: 15000 });
      await page.screenshot({ path: join(output, `${target.name}-home.png`) });
      await page.waitForTimeout(holds.home);
      await crag.click();
      await page.locator('#packCards .card').first().waitFor({ state: 'visible' });
      await page.waitForTimeout(500);
      await page.screenshot({ path: join(output, `${target.name}-crag.png`) });
      await page.waitForTimeout(holds.openCrag);
      await page.locator('#packCards .card').first().click();
      await page.locator('#view').waitFor({ state: 'visible' });
      await page.waitForFunction(() => !!document.querySelector('#view')?.viewer?.ready, { timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(400);
      // Choose among real Topo photos; never draw fabricated lines.
      for (let i = 0; i < 16; i++) {
        const ratio = await page.locator('#view').evaluate((el) => {
          const photo = el.viewer?.model?.photo;
          return photo?.w && photo?.h ? photo.w / photo.h : null;
        });
        if (ratio && (target.portrait ? ratio <= 0.9 : ratio >= 1.1)) break;
        const next = page.locator('#topoNext');
        if (!(await next.isVisible())) break;
        await next.click();
        await page.waitForTimeout(350);
      }
      await page.screenshot({ path: join(output, `${target.name}-topo.png`) });
      await page.waitForTimeout(holds.openTopo);
      const video = page.video();
      await context.close();
      await video.saveAs(join(output, `${target.name}.webm`));
      console.log(`${target.name}: real ${loaded.name} / ${loaded.photos} photos / ${loaded.routes} routes captured`);
    } catch (err) {
      await context.close().catch(() => {});
      throw new Error(`${target.name}: ${err.message}`, { cause: err });
    }
  }
} finally {
  await browser.close();
}
