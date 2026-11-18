// 匯入時放大檢查照片：上一張、下一張、勾選要不要納入。
import { STATUS_LABEL } from '../classify.js';
import { $ } from '../crag/dom.js';

/** items()：[{ g: 分組, it: 照片 }]（依顯示順序）；onToggle()：勾選改了，外面重畫 */
export function createLightbox({ items, onToggle }) {
  let current = null;
  function open(it) {
    const list = items();
    const idx = list.findIndex(x => x.it === it);
    if (idx < 0) return;
    current = it;
    const img = $('#lbImg');
    img.classList.remove('zoomed');
    img.src = it.thumbUrl || '';
    $('#lbCheck').checked = it.selected !== false;
    const badge = $('#lbBadge');
    badge.className = it.clean ? 'clean' : 'warn';
    badge.textContent = it.label || STATUS_LABEL.clean;
    $('#lbTitle').textContent = `${list[idx].g.name} · ${it.file.name} (${idx + 1} / ${list.length})`;
    $('#lbPrev').hidden = list.length <= 1;
    $('#lbNext').hidden = list.length <= 1;
    $('#lightbox').hidden = false;
  }
  function close() {
    current = null;
    const lb = $('#lightbox');
    if (lb) lb.hidden = true;
  }
  function step(delta) {
    if (!current) return;
    const list = items();
    if (!list.length) return;
    const idx = list.findIndex(x => x.it === current);
    const next = list[(idx + delta + list.length) % list.length];
    if (next) open(next.it);
  }
  $('#lbClose').onclick = close;
  $('#lbPrev').onclick = (e) => { e.stopPropagation(); step(-1); };
  $('#lbNext').onclick = (e) => { e.stopPropagation(); step(1); };
  $('#lbImg').onclick = (e) => { e.stopPropagation(); $('#lbImg').classList.toggle('zoomed'); };
  $('#lbBar').onclick = (e) => e.stopPropagation();
  $('#lightbox').onclick = (e) => { if (e.target === $('#lightbox') || e.target === $('#lbStage')) close(); };
  $('#lbCheck').onchange = () => {
    if (!current) return;
    current.selected = $('#lbCheck').checked;
    onToggle();
  };
  window.addEventListener('keydown', (e) => {
    if (!current || $('#lightbox').hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
  });
  return { open, close };
}
