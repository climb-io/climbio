// Studio 的工作紀錄（專案資料夾的 .studio/work/）：代理與人交接用的題目、判斷、進度怎麼算。
// 只處理資料，不讀寫檔案、不碰畫面：命令列 tools/studio.mjs 在本機資料夾讀寫，同步服務照同一份格式。格式見 docs/studio-work.md。
//
// 題目：{ id, line, kind, level（error 不修不能發佈、check 要看一眼）, target: [節點 id], title, options, evidence?, proposal?, since, seen }
// 判斷：{ id, q（題目 id）, choice, by（human:<名稱> 或 agent:<名稱>）, at, note?, patch?, applied?, said? }
//   said：人在 AI 對話裡答的原話（代理代為記下人的判斷時必填，見 docs/studio-work.md 的「在對話裡答題」）
//   accept 採用題目的建議、reject 建議不對（有 proposal 的題目，options 才有這兩個）、edit 自己修了、ok 沒問題維持現狀（error 不能 ok）、
//   fix 要改、交給代理（note 寫怎麼改，或 patch 直接給修正）、retake 原始資料明顯不夠（照片糊、缺頁），要人補拍或補資料（只有代理能選，note 寫哪裡不夠）
//   舊紀錄的 unsure（以前 AI 看不準就交給人）不再交給人：重新等代理自己判斷
//   ok、reject 之後這題不再出現；accept、edit 之後要資料真的改好：下一次重算還有同一題（seen 晚於判斷）就重新打開；fix 之後等代理改
//   patch 還沒套用（applied 不是 true）的判斷由代理套用：命令列 pull 套用後記一筆 edit
//
// AI 優先：題目由 AI（代理）判斷到底，看不準也自己判斷；人只答只能由人答的（HUMAN_ONLY，主要是發佈），
// 唯一例外是原始資料明顯不夠（retake）：代理在 AI 對話裡問人要不要補

export const WORK_DIR = '.studio/work';
export const CHOICES = ['accept', 'reject', 'edit', 'ok', 'fix', 'retake'];
/** 只能由人答的題目：位置來自原始資料，要不要公開由人決定（來源與授權由使用者負責，不出題）；3D 牆的照片不夠、要不要補拍（retake）；3D 牆發佈前的人工試用（trial3d） */
export const HUMAN_ONLY = new Set(['position', 'publish', 'retake', 'trial3d']);
const FINAL = new Set(['ok', 'reject']);

