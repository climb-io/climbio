// 2D 牆相機即時追蹤實驗頁（也是岩點貓 AR 看線 iframe 的頁面）：AR 檢視本身在 ArKit（arkit/view.js），這裡只接上頁面與開發工具。
// English: Lab shell for the 2D wall AR view; the view itself lives in ArKit.
import { createArView, showArViewError } from '../../arkit/view.js';

createArView({ manifestUrl: new URL('./manifest.json', location.href).href }).catch(showArViewError);
