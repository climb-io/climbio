export default {
  id: 'format', name: 'Climbio Format', pkg: '@climbio/format', license: 'Apache-2.0', folder: 'format', demo: null,
  zh: {
    tagline: '攀岩資料的開放交換格式',
    what: '一份公開的 JSON 格式，描述照片、地圖或 3D 模型上的路線、岩點與岩場，附 JSON Schema 與驗證器。任何 App 或網站照規格就能讀寫，不需要 Climbio 的伺服器或帳號。',
    points: [
      { h: '以畫面為中心', p: '路線、岩點、岩壁都是畫在畫面上的標註，換一張照片或一張地圖照樣適用。' },
      { h: '詞彙開放', p: '核心結構固定，新增路線種類或欄位不用改規格、不用升版本，不認得的資料直接略過。' },
      { h: '常變的和不變的分開', p: '照片與岩點外框收下就能永久快取，路線改了只換疊在上面的圖層。' },
    ],
    install: 'npm install @climbio/format',
    example: "import { validate } from '@climbio/format';\n\nconst errors = validate(doc);   // [] 就是合格\nif (errors.length) console.log(errors.join('\\n'));",
    notes: 'Apache-2.0，沒有相依套件。驗證器只檢查單一檔案，跨檔案的放法與圖檔檢查要自己做；要畫畫面或編輯，用 Climbio 的其他元件。',
  },
  en: {
    tagline: 'An open interchange format for climbing data',
    what: 'A public JSON format that describes routes, holds and crags on a photo, a map or a 3D model, shipped with a JSON Schema and a validator. Any app or website can read and write it from the spec alone, with no Climbio server or account.',
    points: [
      { h: 'Built around views', p: 'Routes, holds and walls are marks drawn on a view, so it works the same on a photo, a map or a model.' },
      { h: 'Open vocabulary', p: 'The core structure is fixed; new route styles or fields need no spec change and no version bump, and unknown data is simply skipped.' },
      { h: 'Stable apart from changing', p: 'Photos and hold outlines can be cached forever; when a route changes, only its overlay layer is replaced.' },
    ],
    install: 'npm install @climbio/format',
    example: "import { validate } from '@climbio/format';\n\nconst errors = validate(doc);   // [] means valid\nif (errors.length) console.log(errors.join('\\n'));",
    notes: 'Apache-2.0, no dependencies. The validator checks one file at a time; cross-file placement and image checks are up to you. For rendering or editing, use the other Climbio components.',
  },
};
