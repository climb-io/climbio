// RouteKit 長按辨識（routekit/viewport.js 的 LongPress）：計時、容差、多指、取消、失焦、解除註冊、click 抑制、一次性分派
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { RouteKit } from './routekit.mjs';

const { LongPress } = RouteKit;
const mk = () => {
  const L = new Map(), add = (t, f) => { if (!L.has(t)) L.set(t, new Set()); L.get(t).add(f); };
  const target = () => ({
    addEventListener: add, removeEventListener: (t, f) => L.get(t)?.delete(f),
    fire(t, e = {}) { let p = false; const ev = { preventDefault() { p = true; }, ...e }; for (const f of [...(L.get(t) || [])]) f(ev); return p; },
    count: () => [...L.values()].reduce((n, s) => n + s.size, 0),
  });
  return target();
};
const ptr = (id = 1, x = 10, y = 10, o = {}) => ({ pointerId: id, clientX: x, clientY: y, pointerType: 'touch', isPrimary: true, button: 0, ...o });
const setup = (opts = {}) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const el = mk(), win = mk(), fired = [];
  const lp = new LongPress(el, { accept: () => 'ctx', onFire: (c, e) => fired.push([c, e.pointerId]), win, ...opts });
  return { el, win, fired, lp };
};
test.afterEach(() => mock.timers.reset());

test('短按：放開前沒到時間不觸發', () => {
  const { el, fired } = setup();
  el.fire('pointerdown', ptr()); mock.timers.tick(300); el.fire('pointerup', ptr()); mock.timers.tick(1000);
  assert.deepEqual(fired, []);
});
test('正常長按：到時間觸發一次，放開後不再觸發，context 與按下事件原樣交給 onFire', () => {
  const { el, fired, lp } = setup();
  el.fire('pointerdown', ptr(7)); assert.equal(lp.pending, true);
  mock.timers.tick(519); assert.equal(fired.length, 0);
  mock.timers.tick(1); assert.deepEqual(fired, [['ctx', 7]]); assert.equal(lp.pending, false);
  mock.timers.tick(2000); el.fire('pointerup', ptr(7)); assert.equal(fired.length, 1);
});
test('單指移動容差：8px 內仍算長按，超過取消', () => {
  const a = setup(); a.el.fire('pointerdown', ptr()); a.el.fire('pointermove', ptr(1, 17, 10)); mock.timers.tick(520); assert.equal(a.fired.length, 1);
  mock.timers.reset();
  const b = setup(); b.el.fire('pointerdown', ptr()); b.el.fire('pointermove', ptr(1, 19, 10)); mock.timers.tick(520); assert.equal(b.fired.length, 0);
});
test('別的指標的移動不影響計時', () => {
  const { el, fired } = setup(); el.fire('pointerdown', ptr(1)); el.fire('pointermove', ptr(2, 500, 500)); mock.timers.tick(520); assert.equal(fired.length, 1);
});
test('第二根手指按下取消長按，兩指都放開後下一次按下可再長按', () => {
  const { el, fired } = setup();
  el.fire('pointerdown', ptr(1)); el.fire('pointerdown', ptr(2, 30, 30, { isPrimary: false })); mock.timers.tick(1000); assert.equal(fired.length, 0);
  el.fire('pointerup', ptr(2)); el.fire('pointerup', ptr(1));
  el.fire('pointerdown', ptr(3)); mock.timers.tick(520); assert.equal(fired.length, 1);
});
test('第一根手指的放開沒送到：新的主要指標按下會清掉殘留，不被當成多指', () => {
  const { el, fired } = setup(); el.fire('pointerdown', ptr(1)); el.fire('pointerdown', ptr(9)); mock.timers.tick(520); assert.equal(fired.length, 1);
});
test('pointercancel、lostpointercapture、視窗失焦都取消', () => {
  for (const kind of ['pointercancel', 'lostpointercapture', 'blur']) {
    const { el, win, fired } = setup();
    el.fire('pointerdown', ptr()); kind === 'blur' ? win.fire('blur') : el.fire(kind, ptr()); mock.timers.tick(1000);
    assert.equal(fired.length, 0, kind); mock.timers.reset();
  }
});
test('滑鼠：右鍵不計時，左鍵可以長按；accept 回傳 falsy 不計時', () => {
  const a = setup(); a.el.fire('pointerdown', ptr(1, 1, 1, { pointerType: 'mouse', button: 2 })); mock.timers.tick(600); assert.equal(a.fired.length, 0); mock.timers.reset();
  const b = setup(); b.el.fire('pointerdown', ptr(1, 1, 1, { pointerType: 'mouse' })); mock.timers.tick(520); assert.equal(b.fired.length, 1); mock.timers.reset();
  const c = setup({ accept: () => null }); c.el.fire('pointerdown', ptr()); mock.timers.tick(600); assert.equal(c.fired.length, 0);
});
test('onFire 丟例外不影響後續手勢；連續兩次按壓各觸發一次', () => {
  let n = 0; const { el } = setup({ onFire: () => { n++; throw new Error('hook'); } });
  el.fire('pointerdown', ptr()); mock.timers.tick(520); el.fire('pointerup', ptr());
  el.fire('pointerdown', ptr()); mock.timers.tick(520); assert.equal(n, 2);
});
test('click 抑制：armClick 後只吃一次、超時失效', () => {
  const { lp } = setup();
  assert.equal(lp.eatsClick(), false);
  lp.armClick(); assert.equal(lp.eatsClick(), true); assert.equal(lp.eatsClick(), false);
  lp.armClick(); mock.timers.tick(80); assert.equal(lp.eatsClick(), false);
});
test('長按中與剛觸發後的 contextmenu 被擋下，平常放行', () => {
  const { el, lp } = setup();
  assert.equal(el.fire('contextmenu'), false);
  el.fire('pointerdown', ptr()); assert.equal(el.fire('contextmenu'), true);
  mock.timers.tick(520); lp.armClick(); assert.equal(el.fire('contextmenu'), true);
});
test('destroy：解除全部監聽、清掉計時，之後的事件不再觸發', () => {
  const { el, win, fired, lp } = setup();
  el.fire('pointerdown', ptr()); lp.destroy(); mock.timers.tick(1000);
  assert.equal(fired.length, 0); assert.equal(el.count(), 0); assert.equal(win.count(), 0);
  el.fire('pointerdown', ptr()); mock.timers.tick(1000); assert.equal(fired.length, 0);
});
