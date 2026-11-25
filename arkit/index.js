// ArKit 入口：AR 看線的檢視、疊圖外觀、相機工具、幾何、追蹤紀錄，以及追蹤 Worker 的網址。說明見 README.md
// English: ArKit entry — AR route view, overlay renderer, camera helpers, geometry, tracking log, tracker worker URL.
import './geometry.js';

export { createArView, showArViewError } from './view.js';
export { createArOverlay } from './overlay.js';
export { mainCamera, cameraViewport, cameraConstraints, reversedCameraFrame, reverseCameraConstraints, firstCameraFrame, frameContentSummary } from './camera.js';
export { TrackingLog2d } from './tracking-log.js';

/** 單應矩陣、驗證、外推、牆面與路線解析（同一份也掛在全域 ArKitGeometry，給 Worker 與傳統 script 用） */
export const Geometry = globalThis.ArKitGeometry;
/** 追蹤 Worker 的網址（自己開 Worker、或預先放進快取時用） */
export const trackerWorkerUrl = new URL('./tracker-worker.js', import.meta.url).href;
