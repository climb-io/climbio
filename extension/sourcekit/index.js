// 這是 sourcekit/ 的複製（tools/sync-extension.mjs 產生），不要直接改，改 sourcekit/ 再同步。
// sourcekit：外部資料來源（站台、擴充功能、匯入器）共用的純函式——Topo 照片尺寸、合成預覽圖版面、Topo 照片上的路線描線（trace.js，紅筆或任何顏色的筆）。不碰 DOM，Node 與瀏覽器都能用。
// 要畫布的部分在 preview-sheet.js（瀏覽器），OSM／Commons 讀取在 openclimbing-read.js，各自單獨 import。
// English: shared pure helpers for sites and importers: topo photo size policy and the preview-sheet layout.
export * from './photo-size.js';
export * from './preview-layout.js';
export * from './trace.js';
export * from './ids.js';
