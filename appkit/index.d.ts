// AppKit 的型別。
// English: AppKit type definitions.

/** 語言包的值：文字，或帶參數的函式 */
export type Message = string | string[] | ((...args: any[]) => string);
export type Pack = Record<string, Message>;

export interface I18n {
  /** 支援的語言 */
  readonly LANGS: readonly string[];
  /** 目前的語言 */
  readonly lang: string;
  /** 語言包檔案呼叫：add('hold', 'zh', { … }) */
  add(app: string, lang: string, dict: Pack): void;
  /** 依瀏覽器語言挑一種 */
  detect(langs?: readonly string[], nav?: string): string;
  /** 這台選的語言；沒選過是 'auto' */
  setting(): string;
  /** 開頁時在 <head> 同步呼叫：決定語言、document.write 共用名詞與 App 的語言包 */
  boot(options: { app: string | readonly string[]; key?: string; langs?: readonly string[]; base?: string }): string;
  /** 換語言（'auto' 跟瀏覽器），沒載入過的語言包才去抓；回傳實際的語言 */
  use(choice: string): Promise<string>;
  /** 文字：App 的語言包 → 共用名詞 → key 本身 */
  t(key: string, ...args: any[]): string;
  /** 換掉 data-i18n、data-i18n-aria、data-i18n-title、data-i18n-ph */
  apply(scope?: ParentNode): void;
  /** Service Worker 要快取的語言包網址（全部語言） */
  cacheList(app: string | readonly string[], base?: string, langs?: readonly string[]): string[];
  readonly packs: Record<string, Record<string, Pack>>;
}

export interface Platform { ios: boolean; android: boolean; inApp: boolean; standalone: boolean }
export interface InstallState extends Platform {
  readonly canPrompt: boolean;
  readonly installed: boolean;
  readonly dismissed: boolean;
  /** 該不該建議加到主畫面 */
  readonly offer: boolean;
  /** 有安裝事件就跳原生安裝；沒有回傳 null */
  prompt(): Promise<'accepted' | 'dismissed' | null>;
  /** 這台不再建議 */
  dismiss(): void;
  intentUrl(href: string): string;
}
export interface Install {
  platform(ua?: string, maxTouchPoints?: number): Platform;
  /** Android：交給系統打開的 intent:// 網址 */
  intentUrl(href: string): string;
  track(options: { dismissedKey: string; installedKey: string; onChange?: () => void; onInstalled?: () => void }): InstallState;
}

/** readExif 讀到的拍照資料 */
export interface ExifRaw {
  model?: string; time?: number; focal35?: number; lat?: number; lng?: number; alt?: number; accuracy?: number;
  heading?: number; headingRef?: string; pitch?: number;
}
/** v2 照片畫面的 camera */
export interface Camera {
  position: [number, number] | [number, number, number];
  accuracy?: number; heading?: number; pitch?: number; t?: number; focal?: number; model?: string;
}
export interface PhotoView {
  climbio: 2; kind: 'view'; surface: 'photo'; id: string; t: number; license: string; attribution: string;
  author?: string; origin?: string; href: string; w: number; h: number; mime: 'image/jpeg'; name?: string; sha256?: string; camera?: Camera;
}
export interface Photo {
  readExif(bytes: ArrayBuffer | Uint8Array): ExifRaw;
  toCamera(raw: ExifRaw | undefined, options?: { declination?: number }): Camera | undefined;
  readonly MAX_EDGE: number;
  readonly QUALITY: { readonly tiny: number; readonly thumb: number; readonly image: number; readonly preview: number; readonly crop: number; readonly full: number };
  readonly THUMB_EDGE: number;
  toCanvas(file: Blob, maxEdge?: number): Promise<HTMLCanvasElement>;
  /** 圖片網址 → 載入好的 Image */
  load(src: string): Promise<HTMLImageElement>;
  jpeg(canvas: HTMLCanvasElement, quality?: number): Promise<Blob>;
  encode(src: CanvasImageSource & { width: number; height: number }, edge: number, quality: number): Promise<{ blob: Blob; w: number; h: number }>;
  reencode(blob: Blob, quality?: number): Promise<Blob>;
  sha256(blob: Blob): Promise<string>;
  prepare(file: Blob, options?: { maxEdge?: number; thumbEdge?: number; quality?: number; preserveExif?: boolean }): Promise<{ raw: ExifRaw; image: Blob; thumb: Blob; w: number; h: number; sha256: string }>;
  thumb(src: Blob | HTMLCanvasElement, edge?: number): Promise<Blob>;
  view(options: {
    id: string; name?: string; t?: number; license: string; attribution?: string; author?: string; origin?: string | null;
    w: number; h: number; sha256?: string; raw?: ExifRaw; declination?: number;
  }): PhotoView;
}

