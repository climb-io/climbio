// OSM 對應的 theCrag 岩場網址；只接受官方網站，避免外部資料夾帶入任意網址。
export function theCragUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  try {
    const url = new URL(raw.trim());
    if (!['http:', 'https:'].includes(url.protocol) || !['thecrag.com', 'www.thecrag.com'].includes(url.hostname)
      || url.username || url.password || (url.port && url.port !== '443') || url.pathname === '/') return '';
    url.protocol = 'https:';
    return url.href;
  } catch {
    return '';
  }
}

const membersOf = (crag) => crag.members?.length ? crag.members : [crag];

export function theCragLinks(crag) {
  const links = new Map();
  for (const member of membersOf(crag)) {
    const url = theCragUrl(member.theCragUrl);
    if (url && !links.has(url)) links.set(url, { name: member.name, url });
  }
  return [...links.values()];
}
