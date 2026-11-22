#!/usr/bin/env python3
"""Build the homepage's 1200×630 social JPEG from the approved logo and real homepage photo.

Usage: python3 tools/social-cover.py dist
Dependencies: Pillow and CairoSVG, installed by the deployment workflow.
Only writes the built artifact; it does not edit source photos or the official logo.
"""
from __future__ import annotations

import io
import math
import sys
from pathlib import Path

try:
    import cairosvg
except (ImportError, OSError):  # Windows 沒有 cairo：改用 tools/svg-png.mjs（Playwright Chromium）
    cairosvg = None
from PIL import Image, ImageDraw, ImageFont, ImageOps

WIDTH, HEIGHT = 1200, 630
OUTPUT = "social/climbio-home.jpg"


def svg_png(path: Path, width: int, height: int) -> bytes:
    if cairosvg:
        return cairosvg.svg2png(url=str(path), output_width=width, output_height=height)
    import subprocess, tempfile
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp) / "logo.png"
        subprocess.run(["node", str(Path(__file__).with_name("svg-png.mjs")), str(path), str(width), str(height), str(out)],
                       check=True, timeout=120)
        return out.read_bytes()


def build(root: Path) -> Path:
    photo_path = root / "demo/reel/crag-guidebook.webp"
    wordmark_path = root / "icons/brand/climbio-horizontal-dark.svg"
    output = root / OUTPUT

    photo = Image.open(photo_path).convert("RGB")
    photo = ImageOps.fit(photo, (WIDTH, HEIGHT), method=Image.Resampling.LANCZOS,
                         centering=(0.5, 0.5)).convert("RGBA")
    shade = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    pixels = shade.load()
    for x in range(WIDTH):
        t = x / (WIDTH - 1)
        a = int(40 + 202 / (1 + math.exp(-11 * (t - .51))))
        for y in range(HEIGHT):
            pixels[x, y] = (8, 24, 19, a)
    image = Image.alpha_composite(photo, shade)

    # Render the approved SVG verbatim, including the original wordmark shapes.
    data = svg_png(wordmark_path, 478, 131)
    logo = Image.open(io.BytesIO(data)).convert("RGBA")
    image.alpha_composite(logo, (700, 204))

    draw = ImageDraw.Draw(image)
    try:
        face = ImageFont.truetype("DejaVuSans.ttf", 23)
    except OSError:
        face = ImageFont.load_default()
    draw.text((713, 360), "CLIMB  ·  SHARE  ·  EXPLORE",
              font=face, fill=(231, 240, 233))
    draw.rectangle((0, 620, WIDTH // 2 - 1, HEIGHT - 1), fill="#B6F000")
    draw.rectangle((WIDTH // 2, 620, WIDTH - 1, HEIGHT - 1), fill="#0FADEA")

    output.parent.mkdir(parents=True, exist_ok=True)
    image.convert("RGB").save(output, "JPEG", quality=83, optimize=True,
                              progressive=True, subsampling=0)
    with Image.open(output) as saved:
        if saved.size != (WIDTH, HEIGHT) or saved.format != "JPEG":
            raise RuntimeError(f"Invalid generated social image: {output}")
    print(f"Social preview: {output} ({output.stat().st_size} bytes)")
    return output


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python3 tools/social-cover.py dist")
    build(Path(sys.argv[1]))
