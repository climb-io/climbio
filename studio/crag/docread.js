// 讀路線書的檔案，轉成大綱（outline.js 的 Markdown），不用 AI：
//   Word（.docx，Google 文件「下載 → Microsoft Word」也是）、PDF（有文字的，不是掃描圖）、網頁（.html，或 Google 文件「下載 → 網頁（.html，壓縮）」的 ZIP）。
//   先讀成一串區塊 [{ t: 'title' | 'h' | 'p' | 'img' | 'table', level, text, src, rows }]（照文件順序），再由 toOutline 排成大綱。
//   blocksFromHtml、blocksFromDocx 要瀏覽器的 DOMParser；toOutline 是純文字，Node 也能跑。

import { parseOrder } from './outline.js';
const T = (...a) => AppKit.i18n.t(...a);   // 文字在呼叫時才查語言包（Node 測試、命令列也能用）

// ---- 區塊 → 大綱 ----
const APPROACH = /交通|車行|開車|停車|公車|捷運|大眾|導航|怎麼到|by car|transport|approach|access|parking|direction/i;
const NUMBERED = /^(\d+)\s*[.、．:：)]\s*(\S.{0,24})$/;
const clean = (s) => s.replace(/\s+/g, ' ').trim();
/** 標題的名稱：拿掉【】、前面的編號、中文後面接的英文翻譯 */
export function headingName(text) {
  let s = clean(text).replace(/^[【\[［]\s*/, '').replace(/\s*[】\]］]$/, '');
  s = s.replace(NUMBERED, '$2');
  const m = s.match(/^(.*[^\x00-\x7f].*?)\s*([A-Za-z][\x20-\x7e]*)$/);   // 「上攀區Rope Climbing Area」→「上攀區」
  if (m && /[^\x00-\x7f]$/.test(m[1])) s = m[1];
  return s.trim() || clean(text);
}
/** 書名 → 岩場名稱：拿掉「戶外岩場路線書」這類字尾 */
const cragName = (text) => clean(text).replace(/\s*(戶外)?(攀岩)?(岩場)?(路線書|路線指南|攀岩指南|guide\s*book|topo)$/i, '') || clean(text);
const cell = (v) => clean(v.replace(/\n/g, '\u0001')).replace(/\u0001\s*/g, '<br>').replace(/\|/g, '\\|');

/**
 * 區塊 → 大綱文字與摘要。規則：
 *   書名（title，沒有就是第一個標題）是「#」岩場；文件的標題層次往下排成「##」「###」…
 *   編號跟前後的標題接得上的一般段落（例如作者忘了設成標題的「15.沙漏石」）當成同一層的標題
 *   最上層的段落、跟交通有關的標題底下的文字收進岩場的交通；只有文字的其他最上層標題（警示、救援資訊）收進岩場的說明
 *   圖片後面緊接的一行短文字是圖說
 */
