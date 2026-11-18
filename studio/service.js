// Climbio 的雲端函式 datasets 的用戶端（登記公開的專案、下架）。這是 Climbio 的後端。
const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };

/** 岩場放進開放資料集（climbio/crags，見 studio/dataset-publish.js）：自己這個專案上一版的檔案（{ version, hf?, files }）、照片的 Hub 上傳網址、提交；post(body) 送到雲端函式 datasets */
export const datasetOps = post => ({
  files: (id, type) => post({ op: 'files', id, ...(type ? { type } : {}) }),
  prepare: (id, type, files) => post({ op: 'prepare', id, type, files }),
  publishHf: ({ id, type, name, files, locations = [], ...meta }) => post({ op: 'publish', hf: true, id, type, name, files, locations, listed: true, ...meta }),
});

/** 雲端函式 datasets：ping（服務開了沒）、publish、unpublish、publishWall。fetchFn、idToken、appCheck（App Check 權杖，沒有就空字串）由呼叫的人給 */
export function createService({ url, idToken, appCheck = async () => '', fetchFn = (...a) => fetch(...a) }) {
  async function post(body) {
    const token = await idToken(), check = await appCheck();
    const r = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(check ? { 'X-Firebase-AppCheck': check } : {}) }, body: JSON.stringify(body) });
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
    publishWall: ({ id, name, gym = '', files }) => post({ op: 'publishWall', id, name, ...(gym ? { gym } : {}), licenseAccepted: true, files: files.map(f => ({ path: f.path, b64: b64(f.bytes) })) }),
  };
}
