// Airport Info (Info-kortet i appen: PPR, bränsle, öppettider, kontakt, Good to know).
// Grunddata = data/airport-info-se.json (byggd ur granskad AIP + fältens egna hemsidor, FlightLogApp/scripts/airport-info).
// Ändringar görs i Blades Ops (/ops/airport-info) och sparas i KV; de vinner över grunddatan. Varje ändring loggas.
// Appen hämtar GET /airport-info (ETag → 304 när inget ändrats).
import BASE from '../data/airport-info-se.json';

type Rec = Record<string, any>;
interface Env { QUOTA_KV: KVNamespace }
const K_EDITS = 'ainfo:v1:edits', K_HIST = 'ainfo:v1:hist', K_STAMP = 'ainfo:v1:stamp';
const base = (BASE as any).airports as Record<string, Rec>;

async function edits(env: Env): Promise<Record<string, Rec>> {
  return ((await env.QUOTA_KV.get(K_EDITS, 'json')) as Record<string, Rec>) ?? {};
}
/** Publicerad data: grunddata + ändringar (deleted: true tar bort fältet). */
async function merged(env: Env): Promise<{ airports: Record<string, Rec>; stamp: string; edited: string[] }> {
  const e = await edits(env);
  const out: Record<string, Rec> = { ...base };
  for (const [k, r] of Object.entries(e)) { if (r.deleted) delete out[k]; else out[k] = r; }
  const stamp = (await env.QUOTA_KV.get(K_STAMP)) ?? '0';
  return { airports: out, stamp, edited: Object.keys(e) };
}

