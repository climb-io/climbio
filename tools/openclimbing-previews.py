#!/usr/bin/env python3
"""替 OpenClimbing 岩場自動做「世界」用的縮圖 thumb.jpg 與下載前先看的合成預覽圖 preview.jpg，格式、尺寸跟 Studio 發佈的 Guidebook 完全一樣。

用法：
  python3 tools/openclimbing-previews.py [--out 輸出資料夾] [--limit N] [--ids 123,456] [--sleep 0.4] [--force]

輸入：data/openclimbing/index.json（tools/openclimbing-index.py 產生的索引，挑 tc > 0、也就是有候選 Topo 照片的岩場）。
每個岩場：OSM 公開 API 讀路線和照片欄位 → Wikimedia Commons 查照片授權與縮圖網址（只收 CC 與公眾領域，同 sourcekit/openclimbing-read.js 的規則）
→ 入口照片（線最多的那張）做 720×540 的 preview 上半、240×180 的 thumb；每張照片的小圖 120×90 排成每列 6 格（最多 24 格）。
尺寸與版面照 sourcekit/preview-layout.js：PREVIEW_W 720、COVER_H 540、TILE 120×90、每列 6 格；THUMB 240×180。
裁切：入口照片不是 4:3 時，以這張照片所有 Topo 線的範圍中心裁，不把線裁掉。

輸出（每個岩場一個資料夾 <輸出>/<OSM relation id>/）：
  preview.jpg、thumb.jpg    影像
  credits.json              每張照片的標題、作者、授權、Commons 頁面、在預覽圖上的格子（CC BY 要署名，上傳時一起放）
另有 <輸出>/index.json：{ id: { thumb, preview, w, h, n } }，給之後合進索引或上傳用。
已經做過的岩場預設跳過（--force 重做）；沒有可用授權照片的岩場不輸出。
這支腳本只寫本機資料夾，不上傳任何地方。資料來源：路線 ODbL（© OpenStreetMap contributors）；照片逐張授權，見 credits.json。
"""
import argparse, io, json, math, os, re, sys, time, urllib.parse, urllib.request
from PIL import Image

OSM = 'https://api.openstreetmap.org/api/0.6'
COMMONS = 'https://commons.wikimedia.org/w/api.php'
UA = 'climbio-openclimbing-previews/1 (+https://github.com/climb-io/climbio)'
PREVIEW_W, COVER_H, TILE_W, TILE_H, TILE_COLS, TILE_MAX = 720, 540, 120, 90, 6, 24
THUMB_W, THUMB_H = 240, 180
SRC_WIDTH = 1200   # Commons 縮圖寬度：入口照片 720 寬的 1.6 倍，裁切後仍清楚
PHOTO_KEY = re.compile(r'^wikimedia_commons(:\d+)?$', re.I)


