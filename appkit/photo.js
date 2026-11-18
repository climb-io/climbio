// AppKit photo：匯入照片。讀 EXIF（JPEG 的 APP1）換成 v2 照片畫面的 camera、照片轉正並縮到長邊上限、重新編碼成 JPEG
// （預設移除 EXIF；preserveExif 可保留原拍攝資訊並更新方向與尺寸）、縮圖、SHA-256、v2 照片畫面。
// 只在瀏覽器裡做，不上傳；EXIF 不依賴任何套件。瀏覽器用 <script> 載入，掛在全域 AppKit.photo；Node 用 require（EXIF 的部分）。
// English: AppKit photo: EXIF → v2 camera, orientation-corrected resize, JPEG re-encode (drops EXIF), thumbnail, SHA-256, v2 photo view.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else (root.AppKit || (root.AppKit = {})).photo = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const norm360 = (deg) => ((deg % 360) + 360) % 360;

  const TAG = {
    model: 0x0110, exifIfd: 0x8769, gpsIfd: 0x8825,
    dateTimeOriginal: 0x9003, offsetTimeOriginal: 0x9011, focal35: 0xa405,
    latRef: 0x0001, lat: 0x0002, lngRef: 0x0003, lng: 0x0004, altRef: 0x0005, alt: 0x0006,
    gpsTime: 0x0007, headingRef: 0x0010, heading: 0x0011, gpsDate: 0x001d, hError: 0x001f,
  };
  const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };

  /** JPEG 的位元組 → EXIF 的拍照資料（沒有 EXIF 或不是 JPEG 時是空物件） */
  function readExif(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return {};
    const raw = {};
    let at = 2;
    while (at + 4 <= bytes.length && bytes[at] === 0xff) {
      const marker = bytes[at + 1];
      if (marker === 0xda || marker === 0xd9) break;   // 影像資料開始：後面沒有 metadata
      const len = (bytes[at + 2] << 8) | bytes[at + 3];
      const body = bytes.subarray(at + 4, at + 2 + len);
      if (marker === 0xe1 && ascii(body, 0, 6) === 'Exif\0\0') fill(raw, readTiff(body.subarray(6)));
      else if (marker === 0xe1 && ascii(body, 0, 29) === 'http://ns.adobe.com/xap/1.0/\0') fill(raw, readXmp(body.subarray(29)));
      at += 2 + len;
    }
    return raw;
  }

  /** 有好幾段 APP1 時（例如重新編碼過的檔案又多一段），先讀到的值為準，後面的只補沒有的欄位 */
  function fill(raw, more) {
    for (const [k, v] of Object.entries(more)) if (v !== undefined && raw[k] === undefined) raw[k] = v;
  }

  function ascii(bytes, from, n) {
    let s = '';
    for (let i = from; i < Math.min(bytes.length, from + n); i++) s += String.fromCharCode(bytes[i]);
    return s;
  }

  function readTiff(t) {
    if (t.length < 8) return {};
    const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
    const le = t[0] === 0x49;
    const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);
    const value = (type, count, o) => {
      const size = TYPE_SIZE[type] * count;
      if (!TYPE_SIZE[type] || size === 0) return undefined;
      const p = size <= 4 ? o : u32(o);
      if (p + size > t.length) return undefined;
      const one = (i) => {
        switch (type) {
          case 3: return u16(p + i * 2);
          case 4: return u32(p + i * 4);
          case 9: return dv.getInt32(p + i * 4, le);
          case 5: { const d = u32(p + i * 8 + 4); return d ? u32(p + i * 8) / d : undefined; }
          case 10: { const d = dv.getInt32(p + i * 8 + 4, le); return d ? dv.getInt32(p + i * 8, le) / d : undefined; }
          default: return t[p + i];
        }
      };
      if (type === 2) return ascii(t, p, count).replace(/\0[\s\S]*$/, '').trim();
      return count === 1 ? one(0) : Array.from({ length: count }, (_, i) => one(i));
    };
    const ifd = (o) => {
      const out = new Map();
      if (!o || o + 2 > t.length) return out;
      const n = u16(o);
      for (let i = 0; i < n; i++) {
        const e = o + 2 + i * 12;
        if (e + 12 > t.length) break;
        out.set(u16(e), value(u16(e + 2), u32(e + 4), e + 8));
      }
      return out;
    };
    const ifd0 = ifd(u32(4)), exif = ifd(ifd0.get(TAG.exifIfd)), gps = ifd(ifd0.get(TAG.gpsIfd));
    const dms = (v, ref) => {
      if (!Array.isArray(v) || v.length < 3 || v.some(x => !Number.isFinite(x))) return undefined;
      const deg = v[0] + v[1] / 60 + v[2] / 3600;
      return ref === 'S' || ref === 'W' ? -deg : deg;
    };
    const alt = gps.get(TAG.alt);
    return {
      model: ifd0.get(TAG.model),
      time: exifTime(exif.get(TAG.dateTimeOriginal), exif.get(TAG.offsetTimeOriginal), gps.get(TAG.gpsDate), gps.get(TAG.gpsTime)),
      focal35: exif.get(TAG.focal35),
      lat: dms(gps.get(TAG.lat), gps.get(TAG.latRef)), lng: dms(gps.get(TAG.lng), gps.get(TAG.lngRef)),
      alt: Number.isFinite(alt) ? (gps.get(TAG.altRef) === 1 ? -alt : alt) : undefined,
      accuracy: gps.get(TAG.hError),
      heading: gps.get(TAG.heading), headingRef: gps.get(TAG.headingRef),
    };
  }

  /** 拍攝時間（毫秒）：DateTimeOriginal 加上時區；沒有時區用 GPS 的 UTC 時間；都沒有就當成這台裝置的時區 */
  function exifTime(local, offset, gpsDate, gpsTime) {
    const m = typeof local === 'string' && local.match(/^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/);
    if (m && typeof offset === 'string' && /^[+-]\d\d:\d\d$/.test(offset)) {
      return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${offset}`);
    }
    const d = typeof gpsDate === 'string' && gpsDate.match(/^(\d{4}):(\d\d):(\d\d)$/);
    if (d && Array.isArray(gpsTime) && gpsTime.length === 3 && gpsTime.every(Number.isFinite)) {
      return Date.UTC(+d[1], +d[2] - 1, +d[3], gpsTime[0], gpsTime[1], Math.floor(gpsTime[2]));
    }
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime();
    return undefined;
  }

  /** XMP 裡的俯仰（空拍機、全景相機會寫；手機通常沒有） */
  function readXmp(bytes) {
    const xml = new TextDecoder().decode(bytes);
    const m = xml.match(/(?:GimbalPitchDegree|PosePitchDegrees|CameraPitch)\s*(?:=\s*"|>)\s*([+-]?\d+(?:\.\d+)?)/);
    return m ? { pitch: Number(m[1]) } : {};
  }

  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const text = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 60) : undefined);
  const round = (v, digits) => Math.round(v * 10 ** digits) / 10 ** digits;

  /**
   * EXIF 的拍照資料 → v2 的 camera；沒有位置時是 undefined（position 必填）。
   * 朝向以正北為準：磁北（ref M）加上磁偏角（度，東為正）；沒標基準的當成正北（手機開著定位拍照都寫 T）。焦距 0 在 EXIF 是不明。
   */
  function toCamera(raw, { declination = 0 } = {}) {
    const lat = num(raw?.lat), lng = num(raw?.lng);
    if (lat === undefined || lng === undefined || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return undefined;
    const alt = num(raw.alt), heading = num(raw.heading), pitch = num(raw.pitch), accuracy = num(raw.accuracy), t = num(raw.time);
    const camera = { position: alt === undefined ? [round(lng, 7), round(lat, 7)] : [round(lng, 7), round(lat, 7), round(alt, 1)] };
    if (accuracy !== undefined && accuracy >= 0) camera.accuracy = round(accuracy, 1);
    if (heading !== undefined) camera.heading = round(norm360(heading + (raw.headingRef === 'M' ? declination : 0)), 1) % 360;
    if (pitch !== undefined && Math.abs(pitch) <= 90) camera.pitch = round(pitch, 1);
    if (t !== undefined && t >= 0) camera.t = Math.round(t);
    if (num(raw.focal35) > 0) camera.focal = raw.focal35;
    const model = text(raw.model);
    if (model) camera.model = model;
    return camera;
  }

  // ---- 照片 ----
  /** 存下來的照片長邊、縮圖長邊（像素）的預設值 */
  const MAX_EDGE = 2560, THUMB_EDGE = 360;

  /** 照片檔或 Blob → 轉正（依 EXIF 的方向）、長邊縮到 maxEdge 以內的畫布 */
  async function toCanvas(file, maxEdge = Infinity) {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try { return scaled(bitmap, maxEdge); } finally { bitmap.close(); }
  }
  function scaled(src, maxEdge) {
    const k = Math.min(1, maxEdge / Math.max(src.width, src.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(src.width * k)); c.height = Math.max(1, Math.round(src.height * k));
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c;
  }
  /** JPEG 品質：依用途統一（岩點貓、紅點貓的畫布編碼都用這幾個值）
   *  tiny＝資料網址的小縮圖；thumb＝縮圖；image＝匯入照片的主圖；preview＝畫面上的預覽；crop＝裁切、快照；full＝完整輸出（匯出、分享圖） */
  const QUALITY = { tiny: 0.75, thumb: 0.8, image: 0.86, preview: 0.85, crop: 0.9, full: 0.92 };
  /** 畫布 → JPEG（重新編碼：不帶 EXIF） */
  const jpeg = (canvas, quality = QUALITY.full) =>
    new Promise((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('jpeg'))), 'image/jpeg', quality));
  /** 畫布或圖 → 長邊 edge 以內的 JPEG：{ blob, w, h }；用完的畫布早點放掉（iPhone 的畫布總量有上限） */
  async function encode(src, edge, quality) {
    const c = scaled(src, edge);
    try { return { blob: await jpeg(c, quality), w: c.width, h: c.height }; } finally { c.width = c.height = 0; }
  }
  /** 已經有的照片（例如匯入的檔案）原尺寸重新壓成 JPEG：拿掉 EXIF */
  async function reencode(blob, quality = QUALITY.full) {
    const c = await toCanvas(blob);
    try { return await jpeg(c, quality); } finally { c.width = c.height = 0; }
  }
  /** Blob → SHA-256（十六進位） */
  async function sha256(blob) {
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('');
  }
  /** 保留原 JPEG 的 EXIF；像素已轉正，方向與尺寸必須跟著更新，舊縮圖不再引用。 */
  function copyExif(original, encoded, w, h) {
    const bytes = new Uint8Array(original), segments = [];
    for (let at = 2; at + 4 <= bytes.length && bytes[at] === 0xff;) {
      const marker = bytes[at + 1];
      if (marker === 0xda || marker === 0xd9) break;
      const len = (bytes[at + 2] << 8) | bytes[at + 3];
      if (len < 2 || at + 2 + len > bytes.length) throw new Error('照片 EXIF 格式不完整');
      if (marker === 0xe1 && ascii(bytes, at + 4, 6) === 'Exif\0\0') {
        const segment = bytes.slice(at, at + 2 + len), t = segment.subarray(10), dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
        const le = t[0] === 0x49;
        if (t.length < 8 || ![0x49, 0x4d].includes(t[0]) || t[1] !== t[0] || dv.getUint16(2, le) !== 42) throw new Error('照片 EXIF 格式不完整');
        const seen = new Set();
        const update = offset => {
          if (!offset || seen.has(offset)) return;
          seen.add(offset);
          if (offset + 2 > t.length) throw new Error('照片 EXIF 格式不完整');
          const count = dv.getUint16(offset, le), end = offset + 2 + count * 12;
          if (end + 4 > t.length) throw new Error('照片 EXIF 格式不完整');
          for (let e = offset + 2; e < end; e += 12) {
            const tag = dv.getUint16(e, le), type = dv.getUint16(e + 2, le), n = dv.getUint32(e + 4, le);
            if (tag === 0x8769 && type === 4 && n === 1) update(dv.getUint32(e + 8, le));
            const value = tag === 0x0112 ? 1 : [0x0100, 0xa002].includes(tag) ? w : [0x0101, 0xa003].includes(tag) ? h : undefined;
            if (value !== undefined && n === 1) {
              if (type === 3) dv.setUint16(e + 8, value, le);
              else if (type === 4) dv.setUint32(e + 8, value, le);
            }
          }
          dv.setUint32(end, 0, le);
        };
        update(dv.getUint32(4, le));
        segments.push(segment);
      }
      at += len + 2;
    }
    return new Blob([encoded.slice(0, 2), ...segments, encoded.slice(2)], { type: 'image/jpeg' });
  }

  /** 照片檔 → { raw（EXIF 的拍照資料）, image, thumb, w, h, sha256 }：image 長邊 maxEdge 以內、轉正；preserveExif 保留 EXIF，預設不帶 */
  async function prepare(file, { maxEdge = MAX_EDGE, thumbEdge = THUMB_EDGE, quality = QUALITY.image, preserveExif = false } = {}) {
    const original = await file.arrayBuffer(), raw = readExif(original);
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      const image = await encode(bitmap, maxEdge, quality);
      const thumb = await encode(bitmap, thumbEdge, QUALITY.thumb);
      const blob = preserveExif ? copyExif(original, image.blob, image.w, image.h) : image.blob;
      return { raw, image: blob, thumb: thumb.blob, w: image.w, h: image.h, sha256: await sha256(blob) };
    } finally {
      bitmap.close();
    }
  }
  /** 照片或畫布 → 縮圖（JPEG） */
  async function thumb(src, edge = THUMB_EDGE) {
    if (src instanceof Blob) {
      const bitmap = await createImageBitmap(src);
      try { return (await encode(bitmap, edge, QUALITY.thumb)).blob; } finally { bitmap.close(); }
    }
    return (await encode(src, edge, QUALITY.thumb)).blob;
  }

  /**
   * v2 的照片畫面（kind: view、surface: photo）。origin 預設 'self'（自己拍的）；紙本、來源不明的照片傳 origin: null，不能分享出去。
   * raw 是 readExif 的結果：有位置時帶 camera（朝向依 declination 從磁北換成正北）。
   */
  function view({ id, name, t = Date.now(), license, attribution = '', author, origin = 'self', w, h, sha256: sha, raw, declination = 0 }) {
    const v = { climbio: 2, kind: 'view', surface: 'photo', id, t, license, attribution };
    if (author) v.author = author;
    if (origin) v.origin = origin;
    Object.assign(v, { href: `${id}.jpg`, w, h, mime: 'image/jpeg' });
    if (name) v.name = name;
    if (sha) v.sha256 = sha;
    const camera = raw && toCamera(raw, { declination });
    if (camera) v.camera = camera;
    return v;
  }

  /** 圖片網址（含 blob:、data:）→ 載入好的 Image；載入失敗就丟錯 */
  const load = (src) => new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = src; });

  return { readExif, toCamera, QUALITY, MAX_EDGE, THUMB_EDGE, toCanvas, jpeg, encode, reencode, sha256, load, prepare, thumb, view };
});
