import type { MapViewer, MapEditor, MapData } from './index';

/** <climbio-map>：屬性 view、layers、mode、lang、dim、basemap、no-walls、locate、dblclick、controls、no-rotate、flat、min-scale（後三個不在觀察清單，建立前設好）；data 是 { view, layers, nodes } */
export declare const MapElement: { new (): HTMLElement & { data: MapData | undefined; viewer: MapViewer | MapEditor | undefined } } | undefined;

declare global {
  interface HTMLElementTagNameMap {
    'climbio-map': HTMLElement & { data: MapData | undefined; viewer: MapViewer | MapEditor | undefined };
  }
}
