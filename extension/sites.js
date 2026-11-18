// 擴充功能支援的網站與各站點轉換器狀態。
// 不在清單裡的網站統一顯示尚未支援。
// 新增來源時需確認輸入資料結構、來源資訊與權利標記。

export const SITES = [
  // 使用者主動收藏目前開啟的岩場頁；轉成個人收藏並保留來源。
  { id: 'thecrag', name: 'theCrag', hosts: ['thecrag.com'], status: 'supported' },
  // 香港攀岩網站：WordPress 頁面，路線是文字、Topo 線畫在照片裡；只存照片與路線資料，個人收藏
  { id: 'hkclimbing', name: '香港攀岩', hosts: ['hongkongclimbing.com'], status: 'supported' },
  // OpenClimbing：資料在 OpenStreetMap（ODbL）與 Wikimedia Commons（照片逐張 CC／公眾領域），讀它們的公開 API，不是爬網頁
  { id: 'openclimbing', name: 'OpenClimbing', hosts: ['openclimbing.org'], status: 'supported' },
];

/** 網址對應的網站（網域或它的子網域）；不認得就是 undefined */
export function siteOf(url) {
  let host;
  try { host = new URL(url).hostname; } catch { return undefined; }
  return SITES.find((s) => s.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
}
