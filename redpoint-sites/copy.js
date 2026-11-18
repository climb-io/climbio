// 複製給 AI 的說明：抓同一個資料夾的 for-ai.txt；複製不了就打開文件
for (const btn of document.querySelectorAll('.copy')) {
  btn.addEventListener('click', async () => {
    const label = btn.textContent;
    try {
      const text = await (await fetch('for-ai.txt')).text();
      await navigator.clipboard.writeText(text);
      btn.textContent = '已複製';
    } catch {
      location.href = 'for-ai.txt';
      return;
    }
    setTimeout(() => { btn.textContent = label; }, 1800);
  });
}
