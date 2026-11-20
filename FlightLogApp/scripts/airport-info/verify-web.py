# Kontroll av hemsidesuppgifterna (små fält): varje uppgift måste ha url + citat, och citatet måste stå på sidan.
# Sidan hämtas (curl, cache i .cache-web/). Uppgifter som inte klarar det tas bort. Kör: python3 -I verify-web.py raw/web-*.json
import json, sys, os, re, html, hashlib, subprocess
def norm(s): return re.sub(r'\s+', ' ', html.unescape(s or '')).strip().lower()
os.makedirs('.cache-web', exist_ok=True); os.makedirs('verified', exist_ok=True)
def page(url):
    p = os.path.join('.cache-web', hashlib.sha1(url.encode()).hexdigest() + '.txt')
    if os.path.exists(p): return open(p, encoding='utf8').read()
    r = subprocess.run(['curl', '-sL', '--max-time', '30', '-A', 'Mozilla/5.0 (BladesAirportInfo)', url], capture_output=True)
    t = r.stdout.decode('utf8', 'ignore')
    t = re.sub(r'<script.*?</script>|<style.*?</style>', ' ', t, flags=re.S)
    t = norm(re.sub(r'<[^>]+>', ' ', t))
    open(p, 'w', encoding='utf8').write(t); return t
tot = kept = 0; dropped = []
for f in sys.argv[1:]:
    out = []
    for a in json.load(open(f, encoding='utf8')):
        r = {k: a[k] for k in ('key', 'name', 'status', 'as_of') if k in a}
        def ok(v): return bool(v.get('url')) and bool(v.get('quote')) and norm(v['quote']) in page(v['url'])
        for k in ('website', 'ppr', 'fuel', 'hours'):
            v = a.get(k)
            if not v: continue
            tot += 1
            if ok(v): r[k] = v; kept += 1
            else: dropped.append(f"{a['key']} {k}: {v.get('quote','')[:50]}")
        for k in ('contacts', 'good_to_know'):
            lst = [v for v in a.get(k) or [] if ok(v)]
            tot += len(a.get(k) or []); kept += len(lst)
            dropped += [f"{a['key']} {k}: {v.get('quote','')[:50]}" for v in a.get(k) or [] if v not in lst]
            if lst: r[k] = lst
        out.append(r)
    json.dump(out, open(os.path.join('verified', os.path.basename(f)), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
print(f'{kept}/{tot} uppgifter med citat som står på sidan')
for d in dropped: print('  bort:', d)
