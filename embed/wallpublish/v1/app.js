// 牆發佈內嵌頁（v1）：岩館 App 後台放的一個 iframe。
//   一般用法（最單純）：工作人員選一張牆面照片 → 在這個瀏覽器裡偵測岩點（跟岩點貓新增牆面同一套，holdscan＋holdkit）→ 看預覽 → 按發佈。
//   精修用法：岩館的 AI Agent 照 Studio 的流程精修、打包（node tools/wall-batch.mjs zip），工作人員把 walls.zip 丟進同一個框發佈。
// 成功回 published { walls: [{ id, wallId, name, version, current, base }] }：wallId 是「包 id/牆 id」（路線內嵌頁的 init 用它），version 讓岩館 App 鎖定那一版。
// 不認人：不記擁有者、不綁網站（跟 Studio 發佈一樣）；發佈照 Studio 的同一個伺服器檢查與額度。授權（CC BY-SA 4.0，署名）寫在文件裡，這裡不再問。
// 外層 → 內嵌頁：init { lang?, gym?, name? }（之後才處理別的訊息；gym 有給就不顯示岩館欄位）；內嵌頁 → 外層：ready、published、error。見 docs/embed.md。
// 網址參數：lang=zh-Hant｜en｜zh-cn｜ja｜ko｜fr｜es｜de（沒給就看瀏覽器語言）。
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);

  // ---- 文字（八語）----
  const L = {
    'zh-Hant': { title: '發佈牆面', drop: '把牆面 ZIP 拖到這裡，或點一下選擇檔案', hint: '用 node tools/wall-batch.mjs zip 產生的 walls.zip', walls: (n) => `${n} 面牆`, gym: '岩館', verified: '已通過 AI 檢查', go: '發佈', busy: '發佈中…', done: (v) => `已公開（第 ${v} 版）`, again: '再發佈另一個 ZIP', wallId: '牆 id', pin: '岩館 App 要鎖定這一版，用這個版本的網址。', eBad: '這不是牆面 ZIP，或裡面沒有牆', eGym: '牆的畫面沒有岩館名稱（props.gym）', eBig: '檔案太大或太多（一面牆最多 20 個檔、20 MB）', eLimit: '今天發佈太多次了，明天再試', ePaused: '目前暫停上傳，稍後再試', eFail: '發佈失敗' },
    en: { title: 'Publish walls', drop: 'Drop the walls ZIP here, or tap to choose a file', hint: 'the walls.zip made by node tools/wall-batch.mjs zip', walls: (n) => (n === 1 ? '1 wall' : `${n} walls`), gym: 'Gym', verified: 'Passed the AI check', go: 'Publish', busy: 'Publishing…', done: (v) => `Published (version ${v})`, again: 'Publish another ZIP', wallId: 'Wall id', pin: 'To pin this version in your app, use this version’s URL.', eBad: 'This is not a walls ZIP, or it has no walls', eGym: 'The wall has no gym name (props.gym)', eBig: 'The files are too big or too many (at most 20 files and 20 MB per wall)', eLimit: 'Too many publishes today, try again tomorrow', ePaused: 'Uploads are paused, try again later', eFail: 'Publishing failed' },
    'zh-cn': { title: '发布墙面', drop: '把墙面 ZIP 拖到这里，或点一下选择文件', hint: '用 node tools/wall-batch.mjs zip 生成的 walls.zip', walls: (n) => `${n} 面墙`, gym: '岩馆', verified: '已通过 AI 检查', go: '发布', busy: '发布中…', done: (v) => `已公开（第 ${v} 版）`, again: '再发布另一个 ZIP', wallId: '墙 id', pin: '岩馆 App 要锁定这一版，用这个版本的网址。', eBad: '这不是墙面 ZIP，或里面没有墙', eGym: '墙的画面没有岩馆名称（props.gym）', eBig: '文件太大或太多（一面墙最多 20 个文件、20 MB）', eLimit: '今天发布太多次了，明天再试', ePaused: '目前暂停上传，稍后再试', eFail: '发布失败' },
    ja: { title: '壁を公開', drop: '壁の ZIP をここにドロップ、またはタップして選択', hint: 'node tools/wall-batch.mjs zip で作った walls.zip', walls: (n) => `${n} 面`, gym: 'ジム', verified: 'AI チェック済み', go: '公開する', busy: '公開中…', done: (v) => `公開しました（バージョン ${v}）`, again: '別の ZIP を公開', wallId: '壁 id', pin: 'アプリでこのバージョンに固定するには、このバージョンの URL を使います。', eBad: '壁の ZIP ではないか、壁が入っていません', eGym: '壁の画面にジム名がありません（props.gym）', eBig: 'ファイルが大きすぎるか多すぎます（1 面につき 20 ファイル・20 MB まで）', eLimit: '今日の公開回数の上限です。明日もう一度お試しください', ePaused: '現在アップロードを停止しています。しばらくしてからお試しください', eFail: '公開に失敗しました' },
    ko: { title: '벽 게시', drop: '벽 ZIP을 여기로 끌어다 놓거나 탭해서 파일을 선택하세요', hint: 'node tools/wall-batch.mjs zip 으로 만든 walls.zip', walls: (n) => `벽 ${n}개`, gym: '암장', verified: 'AI 검사 통과', go: '게시', busy: '게시 중…', done: (v) => `공개했습니다(버전 ${v})`, again: '다른 ZIP 게시', wallId: '벽 id', pin: '앱에서 이 버전을 고정하려면 이 버전의 URL을 쓰세요.', eBad: '벽 ZIP이 아니거나 벽이 없습니다', eGym: '벽 화면에 암장 이름이 없습니다(props.gym)', eBig: '파일이 너무 크거나 많습니다(벽 하나당 파일 20개, 20 MB까지)', eLimit: '오늘 게시 횟수를 넘었습니다. 내일 다시 시도하세요', ePaused: '지금은 업로드가 중지되어 있습니다. 잠시 후 다시 시도하세요', eFail: '게시에 실패했습니다' },
    fr: { title: 'Publier des murs', drop: 'Déposez le ZIP des murs ici, ou touchez pour choisir un fichier', hint: 'le walls.zip créé par node tools/wall-batch.mjs zip', walls: (n) => (n === 1 ? '1 mur' : `${n} murs`), gym: 'Salle', verified: 'Contrôle IA réussi', go: 'Publier', busy: 'Publication…', done: (v) => `Publié (version ${v})`, again: 'Publier un autre ZIP', wallId: 'Id du mur', pin: 'Pour figer cette version dans votre appli, utilisez l’URL de cette version.', eBad: 'Ce n’est pas un ZIP de murs, ou il ne contient aucun mur', eGym: 'La vue du mur n’a pas de nom de salle (props.gym)', eBig: 'Fichiers trop gros ou trop nombreux (20 fichiers et 20 Mo par mur au maximum)', eLimit: 'Trop de publications aujourd’hui, réessayez demain', ePaused: 'Les envois sont suspendus, réessayez plus tard', eFail: 'Échec de la publication' },
    es: { title: 'Publicar muros', drop: 'Suelta aquí el ZIP de muros o toca para elegir un archivo', hint: 'el walls.zip creado con node tools/wall-batch.mjs zip', walls: (n) => (n === 1 ? '1 muro' : `${n} muros`), gym: 'Rocódromo', verified: 'Revisión de IA superada', go: 'Publicar', busy: 'Publicando…', done: (v) => `Publicado (versión ${v})`, again: 'Publicar otro ZIP', wallId: 'Id del muro', pin: 'Para fijar esta versión en tu app, usa la URL de esta versión.', eBad: 'No es un ZIP de muros o no contiene ningún muro', eGym: 'La vista del muro no tiene nombre de rocódromo (props.gym)', eBig: 'Archivos demasiado grandes o numerosos (máximo 20 archivos y 20 MB por muro)', eLimit: 'Demasiadas publicaciones hoy, inténtalo mañana', ePaused: 'Las subidas están en pausa, inténtalo más tarde', eFail: 'Error al publicar' },
    de: { title: 'Wände veröffentlichen', drop: 'Wand-ZIP hier ablegen oder zum Auswählen tippen', hint: 'die walls.zip aus node tools/wall-batch.mjs zip', walls: (n) => (n === 1 ? '1 Wand' : `${n} Wände`), gym: 'Halle', verified: 'KI-Prüfung bestanden', go: 'Veröffentlichen', busy: 'Wird veröffentlicht…', done: (v) => `Veröffentlicht (Version ${v})`, again: 'Weitere ZIP veröffentlichen', wallId: 'Wand-ID', pin: 'Um diese Version in deiner App festzuschreiben, nutze die URL dieser Version.', eBad: 'Das ist keine Wand-ZIP oder sie enthält keine Wand', eGym: 'Die Wandansicht hat keinen Hallennamen (props.gym)', eBig: 'Dateien zu groß oder zu viele (höchstens 20 Dateien und 20 MB pro Wand)', eLimit: 'Heute zu viele Veröffentlichungen, versuche es morgen erneut', ePaused: 'Uploads sind pausiert, versuche es später erneut', eFail: 'Veröffentlichen fehlgeschlagen' },
  };
  // 照片流程用的字串（上面的 drop、hint 也換成照片優先；ZIP 是進階）
  const X = {
    'zh-Hant': { drop: '選一張牆面照片，或拖到這裡', hint: '正對牆面、整面入鏡、光線均勻；AI Agent 精修過的 walls.zip 也可以', fName: '牆名稱（例如：主牆）', fGym: '岩館名稱', sPrep: '處理照片…', sDown: '下載偵測模型…（只有第一次）', sFind: '偵測岩點…', found: (n) => `偵測到 ${n} 顆岩點`, other: '換一張照片', eNone: '沒有偵測到岩點，請換一張正對牆面的照片', eFile: '這個檔案不是可用的照片', eNeed: '請填牆名稱和岩館名稱', eNet: '偵測模型下載失敗，請確認網路後再試' },
    en: { drop: 'Choose a wall photo, or drop it here', hint: 'Face the wall straight on, whole wall in frame, even light; a walls.zip refined by your AI agent also works', fName: 'Wall name (e.g. Main wall)', fGym: 'Gym name', sPrep: 'Preparing the photo…', sDown: 'Downloading the detection model… (first time only)', sFind: 'Detecting holds…', found: (n) => `Detected ${n} holds`, other: 'Choose another photo', eNone: 'No holds were detected; try a photo facing the wall straight on', eFile: 'This file is not a usable photo', eNeed: 'Please fill in the wall name and the gym name', eNet: 'The detection model failed to download; check the network and try again' },
    'zh-cn': { drop: '选一张墙面照片，或拖到这里', hint: '正对墙面、整面入镜、光线均匀；AI Agent 精修过的 walls.zip 也可以', fName: '墙名称（例如：主墙）', fGym: '岩馆名称', sPrep: '处理照片…', sDown: '下载检测模型…（只有第一次）', sFind: '检测岩点…', found: (n) => `检测到 ${n} 颗岩点`, other: '换一张照片', eNone: '没有检测到岩点，请换一张正对墙面的照片', eFile: '这个文件不是可用的照片', eNeed: '请填墙名称和岩馆名称', eNet: '检测模型下载失败，请确认网络后再试' },
    ja: { drop: '壁の写真を選ぶか、ここにドロップ', hint: '壁に正対し、壁全体が写り、明るさが均一な写真。AI Agent が仕上げた walls.zip でも構いません', fName: '壁の名前（例：メイン壁）', fGym: 'ジム名', sPrep: '写真を処理中…', sDown: '検出モデルをダウンロード中…（初回のみ）', sFind: 'ホールドを検出中…', found: (n) => `ホールドを ${n} 個検出しました`, other: '別の写真を選ぶ', eNone: 'ホールドが検出できませんでした。壁に正対した写真でお試しください', eFile: 'このファイルは使える写真ではありません', eNeed: '壁の名前とジム名を入力してください', eNet: '検出モデルのダウンロードに失敗しました。ネットワークを確認してもう一度お試しください' },
    ko: { drop: '벽 사진을 고르거나 여기로 끌어다 놓으세요', hint: '벽을 정면으로, 벽 전체가 나오게, 조명이 고르게. AI Agent가 다듬은 walls.zip도 됩니다', fName: '벽 이름(예: 메인 벽)', fGym: '암장 이름', sPrep: '사진 처리 중…', sDown: '감지 모델 다운로드 중…(처음 한 번만)', sFind: '홀드 감지 중…', found: (n) => `홀드 ${n}개를 감지했습니다`, other: '다른 사진 고르기', eNone: '홀드를 감지하지 못했습니다. 벽을 정면으로 찍은 사진으로 다시 시도하세요', eFile: '사용할 수 없는 사진입니다', eNeed: '벽 이름과 암장 이름을 입력하세요', eNet: '감지 모델 다운로드에 실패했습니다. 네트워크를 확인하고 다시 시도하세요' },
    fr: { drop: 'Choisissez une photo du mur, ou déposez-la ici', hint: 'Mur de face, entier dans le cadre, lumière homogène ; un walls.zip affiné par votre agent IA convient aussi', fName: 'Nom du mur (ex. Mur principal)', fGym: 'Nom de la salle', sPrep: 'Préparation de la photo…', sDown: 'Téléchargement du modèle de détection… (une seule fois)', sFind: 'Détection des prises…', found: (n) => `${n} prises détectées`, other: 'Choisir une autre photo', eNone: 'Aucune prise détectée ; essayez une photo prise bien en face du mur', eFile: 'Ce fichier n’est pas une photo utilisable', eNeed: 'Renseignez le nom du mur et celui de la salle', eNet: 'Le modèle de détection n’a pas pu être téléchargé ; vérifiez le réseau et réessayez' },
    es: { drop: 'Elige una foto del muro o suéltala aquí', hint: 'De frente al muro, entero en el encuadre, luz uniforme; también sirve un walls.zip afinado por tu agente de IA', fName: 'Nombre del muro (p. ej. Muro principal)', fGym: 'Nombre del rocódromo', sPrep: 'Preparando la foto…', sDown: 'Descargando el modelo de detección… (solo la primera vez)', sFind: 'Detectando presas…', found: (n) => `${n} presas detectadas`, other: 'Elegir otra foto', eNone: 'No se detectó ninguna presa; prueba con una foto de frente al muro', eFile: 'Este archivo no es una foto utilizable', eNeed: 'Rellena el nombre del muro y el del rocódromo', eNet: 'No se pudo descargar el modelo de detección; revisa la red e inténtalo de nuevo' },
    de: { drop: 'Wandfoto auswählen oder hier ablegen', hint: 'Frontal zur Wand, ganze Wand im Bild, gleichmäßiges Licht; eine von deinem KI-Agenten verfeinerte walls.zip geht auch', fName: 'Wandname (z. B. Hauptwand)', fGym: 'Hallenname', sPrep: 'Foto wird vorbereitet…', sDown: 'Erkennungsmodell wird geladen… (nur beim ersten Mal)', sFind: 'Griffe werden erkannt…', found: (n) => `${n} Griffe erkannt`, other: 'Anderes Foto wählen', eNone: 'Keine Griffe erkannt; versuche ein Foto frontal zur Wand', eFile: 'Diese Datei ist kein verwendbares Foto', eNeed: 'Bitte Wandname und Hallenname eintragen', eNet: 'Das Erkennungsmodell konnte nicht geladen werden; prüfe das Netzwerk und versuche es erneut' },
  };
  for (const k of Object.keys(L)) Object.assign(L[k], X[k]);
  const pick = (v) => { const s = String(v || ''); return L[s] ? s : /^zh/i.test(s) ? (/cn|hans|sg/i.test(s) ? 'zh-cn' : 'zh-Hant') : L[s.slice(0, 2)] ? s.slice(0, 2) : ''; };
  let lang = pick(params.get('lang')) || pick(navigator.language) || 'en';
  const T = () => L[lang];

  // ---- 狀態 ----
  // packs：要發佈的東西；一項是 { kind: 'zip', id, pid, name, gym, verified, thumb, files } 或 { kind: 'photo', pid, w, h, image, thumb（Blob）, holds, preview（畫好外框的圖）}
  let packs = [], busy = false, host = {};   // host：外層 init 給的 { gym, name }
  const MAX_FILES = 20, MAX_TOTAL = 20e6, MODEL = 'https://huggingface.co/climbio/hold-models/resolve/main/freeclimbs.onnx';
  const text = (v) => (typeof v === 'string' ? v : v && typeof v === 'object' ? String(Object.values(v)[0] || '') : '');
  const say = (msg, bad) => { const e = $('msg'); e.textContent = msg || ''; e.dataset.bad = bad ? '1' : ''; };
  const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());
  const json = async (blob) => { try { return JSON.parse(new TextDecoder().decode(await bytesOf(blob))); } catch (e) { return null; } };
  const rid = (n) => AppKit.files.rid(n);

  // ZIP → 牆的包（精修用法）：資料夾是第一層（沒有就整份是一個包）
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
      out.push({ kind: 'zip', id: idx.id, pid: view.id, name: text(idx.name) || text(view.name) || folder, gym, verified: !!(edits && edits.ai && edits.ai.verified), thumb: URL.createObjectURL(thumb.blob), files: list });
    }
    if (!out.length) throw new Error('bad');
    return out;
  }

  // 照片 → 偵測岩點（在這個瀏覽器裡，holdscan 的 Worker 跑模型，跟岩點貓新增牆面同一套）：回 { pid, w, h, image, thumb, holds, preview }
  async function readPhoto(file) {
    const t = T();
    say(t.sPrep);
    let prep;
    try { prep = await AppKit.photo.prepare(file); } catch (e) { throw new Error('file'); }
    const bmp = await createImageBitmap(prep.image), cv = document.createElement('canvas');
    cv.width = prep.w; cv.height = prep.h; cv.getContext('2d').drawImage(bmp, 0, 0); bmp.close();
    HoldScan.configure({ model: MODEL });
    let boxes;
    try { ({ boxes } = await HoldScan.detect(cv, (key) => say(key === 'detDownload' ? t.sDown : t.sFind))); }
    catch (e) { throw new Error(e.download ? 'net' : e.message || 'detect'); }
    const ana = HoldKit.analysis(cv, prep.w, prep.h), octx = HoldKit.outlineContext(ana, boxes), holds = [];
    for (const [x0, y0, x1, y1] of boxes) {
      const poly = HoldKit.simplifyPoly(HoldKit.boxToPoly(x0, y0, x1, y1, octx));
      if (Array.isArray(poly) && poly.length >= 3) holds.push({ id: `h${rid(10)}`, poly });
    }
    if (!holds.length) throw new Error('none');
    const g = cv.getContext('2d'), line = Math.max(2, Math.round(Math.max(prep.w, prep.h) / 700));
    g.lineWidth = line; g.strokeStyle = '#22c55e';
    for (const h of holds) { g.beginPath(); h.poly.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); g.stroke(); }
    return { kind: 'photo', pid: rid(12), w: prep.w, h: prep.h, image: prep.image, thumb: prep.thumb, holds, preview: cv };
  }

  // 發佈時才組成伺服器要的檔案（牆名、岩館名稱是工作人員在畫面上填的）：照片做的包用 RouteKit.wallFiles（跟 Studio 同一套格式）
  async function build(p) {
    if (p.kind === 'zip') return { id: p.id, pid: p.pid, name: p.name, gym: p.gym, files: await Promise.all(p.files.map(async (f) => ({ path: f.path, bytes: await bytesOf(f.blob) }))) };
    const name = $('f-name').value.trim(), gym = (host.gym || $('f-gym').value).trim(), id = rid(16), t = Date.now();
    const pack = RouteKit.wallFiles({ pid: p.pid, layerId: rid(16), name, gym, w: p.w, h: p.h, holds: p.holds, routes: [], photo: await bytesOf(p.image), thumb: await bytesOf(p.thumb), attribution: 'Climbio', t, layer: { props: { 'climbio:version': 1 } } });
    const index = { climbio: 2, kind: 'set', type: 'walls', id, name, t, license: pack.view.license, attribution: pack.view.attribution, items: [{ href: pack.entry, id: p.pid, name, t }] };
    return { id, pid: p.pid, name, gym, files: [{ path: 'index.json', bytes: new TextEncoder().encode(JSON.stringify(index)) }, ...pack.files] };
  }

  // ---- 畫面 ----
  function render() {
    const t = T(), photo = packs.find((p) => p.kind === 'photo'), finished = !$('done').hidden;
    document.documentElement.lang = lang;
    $('title').textContent = t.title;
    $('drop-text').textContent = t.drop; $('drop-hint').textContent = t.hint;
    $('go').textContent = busy ? t.busy : t.go; $('again').textContent = t.again; $('other').textContent = t.other;
    $('f-name').placeholder = t.fName; $('f-gym').placeholder = t.fGym;
    $('f-gym').hidden = !!host.gym;
    const list = $('list'); list.textContent = '';
    for (const p of packs.filter((x) => x.kind === 'zip')) {
      const li = document.createElement('li'), img = new Image(); img.src = p.thumb; img.alt = '';
      const name = document.createElement('strong'); name.textContent = p.name;
      const meta = document.createElement('span'); meta.textContent = `${t.gym}：${p.gym}${p.verified ? ` · ${t.verified}` : ''}`;
      const box = document.createElement('div'); box.append(name, meta);
      li.append(img, box); list.append(li);
    }
    $('photo').hidden = !photo; $('fields').hidden = !photo;
    if (photo) { const cv = $('pv'); if (cv.dataset.pid !== photo.pid) { cv.width = photo.w; cv.height = photo.h; cv.getContext('2d').drawImage(photo.preview, 0, 0); cv.dataset.pid = photo.pid; } }
    $('review').hidden = !packs.length || finished;
    $('drop').hidden = !!packs.length;
    $('go').disabled = busy;
    $('count').textContent = photo ? t.found(photo.holds.length) : packs.length ? t.walls(packs.length) : '';
  }
  function reset() { for (const p of packs) if (p.kind === 'zip') URL.revokeObjectURL(p.thumb); packs = []; busy = false; $('pv').dataset.pid = ''; $('done').hidden = true; $('done-list').textContent = ''; say(''); render(); }

  async function take(file) {
    say('');
    try { packs = /\.zip$/i.test(file.name) || /zip/.test(file.type) ? await readZip(file) : [await readPhoto(file)]; if (packs[0].kind === 'photo') { if (host.name && !$('f-name').value) $('f-name').value = host.name; say(''); } else say(''); }
    catch (e) {
      packs = []; const t = T(), m = e.message;
      say(m === 'gym' ? t.eGym : m === 'big' ? t.eBig : m === 'none' ? t.eNone : m === 'file' ? t.eFile : m === 'net' ? t.eNet : t.eBad, true);
      link.send('error', { message: m });
    }
    render();
  }

  async function publish() {
    if (busy || !packs.length) return;
    const t = T();
    if (packs[0].kind === 'photo' && (!$('f-name').value.trim() || !(host.gym || $('f-gym').value.trim()))) { say(t.eNeed, true); return; }
    busy = true; say(''); render();
    const done = [];
    try {
      for (const p of packs) { const b = await build(p); done.push({ ...(await WallPublish.publishWall({ id: b.id, name: b.name, gym: b.gym, files: b.files })), wallId: `${b.id}/${b.pid}`, name: b.name }); }
    } catch (e) {
      busy = false; const s = e.status;
      say(`${s === 429 ? t.eLimit : s === 503 ? t.ePaused : t.eFail}${e.message ? `（${e.message}）` : ''}`, true);
      link.send('error', { message: e.message || t.eFail, status: s });
      render(); return;
    }
    busy = false;
    const ul = $('done-list'); ul.textContent = '';
    for (const w of done) { const li = document.createElement('li'); li.textContent = `${w.name} · ${t.wallId} ${w.wallId} · ${t.done(w.version)}`; ul.append(li); }
    $('done-pin').textContent = t.pin;
    $('done').hidden = false; render();
    link.send('published', { walls: done.map((w) => ({ id: w.id, wallId: w.wallId, name: w.name, version: w.version, current: w.current === undefined ? w.version : w.current, base: w.base })) });
  }

  // ---- 事件 ----
  const input = $('file');
  $('drop').addEventListener('click', () => input.click());
  $('drop').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { if (input.files[0]) take(input.files[0]); input.value = ''; });
  for (const ev of ['dragover', 'dragenter']) $('drop').addEventListener(ev, (e) => { e.preventDefault(); $('drop').dataset.over = '1'; });
  for (const ev of ['dragleave', 'drop']) $('drop').addEventListener(ev, () => { $('drop').dataset.over = ''; });
  $('drop').addEventListener('drop', (e) => { e.preventDefault(); const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) take(f); });
  $('go').addEventListener('click', publish);
  $('again').addEventListener('click', reset);
  $('other').addEventListener('click', reset);

  const link = ClimbioEmbed.connect({ kit: 'wallpublish', handlers: { init(m) { if (m.lang && pick(m.lang)) lang = pick(m.lang); host = { gym: typeof m.gym === 'string' ? m.gym.trim().slice(0, 60) : '', name: typeof m.name === 'string' ? m.name.trim().slice(0, 60) : '' }; render(); } } });
  render();
})();
