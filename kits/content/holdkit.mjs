export default {
  id: 'holdkit', name: 'HoldKit', pkg: '@climbio/holdkit', license: 'AGPL-3.0', folder: 'holdkit', demo: null,
  zh: {
    tagline: '偵測框變成岩點外框與顏色',
    what: '拿到岩點的偵測框之後，HoldKit 幫你描出每顆岩點的真實外框、判斷它是什麼顏色、建議整面牆該裁哪一塊。外框還可以用 MobileSAM 再描得更貼，全部在你的程式裡完成，不綁任何 App。',
    points: [
      { h: '外框貼著岩點', p: '每個框各自分辨岩點和牆，抓不到時退回內切橢圓，結果一定有外框可用。' },
      { h: '顏色名稱與同色判斷', p: '把岩點的代表色換成「紅、藍、蒂芬妮」這類名稱，也能判斷兩顆是不是同色。' },
      { h: '可選的高精度重描', p: '用 MobileSAM 把外框描得更貼，在瀏覽器或服務上都能跑；基本分析完全不需要它。' },
    ],
    install: 'npm install @climbio/holdkit',
    example: `import HoldKit from '@climbio/holdkit';

const ana = HoldKit.analysis(photoCanvas, W, H);
const ctx = HoldKit.outlineContext(ana, boxes);
const poly = HoldKit.simplifyPoly(HoldKit.boxToPoly(...boxes[0], ctx));
const crop = HoldKit.cropSuggest(boxes, W, H);`,
    notes: 'AGPL-3.0，岩館與開源專案可以免費使用；打包進自己的前端時，那部分要照 AGPL 開放原始碼。照片到偵測框要另外做（Climbio 的 HoldScan 是 AGPL-3.0）；MobileSAM 重描可以在瀏覽器裡跑（第一次下載約 44 MB 模型），也可以自己架服務或使用 Climbio 的雲端加速。',
  },
  en: {
    tagline: 'Turn detection boxes into hold outlines',
    what: 'Given detection boxes for climbing holds, HoldKit traces each hold\'s real outline, names its color, and suggests how to crop the wall. Outlines can be tightened further with MobileSAM. Everything runs inside your own code and is tied to no app.',
    points: [
      { h: 'Outlines that hug the hold', p: 'Each box separates hold from wall on its own and falls back to an ellipse when it cannot, so you always get a usable outline.' },
      { h: 'Color names and same-color matching', p: 'Turns a hold\'s representative color into a name like red or blue, and tells you whether two holds match.' },
      { h: 'Optional high-precision refinement', p: 'MobileSAM can tighten outlines further, in the browser or on a service; the basics never need it.' },
    ],
    install: 'npm install @climbio/holdkit',
    example: `import HoldKit from '@climbio/holdkit';

const ana = HoldKit.analysis(photoCanvas, W, H);
const ctx = HoldKit.outlineContext(ana, boxes);
const poly = HoldKit.simplifyPoly(HoldKit.boxToPoly(...boxes[0], ctx));
const crop = HoldKit.cropSuggest(boxes, W, H);`,
    notes: 'AGPL-3.0, free for gyms and open-source projects; bundling it into your own frontend puts that part under the AGPL. Getting from photo to boxes is separate (Climbio\'s HoldScan is AGPL-3.0); MobileSAM refinement runs in the browser (about 44 MB of models on first use), or on a service you host or Climbio\'s cloud for speed.',
  },
};
