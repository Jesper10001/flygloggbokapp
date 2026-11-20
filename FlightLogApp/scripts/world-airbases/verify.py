# Kontroll av sökgruppernas rader mot källorna de anger (2026-11-20).
# Varje rad måste ha "urls". Skriptet hämtar sidorna (Wikipedia som wikitext, annars som text), och:
#   - raden behålls bara om basnamnet (eller ICAO-koden) står på någon av sidorna,
#   - varje förband och flygplanstyp som inte står på någon av sidorna tas bort ur raden; på en sida som inte handlar
#     om just basen (en lista, ett flygvapens översikt) måste posten stå nära basnamnet (inom WINDOW tecken),
#     så att en typ inte godkänns bara för att den nämns någon annanstans på sidan,
#   - en rad utan kvarvarande förband och flygplanstyper tas bort.
# Så kan inget som skrivits ur minnet slinka igenom, oavsett vad agenterna påstår.
# Kör: python3 -I verify.py <raw-mapp> <ut-mapp> <cache-mapp>
import json, sys, os, re, glob, time, hashlib, unicodedata, subprocess, urllib.parse, html

raw_dir, out_dir, cache_dir = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out_dir, exist_ok=True)
os.makedirs(cache_dir, exist_ok=True)
UA = 'BladesBaseResearch/1.0 (open-data research)'

