#!/usr/bin/env python3
"""不連網：用假的 OSM／Commons 回應跑 tools/openclimbing-previews.py 的 build，檢查輸出的尺寸、格子與署名。"""
import importlib.util, io, json, sys, tempfile
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print('沒有 Pillow，跳過'); sys.exit(0)

spec = importlib.util.spec_from_file_location('ocp', Path(__file__).with_name('openclimbing-previews.py'))
ocp = importlib.util.module_from_spec(spec); spec.loader.exec_module(ocp)

assert ocp.spdx('CC BY-SA 4.0') == 'CC-BY-SA-4.0' and ocp.spdx('CC0') == 'CC0-1.0' and ocp.spdx('All rights reserved') is None
assert ocp.parse_path('0.1,0.2B|0.5,0.6P') == [(0.1, 0.2), (0.5, 0.6)] and ocp.parse_path('2,0|0,0') == []
assert ocp.focus_of([[(0.2, 0.2), (0.4, 0.6)]]) == (0.30000000000000004, 0.4) or abs(ocp.focus_of([[(0.2, 0.2), (0.4, 0.6)]])[0] - 0.3) < 1e-9

def jpeg(w, h, color):
    buf = io.BytesIO(); Image.new('RGB', (w, h), color).save(buf, 'JPEG'); return buf.getvalue()

photos = {'File:A.jpg': [[(0.1, 0.1), (0.2, 0.9)], [(0.5, 0.1), (0.6, 0.9)]], 'File:B.jpg': [[(0.5, 0.5), (0.6, 0.6)]], 'File:C.jpg': [[(0.5, 0.5), (0.6, 0.6)]]}
info = {t: {'url': 'x/' + t, 'license': 'CC-BY-SA-4.0', 'artist': 'tester', 'page': 'p/' + t} for t in ('File:A.jpg', 'File:B.jpg')}   # C 授權不合：不收
ocp.crag_photos = lambda rel: photos
ocp.commons_info = lambda titles: info
ocp.get = lambda url, binary=False, tries=4: jpeg(1600, 900, (200, 80, 40)) if url.endswith('A.jpg') else jpeg(900, 1600, (40, 80, 200))

with tempfile.TemporaryDirectory() as d:
    res = ocp.build(123, d)
    assert res == {'thumb': 'thumb.jpg', 'preview': 'preview.jpg', 'w': 720, 'h': 540 + 90, 'n': 2}, res
    assert Image.open(Path(d) / 'preview.jpg').size == (720, 630)
    assert Image.open(Path(d) / 'thumb.jpg').size == (240, 180)
    credits = json.loads((Path(d) / 'credits.json').read_text(encoding='utf-8'))['photos']
    assert [c['title'] for c in credits] == ['File:A.jpg', 'File:B.jpg'] and [c['tile'] for c in credits] == [0, 1], credits   # 線最多的在最前（入口）
    ocp.commons_info = lambda titles: {}
    assert ocp.build(124, d + '/none') is None   # 沒有可用授權的照片：不輸出
print('ok')
