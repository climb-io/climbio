// 只讀匯入工具在岩場組合上寫的短來源名稱，不依舊署名或網址猜測來源。
// attribution / license / source.url 保留在資料中，與卡片標籤分開。
export function sourceLabel(doc) {
  const label = doc?.props?.sourceLabel;
  return typeof label === 'string' ? label.trim() : '';
}
