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
