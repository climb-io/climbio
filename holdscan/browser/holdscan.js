// 瀏覽器版的岩點偵測：模型在手機上跑（browser/worker.js），不需要伺服器。第一次用會下載 onnxruntime 和模型（約 12 MB），之後由瀏覽器快取。
// 要放在網站上的檔案見 holdscan/README.md（含旁邊的 holdkit/ort.js），用 <script> 載入這個檔，掛在全域 HoldScan。
//
// 用法：
//   HoldScan.configure({ cache, model })                    cache：模型快取（Cache API）的名稱：網頁先下載好存在那裡，Worker 直接讀；model：模型的網址（不給就是 holdscan/models/ 底下的檔案）
//   HoldScan.warm()                                         先在背景下載、載入模型（例如使用者選照片時）
//   const { boxes } = await HoldScan.detect(canvas, status)  boxes：[[x0, y0, x1, y1, score], ...]（canvas 的座標）；
//                                                           status(key)：進度，'detDownload'（下載模型）、'detFinding'（偵測中）；失敗的 Error 帶 download: true ＝下載模型失敗
// English: In-browser hold detection: runs the model on the phone in a Worker, no server needed.
(() => {
  'use strict';
  const WORKER_URL = new URL('worker.js', document.currentScript.src).href;
  const jobs = new Map();
  let worker = null, seq = 0, cache = '', model = '';

  function getWorker() {
    if (!worker) {
      worker = new Worker(WORKER_URL);
      if (cache || model) worker.postMessage({ type: 'config', cache, model });
      worker.onmessage = ({ data: m }) => {
        const job = jobs.get(m.id);
        if (!job) return;
        if (m.type === 'status') return job.status(m.key);
        jobs.delete(m.id);
        if (m.type === 'error') job.reject(Object.assign(new Error(m.message), { download: !!m.download })); else job.resolve(m);
      };
      worker.onerror = (e) => {   // Worker 本身載入失敗（例如連不到 onnxruntime）：全部失敗，下一次重開
        e.preventDefault();   // 已經轉給呼叫的人處理；不擋的話 Safari 會再丟一次頁面錯誤（Load failed）
        for (const job of jobs.values()) job.reject(new Error(e.message || 'HoldScan worker failed'));
        jobs.clear(); worker.terminate(); worker = null;
      };
    }
    return worker;
  }
  const call = (msg, status = () => {}, transfer = []) => new Promise((resolve, reject) => {
    const id = ++seq;
    jobs.set(id, { resolve, reject, status });
    getWorker().postMessage({ id, ...msg }, transfer);
  });

  // cache：模型的 Cache API 名稱；網頁先下載好存在那裡，Worker 直接讀（沒設就自己下載）
  const configure = (o) => { cache = o.cache || ''; model = o.model || ''; if (worker && (cache || model)) worker.postMessage({ type: 'config', cache, model }); };
  const warm = () => call({ type: 'warm' }).then(() => {}, () => {});   // 失敗不用管：真的偵測時會再試、再回報
  async function detect(canvas, status) {
    const image = await createImageBitmap(canvas);
    const { boxes } = await call({ type: 'detect', image }, status, [image]);
    return { boxes };
  }

  self.HoldScan = { configure, warm, detect };
})();
