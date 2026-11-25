// <routekit-viewer>、<routekit-editor> 的型別。
// English: types for the <routekit-viewer> and <routekit-editor> Web Components.
import type { Hold, Route, Theme, Photo, BaseMode, HoldType } from './index';

declare class RouteKitElement extends HTMLElement {
  photo: Photo | null;
  holds: Hold[];
  route: Route | null;
  theme: Theme | undefined;
}
/** 屬性：src（路線圖層的網址，Climbio 公開格式 v2）、route-id（圖層裡的哪一條，沒有就第一條）、mode（gray／dim）、segment（有這個屬性才分段播放，沒有段長） */
export class RouteKitViewer extends RouteKitElement {}
/** 屬性：src、route-id、type（s／h／f／t／n）；change 事件的 detail 是路線 */
export class RouteKitEditor extends RouteKitElement {}

/** 路線圖層的網址 → 照片、牆上的岩點、指定的那條路線（沒給 routeId 就是第一條；圖層指到的牆、照片一起讀） */
export function loadRoute(src: string, routeId?: string): Promise<{ photo: HTMLImageElement; holds: Hold[]; route: Route }>;
/** 路線圖層的網址 → 照片、牆上的岩點、圖層裡全部的路線（岩館網站列路線清單用） */
export function loadLayer(src: string): Promise<{ photo: HTMLImageElement; holds: Hold[]; routes: Route[] }>;

declare global {
  interface HTMLElementTagNameMap { 'routekit-viewer': RouteKitViewer; 'routekit-editor': RouteKitEditor }
}
export type { BaseMode, HoldType };
