# Tornens/AFIS telefonnummer ur AIP GEN 3.3 (LFV:s officiella lista över flygtrafiktjänstens enheter, kolumnen
# "Telephone" — fax står i en egen kolumn). Flygplatsen kopplas via enhetens AFS-adress (ESGJZTZX → ESGJ), så
# ingen namngissning. Bara FÖRSTA telefonnumret används (AIP säger inte vad ett andra nummer är); nummer som inte
# ser ut som ett svenskt telefonnummer (t.ex. Uppsalas hopslagna "+46 18 10 19 829 60 72") hoppas över.
# Kör: python3 -I fetch-gen33.py "<AMDT-mapp, t.ex. AIRAC AIP AMDT 6-2026_2026_10_29>" → reviewed/twr-gen33.json
import re, sys, html, json, subprocess, urllib.parse
amdt = sys.argv[1]
url = 'https://aro.lfv.se/content/eaip/' + urllib.parse.quote(amdt) + '/eAIP/' + urllib.parse.quote('ES-GEN 3.3-en-GB.html')
s = subprocess.run(['curl', '-sL', '--max-time', '60', '-A', 'Mozilla/5.0 (BladesAirportInfo)', url], capture_output=True).stdout.decode('utf8', 'ignore')
idx = json.load(open('aip/_index.json'))['aerodromes']
def cell(c): return [x.strip() for x in re.sub(r'\s+', ' ', html.unescape(re.sub(r'<br[^>]*>', '|', re.sub(r'<(?!br)[^>]+>', '', c)))).split('|') if x.strip()]
out, skipped = [], []
for r in re.findall(r'<tr[^>]*>(.*?)</tr>', s, re.S):
    cs = [cell(c) for c in re.findall(r'<td[^>]*>(.*?)</td>', r, re.S)]
    if len(cs) < 5 or not cs[0] or not re.search(r'\b(TWR|AFIS)\b', cs[0][0]): continue
    unit, tel, afs = cs[0][0], cs[2], cs[4]
    icao = next((a[:4] for a in afs if re.match(r'^E[A-Z]{3}Z', a)), None)
    if not icao or icao not in idx: continue
    ph = tel[0] if tel else ''
    # Svenskt nummer: +46, riktnummer utan nolla, totalt 7–9 siffror efter landskoden
    if not re.fullmatch(r'\+46 [1-9][\d ]{6,12}', ph) or not (7 <= len(re.sub(r'\D', '', ph)) - 2 <= 9):
        skipped.append(f'{icao} {unit}: {tel}'); continue
    label = 'Tower / AFIS' if 'TWR/AFIS' in unit else 'AFIS' if 'AFIS' in unit else 'Tower (TWR)'
    out.append({'key': icao, 'contacts': [{'label': label, 'phone': ph, 'url': url, 'quote': f'{unit} {ph}'}]})
json.dump(out, open('reviewed/twr-gen33.json', 'w', encoding='utf8'), ensure_ascii=False, indent=1)
print(len(out), 'flygplatser med tornnummer;', 'hoppade över:', skipped, '; saknas i GEN 3.3:', sorted(set(idx) - {o['key'] for o in out} - {x[:4] for x in skipped}))
