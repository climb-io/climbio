// 發佈的畫面（Studio 的 Wall、Crag、3D 牆共用）：一個發佈對話框加一個全螢幕的發佈過場。
// 不碰登入與後端：產品用 set() 給它現在的狀態、用 on* 接按鈕；各產品自己的欄位（署名、岩館、匯出…）放進 extras、actions 的插槽。
// 顏色取自 css/brand-tokens.css 對到的介面變數（--surface、--text、--accent…），不依賴頁面自己的按鈕樣式。

const CSS = `
#publishDlg { background: var(--surface); color: var(--text); border: 0; border-radius: 20px; padding: 22px; width: min(420px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow: auto; box-shadow: 0 16px 40px var(--shadow); }
#publishDlg::backdrop { background: var(--overlay); }
#publishDlg h3 { margin: 0 0 14px; font-size: 17px; }
#publishDlg p { margin: 0 0 4px; color: var(--muted); text-wrap: balance; }
#publishDlg ul { margin: 6px 0 14px; padding-left: 20px; color: var(--text); }
#publishDlg label.dk-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 12px; color: var(--muted); font-size: 13px; }
#publishDlg .field { color: var(--text); font: inherit; font-size: 15px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--bg); width: 100%; box-sizing: border-box; }
#publishDlg .field:focus { border-color: var(--accent); outline: none; }
#publishDlg label.check { display: flex; flex-direction: row; align-items: center; gap: 8px; margin-bottom: 12px; color: var(--text); font-size: 14px; }
#publishDlg #pubShare { display: flex; flex-direction: column; align-items: center; gap: 8px; margin-bottom: 12px; }
#publishDlg #pubShare[hidden] { display: none; }
#publishDlg #pubLink { display: flex; align-items: center; gap: 8px; margin: 0; width: 100%; }
#publishDlg #pubLink a { color: var(--accent); word-break: break-all; flex: 1; min-width: 0; font-size: 13px; }
#publishDlg .vis { display: flex; gap: 8px; margin: 0 0 10px; }
#publishDlg .vis label { flex: 1; display: flex; flex-direction: column; gap: 2px; padding: 10px 12px; border: 1.5px solid var(--line); border-radius: 12px; cursor: pointer; }
#publishDlg .vis label:has(input:checked) { border-color: var(--accent); background: var(--accent-soft); }
#publishDlg .vis input { position: absolute; opacity: 0; pointer-events: none; }
#publishDlg .vis span { font-size: 12.5px; color: var(--muted); }
#publishDlg #pubMsg { margin-top: 10px; min-height: 1em; }
#publishDlg .acts { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; flex-wrap: wrap; }
#publishDlg .acts .grow { flex: 1; }
#publishDlg .dk-btn { display: inline-flex; align-items: center; justify-content: center; height: 40px; padding: 0 18px; border-radius: 999px; background: var(--surface-2); color: var(--text); font-weight: 600; white-space: nowrap; border: 0; cursor: pointer; font: inherit; font-weight: 600; }
#publishDlg .dk-btn.small { height: 30px; padding: 0 12px; font-size: 13px; }
#publishDlg .dk-btn.primary { background: var(--accent); color: var(--on-accent); }
#publishDlg .dk-btn.danger-text { background: none; color: var(--danger); }
#publishDlg .dk-btn:disabled { opacity: .45; cursor: default; }
#publishDlg [hidden] { display: none !important; }
#pubRun { width: 100vw; max-width: 100vw; height: 100dvh; max-height: 100dvh; margin: 0; border: 0; border-radius: 0; box-shadow: none; background: var(--bg); color: var(--text); padding: 24px 16px calc(24px + env(safe-area-inset-bottom, 0px)); }
#pubRun[open] { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; }
#pubRun::backdrop { background: var(--bg); }
#pubRun .cover { width: min(360px, 100%); aspect-ratio: 4 / 3; border-radius: 14px; overflow: hidden; background: var(--surface-2); transform: rotate(-1.5deg); box-shadow: 0 6px 22px var(--shadow); flex: none; }
#pubRun .cover .img { width: 100%; height: 100%; background: center / cover no-repeat; }
#pubRun .name { font-size: 18px; margin-top: 8px; }
#pubRun .tiles { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px; max-width: 520px; max-height: 32vh; overflow: hidden; }
#pubRun .tiles i { width: 40px; height: 30px; border-radius: 4px; background: var(--surface-2) center / cover no-repeat; transition: transform .6s ease-in, opacity .6s ease-in; }
#pubRun .tiles i.scan { outline: 2px solid var(--accent); outline-offset: 1px; }
#pubRun .tiles i.sent { transform: translateY(-16px) scale(.6); opacity: 0; }
#pubRun .bar { width: min(360px, 100%); height: 6px; border-radius: 3px; background: var(--surface-2); overflow: hidden; }
#pubRun .bar i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .3s; }
#pubRun .meta { color: var(--muted); font-size: 14px; font-variant-numeric: tabular-nums; }
#pubRun .hint { color: var(--muted); font-size: 13px; }
`;

