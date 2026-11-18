#!/usr/bin/env python3
"""Exercise the real index exporter against a tiny fixture SQLite database."""
import json
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

with tempfile.TemporaryDirectory() as directory:
    db = Path(directory) / "input.sqlite"
    out = Path(directory) / "result.json"
    con = sqlite3.connect(db)
    con.execute("""
      CREATE TABLE climbing_features (
        type TEXT, parentId INTEGER, tags TEXT, osmId INTEGER, name TEXT,
        nameRaw TEXT, lat REAL, lon REAL, routeCount INTEGER,
        countryCode TEXT, climbingTypes TEXT, osmType TEXT, hasImages INTEGER
      )
    """)
    def add(**kw):
        fields = ['type','parentId','tags','osmId','name','nameRaw','lat','lon',
                  'routeCount','countryCode','climbingTypes','osmType','hasImages']
        values = [kw.get(f) for f in fields]
        con.execute('INSERT INTO climbing_features VALUES (' + ','.join('?' for _ in fields) + ')', values)

    add(type='area', osmId=50, name='Sass de Bèita', osmType='relation')
    add(type='crag', osmId=100, name='Block 1', parentId=50, lon=11.99, lat=46.51,
        countryCode='it', routeCount=1, osmType='relation',
        tags=json.dumps({'climbing:url:thecrag': 'http://www.thecrag.com/en/climbing/test/area/123'}))
    add(type='crag', osmId=200, name='Block 2', parentId=50, lon=11.991, lat=46.51,
        countryCode='it', routeCount=2, osmType='relation',
        tags=json.dumps({'climbing:url:thecrag': 'https://thecrag.com.evil.example/area/123'}))
    add(type='crag', osmId=300, name='Block 3', parentId=50, lon=11.992, lat=46.51,
        countryCode='it', routeCount=1, osmType='relation')
    add(type='route', parentId=100, hasImages=1,
        tags=json.dumps({'wikimedia_commons':'File:Block1.jpg','wikimedia_commons:path':'0.2,0.8|0.5,0.1A'}))
    # Older export hasImages=0 but numbered photo is still a real Topo.
    add(type='route', parentId=200, hasImages=0,
        tags=json.dumps({'wikimedia_commons:1':'File:Block2.jpg','wikimedia_commons:1:path':'0.1,0.8|0.5,0.1B'}))
    add(type='route', parentId=200, hasImages=1,
        tags=json.dumps({'wikimedia_commons':'File:Block2.jpg'}))
    add(type='route', parentId=300, hasImages=1,
        tags=json.dumps({'wikimedia_commons:path':'0.1,0.1|0.5,0.5'}))
    con.commit()
    con.close()
    proc = subprocess.run(
        [sys.executable, str(Path(__file__).with_name('openclimbing-index.py')), str(db), str(out)],
        capture_output=True, text=True,
    )
    if proc.returncode:
        raise RuntimeError(proc.stderr)
    result = json.loads(out.read_text(encoding='utf8'))
    crags = {c['id']: c for c in result['crags']}
    assert set(crags) == {100, 200}, crags
    assert crags[100]['tc'] == 1, crags
    assert crags[200]['tc'] == 1, crags
    assert crags[100]['ap'] == ['Sass de Bèita'], crags
    assert crags[200]['ap'] == ['Sass de Bèita'], crags
    assert crags[100]['tcu'] == 'https://www.thecrag.com/en/climbing/test/area/123', crags
    assert 'tcu' not in crags[200], crags
    assert result['total']['topoRoutes'] == 2, result
print('OpenClimbing index: numbered photos and hasImages=0 are retained')
