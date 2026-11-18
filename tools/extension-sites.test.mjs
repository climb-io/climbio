import test from 'node:test';
import assert from 'node:assert/strict';
import { SITES, siteOf } from '../extension/sites.js';

test('網址對應網站：網域或子網域；長得像的別的網域不算；不認得就是 undefined', () => {
  const id = (url) => siteOf(url)?.id;
  assert.equal(id('https://www.thecrag.com/zh_hans/climbing/china/yangshuo/white-mountain'), 'thecrag');
  assert.equal(id('https://thecrag.com/'), 'thecrag');
  assert.equal(id('https://longdong.web.app/'), undefined);
  assert.equal(id('https://openclimbing.org/relation/17457880'), 'openclimbing');
  assert.equal(id('https://hongkongclimbing.com/routes/hong-kong/ap-lei-chau/ap-lei-chau-crags/welcome-wall/'), 'hkclimbing');
  assert.equal(id('https://openbeta.io/areas/x'), undefined);
  assert.equal(id('https://27crags.com/crags/x'), undefined);
  assert.equal(id('https://www.thetopo.com/site/terms'), undefined);
  assert.equal(id('https://www.mountainproject.com/area/105708959'), undefined);
  assert.equal(id('https://evil-thecrag.com/'), undefined);
  assert.equal(id('https://thecrag.com.evil.example/'), undefined);
  assert.equal(id('https://example.com/'), undefined);
  assert.equal(id('chrome://extensions'), undefined);
  assert.equal(id('not a url'), undefined);
});

test('只列出已實作轉接器的來源', () => {
  assert.deepEqual(SITES.filter((x) => x.status === 'supported').map((x) => x.id), ['thecrag', 'hkclimbing', 'openclimbing']);
  assert.equal(new Set(SITES.flatMap((s) => s.hosts)).size, SITES.flatMap((s) => s.hosts).length, '網域不重複');
});