export function toOutline(blocks) {
  blocks = blocks.filter(b => b.t !== 'p' || clean(b.text));
  // 路線照照片由右至左（或由左至右）列：一行短字，例如「Right to left 右至左」；找到就寫成「排列」欄位，這行字不再留在文字裡
  const dirAt = blocks.findIndex(b => b.t === 'p' && clean(b.text).length <= 40 && parseOrder(b.text));
  const order = dirAt >= 0 ? parseOrder(blocks[dirAt].text) : undefined;
  if (dirAt >= 0) blocks.splice(dirAt, 1);
  const titleAt = blocks.findIndex(b => b.t === 'title');
  const levels = blocks.filter(b => b.t === 'h').map(b => b.level);
  const base = levels.length ? Math.min(...levels) : 1;
  // 忘了設成標題的編號段落
  let lastNum = null;
  blocks = blocks.map(b => {
    if (b.t === 'h') { const m = clean(b.text).match(NUMBERED); lastNum = m ? { n: Number(m[1]), level: b.level } : lastNum; return b; }
    if (b.t === 'p' && lastNum) {
      const m = clean(b.text).match(NUMBERED);
      if (m && Number(m[1]) === lastNum.n + 1) { lastNum = { n: lastNum.n + 1, level: lastNum.level }; return { t: 'h', level: lastNum.level, text: b.text, guessed: true }; }
    }
    return b;
  });
  // 排成樹：每個標題一節
  const root = { name: '', level: 0, body: [], kids: [] };
  if (titleAt >= 0) root.name = cragName(blocks[titleAt].text);
  const stack = [root];
  for (const [i, b] of blocks.entries()) {
    if (i === titleAt) continue;
    if (b.t === 'h') {
      const level = b.level - base + 1;
      while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
      const sec = { name: headingName(b.text), raw: clean(b.text), level, body: [], kids: [], guessed: b.guessed };
      stack[stack.length - 1].kids.push(sec); stack.push(sec);
      continue;
    }
    stack[stack.length - 1].body.push(b);
  }
  if (!root.name) root.name = root.kids[0]?.name || T('cdCragUntitled');
  const out = [`# ${root.name}`, ...(order ? [`排列：${order === 'rtl' ? '由右至左' : '由左至右'}`] : [])], note = { approach: [], description: [], dropped: 0, guessed: [] };
  const texts = (sec) => sec.body.filter(b => b.t === 'p').map(b => clean(b.text));
  const rich = (sec) => sec.kids.length || sec.body.some(b => b.t === 'table');
  for (const p of texts(root)) note.description.push(p);
  root.body.filter(b => b.t === 'img').forEach(() => note.dropped++);
  const sections = [];
  for (const sec of root.kids) {
    if (!rich(sec) && APPROACH.test(sec.raw)) {   // 交通：文字收進岩場，圖（路況、停車場的照片）不收
      note.approach.push(...texts(sec));
      note.dropped += sec.body.filter(b => b.t === 'img').length;
    } else if (!rich(sec) && !sec.body.some(b => b.t === 'img')) note.description.push(`【${sec.name}】`, ...texts(sec));
    else sections.push(sec);
  }
  const field = (key, lines) => { if (lines.length) out.push(`${key}：${lines[0]}`, ...lines.slice(1)); };
  field('交通', note.approach);
  if (note.approach.length && note.description.length) out.push('');
  field('說明', note.description);
  // 層數照樹的深度（文件跳級的標題，例如 h1 底下直接 h3，也只往下一層）
  const emit = (sec, depth) => {
    if (sec.guessed) note.guessed.push(sec.name);
    out.push('', `${'#'.repeat(Math.min(depth, 6))} ${sec.name}`);
    const body = sec.body;
    for (let i = 0; i < body.length; i++) {
      const b = body[i];
      if (b.t === 'img') {
        // 圖說：圖片後面緊接的短文字；這一節第一個就是圖片時，後面的文字多半是說明，不當圖說
        const next = body[i + 1];
        const caption = i > 0 && next?.t === 'p' && clean(next.text).length <= 40 ? clean(next.text) : '';
        if (caption) i++;
        out.push(`![${caption.replace(/[[\]]/g, '')}](${b.src})`);
      } else if (b.t === 'table') {
        const rows = b.rows.filter(r => r.some(c => clean(c)));
        if (!rows.length) continue;
        const width = Math.max(...rows.map(r => r.length));
        const line = (r) => `| ${Array.from({ length: width }, (_, k) => cell(r[k] || '')).join(' | ')} |`;
        out.push('', line(rows[0]), `|${' --- |'.repeat(width)}`, ...rows.slice(1).map(line), '');
      } else out.push(clean(b.text));
    }
    // 只有文字的小節（「General Access」「Great Wall Bloc」）不是岩壁：文字收進這一節的說明
    const textOnly = (k) => !k.kids.length && !k.body.some(b => b.t === 'table' || b.t === 'img');
    for (const k of sec.kids.filter(textOnly)) { if (k.guessed) note.guessed.push(k.name); out.push(`【${k.name}】`, ...texts(k)); }
    for (const k of sec.kids.filter(k => !textOnly(k))) emit(k, depth + 1);
  };
  for (const sec of sections) emit(sec, 2);
  return { text: out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n', dropped: note.dropped, guessed: note.guessed };
}

// ---- 網頁 ----
/** HTML 文字 → 區塊；圖片的 src 照原樣（ZIP 裡的相對路徑或網址） */
export function blocksFromHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = [];
  const textOf = (el) => {
    const c = el.cloneNode(true);
    c.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
    c.querySelectorAll('img').forEach(b => b.remove());
    return c.textContent.replace(/ /g, ' ');
  };
  const walk = (el) => {
    for (const n of el.children) {
      const tag = n.tagName.toLowerCase();
      if (['script', 'style', 'head', 'nav', 'footer'].includes(tag)) continue;
      if (tag === 'table') {
        out.push({ t: 'table', rows: [...n.querySelectorAll('tr')].map(tr => [...tr.children].map(td => [...td.querySelectorAll('p')].length > 1 ? [...td.querySelectorAll('p')].map(textOf).join('\n') : textOf(td))) });
        continue;
      }
      const h = tag.match(/^h([1-6])$/);
      const imgs = [...(tag === 'img' ? [n] : n.querySelectorAll('img'))].map(i => i.getAttribute('src')).filter(Boolean);
      if (h || tag === 'p' || tag === 'li' || tag === 'img' || (!n.querySelector('p, h1, h2, h3, h4, h5, h6, table, li, div') && n.textContent.trim())) {
        for (const src of imgs) out.push({ t: 'img', src });
        const text = tag === 'img' ? '' : textOf(n);
        if (n.classList.contains('title')) out.push({ t: 'title', text });
        else if (h) out.push({ t: 'h', level: Number(h[1]), text });
        else if (text.trim()) out.push({ t: 'p', text });
        continue;
      }
      walk(n);
    }
  };
  walk(doc.body);
  if (!out.some(b => b.t === 'title') && doc.title && !out.some(b => b.t === 'h' && b.level === 1)) out.unshift({ t: 'title', text: doc.title });
  return out;
}