def norm(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    return ' '.join(re.sub(r'[^a-z0-9]+', ' ', s).split())

def get(url):
    """Sidans text (cachad). Wikipedia → wikitext (action=raw) + renderad text som reserv."""
    key = hashlib.sha1(url.encode()).hexdigest()
    path = os.path.join(cache_dir, key + '.txt')
    if os.path.exists(path):
        return open(path, encoding='utf8').read()
    texts = []
    u = urllib.parse.urlsplit(url)
    targets = [urllib.parse.urlunsplit((u.scheme, u.netloc, urllib.parse.quote(urllib.parse.unquote(u.path)), u.query, ''))]
    if u.netloc.endswith('wikipedia.org') and u.path.startswith('/wiki/'):
        title = urllib.parse.quote(urllib.parse.unquote(u.path[len('/wiki/'):]), safe='')  # å/é i adressen
        base = f'{u.scheme}://{u.netloc}/w/index.php?title={title}'
        targets = [base + '&action=raw', base + '&action=render']
    for t in targets:
        # curl i stället för urllib: macOS-Pythons SSL saknar certifikatkedjan här
        for attempt in range(4):
            r = subprocess.run(['curl', '-sL', '--max-time', '30', '-A', UA, '-w', '\n%{http_code}', t], capture_output=True)
            body, _, code = r.stdout.decode('utf8', 'ignore').rpartition('\n')
            if code == '429':
                time.sleep(15 * (attempt + 1)); continue
            if code.startswith('2'):
                texts.append(body)
            break
        time.sleep(1.0)
    txt = html.unescape(re.sub(r'<[^>]+>', ' ', '\n'.join(texts)))
    if txt.strip():
        open(path, 'w', encoding='utf8').write(txt)
    return txt

GENERIC = set('''air base force station naval navy field airfield army marine marines corps afb nas mcas ab raf
international airport aeroport aeropuerto aeroporto camp fort joint the of de la del do da di du des le les
military aviation aerodrome aerodromo base aerea aerienne aereo aerienne heliport national guard reserve
facility facilities center centre jrb ars ang nab naf rnas cfb jasdf jmsdf jgsdf rokaf paf iaf saaf tni au
group groups regiment regiments sfb arb jngb jbsa sqn squadron wing
'''.split())

def variants(row):
    # Huvudnamnet och varje parentes som eget alternativ: "Soto Cano Air Base (Palmerola)" → två namn
    b = row.get('base') or ''
    return [re.sub(r'\(.*?\)', ' ', b)] + re.findall(r'\((.*?)\)', b)

WINDOW = 1200

def base_toks(row, name=None):
    return [t for t in norm(name if name is not None else variants(row)[0]).split() if t not in GENERIC and len(t) >= 3]

def about_base(url, row):
    # Sidan handlar om basen om sidtiteln innehåller basens särskiljande ord
    title = norm(urllib.parse.unquote(urllib.parse.urlsplit(url).path.rsplit('/', 1)[-1]))
    return any((t := base_toks(row, v)) and all(w in title.split() for w in t) for v in variants(row))

def near_base(row, page):
    # Utsnitt av sidan runt varje förekomst av basens ankarord (längsta särskiljande ordet, eller ICAO-koden)
    anchors = [max(t, key=len) for v in variants(row) if (t := base_toks(row, v))] or [norm(variants(row)[0])]
    if row.get('icao'):
        anchors.append(row['icao'].lower())
    parts = []
    for a in anchors:
        if not a:
            continue
        for m in re.finditer(r'\b' + re.escape(a) + r'\b', page):
            parts.append(page[max(0, m.start() - WINDOW): m.end() + WINDOW])
    return ' ' + ' … '.join(parts) + ' '

def base_ok(row, page):
    if row.get('icao') and re.search(r'\b' + re.escape(row['icao'].lower()) + r'\b', page):
        return True
    for v in variants(row):
        toks = base_toks(row, v)
        if toks and all(re.search(r'\b' + re.escape(t) + r'\b', page) for t in toks):
            return True
        if not toks and norm(v) and f' {norm(v)} ' in page:
            return True
    return False

def item_ok(item, page):
    n = norm(item)
    if not n:
        return False
    if n in page:
        return True
    # Flygplanstyp: modellkärnan (t.ex. "f 16", "c 130", "mi 17", "aw139", "j 20")
    m = re.search(r'\b([a-z]{1,4}) ?(\d{1,4}[a-z]{0,3})\b', n)
    if m and (f'{m.group(1)} {m.group(2)}' in page or f'{m.group(1)}{m.group(2)}' in page):
        return True
    # Förband / namngiven typ: alla särskiljande ord, varav minst ett siffer- eller ovanligt ord
    toks = [t for t in n.split() if len(t) >= 2 and t not in GENERIC and t not in ('no', 'sqn', 'squadron', 'wing', 'group', 'regiment', 'brigade', 'flight', 'unit', 'and')]
    return bool(toks) and all(re.search(r'\b' + re.escape(t) + r'\b', page) for t in toks)

files = sorted(f for f in glob.glob(os.path.join(raw_dir, '*.json')))
report, rejected = [], []
for f in files:
    rows = json.load(open(f, encoding='utf8'))
    kept, stats = [], {'rader': len(rows), 'utan_urls': 0, 'bas_saknas': 0, 'tomma': 0, 'borttagna_poster': 0}
    for row in rows:
        urls = row.get('urls') or []
        if not urls:
            stats['utan_urls'] += 1; rejected.append({'fil': os.path.basename(f), 'skäl': 'utan urls', 'rad': row}); continue
        page = ' ' + norm(' '.join(get(u) for u in urls)) + ' '
        # Text där förband/typer får hittas: hela sidor som handlar om basen, annars bara närheten av basnamnet
        own = ' '.join(norm(get(u)) for u in urls if about_base(u, row))
        scope = ' ' + own + ' ' + near_base(row, ' ' + norm(' '.join(get(u) for u in urls if not about_base(u, row))) + ' ') + ' '
        if not base_ok(row, page):
            stats['bas_saknas'] += 1; rejected.append({'fil': os.path.basename(f), 'skäl': 'basen står inte på sidan', 'rad': row}); continue
        units = [u for u in row.get('units') or [] if item_ok(u, scope)]
        aircraft = [a for a in row.get('aircraft') or [] if item_ok(a, scope)]
        dropped = (len(row.get('units') or []) - len(units)) + (len(row.get('aircraft') or []) - len(aircraft))
        stats['borttagna_poster'] += dropped
        if not units and not aircraft:
            stats['tomma'] += 1; rejected.append({'fil': os.path.basename(f), 'skäl': 'inga förband/typer på sidan', 'rad': row}); continue
        kept.append({**row, 'units': units, 'aircraft': aircraft})
    json.dump(kept, open(os.path.join(out_dir, os.path.basename(f)), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    report.append((os.path.basename(f), len(kept), stats))
json.dump(rejected, open(os.path.join(out_dir, '_rejected.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
tot_in = sum(s['rader'] for _, _, s in report); tot_ok = sum(k for _, k, _ in report)
for name, k, s in report:
    print(f"{name:26} {k:3}/{s['rader']:<3} kvar  (utan urls {s['utan_urls']}, bas ej på sidan {s['bas_saknas']}, tomma {s['tomma']}, poster bort {s['borttagna_poster']})")
print(f'TOTALT {tot_ok}/{tot_in} rader godkända')
