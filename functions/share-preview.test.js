const { test } = require('node:test');
const assert = require('node:assert/strict');
const { routePreview, cragPreview, model3dPreview } = require('./share-preview');

test('路線：標題是名稱加難度，說明是岩館、牆、岩點數、定線者；缺的欄位省略', () => {
  const node = { name: '白白白', author: 'KK', props: { grade: { v: 'V3' }, holds: { a: 's', b: 'h', c: 't' } } };
  assert.deepEqual(routePreview({ node, wall: { name: '主牆', gym: '攀岩館' } }), { title: '白白白 V3', description: '攀岩館・主牆・3 顆岩點・定線 KK' });
  assert.deepEqual(routePreview({ node: { props: { grade: { dan: '3段' } } } }), { title: '3段', description: 'Climbio' });
  assert.deepEqual(routePreview({ node: null }), { title: 'Climbio', description: 'Climbio' });
});

test('岩場、3D 牆：沒有索引時只留名稱與種類', () => {
  assert.deepEqual(cragPreview({ name: '龍洞' }), { title: '龍洞', description: '紅點貓 Topo' });
  assert.deepEqual(model3dPreview({ type: 'wall3d', name: '主牆', gym: '攀岩館' }), { title: '主牆', description: '攀岩館・3D 牆・岩點貓' });
});

test('路線：牆名已含岩館名時不重複', () => {
  assert.equal(routePreview({ node: { props: { holds: { a: 's' } } }, wall: { name: '原岩明德 Spraywall', gym: '原岩明德' } }).description, '原岩明德 Spraywall・1 顆岩點');
});
