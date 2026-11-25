import test from 'node:test';
import assert from 'node:assert/strict';
import R from '../studio/wall/report.js';

const rect = (x, y, w = 20, h = 20) => [[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
const a = rect(10,10), b = rect(70,10), c = rect(130,10), x = rect(10,70);
const final = { id: 'human', ids: ['a','b','c'], polys: [a,b,c], reviewed: true };
const run = stages => R.analyze(stages, 200, 200);
test('穩定 ID：重描不改找到率，外框品質可改善', () => {
  const s = run([{ id:'holdscan', ids:['a','b','x'], polys:[rect(11,11,4,4),b,x] },
    { id:'sam2', ids:['a','b','x'], polys:[a,b,x] }, final]);
  const before = R.metrics(s[0], null, 3), after = R.metrics(s[1], s[0], 3);
  assert.equal(before.found, 2); assert.equal(before.extra, 1); assert.equal(before.ok, 1);
  assert.equal(after.found, 2); assert.equal(after.rate, 67); assert.equal(after.ok, 2);
  assert.deepEqual(after.delta, {found:0,extra:0,ok:1});
  assert.equal(s[0].estimated, false);
});
test('穩定 ID：刪掉真岩點與刪除誤判不能混淆', () => {
  const s = run([{id:'holdscan',ids:['a','b','x'],polys:[a,b,x]},
    {id:'ai',ids:['a'],polys:[a]}, final]);
  assert.deepEqual(R.metrics(s[1],s[0],3).delta,{found:-1,extra:-1,ok:-1});
});
test('沒有 ID 的舊資料只做估算，不假定順序或數量即身分', () => {
  const s = run([{id:'holdscan',polys:[b,x,a]}, {id:'human',polys:[a,b,c]}]);
  assert.equal(s[0].estimated,true);
  assert.equal(R.metrics(s[0],null,3).found,2);
  assert.equal(R.metrics(s[0],null,3).extra,1);
});
test('重複 ID 或不完整 ID 時退回估算', () => {
  const s = run([{id:'holdscan',ids:['a','a'],polys:[a,b]}, final]);
  assert.equal(s[0].estimated,true);
  assert.equal(R.metrics(s[0],null,3).found,2);
});
test('單階段不計找到率；空參考不提供百分比', () => {
  const s = run([{id:'holdscan',polys:[a,b]}]);
  assert.equal(R.metrics(s[0],null,2),null);
  const empty=run([{id:'holdscan',polys:[a]},{id:'human',polys:[]}]);
  assert.equal(R.metrics(empty[0],null,0),null);
  assert.equal(R.fromStages({version:2,stages:[{id:'human',polys:[]}]}).length,1);
});
test('階段資料保留有效 ID 與檢查狀態', () => {
  const stages = R.fromStages({version:2,stages:[{id:'holdscan',polys:[a],ids:['a']},{id:'human',polys:[a],ids:['a'],reviewed:true}]});
  assert.deepEqual(stages[0].ids,['a']);
  assert.equal(stages[1].reviewed,true);
  assert.equal(run(stages)[0].estimated,false);
});
test('AI 完成不冒充人工；尚未校正只留自動偵測', () => {
  const holds=[{id:'a',poly:a}];
  assert.equal(R.fromRecord({reviewed:false},holds).length,1);
  const s=R.fromRecord({reviewed:true,reviews:[{by:'agent:test',kind:'ai-verify'}]},holds);
  assert.equal(s.at(-1).id,'ai');
  assert.equal(s.at(-1).reviewed,true);
  const h=R.fromRecord({reviewed:true,reviews:[{by:'agent:test',kind:'ai-verify'},{by:'human:test',kind:'human'}]},holds);
  assert.equal(h.at(-1).id,'human');
});
