// 岩點報告（Studio Wall 發佈前、已公開的牆、Lab 共用）：每一步的岩點外框跟最後一步（答案）比，算「每 100 顆真實岩點：找到、外框貼、多認」，
// 最後一步再跟前一步比，標出人改了哪裡。資料來源有兩種，都整理成同一種階段：
//   fromRecord：精修記錄（record.js 產生、公開時的 <牆 id>.edits.json）加最後的岩點 → 自動偵測（、SAM2）、人工檢查
//   fromStages：開放資料集裡各步外框的比對資料（version 2 的 stages.json）→ 只取各步的外框，數字一律在這裡重算
(function (root) {
  'use strict';
  const G = typeof module !== 'undefined' && module.exports ? require('./record.js') : root.RefineRecord;
  // 配對與分類的門檻：一對一配對、重疊（IoU）≥ MATCH 才算找到；蓋到答案不到 COVER 算切掉一角，多出來的超過 1 - TIGHT 算外框太大；
  // 最後一步跟前一步重疊不到 G.SAME（跟精修記錄同一個值）算重畫
  const MATCH = 0.3, COVER = 0.85, TIGHT = 0.75;

  const area = p => { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; } return Math.abs(a / 2); };
  const bbox = p => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const [x, y] of p) { if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y; } return [a, b, c, d]; };
  const touch = (a, b) => !(a[0] > b[2] || a[2] < b[0] || a[1] > b[3] || a[3] < b[1]);

  // 一對一配對：重疊大的先配，每顆最多配一次；回傳 pairs[i] = { j, iou }（沒配到是 undefined）
  function match(polys, answers, w, h) {
    const ab = answers.map(bbox), cand = [];
    polys.forEach((p, i) => { const b = bbox(p); ab.forEach((q, j) => { if (!touch(b, q)) return; const v = G.polyIou(p, answers[j], w, h); if (v >= MATCH) cand.push([v, i, j]); }); });
    cand.sort((a, b) => b[0] - a[0]);
    const pairs = [], used = new Set();
    for (const [v, i, j] of cand) { if (pairs[i] || used.has(j)) continue; pairs[i] = { j, iou: v }; used.add(j); }
    return pairs;
  }
  // 自動的一步跟答案比：kinds 每顆 ok／cut／over／extra，hit 每顆答案有沒有被找到
  function grade(polys, answers, w, h) {
    const pairs = match(polys, answers, w, h), hit = answers.map(() => false), counts = { ok: 0, cut: 0, over: 0, extra: 0, missed: 0 };
    const kinds = polys.map((p, i) => {
      const m = pairs[i];
      if (!m) return 'extra';
      hit[m.j] = true;
      const A = area(p), B = area(answers[m.j]), I = m.iou * (A + B) / (1 + m.iou);
      return B && I / B < COVER ? 'cut' : A && I / A < TIGHT ? 'over' : 'ok';
    });
    kinds.forEach(k => counts[k]++);
    counts.missed = hit.filter(x => !x).length;
    const n = answers.length || 1, pct = v => Math.round(v / n * 100);
    return { kinds, hit, counts, per100: { found: pct(answers.length - counts.missed), ok: pct(counts.ok), extra: pct(counts.extra) } };
  }
  // 最後一步跟前一步比：kinds 每顆 kept／edited／manual，deleted 是前一步有、最後拿掉的外框。
  // 兩步都有岩點 id（精修記錄來的）就照 id 對，補畫在刪掉的位置上也分得出來；沒有 id 才用外框配對
  function changes(polys, prev, w, h, ids, prevIds) {
    let pairs;
    if (ids && prevIds) { const at = new Map(prevIds.map((id, j) => [id, j])); pairs = ids.map((id, i) => at.has(id) ? { j: at.get(id), iou: G.polyIou(polys[i], prev[at.get(id)], w, h) } : undefined); }
    else pairs = match(polys, prev, w, h);
    const used = new Set();
    const kinds = polys.map((p, i) => { const m = pairs[i]; if (!m) return 'manual'; used.add(m.j); return m.iou < G.SAME ? 'edited' : 'kept'; });
    const deleted = prev.filter((p, j) => !used.has(j));
    const counts = { kept: 0, edited: 0, manual: 0, deleted: deleted.length };
    kinds.forEach(k => counts[k]++);
    return { kinds, deleted, counts };
  }

  // stages：[{ id, polys }]，最後一步是答案；回傳每一步加上分類與數字
  function analyze(stages, w, h) {
    const last = stages[stages.length - 1];
    return stages.map((s, i) => {
      if (s === last) return { ...s, answer: true, ...(i ? changes(s.polys, stages[i - 1].polys, w, h, s.ids, stages[i - 1].ids) : { kinds: s.polys.map(() => 'kept'), deleted: [], counts: null }) };
      return { ...s, ...grade(s.polys, last.polys, w, h) };
    });
  }

  // 精修記錄 → 階段：自動偵測、（有 SAM2 的選擇時）SAM2、人工檢查。holds 是牆的畫面裡的岩點，記錄有兩種：
  //   Studio Wall 的：畫面是最後的岩點 → 自動偵測＝去掉補畫的、換回重描前的外框、加回刪掉的
  //   岩點貓的（有 final）：畫面維持原始岩點（appkit/share-tools.js 的 phoneEdits）→ 自動偵測＝畫面本身，人工檢查＝去掉刪掉的、換上 final 的外框、加上手畫的
  function fromRecord(record, holds) {
    if (!record) return null;
    const added = new Set(record.added || []), gone = new Set((record.deleted || []).map(x => x.id)), reshaped = new Map((record.reshaped || []).map(x => [x.id, x.poly]));
    let auto, final;
    if (record.final) {
      const fin = record.final, have = new Set(holds.map(x => x.id));
      auto = holds.filter(x => !added.has(x.id));
      for (const x of record.deleted || []) if (!have.has(x.id)) auto.push({ id: x.id, poly: x.poly });   // 之後的版本把刪掉的岩點停用了，畫面裡就不算它
      final = holds.filter(x => !gone.has(x.id)).map(x => ({ id: x.id, poly: fin[x.id] || x.poly }));
      for (const id of added) if (!have.has(id) && fin[id]) final.push({ id, poly: fin[id] });
    } else {
      auto = holds.filter(x => !added.has(x.id)).map(x => ({ id: x.id, poly: reshaped.get(x.id) || x.poly }));
      for (const x of record.deleted || []) auto.push({ id: x.id, poly: x.poly });
      final = holds;
    }
    const sam = record.sam || {}, ids = auto.map(x => x.id), stages = [{ id: 'holdscan', polys: auto.map(x => x.poly), ids }];
    if (Object.keys(sam).length) stages.push({ id: 'sam2', polys: auto.map(x => (sam[x.id] && sam[x.id].poly) || x.poly), ids });
    stages.push({ id: 'human', polys: final.map(x => x.poly), ids: final.map(x => x.id), reviewed: !!record.reviewed });
    return stages;
  }
  // 開放資料集的各步比對資料（version 2）→ 階段：只取外框，最後一步當答案
  function fromStages(d) {
    if (!d || d.version !== 2 || !Array.isArray(d.stages)) return null;
    return d.stages.filter(s => Array.isArray(s.polys) && s.polys.length).map(s => ({ id: s.id, polys: s.polys }));
  }

  // ---- 讀開放資料集的一面牆（Hugging Face 的 climbio/walls，誰都能免登入讀）：牆的資訊、照片、最後的岩點、精修記錄、各步比對資料 ----
  const HF = 'https://huggingface.co/datasets/climbio/walls/resolve/main/';
  const getJson = async (url, opt) => { const r = await fetch(url, opt); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); };
  async function walls() {
    const r = await fetch(`${HF}walls.jsonl`, { cache: 'no-cache' });
    if (!r.ok) throw new Error(String(r.status));
    return (await r.text()).split('\n').filter(Boolean).map(l => JSON.parse(l)).sort((a, b) => b.t - a.t);
  }
  // 牆的畫面（Climbio 公開格式 v2 的 view）→ 岩點 [{ id, poly }]；停用的岩點（retired）不算
  function holdsOf(view) {
    const off = new Set((view.nodes || []).filter(n => n.retired || (n.props && n.props.retired)).map(n => n.id));
    const ring = c => { const a = c[0], b = c[c.length - 1]; return c.length > 3 && a[0] === b[0] && a[1] === b[1] ? c.slice(0, -1) : c; };   // GeoJSON 的環頭尾同一點
    return (view.marks || []).filter(m => m.geometry && m.geometry.type === 'Polygon' && !off.has(m.node)).map(m => ({ id: m.node, poly: ring(m.geometry.coordinates[0]) }));
  }
  // row：walls.jsonl 的一列。回傳 { name, w, h, photo（Blob）, stages }；沒有可比的資料時 stages 是 null
  async function loadPublished(row) {
    const base = HF + row.dir, set = await getJson(`${base}index.json`), item = set.items[0];
    const lab = await getJson(`${HF}research/hold-lab/${row.id}/stages.json`, { cache: 'no-cache' }).catch(() => null);
    let stages = fromStages(lab), photoUrl = stages ? `${HF}research/hold-lab/${row.id}/photo.jpg` : null, w = lab && lab.w, h = lab && lab.h;
    if (!stages) {
      const layer = await getJson(new URL(item.href, base).href), view = await getJson(new URL(layer.href || `${item.id}.json`, base).href);
      const record = row.edits ? await getJson(`${base}${item.id}.edits.json`).catch(() => null) : null;
      stages = fromRecord(record, holdsOf(view)); photoUrl = new URL(view.href, base).href; w = view.w; h = view.h;
    }
    const photo = await fetch(photoUrl).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.blob(); });
    return { name: row.name || set.name || row.id, gym: row.gym || '', w, h, photo, stages };
  }

  const api = { analyze, grade, changes, fromRecord, fromStages, holdsOf, walls, loadPublished, bbox, MATCH, COVER, TIGHT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ClimbioReport = api;
})(globalThis);
