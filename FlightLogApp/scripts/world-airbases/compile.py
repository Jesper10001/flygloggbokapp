# Sammanställer världens flygbaser (utanför Europa och Ryssland) ur verify.py:s utdata till samma format som
# Europa: CSV (alla länder) + XLSX med översikt och en flik per förbandsland. Koder och koordinater från OurAirports.
# ICAO-koder från sökningen används bara om OurAirports-flygplatsen ligger i rätt land och namnet stämmer
# (eller den är uttalat militär); annars matchas basen på namn i landet.
# Kör: <venv>/python -I compile.py <verify-utmapp> <oa-airports.csv> <utmapp>
import csv, json, sys, os, glob, re, unicodedata, difflib
from collections import defaultdict

src_dir, oa_path, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(out_dir, exist_ok=True)

oa = [r for r in csv.DictReader(open(oa_path, encoding='utf8')) if r['type'] != 'closed']
by_code = {}
for r in oa:
    for k in ('icao_code', 'gps_code', 'ident'):
        c = (r.get(k) or '').strip().upper()
        if c and c not in by_code:
            by_code[c] = r
by_country = defaultdict(list)
for r in oa:
    by_country[r['iso_country']].append(r)

GENERIC = set('''air base force station naval navy field airfield army marine marines corps afb nas mcas ab raf
international airport aeroport aeropuerto aeroporto camp fort joint the of de la del do da di du des le les
military aviation aerodrome aerodromo base aerea aerienne aereo heliport national guard reserve facility
center centre jrb ars ang nab naf cfb angb angs arb iap ars sfb jbsa group regiments regiment coast aerospace'''.split())
MIL = re.compile(r'\b(air ?base|afb|ab|air force|military|naval|nas|mcas|army|aaf|cfb|base aerea|base aerienne|air station|airbase|jasdf|jmsdf|jgsdf)\b')

