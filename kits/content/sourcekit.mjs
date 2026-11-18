export default {
  id: 'sourcekit', name: 'SourceKit', pkg: '@climbio/sourcekit', license: 'AGPL-3.0', folder: 'sourcekit', demo: null,
  zh: {
    tagline: '把外站岩場轉成 Climbio 的工具箱',
    what: '做網站、擴充功能或匯入器時常用的一組小工具：照片縮到合適大小、從 Topo 照片描出路線、從 OpenClimbing 讀岩場與照片、為同一個來源算出固定的 id。不依賴任何框架。',
    points: [
      { h: '從照片抽出路線', p: '紅筆、任何顏色的筆、白色虛線都能描成折線，連號碼牌上的數字也讀得出來。' },
      { h: '讀開放的岩場資料', p: '直接讀 OpenClimbing 與 OpenStreetMap 的岩場、路線，以及 Wikimedia Commons 上有授權的 Topo 照片。' },
      { h: '同一個來源，同一個 id', p: '同一個岩場不論從擴充還是 App 匯入，都算出同一個 id，重存就是更新，不會重複。' },
    ],
    install: 'npm install @climbio/sourcekit',
    example: "import { idOf, fitSize } from '@climbio/sourcekit';\n\nidOf('osm:relation:123');   // 固定的 16 碼 id\nfitSize(3200, 2400);        // { w: 1600, h: 1200 }",
    notes: 'AGPL-3.0。描線是啟發式的，結果要讓使用者確認；號碼牌數字不是 OCR，字型不同會讀不準。',
  },
  en: {
    tagline: 'Toolbox for bringing outside crags into Climbio',
    what: 'A set of small helpers for sites, browser extensions and importers: shrink photos to a sensible size, trace routes from a topo photo, read crags and photos from OpenClimbing, and compute a stable id for any source. No framework required.',
    points: [
      { h: 'Routes from photos', p: 'Red pen, any pen color or white dashes can be traced into polylines, and even the numbers on route badges can be read.' },
      { h: 'Reads open crag data', p: 'Pulls crags and routes from OpenClimbing and OpenStreetMap, plus properly licensed topo photos from Wikimedia Commons.' },
      { h: 'One source, one id', p: 'The same crag gets the same id whether it was imported by the extension or the app, so saving again updates instead of duplicating.' },
    ],
    install: 'npm install @climbio/sourcekit',
    example: "import { idOf, fitSize } from '@climbio/sourcekit';\n\nidOf('osm:relation:123');   // a stable 16-character id\nfitSize(3200, 2400);        // { w: 1600, h: 1200 }",
    notes: 'AGPL-3.0. Tracing is heuristic, so let the user confirm the result; badge digits are matched by template, not OCR, and unusual fonts read poorly.',
  },
};
