# Hämtar flygplatser, helipads, heliports och oljeplattformar (med OSM-taggar) ur Overture Maps base/infrastructure
# (OSM-härlett, ODbL) → scripts/osm-data/classify/ov/<fil>.json, en fil i taget så att det går att köra om efter
# ett avbrott. Sammanfogas till scripts/osm-data/classify/ov_aero.json. Används av build-airport-subtypes.mjs.
# Kräver duckdb (pip install duckdb i en venv). Kör: python3 scripts/fetch-overture-aero.py [--reverse]
import duckdb, json, os, sys
REL = 's3://overturemaps-us-west-2/release/2026-10-21.0/theme=base/type=infrastructure'
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'osm-data', 'classify', 'ov'); os.makedirs(OUT, exist_ok=True)
KEEP = ['aerodrome:type', 'aerodrome', 'sport', 'operator', 'military_service', 'military', 'aerodrome:use', 'landuse', 'icao', 'faa', 'ref',
        'local_ref', 'iata', 'gps_code', 'location', 'level', 'building', 'man_made', 'height', 'surface', 'name', 'access', 'ultralight', 'gliding']
con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs; INSTALL spatial; LOAD spatial; SET s3_region='us-west-2'; SET enable_http_metadata_cache=true;")
files = [r[0] for r in con.execute(f"SELECT file FROM glob('{REL}/*')").fetchall()]
print(len(files), 'filer', flush=True)
# --reverse: en andra arbetare tar filerna bakifrån (hoppar över dem den första redan gjort).
order = list(enumerate(files))
if '--reverse' in sys.argv: order.reverse()
for i, f in order:
    name = os.path.basename(f) + '.json'
    dst = os.path.join(OUT, name)
    if os.path.exists(dst): continue
    rows = con.execute(f"""SELECT class, names.primary, level, height, source_tags,
        ST_Y(ST_Centroid(geometry)), ST_X(ST_Centroid(geometry))
        FROM read_parquet('{f}')
        WHERE (subtype='airport' AND class NOT IN ('taxiway','apron','airport_gate','taxilane','stopway','runway'))
           OR class ILIKE '%platform%' OR class ILIKE '%offshore%' OR element_at(source_tags, 'man_made')[1]='offshore_platform'""").fetchall()
    out = []
    for c, n, lv, h, tags, lat, lon in rows:
        t = {k: v for k, v in (tags or {}).items() if k in KEEP}
        out.append({'c': c, 'n': n, 'lv': lv, 'h': h, 'lat': round(lat, 6), 'lon': round(lon, 6), 't': t})
    json.dump(out, open(dst + '.tmp', 'w')); os.replace(dst + '.tmp', dst)
    print(f'{i+1}/{len(files)} {name}: {len(out)}', flush=True)
allr = []
for n in sorted(os.listdir(OUT)):
    if n.endswith('.json'): allr += json.load(open(os.path.join(OUT, n)))
json.dump(allr, open(os.path.join(HERE, 'osm-data', 'classify', 'ov_aero.json'), 'w'))
print('KLART', len(allr), flush=True)