const el = (tag, attrs = {}, ...kids) => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) k in e ? (e[k] = v) : e.setAttribute(k, v); e.append(...kids); return e; };
// 介面文字的預設值（英文）；產品用 text 選項換成自己的語言
const TEXT = {
  title: 'Publish', who: 'Who can see it', private: 'Private', privateHint: 'Anyone with the link can download', public: 'Public', publicHint: 'Listed in the Red Dot "World"',
  copy: 'Copy', down: 'Unpublish', close: 'Close', go: 'Publish', preparing: 'Preparing', running: 'Publishing', keepOpen: 'Publishing, do not close this tab',
  goFailed: (m) => `Publish failed: ${m}`, downFailed: (m) => `Unpublish failed: ${m}`,
};

/**
 * 建立發佈畫面（一頁一個）。
 *   text：介面文字（key 見 TEXT，沒給的用英文；goFailed、downFailed 是 (訊息) => 文字）；title 沒給時用 text.title。
 *   title：對話框標題。
 *   extras：[DOM 節點]：放在「內容」和「誰看得到」之間（署名、岩館、不能發佈的清單…）。
 *   after：[DOM 節點]：放在「誰看得到」後面（開放改編…）。
 *   actions：[DOM 節點]：放在下架鈕後面、關閉鈕前面（匯出 ZIP、複製改編連結…）。
 *   visibility：false 就沒有公開／私人的選擇（預設有）。
 *   onGo()、onDown()、onVisibility(listed)、onCopy(link)：按鈕；回傳的 Promise 還沒結束時整個對話框是忙碌的（busy 時按鈕停用，錯誤用 set({ message }) 顯示）。
 * 回傳 { dialog, set(state), open(), close(), run }。
 */
