import test from 'node:test';
import assert from 'node:assert/strict';
import { TOPO_EDGE, COMMONS_REQUEST_WIDTH, fitSize } from '../sourcekit/photo-size.js';
import { commonsInfo } from '../sourcekit/openclimbing-read.js';
import { stale } from './sync-extension.mjs';

test('fitSize：長邊縮到 1600 以內、不放大、橫直式都對', () => {
  assert.equal(TOPO_EDGE, 1600);
  assert.deepEqual(fitSize(3200, 2400), { w: 1600, h: 1200 });
  assert.deepEqual(fitSize(2400, 3200), { w: 1200, h: 1600 });
  assert.deepEqual(fitSize(1000, 800), { w: 1000, h: 800 });
  assert.deepEqual(fitSize(undefined, 800), { w: undefined, h: 800 });
});

test('Commons：要 1920 的縮圖，文件的大小從原圖算成 1600（API 回的 thumbwidth 不可信）', async () => {
  const urls = [];
  const get = async (url) => {
    urls.push(url);
    return { query: { pages: { 1: { title: 'File:a.jpg', imageinfo: [{ thumburl: 'https://x/1920px-a.jpg', thumbwidth: 1600, thumbheight: 870, width: 2971, height: 1615, descriptionurl: 'p', extmetadata: { LicenseShortName: { value: 'CC BY 4.0' } } }] } } } };
  };
  const { info } = await commonsInfo(['File:a.jpg'], get);
  assert.match(urls[0], new RegExp(`iiurlwidth=${COMMONS_REQUEST_WIDTH}`));
  assert.deepEqual([info.get('File:a.jpg').w, info.get('File:a.jpg').h], [1600, 870]);
});

test('extension/sourcekit 跟 sourcekit 同步（沒同步就跑 node tools/sync-extension.mjs）', () => {
  assert.deepEqual(stale(), []);
});

test('合成預覽圖版面：格子照 6 列排、入口照片 4:3；Studio 與擴充功能的收藏用同一份', async () => {
  const { previewProps, previewSize, tileRect } = await import('../sourcekit/preview-sheet.js');
  assert.deepEqual(previewSize(9), { w: 720, h: 540 + 2 * 90 });
  assert.deepEqual(previewProps(3), { href: 'preview.jpg', w: 720, h: 630, count: 3, tile: { w: 120, h: 90, cols: 6, y: 540 } });
  assert.deepEqual(tileRect(9), { x: 360, y: 630, w: 120, h: 90 });
  const M = await import('../studio/crag/model.js');
  assert.deepEqual([M.PREVIEW_W, M.COVER_H, M.TILE_COLS, M.previewSize(1)], [720, 540, 6, { w: 720, h: 630 }]);
});
