import test from 'node:test';
import assert from 'node:assert/strict';
import { theCragUrl, theCragLinks } from '../redpoint/thecrag-links.mjs';

test('theCrag 網址只接受官方 HTTPS 岩場頁', () => {
  assert.equal(theCragUrl('https://www.thecrag.com/en/climbing/france/area/123'), 'https://www.thecrag.com/en/climbing/france/area/123');
  assert.equal(theCragUrl('http://thecrag.com/14717155'), 'https://thecrag.com/14717155');
  for (const value of ['javascript:alert(1)', 'https://thecrag.com.evil.example/area/123', 'https://www.thecrag.com/', 'https://example.org/area/123', '']) {
    assert.equal(theCragUrl(value), '');
  }
});

test('連結來自索引（tcu）：單一岩場取自己的，沒有就沒有，不猜測網址', () => {
  assert.deepEqual(theCragLinks({ name: 'Test Crag', theCragUrl: 'https://www.thecrag.com/en/climbing/test/area/987' }), [{ name: 'Test Crag', url: 'https://www.thecrag.com/en/climbing/test/area/987' }]);
  assert.deepEqual(theCragLinks({ name: 'Missing' }), []);
});

test('合併岩場保留各自的連結，重複網址去重', () => {
  const crag = { members: [
    { name: 'A', theCragUrl: 'https://thecrag.com/111' },
    { name: 'B', theCragUrl: 'https://thecrag.com/111' },
    { name: 'C', theCragUrl: 'https://thecrag.com/333' },
    { name: 'D' },
  ] };
  assert.deepEqual(theCragLinks(crag), [
    { name: 'A', url: 'https://thecrag.com/111' },
    { name: 'C', url: 'https://thecrag.com/333' },
  ]);
});
