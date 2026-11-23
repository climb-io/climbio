// Studio 發佈的共用流程（Wall、Crag、3D 牆）：登入 Google（只認發佈者，不要 Drive 權限）、放進開放資料集、下架。發佈就是公開。
// 畫面在 studio/publish-ui.js；各工作區只決定「發什麼檔案」和「發完做什麼」。
import * as backend from './backend.js';
import { createService } from './service.js';
import { publishDataset } from './dataset-publish.js';

/** 發佈對話框（studio/publish-ui.js）的文字，取自目前的語言包；呼叫時才查 */
export const publishText = () => {
  const t = (...a) => globalThis.AppKit.i18n.t(...a);
  return {
    title: t('stPubTitle'),
    copy: t('stPubCopy'), down: t('stPubDown'), close: t('stPubClose'), go: t('stPubGo'), preparing: t('stPubPreparing'), running: t('stPubRunning'), keepOpen: t('stPubKeepOpen'),
    goFailed: (m) => t('stPubGoFailed', m), downFailed: (m) => t('stPubDownFailed', m),
  };
};

let service = null;
/** 雲端函式 datasets 的用戶端：不登入、不記擁有者；ping 看服務開了沒 */
export const getService = () => (service ||= createService({ url: backend.SERVICE, idToken: async () => '', appCheck: backend.appCheck, studioKey: backend.studioKey }));

/** 發佈不認人的類型（3D 牆、Guidebook，見 docs/proposals/open-versions.md、crag-open-versions.md）：不登入、文件不記擁有者；已發佈的 id 不能再改，更新用新的 id、meta.origin 指到上一版 */
export const publishAnonymous = (o) => publishDataset({ ...o, service: getService() });

/** 公開一面牆到開放資料集（雲端函式 datasets 寫進 Hugging Face）；不登入、不記擁有者，內容由伺服器驗證；files：[{ path, bytes }]，回 { id, version, current, base } */
export const publishWall = (o) => getService().publishWall(o);

/** 手動下架一面公開牆（只有維護者金鑰）；pid 是牆 id */
export const unpublishWall = (pid) => getService().unpublishWall(pid);
