/** 擴充存檔的樣子：入口以外的 JSON 合成 pack.json，入口的 props.pack 指到它 */
export function withPack(files) {
  const rest = files.filter((f) => f.json && f.path !== 'index.json'), entry = files.find((f) => f.path === 'index.json');
  return files.map((f) => (f === entry ? { ...f, json: { ...f.json, props: { ...f.json.props, pack: { href: 'pack.json' } } } } : f))
    .concat([{ path: 'pack.json', json: { docs: Object.fromEntries(rest.map((f) => [f.path, f.json])) } }]);
}
