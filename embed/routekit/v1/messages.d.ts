// RouteKit 內嵌頁（v1）的訊息型別：這份是格式的唯一依據，README、docs/embed.md 與範例以它為準。
// 資料是 Climbio 公開格式 v2（@climbio/format）的照片畫面與路線圖層。
// 外層可以是 <iframe>（postMessage），也可以是原生 App 的 WebView（橋接，見 docs/embed.md）：兩種的訊息內容一樣，原生橋接傳 JSON。
// English: Message types of the RouteKit embed page (v1). This file is the source of truth for the message format.
import type { Layer } from '@climbio/format';

/** 所有訊息的外框：只認 climbio 等於 'routekit'、v 等於 1 */
export interface Envelope<T extends string> { climbio: 'routekit'; v: 1; type: T }
/** 點岩點用的類型：s 起攀、h 手點、t 完攀 */
/** 起攀 s、手點 h、完攀 t、腳點 f、順序 n（依序點岩點，記出手順序） */
export type HoldType = 's' | 'h' | 't' | 'f' | 'n';
/** 路線圖的底：dim 暗彩（預設）、gray 黑白 */
export type Base = 'dim' | 'gray';

/**
 * 顯示與定線的選項。網址參數先設初值（base=、controls=0｜1、maxStart=、foot=0｜1、order=0｜1、nav=0｜1、heat=0｜1、draw=0｜1、lang=zh｜en、color-s／h／t／f=22c55e、label-s／t=起），init 的 options 與 setOptions 可以覆蓋。
 * 上限要是非負整數，其他值當作沒設。
 */
export interface Options {
  base?: Base;
  /** false：不顯示任何按鈕，全由外層用訊息控制（預設 true） */
  controls?: boolean;
  /** 起攀點數上限（預設 2＝岩點貓；有的岩館規定 4）；滿了，新點改成手點，已在路線上的點不能改成起攀 */
  maxStart?: number;
  /** 定線工具列有沒有「腳點」（預設 true） */
  foot?: boolean;
  /** 定線工具列有沒有「順序」（預設 true） */
  order?: boolean;
  /** 看線：圖層裡不只一條路線時，下面有沒有上一條、下一條（預設 true） */
  nav?: boolean;
  /** 定線有沒有「顯示所有岩點」鈕（熱圖，預設 true） */
  heat?: boolean;
  /** 觸控長按沒有岩點的地方，手指不放直接畫一圈（有放大鏡），放開自動簡化成多邊形當路線自己的岩點；電腦的滑鼠不會（預設 true） */
  draw?: boolean;
  /** 按鈕和選單的文字：zh 繁體中文（預設）、en 英文 */
  lang?: 'zh' | 'en';
  /** 四種類型的顏色（#RRGGBB）；沒給的用岩點貓的顏色 */
  colors?: { s?: string; h?: string; t?: string; f?: string };
  /** 起攀、完攀膠帶上的字（1～2 個字，預設 S、T） */
  labels?: { s?: string; t?: string };
}

// ---- 內嵌頁 → 外層 ----
/** 內嵌頁載入完成，可以送 init（只送一次：iframe 的外層要先註冊 message 監聽，再放 iframe） */
export interface Ready extends Envelope<'ready'> {}
/** 定線改了（mode=edit）：layer 是 v2 圖層，只有這條路線；routeId 是它在圖層裡的節點 id（新路線由內嵌頁產生） */
export interface Change extends Envelope<'change'> { layer: Layer; routeId: string }
/** 起攀已滿：使用者想把已在路線上的點改成起攀（內嵌頁沒有改路線）；外層可以顯示自己的提示，max 是起攀上限 */
export interface Limit extends Envelope<'limit'> { max: number }
/**
 * 進（出）全螢幕：小畫面（iframe 在頁面裡）只是預覽，點一下就進全螢幕；iframe 有 allow="fullscreen" 時內嵌頁用瀏覽器的全螢幕，
 * 不行（例如 iPhone Safari、原生 App）就送這個，請外層把 iframe／WebView 放大成整個畫面（或縮回），再送 setFullscreen 回報；0.7 秒沒回報就原地互動
 */
