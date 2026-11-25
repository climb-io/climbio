// RouteKit 內嵌頁（v2，通用）的訊息型別：這份是 v2 格式的唯一依據，README、docs/embed.md 與範例以它為準。
// 通用頁不依賴 Climbio（資料自備、不載入 App Check）；有能力宣告與長按、重描、修點的請求／回覆。Climbio 自己的站台另有官方適配層（wallId、key、submit、remove，見標註「官方適配層」的型別）。
// 外層可以是 <iframe>（postMessage），也可以是原生 App 的 WebView（橋接，見 docs/embed.md）：訊息內容一樣，原生橋接傳 JSON（照片用 photoBase64）。
// English: Message types of the generic RouteKit embed page (v2). Self-hostable, no Climbio dependency; host-provided data and capability-gated hooks.
import type { Layer } from '@climbio/format';

/** 所有訊息的外框：只認 climbio 等於 'routekit'、v 等於 2 */
export interface Envelope<T extends string> { climbio: 'routekit'; v: 2; type: T }
export type HoldType = 's' | 'h' | 't' | 'f' | 'n';
/**
 * 顯示與定線的選項。網址參數先設初值（controls=0｜1、maxStart=、foot=0｜1、order=0｜1、heat=0｜1、draw=0｜1、lang=zh｜en、color-s／h／t／f=22c55e、label-s／t=起），init 的 options 與 setOptions 可以覆蓋。
 * 上限要是非負整數，其他值當作沒設。
 */
export interface Options {
  /** false：不顯示任何按鈕，全由外層用訊息控制（預設 true） */
  controls?: boolean;
  /** 顯示暗彩／黑白切換鈕（預設 false：固定暗彩；網址 baseToggle=1） */
  baseToggle?: boolean;
  /** 定線上方的難度轉盤（預設 false；網址 grade=1）。選的難度寫進路線，submit 沒帶 grade 就用它 */
  grade?: boolean;
  /** 轉盤用的難度系統：v（VB、V0–V12）｜font（Fontainebleau）｜dan（段級），預設 v；網址 gradeSys= */
  gradeSys?: 'v' | 'font' | 'dan';
  /** 起攀點數上限（預設 2＝岩點貓；有的岩館規定 4）；滿了，新點改成手點，已在路線上的點不能改成起攀 */
  maxStart?: number;
  /** 定線工具列有沒有「腳點」（預設 true） */
  foot?: boolean;
  /** 定線工具列有沒有「順序」（預設 true） */
  order?: boolean;
  /** 定線有沒有「顯示所有岩點」鈕（熱圖，預設 true） */
  heat?: boolean;
  /** 觸控長按沒有岩點的地方，手指不放直接畫一圈（有放大鏡），放開自動簡化成多邊形當路線自己的岩點；電腦的滑鼠不會（預設 true） */
  draw?: boolean;
  /**
   * 看線時分段播放（預設關，既有內嵌不變）。有出手順序才切段；一段幾手、切在哪，由程式照路線長度和岩點重複自己決定，沒有段長、秒數或固定段長的選項。
   * 開了以後畫面有暫停／繼續、慢一點／快一點、上一段／下一段。網址 `segment=1`。
   */
  segment?: boolean;
  /** 按鈕和選單的文字：zh 繁體中文（預設）、en 英文 */
  lang?: 'zh' | 'en';
  /** 四種類型的顏色（#RRGGBB）；沒給的用岩點貓的顏色 */
  colors?: { s?: string; h?: string; t?: string; f?: string };
  /** 起攀、完攀膠帶上的字（1～2 個字，預設 S、T） */
  labels?: { s?: string; t?: string };
}
/** 照片座標的點，單位是照片像素 */
export type Point = [number, number];

/** 能力：沒宣告就沒有額外請求。holdEdit＝長按岩點出現調整列；refine＝調整列有「重描」，向外層要候選外框；wallEdit＝候選可「套用」到牆面，外層決定接不接受 */
export type Capability = 'holdEdit' | 'refine' | 'wallEdit';

// ---- 外層 → 內嵌頁 ----
/**
 * 第一個訊息一定是 init。畫面、照片各給一種（路線圖層可不給）：
 *  - 畫面：view（Climbio 公開格式 v2 的畫面物件，≤ 16 MB）｜viewUrl
 *  - 圖層：layers（物件陣列，最多 50 個）｜layerUrls
 *  - 照片：photo（Blob 或 ArrayBuffer，iframe 用）｜photoBase64＋photoType（image/jpeg｜png｜webp，原生 JSON 橋接用，≤ 10 MB）｜photoUrl
 * 網址只收 https、不可帶帳號密碼；相對網址以內嵌頁自己的網址補齊；讀取不帶 cookie、不送來源網址，要開 CORS，重導後的網址也要是 https，大小有上限。
 * 私有資料請外層自己讀好再傳（view／layers／photo），不要把 token 或私密網址交給內嵌頁。照片尺寸要等於畫面的 w × h。
 */
