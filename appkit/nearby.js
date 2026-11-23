// AppKit nearby：附近交換。同一個網路的裝置互相看得到，用 WebRTC 直接傳；兩個畫面、兩件事：
//   mode: 'send'（傳給別人）：勾選附近的人（可多人）和要傳的東西，一次傳出去；收的人看到「○○ 想傳 N 項給你」，手動按「收下」。未配對只顯示「岩點貓／紅點貓＋匿名代號」，不帶金鑰、攀登記錄或真實裝置名稱。
//   mode: 'devices'（我的裝置）：配對過的自己的裝置，打開這一頁就自動連線、雙向同步（比較新的互送、收到的自動收下）；加入新裝置時兩台顯示同一組確認碼。
//     配對是所有 App 共用的（配一次，岩點貓、紅點貓、Studio 都認得）；同步只在相容的 App 之間：同一種，或其中一邊是 Studio（compatible）。
//     list、pack、take 的最後一個參數是對方的 App（'hold'｜'redpoint'｜'studio'），Studio 依它決定交換什麼。
// 找人和轉送連線訊息靠雲端函式 nearby（functions/nearby.js，只轉訊息、不碰資料）；資料走裝置之間的 DataChannel，不經過伺服器。
// 沒有 endpoint（自架的站、後端 none、連不上）時，傳給別人還能用「QR code」連線：一方顯示 QR code（offer），另一方掃了再顯示 QR code（answer），第一方掃回去就連上，完全不用伺服器。
// 瀏覽器不支援 WebRTC 就用不了：App 不顯示入口（看 AppKit.nearby.supported）。
// 瀏覽器用 <script> 載入，掛在全域 AppKit.nearby；樣式在 appkit/ui.css（.ak-nearby）。
//
// 用法：
//   AppKit.nearby.open({ app: 'hold', endpoint, label: '岩點貓', mode: 'send' | 'devices',
//     list: async (trusted, peerApp) => [{ id, name, sub?, img?, v, t? }], // img：縮圖網址（「傳給別人」的小卡用；沒有就顯示名字的第一個字） // 我可以給的東西（v：內容，字串陣列；devices 模式對方有同一個 id 而且 v 涵蓋我的就不送，有 t（修改時間）的比 t，只送比較新的）；trusted：對方是配對過的自己的裝置
//     pack: async (id, trusted, peerApp) => ({ name, entry, files: [{ path, bytes: Uint8Array }] }),   // 打包一項；entry：入口檔（接收時從它開始讀）
//     take: async (bundle, trusted, peerApp) => {},                  // 收下一項：bundle = { id, name, entry, url, files }，url 是 mem://… 讀得到打包的檔案（ShareTools.open）
//     sharePair: async () => 任何 JSON,  takePair: async (資料) => {},   // 配對時雙方各給一份、各收一份（例如岩點貓的裝置金鑰）
//     onClose })
//   → { close() }
//   AppKit.nearby.nickname() / setNickname(暱稱) / ensureNickname()：兩款 App 共用唯一暱稱，舊簽名自動遷移。
//   deviceName()：配對後用「暱稱＋裝置類型」區分，不再單獨改名。
//   AppKit.nearby.start(mode, { app, label, suggested, list, pack, take, … })：入口的共用接線（確認暱稱 → open）；AppKit.nearby.bind(按鈕, mode, adapter, before?)：接上入口按鈕。
//   AppKit.nearby.paired()：已配對幾台（所有 App 共用）。
// 配對：兩台各存一把只有彼此知道的密鑰（localStorage `climbio.nearby.pairs`：[{ psk, name, last? }]，所有 App 共用；舊的分 App 記錄 `climbio.nearby.pairs.<app>` 第一次讀時併進來）；用密鑰的雜湊當「配對房間」在伺服器上互相找到（伺服器看不到密鑰），連上後用密鑰證明（HMAC），證明過才同步。刪除不同步。
// 傳的是一個包：{ id, name, entry, files }。一次最多 MAX_BYTES；收的人也有同樣的上限。
// English: AppKit nearby: discover devices on the same network, send to several people at once (receiver accepts), and auto-sync your own paired devices over WebRTC.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(root);
  else (root.AppKit || (root.AppKit = {})).nearby = factory(root);
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  const ICON_BASE = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || (typeof location !== 'undefined' ? location.href : 'http://localhost/appkit/');   // appkit/nearby.js 自己的網址
  const CHUNK = 16 * 1024, HIGH = 1024 * 1024, LOW = 256 * 1024;   // DataChannel 一個訊息 16 KB；送出佇列超過 HIGH 就等到低於 LOW
  const MAX_BYTES = 150 * 1024 * 1024, MAX_FILES = 2000, IDLE = 55000, ERR_RETRY = 3000, CONNECT_TIMEOUT = 20000, PAIR_CODE_TIMEOUT = 12000, PROOF_TIMEOUT = 8000, RETRY_AFTER = 15000, POOL = 8;
  // 文字在共用名詞語言包（i18n/common/<語言>.js 的 nearby*）；沒載入語言包時（自架站、測試）用繁體中文
  const FALLBACK = {
    Title: '朋友互傳', SendTitle: '傳給朋友', DevicesTitle: '我的裝置', Devices: '配對裝置', Empty: '附近沒有其他裝置', Searching: '搜尋附近的人…', Retry: '重新尋找', Close: '關閉',
    People: '附近的人', WhatToSend: '要傳的', Nothing: '沒有可以傳的', SelectAll: '全選', SendTo: (n) => `傳給 ${n} 人`, SendPick: '選擇對象與內容',
    Wants: (n, k) => `${n} 想傳 ${k} 項給你`, Decline: '不要', Take: '收下', Taken: '已收下', FailedTake: '收不下', Got: '收到的',
    AskWait: (n) => `等 ${n} 收下…`, Refused: '對方沒有收下', Sending: '傳送中', Sent: '已傳送', Lost: '連線中斷', Failed: '連不上對方。請確認在同一個 Wi-Fi', Offline: '沒有網路，連不上', TooBig: '太大了，傳不出去', Linking: '連線中…',
    QrShow: '顯示 QR code', QrScan: '掃 QR code', QrNext: '掃對方的 QR code', QrShowHint: '讓對方掃這張 QR code，再掃對方的', QrAnswerHint: '讓對方掃這張 QR code，就會連線', QrScanHint: '對準對方手機上的 QR code', QrPeer: '對方', QrNoCamera: '無法使用相機', QrBack: '返回',
    AddDevice: '加入新裝置', AddHint: '在另一台開啟「我的裝置」', NoDevices: '尚無配對裝置',
    PairWants: (n) => `「${n}」想加入你的裝置`, PairWith: (n) => `和「${n}」配對`, SameCode: '兩台顯示的數字要一樣', Confirm: '一樣，確認', Cancel: '取消', WaitOther: '等對方確認…',
    Online: '在線', OfflineDev: '離線', LastSync: (t) => `上次同步 ${t}`, NeverSynced: '還沒同步過', Syncing: '同步中…', SyncedN: (a, b) => `已同步 · 送出 ${a} · 收到 ${b}`, Unpair: '取消配對',
  };
  const i18n = () => root.AppKit && root.AppKit.i18n;
  const text = new Proxy({}, { get: (_, k) => (typeof FALLBACK[k] === 'function'
    ? (...a) => { const v = i18n() && i18n().t(`nearby${k}`, ...a); return v && v !== `nearby${k}` ? v : FALLBACK[k](...a); }
    : (() => { const v = i18n() && i18n().t(`nearby${k}`); return v && v !== `nearby${k}` ? v : FALLBACK[k]; })()) });
  const make = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const supported = () => typeof RTCPeerConnection === 'function';
  const b64u = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64u = (x) => Uint8Array.from(atob(x.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const rand = (n) => b64u(crypto.getRandomValues(new Uint8Array(n)));
  const sha = async (s) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
  async function mac(psk, msg) {
    const k = await crypto.subtle.importKey('raw', unb64u(psk), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return b64u(new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg))));
  }
  /** 配對房間：密鑰的雜湊（伺服器看不到密鑰）；配對過的裝置用它在伺服器上互相找到，不管 IP 房間是不是一樣 */
  const roomOfPsk = async (psk) => hex(await sha(`climbio-nearby-room:${psk}`)).slice(0, 24);

  // 這台裝置的固定代號（每個 App 一個，存在 localStorage）：重新打開時伺服器據此清掉上一個分身，不會看到自己
  function devIdOf(app) {
    const k = `climbio.nearby.dev.${app}`;
    try { let v = localStorage.getItem(k); if (!/^[0-9a-f]{16,32}$/.test(v || '')) { v = hex(crypto.getRandomValues(new Uint8Array(12))); localStorage.setItem(k, v); } return v; } catch (e) { return ''; }
  }
  // ---------- 兩款 Viewer 共用的唯一暱稱 ----------
  const NICK_KEY = 'climbio.nickname';
  const cleanNick = v => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40);
  function setNickname(v) {
    const value = cleanNick(v);
    if (!value) return false; // 名稱不可空白
    try { localStorage.setItem(NICK_KEY, value); localStorage.setItem('climbio.nicknameAt', String(Date.now())); return true; }
    catch (e) { return false; }
  }
  function nickname() {
    try {
      const current = cleanNick(localStorage.getItem(NICK_KEY)); if (current) return current;
      const old = localStorage.getItem('climbio.sign'); // 舊版岩點貓 JSON 格式簽名
      if (old) {
        let legacy; try { legacy = JSON.parse(old); } catch (e) { legacy = old; }
        if (typeof legacy === 'string' && cleanNick(legacy) && setNickname(legacy)) return cleanNick(legacy);
      }
    } catch (e) { /* 無本機空間 */ }
    return '';
  }
  async function ensureNickname({ edit = false, suggested = '' } = {}) {
    const saved = nickname();
    if (saved && !edit) return saved;
    const ui = root.AppKit && root.AppKit.ui, label = i18n() && i18n().t('nicknameTitle');
    if (!ui || !ui.prompt) return null;
    const result = await ui.prompt({ title: label && label !== 'nicknameTitle' ? label : '暱稱',
      value: saved || cleanNick(suggested), max: 40, allowEmpty: false });
    return result != null && setNickname(result) ? nickname() : null;
  }
  function defaultName() {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Android';
    if (/Windows/.test(ua)) return 'Windows';
    if (/Macintosh|Mac OS/.test(ua)) return 'Mac';
    if (/CrOS/.test(ua)) return 'Chromebook';
    return '電腦';
  }
  function deviceName() {
    const n = nickname(), device = defaultName(), lang = (i18n() && i18n().lang) || 'zh';
    if (!n) return device; // 舊版未設定；新分享／配對入口會先要求暱稱
    // 名稱很長時仍保留裝置類型，避免兩台只剩相同暱稱。
    const suffix = lang === 'ja' ? `の${device}` : lang === 'ko' ? `의 ${device}` : lang === 'zh' ? `的 ${device}` : `'s ${device}`;
    return n.slice(0, Math.max(1, 30 - suffix.length)) + suffix;
  }
  // 舊 API 過渡別名；不再保存另一份裝置名稱。
  const setDeviceName = setNickname;

  // ---------- 收到的包放在記憶體：ShareTools.open 認得 mem://<包>/<路徑>（appkit/share-tools.js 的 memPut） ----------
  const memUrl = (bid, path) => `mem://${bid}/${path}`;

  // ---------- 傳輸：每個人一條 DataChannel，文字訊息是 JSON、二進位是檔案內容 ----------
  // who { name, nonce, rooms }；proof { mac }；offer { items }／accept／decline（傳給別人）；bundle { bid, id, name, entry, files: [{ path, size }] } 之後依序是每個檔案的二進位，收齊回 ack { id, bid }；
  // hello { items }（我的裝置：我有的清單）；pair-ok／pair／paired／pair-no（加入新裝置）；bye
  async function pump(ch, bytes, onBytes) {
    for (let i = 0; i < bytes.length; i += CHUNK) {
      if (ch.readyState !== 'open') throw new Error('closed');
      if (ch.bufferedAmount > HIGH) await new Promise((ok) => { ch.bufferedAmountLowThreshold = LOW; ch.addEventListener('bufferedamountlow', ok, { once: true }); });
      ch.send(bytes.subarray(i, i + CHUNK));
      onBytes(Math.min(CHUNK, bytes.length - i));
    }
  }

  // ---------- 配對（所有 App 共用一份）與相容的 App ----------
  const PAIR_KEY = 'climbio.nearby.pairs', LEGACY_APPS = ['hold', 'redpoint'];
  const validPairs = (l) => (Array.isArray(l) ? l.filter((x) => x && typeof x.psk === 'string' && x.psk.length >= 16) : []);
  const readJson = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  function readPairs() {
    const now = readJson(PAIR_KEY);
    if (Array.isArray(now)) return validPairs(now);
    const merged = [];   // 第一次：把舊的分 App 記錄併成一份（同一把密鑰只留一筆）
    for (const a of LEGACY_APPS) for (const p of validPairs(readJson(`${PAIR_KEY}.${a}`))) if (!merged.some((x) => x.psk === p.psk)) merged.push(p);
    writePairs(merged);
    return merged;
  }
  function writePairs(l) { try { localStorage.setItem(PAIR_KEY, JSON.stringify(l)); } catch (e) { /* 沒有儲存空間：這次連線有效，下次要重配 */ } }
  /** 我的裝置之間能不能同步：同一種 App，或其中一邊是 Studio（Studio 編輯岩點貓的牆、紅點貓的 Guidebook） */
  const compatible = (a, b) => !a || !b || a === b || a === 'studio' || b === 'studio';

  function open(o) {
    const T = text, endpoint = o.endpoint, mode = o.mode === 'devices' ? 'devices' : 'send', devices = mode === 'devices';
    const st = {
      id: '', peers: [], timer: 0, closed: false, idle: false, last: Date.now(), links: new Map(), failedAt: new Map(), rooms: new Map(),   // rooms：配對房間 → 配對（psk）
      sel: new Set(), items: [], pick: new Set(), packs: new Map(), phase: 'main', pairs: readPairs(), flow: null, adding: false, renderAt: 0, dirty: false, down: 0, anim: { peers: new Set(), cls: new Map(), asked: new WeakSet() }, doneAt: 0, rounds: 0,
    };
    const pairByPsk = (psk) => st.pairs.find((p) => p.psk === psk);
    const savePair = (psk, name) => { const o2 = pairByPsk(psk); if (o2) { if (name) o2.name = name; } else st.pairs.push({ psk, name: name || '', at: Date.now() }); writePairs(st.pairs); };
    const touchPair = (psk, patch) => { const p = pairByPsk(psk); if (p) { Object.assign(p, patch); writePairs(st.pairs); } };
    const call = async (body) => {
      const r = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, ...(st.id ? { id: st.id } : {}) }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status });
      return j;
    };
    const signal = (to, msg) => call({ op: 'send', to, msg });
    const toastText = (t) => { if (root.AppKit && root.AppKit.ui) root.AppKit.ui.toast(t); };
    const myName = () => deviceName(), devId = () => devIdOf(o.app);
    // 每次開啟此頁產生匿名名稱，不跟裝置設定名稱、帳號或持久裝置 ID 綁定；相同名稱由 shown() 附加臨時代號區分。
    const anonName = `${o.label || ({ redpoint: '紅點貓', studio: 'Studio' }[o.app] || '岩點貓')} ${1000 + crypto.getRandomValues(new Uint16Array(1))[0] % 9000}`;

    // ---------- 畫面 ----------
    const page = make('div', 'ak-nearby'), bar = make('div', 'ak-nb-bar'), head = make('b', 'ak-nb-title', devices ? T.DevicesTitle : T.SendTitle);
    const closeBtn = make('button', 'ak-nb-x', '×'); closeBtn.type = 'button'; closeBtn.setAttribute('aria-label', T.Close);
    bar.append(head, closeBtn);
    const body = make('div', 'ak-nb-body');
    page.append(bar, body);
    page.setAttribute('role', 'dialog'); page.setAttribute('aria-label', head.textContent);
    document.body.append(page);
    const btn = (text, primary, fn) => { const b = make('button', `btn${primary ? ' primary' : ''}`, text); b.type = 'button'; b.onclick = fn; return b; };
    const row = (...kids) => { const r = make('div', 'ak-nb-item'); r.append(...kids); return r; };
    const nameBox = (title, sub) => { const s = make('span', 'ak-nb-name'); s.append(make('b', '', title)); if (sub) s.append(make('small', '', sub)); return s; };
    const checkbox = (checked, on, disabled) => { const c = make('input'); c.type = 'checkbox'; c.checked = checked; c.disabled = !!disabled; c.onchange = () => on(c.checked); return c; };
    function render() {   // 同一刻很多事件進來（傳輸進度）時合併成一次畫
      if (st.closed || st.dirty) return;
      st.dirty = true; queueMicrotask(draw);
    }
    const rel = (t) => {
      const d = Math.max(0, Date.now() - t), min = Math.round(d / 60000);
      try {
        const f = new Intl.RelativeTimeFormat((i18n() && i18n().lang) || undefined, { numeric: 'auto' });
        return min < 1 ? f.format(0, 'minute') : min < 60 ? f.format(-min, 'minute') : min < 1440 ? f.format(-Math.round(min / 60), 'hour') : f.format(-Math.round(min / 1440), 'day');
      } catch (e) { return `${min}m`; }
    };
    // 附近的人的顯示名字：同名的加上代號尾巴分辨
    const shown = (list) => list.map((p) => ({ ...p, label: list.filter((x) => x.name === p.name).length > 1 ? `${p.name} · ${p.id.slice(-2)}` : p.name }));
    function draw() {
      st.dirty = false;
      if (st.closed) return;
      body.replaceChildren();
      if (st.phase === 'qrShow' || st.phase === 'qrAnswer') {
        body.append(make('p', 'ak-nb-hint', st.phase === 'qrShow' ? T.QrShowHint : T.QrAnswerHint));
        const img = make('img', 'ak-nb-qr'); img.src = st.qr; img.alt = ''; body.append(img);
        const r = make('div', 'ak-actions');
        r.append(btn(T.QrBack, false, backToMain));
        if (st.phase === 'qrShow') r.append(btn(T.QrNext, true, () => qrScan('answer')));
        body.append(r);
        return;
      }
      if (st.phase === 'qrScan') {
        body.append(make('p', 'ak-nb-hint', T.QrScanHint));
        const v = make('video', 'ak-nb-video'); v.setAttribute('playsinline', ''); v.muted = true; body.append(v);
        body.append(btn(T.QrBack, false, backToMain));
        startScan(v);
        return;
      }
      if (st.phase === 'fail') { body.append(make('p', 'ak-nb-hint', st.error || T.Failed), btn(T.Close, false, close)); return; }
      drawPrompts();
      if (devices) drawDevices(); else drawSend();
      if (st.idle) { const again = btn('↻', false, () => { st.idle = false; st.last = Date.now(); render(); poll(); }); again.setAttribute('aria-label', T.Retry); body.append(again); }
    }

    // 別人想傳東西給我（兩個畫面都會收到）：手動按「收下」；收下後顯示進度
    function drawPrompts() {
      const got = [];
      for (const L of st.links.values()) {
        if (L.offer && !L.accepted && !L.declined && L.open && !L.dead) {   // 線斷了的提示按了也送不出去，不顯示
          const first = !st.anim.asked.has(L.offer); st.anim.asked.add(L.offer);
          const sec = make('section', `ak-nb-sec ak-nb-ask${first ? ' pop' : ''}`);
          const who = make('div', 'ak-pair-faces'); who.append(face(L.label(), true));
          sec.append(who, make('p', 'ak-nb-hint', T.Wants(L.label(), L.offer.length)));
          const names = make('p', 'ak-nb-small', L.offer.map((i) => i.name).filter(Boolean).slice(0, 5).join('、') + (L.offer.length > 5 ? '…' : ''));
          const r = make('div', 'ak-actions'); r.append(btn(T.Decline, false, () => answerOffer(L, false)), btn(T.Take, true, () => answerOffer(L, true)));
          sec.append(names, r); body.append(sec);
        }
        for (const r of L.recv) got.push({ L, r });
      }
      if (!got.length) return;
      const sec = make('section', 'ak-nb-sec'); sec.append(make('h3', '', T.Got));
      const list = make('div', 'ak-nb-items');
      for (const { L, r } of got) list.append(row(nameBox(r.name || '—', `${L.label()} · ${r.error || (r.taken ? T.Taken : r.done ? T.Take : `${Math.round((r.got / Math.max(r.size, 1)) * 100)}%`)}`)));
      sec.append(list); body.append(sec);
    }

    // ---------- 頭像：共用功能使用各 App 的正式 SVG；裝置識別色只用於小圓點，不改品牌圖 ----------
    const CAT_ICON = new URL(o.app === 'redpoint' ? '../icons/cats/redpoint-cat.svg' : o.app === 'studio' ? '../icons/brand/climbio-mark.svg' : '../icons/cats/hold-cat.svg', ICON_BASE).href;   // 從 appkit/ 算，不管頁面在第幾層
    const DEVICE_COLORS = ['#A4DC2A', '#FF7A93', '#5BB8F5', '#FFC83D', '#A27BFF'];
    const hueOf = (key) => { let h = 7; for (const c of String(key || '')) h = (h * 31 + c.charCodeAt(0)) % 997; return h; };
    function face(key, awake = true) {
      const s = make('span', `ak-face${awake ? '' : ' asleep'}`);
      s.style.setProperty('--ak-device-color', DEVICE_COLORS[hueOf(key) % DEVICE_COLORS.length]);
      const icon = make('img');
      icon.src = CAT_ICON;
      icon.alt = '';
      icon.draggable = false;
      icon.setAttribute('aria-hidden', 'true');
      s.append(icon);
      return s;
    }

    // ----- 傳給別人：雷達。中間是我，附近的人是冒出來的頭像，點頭像選取；傳的時候縮圖飛過去、頭像外圈跑進度 -----
    function peerState(L) {
      const x = L && L.out;
      if (!x) return { cls: '', text: '' };
      if (x.phase === 'asking') return { cls: 'asking', text: T.AskWait(L.label()) };
      if (x.phase === 'sending') return { cls: 'sending', pct: x.pct == null ? Math.round((x.done / x.total) * 100) : Math.round(((x.done + x.pct / 100) / x.total) * 100), text: `${T.Sending} ${x.done}/${x.total}` };
      if (x.phase === 'done') return { cls: 'done', text: T.Sent };
      if (x.phase === 'declined') return { cls: 'declined', text: T.Refused };
      return { cls: 'declined', text: x.error || T.Failed };
    }
    function radar(peers, { picked, toggle, stateOf }) {
      const box = make('div', 'ak-radar has-peers'), n = peers.length;
      const anim = st.anim, now = Date.now();   // 畫面每次重畫整個重建：動畫只在第一次出現、狀態改變時播，持續的動畫用時鐘對齊相位，不從頭來
      for (let i = 0; i < 3; i++) { const ring = make('i', 'ak-ring'); ring.style.animationDelay = `-${(((now - i * 1200) % 3600) + 3600) % 3600}ms`; box.append(ring); }
      const me = make('span', 'ak-radar-me'); me.append(face(myName(), true)); box.append(me);
      peers.forEach((p, i) => {
        const inner = n <= 6 ? n : 6, ring = i < inner ? 0 : 1, count = ring ? n - inner : inner, idx = ring ? i - inner : i;
        const ang = (idx / count) * Math.PI * 2 - Math.PI / 2 + (ring ? Math.PI / count : 0), r = ring ? 44 : (n === 1 ? 33 : 32);
        const st = (stateOf && stateOf(p)) || { cls: '' };
        const enter = !anim.peers.has(p.id), still = !enter && anim.cls.get(p.id) === st.cls && st.cls !== 'asking';
        anim.peers.add(p.id); anim.cls.set(p.id, st.cls);
        const b = make('button', `ak-peer ${st.cls}${picked(p) ? ' on' : ''}${enter ? ' enter' : ''}${still ? ' still' : ''}`); b.type = 'button'; b.dataset.id = p.id;
        b.setAttribute('aria-pressed', picked(p) ? 'true' : 'false'); b.setAttribute('aria-label', p.label);
        b.style.left = `${50 + r * Math.cos(ang)}%`; b.style.top = `${50 + r * Math.sin(ang)}%`; if (enter) b.style.animationDelay = `${i * 70}ms`;
        const ring2 = make('span', 'ak-peer-ring'); if (st.cls === 'asking') ring2.style.animationDelay = `-${now % 1100}ms`; if (st.pct != null) ring2.style.setProperty('--p', `${st.pct}%`);
        const fc = make('span', 'ak-peer-face'); fc.append(face(p.id.length > 2 && p.id !== 'qr' ? p.name : p.id, true), make('em', 'ak-peer-check', '✓'));
        ring2.append(fc);
        b.append(ring2, make('b', '', p.label)); if (st.text) b.append(make('small', '', st.text));
        b.onclick = () => toggle(p);
        box.append(b);
      });
      return box;
    }
    function drawSend() {
      // 自己配對過的裝置不列在這裡（它們在「我的裝置」自動同步，不用手動傳）
      const peers = shown([...st.peers.filter((p) => !(p.via && p.via.length)), ...[...st.links.values()].filter((L) => L.pid === 'qr' && L.open).map(() => ({ id: 'qr', name: T.QrPeer }))]);
      const ps = make('section', 'ak-nb-sec ak-nb-radar'); ps.append(make('h3', '', T.People));
      const busyOf = (p) => { const L = st.links.get(p.id); return !!(L && L.out && ['asking', 'sending'].includes(L.out.phase)); };
      if (!peers.length) {
        const empty = make('div', 'ak-radar empty'); for (let i = 0; i < 3; i++) empty.append(make('i', 'ak-ring'));
        const me = make('span', 'ak-radar-me'); me.append(face(myName(), true)); empty.append(me);
        ps.append(empty, make('p', 'ak-nb-hint', navigator.onLine === false ? T.Offline : endpoint && st.down < 2 && !st.idle ? (st.id ? T.Empty : T.Searching) : ''));
      } else {
        ps.append(radar(peers, { picked: (p) => st.sel.has(p.id), toggle: (p) => { if (busyOf(p)) return; st.sel.has(p.id) ? st.sel.delete(p.id) : st.sel.add(p.id); render(); }, stateOf: (p) => peerState(st.links.get(p.id)) }));
        if (peers.length > 1) { const all = make('button', 'ak-nb-all', T.SelectAll); all.type = 'button'; all.onclick = () => { const every = peers.every((p) => st.sel.has(p.id)); for (const p of peers) every ? st.sel.delete(p.id) : st.sel.add(p.id); render(); }; ps.append(all); }
      }
      body.append(ps);
      if (!endpoint || st.down >= 2) {   // 沒有伺服器、或確定連不上伺服器：QR code 備用連線（連得上就不顯示，沒找到人也不顯示）
        const qr = make('div', 'ak-actions'); qr.append(btn(T.QrShow, false, qrHost), btn(T.QrScan, false, () => qrScan('offer'))); body.append(qr);
      }
      const is = make('section', 'ak-nb-sec'); is.append(make('h3', '', T.WhatToSend));
      if (!st.items.length) is.append(make('p', 'ak-nb-hint', T.Nothing));
      else {
        const chips = make('div', 'ak-chips');
        if (st.items.length > 1) { const all = make('button', 'ak-chip all', T.SelectAll); all.type = 'button'; all.setAttribute('aria-pressed', st.items.every((i) => st.pick.has(i.id)) ? 'true' : 'false'); all.onclick = () => { const every = st.items.every((i) => st.pick.has(i.id)); for (const i of st.items) every ? st.pick.delete(i.id) : st.pick.add(i.id); render(); }; chips.append(all); }
        for (const i of st.items) {
          const c = make('button', 'ak-chip'); c.type = 'button'; c.setAttribute('aria-pressed', st.pick.has(i.id) ? 'true' : 'false');
          const pic = make('span', 'ak-chip-pic');
          if (i.img) { const im = make('img'); im.src = i.img; im.alt = ''; im.loading = 'lazy'; im.decoding = 'async'; im.draggable = false; pic.append(im); } else pic.append(make('em', '', [...(i.name || '?')][0]));
          pic.append(make('i', 'ak-chip-check', '✓'));
          c.append(pic, make('b', '', i.name || '—')); if (i.sub) c.append(make('small', '', i.sub));
          c.onclick = () => { st.pick.has(i.id) ? st.pick.delete(i.id) : st.pick.add(i.id); render(); };
          chips.append(c);
        }
        is.append(chips);
      }
      body.append(is);
      const targets = peers.filter((p) => st.sel.has(p.id)), picks = st.items.filter((i) => st.pick.has(i.id)), busy = targets.some(busyOf);
      const go = btn(targets.length ? T.SendTo(targets.length) : T.SendPick, true, () => { fly(targets, picks); sendToSelected(targets, picks); });
      go.classList.add('ak-nb-go'); go.disabled = !targets.length || !picks.length || busy;
      body.append(go);
    }
    /** 傳的時候：一個小方塊從中間飛向每個對象的頭像（畫在最上層，不受重畫影響） */
    function fly(targets, picks) {
      if (!picks.length || (root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
      const me = body.querySelector('.ak-radar-me'); if (!me) return;
      const from = me.getBoundingClientRect(), label = (picks[0].name || '').slice(0, 2);
      for (const p of targets) {
        const el = body.querySelector(`.ak-peer[data-id="${p.id}"] .ak-peer-face`); if (!el) continue;
        const to = el.getBoundingClientRect(), chip = make('span', 'ak-fly', label);
        chip.style.left = `${from.left + from.width / 2 - 18}px`; chip.style.top = `${from.top + from.height / 2 - 18}px`;
        page.append(chip);
        requestAnimationFrame(() => requestAnimationFrame(() => { chip.style.transform = `translate(${to.left + to.width / 2 - from.left - from.width / 2}px, ${to.top + to.height / 2 - from.top - from.height / 2}px) scale(.5)`; chip.style.opacity = '0'; }));
        setTimeout(() => chip.remove(), 900);
      }
    }

    // ----- 我的裝置：自己的裝置排成一排卡片，用線連著；在線小貓醒著、離線睡著、同步時線在流動 -----
    function drawDevices() {
      const me = make('section', 'ak-nb-sec'), card = make('div', 'ak-nb-item ak-dev-card me');
      card.append(face(myName(), true), nameBox(myName())); // 自動組合裝置名稱，不提供額外改名設定
      me.append(card); body.append(me);
      if (st.adding) return drawAdd();
      const sec = make('section', 'ak-nb-sec ak-dev-list');
      if (!st.pairs.length) sec.append(make('p', 'ak-nb-hint', T.NoDevices));
      else {
        sec.append(make('h3', '', T.Devices));
        for (const p of st.pairs) {
          const L = [...st.links.values()].find((x) => x.pair && x.pair.psk === p.psk && x.trusted), online = !!L || st.peers.some((x) => (x.via || []).includes(p.room));
          let s, state;
          if (L) { s = L.synced ? T.SyncedN(L.stats.sent, L.stats.got) : T.Syncing; state = L.synced ? 'synced' : 'syncing'; }
          else if (online) { s = T.Linking; state = 'syncing'; }
          else { s = p.last ? `${T.OfflineDev} · ${T.LastSync(rel(p.last))}` : `${T.OfflineDev} · ${T.NeverSynced}`; state = 'off'; }
          sec.append(make('i', `ak-dev-link ${state}`));
          const r = make('div', `ak-nb-item ak-dev-card ${state}`);
          r.append(face(p.psk, online), nameBox(p.name || '—', s), btn(T.Unpair, false, () => unpair(p)));
          sec.append(r);
        }
      }
      body.append(sec, btn(T.AddDevice, !st.pairs.length, () => { st.adding = true; render(); }));
    }
    function drawAdd() {
      const f = st.flow;
      if (f) {   // 兩台顯示同一組確認碼，都按確認才配對
        const sec = make('section', 'ak-nb-sec ak-nb-ask');
        const faces = make('div', 'ak-pair-faces'); faces.append(face(myName(), true), make('i', 'ak-pair-link'), face(f.incoming ? (f.L.theirName || f.L.label()) : f.L.label(), true));
        sec.append(faces, make('p', 'ak-nb-hint', f.incoming ? T.PairWants(f.L.theirName || f.L.label()) : T.PairWith(f.L.label())));
        sec.append(make('div', 'ak-nb-code', f.code || '····'), make('p', 'ak-nb-small', T.SameCode));
        const r = make('div', 'ak-actions');
        r.append(btn(T.Cancel, false, () => cancelFlow(true)));
        if (f.code) { const ok = btn(f.myOk ? T.WaitOther : T.Confirm, true, confirmFlow); ok.disabled = f.myOk; r.append(ok); }
        sec.append(r); body.append(sec); return;
      }
      const sec = make('section', 'ak-nb-sec ak-nb-radar'), unpaired = shown(st.peers.filter((p) => !(p.via && p.via.length)));
      if (!unpaired.length) {
        const empty = make('div', 'ak-radar empty'); for (let i = 0; i < 3; i++) empty.append(make('i', 'ak-ring'));
        const me = make('span', 'ak-radar-me'); me.append(face(myName(), true)); empty.append(me);
        sec.append(empty, make('p', 'ak-nb-hint', T.AddHint));
      } else sec.append(radar(unpaired, { picked: () => false, toggle: (p) => startPairing(p) }));
      body.append(sec, btn(T.Cancel, false, () => { st.adding = false; render(); }));
    }

    // ---------- 找人 ----------
    async function rejoin() { if (!endpoint || st.closed) return; try { await call({ op: 'leave' }); } catch (e) { /* 離開失敗無妨 */ } st.id = ''; }
    // 保持開著的請求：附近的人有變動或有訊息才回，回來就立刻發下一個；沒有任何操作超過 IDLE 就自己離開（不讓人放著給別人隨時連）
    const busy = () => st.links.size > 0 || !!st.flow || st.adding || st.phase !== 'main';
    const sigOf = (list) => list.map((p) => p.id).sort().join(',');
    async function stopIdle() {
      st.idle = true; clearTimeout(st.timer);
      try { await call({ op: 'leave' }); } catch (e) { /* 離開失敗無妨 */ }
      st.id = ''; st.peers = []; render();
    }
    async function poll() {
      if (st.closed || st.idle || st.polling) return;   // 保持開著的請求同時只有一個
      st.polling = true;
      if (busy()) st.last = Date.now();
      let ok = false;
      try {
        const j = st.id ? await call({ op: 'poll', wait: Math.max(1000, Math.min(IDLE, st.last + IDLE - Date.now())), sig: sigOf(st.peers) }) : await call({ op: 'join', app: o.app, name: anonName, dev: devId(), pairRooms: [...st.rooms.keys()] });
        if (!st.id) st.id = j.id;
        st.peers = (j.peers || []).filter((p) => (devices ? compatible(p.app, o.app) : !p.app || p.app === o.app)); st.down = 0;   // 傳給別人只有同一種 App；我的裝置連相容的
        for (const m of j.msgs || []) await onSignal(m.from, m.msg);
        if (devices) autoConnect();
        render(); ok = true;
      } catch (e) {
        if (e.status === 410) st.id = '';   // 伺服器不記得我了：下一輪重新加入
        else if (navigator.onLine === false) { if (st.down < 2) { st.down = 2; render(); } }   // 沒有網路：不擋住畫面，直接露出 QR code（山上沒訊號、只靠熱點時要靠它）；有網路了下一輪自動接上
        else if (++st.down === 2) render();   // 連續兩次連不上伺服器：才換成 QR code 備用方案
      }
      st.polling = false;
      if (st.closed) return;
      if (!busy() && Date.now() - st.last >= IDLE) return stopIdle();
      st.timer = setTimeout(poll, ok ? 100 : ERR_RETRY);
    }
    // 我的裝置：配對過的出現就連（同時可以連好幾台）
    function autoConnect() {
      for (const p of st.peers) {
        const pr = (p.via || []).map((r) => st.rooms.get(r)).find(Boolean);
        if (!pr || st.links.has(p.id) || (st.failedAt.get(p.id) || 0) > Date.now() - RETRY_AFTER || st.flow) continue;
        connect(p, 'sync');
      }
    }

    // ---------- 連線（每個人一條）----------
    function newLink(pid, name, intent, initiator) {
      const L = { pid, name, theirName: '', intent, initiator, pc: null, ch: null, open: false, ice: [], nonce: rand(12), theirNonce: '', rooms: [], pair: null, trusted: false, helloIn: false,
        theirs: new Map(), theirsT: new Map(), mine: [], busy: new Set(), recv: [], cur: null, out: null, offer: null, accepted: false, declined: false, synced: false, stats: { sent: 0, got: 0 }, timer: 0, quiet: 0, waiters: [], q: Promise.resolve() };
      L.downP = new Promise((ok) => { L.down = ok; });
      L.label = () => { const p = st.peers.find((x) => x.id === pid); return (L.trusted && L.pair && L.pair.name) || L.theirName || (p && p.name) || L.name || T.QrPeer; };
      L.send = (m) => { try { if (L.ch && L.ch.readyState === 'open') L.ch.send(JSON.stringify(m)); } catch (e) { /* 對方已離開 */ } };
      return L;
    }
    function pcOf(L) {
      const pc = new RTCPeerConnection({ iceServers: [] });
      L.pc = pc;
      pc.onicecandidate = (e) => { if (e.candidate && L.pid !== 'qr') signal(L.pid, { k: 'ice', c: e.candidate }).catch(() => {}); };
      pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState) && L.pc === pc) linkDown(L); };
      L.timer = setTimeout(() => { if (!L.open) { st.failedAt.set(L.pid, Date.now()); linkDown(L, T.Failed); } }, CONNECT_TIMEOUT);
      return pc;
    }
    function connect(p, intent) {
      const L = newLink(p.id, p.name, intent, true);
      st.links.set(p.id, L);
      const pc = pcOf(L);
      wire(L, pc.createDataChannel('nearby', { ordered: true }));
      pc.createOffer().then((d) => pc.setLocalDescription(d)).then(() => signal(p.id, { k: 'offer', sdp: pc.localDescription, intent })).catch(() => { st.failedAt.set(p.id, Date.now()); linkDown(L, T.Failed); });
      return L;
    }
    async function onSignal(from, m) {
      if (!m || typeof m.k !== 'string') return;
      let L = st.links.get(from);
      if (m.k === 'offer') {
        const intent = ['send', 'sync', 'pair'].includes(m.intent) ? m.intent : 'send';
        if ((intent === 'sync' || intent === 'pair') && !devices) return;   // 只有打開「我的裝置」才接同步與配對；別人的連線不理，對方會自己放棄
        if (intent === 'pair' && !st.adding) return;
        if (L && L.open && !L.dead) return;   // 已經連好的線不拆：這是兩邊同時連對方時，對方慢到的邀請（它早改用我這條了），拆掉會讓正在問的提示掛在死線上
        if (L && !L.open && L.initiator) { if (st.id < from) return; linkDown(L, '', true); L = null; }   // 兩邊同時連對方：id 小的那條留下
        else if (L) { linkDown(L, '', true); L = null; }
        const peer = st.peers.find((x) => x.id === from) || { id: from, name: '?' };
        L = newLink(from, peer.name, intent, false);
        st.links.set(from, L);
        const pc = pcOf(L);
        pc.ondatachannel = (e) => wire(L, e.channel);
        await pc.setRemoteDescription(m.sdp); await flushIce(L); await pc.setLocalDescription();
        signal(from, { k: 'answer', sdp: pc.localDescription }).catch(() => linkDown(L, T.Failed));
        if (intent === 'pair') { st.flow = { L, incoming: true, myOk: false, theirOk: false, code: '' }; flowGuard(st.flow); }
      } else if (m.k === 'answer' && L && L.pc) { await L.pc.setRemoteDescription(m.sdp); await flushIce(L); }
      else if (m.k === 'ice' && L && L.pc) { if (L.pc.remoteDescription) await L.pc.addIceCandidate(m.c).catch(() => {}); else L.ice.push(m.c); }
    }
    async function flushIce(L) { for (const c of L.ice.splice(0)) await L.pc.addIceCandidate(c).catch(() => {}); }
    function linkDown(L, error, silent) {
      clearTimeout(L.timer); clearTimeout(L.trustTimer); L.down();
      if (st.links.get(L.pid) === L) st.links.delete(L.pid);
      try { L.ch && L.ch.close(); } catch (e) { /* 已關 */ }
      try { L.pc && L.pc.close(); } catch (e) { /* 已關 */ }
      L.pc = L.ch = null; L.open = false;
      for (const w of L.waiters.splice(0)) w(false);
      for (const r of L.recv) if (!r.taken && root.ShareTools) root.ShareTools.memDrop(r.bid);
      if (L.out && ['asking', 'sending'].includes(L.out.phase)) L.out = { ...L.out, phase: 'error', error: error || T.Lost };
      if (st.flow && st.flow.L === L) { st.flow = null; }
      if (!silent && L.out) st.links.set(L.pid, Object.assign(L, { dead: true }));   // 傳送結果還要顯示一下
      if (L.dead && !L.out) st.links.delete(L.pid);
      render();
    }
    function wire(L, ch) {
      L.ch = ch; ch.binaryType = 'arraybuffer';
      ch.onopen = () => {
        clearTimeout(L.timer); L.open = true;
        L.send({ t: 'who', name: anonName, nonce: L.nonce, app: o.app, rooms: devices ? [...st.rooms.keys()] : [] });
        if (L.intent === 'sync' || L.intent === 'pair') L.trustTimer = setTimeout(() => { if (!L.trusted && !st.flow) { st.failedAt.set(L.pid, Date.now()); linkDown(L, '', true); } }, PROOF_TIMEOUT);
        if (L.pid === 'qr') { st.phase = 'main'; st.sel.add('qr'); }
        render();
      };
      ch.onclose = () => { if (L.pc) { if (L.out && ['asking', 'sending'].includes(L.out.phase)) linkDown(L, T.Lost); else linkDown(L, '', true); } };
      // 一條連線的訊息照順序處理（證明要先驗完，後面的清單、檔案才算數）
      ch.onmessage = (e) => { L.q = L.q.then(() => { if (typeof e.data === 'string') { let m; try { m = JSON.parse(e.data); } catch (x) { return; } return onText(L, m); } onBinary(L, e.data); }).catch((x) => console.warn('nearby', x)); };
    }

    // ---------- 收到的訊息 ----------
    async function onText(L, m) {
      if (m.t === 'who' && typeof m.name === 'string' && typeof m.nonce === 'string' && m.nonce.length <= 64) {
        L.theirName = m.name.slice(0, 30); L.theirNonce = m.nonce; L.theirApp = ['hold', 'redpoint', 'studio'].includes(m.app) ? m.app : o.app; L.rooms = Array.isArray(m.rooms) ? m.rooms.filter((x) => typeof x === 'string').slice(0, 16) : [];
        if (devices && L.intent === 'sync' && compatible(L.theirApp, o.app)) {
          const pr = L.rooms.map((r) => st.rooms.get(r)).find(Boolean);
          if (pr) { L.pair = pr; L.send({ t: 'proof', mac: await mac(pr.psk, `proof:${L.theirNonce}:${L.nonce}`) }); }   // 我有這台的密鑰：證明給它看（它的亂數＋我的亂數）
        }
        if (L.intent === 'pair' && st.flow && st.flow.L === L) { st.flow.code = await codeOf(L); }
        render();
      } else if (m.t === 'name' && typeof m.name === 'string' && L.trusted && L.intent === 'sync') {
        // 只接受密鑰驗證通過的裝置名稱；陌生人的 name 訊息不可寫入配對記錄。
        const name = m.name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 30);
        if (name) { L.theirName = name; touchPair(L.pair.psk, { name }); render(); }
      } else if (m.t === 'proof' && typeof m.mac === 'string' && L.pair && L.intent === 'sync' && !L.trusted) {
        if (m.mac === await mac(L.pair.psk, `proof:${L.nonce}:${L.theirNonce}`)) {   // 它也有密鑰：是配對過的那台
          clearTimeout(L.trustTimer); L.trusted = true;
          L.send({ t: 'name', name: myName() }); // 驗證完成後才交出自己的真實裝置名稱
          await sendHello(L); syncProgress(L); render();
        }
      } else if (m.t === 'hello' && Array.isArray(m.items) && L.trusted) {
        L.helloIn = true; L.theirs = new Map(m.items.filter((x) => x && typeof x.id === 'string').map((x) => [x.id, new Set(Array.isArray(x.v) ? x.v.map(String) : [])]));
        L.theirsT = new Map(m.items.filter((x) => x && typeof x.id === 'string' && Number.isFinite(x.t)).map((x) => [x.id, x.t]));
        syncProgress(L); render();
      } else if (m.t === 'offer-items' && Array.isArray(m.items)) {
        const items = m.items.filter((x) => x && typeof x.id === 'string').slice(0, 200).map((x) => ({ id: x.id, name: String(x.name || '').slice(0, 80) }));
        if (items.length) { L.offer = items; L.accepted = L.declined = false; render(); }
      } else if (m.t === 'accept' && L.out && L.out.phase === 'asking') { L.out.phase = 'sending'; for (const w of L.waiters.splice(0)) w(true); render(); }
      else if (m.t === 'decline' && L.out && L.out.phase === 'asking') { L.out.phase = 'declined'; for (const w of L.waiters.splice(0)) w(false); render(); }
      else if (m.t === 'bundle') {
        if (!(L.trusted || L.accepted)) return;   // 沒按「收下」、也不是自己的裝置：不收
        const files = Array.isArray(m.files) ? m.files.filter((f) => f && typeof f.path === 'string' && Number.isSafeInteger(f.size) && f.size >= 0 && f.size <= MAX_BYTES && !f.path.startsWith('/') && !f.path.split('/').includes('..')) : [];
        const size = files.reduce((s, f) => s + f.size, 0);
        if (typeof m.bid !== 'string' || !/^[0-9a-z]{6,24}$/.test(m.bid) || files.length !== (m.files || []).length || files.length > MAX_FILES || size > MAX_BYTES || !files.some((f) => f.path === m.entry)) { linkDown(L, T.Lost); return; }
        const r = { bid: m.bid, id: String(m.id || ''), name: String(m.name || '').slice(0, 80), entry: m.entry, files, size, got: 0, done: false, taken: false };
        L.recv.push(r); L.cur = { r, fi: 0, left: files.length ? files[0].size : 0, parts: [] };
        if (!files.length) finishBundle(L);
        render();
      } else if (m.t === 'ack') {
        L.busy.delete(m.id); L.stats.sent++;
        const it = L.mine.find((x) => x.id === m.id); if (it) { it.sent = true; it.pct = null; }
        for (const w of L.ackWaiters || []) w(m.id);
        render();
      } else if (m.t === 'pair-ok' && st.flow && st.flow.L === L) { st.flow.theirOk = true; flowStep(); render(); }
      else if (m.t === 'pair-no' && st.flow && st.flow.L === L) { cancelFlow(false); }
      else if (m.t === 'pair' && typeof m.psk === 'string' && m.psk.length >= 32 && m.psk.length <= 64 && st.flow && st.flow.L === L && st.flow.incoming && st.flow.myOk && st.flow.theirOk) {
        savePair(m.psk, String(m.name || L.theirName).slice(0, 30)); finishPairing(L, m.psk, m.extra, true);
      } else if (m.t === 'paired' && st.flow && st.flow.L === L && st.flow.psk) {
        savePair(st.flow.psk, String(m.name || L.theirName).slice(0, 30)); finishPairing(L, st.flow.psk, m.extra, false);
      } else if (m.t === 'bye') linkDown(L, '', true);
    }
    function onBinary(L, buf) {
      const cur = L.cur;
      if (!cur) return;
      const f = cur.r.files[cur.fi], part = new Uint8Array(buf);
      if (part.length > cur.left) { linkDown(L, T.Lost); return; }
      cur.parts.push(part); cur.left -= part.length; cur.r.got += part.length;
      if (cur.left === 0) {
        const bytes = new Uint8Array(f.size); let at = 0; for (const p of cur.parts) { bytes.set(p, at); at += p.length; }
        root.ShareTools && root.ShareTools.memPut(cur.r.bid, f.path, bytes);
        cur.parts = []; cur.fi++;
        while (cur.fi < cur.r.files.length && cur.r.files[cur.fi].size === 0) { root.ShareTools.memPut(cur.r.bid, cur.r.files[cur.fi].path, new Uint8Array(0)); cur.fi++; }
        if (cur.fi >= cur.r.files.length) return finishBundle(L);
        cur.left = cur.r.files[cur.fi].size;
      }
      if (Date.now() - st.renderAt > 250) { st.renderAt = Date.now(); render(); }
    }
    function finishBundle(L) {
      const r = L.cur.r; L.cur = null; r.done = true;
      L.send({ t: 'ack', id: r.id, bid: r.bid });
      render();
      takeOne(L, r);   // 已經按過「收下」或是自己的裝置：收到就存
    }
    async function takeOne(L, r) {
      if (r.taken || r.taking) return;
      r.taking = true; r.error = '';
      try { await o.take({ id: r.id, name: r.name, entry: r.entry, url: memUrl(r.bid, r.entry), files: r.files.map((f) => f.path) }, L.trusted, L.theirApp || o.app); r.taken = true; L.stats.got++; if (root.ShareTools) root.ShareTools.memDrop(r.bid); }
      catch (e) { r.error = `${T.FailedTake}：${e.message || e}`; }
      r.taking = false; render();
    }
    function answerOffer(L, ok) {
      if (ok) { L.accepted = true; L.send({ t: 'accept' }); } else { L.declined = true; L.send({ t: 'decline' }); L.offer = null; }
      render();
    }

    // ---------- 送：把一包傳給一個人 ----------
    async function sendBundle(L, it, onPct) {
      const app = L.theirApp || o.app, key = `${app}:${it.id}`;
      let pack = st.packs.get(key);
      if (!pack) { pack = o.pack(it.id, L.trusted, app); st.packs.set(key, pack); }   // 同一項傳給很多人只打包一次（對方是不同 App 時各打包各的）
      const p = await pack, ch = L.ch, files = p.files, size = files.reduce((s, f) => s + f.bytes.length, 0);
      if (size > MAX_BYTES || files.length > MAX_FILES) throw new Error(T.TooBig);
      const bid = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join('');
      const acked = new Promise((ok) => { (L.ackWaiters ||= []).push(function w(id) { if (id === it.id) { L.ackWaiters.splice(L.ackWaiters.indexOf(w), 1); ok(); } }); });
      ch.send(JSON.stringify({ t: 'bundle', bid, id: it.id, name: p.name || it.name || '', entry: p.entry, files: files.map((f) => ({ path: f.path, size: f.bytes.length })) }));
      let sentBytes = 0;
      for (const f of files) await pump(ch, f.bytes, (n) => { sentBytes += n; onPct(Math.floor((sentBytes / Math.max(size, 1)) * 100)); });
      await Promise.race([acked, L.downP.then(() => { throw new Error(T.Lost); })]);
    }
    async function sendToSelected(targets, picks) {
      st.packs = new Map(); st.rounds++;
      const queue = targets.slice();
      const worker = async () => {
        while (queue.length) {
          const p = queue.shift(), items = picks.map((i) => ({ id: i.id, name: i.name }));
          try { await sendOne(p, items); } catch (e) { const L = st.links.get(p.id); if (L) { L.out = { phase: 'error', error: e.message || T.Failed, total: items.length, done: 0 }; render(); } }
        }
      };
      await Promise.all(Array.from({ length: Math.min(POOL, targets.length) }, worker));
    }
    async function sendOne(p, items) {
      let L = st.links.get(p.id);
      if (L && (L.dead || !L.open)) { st.links.delete(p.id); L = null; }
      if (!L) {
        if (p.id === 'qr') throw new Error(T.Lost);
        L = connect(p, 'send');
        L.out = { phase: 'asking', total: items.length, done: 0 };
        render();
        // 兩邊同時選對方：id 大的那邊放掉自己的連線、改接對方打來的，這裡跟著換到那條連線（資料通道是雙向的，照樣傳）
        L = await new Promise((ok, no) => { const t = setInterval(() => { const cur = st.links.get(p.id); if (cur && cur.open && !cur.dead) { clearInterval(t); ok(cur); } else if (!cur || cur.dead) { clearInterval(t); no(new Error(T.Failed)); } }, 100); });
      }
      L.out = { phase: 'asking', total: items.length, done: 0 };
      render();
      const answered = new Promise((ok) => L.waiters.push(ok));
      L.send({ t: 'offer-items', items });
      if (!await answered) return render();   // 對方沒收下或斷線
      for (const it of items) {
        L.out.pct = 0; render();
        await sendBundle(L, it, (pct) => { if (pct !== L.out.pct) { L.out.pct = pct; if (Date.now() - st.renderAt > 250) { st.renderAt = Date.now(); render(); } } });
        L.out.done++; L.out.pct = null;
      }
      L.out.phase = 'done'; render();
    }

    // ---------- 我的裝置：連上、證明後，雙方各把對方沒有的（或比較新的）送過去，收到的自動收下 ----------
    async function sendHello(L) {
      L.mine = (await o.list(true, L.theirApp || o.app).catch(() => [])).map((x) => ({ ...x, pick: false, fresh: true }));
      L.send({ t: 'hello', items: L.mine.map((x) => ({ id: x.id, v: x.v || [], ...(Number.isFinite(x.t) ? { t: x.t } : {}) })) });
    }
    async function syncProgress(L) {
      if (!L.trusted || !L.helloIn || L.started) return;
      L.started = true;
      const picks = L.mine.filter((it) => {
        const has = L.theirs.get(it.id), tt = L.theirsT.get(it.id);
        return !has || (Number.isFinite(it.t) && Number.isFinite(tt) ? it.t > tt : (it.v || []).some((x) => !has.has(String(x))));   // 對方沒有、或缺我這項裡的內容（有修改時間的比修改時間，只送比較新的）
      });
      for (const it of picks) {
        if (!L.ch) return;
        L.busy.add(it.id);
        try { await sendBundle(L, it, () => {}); } catch (e) { L.busy.delete(it.id); }
        render();
      }
      L.sentAll = true; settleLater(L);
    }
    function settleLater(L) {   // 送完、收完（連續兩次檢查都是）才算「已同步」並記下時間
      clearInterval(L.settleTimer);
      L.settleTimer = setInterval(() => {
        if (!st.links.has(L.pid) || L.pc == null) { clearInterval(L.settleTimer); return; }
        const idle = L.sentAll && !L.busy.size && L.recv.every((r) => r.taken || r.error) && !L.cur;
        L.quiet = idle ? L.quiet + 1 : 0;
        if (L.quiet >= 2 && !L.synced) { L.synced = true; if (L.pair) touchPair(L.pair.psk, { last: Date.now() }); render(); }
        else if (L.quiet < 2 && L.synced) { L.synced = false; render(); }
      }, 700);
    }

    // ---------- 加入新裝置：兩台顯示同一組確認碼，都按確認才配對 ----------
    // 確認碼綁在這條連線的 DTLS 憑證指紋上：中間人和兩邊各建一條連線，指紋一定不同，兩台算出的碼就對不上
    const fingerprintOf = (d) => {
      const f = ((d && d.sdp) || '').split(/\r?\n/).filter((l) => l.startsWith('a=fingerprint:')).map((l) => l.slice(14).trim().toLowerCase().replace(/:/g, '')).sort();
      if (!f.length) throw new Error('no fingerprint');
      return f.join(',');
    };
    async function codeOf(L) {
      const mine = fingerprintOf(L.pc.localDescription), theirs = fingerprintOf(L.pc.remoteDescription);
      const a = L.initiator ? L.nonce : L.theirNonce, b = L.initiator ? L.theirNonce : L.nonce, fa = L.initiator ? mine : theirs, fb = L.initiator ? theirs : mine;
      const h = await sha(`${a}:${b}:${fa}:${fb}`);
      return String(((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0).slice(-4).padStart(4, '0');
    }
    function startPairing(p) {
      const L = connect(p, 'pair');
      st.flow = { L, incoming: false, myOk: false, theirOk: false, code: '', psk: rand(24) }; flowGuard(st.flow);
      render();
    }
    function confirmFlow() { const f = st.flow; if (!f || f.myOk) return; f.myOk = true; f.L.send({ t: 'pair-ok' }); flowStep(); render(); }
    function flowStep() {
      const f = st.flow;
      if (!f || f.incoming || !f.myOk || !f.theirOk || f.sent) return;
      f.sent = true;
      Promise.resolve(o.sharePair ? o.sharePair() : undefined).catch(() => undefined).then((extra) => f.L.send({ t: 'pair', psk: f.psk, name: myName(), extra }));
    }
    // 配對畫面等不到對方的確認碼（對方沒回應、App 版本不同、連線卡住）：不要停在圓點，說明連不上
    function flowGuard(f) {
      setTimeout(() => {
        if (st.closed || st.flow !== f || f.code) return;
        st.flow = null; st.adding = false; linkDown(f.L, '', true);
        st.phase = 'fail'; st.error = T.Failed; render();
      }, PAIR_CODE_TIMEOUT);
    }
    function cancelFlow(tell) {
      const f = st.flow; if (!f) return;
      if (tell) f.L.send({ t: 'pair-no' });
      st.flow = null; linkDown(f.L, '', true); render();
    }
    async function finishPairing(L, psk, extra, incoming) {
      try { await o.takePair?.(extra); } catch (e) { console.warn('配對資料', e); }
      if (incoming) { let mine; try { mine = await o.sharePair?.(); } catch (e) { mine = undefined; } L.send({ t: 'paired', name: myName(), extra: mine }); }
      st.pairs = readPairs(); st.rooms.set(await roomOfPsk(psk), pairByPsk(psk)); const pr = pairByPsk(psk); if (pr) pr.room = await roomOfPsk(psk);
      st.flow = null; st.adding = false;
      linkDown(L, '', true);   // 配對用的連線結束，馬上用密鑰連一條同步用的（兩邊 id 小的先連）
      st.failedAt.delete(L.pid);
      await rejoin();
      render();
    }
    function unpair(p) {
      st.pairs = st.pairs.filter((x) => x.psk !== p.psk); writePairs(st.pairs);
      for (const [room, pr] of [...st.rooms]) if (pr.psk === p.psk) st.rooms.delete(room);
      for (const L of [...st.links.values()]) if (L.pair && L.pair.psk === p.psk) { L.send({ t: 'bye' }); linkDown(L, '', true); }
      rejoin(); render();
    }

    // ---------- 掃 QR code 連線（不用伺服器）：offer、answer 各壓成一張 QR code ----------
    const QR_TAG = 'climbio-nearby:';
    const b64 = b64u, unb64 = unb64u;
    const gathered = (pc) => new Promise((ok) => {
      const done = () => { clearTimeout(t); pc.removeEventListener('icegatheringstatechange', check); ok(); };
      const check = () => { if (pc.iceGatheringState === 'complete') done(); };
      const t = setTimeout(done, 4000);
      pc.addEventListener('icegatheringstatechange', check); check();
    });
    async function qrText(desc) { return `${QR_TAG}${b64(await root.ShareTools.gzip(JSON.stringify({ type: desc.type, sdp: desc.sdp })))}`; }
    async function qrDesc(text, type) {
      const d = JSON.parse(await root.ShareTools.gunzip(unb64(text.slice(QR_TAG.length))));
      if (!d || d.type !== type || typeof d.sdp !== 'string' || d.sdp.length > 12000) throw new Error('bad qr');
      return { type: d.type, sdp: d.sdp };
    }
    const qrShow = async (phase, desc) => { st.qr = await root.ShareTools.qrDataURL(await qrText(desc), 4, 'L'); st.phase = phase; render(); };
    const qrFail = (e) => { if (st.qrLink) linkDown(st.qrLink, '', true); st.qrLink = null; st.phase = 'fail'; st.error = e && e.message === 'bad qr' ? T.Failed : T.Failed; render(); };
    async function qrHost() {
      clearTimeout(st.timer); stopScan();
      try {
        const L = st.qrLink = newLink('qr', T.QrPeer, 'send', true); st.links.set('qr', L);
        const pc = pcOf(L); wire(L, pc.createDataChannel('nearby', { ordered: true }));
        await pc.setLocalDescription(await pc.createOffer()); await gathered(pc);
        await qrShow('qrShow', pc.localDescription);
      } catch (e) { qrFail(e); }
    }
    function qrScan(type) { clearTimeout(st.timer); st.scanType = type; st.phase = 'qrScan'; render(); }
    function stopScan() { if (st.stopScan) { st.stopScan(); st.stopScan = null; } }
    async function startScan(video) {
      if (st.scanning || st.stopScan) return;
      const type = st.scanType;
      st.scanning = true;
      try {
        const stop = await root.ShareTools.scan(video, async (text) => {
          st.stopScan = null;
          try {
            const d = await qrDesc(text, type);
            if (type === 'answer') { st.phase = 'main'; render(); await st.qrLink.pc.setRemoteDescription(d); return; }
            const L = st.qrLink = newLink('qr', T.QrPeer, 'send', false); st.links.set('qr', L);
            const pc = pcOf(L); pc.ondatachannel = (e) => wire(L, e.channel);
            await pc.setRemoteDescription(d); await pc.setLocalDescription(await pc.createAnswer()); await gathered(pc);
            await qrShow('qrAnswer', pc.localDescription);
          } catch (e) { qrFail(e); }
        }, (text) => text.startsWith(QR_TAG));
        if (st.phase === 'qrScan' && st.scanType === type) st.stopScan = stop; else stop();
      } catch (e) { st.phase = 'fail'; st.error = T.QrNoCamera; render(); }
      st.scanning = false;
    }
    function backToMain() { stopScan(); if (st.qrLink && !st.qrLink.open) { linkDown(st.qrLink, '', true); st.qrLink = null; } st.phase = 'main'; render(); if (endpoint && !st.idle) { clearTimeout(st.timer); poll(); } }

    // ---------- 結束 ----------
    function close() {
      if (st.closed) return;
      st.closed = true; clearTimeout(st.timer); stopScan();
      for (const L of [...st.links.values()]) { L.send({ t: 'bye' }); clearInterval(L.settleTimer); linkDown(L, '', true); }
      if (st.id && endpoint) fetch(endpoint, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'leave', id: st.id }) }).catch(() => {});
      removeEventListener('pagehide', close);
      page.remove();
      if (o.onClose) o.onClose();
    }
    closeBtn.onclick = close;
    for (const ev of ['pointerdown', 'keydown']) page.addEventListener(ev, () => { st.last = Date.now(); }, true);   // 有操作就重新計時
    addEventListener('pagehide', close);

    // ---------- 開始 ----------
    (async () => {
      for (const p of st.pairs) { const r = await roomOfPsk(p.psk); p.room = r; st.rooms.set(r, p); }
      if (!devices) st.items = (await Promise.resolve(o.list(false)).catch(() => [])).map((x) => ({ ...x }));
      if (!devices && o.pick) for (const i of st.items) if (o.pick.includes(i.id)) st.pick.add(i.id);   // 從牆面頁分享：這面牆先選好
      if (st.closed) return;
      render(); if (endpoint) poll();
    })();
    return { close, state: st };
  }

  /**
   * 附近交換（mode: 'send'）或我的裝置（mode: 'devices'）的入口，岩點貓、紅點貓、Studio 共用的接線：確認暱稱 → 打開。
   * adapter：{ app, label（字串或回傳字串的函式）, suggested?（暱稱的建議，可以是 async 函式）, pick?（傳給別人時先選好的項目 id 清單）, list, pack, take, sharePair?, takePair?, onClose? }，其餘跟 open 一樣；endpoint 取自站台設定 SITE.cloud.nearby。
   * 回傳 open 的結果；使用者沒設暱稱就取消時回 null
   */
  async function start(mode, adapter) {
    const { suggested, label, ...rest } = adapter;
    if (!await ensureNickname({ suggested: typeof suggested === 'function' ? await suggested() : (suggested || '') })) return null;
    return open({ endpoint: (root.SITE && root.SITE.cloud && root.SITE.cloud.nearby) || '', ...rest, label: typeof label === 'function' ? label() : label, mode });
  }
  /** 把入口按鈕接上：瀏覽器不支援 WebRTC 就藏起來，按了先做 before（例如收起選單）再 start */
  function bind(button, mode, adapter, before) {
    button.hidden = !supported();
    button.onclick = () => { if (before) before(); start(mode, adapter); };
  }

  /** 已配對幾台（所有 App 共用；App 的選單、首頁提示用，不用打開附近交換） */
  const paired = () => readPairs().length;

  return { open, start, bind, supported, paired, compatible, nickname, setNickname, ensureNickname, deviceName, setDeviceName, MAX_BYTES, memUrl };
});
