#!/usr/bin/env python3
"""產生測試站專用 App 圖示。

只在 build-site.sh 的 climbio-dev / climbio-eric 建置後執行。
從正式 PNG 像素複製貓圖，再於 maskable 安全區加上醒目的 DEV 識別；
正式 SVG、正式 PNG、正式 manifest 都不修改。
不用 Pillow、ImageMagick 或瀏覽器，CI 的 Python 3 標準函式庫即可執行。
"""
import json
import re
import struct
import sys
import zlib
from pathlib import Path

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
FONT = {
    "D": ("####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."),
    "E": ("#####", "#....", "#....", "####.", "#....", "#....", "#####"),
    "V": ("#...#", "#...#", "#...#", "#...#", ".#.#.", ".#.#.", "..#.."),
}
APPS = {
    "hold-cat": ("hold", "岩點貓 DEV"),
    "redpoint-cat": ("redpoint", "紅點貓 DEV"),
}
SIZES = ("180", "192", "512", "maskable-192", "maskable-512")


def chunk(tag, data):
    return (struct.pack(">I", len(data)) + tag + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))


def read_png(path):
    data = path.read_bytes()
    if not data.startswith(PNG_SIGNATURE):
        raise ValueError(f"{path}: not a PNG")
    at = len(PNG_SIGNATURE)
    compressed = bytearray()
    params = None
    while at < len(data):
        n = struct.unpack_from(">I", data, at)[0]
        tag = data[at + 4:at + 8]
        body = data[at + 8:at + 8 + n]
        at += 12 + n
        if tag == b"IHDR":
            params = struct.unpack(">IIBBBBB", body)
        elif tag == b"IDAT":
            compressed.extend(body)
        elif tag == b"IEND":
            break
    if not params:
        raise ValueError(f"{path}: missing IHDR")
    width, height, depth, kind, compression, filtering, interlace = params
    if depth != 8 or kind not in (2, 6) or compression or filtering or interlace:
        raise ValueError(f"{path}: unsupported PNG encoding {params}")
    channels = 3 if kind == 2 else 4
    stride = width * channels
    raw = zlib.decompress(bytes(compressed))
    if len(raw) != height * (stride + 1):
        raise ValueError(f"{path}: malformed image payload")

    output = bytearray(width * height * channels)
    previous = bytearray(stride)
    off = 0
    for y in range(height):
        mode = raw[off]
        off += 1
        row = raw[off:off + stride]
        off += stride
        decoded = bytearray(stride)
        for x, value in enumerate(row):
            a = decoded[x - channels] if x >= channels else 0
            b = previous[x]
            c = previous[x - channels] if x >= channels else 0
            if mode == 0:
                predictor = 0
            elif mode == 1:
                predictor = a
            elif mode == 2:
                predictor = b
            elif mode == 3:
                predictor = (a + b) // 2
            elif mode == 4:
                p = a + b - c
                da, db, dc = abs(p - a), abs(p - b), abs(p - c)
                predictor = a if da <= db and da <= dc else b if db <= dc else c
            else:
                raise ValueError(f"{path}: invalid PNG filter {mode}")
            decoded[x] = (value + predictor) & 255
        output[y * stride:(y + 1) * stride] = decoded
        previous = decoded
    return width, height, kind, output


def write_png(path, width, height, kind, pixels):
    channels = 3 if kind == 2 else 4
    stride = width * channels
    filtered = bytearray()
    for y in range(height):
        filtered.append(0)
        filtered.extend(pixels[y * stride:(y + 1) * stride])
    ihdr = struct.pack(">IIBBBBB", width, height, 8, kind, 0, 0, 0)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(PNG_SIGNATURE + chunk(b"IHDR", ihdr)
                     + chunk(b"IDAT", zlib.compress(filtered, 6))
                     + chunk(b"IEND", b""))


