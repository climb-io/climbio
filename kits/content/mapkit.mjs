export default {
  id: 'mapkit', name: 'MapKit', pkg: '@climbio/mapkit', license: 'AGPL-3.0', folder: 'mapkit', demo: 'mapkit/demo.html',
  zh: {
    tagline: '岩場的向量地圖，看也能編輯',
    what: '把岩壁、步道、道路、區域、地名和救援點畫成清楚的向量地圖，名稱自動避讓，附比例尺與羅盤。可開關航照、等高線底圖，也能讓使用者改岩壁線與區域範圍。',
    points: [
      { h: '地圖清楚好讀', p: '標籤自動避讓，放大才顯示分區名稱，手機上拖曳、縮放、旋轉都順手。' },
      { h: '底圖隨你開關', p: 'OpenStreetMap、航照、等高線可以各自開關；不開底圖、沒有網路也能顯示自備資料。' },
      { h: '編輯有岩壁概念', p: '拖曳頂點、畫線、反轉岩壁面朝向、復原重做，輸出標準圖層。' },
    ],
    install: 'npm install @climbio/mapkit @climbio/format',
    example: "import '@climbio/mapkit/element';\n// <climbio-map view=\"map.json\" lang=\"zh\"\n//   basemap=\"ortho\" style=\"height:70vh\"></climbio-map>\n// 編輯：加上 mode=\"edit\"，el.viewer.edit({ node })",
    notes: 'AGPL-3.0。底圖圖磚來自外部服務，需要網路與標示來源；定位與上傳由你的 App 負責。',
  },
  en: {
    tagline: 'Vector crag maps you can view and edit',
    what: 'Draws walls, trails, roads, areas, place names and rescue points as a clean vector map with automatic label avoidance, a scale bar and a compass. Toggle orthophoto and contour base maps, and let users edit wall lines and area outlines.',
    points: [
      { h: 'Clear, readable maps', p: 'Labels avoid each other, sector names appear as you zoom in, and pan, zoom and rotate feel natural on a phone.' },
      { h: 'Base maps on demand', p: 'OpenStreetMap, orthophoto and contours toggle independently; your own data still shows without a base map or network.' },
      { h: 'Editing that knows walls', p: 'Drag vertices, draw lines, flip which way a wall faces, undo/redo, and get a standard layer out.' },
    ],
    install: 'npm install @climbio/mapkit @climbio/format',
    example: "import '@climbio/mapkit/element';\n// <climbio-map view=\"map.json\" lang=\"en\"\n//   basemap=\"ortho\" style=\"height:70vh\"></climbio-map>\n// Editing: add mode=\"edit\", then el.viewer.edit({ node })",
    notes: 'AGPL-3.0. Base-map tiles come from external services, need network and credit; positioning and uploads are your app\'s job.',
  },
};
