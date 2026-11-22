// Crag3DKit 的入口：戶外 3D 岩場的播放（高斯潑濺或網格模型加上面的 3D 路線）與讀取（從 Climbio 格式 v2 找出播放需要的東西）。
// 播放器（three.js、Spark 加起來約 3 MB）在呼叫 mountCrag3d 時才載入；其他匯出沒有 DOM 依賴，Node 也能用。
// English: Crag3DKit entry point — play a 3D crag and read it from format v2 documents. The player (three.js + Spark, ~3 MB) loads on the first mountCrag3d call.
export { readCrag3d, sharedModelId, cragModelIds } from './read.js';
export { readSight, routeVisibility } from './sight.js';
export { pickName, pickGrade } from './text.js';
export { CSS, injectStyle } from './style.js';

/** host 裡畫一個 3D 岩場；選項與回傳的操作見 index.d.ts */
export async function mountCrag3d(host, options) {
  return (await import('./player.js')).mountCrag3d(host, options);
}