export interface Field { name: string; label?: string; value?: string; type?: string; options?: [string, string][]; placeholder?: string; max?: number; required?: boolean }
export interface Button { label: string; value?: string; primary?: boolean; danger?: boolean }
export interface Ui {
  configure(options: { backStack?: { open(id: string, onBack: () => void): void; close(id: string): Promise<void> } | null }): void;
  ask(options: {
    title?: string; text?: string; fields?: Field[]; choices?: { label: string; value: string; danger?: boolean }[];
    body?: Node[]; buttons?: Button[]; role?: 'dialog' | 'alertdialog';
  }): Promise<{ button: string; values: Record<string, string> } | undefined>;
  /** 關掉打開中的對話框（當成取消） */
  close(): void;
  confirm(message: string, options?: { title?: string; ok?: string; danger?: boolean; cancel?: boolean }): Promise<boolean>;
  alert(message: string, options?: { title?: string; ok?: string }): Promise<boolean>;
  prompt(options: { title: string; value?: string; placeholder?: string; ok?: string; max?: number; allowEmpty?: boolean }): Promise<string | null>;
  progress(text: string, frac?: number | null): { update(text: string, frac?: number | null): void; done(text: string, options?: { action?: { label: string; run(): void } | null; ms?: number }): void; fail(text: string): void; hide(): void };
  toast(text: string, options?: { busy?: boolean; action?: { label: string; run(): void } | null; ms?: number }): void;
  hideToast(): void;
  /** 建一個 SVG 元素 */
  svg(tag: string, attrs?: Record<string, string | number>): SVGElement;
  /** 使用者要求減少動態 */
  reducedMotion(): boolean;
}

/** localStorage 的 JSON 讀寫（見 store.js）：不丟例外 */
export interface Store {
  get<T = unknown>(key: string, fallback?: T): T;
  set(key: string, value: unknown): boolean;
  remove(key: string): void;
}

/** 檔案小工具（見 files.js）：不壓縮的 ZIP、隨機 id、安全的檔名、內容指紋、Blob 轉 base64 */
export interface Files {
  rid(n?: number): string;
  safeName(name: string): string;
  /** SHA-256 取前 bytes 個位元組（預設 32），十六進位字串 */
  sha(data: string | BufferSource | Blob, bytes?: number): Promise<string>;
  /** cyrb53 雜湊（數字，比對內容有沒有變，不是密碼學用途） */
  hash53(str: string, seed?: number): number;
  base64(blob: Blob): Promise<string>;
  zip(entries: { name: string; blob: Blob }[]): Promise<Blob>;
  unzip(blob: Blob): Promise<{ name: string; blob: Blob }[]>;
}

/** 電腦版工具在手機上的介紹頁（在 <head> 載入就自己判斷，見 landing.js） */
export interface Landing {
  /** 手機：有觸控（touch 觸控點數、coarse 主要指標是手指），而且螢幕短邊小於 768 */
  isPhone(env: { touch: number; coarse: boolean; w: number; h: number }): boolean;
  boot(): Landing;
}

