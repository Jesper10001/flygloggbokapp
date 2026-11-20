# Laddar ner Sveriges AIP AD 2-sidor (LFV eAIP, gällande AIRAC-utgåva) för Airport Info och sparar avsnitten
# AD 2.2 (operatör/kontakt), 2.3 (öppettider), 2.4 (handling/bränsle) och 2.20 (lokala regler) som text.
# Officiell källa; varje uppgift i kortet ska bära ett ordagrant citat härifrån (se verify-info.py).
# Kör: python3 -I fetch-aip.py "<AMDT-mapp, t.ex. AIRAC AIP AMDT 6-2026_2026_10_29>" <utmapp>
import re, sys, os, html, json, subprocess, urllib.parse, time
amdt, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
BASE = 'https://aro.lfv.se/content/eaip/' + urllib.parse.quote(amdt) + '/eAIP/'
UA = 'Mozilla/5.0 (BladesAirportInfo)'
menu = subprocess.run(['curl', '-sL', '--max-time', '60', '-A', UA, BASE + 'menu.html'], capture_output=True).stdout.decode('utf8', 'ignore')
pages = sorted(set(re.findall(r"AD 2 (ES[A-Z]{2}) ([A-ZÅÄÖ /-]+?) 1-en-GB\.html", menu)))
index = {}
for icao, name in pages:
    fname = f'ES-AD 2 {icao} {name} 1-en-GB.html'
    url = BASE + urllib.parse.quote(fname)
    s = subprocess.run(['curl', '-sL', '--max-time', '60', '-A', UA, url], capture_output=True).stdout.decode('utf8', 'ignore')
    t = re.sub(r'<script.*?</script>|<style.*?</style>', '', s, flags=re.S)
    t = re.sub(r'<(br|/p|/tr|/div|/h\d|/td)[^>]*>', '\n', t)
    t = html.unescape(re.sub(r'<[^>]+>', ' ', t))
    t = re.sub(r'[ \t\xa0]+', ' ', t); t = re.sub(r'\n\s*\n+', '\n', t)
    secs = {}
    for n in ('2.2', '2.3', '2.4', '2.20'):
        m = re.search(rf'\n ?{icao} {re.escape(n)} [A-Z].*?(?=\n ?{icao} 2\.\d+ [A-Z]|\Z)', t, flags=re.S)
        secs[n] = m.group(0).strip() if m else ''
    txt = f'SOURCE: AIP Sweden, AD 2 {icao} {name} ({amdt})\nURL: {url}\n\n' + '\n\n'.join(secs[k] for k in ('2.2', '2.3', '2.4', '2.20'))
    open(os.path.join(out, f'{icao}.txt'), 'w', encoding='utf8').write(txt)
    index[icao] = {'name': name, 'url': url, 'chars': len(txt), 'has2_20': bool(secs['2.20'])}
    time.sleep(0.5)
json.dump({'amdt': amdt, 'aerodromes': index}, open(os.path.join(out, '_index.json'), 'w'), ensure_ascii=False, indent=1)
print(len(index), 'flygplatser;', sum(v['chars'] for v in index.values()), 'tecken;', [k for k, v in index.items() if not v['has2_20']], 'utan 2.20')
