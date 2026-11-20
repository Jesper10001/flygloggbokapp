# Kontroll av Airport Info-raderna: varje uppgift måste ha ett citat som står ordagrant i källtexten
# (AIP: aip/<ICAO>.txt; hemsidor: hämtad sida). Uppgifter vars citat inte hittas tas bort. Ingen falsk info.
# Kör: python3 -I verify-info.py raw/aip-*.json  → verified/<samma namn> + rapport
import json, sys, os, re, glob
def norm(s): return re.sub(r'\s+', ' ', (s or '')).strip().lower()
os.makedirs('verified', exist_ok=True)
tot = kept = 0; dropped = []
for f in sys.argv[1:]:
    out = []
    for a in json.load(open(f, encoding='utf8')):
        src = norm(open(f"aip/{a['icao']}.txt", encoding='utf8').read()) if os.path.exists(f"aip/{a['icao']}.txt") else ''
        ok = lambda q: bool(q) and norm(q) in src
        r = {'icao': a['icao'], 'source': a.get('source', '')}
        for k in ('ppr', 'fuel', 'hours', 'email', 'website'):
            v = a.get(k)
            if not v: continue
            tot += 1
            if ok(v.get('quote')) or (k == 'ppr' and v.get('status') == 'unknown'): r[k] = v; kept += 1
            else: dropped.append(f"{a['icao']} {k}: {v.get('quote','')[:60]}")
        for k in ('contacts', 'good_to_know'):
            lst = []
            for v in a.get(k) or []:
                tot += 1
                if ok(v.get('quote')): lst.append(v); kept += 1
                else: dropped.append(f"{a['icao']} {k}: {v.get('quote','')[:60]}")
            if lst: r[k] = lst
        out.append(r)
    json.dump(out, open(os.path.join('verified', os.path.basename(f)), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
print(f'{kept}/{tot} uppgifter med citat som finns i källan')
for d in dropped: print('  bort:', d)
