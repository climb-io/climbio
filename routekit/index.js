// RouteKit 的 Node／打包工具入口：各檔合成一個物件，跟瀏覽器的全域 RouteKit 一樣（Web Component 另外 require('./elements.js')）。
// English: RouteKit entry for Node and bundlers: all modules merged into one object, same as the browser global.
module.exports = {
  ...require('./geometry.js'), ...require('./labels.js'), ...require('./base.js'), ...require('./scene.js'),
  ...require('./image.js'), ...require('./editor.js'), ...require('./viewer.js'), ...require('./circles.js'),
  ...require('./format.js'),
};
