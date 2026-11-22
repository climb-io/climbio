const T = (...a) => globalThis.AppKit.i18n.t(...a);   // 文字在呼叫時才查（Node 測試也載入這個檔）

// Wall（岩館）的匯入設定（介面見 ../intake/workspaces.js）：每張照片是一面牆，分組變成分區；偵測岩點在 wall/ 接手時做
export const gym = {
  id: 'gym',
  name: 'Wall',
  target: 'wall',
  get groupPrefix() { return T('stGymZone'); },
  suggest: () => true,
  auto: () => ({}),
};
