// Kontroll av avgifterna (FEES-raden): varje post måste ha url + citat, och citatet (och parkeringscitatet) måste
// stå i källan. Källan hämtas (HTML eller PDF via unpdf), cache i .cache-web/. Det som inte klarar det tas bort.
// Kör (unpdf måste finnas, t.ex. från proxy/node_modules): node verify-fees.mjs raw/fees-*.json
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
const require = createRequire(path.resolve('../../../proxy/package.json'));
const { extractText, getDocumentProxy } = await import(require.resolve('unpdf'));
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
fs.mkdirSync('.cache-web', { recursive: true }); fs.mkdirSync('verified', { recursive: true });
async function page(url) {
  const p = path.join('.cache-web', 'fee-' + crypto.createHash('sha1').update(url).digest('hex') + '.txt');
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
    const fe = a.fees; if (!fe) continue; tot++;
    if (!fe.url || !fe.quote) { console.log('  bort (saknar url/citat):', a.key); continue; }
    let t = ''; try { t = await page(fe.url); } catch { console.log('  bort (källan svarar inte):', a.key, fe.url); continue; }
    const okQ = t.includes(norm(fe.quote)), okP = !fe.parking || (fe.quote_parking ? t.includes(norm(fe.quote_parking)) : okQ);
    if (!okQ) { console.log('  bort (citatet finns inte):', a.key, fe.quote.slice(0, 70)); continue; }
    const r = { key: a.key, fees: { ...fe } };
    if (!okP) { delete r.fees.parking; console.log('  parkering bort (citatet finns inte):', a.key); }
    out.push(r); kept++;
  }
  fs.writeFileSync(path.join('verified', path.basename(f)), JSON.stringify(out, null, 1));
}
console.log(`${kept}/${tot} avgiftsposter med citat som står i källan`);
