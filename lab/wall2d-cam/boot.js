// AR 看線（auto=1）：一開始就藏起開啟相機鈕與載入狀態，並於模組載入前先行請求相機串流，縮短黑畫面時間。
const wall2dParams = new URLSearchParams(location.search);
if (wall2dParams.get('auto') === '1') {
  document.documentElement.dataset.auto = '1';
  document.documentElement.dataset.embed = '1';   // 岩點貓的 AR 看線：不顯示開發工具（出錯時 auto 會拿掉，這個不拿）
  const absNow = () => performance.timeOrigin + performance.now();
  window.__wall2dBootAt = absNow();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vw > 0 && vh > 0 && navigator.mediaDevices?.getUserMedia) {
    const aspect = vw / vh;
    const base = {
      width: { ideal: Math.round(aspect >= 1 ? 1280 : 1280 * aspect) },
      height: { ideal: Math.round(aspect >= 1 ? 1280 / aspect : 1280) },
      aspectRatio: { ideal: aspect },
      resizeMode: { ideal: 'none' },
    };
    // 有些手機（例如部分 Android）會把直／橫的寬高反過來給；app.js 判斷過一次就記在 localStorage，這裡直接用對的寬高開
    let reversed = false;
    try {
      reversed = (JSON.parse(localStorage.getItem('climbio.wall2dCamReversed') || '{}') || {})[aspect < 1 ? 'portrait' : 'landscape'] === true;
    } catch { /* 讀不到就照一般的開 */ }
    const constraints = reversed
      ? { ...base, width: base.height, height: base.width, aspectRatio: { ideal: 1 / aspect } }
      : base;
    window.__wall2dGumCallAt = absNow();
    const p = navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { ...constraints, facingMode: { ideal: 'environment' } },
    });
    window.__wall2dEarlyCamera = {
      constraints,
      reversed,
      promise: p.then(
        (stream) => {
          window.__wall2dGumResolveAt = absNow();
          return { stream };
        },
        (error) => ({ error })
      ),
    };
  }
}
