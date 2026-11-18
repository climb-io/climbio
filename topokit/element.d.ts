import type { TopoData, TopoEditor, TopoViewer } from './index';

/** <climbio-topo>：載入 @climbio/topokit/element 就註冊。屬性見 element.js 開頭 */
export class TopoElement extends HTMLElement {
  /** { view, layers, nodes }；設了就重畫 */
  data: TopoData | undefined;
  /** 目前的 TopoViewer 或 TopoEditor */
  readonly viewer: TopoViewer | undefined;
  /** mode="edit" 時的 TopoEditor */
  readonly editor: TopoEditor | undefined;
  /**
   * 事件原樣轉出 viewer／editor 的 ready、pick、zoom、swipe、swipedown、change、history、select、selectpoint、tool（CustomEvent，detail 同原事件）；
   * 另有 load（view、layers 屬性的檔案讀完）與 error（CustomEvent，detail.error 是錯誤）。元件不轉出 crop、fork、destroy 等方法，要用 editor／viewer。
   */
  addEventListener(type: 'error', listener: (e: CustomEvent<{ error: unknown }>) => void, options?: AddEventListenerOptions | boolean): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: AddEventListenerOptions | boolean): void;
}

declare global {
  interface HTMLElementTagNameMap {
    'climbio-topo': TopoElement;
  }
}
