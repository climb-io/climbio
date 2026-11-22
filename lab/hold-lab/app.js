// Hold Lab 展示頁（中文 lab/hold-lab/、英文 lab/hold-lab/en/ 共用）：上面是公開牆的岩點報告（跟 Studio Wall 的「報告」同一個畫面），下面是公開牆清單。
// 讀開放資料集 climbio/walls 的 walls.jsonl、各牆的精修記錄與 research/hold-lab 的各步比對資料。
(() => {
  'use strict';
  const EN = document.documentElement.lang === 'en';
  const ROOT = EN ? '../../../' : '../../';
  const HF = 'https://huggingface.co/datasets/climbio/walls';
  const $ = id => document.getElementById(id);
  // 報告畫面跟 Studio Wall 的「報告」共用（studio/wall/report-view.js），數字由 studio/wall/report.js 從開放資料集的資料算
  const RP = {
    zh: { rpDetect: '自動偵測', rpRetrace: '重描外框', rpSam2: 'SAM2 精修', rpAi: 'AI 檢查', rpHuman: '人工檢查', rpFound: '找到', rpSnug: n => `外框貼 ${n}`, rpFalse: n => `多認 ${n}`, rpHolds: '顆',
      rpChanged: (a, b, c) => `改 ${a}、刪 ${b}、補 ${c}`, rpNotReviewed: '還沒逐顆檢查完', rpFit: '整面', rpProblems: '標出問題', rpExample: '看改的地方', rpCompare: '前後對照', rpLeft: n => `左：${n}`, rpRight: n => `右：${n}`,
      rpLoading: '載入中…', rpFail: '資料載入失敗，請重新整理。', rpNone: '還沒有階段比對資料。', rpCanvasAria: '牆面照片與岩點外框',
      rpDefn: n => `每 100 顆真實岩點，以「${n}」為準：找到＝有框到；外框貼＝輪廓可直接用；多認＝不是岩點卻被框。`,
      rpOk: '外框可用', rpCut: '切掉一角', rpOver: '外框太大', rpExtra: '多認', rpMissed: '漏掉', rpKept: '沒動或微調', rpEdited: '重畫', rpManual: '手畫新增', rpDeleted: '刪掉' },
    en: { rpDetect: 'Auto detect', rpRetrace: 'Retrace outlines', rpSam2: 'SAM2 refine', rpAi: 'AI check', rpHuman: 'Human check', rpFound: 'found', rpSnug: n => `snug ${n}`, rpFalse: n => `false ${n}`, rpHolds: 'holds',
      rpChanged: (a, b, c) => `edited ${a}, deleted ${b}, added ${c}`, rpNotReviewed: 'Not fully checked', rpFit: 'Whole wall', rpProblems: 'Show problems', rpExample: 'See changes', rpCompare: 'Compare', rpLeft: n => `Left: ${n}`, rpRight: n => `Right: ${n}`,
      rpLoading: 'Loading…', rpFail: 'Could not load the data. Please reload.', rpNone: 'No stage comparison yet.', rpCanvasAria: 'Wall photo with hold outlines',
      rpDefn: n => `Per 100 real holds, judged against "${n}". Found: outlined. Snug: outline usable as is. False: outlined but not a hold.`,
      rpOk: 'Good outline', rpCut: 'Cut off', rpOver: 'Too big', rpExtra: 'Extra', rpMissed: 'Missed', rpKept: 'Untouched or tweaked', rpEdited: 'Redrawn', rpManual: 'Hand-drawn', rpDeleted: 'Deleted' },
  }[EN ? 'en' : 'zh'];
  const T = (k, ...a) => { const v = RP[k]; return typeof v === 'function' ? v(...a) : v ?? k; };
  const ZH = {
    locale: 'zh-TW', noWalls: '還沒有公開的牆。', listFail: '暫時讀不到清單，請直接到 Hugging Face 看。',
    chips: { phone: '手機偵測', ai: 'AI 檢查', human: '人工修正', pending: '（未全部檢查）', refine: '手機精修', edits: (a, b, c) => `改 ${a}、刪 ${b}、補 ${c}` },
    wall: { holds: n => `${n} 顆岩點`, routes: n => `${n} 條路線`, edit: '在 Studio Wall 編輯', report: '報告', raw: '資料' },
  };
  const EN_ = {
    locale: 'en-US', noWalls: 'No public walls yet.', listFail: 'Could not read the list. Please open Hugging Face directly.',
    chips: { phone: 'Phone detection', ai: 'AI check', human: 'Human correction', pending: ' (not fully checked)', refine: 'Phone refinement', edits: (a, b, c) => `edited ${a}, deleted ${b}, added ${c}` },
    wall: { holds: n => `${n} holds`, routes: n => `${n} routes`, edit: 'Edit in Studio Wall', report: 'Report', raw: 'Data' },
  };
  const S = EN ? EN_ : ZH;
  const report = ClimbioReportView.mount($('report'), T);

  // ---- 牆的切換：有各步比對資料或精修記錄的公開牆（#牆 id 直接打開那面；#src=/… 讀同來源預覽資料夾）----
  let rows = [], cur = null, localSrc = null;
  const wallRows = () => ClimbioReport.walls();
  const srcMatch = h => { const m = /^src=(\/[^?#]+)$/.exec(h || ''); return m ? m[1].replace(/\/?$/, '/') : null; };
  async function loadLocalSrc(dir) {
    const [lab, photo] = await Promise.all([
      fetch(`${dir}stages.json`, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }),
      fetch(`${dir}photo.jpg`, { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); }),
    ]);
    return { name: lab.name || dir, gym: '', w: lab.w, h: lab.h, photo, stages: ClimbioReport.fromStages(lab) };
  }
  async function init() {
    const want = location.hash.slice(1), src = srcMatch(want);
    if (src) { localSrc = src; $('pick').hidden = true; show('local'); return; }
    const [list, sets] = await Promise.all([wallRows(), researchSet()]);
    rows = list.filter(r => (sets.get(r.id) || { stages: [] }).stages.length || r.edits);
    if (!rows.length) { report.message(T('rpNone')); return; }
    $('pick').hidden = rows.length < 2;
    $('pick').innerHTML = '';
    for (const r of rows) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = r.name || r.id; b.dataset.id = r.id;
      b.onclick = () => { history.replaceState(null, '', `#${r.id}`); show(r.id); };
      $('pick').appendChild(b);
    }
    show(rows.some(r => r.id === want) ? want : rows[0].id);
  }
  async function show(id) {
    cur = id;
    [...$('pick').children].forEach(b => b.setAttribute('aria-pressed', b.dataset.id === id));
    report.message(T('rpLoading'));
    try {
      const r = id === 'local' ? await loadLocalSrc(localSrc) : await ClimbioReport.loadPublished(rows.find(x => x.id === id));
      if (cur === id) await report.show(r);
    }
    catch (e) { console.error(e); if (cur === id) report.message(T('rpFail')); }
  }
  addEventListener('hashchange', () => {
    const want = location.hash.slice(1), src = srcMatch(want);
    if (src) { localSrc = src; $('pick').hidden = true; show('local'); }
    else if (rows.some(r => r.id === want)) show(want);
    else if (!rows.length) init().catch(e => { console.error(e); report.message(T('rpFail')); });
  });

  // ---- 公開牆清單（自動：讀 Hugging Face 資料集的 walls.jsonl；各牆處理到哪一步由資料集裡的檔案推出來）----
  async function researchSet() {   // 有階段比對資料的牆：Map 牆包 id → { stages: [...] }（research/hold-lab/<牆包 id>/summary.json）
    const out = new Map();
    try {
      const r = await fetch('https://huggingface.co/api/datasets/climbio/walls/tree/main/research/hold-lab', { cache: 'no-store' }).then(x => x.ok ? x.json() : []);
      await Promise.all(r.filter(x => x.type === 'directory').map(async x => {
        const id = x.path.split('/').pop();
        out.set(id, await fetch(`${HF}/resolve/main/research/hold-lab/${id}/summary.json`, { cache: 'no-store' }).then(y => y.json()).catch(() => ({ stages: [] })));
      }));
    } catch (e) { /* 讀不到就當沒有 */ }
    return out;
  }
  async function editsBy(w) {   // 精修記錄是手機（岩點貓）還是 Studio Wall 做的：看 edits.json 的 tools.by
    try {
      const idx = await fetch(`${HF}/resolve/main/${w.dir}index.json`).then(r => r.json());
      const rec = await fetch(`${HF}/resolve/main/${w.dir}${idx.items[0].id}.edits.json`).then(r => r.json());
      return rec.tools && rec.tools.by === 'phone' ? 'phone' : 'studio';
    } catch (e) { return 'studio'; }
  }
  function chipsOf(w, sum, by) {
    const st = (sum && sum.stages) || [], e = w.edits, phone = e && by === 'phone', K = S.chips;
    const txt = e ? K.edits(e.reshaped, e.deleted, e.added) : '';
    const human = phone ? 'off' : st.includes('human') || (e && e.reviewed) ? 'on' : e ? 'part' : 'off';
    return [
      ['on', K.phone],
      [st.includes('mobilesam') ? 'on' : 'off', 'MobileSAM'],
      [st.includes('sam2') ? 'on' : 'off', 'SAM2'],
      [st.includes('ai') ? 'on' : 'off', K.ai],
      [human, human === 'off' ? K.human : e ? `${K.human}: ${txt}${human === 'part' ? K.pending : ''}` : K.human],
      [phone ? 'on' : 'off', phone ? `${K.refine}: ${txt}` : K.refine],
    ];
  }
  async function loadWalls() {
    const box = $('walls');
    try {
      const [list, sets] = await Promise.all([wallRows(), researchSet()]);
      if (!list.length) { box.textContent = S.noWalls; return; }
      box.innerHTML = '';
      for (const w of list) {
        const a = document.createElement('div');
        a.className = 'wall';
        a.innerHTML = '<b></b><span></span><div class="chips"></div><div class="links"><a class="report"></a><a class="edit"></a><a class="raw" rel="noopener"></a></div>';
        a.querySelector('.report').href = `${ROOT}studio/wall/#r=${w.id}`;
        a.querySelector('.report').textContent = S.wall.report;
        a.querySelector('.edit').href = `${ROOT}studio/wall/#p=${w.id}`;
        a.querySelector('.edit').textContent = S.wall.edit;
        a.querySelector('.raw').href = `${HF}/tree/main/${w.dir}`;
        a.querySelector('.raw').textContent = S.wall.raw;
        a.querySelector('b').textContent = w.name || w.id;
        a.querySelector('span').textContent = [w.gym, S.wall.holds(w.holds), w.routes ? S.wall.routes(w.routes) : '', new Date(w.t).toLocaleDateString(S.locale)].filter(Boolean).join(' · ');
        const chips = a.querySelector('.chips');
        const paint = by => { chips.textContent = ''; for (const [k, t] of chipsOf(w, sets.get(w.id), by)) { const c = document.createElement('i'); c.className = `chip ${k}`; c.textContent = t; chips.appendChild(c); } };
        paint('studio');
        if (w.edits) editsBy(w).then(paint);
        box.appendChild(a);
      }
    } catch (e) {
      box.innerHTML = `<span class="note">${S.listFail}</span>`;
    }
  }

  init().catch(e => { console.error(e); report.message(T('rpFail')); });
  loadWalls();
})();
