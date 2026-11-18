#!/usr/bin/env python3
"""從 OpenClimbing 官方 SQLite 匯出產生紅點貓「世界」用的精簡 OpenClimbing 索引。

用法：python3 tools/openclimbing-index.py <openclimbing.sqlite> [輸出.json]

輸入：https://openclimbing.org/export 下載的 SQLite（約 60 MB）
輸出：精簡 JSON，列出帶有候選 Topo 線（wikimedia_commons:path）的岩場；tc 只是候選。
接著要跑 node tools/openclimbing-pack.mjs <同一個 SQLite>：驗證照片、寫 data/openclimbing/<id>/topo.json、把 tc 改成驗證過的數字。

每次 OpenClimbing 更新匯出時跑一次，把產生的 JSON 提交到 redpoint/。
紅點貓的「世界」讀這份 JSON 顯示 OpenClimbing 岩場的圖釘。
"""
import sqlite3, json, sys
from urllib.parse import urlsplit, urlunsplit

if len(sys.argv) < 2:
    print('用法：python3 tools/openclimbing-index.py <openclimbing.sqlite> [輸出.json]', file=sys.stderr)
    sys.exit(1)

db_path = sys.argv[1]
out_path = sys.argv[2] if len(sys.argv) > 2 else None  # 預設輸出到 stdout；指定 data/openclimbing/index.json

conn = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
conn.row_factory = sqlite3.Row

# ── 第一步：候選有線照片路線；不要以 hasImages=1 排除合法的照片 ──
# 過去用 tags LIKE '%wikimedia_commons:path%'：
# 1. 看不到 wikimedia_commons:1:path 等編號照片欄位
# 2. hasImages=0 的舊資料即使有實際路線線條，也被意外排除。
# 這一步只產生候選清單；照片的驗證（Commons、網址讀得到）在 tools/openclimbing-pack.mjs，不在紅點貓點小卡的時候做。
import re

PHOTO_PATH_KEY = re.compile(r'^wikimedia_commons(?::\d+)?:path$', re.I)

def thecrag_url(raw):
    if not isinstance(raw, str):
        return None
    try:
        url = urlsplit(raw.strip())
        port = url.port
    except ValueError:
        return None
    if (url.scheme not in ('http', 'https') or url.hostname not in ('thecrag.com', 'www.thecrag.com')
            or url.username or url.password or port not in (None, 443) or url.path in ('', '/')):
        return None
    return urlunsplit(('https', url.netloc, url.path, url.query, url.fragment))

def candidate_with_path(raw_tags):
    if not raw_tags:
        return False
    try:
        tags = json.loads(raw_tags) if isinstance(raw_tags, str) else raw_tags
    except (ValueError, TypeError):
        # 容錯舊資料，但不會在此把它標成「已驗證照片」
        return bool(re.search(r'wikimedia_commons(?::\d+)?:path', str(raw_tags), re.I))
    if not isinstance(tags, dict):
        return bool(re.search(r'wikimedia_commons(?::\d+)?:path', str(raw_tags), re.I))
    return any(
        PHOTO_PATH_KEY.fullmatch(k) and isinstance(v, str) and v.strip()
        and str(tags.get(k[:-5], '')).lower().startswith('file:')
        for k, v in tags.items()
    )

topo_counts = {}
for row in conn.execute("""
    SELECT parentId, tags
    FROM climbing_features
    WHERE type = 'route' AND tags LIKE '%wikimedia_commons%'
"""):
    if row['parentId'] is not None and candidate_with_path(row['tags']):
        topo_counts[row['parentId']] = topo_counts.get(row['parentId'], 0) + 1
print(f'有候選 Topo 標籤的 parent: {len(topo_counts)}', file=sys.stderr)

