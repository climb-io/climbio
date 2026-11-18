import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const profile = readFileSync(new URL('../js/profile.js', import.meta.url), 'utf8');
const exp = readFileSync(new URL('../js/export.js', import.meta.url), 'utf8');
const sync = readFileSync(new URL('../js/sync.js', import.meta.url), 'utf8');
const declaration = (source, name) => source.split('\n').find(line => line.includes(`const ${name} =`));
function setup() {
  let signature = 'Kant Kang';
  const ctx = vm.createContext({ deviceId: () => 'mine', signName: () => signature, hash53: text => text, OLD_DEVICES_KEY: 'devices', lsGet: (k, d) => k === 'devices' ? ['before-login'] : d });
  const source = [declaration(profile, 'mineRoute'), declaration(exp, 'routeAuthor'), declaration(sync, 'pubRoute'), declaration(sync, 'pubSig')].join('\n');
  vm.runInContext(`${source}\nthis.api = { routeAuthor, pubRoute, pubSig };`, ctx);
  return { ...ctx.api, setSign: value => { signature = value; } };
}

test('自己的路線與分享後又收回來的本人副本，使用目前簽名；別人署名及留空都保留', () => {
  const s = setup();
  assert.equal(s.routeAuthor({ id: 'new' }), 'Kant Kang');
  assert.equal(s.routeAuthor({ author: '', u: 'mine' }), 'Kant Kang');
  assert.equal(s.routeAuthor({ author: '舊署名', u: 'mine' }), 'Kant Kang');
  assert.equal(s.routeAuthor({ author: '舊署名', u: 'before-login' }), 'Kant Kang');   // 登入前用舊手機 id 分享出去又收回來的
  assert.equal(s.routeAuthor({ author: 'Other', u: 'other' }), 'Other');
  assert.equal(s.routeAuthor({ author: '', u: 'other' }), '');
  s.setSign('');
  assert.equal(s.routeAuthor({ author: '舊署名', u: 'mine' }), '');
});

test('簽名改了，分享過的自己的路線要重新上傳；別人的路線不受影響，也不帶本機的分享紀錄', () => {
  const s = setup(), mine = { id: 'mine-route', author: '', u: 'mine', pub: 'x', got: 5 }, other = { id: 'other-route', author: 'Other', u: 'other' };
  s.setSign(''); const before = s.pubSig(mine), otherBefore = s.pubSig(other);
  s.setSign('Kant Kang');
  assert.notEqual(s.pubSig(mine), before);
  assert.equal(s.pubSig(other), otherBefore);
  const out = s.pubRoute(mine);
  assert.equal(out.author, 'Kant Kang');
  assert.equal(out.u, 'mine');
  assert.equal('pub' in out, false);
  assert.equal('got' in out, false);
  assert.equal(mine.author, '');   // 不改使用者的路線原始資料
});
