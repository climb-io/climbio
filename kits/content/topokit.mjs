export default {
  id: 'topokit', name: 'TopoKit', pkg: '@climbio/topokit', license: 'AGPL-3.0', folder: 'topokit', demo: 'topokit/demo.html',
  zh: {
    tagline: '岩壁照片上的 Topo 看圖與編輯',
    what: '在戶外岩壁照片上畫出路線、bolt 和帶難度的編號牌，可縮放、點路線；也能讓使用者直接畫線、放 bolt、分岔，並輸出成標準圖層。',
    points: [
      { h: '路線圖自動排版', p: '編號、難度、名稱自動避開彼此與路線，路線擠在一起時會自動精簡。' },
      { h: '看和編輯長一樣', p: '編輯時看到的就是成品，畫線、放 bolt、分岔、復原重做都在同一張圖上。' },
      { h: '標準資料進出', p: '吃 Climbio 公開格式的照片與圖層，輸出也是圖層，不連任何後端。' },
    ],
    install: 'npm install @climbio/topokit @climbio/format',
    example: "import '@climbio/topokit/element';\n// <climbio-topo view=\"topo.json\" layers=\"routes.json\"\n//   bolts style=\"height:70vh\"></climbio-topo>\n// 編輯：加上 mode=\"edit\"，el.editor.setTool('line')",
    notes: 'AGPL-3.0。需要瀏覽器；上傳與版本歷史由你的 App 負責。室內岩點路線請用 RouteKit。',
  },
  en: {
    tagline: 'View and edit topos on a crag photo',
    what: 'Draw routes, bolts and number tags with grades on an outdoor crag photo, with zoom and tap-to-select. Users can also draw lines, place bolts and fork routes, and the result comes out as a standard layer.',
    points: [
      { h: 'Automatic label layout', p: 'Numbers, grades and names avoid each other and the lines, and simplify themselves when routes crowd together.' },
      { h: 'Viewing equals editing', p: 'What you see while editing is the final result; drawing, bolts, forks and undo/redo all happen on the same image.' },
      { h: 'Standard data in and out', p: 'Takes a Climbio public-format photo and layers and outputs a layer, with no backend involved.' },
    ],
    install: 'npm install @climbio/topokit @climbio/format',
    example: "import '@climbio/topokit/element';\n// <climbio-topo view=\"topo.json\" layers=\"routes.json\"\n//   bolts style=\"height:70vh\"></climbio-topo>\n// Editing: add mode=\"edit\", then el.editor.setTool('line')",
    notes: 'AGPL-3.0. Browser only; uploads and version history are your app\'s job. For indoor hold routes use RouteKit.',
  },
};