export interface FullscreenRequest extends Envelope<'fullscreen'> { on: boolean }
/** 資料不合格、照片太大或尺寸對不上、找不到路線等；內嵌頁不會因此當掉，等下一個 init */
export interface ErrorMessage extends Envelope<'error'> { message: string }
/** 定線完成（右上的勾）：帶目前的路線（跟 change 一樣的 layer）；內嵌頁在全螢幕就退出，外層在這裡檢查、收下 */
/** 看線：使用者按下面的上一條、下一條換了路線 */
export interface RouteChanged extends Envelope<'route'> { routeId: string }
export interface Done extends Envelope<'done'> { layer: Layer; routeId: string }
/** 定線取消（左上的叉）：路線已回到打開時的樣子（會再送一次 change）；內嵌頁在全螢幕就退出 */
export interface Cancel extends Envelope<'cancel'> {}
export type FromEmbed = Ready | Change | Limit | RouteChanged | Done | Cancel | FullscreenRequest | ErrorMessage;

// ---- 外層 → 內嵌頁 ----
/**
 * 第一個訊息一定是 init。iframe：內嵌頁記下它的 event.origin，之後只收發這個來源。原生 App：用 window.climbioReceive(訊息或 JSON 字串) 傳入。
 * 資料只有一種來源：Climbio 官方發佈的網址（Studio 發佈後得到）。內嵌頁自己讀，不帶 cookie、不送來源網址；畫面和圖層最大 16 MB，照片最大 10 MB。
 *  - viewUrl：牆的畫面，`https://climbio.app/p/<包 id>/<牆 id>.json`
 *  - photoUrl：畫面指的那張照片，尺寸要等於畫面的 w × h，Hugging Face 的 `https://huggingface.co/datasets/climbio/walls/resolve/main/walls/<包 id>/v<版本>/<牆 id>.jpg`
 *  - layerUrls：路線圖層（可以不給），例如 `https://climbio.app/w/<牆 id>/routes.json`
 *  別的網址回 error。
 * routeId：圖層裡要看或編輯的路線（mode=view 沒給就是第一條；mode=edit 沒給就是新路線）。
 * layerId、viewHref：change 送出的圖層 id（預設沿用 layerUrls 第一個圖層的 id，沒有就產生一個）與畫面的路徑（預設 viewUrl）。
 */
export interface Init extends Envelope<'init'> {
  viewUrl: string; photoUrl: string; layerUrls?: string[];
  routeId?: string; layerId?: string; viewHref?: string; options?: Options;
}
/** 換一條路線；沒給 routeId（mode=edit）就是新路線 */
export interface SetRoute extends Envelope<'setRoute'> { routeId?: string }
/** 定線時點岩點用的類型（欄位不叫 type，免得跟外框的 type 撞名）；內建按鈕跟著亮 */
export interface SetType extends Envelope<'setType'> { holdType: HoldType }
/** 隨時改選項（只帶要改的） */
export interface SetOptions extends Envelope<'setOptions'>, Options {}
/** 外層放大／縮回 iframe 之後回報：進入全螢幕才有工具、縮放、平移和定線，縮回就又只是預覽 */
export interface SetFullscreen extends Envelope<'setFullscreen'> { on: boolean }
export type ToEmbed = Init | SetRoute | SetType | SetOptions | SetFullscreen;

/** 網址：https://embed.climbio.app/routekit/v1/?mode=edit&type=s&base=dim&maxStart=4；tap=edit：框夠大，不用進全螢幕，直接在原地看線、定線（預設 fullscreen：小畫面點一下進全螢幕） */
export interface UrlParams extends Options { mode?: 'view' | 'edit'; type?: HoldType; tap?: 'fullscreen' | 'edit' }