/** 字串 → 短的穩定代號（FNV-1a 32 位元，base36）：沒有節點 id 的題目用內容當 id */
export function hash(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

const ISSUE_KIND = { 'no-position': 'position', 'missing-images': 'missing-images', invalid: 'invalid', outline: 'outline' };
const REASON_KIND = { unassigned: 'route-wall', stub: 'route-line', 'no-topo': 'route-line' };

/**
 * 路線書的問題清單（studio/crag/report.js 的報告）→ 題目（還沒有 since、seen）。
 * reasonText：路線原因代碼 → 給人看的文字（命令列、Studio 各自用語言包）
 */
export function questionsFromReport(rep, { line = 'convert', reasonText = (c) => c } = {}) {
  const out = [];
  for (const i of rep.issues || []) {
    const kind = ISSUE_KIND[i.code] || i.code;
    out.push({ id: `q-${kind}-${hash(i.message)}`, line, kind, level: i.level, target: [], title: i.message, options: i.level === 'error' ? ['edit', 'fix'] : ['ok', 'edit', 'fix'] });
  }
  for (const r of rep.routes || []) {
    const kinds = [...new Set(r.reasons.map(c => REASON_KIND[c] || c))];
    for (const kind of kinds) {
      const why = r.reasons.filter(c => (REASON_KIND[c] || c) === kind);
      out.push({
        id: `q-${kind}-${r.id}`, line, kind, level: 'check', target: [r.id],
        title: `${[r.wall, r.name].filter(Boolean).join(' / ')}：${why.map(reasonText).join('、')}`,
        options: ['ok', 'edit', 'fix'], ...(r.at ? { evidence: [{ outline: r.at }] } : {}),
      });
    }
  }
  return out;
}

/**
 * 要不要公開發佈：成品建好、其他題都答完才出這題，只能由人答（HUMAN_ONLY）。sig 是成品內容的指紋：內容改了就是另一題，要重新核准。
 * title 由呼叫的人給（命令列、Studio 各自用語言包）
 */
export const publishQuestion = ({ line, sig, title }) => ({ id: `q-publish-${sig}`, line, kind: 'publish', level: 'check', target: [], title, options: ['ok', 'reject'] });

/** 這一版有沒有真人核准發佈：目前的發佈題最後一筆判斷是人答的 ok。回傳那筆判斷（沒有就 null） */
export function approval(questions, decisions) {
  const q = questions.find(x => x.kind === 'publish');
  const d = q && lastOf(q, decisions);
  return d && d.choice === 'ok' && d.by.startsWith('human:') ? d : null;
}

/** 重算後的題目：同一題留著第一次出現的時間，seen 換成這次；這次沒出現的題目（問題已經不在）拿掉 */
export function refresh(old, fresh, now) {
  const before = new Map(old.map(q => [q.id, q]));
  return fresh.map(q => ({ ...q, since: before.get(q.id)?.since || now, seen: now }));
}

/** 這題最後一筆判斷 */
const lastOf = (q, decisions) => decisions.reduce((d, x) => (x.q === q.id ? x : d), null);
/** 這筆判斷要代理接著做：人說要改（fix），或帶著還沒套用的修正 */
const forAgent = (d) => !!d && (d.choice === 'fix' || (!!d.patch && !d.applied));

/** 這題還要不要人（或代理）答 */
export function isOpen(q, decisions) {
  const d = lastOf(q, decisions);
  if (!d) return true;
  if (forAgent(d) || d.choice === 'retake' || d.choice === 'unsure') return true;   // 等代理改的、等人補資料的、舊的 unsure（重新等代理）都還沒答完
  if (FINAL.has(d.choice)) return false;
  return d.at < q.seen;
}

/**
 * 還沒答的題等誰：'human'（只能由人答的，或代理判斷原始資料不夠 retake）、'agent'（AI 判斷；人說要改的也等代理改）；答完了是 null
 */
export function waitingFor(q, decisions) {
  if (!isOpen(q, decisions)) return null;
  const d = lastOf(q, decisions);
  if (forAgent(d)) return 'agent';
  if (HUMAN_ONLY.has(q.kind) || d?.choice === 'retake') return 'human';
  return 'agent';
}

/** 要代理套用的修正：每題最後一筆判斷帶著還沒套用的 patch */
export function pendingPatches(questions, decisions) {
  return questions.map(q => lastOf(q, decisions)).filter(d => d && d.patch && !d.applied);
}

/** 兩邊的紀錄合在一起（同步）：照 id 去重、照時間排 */
export function merge(a, b) {
  const all = new Map([...a, ...b].map(x => [x.id || recordId(x), x]));
  return [...all.values()].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
}
/** 紀錄的 id：判斷、執行紀錄沒寫 id 的照內容算 */
export const recordId = (x) => `${x.q ? 'd' : 'r'}-${hash(JSON.stringify({ ...x, id: undefined }))}`;

/** 答一題 → 判斷紀錄；不合規則的丟錯 */
export function decide(q, { choice, by, note, patch, applied, said }, now) {
  if (!CHOICES.includes(choice)) throw new Error(`不認得的選項：${choice}（${CHOICES.join('、')}）`);
  if (!by || !/^(human|agent):\S+/.test(by)) throw new Error(`by 要寫成 human:<名稱> 或 agent:<名稱>：${by}`);
  if (choice === 'accept' && !q.proposal) throw new Error(`${q.id} 沒有建議可以採用`);
  if (choice === 'retake' ? !by.startsWith('agent:') : !q.options.includes(choice)) throw new Error(`${q.id} 不能選 ${choice}（可以選：${q.options.join('、')}${by.startsWith('agent:') ? '、retake（原始資料明顯不夠才選）' : ''}）`);
  if (choice === 'retake' && !note) throw new Error(`${q.id} 選 retake 要寫哪裡的資料不夠（note）`);
  if (by.startsWith('agent:') && HUMAN_ONLY.has(q.kind) && !(choice === 'edit' && patch && applied)) throw new Error(`${q.id} 只能由人答（${q.kind}）`);
  // 只能由人答的題，代理只能套用人給的修正（pull 套用 patch 後記的 edit）
  if (choice === 'fix' && !note && !patch) throw new Error(`${q.id} 選 fix 要寫怎麼改（note）或給修正（patch）`);
  if (said && !by.startsWith('human:')) throw new Error(`said 是人的原話，只有 human: 的判斷才有`);
  if (choice === 'accept') patch = q.proposal.patch;
  const d = { q: q.id, choice, by, at: now, ...(note ? { note } : {}), ...(patch ? { patch } : {}), ...(patch && applied ? { applied: true } : {}), ...(said ? { said } : {}) };
  return { id: recordId(d), ...d };
}

/** 題目＋判斷 → 進度數字 */
export function summary(questions, decisions) {
  const open = questions.filter(q => isOpen(q, decisions));
  const forHuman = open.filter(q => waitingFor(q, decisions) === 'human').length;
  return { total: questions.length, open: open.length, errors: open.filter(q => q.level === 'error').length, humanOnly: open.filter(q => HUMAN_ONLY.has(q.kind)).length, forAgent: open.length - forHuman, forHuman };
}

/**
 * 進度（state.json）：step 是這條線做到哪一步（由命令列判斷），built 是成品（公開格式的包）在不在。
 * next：下一步的代號（命令列翻成指令）；題目都答完、有成品才能發佈
 */
export function stateOf({ line, step, built, name, questions, decisions, now }) {
  const s = summary(questions, decisions);
  // AI 先做：有等代理的題先答（或套用人給的修正）；剩下只等人的時候是 human
  const next = !step ? 'start' : !built && !s.errors ? 'build' : s.forAgent ? 'answer' : s.forHuman ? 'human' : 'publish';
  return { line, step, name, ...s, publishable: built && s.open === 0, next, updated: now };
}
