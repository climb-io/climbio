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
    zh: { rpUncorrected: "尚未校正", rpHumanDone: "人工檢查完成", rpAiDone: "AI 檢查完成", rpReviewUnknown: "完整檢查狀態未記錄", rpNoReference: "沒有可比較的參考結果", rpEstimated: "部分階段沒有可追溯的岩點 ID，找到與誤判為外框配對估算。", rpDetect: '自動偵測', rpRetrace: '重描外框', rpSam2: 'SAM2 精修', rpAi: 'AI 檢查', rpHuman: '人工檢查', rpFound: '找到', rpSnug: n => `外框可用 ${n}`, rpFalse: n => `誤判 ${n}`, rpHolds: '顆',
      rpChanged: (a, b, c) => `改 ${a}、刪 ${b}、補 ${c}`, rpNotReviewed: '還沒逐顆檢查完', rpFit: '整面', rpProblems: '標出問題', rpExample: '看改的地方', rpCompare: '前後對照', rpLeft: n => `左：${n}`, rpRight: n => `右：${n}`,
      rpLoading: '載入中…', rpFail: '資料載入失敗，請重新整理。', rpNone: '還沒有階段比對資料。', rpCanvasAria: '牆面照片與岩點外框',
      rpDefn: n => `以「${n}」的岩點為比較基準。找到率＝配對顆數／基準顆數；其餘為實際顆數。未完成逐顆檢查時，僅代表與目前結果的一致程度。`,
      rpOk: '外框可用', rpCut: '切掉一角', rpOver: '外框太大', rpExtra: '多認', rpMissed: '漏掉', rpKept: '沒動或微調', rpEdited: '重畫', rpManual: '手畫新增', rpDeleted: '刪掉' },
    en: { rpUncorrected: "Not corrected", rpHumanDone: "Human review complete", rpAiDone: "AI review complete", rpReviewUnknown: "Full review status not recorded", rpNoReference: "No reference result to compare", rpEstimated: "Some stages lack traceable hold IDs; matched and false counts are estimated by outline overlap.", rpDetect: 'Auto detect', rpRetrace: 'Retrace outlines', rpSam2: 'SAM2 refine', rpAi: 'AI check', rpHuman: 'Human check', rpFound: 'found', rpSnug: n => `Usable outlines ${n}`, rpFalse: n => `False detections ${n}`, rpHolds: 'holds',
      rpChanged: (a, b, c) => `edited ${a}, deleted ${b}, added ${c}`, rpNotReviewed: 'Not fully checked', rpFit: 'Whole wall', rpProblems: 'Show problems', rpExample: 'See changes', rpCompare: 'Compare', rpLeft: n => `Left: ${n}`, rpRight: n => `Right: ${n}`,
      rpLoading: 'Loading…', rpFail: 'Could not load the data. Please reload.', rpNone: 'No stage comparison yet.', rpCanvasAria: 'Wall photo with hold outlines',
      rpDefn: n => `Compared with "${n}". Found rate = matched holds / reference holds. Other figures are actual counts. If review is incomplete, this measures agreement with the current result, not verified accuracy.`,
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
  let rows = [], localSrc = null, request = 0, listPromise, researchPromise;
  const wallRows = () => listPromise ||= ClimbioReport.walls().catch(e => { listPromise = null; throw e; });
  const sharedResearch = () => researchPromise ||= researchSet();
  // 保留最近三面牆，同時進來的請求共用同一個 Promise。
  const loaded = new Map();
  function cachedReport(key, loader) {
    if (loaded.has(key)) {
      const pending = loaded.get(key);
      loaded.delete(key); loaded.set(key, pending);
      return pending;
    }
    const pending = Promise.resolve().then(loader);
    loaded.set(key, pending);
    if (loaded.size > 3) loaded.delete(loaded.keys().next().value);
    pending.catch(() => { if (loaded.get(key) === pending) loaded.delete(key); });
    return pending;
  }
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
    const [list, sets] = await Promise.all([wallRows(), sharedResearch()]);
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
    const seq = ++request, dir = localSrc;
    [...$('pick').children].forEach(b => b.setAttribute('aria-pressed', b.dataset.id === id));
    report.message(T('rpLoading'));
    try {
      const row = rows.find(x => x.id === id);
      const r = id === 'local' ? await loadLocalSrc(dir)
        : await cachedReport(id + ':' + row.dir, () => ClimbioReport.loadPublished(row));
      if (seq === request) await report.show(r);
    }
    catch (e) { console.error(e); if (seq === request) report.message(T('rpFail')); }
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
      const [list, sets] = await Promise.all([wallRows(), sharedResearch()]);
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
