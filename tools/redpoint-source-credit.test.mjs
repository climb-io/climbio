import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceLabel } from '../redpoint/source-credit.mjs';

test('卡片直接讀取新版匯入器的短來源標籤', () => {
  assert.equal(sourceLabel({ props: { sourceLabel: 'OpenStreetMap' }, license: 'ODbL-1.0' }), 'OpenStreetMap');
  assert.equal(sourceLabel({ props: { sourceLabel: 'theCrag', attributionStatus: 'unverified' }, license: 'NOASSERTION' }), 'theCrag');
});

test('不向前相容：舊署名或來源網址不能當成短標籤', () => {
  assert.equal(sourceLabel({ attribution: '© OpenStreetMap contributors', license: 'ODbL-1.0' }), '');
  assert.equal(sourceLabel({ attribution: '來源：theCrag（個別作者待確認）', license: 'NOASSERTION' }), '');
  assert.equal(sourceLabel({ source: { url: 'https://www.thecrag.com/example' } }), '');
  assert.equal(sourceLabel({ attribution: '某位攝影師（Wikimedia Commons）' }), '');
  assert.equal(sourceLabel(null), '');
});

test('短來源標籤不覆寫原作者、授權與網址', () => {
  const doc = { props: { sourceLabel: 'OpenStreetMap' }, attribution: '© OpenStreetMap contributors', license: 'ODbL-1.0', source: { url: 'https://www.openstreetmap.org/relation/123' } };
  assert.equal(sourceLabel(doc), 'OpenStreetMap');
  assert.deepEqual(doc, { props: { sourceLabel: 'OpenStreetMap' }, attribution: '© OpenStreetMap contributors', license: 'ODbL-1.0', source: { url: 'https://www.openstreetmap.org/relation/123' } });
});
