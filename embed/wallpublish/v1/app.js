// 牆發佈內嵌頁（v1）：岩館 App 後台放的一個 iframe。工作人員把 AI Agent 處理好的牆面 ZIP（node tools/wall-batch.mjs zip）丟進來，
// 看預覽、同意公開、按發佈；成功回 published { walls: [{ id, name, version, current, base }] }，岩館 App 用 version 鎖定自己要用的那一版。
// 不認人：不記擁有者、不綁網站（跟 Studio 發佈一樣）；公開收不回，所以同意要由人按（頁面的按鈕），發佈照 Studio 的同一個伺服器檢查與額度。
// 外層 → 內嵌頁：init { lang? }（之後才處理別的訊息）；內嵌頁 → 外層：ready、published { walls }、error { message }。見 docs/embed.md。
// 網址參數：lang=zh-Hant｜en｜zh-cn｜ja｜ko｜fr｜es｜de（沒給就看瀏覽器語言）。
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);

  // ---- 文字（八語）----
  const L = {
    'zh-Hant': { title: '發佈牆面', drop: '把牆面 ZIP 拖到這裡，或點一下選擇檔案', hint: '用 node tools/wall-batch.mjs zip 產生的 walls.zip', walls: (n) => `${n} 面牆`, gym: '岩館', verified: '已通過 AI 檢查', consent: '我同意公開這些牆面：公開後收不回，授權 CC BY-SA 4.0，署名。', go: '發佈', busy: '發佈中…', done: (v) => `已公開（第 ${v} 版）`, again: '再發佈另一個 ZIP', wallId: '牆 id', pin: '岩館 App 要鎖定這一版，用這個版本的網址。', eBad: '這不是牆面 ZIP，或裡面沒有牆', eGym: '牆的畫面沒有岩館名稱（props.gym）', eBig: '檔案太大或太多（一面牆最多 20 個檔、20 MB）', eLimit: '今天發佈太多次了，明天再試', ePaused: '目前暫停上傳，稍後再試', eFail: '發佈失敗' },
    en: { title: 'Publish walls', drop: 'Drop the walls ZIP here, or tap to choose a file', hint: 'the walls.zip made by node tools/wall-batch.mjs zip', walls: (n) => (n === 1 ? '1 wall' : `${n} walls`), gym: 'Gym', verified: 'Passed the AI check', consent: 'I agree to publish these walls: publishing cannot be undone, licensed CC BY-SA 4.0 with attribution.', go: 'Publish', busy: 'Publishing…', done: (v) => `Published (version ${v})`, again: 'Publish another ZIP', wallId: 'Wall id', pin: 'To pin this version in your app, use this version’s URL.', eBad: 'This is not a walls ZIP, or it has no walls', eGym: 'The wall has no gym name (props.gym)', eBig: 'The files are too big or too many (at most 20 files and 20 MB per wall)', eLimit: 'Too many publishes today, try again tomorrow', ePaused: 'Uploads are paused, try again later', eFail: 'Publishing failed' },
    'zh-cn': { title: '发布墙面', drop: '把墙面 ZIP 拖到这里，或点一下选择文件', hint: '用 node tools/wall-batch.mjs zip 生成的 walls.zip', walls: (n) => `${n} 面墙`, gym: '岩馆', verified: '已通过 AI 检查', consent: '我同意公开这些墙面：公开后收不回，授权 CC BY-SA 4.0，署名。', go: '发布', busy: '发布中…', done: (v) => `已公开（第 ${v} 版）`, again: '再发布另一个 ZIP', wallId: '墙 id', pin: '岩馆 App 要锁定这一版，用这个版本的网址。', eBad: '这不是墙面 ZIP，或里面没有墙', eGym: '墙的画面没有岩馆名称（props.gym）', eBig: '文件太大或太多（一面墙最多 20 个文件、20 MB）', eLimit: '今天发布太多次了，明天再试', ePaused: '目前暂停上传，稍后再试', eFail: '发布失败' },
    ja: { title: '壁を公開', drop: '壁の ZIP をここにドロップ、またはタップして選択', hint: 'node tools/wall-batch.mjs zip で作った walls.zip', walls: (n) => `${n} 面`, gym: 'ジム', verified: 'AI チェック済み', consent: 'これらの壁を公開することに同意します。公開後は取り消せず、CC BY-SA 4.0（表示が必要）で提供されます。', go: '公開する', busy: '公開中…', done: (v) => `公開しました（バージョン ${v}）`, again: '別の ZIP を公開', wallId: '壁 id', pin: 'アプリでこのバージョンに固定するには、このバージョンの URL を使います。', eBad: '壁の ZIP ではないか、壁が入っていません', eGym: '壁の画面にジム名がありません（props.gym）', eBig: 'ファイルが大きすぎるか多すぎます（1 面につき 20 ファイル・20 MB まで）', eLimit: '今日の公開回数の上限です。明日もう一度お試しください', ePaused: '現在アップロードを停止しています。しばらくしてからお試しください', eFail: '公開に失敗しました' },
    ko: { title: '벽 게시', drop: '벽 ZIP을 여기로 끌어다 놓거나 탭해서 파일을 선택하세요', hint: 'node tools/wall-batch.mjs zip 으로 만든 walls.zip', walls: (n) => `벽 ${n}개`, gym: '암장', verified: 'AI 검사 통과', consent: '이 벽들을 공개하는 데 동의합니다. 공개 후에는 되돌릴 수 없고, CC BY-SA 4.0(출처 표시)으로 제공됩니다.', go: '게시', busy: '게시 중…', done: (v) => `공개했습니다(버전 ${v})`, again: '다른 ZIP 게시', wallId: '벽 id', pin: '앱에서 이 버전을 고정하려면 이 버전의 URL을 쓰세요.', eBad: '벽 ZIP이 아니거나 벽이 없습니다', eGym: '벽 화면에 암장 이름이 없습니다(props.gym)', eBig: '파일이 너무 크거나 많습니다(벽 하나당 파일 20개, 20 MB까지)', eLimit: '오늘 게시 횟수를 넘었습니다. 내일 다시 시도하세요', ePaused: '지금은 업로드가 중지되어 있습니다. 잠시 후 다시 시도하세요', eFail: '게시에 실패했습니다' },
    fr: { title: 'Publier des murs', drop: 'Déposez le ZIP des murs ici, ou touchez pour choisir un fichier', hint: 'le walls.zip créé par node tools/wall-batch.mjs zip', walls: (n) => (n === 1 ? '1 mur' : `${n} murs`), gym: 'Salle', verified: 'Contrôle IA réussi', consent: 'J’accepte de publier ces murs : la publication est irréversible, sous licence CC BY-SA 4.0 avec attribution.', go: 'Publier', busy: 'Publication…', done: (v) => `Publié (version ${v})`, again: 'Publier un autre ZIP', wallId: 'Id du mur', pin: 'Pour figer cette version dans votre appli, utilisez l’URL de cette version.', eBad: 'Ce n’est pas un ZIP de murs, ou il ne contient aucun mur', eGym: 'La vue du mur n’a pas de nom de salle (props.gym)', eBig: 'Fichiers trop gros ou trop nombreux (20 fichiers et 20 Mo par mur au maximum)', eLimit: 'Trop de publications aujourd’hui, réessayez demain', ePaused: 'Les envois sont suspendus, réessayez plus tard', eFail: 'Échec de la publication' },
    es: { title: 'Publicar muros', drop: 'Suelta aquí el ZIP de muros o toca para elegir un archivo', hint: 'el walls.zip creado con node tools/wall-batch.mjs zip', walls: (n) => (n === 1 ? '1 muro' : `${n} muros`), gym: 'Rocódromo', verified: 'Revisión de IA superada', consent: 'Acepto publicar estos muros: la publicación no se puede deshacer, con licencia CC BY-SA 4.0 y atribución.', go: 'Publicar', busy: 'Publicando…', done: (v) => `Publicado (versión ${v})`, again: 'Publicar otro ZIP', wallId: 'Id del muro', pin: 'Para fijar esta versión en tu app, usa la URL de esta versión.', eBad: 'No es un ZIP de muros o no contiene ningún muro', eGym: 'La vista del muro no tiene nombre de rocódromo (props.gym)', eBig: 'Archivos demasiado grandes o numerosos (máximo 20 archivos y 20 MB por muro)', eLimit: 'Demasiadas publicaciones hoy, inténtalo mañana', ePaused: 'Las subidas están en pausa, inténtalo más tarde', eFail: 'Error al publicar' },
    de: { title: 'Wände veröffentlichen', drop: 'Wand-ZIP hier ablegen oder zum Auswählen tippen', hint: 'die walls.zip aus node tools/wall-batch.mjs zip', walls: (n) => (n === 1 ? '1 Wand' : `${n} Wände`), gym: 'Halle', verified: 'KI-Prüfung bestanden', consent: 'Ich stimme der Veröffentlichung dieser Wände zu: Sie lässt sich nicht rückgängig machen, Lizenz CC BY-SA 4.0 mit Namensnennung.', go: 'Veröffentlichen', busy: 'Wird veröffentlicht…', done: (v) => `Veröffentlicht (Version ${v})`, again: 'Weitere ZIP veröffentlichen', wallId: 'Wand-ID', pin: 'Um diese Version in deiner App festzuschreiben, nutze die URL dieser Version.', eBad: 'Das ist keine Wand-ZIP oder sie enthält keine Wand', eGym: 'Die Wandansicht hat keinen Hallennamen (props.gym)', eBig: 'Dateien zu groß oder zu viele (höchstens 20 Dateien und 20 MB pro Wand)', eLimit: 'Heute zu viele Veröffentlichungen, versuche es morgen erneut', ePaused: 'Uploads sind pausiert, versuche es später erneut', eFail: 'Veröffentlichen fehlgeschlagen' },
  };
  const pick = (v) => { const s = String(v || ''); return L[s] ? s : /^zh/i.test(s) ? (/cn|hans|sg/i.test(s) ? 'zh-cn' : 'zh-Hant') : L[s.slice(0, 2)] ? s.slice(0, 2) : ''; };
  let lang = pick(params.get('lang')) || pick(navigator.language) || 'en';
  const T = () => L[lang];

  // ---- 狀態 ----
  let packs = [], busy = false;
  const MAX_FILES = 20, MAX_TOTAL = 20e6;
  const text = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? String(Object.values(v)[0] || '') : '');
  const say = (msg, bad) => { const e = $('msg'); e.textContent = msg || ''; e.dataset.bad = bad ? '1' : ''; };
  const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());
  const json = async (blob) => { try { return JSON.parse(new TextDecoder().decode(await bytesOf(blob))); } catch (e) { return null; } };

  // ZIP → 牆的包：[{ folder, id, name, gym, verified, thumb, files: [{ path, bytes }] }]；資料夾是第一層（沒有就整份是一個包）
  async function readZip(blob) {
    let entries;
    try { entries = await AppKit.files.unzip(blob); } catch (e) { throw new Error('bad'); }
    const groups = new Map();
    for (const e of entries) {
      const parts = e.name.split('/').filter(Boolean);
      if (!parts.length || parts.some((p) => p === '..' || p.startsWith('.') || p === '__MACOSX') || parts.length > 2) continue;
      const folder = parts.length === 2 ? parts[0] : '', path = parts.at(-1);
      if (!groups.has(folder)) groups.set(folder, []);
      groups.get(folder).push({ path, blob: e.blob });
    }
    const out = [];
    for (const [folder, list] of groups) {
      const index = list.find((f) => f.path === 'index.json');
      if (!index) continue;
      let view = null;
      for (const f of list) if (/^[0-9a-z]{8,40}\.json$/.test(f.path)) { const d = await json(f.blob); if (d && d.kind === 'view' && d.surface === 'photo') { view = d; break; } }
      const idx = await json(index.blob);
      if (!idx || !view || !/^[0-9a-z]{16}$/.test(idx.id || '') || ClimbioFormat.validate(view).length) continue;
      if (!list.some((f) => f.path === `${view.id}.jpg`)) continue;
      const gym = view.props && typeof view.props.gym === 'string' ? view.props.gym.trim() : '';
      if (!gym || gym.length > 60) throw new Error('gym');
      if (list.length > MAX_FILES || list.reduce((s, f) => s + f.blob.size, 0) > MAX_TOTAL) throw new Error('big');
      const rec = list.find((f) => f.path === `${view.id}.edits.json`), thumb = list.find((f) => f.path === `${view.id}.thumb.jpg`) || list.find((f) => f.path === `${view.id}.jpg`);
      const edits = rec ? await json(rec.blob) : null;
      out.push({ folder, id: idx.id, name: text(idx.name) || text(view.name) || folder, gym, verified: !!(edits && edits.ai && edits.ai.verified), thumb: URL.createObjectURL(thumb.blob), files: list });
    }
    if (!out.length) throw new Error('bad');
    return out;
  }

  // ---- 畫面 ----
  function render() {
    const t = T();
    document.documentElement.lang = lang;
    $('title').textContent = t.title;
    $('drop-text').textContent = t.drop; $('drop-hint').textContent = t.hint;
    $('consent-text').textContent = t.consent; $('go').textContent = busy ? t.busy : t.go;
    $('again').textContent = t.again;
    const list = $('list'); list.textContent = '';
    for (const p of packs) {
      const li = document.createElement('li'), img = new Image(); img.src = p.thumb; img.alt = '';
      const name = document.createElement('strong'); name.textContent = p.name;
      const meta = document.createElement('span'); meta.textContent = `${t.gym}：${p.gym}${p.verified ? ` · ${t.verified}` : ''}`;
      const box = document.createElement('div'); box.append(name, meta);
      li.append(img, box); list.append(li);
    }
    $('review').hidden = !packs.length || !$('done').hidden;
    $('drop').hidden = !!packs.length;
    $('go').disabled = busy || !$('consent').checked;
    $('count').textContent = packs.length ? t.walls(packs.length) : '';
  }
  function reset() { for (const p of packs) URL.revokeObjectURL(p.thumb); packs = []; busy = false; $('consent').checked = false; $('done').hidden = true; $('done-list').textContent = ''; say(''); render(); }

  async function take(file) {
    say('');
    try { packs = await readZip(file); }
    catch (e) { packs = []; const t = T(); say(e.message === 'gym' ? t.eGym : e.message === 'big' ? t.eBig : t.eBad, true); link.send('error', { message: e.message }); }
    render();
  }

  async function publish() {
    if (busy || !packs.length || !$('consent').checked) return;
    busy = true; say(''); render();
    const done = [];
    try {
      for (const p of packs) done.push({ ...(await WallPublish.publishWall({ id: p.id, name: p.name, gym: p.gym, files: await Promise.all(p.files.map(async (f) => ({ path: f.path, bytes: await bytesOf(f.blob) }))) })), name: p.name });
    } catch (e) {
      busy = false; const t = T(), s = e.status;
      say(`${s === 429 ? t.eLimit : s === 503 ? t.ePaused : t.eFail}${e.message ? `（${e.message}）` : ''}`, true);
      link.send('error', { message: e.message || t.eFail, status: s });
      render(); return;
    }
    busy = false;
    const t = T(), ul = $('done-list'); ul.textContent = '';
    for (const w of done) { const li = document.createElement('li'); li.textContent = `${w.name} · ${t.wallId} ${w.id} · ${t.done(w.version)}`; ul.append(li); }
    $('done-pin').textContent = t.pin;
    $('done').hidden = false; render();
    link.send('published', { walls: done.map((w) => ({ id: w.id, name: w.name, version: w.version, current: w.current === undefined ? w.version : w.current, base: w.base })) });
  }

  // ---- 事件 ----
  const input = $('file');
  $('drop').addEventListener('click', () => input.click());
  $('drop').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { if (input.files[0]) take(input.files[0]); input.value = ''; });
  for (const ev of ['dragover', 'dragenter']) $('drop').addEventListener(ev, (e) => { e.preventDefault(); $('drop').dataset.over = '1'; });
  for (const ev of ['dragleave', 'drop']) $('drop').addEventListener(ev, () => { $('drop').dataset.over = ''; });
  $('drop').addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) take(f); });
  $('consent').addEventListener('change', render);
  $('go').addEventListener('click', publish);
  $('again').addEventListener('click', reset);

  const link = ClimbioEmbed.connect({ kit: 'wallpublish', handlers: { init(m) { if (m.lang && pick(m.lang)) { lang = pick(m.lang); render(); } } } });
  render();
})();
