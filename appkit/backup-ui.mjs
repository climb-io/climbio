// 備份、復原選擇、登出提示共用同一套流程；產品只提供本地資料介面。備份存成檔案，沒有雲端目的地。
import { capture, packBackup, readBackup, restoreBackup } from './backup.mjs';

export function createBackupUI(config) {
  const ui = globalThis.AppKit.ui, T = k => globalThis.AppKit.i18n.t(config.labels?.[k] || k);
  let running = false;
  const choose = async (title, choices, text = '') => (await ui.ask({ title, text, choices, buttons: [{ label: T('cancel') }] }))?.button;
  // 備份、復原的等待：頂端一條進度條（跟下載同一個），不擋畫面；等的時候關頁面會先問
  let prog = null;
  const step = (text, frac) => { if (!prog) prog = ui.progress(text, frac); else prog.update(text, frac); };
  async function busy(title, fn, frac = null) {
    step(title, frac);
    const prevent = e => { e.preventDefault(); e.returnValue = ''; };
    addEventListener('beforeunload', prevent);
    try { await new Promise(r => requestAnimationFrame(r)); return await fn(); }
    finally { removeEventListener('beforeunload', prevent); }
  }
  const finish = (text, opt) => { if (prog) prog.done(text, opt); else ui.toast(text); prog = null; };
  const fail = (text) => { if (prog) prog.fail(text); prog = null; };
  const quiet = () => { prog?.hide(); prog = null; };
  async function options() { return { ...config, storage: localStorage, db: await config.database() }; }
  async function pickGroups(s, title, text, ok) {
    const boxes = s.groups.map(g => {
      const label = document.createElement('label'), input = document.createElement('input');
      input.type = 'checkbox'; input.checked = true;
      label.className = 'pick-row'; label.append(input, document.createTextNode(g.name));
      return { label, input, id: g.id };
    });
    const list = document.createElement('div'); list.className = 'pick-list'; list.append(...boxes.map(b => b.label));
    const answer = await ui.ask({ title, text, body: [list], buttons: [{ label: T('cancel') }, { label: ok, value: 'ok', primary: true }] });
    return answer?.button === 'ok' ? boxes.filter(b => b.input.checked).map(b => b.id) : null;
  }
  async function snapshot() {
    await config.flush?.();
    const s = await capture(await options());
    s.groups = await config.groups?.(s) || [];
    return s;
  }
  async function backup({ complete = false } = {}) {
    if (running) return false;
    running = true;
    try {
      // 兩款 App 的備份共用同一暱稱；沒設定先詢問，取消就不備份。
      const n = await globalThis.AppKit.nearby.ensureNickname({ suggested: (await config.nicknameSuggestion?.()) || '' });
      if (!n) return false;
      let selected;
      if (config.exportGroups && !complete) {
        const s = await busy(T('backupWorking'), snapshot, 0.15);
        quiet();
        if (!s.groups.length) { await ui.alert(T('backupEmpty')); return false; }
        const ids = await pickGroups(s, T('backupData'), '', T('btnOk'));
        if (!ids?.length) return false;
        selected = await config.prepareExport(s, ids);
      }
      const blob = await busy(T('backupWorking'), async () => {
        const s = selected || await snapshot();
        step(T('backupWorking'), 0.45);
        return packBackup(s);
      }, 0.2);
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = `${config.app}-${new Date().toISOString().replace(/[:.]/g, '-')}.climbio`; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      finish(T('backupDone'));
      return true;
    } catch (e) { fail(`${T('backupFailed')}：${e.message}`); return false; }
    finally { running = false; }
  }
  async function apply(blob) {
    const o = await options();
    const s = await busy(T('restoreWorking'), () => readBackup(blob, o), 0.3);
    let ids = null;
    quiet();
    if (config.selective) {
      ids = await pickGroups(s, T('restoreChoose'), T('restoreOverwrite'), T('restoreData'));
      if (!ids?.length) return;
    } else if (!await ui.confirm(T('restoreAllWarning'), { title: T('restoreData'), ok: T('restoreData'), danger: true })) return;
    await config.flush?.();
    await busy(T('restoreWorking'), async () => {
      step(T('restoreWorking'), 0.55);
      const selected = await restoreBackup(s, { ...o, ids });
      step(T('restoreWorking'), 0.9);
      await config.afterRestore?.(s, selected);
    }, 0.45);
    // 復原完要重新載入：重新載入後的頁面（showRestored）在頂端顯示「已復原」
    try { sessionStorage.setItem('climbio.restored', '1'); } catch (e) { /* 沒有就不顯示 */ }
    location.reload();
  }
  async function restore() {
    if (running) return;
    running = true;
    try {
      const extra = config.importSources || [];
      const src = extra.length ? await choose(T('restoreData'), [{ label: T('backupFile'), value: 'file' }, ...extra.map(s => ({ label: s.label(), value: s.id }))]) : 'file';
      if (src === 'file') {
        const input = document.createElement('input'); input.type = 'file'; input.accept = config.importAccept || '.climbio,application/gzip'; input.multiple = !!config.importArchive;
        const files = await new Promise(resolve => { input.onchange = () => resolve([...input.files]); input.oncancel = () => resolve([]); input.click(); });
        if (files.length && config.importArchive && files.every(f => /\.zip$/i.test(f.name))) await config.importArchive(files);
        else if (files.length === 1) await apply(files[0]);
        else if (files.length) await ui.alert(T('importOneBackup'));
      } else if (src) await extra.find(s => s.id === src)?.run();
    } catch (e) { fail(`${T('restoreFailed')}：${e.message}`); }
    finally { running = false; }
  }
  /** 復原後重新載入的頁面：頂端顯示「已復原」（跟備份完成同一種進度條） */
  try { if (sessionStorage.getItem('climbio.restored')) { sessionStorage.removeItem('climbio.restored'); ui.progress(T('restoreWorking'), 1).done(T('restoreDone')); } } catch (e) { /* 沒有就算了 */ }
  async function beforeSignOut() {
    if (running) return false;
    const answer = await choose(T('backupBeforeLogout'), [{ label: T('backupAndLogout'), value: 'backup' }, { label: T('logoutWithoutBackup'), value: 'skip' }], T('logoutLocalData'));
    if (answer === 'skip') return true;
    return answer === 'backup' && await backup({ complete: true });
  }
  return { backup, restore, beforeSignOut };
}
