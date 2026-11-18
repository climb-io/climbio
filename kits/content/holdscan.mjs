export default {
  id: 'holdscan', name: 'HoldScan', pkg: null, license: 'AGPL-3.0', folder: 'holdscan', demo: null,
  zh: {
    tagline: '照片裡的岩點，自動框出來',
    what: '丟一張岩牆照片，HoldScan 回傳每顆岩點的位置。可以直接在手機瀏覽器裡跑，照片不離開手機；也能自己架成服務，或在電腦上離線把固定的牆面照片分析成岩點資料。',
    points: [
      { h: '手機上就能偵測', p: '模型在瀏覽器裡執行，不需要伺服器，也不用上傳照片。' },
      { h: '自己架服務', p: '一個容器就能跑起來，不需要 Firebase，輸入大小可選，小岩點多的照片也抓得到。' },
      { h: '離線整面牆分析', p: '一行指令從照片得到岩點外框與路線資料，適合岩館自己管的固定牆面。' },
    ],
    install: '沒有 npm 套件：複製 holdscan/ 資料夾（瀏覽器版另需 holdkit/ort.js）',
    example: `<script src="holdscan/browser/holdscan.js"></script>
<script>
  HoldScan.warm();
  const { boxes } = await HoldScan.detect(canvas);
  // boxes: [[x0, y0, x1, y1, score], ...]
</script>`,
    notes: '採 AGPL-3.0（偵測模型的授權要求）：透過網路提供改過的服務時，要公開你的原始碼。產生的岩點資料不受 AGPL 影響；只需要外框分析請用 HoldKit。',
  },
  en: {
    tagline: 'Find every hold in a wall photo',
    what: 'Give HoldScan a climbing-wall photo and it returns where each hold is. It can run right in a phone browser so the photo never leaves the phone, be hosted as your own service, or analyze fixed wall photos offline on a computer into hold data.',
    points: [
      { h: 'Detect on the phone', p: 'The model runs in the browser: no server and no photo upload.' },
      { h: 'Host it yourself', p: 'One container is enough, no Firebase needed, and a larger input size catches small holds in busy photos.' },
      { h: 'Offline whole-wall analysis', p: 'One command turns a photo into hold outlines and route data, ideal for walls a gym manages itself.' },
    ],
    install: 'No npm package: copy the holdscan/ folder (the browser build also needs holdkit/ort.js)',
    example: `<script src="holdscan/browser/holdscan.js"></script>
<script>
  HoldScan.warm();
  const { boxes } = await HoldScan.detect(canvas);
  // boxes: [[x0, y0, x1, y1, score], ...]
</script>`,
    notes: 'AGPL-3.0, as the detection model requires: if you run a modified version as a network service you must publish your source. Hold data it produces is not covered by the AGPL; use HoldKit when you only need outline analysis.',
  },
};
