// AppKit 的 Node／打包工具入口：各檔合成一個物件，跟瀏覽器的全域 AppKit 一樣（樣式另外載入 appkit/ui.css）。
// English: AppKit entry for Node and bundlers: all modules merged into one object, same as the browser global.
module.exports = {
  i18n: require('./i18n.js'), install: require('./install.js'), photo: require('./photo.js'), files: require('./files.js'), ui: require('./ui.js'), store: require('./store.js'), gesture: require('./gesture.js'), timing: require('./timing.js'), account: require('./account.js'), landing: require('./landing.js'), share: require('./share.js'), shareImage: require('./share-image.js'), update: require('./update.js'), idb: require('./idb.js'), backstack: require('./backstack.js'),
};
