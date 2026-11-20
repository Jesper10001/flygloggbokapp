// Kontroll av tornens/AFIS telefonnummer (brief-twr.md): varje nummer måste ha url + citat, citatet måste stå
// ordagrant på sidan och numret måste finnas i citatet (siffrorna). Sidan hämtas (HTML eller PDF via unpdf),
// cache i .cache-web/. Det som inte klarar det tas bort. Kör: node verify-twr.mjs raw/twr-*.json
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(path.resolve('../../../proxy/package.json'));
const { extractText, getDocumentProxy } = await import(require.resolve('unpdf'));
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const digits = (s) => String(s ?? '').replace(/\D/g, '').replace(/^46/, '0').replace(/^00?/, '0');
fs.mkdirSync('.cache-web', { recursive: true }); fs.mkdirSync('verified', { recursive: true });
async function page(url) {
  const p = path.join('.cache-web', 'twr-' + crypto.createHash('sha1').update(url).digest('hex') + '.txt');
  if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  const buf = execFileSync('curl', ['-sL', '--max-time', '40', '-A', 'Mozilla/5.0 (BladesAirportInfo)', url], { maxBuffer: 64 << 20 });
  let t;
  if (buf.slice(0, 5).toString() === '%PDF-') {
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(buf)), { mergePages: true });
    t = Array.isArray(text) ? text.join(' ') : text;
  } else {
    t = buf.toString('utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
  }
  t = norm(t); fs.writeFileSync(p, t); return t;
}
let tot = 0, kept = 0;
for (const f of process.argv.slice(2)) {
  const out = [];
  for (const a of JSON.parse(fs.readFileSync(f, 'utf8'))) {
    const ok = [];
    for (const c of a.contacts ?? []) {
      tot++;
      if (!c.url || !c.quote || !c.phone) { console.log('  bort (saknar url/citat/nummer):', a.key, c.label); continue; }
      if (!digits(c.quote).includes(digits(c.phone))) { console.log('  bort (numret står inte i citatet):', a.key, c.phone); continue; }
      let t = ''; try { t = await page(c.url); } catch { console.log('  bort (sidan svarar inte):', a.key, c.url); continue; }
      if (!t.includes(norm(c.quote))) { console.log('  bort (citatet finns inte):', a.key, c.quote.slice(0, 70)); continue; }
      ok.push(c); kept++;
    }
    if (ok.length) out.push({ key: a.key, contacts: ok });
  }
  fs.writeFileSync(path.join('verified', path.basename(f)), JSON.stringify(out, null, 1));
}
console.log(`${kept}/${tot} tornnummer med citat som står på sidan`);
