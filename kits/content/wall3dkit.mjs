export default {
  id: 'wall3dkit', name: 'Wall3DKit', pkg: '@climbio/wall3dkit', license: 'AGPL-3.0', folder: 'wall3dkit', demo: null,
  zh: {
    tagline: '室內 3D 牆的載入、繪製、沿牆鏡頭與烘焙',
    what: '照片重建的岩館牆面模型，每顆岩點都標好在模型上：載入資料包、把模型畫在 2D 的定線畫面下面、用射線點岩點，鏡頭沿著牆走；作者端把工作檔烘焙成任何人都能直接讀的成品包。',
    points: [
      { h: '定線跟 2D 一樣簡單', p: '模型畫在 2D 的定線畫面下面，縮放、平移照舊；點岩點用射線，被擋住的岩點也點得到，岩點外框投回正面存檔。' },
      { h: '沿著牆走的鏡頭', p: '左右拖沿牆走、上下拖升降、捏合靠近，轉角處鏡頭平順地轉。範圍只看模型和岩點：每顆岩點都點得到，其餘地方四邊都是牆，每種螢幕比例各自算。' },
      { h: '烘焙成標準檔案', p: '作者端把裁切、隱藏、修點、鏡頭軌道都做進成品：標準 glTF 2.0 加岩點標籤，手機只讀不算，別的檢視器也打得開。' },
    ],
    install: 'npm install @climbio/wall3dkit',
    example: "import { loadPack, openStage } from '@climbio/wall3dkit';\nconst pack = await loadPack(base);\nconst stage = await openStage(base, pack);\nstage.mount(host);\nstage.setView({ s: 1, tx: 0, ty: 0, bw: stage.snapW });\nconst id = stage.pick(x, y);",
    notes: 'AGPL-3.0（內含 three.js、three-mesh-bvh，MIT）。只讀資料包、只烘焙，不從照片建模；需要 WebGL。戶外的 3D 岩場請用 Crag3DKit，2D 照片的牆請用 RouteKit。',
  },
  en: {
    tagline: 'Load, render, walk and bake indoor 3D walls',
    what: 'A gym wall reconstructed from photos, with every hold labelled on the model: load the pack, render the model underneath a 2D route-setting view, pick holds by raycast and walk the camera along the wall; on the author side, bake working files into a finished pack anyone can read as is.',
    points: [
      { h: 'Route setting as simple as 2D', p: 'The model renders under the 2D route-setting view, so zoom and pan work as before; holds are picked by raycast, hidden ones included, and their outlines are projected back to the front view for saving.' },
      { h: 'A camera that walks the wall', p: 'Drag sideways to walk, up and down to rise and sink, pinch to move closer; the camera turns smoothly at corners. Its ranges come only from the model and holds: every hold can be tapped, everywhere else shows wall on all four edges, worked out per screen aspect ratio.' },
      { h: 'Baked into standard files', p: 'The author side bakes cropping, hidden parts, hold fixes and the camera track into the finished pack: standard glTF 2.0 plus hold labels, so phones only read it and other viewers can open it too.' },
    ],
    install: 'npm install @climbio/wall3dkit',
    example: "import { loadPack, openStage } from '@climbio/wall3dkit';\nconst pack = await loadPack(base);\nconst stage = await openStage(base, pack);\nstage.mount(host);\nstage.setView({ s: 1, tx: 0, ty: 0, bw: stage.snapW });\nconst id = stage.pick(x, y);",
    notes: 'AGPL-3.0 (bundles three.js and three-mesh-bvh, MIT). Reads packs and bakes them; it does not build models from photos; needs WebGL. Use Crag3DKit for outdoor 3D crags and RouteKit for walls on 2D photos.',
  },
};
