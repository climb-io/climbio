// AppKit.share：交給系統的分享（sendLink、sendFile）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// ---- 交給系統的分享：sendLink / sendFile ----
const share = createRequire(import.meta.url)('../appkit/share.js');
const withNav = async (nav, fn) => {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
  try { await fn(); } finally { old ? Object.defineProperty(globalThis, 'navigator', old) : delete globalThis.navigator; }
};
const err = (name) => Object.assign(new Error(name), { name });

test('sendLink：能分享就分享；使用者關掉回 cancelled', async () => {
  await withNav({ share: async () => {} }, async () => assert.equal(await share.sendLink('https://x/p/abc123', { title: 'T' }), 'shared'));
  await withNav({ share: async () => { throw err('AbortError'); } }, async () => assert.equal(await share.sendLink('https://x'), 'cancelled'));
});
test('sendLink：不能分享就複製（有文字時文字換行加網址）；被擋時 strictGesture 回 blocked', async () => {
  let copied = '';
  const clipboard = { writeText: async (v) => { copied = v; } };
  await withNav({ clipboard }, async () => { assert.equal(await share.sendLink('https://x', { text: '來攀' }), 'copied'); assert.equal(copied, '來攀\nhttps://x'); });
  const blocked = { share: async () => { throw err('NotAllowedError'); }, clipboard };
  await withNav(blocked, async () => assert.equal(await share.sendLink('https://x', { strictGesture: true }), 'blocked'));
  await withNav(blocked, async () => assert.equal(await share.sendLink('https://x'), 'copied'));
  await withNav({}, async () => assert.equal(await share.sendLink('https://x'), 'failed'));
});
test('sendFile：不能分享檔案就下載；strictGesture 被擋回 blocked 且不下載', async () => {
  const downloads = [];
  const doc = globalThis.document, url = globalThis.URL.createObjectURL;
  globalThis.document = { createElement: () => ({ click() { downloads.push(this.download); } }) };
  globalThis.URL.createObjectURL = () => 'blob:x';
  try {
    const file = new File(['a'], 'a.zip', { type: 'application/zip' });
    await withNav({}, async () => assert.equal(await share.sendFile(file), 'downloaded'));
    assert.deepEqual(downloads, ['a.zip']);
    const nav = { canShare: () => true, share: async () => { throw err('NotAllowedError'); } };
    await withNav(nav, async () => assert.equal(await share.sendFile(file, { strictGesture: true }), 'blocked'));
    assert.equal(downloads.length, 1);
    await withNav({ canShare: () => true, share: async () => {} }, async () => assert.equal(await share.sendFile(file), 'shared'));
  } finally { globalThis.document = doc; globalThis.URL.createObjectURL = url; }
});
