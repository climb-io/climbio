// site.js 的 SITE.modelUrl：主網上線的站讀 Hugging Face 的模型，本機預覽和自己架的站讀站內的檔案
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const code = readFileSync(new URL('../site.js', import.meta.url), 'utf8');
const site = (hostname, main = false) => {
  const location = { hostname, href: `https://${hostname}/hold/` };
  const ctx = { location, localStorage: { getItem: () => (main ? '1' : null) }, URL, window: {} };
  vm.runInNewContext(code, ctx);
  return ctx.window.SITE;
};
const HF = 'https://huggingface.co/climbio/hold-models/resolve/main/';

test('主網上線的站（正式版、開發版）模型讀 Hugging Face', () => {
  for (const h of ['climbio.app', 'climbio-dev.web.app', 'climbio-eric.web.app']) assert.equal(site(h).modelUrl('freeclimbs.onnx', '../holdscan/models/freeclimbs.onnx'), `${HF}freeclimbs.onnx`, h);
});
test('本機預覽（就算接了主網後端）和自己架的站：讀站內的檔案', () => {
  assert.equal(site('127.0.0.1', true).modelUrl('freeclimbs.onnx', '../holdscan/models/freeclimbs.onnx'), 'https://127.0.0.1/holdscan/models/freeclimbs.onnx');
  assert.equal(site('gym.example.com').modelUrl('a.onnx', '../holdkit/models/a.onnx'), 'https://gym.example.com/holdkit/models/a.onnx');
});