/** GET /airport-info — för appen. */
export async function handleAirportInfo(request: Request, env: Env): Promise<Response> {
  const m = await merged(env);
  const etag = `"${(BASE as any).built}-${m.stamp}"`;
  const headers = { ETag: etag, 'Cache-Control': 'private, no-cache' };
  if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers });
  // Appen får inget om redigeringen (namn används bara i Ops)
  const airports = Object.fromEntries(Object.entries(m.airports).map(([k, r]) => { const { name, ...rest } = r; return [k, rest]; }));
  return new Response(JSON.stringify({ v: etag.replace(/"/g, ''), airports }), { headers: { ...headers, 'Content-Type': 'application/json' } });
}

const json = (d: unknown, status = 200) => new Response(JSON.stringify(d), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const str = (v: unknown, max = 400) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);

/** Rensar en post från Ops-formuläret till samma form som grunddatan. */
function sanitize(r: Rec): Rec {
  const o: Rec = { kind: 'ops', name: str(r.name, 120) };
  if (r.ppr && r.ppr.s) o.ppr = { s: ['required', 'not_required', 'partial', 'unknown'].includes(r.ppr.s) ? r.ppr.s : 'unknown', n: str(r.ppr.n), ph: str(r.ppr.ph, 40), url: str(r.ppr.url, 300) };
  if (r.fuel && (r.fuel.t?.length || r.fuel.n)) o.fuel = { t: (r.fuel.t || []).map((x: unknown) => str(x, 30)).filter(Boolean).slice(0, 8), n: str(r.fuel.n), h: str(r.fuel.h, 200) };
  if (r.hours && (r.hours.ad || r.hours.n)) o.hours = { ad: str(r.hours.ad, 300), n: str(r.hours.n) };
  if (Array.isArray(r.contacts)) o.contacts = r.contacts.map((c: Rec) => ({ l: str(c.l, 80), ph: str(c.ph, 40) })).filter((c: Rec) => c.l && c.ph).slice(0, 8);
  if (Array.isArray(r.gtk)) o.gtk = r.gtk.map((g: unknown) => str(g, 300)).filter(Boolean).slice(0, 6);
  for (const k of ['web', 'email']) if (r[k]) o[k] = str(r[k], 200);
  o.src = (Array.isArray(r.src) ? r.src : []).map((s: Rec) => ({ t: str(s.t, 120), url: str(s.url, 400) })).filter((s: Rec) => s.url).slice(0, 6);
  o.v = /^\d{4}-\d{2}-\d{2}$/.test(String(r.v)) ? r.v : new Date().toISOString().slice(0, 10);
  for (const k of Object.keys(o)) if (o[k] === '' || (Array.isArray(o[k]) && !o[k].length)) delete o[k];
  return o;
}

async function log(env: Env, entry: Rec) {
  const h = ((await env.QUOTA_KV.get(K_HIST, 'json')) as Rec[]) ?? [];
  h.unshift({ at: new Date().toISOString(), ...entry });
  await env.QUOTA_KV.put(K_HIST, JSON.stringify(h.slice(0, 300)));
  await env.QUOTA_KV.put(K_STAMP, String(Date.now()));
}

/** /ops/airport-info* — anropas av handleOps efter inloggning och same-origin-kontroll. */
export async function handleAirportInfoOps(request: Request, env: Env, pathname: string): Promise<Response | null> {
  if (pathname === '/ops/airport-info' && request.method === 'GET') return new Response(PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  if (pathname === '/ops/airport-info/data' && request.method === 'GET') {
    const m = await merged(env);
    return json({ airports: m.airports, edited: m.edited, base: Object.keys(base), hist: ((await env.QUOTA_KV.get(K_HIST, 'json')) as Rec[] ?? []).slice(0, 50) });
  }
  if (request.method !== 'POST') return null;
  const body = (await request.json().catch(() => ({}))) as Rec;
  const key = str(body.key, 12).toUpperCase();
  if (!/^[A-Z0-9-]{3,12}$/.test(key)) return json({ error: 'bad_key' }, 400);
  const e = await edits(env);
  const before = e[key] ?? base[key] ?? null;
  if (pathname === '/ops/airport-info/save') {
    e[key] = sanitize(body.record ?? {});
    await env.QUOTA_KV.put(K_EDITS, JSON.stringify(e));
    await log(env, { key, action: 'save', before, after: e[key] });
    return json({ ok: true, record: e[key] });
  }
  if (pathname === '/ops/airport-info/delete') {
    e[key] = { deleted: true };
    await env.QUOTA_KV.put(K_EDITS, JSON.stringify(e));
    await log(env, { key, action: 'delete', before });
    return json({ ok: true });
  }
  if (pathname === '/ops/airport-info/revert') {
    delete e[key];
    await env.QUOTA_KV.put(K_EDITS, JSON.stringify(e));
    await log(env, { key, action: 'revert', before });
    return json({ ok: true, record: base[key] ?? null });
  }
  return null;
}

const PAGE = `<!doctype html><html lang="sv"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Airport Info · Blades Ops</title><style>
:root{--bg:#0A1628;--card:#0F1E3A;--line:#1A3A5A;--txt:#E4ECF5;--sub:#8FB0CC;--cy:#00C8E8;--gold:#FFB830;--red:#FF8A6B}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font:14px/1.45 -apple-system,system-ui,sans-serif}
header{display:flex;gap:10px;align-items:center;padding:14px 16px;border-bottom:1px solid var(--line);position:sticky;top:0;background:var(--bg);z-index:2}
header a{color:var(--cy);text-decoration:none;font-weight:700}h1{font-size:16px;margin:0;flex:1}
main{display:grid;grid-template-columns:minmax(0,300px) minmax(0,1fr);gap:0;min-height:calc(100vh - 54px)}
@media(max-width:760px){main{grid-template-columns:1fr}#list{max-height:40vh}}
#side{border-right:1px solid var(--line);padding:12px;display:flex;flex-direction:column;gap:8px}
input,select,textarea{width:100%;background:#071226;color:var(--txt);border:1px solid var(--line);border-radius:8px;padding:8px 10px;font:inherit}
textarea{min-height:70px;resize:vertical}label{display:block;font-size:11px;font-weight:700;letter-spacing:.08em;color:var(--gold);margin:12px 0 4px;text-transform:uppercase}
#list{overflow:auto;flex:1;display:flex;flex-direction:column;gap:2px}
.it{display:flex;gap:8px;align-items:center;padding:7px 8px;border-radius:8px;cursor:pointer;border:1px solid transparent}
.it:hover,.it.on{background:var(--card);border-color:var(--line)}.k{font-family:ui-monospace,monospace;font-weight:800;color:var(--cy);min-width:62px}
.b{font-size:10px;font-weight:800;padding:1px 6px;border-radius:5px;border:1px solid var(--line);color:var(--sub)}.b.ops{color:var(--gold);border-color:var(--gold)}
#ed{padding:16px;max-width:760px}.row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.btns{display:flex;gap:8px;margin-top:16px;flex-wrap:wrap}button{border:1px solid var(--cy);background:rgba(0,200,232,.14);color:#fff;border-radius:18px;padding:8px 14px;font-weight:800;cursor:pointer}
button.sec{border-color:var(--line);background:none}button.del{border-color:var(--red);color:var(--red);background:none}
.hint{color:var(--sub);font-size:12px}.ok{color:#2DD4A3}.err{color:var(--red)}
</style></head><body>
<header><a href="/ops">‹ Ops</a><h1>Airport Info</h1><span class="hint" id="cnt"></span></header>
<main><div id="side"><input id="q" placeholder="Sök ICAO eller namn"><div style="display:flex;gap:6px"><input id="newk" placeholder="Ny nyckel, t.ex. SE-0024"><button class="sec" id="add">Lägg till</button></div><div id="list"></div></div>
<div id="ed"><p class="hint">Välj en flygplats till vänster. Bara uppgifter från officiell källa (AIP) eller flygplatsens egen hemsida — ange alltid källa.</p></div></main>
<script>
let D={airports:{},edited:[]},cur=null;
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
async function load(){D=await (await fetch('/ops/airport-info/data')).json();list();$('#cnt').textContent=Object.keys(D.airports).length+' flygplatser · '+D.edited.length+' ändrade';}
function list(){const q=$('#q').value.trim().toLowerCase();$('#list').innerHTML=Object.entries(D.airports).filter(([k,r])=>!q||k.toLowerCase().includes(q)||(r.name||'').toLowerCase().includes(q)).sort().map(([k,r])=>'<div class="it'+(k===cur?' on':'')+'" data-k="'+esc(k)+'"><span class="k">'+esc(k)+'</span><span style="flex:1">'+esc(r.name||'')+'</span><span class="b'+(r.kind==='ops'?' ops':'')+'">'+esc(r.kind||'')+'</span></div>').join('');}
$('#list').onclick=e=>{const it=e.target.closest('.it');if(it)edit(it.dataset.k)};$('#q').oninput=list;
$('#add').onclick=()=>{const k=$('#newk').value.trim().toUpperCase();if(!k)return;if(!D.airports[k])D.airports[k]={kind:'ops'};edit(k)};
function edit(k){cur=k;list();const r=D.airports[k]||{},p=r.ppr||{},f=r.fuel||{},h=r.hours||{};
$('#ed').innerHTML='<h2 style="margin:0 0 4px">'+esc(k)+' <span class="hint">'+esc(r.kind||'')+' · verifierad '+esc(r.v||'–')+'</span></h2>'+
'<label>Namn (bara i Ops)</label><input id="name" value="'+esc(r.name)+'">'+
'<label>PPR</label><div class="row"><select id="ps">'+['','required','partial','not_required','unknown'].map(s=>'<option'+(p.s===s?' selected':'')+'>'+s+'</option>').join('')+'</select><input id="pn" placeholder="Kort notering (engelska)" value="'+esc(p.n)+'"></div><div class="row" style="margin-top:8px"><input id="pph" placeholder="PPR-telefon" value="'+esc(p.ph)+'"><input id="purl" placeholder="Länk för PPR-ansökan" value="'+esc(p.url)+'"></div>'+
'<label>Bränsle</label><div class="row"><input id="ft" placeholder="Typer, kommaseparerat (JET A-1, 100LL)" value="'+esc((f.t||[]).join(', '))+'"><input id="fn" placeholder="Hur (Truck, Self-service …)" value="'+esc(f.n)+'"></div><input id="fh" style="margin-top:8px" placeholder="Tider för bränsle" value="'+esc(f.h)+'">'+
'<label>Öppettider</label><input id="ha" placeholder="Som i källan, t.ex. H24 eller MON-FRI 0600-1600 (0500-1500)" value="'+esc(h.ad)+'"><input id="hn" style="margin-top:8px" placeholder="Notering" value="'+esc(h.n)+'">'+
'<label>Kontakt (en per rad: Etikett | telefon)</label><textarea id="ct">'+esc((r.contacts||[]).map(c=>c.l+' | '+c.ph).join('\\n'))+'</textarea>'+
'<label>Good to know (en per rad)</label><textarea id="gk">'+esc((r.gtk||[]).join('\\n'))+'</textarea>'+
'<div class="row"><div><label>Hemsida</label><input id="web" value="'+esc(r.web)+'"></div><div><label>E-post</label><input id="em" value="'+esc(r.email)+'"></div></div>'+
'<label>Källor (en per rad: Titel | URL)</label><textarea id="src">'+esc((r.src||[]).map(s=>s.t+' | '+s.url).join('\\n'))+'</textarea>'+
'<label>Verifierad (datum)</label><input id="v" value="'+esc(r.v||new Date().toISOString().slice(0,10))+'">'+
'<div class="btns"><button id="save">Spara</button>'+(D.edited.includes(k)?'<button class="sec" id="rev">Återställ till grunddata</button>':'')+'<button class="del" id="del">Ta bort</button><span id="msg" class="hint"></span></div>';
$('#save').onclick=save;$('#del').onclick=()=>post('delete');if($('#rev'))$('#rev').onclick=()=>post('revert');}
const lines=id=>$(id).value.split('\\n').map(s=>s.trim()).filter(Boolean);
async function save(){const rec={name:$('#name').value,ppr:{s:$('#ps').value,n:$('#pn').value,ph:$('#pph').value,url:$('#purl').value},fuel:{t:$('#ft').value.split(',').map(s=>s.trim()).filter(Boolean),n:$('#fn').value,h:$('#fh').value},hours:{ad:$('#ha').value,n:$('#hn').value},
contacts:lines('#ct').map(l=>{const [a,b]=l.split('|');return{l:(a||'').trim(),ph:(b||'').trim()}}),gtk:lines('#gk'),web:$('#web').value,email:$('#em').value,src:lines('#src').map(l=>{const [a,b]=l.split('|');return b?{t:a.trim(),url:b.trim()}:{t:'',url:a.trim()}}),v:$('#v').value};
if(!rec.src.length){$('#msg').innerHTML='<span class="err">Ange minst en källa.</span>';return}await post('save',rec);}
async function post(a,rec){if(a!=='save'&&!confirm(a==='delete'?'Ta bort '+cur+' ur Airport Info?':'Återställ '+cur+' till grunddata?'))return;
const r=await fetch('/ops/airport-info/'+a,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:cur,record:rec})});const j=await r.json();
if(!r.ok){$('#msg').innerHTML='<span class="err">'+esc(j.error||'Fel')+'</span>';return}await load();if(a==='delete'){cur=null;$('#ed').innerHTML='<p class="ok">Borttagen.</p>'}else edit(cur);$('#msg')&&($('#msg').innerHTML='<span class="ok">Sparat.</span>');}
load();
</script></body></html>`;

// ── Refresh (Info-kortets ↻): användaren betalar 3 coins, kortet hämtas om ur samma källor som grunddatan ──
// AIP-fält: gällande AIRAC-utgåvas AD 2-sida (2.2/2.3/2.4/2.20). Övriga: fältets egna sidor (src).
// Claude läser ut uppgifterna med ordagranna citat; servern kontrollerar varje citat mot källtexten och släpper
// bara igenom det som står där. Det som inte kan styrkas behåller sitt tidigare granskade värde.
const UA = { 'User-Agent': 'Mozilla/5.0 (BladesAirportInfo; +https://blades-app.com)' };
const AIP_ROOT = 'https://aro.lfv.se/content/eaip/';

export function htmlToText(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(br|\/p|\/tr|\/div|\/h\d|\/td|\/li)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/[ \t ]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}
/** Jämförelseform för citatkontrollen: gemener, bara bokstäver/siffror, ett mellanslag. */
export const norm = (s: string) => String(s ?? '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const digits = (s: string) => String(s ?? '').replace(/\D/g, '').replace(/^46/, '0').replace(/^00?/, '0');

/** Gällande AIRAC-mapp (senaste utgåva med datum ≤ idag). */
async function currentAmdt(): Promise<string | null> {
  const h = await (await fetch(AIP_ROOT + 'default_offline.html', { headers: UA })).text();
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '_');
  const all = [...new Set([...h.matchAll(/AIRAC AIP AMDT \d+-\d{4}_(\d{4}_\d{2}_\d{2})/g)].map((m) => m[0]))];
  const ok = all.filter((a) => a.slice(-10) <= today).sort((a, b) => a.slice(-10).localeCompare(b.slice(-10)));
  return ok.pop() ?? null;
}

async function sourceTexts(key: string, rec: Rec): Promise<{ t: string; url: string; text: string }[]> {
  const out: { t: string; url: string; text: string }[] = [];
  const srcs = (rec.src ?? []).slice(0, 3) as { t: string; url: string }[];
  for (const s of srcs) {
    let url = s.url, t = s.t;
    if (rec.kind === 'aip' && /aro\.lfv\.se\/content\/eaip\//.test(url)) {
      const amdt = await currentAmdt();
      if (amdt) {
        url = url.replace(/(content\/eaip\/)[^/]+(\/eAIP\/)/, `$1${encodeURI(amdt)}$2`);
        const m = amdt.match(/AMDT (\d+)-(\d{4})/);
        if (m) t = t.replace(/AMDT \d+-\d{4}/, `AMDT ${m[1]}-${m[2]}`);
      }
    }
    try {
      const r = await fetch(url, { headers: UA, redirect: 'follow' });
      if (!r.ok) continue;
      let text = htmlToText(await r.text());
      if (rec.kind === 'aip') {
        const secs = ['2.2', '2.3', '2.4', '2.20'].map((n) => {
          const m = text.match(new RegExp(`\\n ?${key} ${n.replace('.', '\\.')} [A-Z][\\s\\S]*?(?=\\n ?${key} 2\\.\\d+ [A-Z]|$)`));
          return m ? m[0] : '';
        }).filter(Boolean);
        if (secs.length) text = secs.join('\n\n');
      }
      out.push({ t, url, text: text.slice(0, 40000) });
    } catch {}
  }
  return out;
}

const REFRESH_PROMPT = `You extract aerodrome information for a pilot app from the SOURCE TEXTS below (official AIP pages or the aerodrome's own website). Use ONLY what the sources state. Never use outside knowledge, never infer. Every value must come with "quote": a short VERBATIM excerpt (copied character for character, 5-200 chars) from one source that states it, and "src": the index of that source.
Return ONLY a JSON object:
{"ppr":{"s":"required|partial|not_required|unknown","n":"<short English note or empty>","ph":"<phone for PPR or empty>","quote":"…","src":0} | null,
 "fuel":{"t":["<fuel types e.g. JET A-1, AVGAS 100LL, UL91, MOGAS>"],"n":"<short English note or empty>","h":"<fuel hours or empty>","quote":"…","src":0} | null,
 "hours":{"ad":"<aerodrome operating hours exactly as stated, translated to English>","n":"<short note or empty>","quote":"…","src":0} | null,
 "contacts":[{"l":"<English label, e.g. Aerodrome operator, TWR, Fuel>","ph":"<phone>","quote":"<excerpt containing the number>","src":0}],
 "fees":{"landing":"<landing fee as stated, with currency>","parking":"<parking/overnight fee or empty>","note":"<e.g. per landing, MTOM limit, or empty>","year":"<year the price list applies to, or empty>","quote":"…","src":0} | null}
Use null when the sources do not state it. Write notes in English. Keep notes under 120 characters.`;

type Verified = { rec: Rec; changed: string[]; dropped: string[] };

/** Släpper bara igenom fält vars citat finns ordagrant i källan (och telefonnummer som finns i citatet). */
export function verifyRefresh(cur: Rec, ai: Rec, srcs: { t: string; url: string; text: string }[], today: string): Verified {
  const ntext = srcs.map((s) => norm(s.text));
  const ok = (x: Rec | null | undefined) => {
    if (!x || typeof x.quote !== 'string' || norm(x.quote).length < 4) return false;
    const i = Number.isInteger(x.src) && ntext[x.src] !== undefined ? [x.src] : ntext.map((_, j) => j);
    return i.some((j) => ntext[j].includes(norm(x.quote)));
  };
  const phoneIn = (ph: string, quote: string) => !ph || digits(quote).includes(digits(ph));
  const out: Rec = { ...cur }, changed: string[] = [], dropped: string[] = [];
  const set = (k: string, v: Rec) => { if (JSON.stringify(cur[k] ?? null) !== JSON.stringify(v)) changed.push(k); out[k] = v; };
  const s = (v: unknown, n = 300) => str(v, n);
  if (ai.ppr) {
    if (ok(ai.ppr) && phoneIn(ai.ppr.ph, ai.ppr.quote)) {
      const p: Rec = { s: ['required', 'partial', 'not_required', 'unknown'].includes(ai.ppr.s) ? ai.ppr.s : 'unknown' };
      if (ai.ppr.n) p.n = s(ai.ppr.n); if (ai.ppr.ph) p.ph = s(ai.ppr.ph, 40); if (cur.ppr?.url) p.url = cur.ppr.url;
      set('ppr', p);
    } else dropped.push('ppr');
  }
  if (ai.fuel) {
    if (ok(ai.fuel)) {
      const f: Rec = { t: (Array.isArray(ai.fuel.t) ? ai.fuel.t : []).map((x: unknown) => s(x, 30)).filter(Boolean).slice(0, 8) };
      if (ai.fuel.n) f.n = s(ai.fuel.n); if (ai.fuel.h) f.h = s(ai.fuel.h, 200);
      set('fuel', f);
    } else dropped.push('fuel');
  }
  if (ai.hours?.ad) {
    if (ok(ai.hours)) { const h: Rec = { ad: s(ai.hours.ad) }; if (ai.hours.n) h.n = s(ai.hours.n); set('hours', h); }
    else dropped.push('hours');
  }
  if (Array.isArray(ai.contacts) && ai.contacts.length) {
    const good = ai.contacts.filter((c: Rec) => c?.ph && ok(c) && phoneIn(c.ph, c.quote)).map((c: Rec) => ({ l: s(c.l, 80), ph: s(c.ph, 40) })).slice(0, 8);
    if (good.length) set('contacts', good);
    if (good.length < ai.contacts.length) dropped.push('contacts');
  }
  if (ai.fees?.landing) {
    if (ok(ai.fees)) {
      const f: Rec = { landing: s(ai.fees.landing, 120) };
      if (ai.fees.parking) f.parking = s(ai.fees.parking, 120); if (ai.fees.note) f.note = s(ai.fees.note, 160);
      if (ai.fees.year) f.year = s(ai.fees.year, 10);
      const src = srcs[Number.isInteger(ai.fees.src) ? ai.fees.src : 0]; if (src) f.url = src.url;
      set('fees', f);
    } else dropped.push('fees');
  }
  out.src = srcs.map((x) => ({ t: x.t, url: x.url }));
  out.v = today;
  return { rec: out, changed, dropped };
}

export type CallModel = (body: string) => Promise<{ resp: Response; used: string }>;

/** POST /airport-info/refresh {key} — anroparen (index.ts) har redan kollat coins och drar dem bara vid ok. */
export async function refreshAirportInfo(key: string, env: Env, call: CallModel): Promise<{ status: number; body: Rec; usage?: { model: string; inTok: number; outTok: number } }> {
  if (!/^[A-Z0-9-]{3,12}$/.test(key)) return { status: 400, body: { error: 'bad_key' } };
  const cur = (await merged(env)).airports[key];
  if (!cur) return { status: 404, body: { error: 'no_info' } };
  const srcs = await sourceTexts(key, cur);
  if (!srcs.length) return { status: 502, body: { error: 'source_unavailable' } };
  const user = srcs.map((x, i) => `=== SOURCE ${i}: ${x.t} (${x.url}) ===\n${x.text}`).join('\n\n');
  const { resp, used } = await call(JSON.stringify({
    model: 'claude-sonnet-5-5', max_tokens: 2500,
    system: [{ type: 'text', text: REFRESH_PROMPT }],
    messages: [{ role: 'user', content: user }],
  }));
  if (!resp.ok) return { status: 502, body: { error: 'ai_unavailable' } };
  const data = (await resp.json()) as Rec;
  const text = (Array.isArray(data.content) ? data.content : []).filter((c: Rec) => c.type === 'text').map((c: Rec) => c.text ?? '').join('\n');
  let ai: Rec = {};
  try { ai = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}'); } catch { return { status: 502, body: { error: 'ai_parse' } }; }
  const v = verifyRefresh(cur, ai, srcs, new Date().toISOString().slice(0, 10));
  const { name, ...record } = v.rec;
  return {
    status: 200,
    body: { key, record, changed: v.changed, dropped: v.dropped },
    usage: { model: used, inTok: data.usage?.input_tokens ?? 0, outTok: data.usage?.output_tokens ?? 0 },
  };
}
