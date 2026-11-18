export default {
  id: 'crag3dkit', name: 'Crag3DKit', pkg: '@climbio/crag3dkit', license: 'AGPL-3.0', folder: 'crag3dkit', demo: null,
  zh: {
    tagline: '戶外 3D 岩場的播放與讀取',
    what: '把高斯潑濺或網格的岩場模型，加上疊在模型上的 3D 路線（帶編號、難度牌子），讓讀者站在步道上看整面岩壁、沿著岩壁走、點路線；也能從 Climbio 公開格式的檔案找出一個岩場的模型、各面岩壁和鏡頭。',
    points: [
      { h: '沿著岩壁走', p: '整段岩壁是一條連續的步道，左右拖就沿著岩壁走，第一次進來還有從全區飛進第一面的開場。' },
      { h: '路線貼在岩面上', p: '路線是模型上的 3D 折線，被岩壁擋住的地方查作者端算好的遮擋表，不畫、不標編號。' },
      { h: '標準資料進出', p: '吃 Climbio 公開格式的模型畫面、路線圖層和快照，不連任何後端；讀取與遮擋表在 Node 也能跑。' },
    ],
    install: 'npm install @climbio/crag3dkit @climbio/format',
    example: "import { readCrag3d, mountCrag3d } from '@climbio/crag3dkit';\nconst crag = readCrag3d(docs, modelId);\nconst player = await mountCrag3d(host, { url: modelUrl, mime: crag.model.mime,\n  marks: crag.marks, sight: crag.sight, nodes: crag.nodes, areas: crag.areas,\n  poster: crag.areas[0].snapshot.href });",
    notes: 'AGPL-3.0（內含 three.js、Spark，MIT）。只播放，不從照片建模、不編輯路線；需要 WebGL2 與 WebAssembly。室內 3D 牆請用 Wall3DKit，2D Topo 請用 TopoKit。',
  },
  en: {
    tagline: 'Play and read outdoor 3D crags',
    what: 'Take a Gaussian-splat or mesh crag model plus 3D routes drawn on it (with number and grade tags), and let readers stand on the trail, see the whole wall, walk along it and tap routes. It also finds a crag\'s model, walls and cameras in Climbio public-format files.',
    points: [
      { h: 'Walk along the wall', p: 'The whole wall is one continuous trail: drag left or right to walk along it, with an opening that flies from the whole crag into the first wall on the first visit.' },
      { h: 'Routes on the rock', p: 'Routes are 3D polylines on the model; where rock hides them, the author-side occlusion table says so, and the line and its number are not drawn.' },
      { h: 'Standard data in and out', p: 'Takes Climbio public-format model views, route layers and snapshots with no backend; reading and occlusion tables also run in Node.' },
    ],
    install: 'npm install @climbio/crag3dkit @climbio/format',
    example: "import { readCrag3d, mountCrag3d } from '@climbio/crag3dkit';\nconst crag = readCrag3d(docs, modelId);\nconst player = await mountCrag3d(host, { url: modelUrl, mime: crag.model.mime,\n  marks: crag.marks, sight: crag.sight, nodes: crag.nodes, areas: crag.areas,\n  poster: crag.areas[0].snapshot.href });",
    notes: 'AGPL-3.0 (bundles three.js and Spark, MIT). Playback only: it does not build models from photos or edit routes; needs WebGL2 and WebAssembly. Use Wall3DKit for indoor 3D walls and TopoKit for 2D topos.',
  },
};
