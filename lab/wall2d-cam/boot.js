// 相機看線（auto=1）：一開始就藏起開啟相機鈕與載入狀態，並於模組載入前先行請求相機串流，縮短黑畫面時間。
const wall2dParams = new URLSearchParams(location.search);
if (wall2dParams.get('auto') === '1') {
  document.documentElement.dataset.auto = '1';
  const absNow = () => performance.timeOrigin + performance.now();
  window.__wall2dBootAt = absNow();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (vw > 0 && vh > 0 && navigator.mediaDevices?.getUserMedia) {
    const aspect = vw / vh;
    const constraints = {
      width: { ideal: Math.round(aspect >= 1 ? 1280 : 1280 * aspect) },
      height: { ideal: Math.round(aspect >= 1 ? 1280 / aspect : 1280) },
      aspectRatio: { ideal: aspect },
      resizeMode: { ideal: 'none' },
    };
    window.__wall2dGumCallAt = absNow();
    const p = navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { ...constraints, facingMode: { ideal: 'environment' } },
    });
    window.__wall2dEarlyCamera = {
      constraints,
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
