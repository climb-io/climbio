// 產生 2D 牆相機追蹤比對資料（climbio-2d-tracking-camera/1）與 manifest.json（climbio-2d-tracking/1）。
// 使用與瀏覽器端完全相同的 OpenCV 4.10.0 WASM 與 wall2d-worker.js 萃取 AKAZE 特徵（不含影像）。
// 用法：node tools/build-wall2d-camera.mjs
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const G = require('../lab/wall2d-cam/geometry.js');

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT_DIR = join(ROOT, 'lab/wall2d-cam');
const FEATURE_LONG_SIDE = 1280;

const WALLS = [
  {
    wall: 'wanhua',
    name: '原岩萬華 2F',
    photoPath: 'demo/wanhua-wall.jpg',
    wallJson: '../../demo/wanhua-wall.json',
    routesJson: '../../demo/wanhua-routes.json',
    wallFile: 'demo/wanhua-wall.json',
    routesFile: 'demo/wanhua-routes.json',
  },
  {
    wall: 'demo',
    name: 'Climbio 示範牆',
    photoPath: 'demo/demo.jpg',
    wallJson: '../../demo/demo.json',
    routesJson: null,
    wallFile: 'demo/demo.json',
    routesFile: null,
  },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
};

function startServer() {
  const srv = http.createServer((req, res) => {
    const urlPath = (req.url || '/').split('?')[0];
    if (urlPath === '/__build.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><script>
window.buildCameraFromUrl = async (photoUrl, wallId, name, longSide, wallW, wallH) => {
  const bmp = await createImageBitmap(await (await fetch(photoUrl)).blob());
  const scale = Math.min(1, longSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale);
  const h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const rgba = c.getContext('2d').getImageData(0, 0, w, h).data;
  const gray = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < gray.length; i++, j += 4) {
    gray[i] = Math.round(0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2]);
  }
  const worker = new Worker('/lab/wall2d-cam/wall2d-worker.js');
  return new Promise((resolve, reject) => {
    worker.onerror = (e) => reject(new Error(e.message || 'Worker 錯誤'));
    worker.onmessage = ({ data }) => {
      if (data.type === 'ready') {
        worker.postMessage({
          type: 'build_camera',
          id: 1,
          wallId,
          name,
          gray,
          width: w,
          height: h,
          fullWidth: wallW || bmp.width,
          fullHeight: wallH || bmp.height,
          register: false,
        }, [gray.buffer]);
      } else if (data.type === 'camera_built') {
        worker.terminate();
        resolve({ ...data.camera, imageW: bmp.width, imageH: bmp.height });
      } else if (data.type === 'error') {
        worker.terminate();
        reject(new Error(data.error));
      }
    };
    worker.postMessage({ type: 'init', runtimeUrl: '/redpoint/vendor/opencv-4.10.0.js', walls: [] });
  });
};
</script>`);
      return;
    }
    const fp = join(ROOT, urlPath);
    if (existsSync(fp) && statSync(fp).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[extname(fp)] || 'application/octet-stream' });
      createReadStream(fp).pipe(res);
    } else {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  return new Promise((resolveListen) => srv.listen(0, '127.0.0.1', () => resolveListen(srv)));
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const f of readdirSync(OUT_DIR)) {
    if (/^camera-.*\.json$/.test(f)) unlinkSync(join(OUT_DIR, f));
  }

  const srv = await startServer();
  const port = srv.address().port;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/__build.html`);

    const manifestWalls = [];
    for (const spec of WALLS) {
      const rawWall = JSON.parse(readFileSync(join(ROOT, spec.wallFile), 'utf8'));
      const rawRoutes = spec.routesFile ? JSON.parse(readFileSync(join(ROOT, spec.routesFile), 'utf8')) : null;
      const parsed = G.parseWallData(rawWall, rawRoutes);

      const camera = await page.evaluate(
        ({ photoUrl, wallId, name, longSide, wallW, wallH }) => window.buildCameraFromUrl(photoUrl, wallId, name, longSide, wallW, wallH),
        { photoUrl: `/${spec.photoPath}`, wallId: spec.wall, name: spec.name, longSide: FEATURE_LONG_SIDE, wallW: parsed.w, wallH: parsed.h }
      );
      const imageAspect = camera.imageW / camera.imageH;
      const wallAspect = parsed.w / parsed.h;
      if (Math.abs(imageAspect - wallAspect) > 0.02) {
        throw new Error(`${spec.wall} 照片長寬比 (${imageAspect.toFixed(3)}) 與 wall.json (${wallAspect.toFixed(3)}) 不符`);
      }

      const { imageW, imageH, ...cameraClean } = camera;
      const jsonText = JSON.stringify(cameraClean);
      const sha256 = createHash('sha256').update(jsonText).digest('hex');
      const shortHash = sha256.slice(0, 12);
      const fileName = `camera-${spec.wall}-${shortHash}.json`;
      writeFileSync(join(OUT_DIR, fileName), jsonText);

      const bytes = Buffer.byteLength(jsonText);
      const featurePoints = camera.references.reduce((sum, r) => sum + r.n, 0);
      manifestWalls.push({
        wall: spec.wall,
        name: spec.name,
        wallJson: spec.wallJson,
        ...(spec.routesJson ? { routesJson: spec.routesJson } : {}),
        camera: {
          url: fileName,
          bytes,
          sha256,
        },
        photoW: camera.photoW,
        photoH: camera.photoH,
        holds: parsed.holds.length,
        routes: parsed.routes.length,
        referenceViews: camera.references.length,
        featurePoints,
      });
      console.log(`已產生 ${fileName}（${(bytes / 1024).toFixed(1)} KB，${featurePoints} 特徵點，${parsed.holds.length} 岩點）`);
    }

    const manifestHash = createHash('sha256')
      .update(manifestWalls.map((w) => w.camera.sha256).join(':'))
      .digest('hex')
      .slice(0, 12);
    const manifest = {
      schema: 'climbio-2d-tracking/1',
      defaultWall: 'wanhua',
      walls: manifestWalls,
      containsImages: false,
      build: `wall2d-${manifestHash}`,
    };
    writeFileSync(join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`已產生 manifest.json（${manifest.walls.length} 面牆，build ${manifest.build}）`);
  } finally {
    await browser.close();
    srv.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
