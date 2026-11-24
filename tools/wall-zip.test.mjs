import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import AppKit from '../appkit/index.mjs';

// wall-batch.mjs zip：通過 verify 的牆打成 walls.zip（每面牆一個資料夾），岩館名稱寫進畫面的 props.gym
const CLI = fileURLToPath(new URL('./wall-batch.mjs', import.meta.url));
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const VIEW = 'a1b2c3d4e5f60718';

function work({ verified = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wall-zip-')), pack = join(dir, 'w1', 'pack');
  mkdirSync(pack, { recursive: true });
  writeFileSync(join(dir, 'w1', 'run.json'), '{}');
  if (verified) writeFileSync(join(dir, 'w1', 'result.json'), '{}');
  writeFileSync(join(pack, 'index.json'), JSON.stringify({ climbio: 2, kind: 'set', type: 'walls', id: '0123456789abcdef', name: '主牆' }));
  writeFileSync(join(pack, `${VIEW}.json`), JSON.stringify({ climbio: 2, kind: 'view', surface: 'photo', id: VIEW, name: '主牆', w: 1, h: 1, nodes: [], marks: [], props: { thumb: `${VIEW}.thumb.jpg` } }));
  writeFileSync(join(pack, `${VIEW}.jpg`), JPEG);
  return dir;
}
const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', timeout: 60_000 });

test('zip：每面牆一個資料夾，畫面帶岩館名稱（原本的 props 留著），照片原樣', async () => {
  const dir = work();
  try {
    const r = run('zip', dir, '--gym', '測試館');
    assert.equal(r.status, 0, r.stderr);
    const entries = await AppKit.files.unzip(new Blob([readFileSync(join(dir, 'walls.zip'))]));
    assert.deepEqual(entries.map(e => e.name).sort(), [`w1/${VIEW}.jpg`, `w1/${VIEW}.json`, 'w1/index.json']);
    const view = JSON.parse(await entries.find(e => e.name === `w1/${VIEW}.json`).blob.text());
    assert.deepEqual([view.props.gym, view.props.thumb], ['測試館', `${VIEW}.thumb.jpg`]);
    assert.ok(Buffer.from(await entries.find(e => e.name === `w1/${VIEW}.jpg`).blob.arrayBuffer()).equals(JPEG));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('zip：沒給岩館名稱、牆還沒通過 verify 都不打包', () => {
  const dir = work(), bad = work({ verified: false });
  try {
    const noGym = run('zip', dir);
    assert.notEqual(noGym.status, 0); assert.match(noGym.stderr, /--gym/);
    const notVerified = run('zip', bad, '--gym', '測試館');
    assert.notEqual(notVerified.status, 0); assert.match(notVerified.stderr, /verify/);
  } finally { rmSync(dir, { recursive: true, force: true }); rmSync(bad, { recursive: true, force: true }); }
});