def add_dev_label(path, target):
    width, height, kind, pixels = read_png(path)
    if width != height or width not in (180, 192, 512):
        raise ValueError(f"{path}: unexpected icon dimensions")
    channels = 3 if kind == 2 else 4
    left, right = round(width * .27), round(width * .73)
    top, bottom = round(height * .65), round(height * .80)
    radius = max(3, round(width * .025))

    def dot(x, y, rgb):
        i = (y * width + x) * channels
        pixels[i:i + 3] = bytes(rgb)
        if channels == 4:
            pixels[i + 3] = 255

    # 標籤位於中心安全區，Android maskable 圓角裁切後仍會保留。
    for y in range(top, bottom):
        for x in range(left, right):
            cx = left + radius if x < left + radius else right - radius - 1 if x >= right - radius else x
            cy = top + radius if y < top + radius else bottom - radius - 1 if y >= bottom - radius else y
            if (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2:
                dot(x, y, (255, 180, 84))

    scale = max(1, min((bottom - top - 4) // 7, (right - left - 10) // 17))
    start_x = (width - 17 * scale) // 2
    start_y = top + (bottom - top - 7 * scale) // 2
    for ci, char in enumerate("DEV"):
        for dy, line in enumerate(FONT[char]):
            for dx, value in enumerate(line):
                if value == "#":
                    for py in range(start_y + dy * scale, start_y + (dy + 1) * scale):
                        for px in range(start_x + (ci * 6 + dx) * scale,
                                        start_x + (ci * 6 + dx + 1) * scale):
                            dot(px, py, (48, 32, 11))
    write_png(target, width, height, kind, pixels)


def update_html(path, cat, display_name):
    html = path.read_text(encoding="utf-8")
    base_name = "岩點貓" if cat == "hold-cat" else "紅點貓"
    changes = [
        (f"<title>{base_name}</title>", f"<title>{display_name}</title>"),
        (f'<meta name="application-name" content="{base_name}">',
         f'<meta name="application-name" content="{display_name}">'),
        (f'<meta name="apple-mobile-web-app-title" content="{base_name}">',
         f'<meta name="apple-mobile-web-app-title" content="{display_name}">'),
        ('<link rel="manifest" href="manifest.webmanifest">',
         '<link rel="manifest" href="manifest-dev.webmanifest">'),
    ]
    for before, after in changes:
        if html.count(before) != 1:
            raise ValueError(f"{path}: expected one instance of {before}")
        html = html.replace(before, after)

    # Safari 先看 Apple Touch Icon 而不是 manifest，必須在原始 HTML 就換掉。
    for relation, file in [("apple-touch-icon", f"{cat}-180.png"),
                           ("icon", f"{cat}-192.png")]:
        pattern = rf'<link rel="{relation}" href="[^"]+"[^>]*>'
        html, n = re.subn(pattern,
                          f'<link rel="{relation}" href="../icons/dev/{file}">',
                          html, count=1)
        if n != 1:
            raise ValueError(f"{path}: missing {relation}")
    path.write_text(html, encoding="utf-8")


def main(dist):
    for cat, (subdir, name) in APPS.items():
        for size in SIZES:
            filename = f"{cat}-{size}.png"
            add_dev_label(dist / "icons" / "cats" / filename,
                          dist / "icons" / "dev" / filename)

        manifest = dist / subdir / "manifest-dev.webmanifest"
        data = json.loads(manifest.read_text(encoding="utf-8"))
        data["name"] = name
        data["short_name"] = name
        for icon in data["icons"]:
            original = icon["src"]
            if not original.startswith("../icons/cats/"):
                raise ValueError(f"{manifest}: unexpected icon path {original}")
            icon["src"] = original.replace("../icons/cats/", "../icons/dev/", 1)
        manifest.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                            encoding="utf-8")
        update_html(dist / subdir / "index.html", cat, name)
        print(f"{subdir}: {name}, five DEV icons and standalone install metadata")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python3 tools/dev-app-icons.py dist")
    main(Path(sys.argv[1]))