export function createPublishUI({ text = {}, title, extras = [], after = [], actions = [], visibility = true, onGo, onDown, onVisibility, onCopy } = {}) {
  const X = { ...TEXT, ...text };
  title ??= X.title;
  if (!document.getElementById('dk-publish-css')) document.head.append(el('style', { id: 'dk-publish-css', textContent: CSS }));
  const link = el('a', { target: '_blank', rel: 'noopener' }), copy = el('button', { id: 'pubCopy', className: 'dk-btn small', textContent: X.copy });
  const share = el('div', { id: 'pubShare', hidden: true }, el('p', { id: 'pubLink' }, link, ' ', copy));
  const intro = el('p'), list = el('ul', { id: 'pubWhat' }), consent = el('div', { id: 'pubConsent', hidden: true }, intro, list);
  const radios = [['private', X.private, X.privateHint], ['public', X.public, X.publicHint]].map(([value, name, hint]) => el('label', {}, el('input', { type: 'radio', name: 'pubVis', value }), el('b', { textContent: name }), el('span', { textContent: hint })));
  const vis = el('div', { id: 'pubVis', className: 'vis', role: 'radiogroup', ariaLabel: X.who, hidden: !visibility }, ...radios);
  const msg = el('p', { id: 'pubMsg', role: 'status' });
  const down = el('button', { id: 'pubDown', className: 'dk-btn danger-text', textContent: X.down, hidden: true });
  const close = el('button', { className: 'dk-btn', value: '', textContent: X.close });
  const go = el('button', { id: 'pubGo', className: 'dk-btn primary', textContent: X.go });
  const dialog = el('dialog', { id: 'publishDlg' }, el('h3', { textContent: title }), share, consent, ...extras, vis, ...after, msg,
    el('div', { className: 'acts' }, down, ...actions, el('span', { className: 'grow' }), close, go));
  document.body.append(dialog);

  let busy = false;
  const inputs = () => [...dialog.querySelectorAll('#pubVis input')];
  dialog.addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b === close) { dialog.close(); return; }
    if (b === copy) { const l = link.href; navigator.clipboard?.writeText(l).then(() => onCopy?.(l), () => {}); return; }
    const fn = b === go ? onGo : b === down ? onDown : null;
    if (!fn || busy) return;
    busy = true; set({ busy: true });
    try { await fn(); } catch (err) { console.error('publish', err); msg.textContent = (b === go ? X.goFailed : X.downFailed)(err.message); }
    finally { busy = false; set({ busy: false }); }
  });
  dialog.addEventListener('change', async (e) => {
    if (e.target.name !== 'pubVis') return;
    await onVisibility?.(e.target.value === 'public');
  });

  /**
   * 畫面狀態（只給有變的欄位）：
   *   link：發佈過的連結（沒有就藏起來）；listed：true 公開、false 私人；
   *   summary：{ intro, items, hidden } 第一次發佈前列出會公開的內容（沒給或 hidden 就藏起來，清單內容照樣更新）；
   *   message：底下一行訊息；go：{ text, hidden, disabled }；canDown：有下架鈕；busy：忙碌（按鈕停用）。
   */
  function set(s) {
    if ('link' in s) { share.hidden = !s.link; if (s.link) Object.assign(link, { href: s.link, textContent: s.link }); }
    if ('listed' in s) for (const r of inputs()) r.checked = r.value === (s.listed === false ? 'private' : 'public');
    if ('summary' in s) { consent.hidden = !s.summary || !!s.summary.hidden; if (s.summary) { intro.textContent = s.summary.intro || ''; list.replaceChildren(...s.summary.items.map(t => el('li', { textContent: t }))); } }
    if ('message' in s) msg.textContent = s.message || '';
    if ('go' in s) { const g = s.go; if (g.text != null) go.textContent = g.text; if (g.hidden != null) go.hidden = g.hidden; go.dataset.off = g.disabled ? '1' : ''; }
    if ('canDown' in s) down.hidden = !s.canDown;
    if ('busy' in s) busy = s.busy;
    go.disabled = busy || go.dataset.off === '1';
    down.disabled = busy;
    for (const r of inputs()) r.disabled = busy;
  }

  // ---- 發佈過場：全螢幕，發佈完才關（Esc 關不掉、關分頁先問）；tiles 是會一格一格傳出去的小圖，cover 是封面 ----
  const rImg = el('div', { className: 'img' }), rCover = el('div', { className: 'cover' }, rImg), rName = el('b', { className: 'name' });
  const rTiles = el('div', { className: 'tiles' }), rBar = el('i'), rMeta = el('span', { className: 'meta', role: 'status' });
  const runDlg = el('dialog', { id: 'pubRun', ariaLabel: X.running }, rCover, rName, rTiles, el('div', { className: 'bar' }, rBar), rMeta, el('p', { className: 'hint', textContent: X.keepOpen }));
  document.body.append(runDlg);
  runDlg.addEventListener('cancel', (e) => e.preventDefault());
  const stay = (e) => { e.preventDefault(); e.returnValue = ''; };
  const cells = new Map(); let urls = [];
  const blobUrl = (b) => { const u = URL.createObjectURL(b); urls.push(u); return u; };
  const run = {
    /** name：標題；tiles：[{ key, thumb?: () => Promise<Blob> }]；cover：false 就不放封面 */
    open({ name = '', tiles = [], cover = true } = {}) {
      rName.textContent = name; rImg.style.backgroundImage = ''; rCover.hidden = !cover;
      cells.clear();
      for (const t of tiles) cells.set(t.key, el('i'));
      rTiles.replaceChildren(...cells.values()); rTiles.hidden = !tiles.length;
      for (const t of tiles) t.thumb?.().then((b) => { if (b && runDlg.open) cells.get(t.key).style.backgroundImage = `url("${blobUrl(b)}")`; });
      this.step(X.preparing);
      addEventListener('beforeunload', stay);
      runDlg.showModal();
    },
    /** 目前在做什麼、做到第幾個（進度條跟著） */
    step(text, n, total) { rMeta.textContent = total ? `${text} ${n}/${total}` : `${text}…`; rBar.style.width = total ? `${(100 * n) / total}%` : '0%'; },
    /** 正在處理這一格（第一格順便當封面） */
    scan(key, cover) { if (cover && !rImg.style.backgroundImage) rImg.style.backgroundImage = `url("${blobUrl(cover)}")`; for (const c of cells.values()) c.classList.remove('scan'); cells.get(key)?.classList.add('scan'); },
    sent(key) { const c = cells.get(key); if (c) { c.classList.remove('scan'); c.classList.add('sent'); } },
    close() { removeEventListener('beforeunload', stay); runDlg.close(); for (const u of urls) URL.revokeObjectURL(u); urls = []; },
  };

  return { dialog, set, run, open: () => dialog.showModal(), close: () => dialog.close(), get busy() { return busy; } };
}
