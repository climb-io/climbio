// 自己整理的岩館（tools/gyms/<國碼>.json）寫進 gyms/ 的順序：從北到南，同一個系列（例如原岩、角）放在一起。
// 系列整組放在它最北那間該在的位置，組內再從北到南；沒有系列的自己一間。App 沒有定位時照這個順序列（岩館選單、找牆面、Studio 的岩館清單）。
// list：[{ name, lat, series? }] → 排好的新陣列（同緯度照名稱）
export function northToSouth(list) {
  const top = new Map();   // 系列 → 最北那間的緯度
  for (const g of list) if (g.series) top.set(g.series, Math.max(top.get(g.series) ?? -90, g.lat));
  const key = (g) => (g.series ? top.get(g.series) : g.lat);
  return [...list].sort((a, b) => key(b) - key(a) || (a.series || a.name).localeCompare(b.series || b.name, 'zh-Hant') || b.lat - a.lat || a.name.localeCompare(b.name, 'zh-Hant'));
}
