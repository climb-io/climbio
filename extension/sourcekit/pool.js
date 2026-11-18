// 這是 sourcekit/ 的複製（tools/sync-extension.mjs 產生），不要直接改，改 sourcekit/ 再同步。
// 小工具：同時最多 n 個一起做的並行池，和 SHA-256；瀏覽器、Node 與瀏覽器擴充（tools/sync-extension.mjs 複製進 extension/）都能用。
export const sha256 = async (bytes) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** 同時最多 n 個一起做 work(item)；任一個失敗就整個失敗 */
export async function pool(items, n, work) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await work(queue.shift());
  }));
}