# ── 第二步：取出所有有 Topo 路線的 crag ──
crags = []
for row in conn.execute("""
    SELECT osmType, osmId, name, nameRaw, lat, lon,
           routeCount, countryCode, climbingTypes, parentId, tags
    FROM climbing_features
    WHERE type = 'crag'
"""):
    topo = topo_counts.get(row['osmId'], 0)
    if not topo:
        continue
    entry = {
        'id': row['osmId'],
        'n': row['name'] or row['nameRaw'] or None,
        'at': [round(row['lon'], 5), round(row['lat'], 5)],  # [經度, 緯度]
        'rc': row['routeCount'] or 0,
        'tc': topo,
        'cc': row['countryCode'] or None,
        '_pid': row['parentId'],
    }
    # 只有不是 relation 時才記 osmType（目前所有 crag 都是 relation）
    if row['osmType'] != 'relation':
        entry['t'] = row['osmType'][0]
    # 只有有值時才記 climbingTypes
    if row['climbingTypes']:
        entry['ct'] = row['climbingTypes']
    try:
        tags = json.loads(row['tags'] or '{}')
    except (ValueError, TypeError):
        tags = {}
    url = thecrag_url(tags.get('climbing:url:thecrag')) if isinstance(tags, dict) else None
    if url:
        entry['tcu'] = url
    crags.append(entry)
crags.sort(key=lambda c: -c['tc'])
print(f'有候選 Topo 標籤的岩場: {len(crags)}', file=sys.stderr)

# ── 第三步：建區域路徑 ──
parent_ids = {c['_pid'] for c in crags if c['_pid']}
areas = {}

to_fetch = parent_ids.copy()
for depth in range(6):
    if not to_fetch:
        break
    placeholders = ','.join('?' * len(to_fetch))
    for row in conn.execute(f"""
        SELECT osmId, name, nameRaw, parentId
        FROM climbing_features
        WHERE osmId IN ({placeholders}) AND type = 'area'
    """, list(to_fetch)):
        areas[row['osmId']] = {
            'name': row['name'] or row['nameRaw'],
            'pid': row['parentId'],
        }
    to_fetch = set()
    for a in areas.values():
        if a['pid'] and a['pid'] not in areas:
            to_fetch.add(a['pid'])

print(f'上層區域: {len(areas)}', file=sys.stderr)

def area_path(osm_id):
    path = []
    seen = set()
    while osm_id and osm_id in areas and osm_id not in seen:
        seen.add(osm_id)
        a = areas[osm_id]
        if a['name']:
            path.append(a['name'])
        osm_id = a.get('pid')
    path.reverse()
    return path or None  # None 不佔 JSON 空間

for c in crags:
    ap = area_path(c['_pid'])
    if ap:
        c['ap'] = ap
    del c['_pid']

# ── 第四步：國家統計 ──
by_cc = {}
for c in crags:
    cc = c['cc'] or '??'
    if cc not in by_cc:
        by_cc[cc] = {'crags': 0, 'topoRoutes': 0, 'routes': 0}
    by_cc[cc]['crags'] += 1
    by_cc[cc]['topoRoutes'] += c['tc']
    by_cc[cc]['routes'] += c['rc']
countries = sorted(
    [{'cc': cc, **s} for cc, s in by_cc.items()],
    key=lambda x: -x['topoRoutes']
)

print(f'\n國家統計：', file=sys.stderr)
for c in countries:
    print(f"  {c['cc']}: {c['crags']} 岩場, {c['topoRoutes']} topo / {c['routes']} 路線", file=sys.stderr)

# ── 輸出 ──
output = {
    'v': 1,
    'source': 'openclimbing.org',
    'generated': __import__('datetime').date.today().isoformat(),
    'countries': countries,
    'total': {
        'crags': len(crags),
        'topoRoutes': sum(c['tc'] for c in crags),
    },
    'crags': crags,
}

# 不縮排（省空間），但 ensure_ascii=False 讓名稱可讀
result = json.dumps(output, ensure_ascii=False, separators=(',', ':'))

if out_path:
    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(result)
    print(f'\n輸出到 {out_path}: {len(result) / 1024:.1f} KB', file=sys.stderr)
else:
    print(result)
    print(f'\n輸出: {len(result) / 1024:.1f} KB', file=sys.stderr)

conn.close()