/** 交給系統的分享與下載（見 share.js） */
export interface Share {
  /** 'failed'＝連複製都不行；'blocked'＝strictGesture 時被 iOS 擋下（要在點擊當下分享） */
  sendLink(url: string, options?: { title?: string; text?: string; strictGesture?: boolean }): Promise<'shared' | 'copied' | 'cancelled' | 'failed' | 'blocked'>;
  sendFile(file: File, options?: { title?: string; strictGesture?: boolean }): Promise<'shared' | 'cancelled' | 'downloaded' | 'blocked'>;
  download(blob: Blob, name: string, revokeAfter?: number): void;
  canShareFiles(file?: File): boolean;
}

/** 「有新版本　更新」提示條與檢查節奏（見 update.js） */
export interface Update {
  create(options: { host?: HTMLElement | null; apply: () => unknown }): { el: HTMLElement; show(): void; hide(): void };
  watch(fn: () => unknown, options?: { minGap?: number }): () => void;
}

/** 對話框、彈窗的返回紀錄（見 backstack.js） */
export interface Backstack {
  open(id: string, onBack: () => void, state?: unknown): void;
  close(id: string): Promise<void>;
  handle(): boolean;
  readonly depth: number;
}

/** IndexedDB 小工具（見 idb.js） */
export interface Idb {
  opener(options: { name: string; version: number; upgrade?: (db: IDBDatabase, oldVersion: number, tx: IDBTransaction | null) => void; ready?: (db: IDBDatabase) => unknown }): () => Promise<IDBDatabase>;
  done<T>(request: IDBRequest<T>): Promise<T>;
  packBlob(value: unknown): Promise<unknown>;
  unpackBlob(value: unknown): unknown;
}

/** 岩點貓與紅點貓共用的帳號頭像與個人資料呈現。 */
export interface Account {
  avatar(target: HTMLElement | null, user: { name?: string; email?: string; photo?: string } | null): void;
  /** 將統計值填入 target 的 [data-ak-stat] 欄位；無值顯示破折號。 */
  summary(target: HTMLElement | null, values: Record<string, number | string>): void;
  /** 一排統計方塊（兩個 App 的個人資料共用）。 */
  stats(metrics?: { label: string; value: number | string }[]): HTMLElement;
  /** 個人資料的純 DOM 畫面；各 App 負責統計來源與事件。 */
  detail(options?: {
    title?: string;
    metrics?: { label: string; value: number | string }[];
    note?: string;
    groups?: { title?: string; text?: string; metrics?: { label: string; value: number | string }[] }[];
  }): HTMLElement;
}

export declare const i18n: I18n;
export declare const install: Install;
export declare const photo: Photo;
export declare const files: Files;
export declare const ui: Ui;
export declare const account: Account;
export declare const landing: Landing;
export declare const share: Share;
export declare const update: Update;
export declare const idb: Idb;
/** 手勢（見 gesture.js） */
export interface Gesture {
  /** 長按：按住不動 ms（預設 450）呼叫 onHold(項目)；移動超過 slop（預設 8）像素就取消；長按後放開的 click 不往下傳 */
  longPress(target: Element, options: { item?: string; onHold(item: Element): void; ms?: number; slop?: number; vibrate?: number; rightClick?: boolean }): void;
}
/** 等待與逾時（見 timing.js） */
export interface Timing {
  wait(ms: number): Promise<void>;
  /** ms 毫秒後中止的 AbortSignal（舊版 iOS 沒有 AbortSignal.timeout 時退回 AbortController） */
  timeoutSignal(ms: number): AbortSignal;
  fetchTimeout(url: RequestInfo | URL, options?: RequestInit, ms?: number): Promise<Response>;
}
export declare const store: Store;
export declare const gesture: Gesture;
export declare const timing: Timing;
export declare const backstack: Backstack;
declare const AppKit: { i18n: I18n; install: Install; photo: Photo; files: Files; ui: Ui; account: Account; landing: Landing; share: Share; update: Update; idb: Idb; backstack: Backstack; store: Store; gesture: Gesture; timing: Timing };
export default AppKit;
