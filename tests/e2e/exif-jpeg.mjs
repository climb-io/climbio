// 測試用：在 JPEG 的開頭插入一段 EXIF（APP1），只放Studio Crag會讀的拍照資料（appkit/photo.js）。
// TIFF 小端序；IFD0 有機型與兩個指標，Exif IFD 有拍攝時間、時區與等效焦距，GPS IFD 有位置、高度、誤差與鏡頭朝向。
const ASCII = 2, SHORT = 3, LONG = 4, RATIONAL = 5;
const latin1 = (s) => Array.from(s, c => c.charCodeAt(0) & 255);
const ascii = (tag, s) => ({ tag, type: ASCII, count: s.length + 1, data: [...latin1(s), 0] });
const u32 = (v) => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
const rational = (tag, values) => ({ tag, type: RATIONAL, count: values.length, data: values.flatMap(v => [...u32(Math.round(v * 10000)), ...u32(10000)]) });
const dms = (deg) => { const d = Math.floor(deg), m = Math.floor((deg - d) * 60); return [d, m, (deg - d - m / 60) * 3600]; };

function ifd(entries, offset) {
  const head = 2 + entries.length * 12 + 4, out = [entries.length & 255, entries.length >> 8], extra = [];
  for (const e of entries) {
    out.push(e.tag & 255, e.tag >> 8, e.type, 0, ...u32(e.count));
    if (e.data.length <= 4) out.push(...e.data, ...Array(4 - e.data.length).fill(0));
    else { out.push(...u32(offset + head + extra.length)); extra.push(...e.data, ...(e.data.length % 2 ? [0] : [])); }
  }
  return [...out, 0, 0, 0, 0, ...extra];
}
const size = (entries) => ifd(entries, 0).length;

/** f：{ model, time: 'YYYY:MM:DD HH:MM:SS', offset?: '+08:00', focal35, lat, lng, alt, accuracy?, heading?, headingRef? } */
export function withExif(jpeg, f) {
  const exif = [...(f.w ? [{ tag: 0xa002, type: LONG, count: 1, data: u32(f.w) }, { tag: 0xa003, type: LONG, count: 1, data: u32(f.h) }] : []), ascii(0x9003, f.time), ...(f.offset ? [ascii(0x9011, f.offset)] : []), { tag: 0xa405, type: SHORT, count: 1, data: [f.focal35 & 255, f.focal35 >> 8] }];
  const gps = [
    ascii(0x0001, f.lat >= 0 ? 'N' : 'S'), rational(0x0002, dms(Math.abs(f.lat))),
    ascii(0x0003, f.lng >= 0 ? 'E' : 'W'), rational(0x0004, dms(Math.abs(f.lng))),
    { tag: 0x0005, type: 1, count: 1, data: [0] }, rational(0x0006, [f.alt]),
    ...(f.heading === undefined ? [] : [ascii(0x0010, f.headingRef || 'T'), rational(0x0011, [f.heading])]),
    ...(f.accuracy === undefined ? [] : [rational(0x001f, [f.accuracy])]),
  ];
  const ifd0 = (exifAt, gpsAt) => [...(f.orientation ? [{ tag: 0x0112, type: SHORT, count: 1, data: [f.orientation, 0] }] : []), ascii(0x0110, f.model), { tag: 0x8769, type: LONG, count: 1, data: u32(exifAt) }, { tag: 0x8825, type: LONG, count: 1, data: u32(gpsAt) }];
  const at0 = 8, exifAt = at0 + size(ifd0(0, 0)), gpsAt = exifAt + size(exif);
  const tiff = [0x49, 0x49, 42, 0, ...u32(at0), ...ifd(ifd0(exifAt, gpsAt), at0), ...ifd(exif, exifAt), ...ifd(gps, gpsAt)];
  const body = [...latin1('Exif\0\0'), ...tiff], length = body.length + 2;
  return new Uint8Array([...jpeg.slice(0, 2), 0xff, 0xe1, length >> 8, length & 255, ...body, ...jpeg.slice(2)]);
}
