// Crag 的專案資料夾（../store.js，Wall、Crag 共用的放法）：一個資料夾一本 Guidebook，專案 id 就是組合的 id。
//   <專案>/index.json          這本 Guidebook（組合，type: guidebook）
//   <專案>/<id>.json           地圖、照片畫面、圖層
//   <專案>/<照片畫面的 href>    照片（自己拍的是 <id>.jpg，匯入岩場站的照原本的副檔名）
//   <專案>/.studio/            project.json、thumbs/<id>.jpg（縮圖）、images/<id>（只在 Studio 用的圖：示意圖）
const T = (...a) => AppKit.i18n.t(...a);   // 文字在呼叫時才查語言包（Node 測試、命令列也能用）
const SS = globalThis.StudioStore;
let P = null;   // 打開的專案：{ id, ws, dir, meta, local }
// 寫入一個接一個：同一個檔案連續存兩次（拖曳時一直存），先開始的不會比較晚寫完、蓋掉新的
let queue = Promise.resolve();
const serial = (fn) => (queue = queue.then(fn, fn));

const docPath = (d) => (d.kind === 'set' && d.id === P.id ? 'index.json' : `${d.id}.json`);
const imagePath = (d) => d.href && !/\.json$/.test(d.href) ? d.href : `${SS.PRIVATE}/images/${d.id}`;
const thumbPath = (id) => `${SS.PRIVATE}/thumbs/${id}.jpg`;
const cragOf = (p) => { if (p.meta.ws !== 'crag') throw new Error(T('cdNotCrag')); return (P = p); };

/** 新的一本：dir 是使用者選的資料夾（StudioStore.claim 過的），沒有就放在瀏覽器裡；docs 是組合和地圖 */
export async function create(book, docs, dir = null) {
  const ws = 'crag';
  const meta = book.derivedFrom?.url ? { src: book.derivedFrom.url } : {};   // 匯入的：記來源，同一個岩場再匯入就打開這一本
  const p = dir ? await SS.create(dir, ws, book.name, { id: book.id, meta }) : await SS.createLocal(ws, book.name, { id: book.id, meta });
  cragOf(p);
  await saveDocs([book, ...docs]);
}
/** 匯入過這個來源、而且還打得開的專案 id（sameSource 比對）；沒有回 undefined。檔案不見了（資料被清掉）的不算，照常匯入 */
export async function importedFrom(url, sameSource) {
  for (const e of await SS.recent()) {
    if (e.ws !== 'crag' || !e.src || !sameSource(e.src, url) || !(await SS.granted(e))) continue;
    try { if (await SS.has((await SS.reopen(e)).dir, 'index.json')) return e.id; } catch { /* 打不開就當沒有 */ }
  }
  return undefined;
}
/** 打開最近的專案（id）：資料夾沒有授權時回 null（要使用者點一下，從首頁打開） */
export async function open(id) {
  if (P?.id === id) return P;
  const e = await SS.entry(id);
  if (!e || e.ws !== 'crag' || !(await SS.granted(e))) return null;
  return cragOf(await SS.reopen(e));
}
/** 選的資料夾本來就是 Crag 專案：打開 */
export const openDir = async (dir) => cragOf(await SS.open(dir));

/** 一本 Guidebook 的組合、岩壁地圖、照片畫面、圖層、其他地圖（交通圖） */
export async function loadBook() {
  const book = await SS.readJson(P.dir, 'index.json');
  const docs = await Promise.all(book.items.map(i => SS.readJson(P.dir, `${i.id}.json`).catch(() => undefined)));
  const map = docs.find(d => d?.surface === 'map' && d.props?.purpose !== 'approach');
  const of = (ok) => new Map(docs.filter(d => d && ok(d)).map(d => [d.id, d]));
  // extras：原樣帶著的交通圖、3D 模型和模型上的路線圖層（Studio Crag 不編輯）
  const model = new Set(docs.filter(d => d?.surface === 'model').map(d => d.id));
  return { book, map, photos: of(d => d.surface === 'photo'), layers: of(d => d.kind === 'layer' && !model.has(d.on)), extras: of(d => (d.surface === 'map' && d !== map) || model.has(d.id) || model.has(d.on)) };
}

export const saveDocs = (docs) => {
  const texts = docs.map(d => [docPath(d), JSON.stringify(d)]), book = docs.find(d => d.id === P.id);   // 存呼叫當下的內容
  return serial(async () => {
    for (const [path, text] of texts) await SS.write(P.dir, path, text);
    if (book) {
      if (book.name !== P.meta.name) {
        P.meta.name = book.name;
        await SS.saveMeta(P);
      }
    }
    await SS.remember(P);
  });
};

/** 圖檔：doc 是照片畫面（存在它的 href），或只有 id 的（示意圖，存在 .studio） */
export const saveImage = (doc, image, thumb) => serial(async () => {
  await SS.write(P.dir, imagePath(doc), image);
  if (thumb) await SS.write(P.dir, thumbPath(doc.id), thumb);
});
export const getImage = (doc) => SS.read(P.dir, imagePath(doc)).catch(() => null);
export const getThumb = (id) => SS.read(P.dir, thumbPath(id)).catch(() => null);

/** 刪掉檔案和它們的圖（照片的副檔名不一定是 .jpg：第一層裡檔名是「id.」開頭的都刪） */
export const removeDocs = (ids) => serial(async () => {
  const files = await SS.names(P.dir);
  for (const id of ids) {
    for (const f of files) if (f.startsWith(`${id}.`)) await SS.remove(P.dir, f);
    await SS.remove(P.dir, thumbPath(id));
    await SS.remove(P.dir, `${SS.PRIVATE}/images/${id}`);
  }
});
