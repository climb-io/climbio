const T = (...a) => globalThis.AppKit.i18n.t(...a);   // 文字在呼叫時才查（Node 測試也載入這個檔）

// Crag（戶外岩場）的匯入設定（介面見 ../intake/workspaces.js）

export const crag = {
  id: 'crag',
  name: 'Crag',
  target: 'crag',
  get groupPrefix() { return T('cgWall'); },
  inFolder: true,   // 專案可以直接存在使用者選的資料夾
  suggest: (r) => r.gps * 2 >= r.photos,
  auto: (r) => ({ trace: r.red > 0 }),   // 有紅筆的照片（路線書的圖）就描路線；沒有位置的照片一律照拍攝時間歸岩壁
};
