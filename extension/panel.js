// 進度面板：注入頁面右下角（Shadow DOM，不受頁面樣式影響），顯示三個步驟、各自的張數與總進度。chrome.scripting.executeScript 的 func，所以不能用外面的任何東西。
/**
 * 在頁面右下角顯示進度面板（注入頁面執行，不能用外面的任何東西）。
 * state：{ kind: 'busy' | 'done' | 'error' | 'notice'（導引：沒有步驟、沒有進度條，只有標題與說明）| 'pick'（勾選：options 是 [{ id, label, sub, disabled }]，
 *   按下按鈕送出 { type: 'pick', ids } 給背景程式）, title, steps: [{ label, status: 'todo' | 'doing' | 'done', count }], progress: 0–1, message, hint }
 */
export function panel(state) {
  const HOST = 'redpoint-save';
  let host = document.getElementById(HOST);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST;
    host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>
      :host{all:initial}
      *{box-sizing:border-box}
      .card{--bg:#fff;--text:#14212f;--muted:#5f6f80;--line:#e3e8ee;--accent:#14375e;--red:#e5484d;--ok:#1f9d63;width:min(340px,calc(100vw - 32px));padding:16px 16px 14px;border-radius:20px;background:var(--bg);color:var(--text);box-shadow:0 18px 50px #0003,0 2px 8px #0002;font:14px/1.5 system-ui,-apple-system,"Segoe UI","Noto Sans TC",sans-serif;animation:in .35s cubic-bezier(.2,.9,.3,1.2) both}
      @media (prefers-color-scheme:dark){.card{--bg:#18222d;--text:#eef2f6;--muted:#9fb0c1;--line:#2b3947;--accent:#7fb2ea}}
      @keyframes in{from{transform:translateY(16px) scale(.97);opacity:0}}
      .head{display:flex;align-items:center;gap:8px;font-weight:800}
      .head .ver{font-size:12px;font-weight:600;color:var(--muted);margin-left:6px;letter-spacing:.02em}
      .logo{flex:none;display:block;width:24px;height:24px;color:var(--accent)}
      .logo svg{display:block;width:100%;height:100%}
      .head span:not(.logo){flex:1}
      .x{all:unset;cursor:pointer;width:28px;height:28px;border-radius:50%;display:grid;place-items:center;color:var(--muted);font-size:18px}
      .x:hover{background:var(--line)}
      .title{margin:10px 0 0;font-size:17px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .bar{height:6px;margin:12px 0;border-radius:99px;background:var(--line);overflow:hidden}
      .bar i{display:block;height:100%;width:0;border-radius:inherit;background:var(--accent);transition:width .35s ease-out}
      .card.done .bar i{background:var(--ok)}
      .card.error .bar i{background:var(--red)}
      ul{list-style:none;margin:0;padding:0;display:grid;gap:6px}
      li{display:flex;align-items:center;gap:10px;color:var(--muted)}
      li b{margin-left:auto;font-weight:600;font-variant-numeric:tabular-nums}
      li .m{flex:none;width:18px;height:18px;border-radius:50%;border:2px solid var(--line);display:grid;place-items:center;font-size:11px;color:#fff}
      li.doing{color:var(--text);font-weight:700}
      li.doing .m{border-color:var(--accent);border-top-color:transparent;animation:spin .8s linear infinite}
      li.done .m{background:var(--ok);border-color:var(--ok)}
      li.done .m::after{content:"✓"}
      @keyframes spin{to{transform:rotate(360deg)}}
      @media (prefers-reduced-motion:reduce){.card,li.doing .m,.bar i{animation:none;transition:none}}
      .msg{margin:12px 0 0;font-weight:700}
      .card.error .msg{color:var(--red)}
      .hint{margin:4px 0 0;color:var(--muted);font-size:13px}
      .opts{list-style:none;margin:12px 0 0;padding:0;display:grid;gap:4px}
      .opts label{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:12px;cursor:pointer}
      .opts label:hover{background:var(--line)}
      .opts input{flex:none;width:18px;height:18px;accent-color:var(--accent)}
      .opts span{flex:1;min-width:0;font-weight:700}
      .opts small{display:block;font-weight:400;color:var(--muted)}
      .opts label.off{cursor:default;opacity:.55}
      .opts label.off:hover{background:none}
      .btn:disabled{opacity:.5;cursor:default}
      .btn{all:unset;cursor:pointer;margin-top:12px;display:block;text-align:center;padding:9px 14px;border-radius:12px;background:var(--accent);color:#fff;font-weight:700}
      [hidden]{display:none!important}
    </style>
    <div class="card" role="status" aria-live="polite">
      <div class="head"><span class="logo"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" aria-hidden="true"><defs><clipPath id="redpoint-cat-cutouts" clipPathUnits="userSpaceOnUse"><path fill-rule="evenodd" d="M0 0H1100V1024H0Z M294 219 L293 173 L373 237 Z M663 167 L689 113 L714 183 Z M544 791a32 32 0 1 0 64 0a32 32 0 1 0 -64 0Z"/></clipPath></defs><g clip-path="url(#redpoint-cat-cutouts)"><g transform="translate(55 16)"><path d="M115 389 C142 357 190 323 254 291 L259 180 Q262 143 288 150 L414 230 C464 212 516 197 555 184 L670 68 Q689 51 708 79 L758 208 C795 225 818 265 804 315 C791 357 766 397 736 442 C682 529 647 602 642 684 L646 830 C647 890 618 921 570 921 C518 921 491 890 486 839 L479 715 C476 620 442 563 365 513 C290 477 206 484 144 458 C99 438 88 418 115 389 Z" fill="#2E8CC9"/></g><path d="M115 389 C142 357 190 323 254 291 L259 180 Q262 143 288 150 L414 230 C464 212 516 197 555 184 L670 68 Q689 51 708 79 L758 208 C795 225 818 265 804 315 C791 357 766 397 736 442 C682 529 647 602 642 684 L646 830 C647 890 618 921 570 921 C518 921 491 890 486 839 L479 715 C476 620 442 563 365 513 C290 477 206 484 144 458 C99 438 88 418 115 389 Z M294 219 L293 173 L373 237 Z M663 167 L689 113 L714 183 Z M544 791a32 32 0 1 0 64 0a32 32 0 1 0 -64 0Z" fill="#0B4A6B" fill-rule="evenodd"/><path d="M306 353 C345 304 441 265 533 246 C610 230 690 241 717 288 C733 320 693 396 634 436 C591 466 547 483 475 480 C406 477 334 452 304 419 C280 394 285 375 306 353 Z" fill="#FFFFFF"/><ellipse cx="425" cy="382" rx="22" ry="31" fill="#0B4A6B"/><ellipse cx="594" cy="341" rx="23" ry="31" fill="#0B4A6B"/><path d="M494 373 Q514 366 535 374 Q543 384 520 408 Q510 420 504 406 Q483 385 494 373 Z" fill="#0B4A6B"/></g><circle class="role-tool" cx="867" cy="667" r="47" fill="#FF6B6B"/><circle class="role-tool" cx="867" cy="667" r="17" fill="#FFFFFF"/></svg>
</span><span><strong class="app-name">紅點貓收藏</strong><small class="ver"></small></span><button class="x" aria-label="關閉">×</button></div>
      <div class="title"></div>
      <div class="bar"><i></i></div>
      <ul></ul>
      <div class="opts" hidden></div>
      <p class="msg" hidden></p>
      <p class="hint" hidden></p>
      <button class="btn" hidden>關閉</button>
    </div>`;
    const close = () => host.remove();
    root.querySelector('.x').onclick = close;
    root.querySelector('.btn').onclick = close;
    document.body.append(host);
  }
  const root = host.shadowRoot, $ = (s) => root.querySelector(s);
  const ui = state.ui || {};
  $('.app-name').textContent = ui.appName || '紅點貓收藏';
  $('.x').setAttribute('aria-label', ui.close || '關閉');
  clearTimeout(host.__timer);
  $('.card').className = `card ${state.kind}`;
  if (state.version && $('.head .ver')) $('.head .ver').textContent = ` v${state.version}`;
  $('.title').textContent = state.title || ui.appName || '紅點貓收藏';
  $('.bar i').style.width = `${Math.round(Math.min(Math.max(state.progress, 0), 1) * 100)}%`;
  const list = $('ul');
  list.hidden = $('.bar').hidden = !state.steps.length;   // 導引沒有步驟與進度條
  if (list.children.length !== state.steps.length) {
    list.replaceChildren(...state.steps.map(() => {
      const li = document.createElement('li');
      li.innerHTML = '<i class="m"></i><span></span><b></b>';
      return li;
    }));
  }
  state.steps.forEach((s, i) => {
    const li = list.children[i];
    li.className = s.status;
    li.children[1].textContent = s.label;
    li.children[2].textContent = s.count || '';
  });
  // 勾選：每個選項一列（不能選的灰掉並寫原因），按下按鈕把勾的 id 送給背景程式
  const opts = $('.opts'), pick = state.kind === 'pick';
  opts.hidden = !pick;
  if (pick) {
    opts.replaceChildren(...state.options.map((o) => {
      const row = document.createElement('label'), box = document.createElement('input'), text = document.createElement('span'), sub = document.createElement('small');
      Object.assign(box, { type: 'checkbox', value: o.id, checked: !o.disabled, disabled: !!o.disabled });
      row.className = o.disabled ? 'off' : '';
      text.textContent = o.label;
      sub.textContent = o.sub || '';
      text.append(sub);
      row.append(box, text);
      return row;
    }));
    const go = $('.btn'), count = () => opts.querySelectorAll('input:checked').length;
    const label = () => { go.textContent = `${state.cta} ${count()} ${ui.countUnit || '個'}`; go.disabled = !count(); };
    opts.onchange = label;
    label();
    go.onclick = () => {
      go.disabled = true;
      go.textContent = ui.processing || '處理中…';
      chrome.runtime.sendMessage({ type: 'pick', ids: [...opts.querySelectorAll('input:checked')].map((b) => b.value) });
    };
  } else {
    $('.btn').onclick = () => host.remove();
    $('.btn').textContent = ui.close || '關閉';
    $('.btn').disabled = false;
  }
  const msg = $('.msg'), hint = $('.hint');
  msg.hidden = !state.message;
  msg.textContent = state.message || '';
  hint.hidden = !state.hint;
  hint.textContent = state.hint || '';
  $('.btn').hidden = state.kind === 'busy';
  if (state.kind === 'done' || state.kind === 'notice') host.__timer = setTimeout(() => host.remove(), 12000);
}
