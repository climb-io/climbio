export default {
  id: 'routekit', name: 'RouteKit', pkg: '@climbio/routekit', license: 'AGPL-3.0', folder: 'routekit', demo: 'routekit/demo.html',
  zh: {
    tagline: '在牆面照片上看線、定線',
    what: '把一張牆面照片加上岩點外框，就能畫出路線圖：路線岩點保留原色、其他變灰，標上起攀、完攀與出手順序。使用者點岩點就能組出一條路線，也能匯出原尺寸的路線圖。',
    points: [
      { h: '看得清楚', p: '路線的岩點是主角，其餘退成灰階，起攀、完攀、腳點用膠帶標示。' },
      { h: '點一下就定線', p: '點岩點加進路線、換類型或拿掉，起攀數量自動限制，還能記錄出手順序。' },
      { h: '資料好交換', p: '讀寫 Climbio 公開格式與圈點格式（RouteMake），不綁任何 App 或後端。' },
    ],
    install: 'npm install @climbio/routekit',
    example: "import { scene, RouteViewer } from '@climbio/routekit';\nconst s = scene(img, holds);   // 照片＋岩點外框\nconst route = { holds: { a: 's', b: 'h', c: 't' } };\nnew RouteViewer(canvas, { scene: s, route });",
    notes: 'AGPL-3.0。只做取景與點選，縮放、拖曳要自己加；需要瀏覽器的 Canvas。要偵測岩點請另用岩點偵測工具。不想公開前端原始碼的網站可以用 iframe 嵌入託管的畫面，資料只讀 Climbio 官方發佈的網址，定線結果經訊息傳回（見 GitHub 說明）。',
  },
  en: {
    tagline: 'View and set routes on a wall photo',
    what: 'Give it a wall photo and hold outlines and it draws the route image: route holds keep their color, everything else goes gray, with start, finish and move order marked. Users tap holds to build a route, and you can export a full-size route image.',
    points: [
      { h: 'Easy to read', p: 'Route holds stand out while the rest fades to gray; start, finish and foot tape are clearly marked.' },
      { h: 'Set routes with a tap', p: 'Tap to add a hold, change its role or remove it; start holds are capped and move order can be recorded.' },
      { h: 'Portable data', p: 'Reads and writes the Climbio public format and the circle format (RouteMake), with no tie to any app or backend.' },
    ],
    install: 'npm install @climbio/routekit',
    example: "import { scene, RouteViewer } from '@climbio/routekit';\nconst s = scene(img, holds);   // photo + hold outlines\nconst route = { holds: { a: 's', b: 'h', c: 't' } };\nnew RouteViewer(canvas, { scene: s, route });",
    notes: 'AGPL-3.0. Framing and tapping only; add zoom and pan yourself. Needs browser Canvas. Use a separate tool to detect holds. Sites that do not want to open-source their front end can embed the hosted screen with an iframe; it only reads the official published Climbio URLs and sends route edits back as messages (see the GitHub docs).',
  },
};