def norm(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    return ' '.join(re.sub(r'[^a-z0-9]+', ' ', s).split())

ROMAN = {'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'}

def toks(name):
    # Romerska siffror räknas (King Abdullah I ≠ King Abdullah II)
    return [t for t in norm(name).split() if (t not in GENERIC and len(t) >= 3) or t in ROMAN]

def oa_text(r):
    return ' ' + norm(f"{r['name']} {r.get('municipality', '')} {r.get('keywords', '')}") + ' '

def variants(row):
    b = row.get('base') or ''
    return [re.sub(r'\(.*?\)', ' ', b)] + re.findall(r'\((.*?)\)', b)

EXACT = {'CN', 'KP', 'KR', 'JP', 'TW', 'MN', 'VN'}  # romaniserade namn ligger för nära varandra för stavningsmarginal
US_STATES = {'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA','colorado':'CO','connecticut':'CT',
 'delaware':'DE','florida':'FL','georgia':'GA','hawaii':'HI','idaho':'ID','illinois':'IL','indiana':'IN','iowa':'IA','kansas':'KS',
 'kentucky':'KY','louisiana':'LA','maine':'ME','maryland':'MD','massachusetts':'MA','michigan':'MI','minnesota':'MN',
 'mississippi':'MS','missouri':'MO','montana':'MT','nebraska':'NE','nevada':'NV','new hampshire':'NH','new jersey':'NJ',
 'new mexico':'NM','new york':'NY','north carolina':'NC','north dakota':'ND','ohio':'OH','oklahoma':'OK','oregon':'OR',
 'pennsylvania':'PA','rhode island':'RI','south carolina':'SC','south dakota':'SD','tennessee':'TN','texas':'TX','utah':'UT',
 'vermont':'VT','virginia':'VA','washington':'WA','west virginia':'WV','wisconsin':'WI','wyoming':'WY','puerto rico':'PR','guam':'GU'}

def fuzzy_in(w, words, exact=False):
    if exact:
        return w in words
    # Ordet finns (eller nästan: stavningsvarianter som Suweir/Suwayr) bland flygplatsens ord
    # Delord och likhet bara mellan ord på minst 5 tecken (annars matchar "and", "d" … allt)
    return any(w == x or (len(w) >= 5 and len(x) >= 5 and difflib.SequenceMatcher(None, w, x).ratio() >= 0.86) for x in words)

def code_ok(row, o):
    if o['iso_country'] != row.get('location'):
        return False
    # Koden godtas bara om flygplatsen ligger i rätt land OCH något av basens särskiljande ord står i dess namn/ort
    words = oa_text(o).split()
    return any(fuzzy_in(w, words, row.get('location') in EXACT) for v in variants(row) for w in toks(v))

# Värdflygplats för baser som namnmatchningen inte hittar, bekräftad av en oberoende källa (KML-filen med militärbaser
# 2026-11-20: dess punkt ligger 0–1,3 km från flygplatsen) — bara placering, inga förband/typer därifrån.
OVERRIDES = {'Stratton ANGB': 'KSCH', 'Kingsley Field ANGB': 'KLMT', 'Joint Base McGuire-Dix-Lakehurst': 'KWRI',
             'McEntire JNGB': 'KMMT', 'Chanjin Air Base': 'KP-0036'}
by_ident = {r['ident']: r for r in oa}

CIVIL_HOSTED = re.compile(r'\b(ANGB|ANGS|ANG|ARS|IAP|Air National Guard|Air Guard|Coast Guard)\b', re.I)

def match(row):
    if row.get('base') in OVERRIDES and OVERRIDES[row['base']] in by_ident:
        return by_ident[OVERRIDES[row['base']]], 'värdflygplats (bekräftad)'
    code = (row.get('icao') or '').strip().upper()
    if code and code in by_code and code_ok(row, by_code[code]):
        return by_code[code], 'kod'
    cands = by_country.get(row.get('location', ''), [])
    exact = row.get('location') in EXACT
    st = US_STATES.get(norm(row.get('region')))
    if row.get('location') == 'US' and st:   # rätt delstat (Truax Field finns i både WI och TX)
        cands = [r for r in cands if r.get('iso_region') == f'US-{st}'] or cands
    # 1) Alla särskiljande ord i flygplatsens NAMN; 2) i namn + ort + nyckelord. Varje steg prövar huvudnamnet och
    #    parentesen. Militär flygplats vinner vid lika, sedan större flygplats.
    if CIVIL_HOSTED.search(row.get('base') or ''):
        # Stadens flygplats: alla ord i namn/ort/nyckelord; orten stämmer helst, sedan störst (Memphis = "Frederick W. Smith
        # International", Fargo = "Hector International", Battle Creek = Kellogg Field, inte Kalamazoo/Battle Creek)
        rank = {'large_airport': 3, 'medium_airport': 2, 'small_airport': 1}
        for v in variants(row):
            want = toks(v)
            if not want:
                continue
            hits = [r for r in cands if all(fuzzy_in(w, oa_text(r).split(), exact) for w in want)]
            if re.search(r'coast guard', row.get('base') or '', re.I):
                # Kustbevakningen: bara en flygplats som heter något med "air station" (inte radiostationen i Miami
                # eller sjukhusplattan i San Diego); annars hellre ingen plats
                hits = [r for r in hits if 'air station' in norm(r['name'])]
            if hits:
                # Ordning: storleken (gardet/kustbevakningen sitter på stadens stora flygplats — Memphis = KMEM, inte
                # Millington eller polisens helikopterplatta), sedan namnet (Hancock Field → Syracuse Hancock Intl, inte
                # orten Hancock), sedan orten (Battle Creek = Kellogg Field). Parentesen (värdstaden) får också avgöra.
                in_name = lambda r: all(fuzzy_in(w, norm(r['name']).split(), exact) for w in want)
                city = lambda r: all(f' {w} ' in ' ' + norm(r.get('municipality', '')) + ' ' for w in want)
                return max(hits, key=lambda r: (rank.get(r['type'], 0), in_name(r), city(r), -len(oa_text(r)))), 'namn+ort (stadens flygplats)'
        return None, ''   # ingen gissning via reservregeln för gardet/kustbevakningen
    for how, text_of in (('namn', lambda r: norm(r['name']).split()), ('namn+ort', lambda r: oa_text(r).split())):
        for vi, v in enumerate(variants(row)):   # huvudnamnet först; en parentes (ofta en ort) bara om träffen är entydig
            want = toks(v)
            if not want:
                continue
            hits = [r for r in cands if all(fuzzy_in(w, text_of(r), exact) for w in want)]
            if vi > 0 and len(hits) != 1:
                continue
            if hits:
                # Nationalgardet, reserven och kustbevakningen sitter oftast på stadens stora civila flygplats → där vinner
                # flygplatsens storlek; annars vinner en militär flygplats (KML-jämförelsen 2026-11-20: Memphis, Tulsa m.fl.)
                if CIVIL_HOSTED.search(row.get('base') or ''):
                    continue   # avgörs nedan på ort + storlek
                return max(hits, key=lambda r: (bool(MIL.search(norm(r['name']))), r['type'] in ('large_airport', 'medium_airport'), -len(text_of(r)))), how
    # 3) Reserv, bara huvudnamnet: dess längsta ord (vid lika längd det sista — "Stad Flygfält") står i NAMNET på en
    #    militär flygplats, och bara en sådan finns i landet
    want = [w for w in toks(variants(row)[0]) if w not in ROMAN]
    if want:
        key = sorted(enumerate(want), key=lambda t: (len(t[1]), t[0]))[-1][1]
        hits = [r for r in cands if MIL.search(norm(r['name'])) and fuzzy_in(key, norm(r['name']).split(), exact)]
        if len(hits) == 1:
            return hits[0], 'namn (militär, ett ord)'
    return None, ''

raw = []
for f in sorted(glob.glob(os.path.join(src_dir, '*.json'))):
    if os.path.basename(f).startswith('_'):
        continue
    raw += json.load(open(f, encoding='utf8'))
merged, merges = {}, []
for row in raw:
    if row.get('operator') == 'UA' or row.get('location') == 'UA':
        continue
    o, how = match(row)
    key = (row.get('operator'), o['ident'] if o else norm(row.get('base')))
    if key in merged:   # samma förbandsland + bas från två grupper → slå ihop
        m = merged[key][0]
        merges.append(f"{row.get('operator')} {o['ident'] if o else ''} {o['name'] if o else ''}: «{m.get('base')}» + «{row.get('base')}»")
        for k in ('units', 'aircraft', 'sources', 'urls'):
            m[k] = list(dict.fromkeys((m.get(k) or []) + (row.get(k) or [])))
        m['note'] = '; '.join(x for x in (m.get('note'), row.get('note')) if x)
    else:
        merged[key] = (dict(row), o, how)

rows, problems = [], []
for row, o, how in merged.values():
    if not o:
        problems.append(f"Ingen OurAirports-träff: {row.get('operator')} {row.get('base')} ({row.get('location')})")
    icao = (o.get('icao_code') if o else '') or ''
    gps = (o.get('gps_code') if o else '') or ''
    local = (o.get('local_code') if o else '') or ''
    rows.append({
        'forband_land': row.get('operator', ''),
        'namn': row.get('base', ''),
        'visningskod': icao or gps or local,
        'kodtyp': 'ICAO' if icao else ('Inofficiell' if gps else ('Lokal' if local else 'Saknas')),
        'kodkalla': f'OurAirports ({how})' if o else '',
        'koordinater': f"{float(o['latitude_deg']):.4f}, {float(o['longitude_deg']):.4f}" if o else '',
        'latitud': o['latitude_deg'] if o else '', 'longitud': o['longitude_deg'] if o else '',
        'region': row.get('region', ''),
        'land_iso': row.get('location', ''),
        'kommando': row.get('command', ''),
        'forband': '; '.join(row.get('units') or []),
        'flygplanstyper': ', '.join(row.get('aircraft') or []),
        'icao_code': icao, 'gps_code': gps, 'local_code': local,
        'ourairports_ident': o['ident'] if o else '', 'ourairports_id': o['id'] if o else '',
        'kalla': ', '.join(row.get('sources') or []),
        'kallsidor': ' '.join(row.get('urls') or []),
        'anmarkning': row.get('note', ''),
    })

rows.sort(key=lambda r: (r['forband_land'], r['namn']))
cols = list(rows[0].keys()) if rows else []
with open(os.path.join(out_dir, 'flygbaser_varlden.csv'), 'w', encoding='utf8', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=cols)
    w.writeheader()
    w.writerows(rows)

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Alignment
wb = Workbook()
ov = wb.active
ov.title = 'Översikt'
ov.append(['Förbandsland', 'Baser', 'Förband', 'Utan plats på kartan'])
groups = defaultdict(list)
for r in rows:
    groups[r['forband_land']].append(r)
for land, rs in sorted(groups.items()):
    ov.append([land, len(rs), sum(len([u for u in r['forband'].split('; ') if u]) for r in rs), sum(1 for r in rs if not r['ourairports_ident'])])
show = ['namn', 'visningskod', 'kodtyp', 'region', 'land_iso', 'kommando', 'forband', 'flygplanstyper', 'koordinater', 'kalla', 'kallsidor', 'anmarkning']
for land, rs in sorted(groups.items()):
    ws = wb.create_sheet(land[:31])
    ws.append(show)
    for r in rs:
        ws.append([r[c] for c in show])
for ws in wb.worksheets:
    for c in ws[1]:
        c.font = Font(bold=True, color='FFFFFF')
        c.fill = PatternFill('solid', fgColor='0F1E3A')
    ws.freeze_panes = 'A2'
    for col in ws.columns:
        ws.column_dimensions[col[0].column_letter].width = min(60, max(len(str(c.value or '')) for c in col) + 2)
        for c in col[1:]:
            c.alignment = Alignment(wrap_text=True, vertical='top')
wb.save(os.path.join(out_dir, 'flygbaser_varlden.xlsx'))

print(f'{len(rows)} baser, {len(groups)} förbandsländer, {sum(1 for r in rows if r["ourairports_ident"])} med plats')
print(' '.join(f'{l}:{len(rs)}' for l, rs in sorted(groups.items())))
open(os.path.join(out_dir, 'sammanslagningar.txt'), 'w').write('\n'.join(merges))
print(f'Sammanslagningar: {len(merges)}')
print(f'Problem ({len(problems)}):')
for p in problems:
    print('  -', p)
