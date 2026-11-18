// 文字長度檢查（在瀏覽器裡跑）：目前打開的畫面在每種語言下，找出被截斷（…）、超出容器、跑出畫面或按鈕被擠成兩行的文字。
// 用法：手機寬度打開要檢查的畫面（選單、對話框開著也可以），在 console 執行
//   const s = document.createElement('script'); s.src = 'tools/textfit.js'; document.head.append(s);
//   await textFit('牆面頁');   // 回傳 [{ lang, screen, kind, text, ... }]，沒問題是空陣列；跑完切回原本的語言設定
(function () {
  const $ = (id) => document.getElementById(id);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  // 有自己的文字（不只是子元素的）才檢查
  const ownText = (el) => [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
  // 在可以左右捲動的容器裡，跑出畫面是正常的
  const inScroller = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const c = getComputedStyle(p);
      if ((c.overflowX === 'auto' || c.overflowX === 'scroll') && p.scrollWidth > p.clientWidth + 1 && p.scrollHeight <= p.clientHeight + 1) return true;   // 只算橫向捲動區（例如使用介紹的卡片）
    }
    return false;
  };
  // 只看最上層的畫面／對話框（底下被蓋住的不算）
  function layer() {
    const open = [...document.querySelectorAll('.guide-backdrop, .sheet-backdrop, .menu, #editor, #crop')].filter(e => !e.hidden && visible(e));
    return open.length ? open[open.length - 1] : document.body;
  }
  function scan(root, lang, screen, out) {
    for (const el of root.querySelectorAll('*')) {
      if (!ownText(el) || !visible(el) || /^(SCRIPT|STYLE|OPTION|svg|text|tspan)$/i.test(el.tagName)) continue;
      const cs = getComputedStyle(el), r = el.getBoundingClientRect(), text = el.textContent.trim().slice(0, 60);
      const clip = cs.overflowX !== 'visible' || cs.textOverflow === 'ellipsis';
      if (el.scrollWidth > el.clientWidth + 1) out.push({ lang, screen, kind: clip ? '被截斷' : '文字超出元素', text, need: el.scrollWidth, has: el.clientWidth });
      else if (!inScroller(el) && (r.right > innerWidth + 1 || r.left < -1)) out.push({ lang, screen, kind: '跑出畫面', text, right: Math.round(r.right), width: innerWidth });
      // 超出對話框、選單、側欄的邊界
      const box = el.closest('.guide-card, .sheet, .menu');
      if (box && !inScroller(el)) { const b = box.getBoundingClientRect(); if (r.right > b.right + 1 || r.left < b.left - 1) out.push({ lang, screen, kind: '超出邊界', text }); }
      // 超出父元素（父元素有裁切時才會看不到）
      const p = el.parentElement;
      if (p && !inScroller(el)) {
        const pr = p.getBoundingClientRect(), pcs = getComputedStyle(p);
        if (pcs.overflow !== 'visible' && (r.right > pr.right + 1 || r.bottom > pr.bottom + 1) && p.scrollHeight <= p.clientHeight + 1) out.push({ lang, screen, kind: '超出容器', text });
      }
      // 按鈕、標籤裡的文字被擠成兩行以上（用文字實際排出來的行數判斷）
      if (el.closest('button, .btn, .type-btn, .sheet-btn, .menu')) {
        const rg = document.createRange(), tops = new Set();
        for (const n of el.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { rg.selectNodeContents(n); for (const q of rg.getClientRects()) if (q.width > 1) tops.add(Math.round(q.top)); }
        if (tops.size > 1) out.push({ lang, screen, kind: '按鈕換行', text });
      }
    }
  }
  const setLang = async (v) => { document.querySelector(`.lang-opt[data-lang="${v}"]`).click(); await wait(500); };
  self.textFit = async function (screen = '目前畫面') {
    const before = document.querySelector('.lang-opt[aria-pressed="true"]')?.dataset.lang || 'auto', out = [];
    const top = layer();
    const langs = [...document.querySelectorAll('.lang-opt')].map(b => b.dataset.lang).filter(l => l !== 'auto');
    if (langs.length) {
      for (const lang of langs) { await setLang(lang); scan(top, lang, screen, out); }
      await setLang(before);
    } else scan(top, self.AppKit?.i18n?.lang || document.documentElement.lang, screen, out);
    // 同一個問題只留一筆
    const seen = new Set();
    return out.filter(x => { const k = x.lang + x.kind + x.text; if (seen.has(k)) return false; seen.add(k); return true; });
  };
})();
