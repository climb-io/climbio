// 牆發佈內嵌頁（v1）的訊息型別：岩館 App 的後台放這個 iframe，工作人員丟 wall-batch zip 產生的 ZIP、同意、按發佈。
// 這份是格式的唯一依據，docs/embed.md 以它為準。訊息的外框跟 RouteKit 內嵌頁一樣，只是 climbio 等於 'wallpublish'。
// English: Message types of the wall-publish embed page (v1), for a gym app's admin. The source of truth for the message format.

export interface Envelope<T extends string> { climbio: 'wallpublish'; v: 1; type: T }

/** 外層 → 內嵌頁：先送 init（之後才處理別的訊息）；lang 是 zh-Hant｜en｜zh-cn｜ja｜ko｜fr｜es｜de，沒給就看瀏覽器語言 */
export interface Init extends Envelope<'init'> { lang?: string }

/** 內嵌頁 → 外層：載入完成，只送一次 */
export type Ready = Envelope<'ready'>;

/** 一面發佈出去的牆：id 是包 id（內嵌頁 init 的 wallId 是「包 id/牆 id」，牆 id 在包裡的畫面檔名）；base 是這一版資料夾的網址，鎖定版本就用它 */
export interface PublishedWall { id: string; name: string; version: number; current: number; base: string }

/** 內嵌頁 → 外層：工作人員同意並發佈成功（公開收不回）；岩館 App 記下 version，路線內嵌頁的 init 用那一版的網址就鎖定了 */
export interface Published extends Envelope<'published'> { walls: PublishedWall[] }

/** 內嵌頁 → 外層：ZIP 不合格或發佈失敗；status 是伺服器的狀態碼（429 今天發佈太多次、503 暫停上傳） */
export interface ErrorMessage extends Envelope<'error'> { message: string; status?: number }
