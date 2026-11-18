// 首頁匯入的工作區：Crag。首頁（../home.js）只認這份介面，不判斷是哪個工作區。
// 各工作區自己的設定放在自己的資料夾：crag/intake.js。
// 加一個工作區專屬的匯入功能：改該資料夾的 intake.js（需要新的掛載點時先在這裡加，預設為空）。
//
// 工作區描述：
//   id, name            'crag'、顯示名稱
//   target              轉去哪個頁面接手
//   groupPrefix         自動分組的名稱前綴（「岩壁 1」）
//   newProject          手動新增專案：{ hash, options }
//   suggest(scan)       掃描結果適不適合這個工作區（依 ORDER 順序問，第一個 true 的勝出，都不是就用 crag）
//   options(scan)       自動處理的項目
//   folder(group, ctx)  照片放進專案的哪個資料夾（預設是分組名稱）
//   groupName(group)    自動分組的名稱（回 null 就用「前綴 N」）
import { crag } from '../crag/intake.js';

const base = { folder: (groupName) => groupName, groupName: () => null };

export const WS = Object.fromEntries([crag].map(w => [w.id, { ...base, ...w }]));
const ORDER = ['crag'];

/** 最近的專案要認得的工作區：匯入（WS）之外的 Wall（專案在 wall/ 自己建，不經首頁匯入） */
export const OPEN = { ...WS, gym: { id: 'gym', name: 'Wall', target: 'wall' } };

export const suggestWs = (scan) => ORDER.find(id => WS[id].suggest(scan)) || 'crag';