// ---- Word ----
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
/** .docx 的 word/document.xml 與 word/_rels/document.xml.rels → 區塊；圖片的 src 是 ZIP 裡的路徑（word/media/…） */
export function blocksFromDocx(documentXml, relsXml) {
  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const rels = new Map([...xml(relsXml).getElementsByTagName('Relationship')].map(r => [r.getAttribute('Id'), r.getAttribute('Target')]));
  const doc = xml(documentXml), out = [];
  const kids = (el, name) => [...el.childNodes].filter(n => n.namespaceURI === W && n.localName === name);
  const textOf = (p) => [...p.getElementsByTagNameNS(W, '*')].map(n => (n.localName === 't' ? n.textContent : n.localName === 'br' || n.localName === 'cr' ? '\n' : n.localName === 'tab' ? ' ' : '')).join('');
  const para = (p) => {
    const style = p.getElementsByTagNameNS(W, 'pStyle')[0]?.getAttributeNS(W, 'val') || '';
    for (const blip of p.getElementsByTagNameNS('*', 'blip')) {
      const target = rels.get(blip.getAttributeNS(R, 'embed'));
      if (target) out.push({ t: 'img', src: target.startsWith('/') ? target.slice(1) : `word/${target}` });
    }
    const text = textOf(p);
    const h = style.match(/^(?:Heading|標題)\s*([1-6])$/i);
    if (/^Title$/i.test(style)) out.push({ t: 'title', text });
    else if (h) out.push({ t: 'h', level: Number(h[1]), text });
    else if (text.trim()) out.push({ t: 'p', text });
  };
  const body = doc.getElementsByTagNameNS(W, 'body')[0];
  for (const n of body ? body.childNodes : []) {
    if (n.namespaceURI !== W) continue;
    if (n.localName === 'p') para(n);
    else if (n.localName === 'tbl') out.push({ t: 'table', rows: kids(n, 'tr').map(tr => kids(tr, 'tc').map(tc => kids(tc, 'p').map(textOf).join('\n'))) });
  }
  return out;
}

// ---- PDF ----
// 路線標題的寫法：「1) 名稱」「(A) 名稱」（括號後面不一定有難度）；「1 - 名稱」「1. 名稱」「B1.2 名稱」「2 名稱 F5」（要有難度才算，不然只是文字裡的編號、破折號）
const PDF_ROUTE = [[/^\(?([A-Za-z]|\d{1,3})\)\s*(\S.*)$/, false], [/^(\d{1,3})\s+[-–]\s*(\S.*)$/, true], [/^(\d{1,3})\.\s*(\S.*)$/, true], [/^([A-Z]\d{1,2}\.\d{1,2})\s+(\S.*)$/, true], [/^(\d{1,3})\s+([A-Z].*)$/, true]];
const PDF_GRADE = /^(?:F\d[abc]?[+-]?|V(?:\d{1,2}|B)[+-]?|E\d|HVS|VS|HS|5\.\d{1,2}[a-d]?[+-]?|\d[abc]\+?)[,.]?$/i;
const PDF_FA = /^(?:F\.?\s?F\.?\s?A|F\.?\s?A|FA|First ascent)\b\.?:?\s*/i;

