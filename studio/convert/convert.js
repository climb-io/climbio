// 轉換路線書說明頁：把給 AI 的提示放進頁面（提示只有 studio/crag/ai-prompt.js 一份），按鈕複製。
import { AI_PROMPT, AI_MAP_PROMPT } from '../crag/ai-prompt.js';

const T = AppKit.i18n.t;
AppKit.i18n.apply();

document.getElementById('promptOutline').textContent = AI_PROMPT;
document.getElementById('promptMap').textContent = AI_MAP_PROMPT;
for (const b of document.querySelectorAll('.copy')) {
  b.addEventListener('click', async () => {
    const text = document.getElementById(b.dataset.copy).textContent, label = b.textContent;
    try { await navigator.clipboard.writeText(text); b.textContent = T('cvCopied'); } catch { b.textContent = T('cvCopyFailed'); }
    setTimeout(() => { b.textContent = label; }, 1800);
  });
}
