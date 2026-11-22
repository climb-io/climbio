// Climbio 的雲端函式 datasets 的用戶端（登記公開的專案、下架）。這是 Climbio 的後端。
const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

/** 岩場放進開放資料集（climbio/crags，見 studio/dataset-publish.js）：自己這個專案上一版的檔案（{ version, hf?, files }）、照片的 Hub 上傳網址、提交；post(body) 送到雲端函式 datasets */
export const datasetOps = post => ({
  files: (id, type) => post({ op: 'files', id, ...(type ? { type } : {}) }),
  prepare: (id, type, files) => post({ op: 'prepare', id, type, files }),
  publishHf: ({ id, type, name, files, locations = [], ...meta }) => post({ op: 'publish', hf: true, id, type, name, files, locations, listed: true, ...meta }),
});

/**
 * 雲端函式 datasets：ping（服務開了沒）、publish、unpublish、publishWall。fetchFn、idToken、appCheck（App Check 權杖，沒有就空字串）由呼叫的人給；
 * studioKey：擁有者的同步金鑰（標頭 X-Studio-Key），伺服器拿它代替 App Check——命令列、無畫面瀏覽器的代理拿不到 App Check
 */
export function createService({ url, idToken = async () => '', appCheck = async () => '', studioKey = async () => '', sign = null, wallsUrl = url && url.replace(/\/datasets$/, '/walls'), fetchFn = (...a) => fetch(...a) }) {
  // sign(op, id, extra)：發佈金鑰簽章（studio/publisher-key.js、tools/publisher-auth.mjs）；公開牆的發佈、轉交、下架靠它認擁有者
  async function post(body, to = url) {
    const [token, check, key] = await Promise.all([idToken(), appCheck(), studioKey()]);
    const r = await fetchFn(to, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(check ? { 'X-Firebase-AppCheck': check } : {}), ...(key ? { 'X-Studio-Key': key } : {}) }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { status: r.status });
    return j;
  }
  return {
    /** 'ok'、'paused'（超過預算暫停上傳）、'off'（服務還沒開、連不上） */
    async ping() {
      if (!url) return 'off';
      try {
        const r = await fetchFn(url, { method: 'GET' });
        if (r.status === 503) return 'paused';
        return r.ok && (await r.json()).ok ? 'ok' : 'off';
      } catch { return 'off'; }
    },
    unpublish: (id) => post({ op: 'unpublish', id }),
    ...datasetOps(post),
    /** 公開一面牆到開放資料集；files：[{ path, bytes }]，回 { id, version, base } */
    publishWall: async ({ id, name, gym = '', files }) => post({ op: 'publishWall', source: 'studio', id, name, ...(gym ? { gym } : {}), licenseAccepted: true, ...(sign ? { auth: await sign('publishWall', id) } : {}), files: files.map(f => ({ path: f.path, b64: b64(f.bytes) })) }),
    /** 把這面牆的擁有者換成新的發佈金鑰 kid（岩館換 AI 代理）；現在的擁有者簽章，或維護者 */
    transferWall: async (id, newKid) => post({ op: 'transferWall', id, newKid, ...(sign ? { auth: await sign('transferWall', id, newKid) } : {}) }),
    /** 手動下架一面公開牆（拿掉找牆面入口和所有人的線，資料集已公開的檔案留著）：擁有者或維護者；pid 是牆 id */
    unpublishWall: async (pid) => post({ op: 'unpublish', pid, ...(sign ? { auth: await sign('unpublish', pid) } : {}) }, wallsUrl),
  };
}
