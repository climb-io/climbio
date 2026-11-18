const T = (...a) => globalThis.AppKit.i18n.t(...a);   // 文字在呼叫時才查（Node 測試也載入這個檔）

// Crag（戶外岩場）的匯入設定（介面見 ../intake/workspaces.js）
const options = (r) => [
  r.gps < r.photos && { id: 'byTime', label: T('cgOptByTime'), note: T('cgNoLocN', r.photos - r.gps) },
  { id: 'trace', label: T('cgOptTrace'), note: r.red ? T('cgRedN', r.red) : '', on: r.red > 0 },
  r.tables && { id: 'table', label: T('cgOptTable'), note: T('cgFilesN', r.tables) },
];

export const crag = {
  id: 'crag',
  name: 'Crag',
  target: 'crag',
  get groupPrefix() { return T('cgWall'); },
  newProject: { hash: '#new', options: {} },
  suggest: (r) => r.gps * 2 >= r.photos,
  options,
};