/** 從第 at 個字起連續的難度（可以有逗號、「-」隔開，例如「HVS 5b, F6b」「V0 - 4c」）的結尾位置 */
const gradeEnd = (tokens, at) => {
  let end = at;
  while (end < tokens.length && (PDF_GRADE.test(tokens[end]) || (/^[-–]$/.test(tokens[end]) && PDF_GRADE.test(tokens[end + 1] || '')))) end++;
  return end;
};

/**
 * 一行路線標題（去掉前面的編號）→ { name, grade, desc }：星號拿掉；第一個像難度的字起算是難度，難度後面接的字是說明（「B1.1 Slab Game V2 說明」）。
 * 難度在最前面的（「V0 - 4c Slanting Crack. 說明」）名稱是第一句，沒有第一句就沒有名稱
 */
function pdfRouteTitle(rest) {
  const tokens = clean(rest).replace(/\*+/g, ' ').split(' ').filter(Boolean);
  if (PDF_GRADE.test(tokens[0])) {
    const end = gradeEnd(tokens, 0), tail = tokens.slice(end).join(' '), m = tail.match(/^(.{1,50}?)[.!]\s+(.*)$/) || tail.match(/^([^.]{1,50})\.$/);
    return { name: m ? m[1] : '', grade: tokens.slice(0, end).join(' '), desc: m ? m[2] || '' : tail };
  }
  const at = tokens.findIndex((t, i) => i > 0 && PDF_GRADE.test(t));
  if (at < 0) return { name: tokens.join(' ').replace(/\s*[-–\uFFFD]$/, ''), grade: '', desc: '' };
  const end = gradeEnd(tokens, at);
  return { name: tokens.slice(0, at).join(' ').replace(/\s*[-–\uFFFD]$/, ''), grade: tokens.slice(at, end).join(' ').replace(/^[-–]\s*/, ''), desc: tokens.slice(end).join(' ') };
}

/** 一行是路線標題就回傳 { num, name, grade, desc }；名稱空的（只有難度）叫「路線 編號」 */
function pdfRoute(text) {
  for (const [re, needGrade] of PDF_ROUTE) {
    const m = text.match(re);
    if (!m || clean(m[2]).length < 2) continue;
    const t = pdfRouteTitle(m[2]);
    if (needGrade && !t.grade) continue;
    if (!t.grade && (clean(m[2]).length > 60 || /[.,;]$/.test(clean(m[2])))) continue;   // 沒有難度的長句、句子（一段文字的「1) …」）不是路線標題
    return { num: m[1], ...t, name: t.name || T('cdRouteN', m[1]) };
  }
  return null;
}

/** 換行斷開的字接回去（「prob-」「ably」），其他行接空白 */
const joinLines = (list) => list.reduce((s, t) => (/\w-$/.test(s) && /^[a-z]/.test(t) ? s.slice(0, -1) + t : s ? `${s} ${t}` : t), '');

/** 標題的小型大寫字母（「GeneRaL」「appRoach」）：字中間的大寫改小寫，字首補大寫 */
const fixCaps = (s) => (/\p{Ll}\p{Lu}/u.test(s) ? s.replace(/(?<=\p{Ll})\p{Lu}/gu, c => c.toLowerCase()).replace(/(^|\s)(\p{Ll})/gu, (_, a, c) => a + c.toUpperCase()) : s);

/**
 * PDF 讀到的文字 → 區塊：pages 是 [{ w, h, items: [{ str, x, y, h }] }]（x、y 是頁面座標，原點在左下，h 是字高；項目照 PDF 內容的順序，雙欄的 PDF 已經一欄一欄排好）。
 *   同一個 y 的字併成一行；上下邊緣的頁首頁尾（頁碼、網站名）不要
 *   字高比內文大一半以上的行是標題（第一頁最大的是書名），字越大層級越高
 *   「1) 路線名 *** F6b」開頭的行是一條路線，到下一條路線或標題之前是說明，「F.A. …」那行是首攀；連續的路線排成一張表格
 *   其他行依間距分段
 */