export interface Init extends Envelope<'init'> {
  view?: unknown; viewUrl?: string;
  layers?: unknown[]; layerUrls?: string[];
  photo?: Blob | ArrayBuffer; photoBase64?: string; photoType?: 'image/jpeg' | 'image/png' | 'image/webp'; photoUrl?: string;
  routeId?: string; layerId?: string; viewHref?: string; options?: Options; capabilities?: Capability[];
  /** 官方適配層：`<包 id>/<牆 id>`，展開成 Climbio 官方資料集的畫面、照片、路線圖層網址；明確給的欄位優先。通用 ZIP 沒有這層，給了回 error */
  wallId?: string;
  /** 官方適配層：岩館自己的金鑰（選用，`{ kid, pub, priv }`，同岩點貓的裝置金鑰格式，`node tools/wall-routes.mjs keygen` 產生）：submit、remove 用它簽章；不給就用外層的網站來源。金鑰會出現在岩館的網頁裡 */
  key?: { kid: string; pub: JsonWebKey; priv: JsonWebKey };
}
export interface SetRoute extends Envelope<'setRoute'> { routeId?: string }   // 換路線：等待中的請求全部作廢（換了 sessionId）
export interface SetType extends Envelope<'setType'> { holdType: HoldType }
export interface SetOptions extends Envelope<'setOptions'>, Options {}
export interface SetFullscreen extends Envelope<'setFullscreen'> { on: boolean }
/** refineHold 的回覆：result 是候選外框（照片像素，3–200 個點、有限數值、在照片內、面積合理），或 error（字串）。只接受目前 session、還在等的 requestId */
export interface RefineHoldResult extends Envelope<'refineHoldResult'> { requestId: string; sessionId: string; result?: Point[]; error?: string }
/** holdEditCommit 的回覆：accepted＝外層接受並已存下；poly 可以回它實際存下的外框（沒給就用送出的候選）；reason 給使用者看（最多 80 字） */
export interface HoldEditResult extends Envelope<'holdEditResult'> { requestId: string; sessionId: string; result?: { accepted: boolean; poly?: Point[]; reason?: string }; error?: string }
/**
 * 官方適配層：把目前這條路線直接寫進 Climbio 的公開牆（岩點貓看得到）。身分是外層的網站來源（iframe 所在的網站），或 init 帶的岩館金鑰（key）。
 * 名稱、難度、暱稱由外層收（名稱、暱稱最多 20 字；路線要有起攀 s 和完攀 t）。成功回 Submitted，失敗回 ErrorMessage。
 * 只有送 submit 或 remove 時才會載入官方適配層、連到 Google（App Check）和 Climbio 的雲端函式；其他時候內嵌頁不對外發請求。原生 WebView 沒有網站來源，要帶 key。
 */
export interface Submit extends Envelope<'submit'> { name?: string; grade?: string; author?: string }
/** 官方適配層：刪掉這個網站（或這把金鑰）名下的路線（最多 100 個 id）；別人的回 taken。結果在 Removed */
export interface Remove extends Envelope<'remove'> { routeIds: string[] }
export type ToEmbed = Init | SetRoute | SetType | SetOptions | SetFullscreen | RefineHoldResult | HoldEditResult | Submit | Remove;

// ---- 內嵌頁 → 外層 ----
export interface Ready extends Envelope<'ready'> {}
/** 定線改了（mode=edit）：v2 圖層，只有這條路線 */
export interface Change extends Envelope<'change'> { layer: Layer; routeId: string }
export interface Done extends Envelope<'done'> { layer: Layer; routeId: string }
export interface Cancel extends Envelope<'cancel'> {}
export interface Limit extends Envelope<'limit'> { max: number }
export interface FullscreenRequest extends Envelope<'fullscreen'> { on: boolean }
export interface ErrorMessage extends Envelope<'error'> { message: string }
/** 長按成立（mode=edit，觀察用，不帶照片）。action：order＝順序模式問順序、draw＝自由畫、none＝沒有內建動作（宣告 holdEdit 且按在岩點上會開調整列） */
export interface LongPress extends Envelope<'longPress'> { x: number; y: number; hitHoldId: string | null; routeId: string | null; holdType: HoldType; pointerType: string; action: 'order' | 'draw' | 'none'; sessionId: string }
/** 請外層重描一個岩點（宣告 holdEdit＋refine，使用者按「重描」）：只帶外框與照片大小，不帶照片。外層用 refineHoldResult 回覆（逾時 15 秒作廢） */
export interface RefineHold extends Envelope<'refineHold'> { requestId: string; sessionId: string; routeId: string | null; holdId: string; poly: Point[]; x: number; y: number; w: number; h: number }
/** 請外層把候選外框存進牆面（宣告 holdEdit＋wallEdit，使用者按「套用」）；外層用 holdEditResult 回覆。內嵌頁不自行保存牆面 */
export interface HoldEditCommit extends Envelope<'holdEditCommit'> { requestId: string; sessionId: string; routeId: string | null; holdId: string; poly: Point[] }
/** 官方適配層：submit 成功。routeUrl 是這條路線的公開網址；layer 是這條路線的 v2 圖層 */
export interface Submitted extends Envelope<'submitted'> { routeId: string; routeUrl: string; layer: Layer }
/** 官方適配層：remove 的結果，每個路線 id 是 ok（已刪）或 taken（不是這個網站／金鑰的） */
export interface Removed extends Envelope<'removed'> { results: Record<string, 'ok' | 'taken'> }
export type FromEmbed = Ready | Change | Done | Cancel | Limit | FullscreenRequest | ErrorMessage | LongPress | RefineHold | HoldEditCommit | Submitted | Removed;
