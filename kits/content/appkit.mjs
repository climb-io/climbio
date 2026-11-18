export default {
  id: 'appkit', name: 'AppKit', pkg: '@climbio/appkit', license: 'AGPL-3.0', folder: 'appkit', demo: null,
  zh: {
    tagline: 'PWA 常用的介面與工具，免框架',
    what: 'AppKit 把做手機網頁 App 常遇到的事先做好：多語言、對話框與提示、照片匯入、系統分享、加到主畫面。純前端，不需要建置，也不綁後端。',
    points: [
      { h: '照片匯入一步到位', p: '讀拍攝位置、轉正、縮圖、重新編碼，一次完成，原始位置資訊不會意外外流。' },
      { h: '一次只載一種語言', p: '依手機設定載入單一語言包，離線也能切換，換語言不用重新整理。' },
      { h: '不會壞掉的小工具', p: '對話框取代瀏覽器內建的視窗；系統分享不能用時自動複製連結；儲存空間滿了也不丟例外。' },
    ],
    install: 'npm install @climbio/appkit',
    example: `import { ui, photo, share } from '@climbio/appkit';

const p = await photo.prepare(file);   // 轉正、縮圖、取拍攝位置
if (await ui.confirm('使用這張照片？')) {
  await share.sendLink(url);   // 不能系統分享就複製
  ui.toast('已建立連結');
}`,
    notes: 'AGPL-3.0。需要自己提供品牌顏色變數（文件有一組可直接貼上的預設值）；附近交換與分享工具綁定 Climbio 本身，不屬於獨立使用的部分。',
  },
  en: {
    tagline: 'Everyday PWA UI and helpers, no framework',
    what: 'AppKit handles what mobile web apps keep needing: multiple languages, dialogs and toasts, photo import, system sharing, and add to home screen. Pure front end, no build step, no backend lock-in.',
    points: [
      { h: 'Photo import in one step', p: 'Reads the shooting location, fixes orientation, makes a thumbnail and re-encodes in one pass, so location data does not leak by accident.' },
      { h: 'One language at a time', p: 'Loads a single language pack based on the phone\'s setting, switches offline, and needs no reload to change language.' },
      { h: 'Helpers that do not break', p: 'Dialogs replace the browser\'s built-in popups; sharing falls back to copying the link; a full storage never throws.' },
    ],
    install: 'npm install @climbio/appkit',
    example: `import { ui, photo, share } from '@climbio/appkit';

const p = await photo.prepare(file);   // fix orientation, thumbnail, read location
if (await ui.confirm('Use this photo?')) {
  await share.sendLink(url);   // falls back to copying the link
  ui.toast('Link created');
}`,
    notes: 'AGPL-3.0. You supply the brand color variables (the docs include a ready-to-paste default set); nearby exchange and the share tools are tied to Climbio itself and are not part of the standalone surface.',
  },
};
