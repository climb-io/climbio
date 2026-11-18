// 元件說明頁：網頁（給人看）由 kits/content 產生，頁面不能跟內容脫節；每個元件有繁體中文與英文兩版內容，資料夾有給 AI 讀的 README.md 與 README.en.md。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { pages, loadKits, ORDER } from './build-kits.mjs';

const root = new URL('../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8').replace(/\r\n/g, '\n');   // Windows 的 autocrlf 會把工作目錄的檔案換成 CRLF
const cjk = /[\u3400-\u9fff]/;
const FIELDS = ['tagline', 'what', 'install', 'example', 'notes'];

test('說明頁是 kits/content 的產物：改了內容要跑 node tools/build-kits.mjs', async () => {
  for (const [path, html] of Object.entries(await pages())) {
    assert.ok(existsSync(new URL(path, root)), `${path} 還沒產生`);
    assert.equal(read(path), html, `${path} 沒跟上 kits/content`);
  }
});

test('每個元件兩種語言的內容都齊：英文版是英文，中文版有中文，三個重點', async () => {
  for (const k of await loadKits()) {
    assert.ok(ORDER.includes(k.id) && k.folder && k.license, `${k.id} 缺基本欄位`);
    for (const lang of ['zh', 'en']) {
      const c = k[lang];
      for (const f of FIELDS) assert.ok(c?.[f]?.trim(), `${k.id}.${lang}.${f} 是空的`);
      assert.equal(c.points.length, 3, `${k.id}.${lang} 要三個重點`);
      for (const p of c.points) assert.ok(p.h?.trim() && p.p?.trim(), `${k.id}.${lang} 的重點不完整`);
    }
    const english = [k.en.tagline, k.en.what, k.en.notes, ...k.en.points.flatMap((p) => [p.h, p.p])].join(' ');
    assert.doesNotMatch(english, cjk, `${k.id} 的英文版有中文字`);
    assert.match([k.zh.tagline, k.zh.what].join(''), cjk, `${k.id} 的中文版沒有中文`);
  }
});

test('每個元件資料夾有給 AI 讀的 README.md（繁體中文）與 README.en.md（英文），範例程式碼兩版一致', async () => {
  for (const id of ORDER) {
    for (const f of ['README.md', 'README.en.md']) assert.ok(existsSync(new URL(`${id}/${f}`, root)), `${id}/${f} 不存在`);
    const zh = read(`${id}/README.md`), en = read(`${id}/README.en.md`);
    // 英文版可以有語言切換連結、引用程式裡的中文字串（錯誤訊息、顏色名）；但不能有整行中文的說明
    for (const line of en.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '').split('\n')) {
      const n = (line.match(/[㐀-鿿]/g) || []).length;
      assert.ok(n === 0 || n / line.length < 0.25, `${id}/README.en.md 有中文說明：${line.slice(0, 60)}`);
    }
    assert.match(zh, cjk, `${id}/README.md 沒有中文`);
    const blocks = (s) => [...s.matchAll(/```[a-z]*\n([\s\S]*?)```/g)].length;
    assert.equal(blocks(en), blocks(zh), `${id} 兩版的程式碼區塊數量不同`);
    assert.equal((en.match(/^## /gm) || []).length, (zh.match(/^## /gm) || []).length, `${id} 兩版的章節數量不同`);
  }
});
