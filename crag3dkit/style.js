// Crag3DKit 的樣式（字串）。掛載時放進所在的 root（shadow root 或 document.head），只放一份。
// 路線的顏色是 CSS 變數，使用的 App 可以在宿主元素或它的上層覆蓋：--c3d-sport、--c3d-sport-on、--c3d-other、--c3d-other-on（預設跟 TopoKit 的 2D 線同色）。
// English: stylesheet string injected once per root; line colours are CSS variables.
export const CSS = `
.c3d { display: block; overflow: hidden; --c3d-sport: #1565c0; --c3d-sport-on: #1e7bff; --c3d-other: #c8102e; --c3d-other-on: #e11d2e; }
`;

const ID = 'crag3dkit-style';

/** 把樣式放進宿主所在的 root（沒放過才放） */
export function injectStyle(host) {
  const root = host.getRootNode?.() ?? document;
  const target = root instanceof ShadowRoot ? root : document.head;
  if (target.querySelector?.(`#${ID}`)) return;
  const style = document.createElement('style');
  style.id = ID;
  style.textContent = CSS;
  target.append(style);
}