export function blocksFromPdf(pages) {
  const lines = [];
  for (const [pi, page] of pages.entries()) {
    let cur = null;
    for (const it of page.items) {
      if (!it.str.trim() || it.h < 3 || it.y < 30 || it.y > page.h - 25) continue;
      if (cur && Math.abs(cur.y - it.y) < 2) { cur.parts.push(it); cur.h = Math.max(cur.h, it.h); continue; }
      cur = { page: pi, y: it.y, h: it.h, parts: [it] };
      lines.push(cur);
    }
  }
  // 字之間的空隙很小的是同一個字（小型大寫字母、換行的連字號），不補空白
  for (const l of lines) {
    l.parts.sort((a, b) => a.x - b.x);
    l.text = clean(l.parts.map((p, i) => (i && p.x - (l.parts[i - 1].x + l.parts[i - 1].w) > p.h * 0.15 ? ' ' : '') + p.str).join(''));
  }
  // 目錄的點線、只有編號的行（名稱在別處）、只有座標的行不要
  lines.splice(0, lines.length, ...lines.filter(l => !/\.{6,}/.test(l.text) && !/^\(?\w{1,3}\)$/.test(l.text) && !/^\(?-?\d+\.\d+,\s*-?\d+\.\d+\)?$/.test(l.text)));
  const weight = new Map();
  for (const l of lines) weight.set(l.h, (weight.get(l.h) || 0) + l.text.length);
  const body = [...weight].sort((a, b) => b[1] - a[1])[0]?.[0] || 10;
  const sizes = [...new Set(lines.filter(l => l.h >= body * 1.5 && !pdfRoute(l.text)).map(l => l.h))].sort((a, b) => b - a);
  const out = [], first = lines.find(l => l.page === 0 && l.h >= body * 1.5 && !pdfRoute(l.text));
  let rows = null, route = null, para = null, prev = null;
  const endPara = () => { if (para) out.push({ t: 'p', text: joinLines(para) }); para = null; };
  const endRoute = () => {
    if (!route) return;
    (rows ||= [['代號', '名稱', '難度', '說明', '首攀']]).push([route.num, route.name, route.grade, joinLines(route.desc), route.fa]);
    route = null;
  };
  const endTable = () => { endRoute(); if (rows) out.push({ t: 'table', rows }); rows = null; };
  for (const l of lines) {
    const heading = l.h >= body * 1.5 && !pdfRoute(l.text);
    const gap = prev && prev.page === l.page ? prev.y - l.y : 0;
    const m = !heading && pdfRoute(l.text);
    if (heading) {
      endTable(); endPara();
      const text = fixCaps(l.text);
      if (l === first) out.push({ t: 'title', text });
      else if (!(prev?.heading && prev.h === l.h && gap > 0 && gap < l.h * 1.6)) out.push({ t: 'h', level: sizes.indexOf(l.h) + 1, text });
      else out[out.length - 1].text += ` ${text}`;
    } else if (m) {
      endPara(); endRoute();
      route = { ...m, desc: m.desc ? [m.desc] : [], fa: '' };
    } else if (route && gap <= body * 3) {
      const fa = l.text.match(PDF_FA);
      if (fa) route.fa = l.text.slice(fa[0].length);
      else route.desc.push(l.text);
    } else {
      endTable();
      if (para && (gap > body * 1.8 || l.page !== prev?.page)) endPara();
      (para ||= []).push(l.text);
    }
    prev = { ...l, heading };
  }
  endTable(); endPara();
  return out;
}

/** PDF 檔 → 區塊：用 pdf.js（studio/vendor/pdfjs，用到才載入）讀每一頁的文字，再交給 blocksFromPdf。掃描的 PDF 沒有文字，讀不到會丟錯 */
export async function readPdf(blob) {
  const lib = await import('../vendor/pdfjs/pdf.min.mjs');
  lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  const pdf = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n), view = page.getViewport({ scale: 1 }), text = await page.getTextContent();
    pages.push({ w: view.width, h: view.height, items: text.items.map(i => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width, h: i.height })) });
  }
  await pdf.destroy();
  if (pages.reduce((n, p) => n + p.items.reduce((m, i) => m + i.str.trim().length, 0), 0) < 30 * pages.length) throw new Error(T('cdPdfNoText'));
  return blocksFromPdf(pages);
}