def get(url, binary=False, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                data = r.read()
            return data if binary else json.loads(data)
        except Exception as e:  # 429、逾時：等一下再試
            if i == tries - 1:
                raise
            time.sleep(2 ** i * 1.5)


def spdx(name):
    s = (name or '').strip()
    if re.match(r'^CC0', s, re.I): return 'CC0-1.0'
    if re.match(r'^(public domain|pd)', s, re.I): return 'LicenseRef-PD'
    m = re.match(r'^CC[ -]BY(?:[ -]SA)?[ -](\d\.\d)(?:[ -]\w+)?$', s, re.I)
    if m: return 'CC-BY%s-%s' % ('-SA' if re.search('SA', s, re.I) else '', m.group(1))
    return None


def parse_path(path):
    pts = []
    parts = str(path or '').split('|')
    if len(parts) < 2: return []
    for seg in parts:
        m = re.match(r'^([+-]?(?:\d+(?:\.\d*)?|\.\d+)),([+-]?(?:\d+(?:\.\d*)?|\.\d+))[BAPSU]?:?$', seg.strip(), re.I)
        if not m: return []
        x, y = float(m.group(1)), float(m.group(2))
        if not (0 <= x <= 1 and 0 <= y <= 1): return []
        pts.append((x, y))
    return pts


def fetch_many(kind, ids):
    out = []
    ids = sorted(set(ids))
    for i in range(0, len(ids), 500):
        part = ids[i:i + 500]
        out += get('%s/%s.json?%s=%s' % (OSM, kind, kind, ','.join(map(str, part))))['elements']
    return out


def crag_photos(rel_id):
    """岩場（含它底下的子關係）所有路線上的照片：{標題: [線的點...]}"""
    first = get('%s/relation/%d.json' % (OSM, rel_id))['elements'][0]
    rels, level, seen = [], [first], set()
    for _ in range(3):
        fresh = [r for r in level if r['id'] not in seen]
        for r in fresh: seen.add(r['id'])
        rels += fresh
        child = [m['ref'] for r in fresh for m in r.get('members', []) if m['type'] == 'relation']
        level = fetch_many('relations', child) if child else []
        if not level or len(rels) > 60: break
    node_ids = [m['ref'] for r in rels for m in r.get('members', []) if m['type'] == 'node']
    photos = {}
    for n in fetch_many('nodes', node_ids):
        tags = n.get('tags') or {}
        if not re.match(r'^route(_bottom)?$', tags.get('climbing', '')): continue
        for k, v in tags.items():
            if PHOTO_KEY.match(k) and re.match(r'^File:', v, re.I):
                pts = parse_path(tags.get(k + ':path'))
                if pts: photos.setdefault(re.sub(r'^file:', 'File:', v.strip(), flags=re.I).replace('_', ' '), []).append(pts)   # Commons 回傳的標題底線已換成空格，不換就對不上
    return photos


def commons_info(titles):
    info = {}
    titles = sorted(set(titles))
    for i in range(0, len(titles), 40):
        q = urllib.parse.urlencode({'action': 'query', 'format': 'json', 'prop': 'imageinfo', 'iiprop': 'url|size|mime|extmetadata',
                                    'iiurlwidth': SRC_WIDTH, 'titles': '|'.join(titles[i:i + 40])})
        for p in get('%s?%s' % (COMMONS, q)).get('query', {}).get('pages', {}).values():
            ii = (p.get('imageinfo') or [None])[0]
            if not ii: continue
            meta = ii.get('extmetadata') or {}
            lic = spdx((meta.get('LicenseShortName') or {}).get('value'))
            if not lic or not re.match(r'^image/(jpeg|png)', ii.get('mime', '')): continue
            artist = re.sub(r'\s+', ' ', re.sub(r'<[^>]*>', '', str((meta.get('Artist') or {}).get('value', '')))).strip()
            info[p['title']] = {'url': ii.get('thumburl') or ii['url'], 'license': lic, 'artist': artist, 'page': ii.get('descriptionurl', '')}
    return info


def cover(img, w, h, focus):
    """填滿 w×h；超出的部分以 focus（0..1 的中心點）為中心裁掉"""
    k = max(w / img.width, h / img.height)
    big = img.resize((max(w, round(img.width * k)), max(h, round(img.height * k))), Image.LANCZOS)
    x = min(max(round(focus[0] * big.width - w / 2), 0), big.width - w)
    y = min(max(round(focus[1] * big.height - h / 2), 0), big.height - h)
    return big.crop((x, y, x + w, y + h))


def focus_of(lines):
    pts = [p for line in lines for p in line]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2)


