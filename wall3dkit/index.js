// Wall3DKit 的入口：室內 3D 牆（照片重建的模型＋每顆岩點的標籤）的載入、繪製、點選（stage.js），沿牆走的鏡頭（walkcam.js），
// 和作者端把工作檔烘焙成成品包（bake.js、bakepack.js）。都依賴 vendor/three.js（three.js＋GLTFLoader＋three-mesh-bvh，約 640 KB）；
// 畫面、WebGL 只在呼叫時才用到，載入本身在 Node 也可以（烘焙的純函式、幾何在 Node 測）。
// English: Wall3DKit entry point — load, render and pick an indoor 3D climbing wall, the wall-following camera, and author-side baking.
export { loadPack, openStage, openStageWith, openFront, openStageFrom, packSig, packSurfaces, goneHolds, holdMargin, frameTest, frameShader, FRAME_MAX, FRAME_BOUNDS,
  decode, inflate, u16, parseModel, hull, simplify, inside } from './stage.js';
export { WalkCam, wallPath, profile, meshesOf, loadGlb, introEnd, packWalk, unpackWalk, tableFor, STEP, YAW_MAX, YAW_RATE } from './walkcam.js';
export { clipPolygon, bakeMesh, cutOutlines, parseGlb, sourceTexture, writeGlb } from './bake.js';
export { bakePack } from './bakepack.js';
