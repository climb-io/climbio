// 公開牆的擁有者操作：Studio／命令列的服務會帶發佈金鑰簽章；簽章用 functions/publisher-key.js 驗得過
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createService } from '../studio/service.js';
import { loadKey, signerFor } from './publisher-auth.mjs';

const require = createRequire(import.meta.url);
const { verifyPublisher } = require('../functions/publisher-key.js');

const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
const make = (key) => {
  const sent = [];
  const svc = createService({ url: 'https://fn.test/datasets', sign: signerFor(key), fetchFn: async (u, o) => { sent.push({ url: u, body: JSON.parse(o.body) }); return json(200, {}); } });
  return { svc, sent };
};

test('發佈金鑰檔：第一次產生、之後讀同一把；kid 是公鑰指紋', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'pk-')), 'k', 'key.json');
  const a = loadKey(file); assert.ok(existsSync(file)); assert.match(a.kid, /^[0-9a-f]{32}$/);
  assert.equal(loadKey(file).kid, a.kid);
  assert.throws(() => loadKey(join(tmpdir(), 'nope-key.json'), { create: false }), /找不到/);
});

test('服務：發佈、轉交、下架都帶簽章，伺服器端驗得過；下架送到 walls', async () => {
  const key = loadKey(join(mkdtempSync(join(tmpdir(), 'pk-')), 'key.json')), { svc, sent } = make(key), id = 'abcdefgh12345678', other = 'f'.repeat(32);
  await svc.publishWall({ id, name: '牆', gym: '館', files: [] });
  await svc.transferWall(id, other);
  await svc.unpublishWall('abcdefgh1234');
  assert.deepEqual(sent.map(s => [s.url, s.body.op]), [['https://fn.test/datasets', 'publishWall'], ['https://fn.test/datasets', 'transferWall'], ['https://fn.test/walls', 'unpublish']]);
  assert.equal(verifyPublisher('publishWall', id, sent[0].body.auth, '', Date.now()), key.kid);
  assert.equal(verifyPublisher('transferWall', id, sent[1].body.auth, other, Date.now()), key.kid);
  assert.equal(verifyPublisher('unpublish', 'abcdefgh1234', sent[2].body.auth, '', Date.now()), key.kid);
  assert.throws(() => verifyPublisher('transferWall', id, sent[1].body.auth, 'e'.repeat(32), Date.now()), { status: 401 });   // 轉交對象被換掉就驗不過
});
