// 岩點報告的畫面（Studio Wall 的「報告」、已公開的牆、Lab 的 Hold Lab 頁共用）：一排步驟卡（每一步的數字，studio/report-frame.js 畫），下面一張大照片疊上那一步的外框，
// 跟前一步左右對照、標出問題、跳到改過的地方；可以縮放、拖曳。數字與分類由 report.js（ClimbioReport.analyze）算。
// ClimbioReportView.mount(容器, T) → { show({ photo: Blob|網址, w, h, stages }), message(文字) }；T(key, ...參數) 回傳介面文字（key 前綴 rp）
(function (root) {
  'use strict';
  const LIME = '#B7FF3C';
  const COLORS = { ok: '#2BB673', cut: '#F0A020', over: '#9B6BFF', extra: '#FF4D5E', missed: '#4C8DFF', kept: '#2BB673', edited: '#F0A020', manual: '#4C8DFF', deleted: '#FF4D5E' };
  const DASHED = new Set(['missed', 'deleted']);
  const NAME = { holdscan: 'rpDetect', mobilesam: 'rpRetrace', sam2: 'rpSam2', ai: 'rpAi', human: 'rpHuman' };
  const LEGEND = { auto: ['ok', 'cut', 'over', 'extra', 'missed'], answer: ['kept', 'edited', 'manual', 'deleted'] };
  const LABEL = { ok: 'rpOk', cut: 'rpCut', over: 'rpOver', extra: 'rpExtra', missed: 'rpMissed', kept: 'rpKept', edited: 'rpEdited', manual: 'rpManual', deleted: 'rpDeleted' };
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

  function mount(box, T) {
    box.classList.add('rp');
    box.innerHTML = '';
    const steps = el('ol', 'rp-steps'), stage = el('div', 'rp-view'), cv = el('canvas'), msg = el('div', 'rp-msg'), tools = el('div', 'rp-tools');
    const fitB = el('button', '', T('rpFit')), exB = el('button', ''), probB = el('button', '', T('rpProblems'));
    [fitB, exB, probB].forEach(b => { b.type = 'button'; tools.append(b); });
    probB.setAttribute('aria-pressed', 'false');
    cv.width = 1600; cv.height = 1000; cv.setAttribute('aria-label', T('rpCanvasAria'));
    stage.append(cv, msg, tools);
    const cmpBox = el('div', 'rp-cmp'), cmpL = el('b'), cmpR = el('b'), cmp = Object.assign(el('input'), { type: 'range', min: 0, max: 100, value: 50 });
    cmp.setAttribute('aria-label', T('rpCompare'));
    cmpBox.append(cmpL, cmp, cmpR);
    const legend = el('div', 'rp-legend'), defn = el('p', 'rp-defn');
    box.append(steps, stage, cmpBox, legend, defn);
    const ctx = cv.getContext('2d');

    let data = null, img = null, cur = 0, problems = false, cursor = {}, view = { k: 1, x: 0, y: 0 }, token = 0;
    const prepared = new WeakMap();
    const bbox = ClimbioReport.bbox;

    function message(t) { msg.hidden = !t; msg.textContent = t || ''; steps.hidden = cmpBox.hidden = legend.hidden = defn.hidden = tools.hidden = !!t; if (t) { ++token; data = null; img = null; ctx.clearRect(0, 0, cv.width, cv.height); } }
    async function show({ photo, w, h, stages }) {
      if (!stages || !stages.length) { message(T('rpNone')); return; }
      message(T('rpLoading'));
      const my = ++token;
      let cached = prepared.get(stages);
      if (!cached || cached.photo !== photo || cached.w !== w || cached.h !== h) {
        const url = typeof photo === 'string' ? photo : URL.createObjectURL(photo);
        let im;
        try { im = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = url; }); }
        catch (e) { if (my === token) message(T('rpFail')); return; }
        finally { if (typeof photo !== 'string') setTimeout(() => URL.revokeObjectURL(url), 0); }
        if (my !== token) return;
        await new Promise(r => setTimeout(r, 0));
        if (my !== token) return;
        cached = { photo, w, h, im, analyzed: ClimbioReport.analyze(stages, w, h) };
        prepared.set(stages, cached);
      }
      if (my !== token) return;
      data = { w, h, stages: cached.analyzed }; img = cached.im;
      message('');
      cv.height = Math.round(cv.width * h / w);
      problems = false; probB.setAttribute('aria-pressed', 'false'); view = { k: 1, x: 0, y: 0 };
      fillSteps(); select(cached.analyzed.length - 1);
    }

    // ---- 步驟卡：每一步的數字；按了照片換成那一步 ----
    // 步驟卡交給共用的報告框架（studio/report-frame.js）：自動的步驟寫找到率和實際顆數，最後一步寫參考總數與修改顆數
    function fillSteps() {
      const last = data.stages[data.stages.length - 1], total = last.polys.length;
      const deltaText = n => n ? ' (' + (n > 0 ? '+' : '') + n + ')' : '';
      ClimbioReportFrame.steps(steps, data.stages.map((s, i) => {
        const name = T(NAME[s.id] || s.id);
        if (s.answer) {
          const c = s.counts, lines = [];
          if (s.id === 'holdscan') lines.push({ text: T('rpUncorrected'), tone: 'warn' });
          else if (s.reviewed === true && s.id === 'human') lines.push({ text: T('rpHumanDone') });
          else if (s.reviewed === true && s.id === 'ai') lines.push({ text: T('rpAiDone') });
          else if (s.reviewed === false) lines.push({ text: T('rpNotReviewed'), tone: 'warn' });
          else lines.push({ text: T('rpReviewUnknown'), tone: 'warn' });
          if (c) lines.push({ text: T('rpChanged', c.edited, c.deleted, c.manual) });
          return { name, value: s.polys.length, unit: T('rpHolds'), lines };
        }
        const m = ClimbioReport.metrics(s, data.stages[i - 1], total);
        if (!m) return { name, value: s.polys.length, unit: T('rpHolds'), lines: [{ text: T('rpNoReference'), tone: 'warn' }] };
        return { name, where: T('rpFound'), value: m.found + '/' + total, unit: T('rpHolds') + ' (' + m.rate + '%)' + deltaText(m.delta.found), lines: [
          { text: T('rpFalse', m.extra + ' ' + T('rpHolds')) + deltaText(m.delta.extra), tone: m.extra ? 'bad' : '' },
          { text: T('rpSnug', m.ok + ' ' + T('rpHolds')) + deltaText(m.delta.ok) }
        ] };
      }), { current: cur, onPick: i => select(i) });
      defn.textContent = data.stages.length === 1 || !total ? T('rpNoReference') :
        T('rpDefn', T(NAME[last.id] || last.id)) + (data.stages.some(s => s.estimated) ? ' ' + T('rpEstimated') : '');
    }
    function select(i) {
      cur = i; cursor = {};
      const s = data.stages[i];
      ClimbioReportFrame.select(steps, i);
      cmpBox.hidden = i === 0 || problems;
      if (i > 0) { cmpL.textContent = T('rpLeft', T(NAME[data.stages[i - 1].id] || '')); cmpR.textContent = T('rpRight', T(NAME[s.id] || '')); cmp.value = 50; }
      exB.hidden = !examples().length; exB.textContent = T('rpExample');
      paintLegend(); draw();
    }
    function paintLegend() {
      const s = data.stages[cur];
      legend.innerHTML = ''; legend.hidden = !problems;
      if (!problems) return;
      for (const k of LEGEND[s.answer ? 'answer' : 'auto']) {
        const e = el('span'), sw = el('i');
        sw.style.cssText = `border-color:${COLORS[k]};background:${COLORS[k]}33${DASHED.has(k) ? ';border-style:dashed' : ''}`;
        e.append(sw, T(LABEL[k])); legend.append(e);
      }
    }

    // ---- 畫 ----
    const answers = () => data.stages[data.stages.length - 1].polys;
    function items(s, withProblems) {
      const out = s.polys.map((p, i) => ({ p, k: s.kinds[i], y: bbox(p)[1] }));
      if (!withProblems) return out;
      if (s.answer) s.deleted.forEach(p => out.push({ p, k: 'deleted', y: bbox(p)[1] }));
      else { const ans = answers(); s.hit.forEach((h, i) => { if (!h) out.push({ p: ans[i], k: 'missed', y: bbox(ans[i])[1] }); }); }
      return out;
    }
    function path(p, sc) { ctx.beginPath(); p.forEach(([x, y], j) => { const X = (x - view.x) * sc, Y = (y - view.y) * sc; j ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); ctx.closePath(); }
    function strokeAll(list, sc, style, shown) {
      const lw = Math.max(1.6, 2.4 * cv.width / 1000);
      list.forEach((it, idx) => {
        if (idx >= shown) return;
        path(it.p, sc);
        ctx.globalAlpha = Math.min(1, shown - idx);
        if (style === 'plain') { ctx.lineWidth = lw + 2; ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.setLineDash([]); ctx.stroke(); ctx.lineWidth = lw; ctx.strokeStyle = LIME; ctx.stroke(); }
        else if (style === 'before') { ctx.lineWidth = lw; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.setLineDash([]); ctx.stroke(); }
        else {
          const c = COLORS[it.k] || LIME, calm = it.k === 'ok' || it.k === 'kept';
          if (!calm) { ctx.fillStyle = c + '40'; ctx.fill(); }
          ctx.lineWidth = calm ? lw * .8 : lw * 1.3; ctx.strokeStyle = c; ctx.setLineDash(DASHED.has(it.k) ? [lw * 2.5, lw * 1.5] : []); ctx.stroke();
        }
      });
      ctx.globalAlpha = 1; ctx.setLineDash([]);
    }
    function draw() {
      if (!data || !img) return;
      const sc = cv.width / data.w * view.k, s = data.stages[cur];
      cv.style.touchAction = view.k > 1 ? 'none' : 'pan-y';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, view.x * img.width / data.w, view.y * img.height / data.h, img.width / view.k, img.height / view.k, 0, 0, cv.width, cv.height);
      ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.lineJoin = 'round';
      const now = items(s, problems).sort((a, b) => a.y - b.y), shown = now.length + 8;
      if (problems) { strokeAll(now, sc, 'problems', shown); return; }
      if (cur > 0) {
        const x = cv.width * cmp.value / 100, prev = items(data.stages[cur - 1], false).sort((a, b) => a.y - b.y);
        ctx.save(); ctx.beginPath(); ctx.rect(0, 0, x, cv.height); ctx.clip(); strokeAll(prev, sc, 'before', prev.length + 8); ctx.restore();
        ctx.save(); ctx.beginPath(); ctx.rect(x, 0, cv.width - x, cv.height); ctx.clip(); strokeAll(now, sc, 'plain', shown); ctx.restore();
        ctx.fillStyle = '#fff'; ctx.fillRect(x - 1.5, 0, 3, cv.height);
      } else strokeAll(now, sc, 'plain', shown);
    }
    // 切換階段直接畫出全部外框，不加入固定延遲。
    function clamp() { view.x = Math.max(0, Math.min(data.w - data.w / view.k, view.x)); view.y = Math.max(0, Math.min(data.h - data.h / view.k, view.y)); }
    function zoomTo(b) {
      const w = Math.max(b[2] - b[0], 60) * 3.2, h = Math.max(b[3] - b[1], 60) * 3.2;
      const k = Math.min(8, Math.max(1, Math.min(data.w / w, data.h / h))), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
      view = { k, x: cx - data.w / k / 2, y: cy - data.h / k / 2 }; clamp(); draw();
    }
    // 例子：這一步變好的岩點（前一步切掉、太大、多認，這一步可用），最後一步是人改過的
    function examples() {
      const s = data.stages[cur], prev = data.stages[cur - 1], list = [];
      if (s.answer) s.polys.forEach((p, i) => { if (s.kinds[i] === 'edited' || s.kinds[i] === 'manual') list.push(p); });
      // 用實際的 ID／參考配對追蹤變好的岩點，不假定相同陣列長度就代表同一顆。
      else if (prev && prev.pairs && s.pairs) {
        const before = new Map();
        prev.pairs.forEach((m, i) => { if (m) before.set(m.j, prev.kinds[i]); });
        s.polys.forEach((p, i) => { const m = s.pairs[i]; if (m && s.kinds[i] === 'ok' && before.has(m.j) && before.get(m.j) !== 'ok') list.push(p); });
      }
      const ar = p => { const b = bbox(p); return (b[2] - b[0]) * (b[3] - b[1]); };
      return list.sort((a, b) => ar(b) - ar(a)).slice(0, 14);
    }
    exB.onclick = () => {
      const list = examples(); if (!list.length) return;
      cursor[cur] = ((cursor[cur] ?? -1) + 1) % list.length;
      problems = false; probB.setAttribute('aria-pressed', 'false'); cmpBox.hidden = cur === 0; paintLegend();
      if (cur > 0) cmp.value = 50;
      zoomTo(bbox(list[cursor[cur]]));
    };
    fitB.onclick = () => { view = { k: 1, x: 0, y: 0 }; draw(); };
    probB.onclick = () => { problems = !problems; probB.setAttribute('aria-pressed', problems); cmpBox.hidden = cur === 0 || problems; paintLegend(); draw(); };
    cmp.oninput = draw;

    // ---- 縮放與拖曳：Ctrl／⌘ 滾輪、觸控板雙指、兩指捏合 ----
    const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * data.w / view.k + view.x, (e.clientY - r.top) / r.height * data.h / view.k + view.y]; };
    cv.addEventListener('wheel', e => {
      if (!data || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const [mx, my] = pos(e), k = Math.max(1, Math.min(10, view.k * (e.deltaY < 0 ? 1.2 : 1 / 1.2))), r = cv.getBoundingClientRect();
      view.k = k; view.x = mx - (e.clientX - r.left) / r.width * data.w / k; view.y = my - (e.clientY - r.top) / r.height * data.h / k;
      clamp(); draw();
    }, { passive: false });
    const ptrs = new Map(); let last = null, pinch = 0;
    const dist = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); };
    cv.addEventListener('pointerdown', e => { if (!data) return; cv.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, e); last = [e.clientX, e.clientY]; cv.classList.add('drag'); if (ptrs.size === 2) pinch = dist(); });
    cv.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId) || !data) return;
      ptrs.set(e.pointerId, e);
      const r = cv.getBoundingClientRect();
      if (ptrs.size === 2) { const d = dist(); if (pinch) { view.k = Math.max(1, Math.min(10, view.k * d / pinch)); clamp(); draw(); } pinch = d; return; }
      view.x -= (e.clientX - last[0]) / r.width * data.w / view.k; view.y -= (e.clientY - last[1]) / r.height * data.h / view.k;
      last = [e.clientX, e.clientY]; clamp(); draw();
    });
    const up = e => { ptrs.delete(e.pointerId); pinch = 0; if (!ptrs.size) cv.classList.remove('drag'); else { const p = [...ptrs.values()][0]; last = [p.clientX, p.clientY]; } };
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);

    message(T('rpLoading'));
    return { show, message };
  }

  root.ClimbioReportView = { mount };
})(globalThis);