def build(rel_id, out_dir):
    photos = crag_photos(rel_id)
    if not photos: return None
    info = commons_info(photos.keys())
    order = sorted((t for t in photos if t in info), key=lambda t: (-len(photos[t]), t))[:TILE_MAX]
    if not order: return None
    imgs = []
    for t in order:
        try:
            imgs.append((t, Image.open(io.BytesIO(get(info[t]['url'], binary=True))).convert('RGB')))
        except Exception as e:
            print('  跳過照片', t, e, file=sys.stderr)
    if not imgs: return None
    rows = math.ceil(len(imgs) / TILE_COLS)
    sheet = Image.new('RGB', (PREVIEW_W, COVER_H + rows * TILE_H), (232, 237, 242))
    credits = []
    for i, (t, im) in enumerate(imgs):
        f = focus_of(photos[t])
        if i == 0: sheet.paste(cover(im, PREVIEW_W, COVER_H, f), (0, 0))
        sheet.paste(cover(im, TILE_W, TILE_H, f), ((i % TILE_COLS) * TILE_W, COVER_H + (i // TILE_COLS) * TILE_H))
        credits.append({'title': t, 'artist': info[t]['artist'], 'license': info[t]['license'], 'page': info[t]['page'], 'tile': i, 'lines': len(photos[t])})
    thumb = cover(imgs[0][1], THUMB_W, THUMB_H, focus_of(photos[imgs[0][0]]))
    os.makedirs(out_dir, exist_ok=True)
    sheet.save(os.path.join(out_dir, 'preview.jpg'), 'JPEG', quality=82, optimize=True, progressive=True)
    thumb.save(os.path.join(out_dir, 'thumb.jpg'), 'JPEG', quality=84, optimize=True, progressive=True)
    json.dump({'osm': rel_id, 'attribution': '路線資料 © OpenStreetMap contributors（ODbL）；照片見各張授權', 'photos': credits},
              open(os.path.join(out_dir, 'credits.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    return {'thumb': 'thumb.jpg', 'preview': 'preview.jpg', 'w': sheet.width, 'h': sheet.height, 'n': len(imgs)}


def apply_index(path, out):
    """索引只是「有候選 Topo 標籤」；這裡依實際做得出圖的結果過濾，紅點貓只放真的有照片的岩場"""
    doc = json.load(open(path, encoding='utf-8'))
    index = json.load(open(os.path.join(out, 'index.json'), encoding='utf-8'))
    before = len(doc['crags'])
    crags = [dict(c, pv=1) for c in doc['crags'] if str(c['id']) in index]
    by = {}
    for c in crags:
        e = by.setdefault(c.get('cc') or '??', {'cc': c.get('cc') or '??', 'crags': 0, 'topoRoutes': 0, 'routes': 0})
        e['crags'] += 1; e['topoRoutes'] += c['tc']; e['routes'] += c['rc']
    doc.update(crags=crags, countries=sorted(by.values(), key=lambda e: -e['topoRoutes']),
               total={'crags': len(crags), 'topoRoutes': sum(c['tc'] for c in crags)})
    json.dump(doc, open(path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('索引 %d → %d 個岩場（移除 %d 個沒有可用照片的）' % (before, len(crags), before - len(crags)))


def main():
    for f in (sys.stdout, sys.stderr): f.reconfigure(encoding='utf-8')   # Windows 主控台預設 cp1252，中文輸出會當掉
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='openclimbing-previews')
    ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--ids', default='')
    ap.add_argument('--sleep', type=float, default=0.4)
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--apply-index', action='store_true', help='依 <輸出>/index.json 改寫 data/openclimbing/index.json：移除沒有可用照片的岩場、其餘加 pv:1（有預覽圖）、重算國家統計')
    a = ap.parse_args()
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'openclimbing', 'index.json')
    crags = json.load(open(root, encoding='utf-8'))['crags']
    want = [int(x) for x in a.ids.split(',') if x.strip()]
    todo = [c for c in crags if (c['id'] in want if want else c.get('tc', 0) > 0)]
    todo.sort(key=lambda c: -c.get('tc', 0))
    if a.limit: todo = todo[:a.limit]
    if a.apply_index:
        return apply_index(root, a.out)
    os.makedirs(a.out, exist_ok=True)
    idx_path = os.path.join(a.out, 'index.json')
    index = json.load(open(idx_path, encoding='utf-8')) if os.path.exists(idx_path) else {}
    done = skipped = 0
    for i, c in enumerate(todo, 1):
        key = str(c['id'])
        if key in index and not a.force: continue
        try:
            res = build(c['id'], os.path.join(a.out, key))
        except Exception as e:
            print('[%d/%d] %s 失敗：%s' % (i, len(todo), key, e), file=sys.stderr); continue
        if res: index[key] = res; done += 1
        else: skipped += 1
        print('[%d/%d] %s %s' % (i, len(todo), key, '%d 張' % res['n'] if res else '沒有可用授權的照片'), flush=True)
        json.dump(index, open(idx_path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        time.sleep(a.sleep)
    print('完成 %d、沒照片 %d、索引共 %d 筆' % (done, skipped, len(index)))


if __name__ == '__main__':
    main()
