// 首頁「加資料」的照片交給哪個工作區：Crag（天然岩場）、Wall（岩館）。首頁（../home.js）只認這份介面，不判斷是哪個工作區。
// 各工作區自己的設定放在自己的資料夾：crag/intake.js、wall/intake.js。
// 加一個工作區專屬的匯入功能：改該資料夾的 intake.js（需要新的掛載點時先在這裡加，預設為空）。
//
// 工作區描述：
//   id, name            'crag'、顯示名稱
//   target              轉去哪個頁面接手
//   groupPrefix         自動分組的名稱前綴（「岩壁 1」）
//   inFolder            專案可以存在拖進來的資料夾（Chrome）；否則存在瀏覽器裡
//   suggest(scan)       掃描結果適不適合這個工作區（依 ORDER 順序問，第一個 true 的勝出，都不是就用 crag）；首頁另有切換，人可以改
//   auto(scan)          照掃描結果自動處理的項目（交給工作區的 options，人不勾）
import { crag } from '../crag/intake.js';
import { gym } from '../wall/intake.js';

const base = { inFolder: false };

export const WS = Object.fromEntries([crag, gym].map(w => [w.id, { ...base, ...w }]));
// 有拍攝位置（多半是戶外）的照片先猜岩場，其他猜岩館
const ORDER = ['crag', 'gym'];

/** 最近的專案要認得的工作區 */
export const OPEN = WS;

export const suggestWs = (scan) => ORDER.find(id => WS[id].suggest(scan)) || 'crag';
