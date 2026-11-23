import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// appkit/share-tools.js 的 linkFrom：貼上的文字 → { pid, rid, src }
const src = readFileSync(new URL('../appkit/share-tools.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n');   // Windows 的 git 會把換行轉成 CRLF，下面照 \n 切
const pick = (start, end) => src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start)) + end.length);
const ctx = vm.createContext({ URL });
const line = (s) => src.split('\n').find(l => l.includes(s));
vm.runInContext(`${line('const PID_RE =')}\n${line('const REMOTE =')}
${line('const DEV_SITE =')}
${line('const SHORT_WALL =')}\n${pick('  function linkFrom(text) {', '\n  }\n')}\nthis.linkFrom = linkFrom;`, ctx);

test('路線連結 /r/照片編號/路線/、App 網址 ?p=&r= 都認得（任何網域，src 指回那台）；舊的快照代碼和不完整的不認', () => {
  assert.deepEqual({ ...ctx.linkFrom('https://climbio.web.app/r/abcdefgh1234/r1abc/?openExternalBrowser=1') }, { pid: 'abcdefgh1234', rid: 'r1abc', src: 'https://climbio.web.app/r/abcdefgh1234/r1abc/' });
  assert.deepEqual({ ...ctx.linkFrom('看這條 https://climbio-dev.web.app/r/abcdefgh1234/r1abc/') }, { pid: 'abcdefgh1234', rid: 'r1abc', src: 'https://climbio-dev.web.app/r/abcdefgh1234/r1abc/' });
  assert.deepEqual({ ...ctx.linkFrom('https://climbio.web.app/?p=abcdefgh1234&r=r9') }, { pid: 'abcdefgh1234', rid: 'r9', src: 'https://climbio.web.app/r/abcdefgh1234/r9/' });
  assert.deepEqual({ ...ctx.linkFrom('https://wall.example.org/r/abcdefgh1234/r1abc') }, { pid: 'abcdefgh1234', rid: 'r1abc', src: 'https://wall.example.org/r/abcdefgh1234/r1abc/' });
  assert.equal(ctx.linkFrom('http://127.0.0.1:8765/r/abcdefgh1234/r1abc/').src, 'https://climbio-dev.web.app/r/abcdefgh1234/r1abc/');   // 本機預覽讀開發版
  assert.deepEqual({ ...ctx.linkFrom('https://climbio.app/?wall=0fe38b21d07b3771/nbh6yueynqa0.json') }, { wall: 'https://climbio.app/p/0fe38b21d07b3771/nbh6yueynqa0.json' });   // 牆的短連結補成 /p/專案 id/檔名
  for (const s of ['https://climbio.web.app/?s=ABCDEFGH23&r=r9', 'https://climbio.web.app/r/ABCDEFGH23/r1/', 'abcdefgh1234', 'https://climbio.web.app/?p=abcdefgh1234', 'https://climbio.web.app/r/nope/r1/'])
    assert.equal(ctx.linkFrom(s), null, s);
});
