// 3D 牆的 patch（climbio-3d-patch/1）：發佈的版本只記最終決定（隱藏的面、裁切平面、不是岩點的岩點、修點、岩館）。
// 基底的 wall.json（base-wall.json）加上 patch 就是那一版的工作檔。Studio 3D 牆（從公開版本接著精修）和命令列 tools/studio.mjs 共用。

/** 基底的 wall.json（已解析）套上 patch → 工作檔的 wall.json（直接改 doc 並回傳） */
export function applyPatch(doc, patch) {
  const hidden = new Set(patch.hidden), off = new Set(patch.off);
  doc.surfaces.list.forEach((x, i) => { if (hidden.has(i)) x.hidden = true; else delete x.hidden; });
  doc.surfaces.frame.planes = patch.planes;
  doc.holds.forEach(h => { if (off.has(h.id)) h.off = 1; else delete h.off; });
  if (patch.edits?.length) doc.edits = patch.edits; else delete doc.edits;
  if (patch.gym) doc.gym = patch.gym;
  return doc;
}
