// 報告的共用框架（岩館牆的岩點報告、3D 牆、天然岩場的量測；Studio 和 Lab 的頁面共用）：一排步驟卡，每張是步驟名稱、在哪裡跑、一個大數字和幾行小字，
// 下面是數字的定義和限制。不看是哪條線：各線把自己的資料整理成步驟（studio/wall/report.js、studio/wall3d/report.js、studio/crag/lab-report.js），交給這裡畫。
// ClimbioReportFrame.steps(容器 <ol>, [{ name, where?, value?, unit?, lines?: [{ text, tone? }] }], { current?, onPick? })：有 onPick 的卡是按鈕
// ClimbioReportFrame.notes(容器, { defn?, limits?: [文字] })
(function (root) {
  'use strict';
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

  function steps(ol, list, { current = -1, onPick } = {}) {
    ol.classList.add('rp-steps');
    ol.replaceChildren(...list.map((s, i) => {
      const card = el(onPick ? 'button' : 'div', 'rp-step');
      if (onPick) { card.type = 'button'; card.setAttribute('aria-pressed', i === current); card.onclick = () => onPick(i); }
      card.append(el('span', 'rp-n', String(i + 1)), el('b', '', s.name));
      if (s.where) card.append(el('span', 'rp-where', s.where));
      const sc = el('div', 'rp-score');
      if (s.value != null) { sc.append(el('strong', '', String(s.value))); if (s.unit) sc.append(el('em', '', s.unit)); }
      if (s.lines && s.lines.length) {
        const nums = el('span', 'rp-nums');
        for (const l of s.lines) nums.append(el('i', l.tone === 'bad' ? 'bad' : l.tone === 'warn' ? 'rp-warn' : '', l.text));
        sc.append(nums);
      }
      card.append(sc);
      const li = el('li'); li.append(card); return li;
    }));
  }
  function select(ol, i) { [...ol.querySelectorAll('.rp-step')].forEach((b, j) => b.setAttribute('aria-pressed', j === i)); }
  function notes(box, { defn, limits = [] } = {}) {
    box.replaceChildren();
    if (defn) box.append(el('p', 'rp-defn', defn));
    if (limits.length) { const ul = el('ul', 'rp-limits'); for (const t of limits) ul.append(el('li', '', t)); box.append(ul); }
  }

  root.ClimbioReportFrame = { steps, select, notes };
})(globalThis);
