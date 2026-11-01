// Webbplatsens supportformulär (blades-app.com/support.html): POST /web/support → ett mejl till supportinkorgen.
// Inget sparas: meddelandet går som mejl till SUPPORT_FORWARD_TO med Reply-To = besökarens adress, så man svarar
// direkt i mejlprogrammet, och räknas som ett supportmejl på driftsidan (bara antal och tid).
// Skydd: bara sajtens origin, rate limit per hashad IP (WEB_FORM_LIMITER, ingen KV — gratisplanens KV-skrivningar
// delas med appens AI-kvoter), en honungsfälla och en minsta ifyllnadstid. Botar får ett låtsat kvitto.
import { EmailMessage } from 'cloudflare:email';
import { b64, encodeSubject, countSupportMessage, type OpsEnv } from './ops';

export interface SupportFormEnv extends OpsEnv {
  WEB_FORM_LIMITER?: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

// Det formuläret erbjuder; allt annat avvisas (fälten blir rubriker i mejlet).
const TYPES: Record<string, string> = {
  problem: "Something isn't working",
  help: 'I need a hand',
  idea: 'Something is missing',
};
const AREAS = new Set([
  'Logging a flight', 'Logbook & PDF', 'Import & export', 'ACARS & AI scan', 'Backup & iCloud', 'Drones',
  'Map & airports', 'Insights & currency', 'Premium & billing', 'Moving my logbook', 'My data & privacy',
  'Blade-coins & promo codes', 'How something works', 'Something else',
]);
const FREQUENCY = new Set(['Every time', 'Sometimes', 'Just once']);
const IMPACT = new Set(['Nice to have', "I'd use it often", 'I need it to use Blades']);
const MIN_FILL_MS = 3000;          // snabbare än så fyller ingen människa i formuläret
const MAX_BODY = 24_000;

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** Text från formuläret: inga styrtecken utom radbrytning och tabb, högst max tecken. */
function clean(v: unknown, max: number): string {
  if (typeof v !== 'string') return '';
  return v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, max);
}
const EMAIL = /^[^\s@<>()",;:\\[\]]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,62}[A-Za-z0-9])?)*\.[A-Za-z]{2,24}$/;

/** Ett kvitto att hänvisa till: BL- och sex tecken utan förväxlingsbara (0/O, 1/I). */
function reference(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint8Array(6));
  return `BL-${Array.from(r, (b) => A[b % A.length]).join('')}`;
}

async function ipKey(ip: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`blades-webform:v1:${ip}`));
  return Array.from(new Uint8Array(d).slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** POST /web/support (och dess preflight). origin = sajtens origin om den är tillåten, annars null. */
export async function handleSupportForm(request: Request, env: SupportFormEnv, origin: string | null): Promise<Response> {
  if (!origin) return new Response('Forbidden', { status: 403 });
  const cors = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return json({ ok: false, error: 'method' }, 405, cors);

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (env.WEB_FORM_LIMITER) {
    const { success } = await env.WEB_FORM_LIMITER.limit({ key: `form:${await ipKey(ip)}` });
    if (!success) return json({ ok: false, error: 'rate' }, 429, { ...cors, 'Retry-After': '60' });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY) return json({ ok: false, error: 'too-long' }, 413, cors);
  let f: Record<string, unknown>;
  try { f = JSON.parse(raw); } catch { return json({ ok: false, error: 'invalid', fields: [] }, 400, cors); }
  if (!f || typeof f !== 'object') return json({ ok: false, error: 'invalid', fields: [] }, 400, cors);

  // Botar: fyller i den dolda rutan eller skickar direkt. De får ett kvitto, men inget mejl går.
  const elapsed = Number(f.elapsed);
  if (clean(f.website, 200) || !Number.isFinite(elapsed) || elapsed < MIN_FILL_MS) return json({ ok: true, ref: reference() }, 200, cors);

  const type = clean(f.type, 20);
  const area = clean(f.area, 60);
  const msg = {
    summary: clean(f.summary, 160),
    message: clean(f.message, 5000),
    expected: clean(f.expected, 600),
    steps: clean(f.steps, 3000),
    frequency: clean(f.frequency, 40),
    impact: clean(f.impact, 40),
    fromApp: clean(f.fromApp, 80),
    device: clean(f.device, 60),
    ios: clean(f.ios, 20),
    version: clean(f.version, 20),
    name: clean(f.name, 80).replace(/\n/g, ' '),
    email: clean(f.email, 254),
  };
  const bad: string[] = [];
  if (!TYPES[type]) bad.push('type');
  if (!AREAS.has(area)) bad.push('area');
  if ((msg.summary + msg.message).length < 10) bad.push(type === 'idea' ? 'summary' : 'message');
  if (!EMAIL.test(msg.email)) bad.push('email');
  if (msg.frequency && !FREQUENCY.has(msg.frequency)) bad.push('frequency');
  if (msg.impact && !IMPACT.has(msg.impact)) bad.push('impact');
  if (bad.length) return json({ ok: false, error: 'invalid', fields: bad }, 400, cors);

  const to = (env.SUPPORT_FORWARD_TO ?? '').trim();
  if (!env.ALERT_MAIL || !to) return json({ ok: false, error: 'unavailable' }, 503, cors);

  const ref = reference();
  const cf = (request as any).cf ?? {};
  const ua = clean(request.headers.get('User-Agent'), 200);
  const first = (msg.summary || msg.message).split('\n')[0];
  let subject = `[${ref}] ${TYPES[type]} · ${area}: ${first}`;
  if (subject.length > 120) subject = `${subject.slice(0, 117)}…`;

  const block = (title: string, text: string) => (text ? [title, text, ''] : []);
  const line = (label: string, text: string) => (text ? [`${label}: ${text}`] : []);
  const device = [msg.device, msg.ios && `iOS ${msg.ios}`, msg.version && `Blades ${msg.version}`].filter(Boolean).join(' · ');
  const body = [
    `${TYPES[type]} · ${area}`,
    `Reference: ${ref}`,
    `From: ${msg.name ? `${msg.name} ` : ''}<${msg.email}>  (reply to this email to answer)`,
    '',
    ...block(type === 'idea' ? 'What they would like Blades to do' : type === 'problem' ? 'What happened' : 'What they need', msg.summary || msg.message),
    ...(msg.summary && msg.message ? block(type === 'idea' ? 'How they would use it' : 'More', msg.message) : []),
    ...block('What they expected', msg.expected),
    ...block('Steps', msg.steps),
    ...line('How often', msg.frequency),
    ...line('How much it matters', msg.impact),
    ...line('Moving from', msg.fromApp),
    ...line('Device', device),
    '',
    '—',
    `Sent from the support form at blades-app.com · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    ...line('Country (from Cloudflare)', clean(cf.country, 4)),
    ...line('Browser', ua),
  ].join('\r\n');

  const mime = [
    'From: Blades support form <ops@blades-app.com>',
    `To: <${to}>`,
    `Reply-To: <${msg.email}>`,
    `Subject: ${encodeSubject(subject)}`,
    `Message-ID: <${crypto.randomUUID()}@blades-app.com>`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(body).replace(/(.{76})(?=.)/g, '$1\r\n'),
  ].join('\r\n');

  try {
    await env.ALERT_MAIL.send(new EmailMessage('ops@blades-app.com', to, mime));
  } catch {
    return json({ ok: false, error: 'send' }, 502, cors);
  }
  await countSupportMessage(env);
  return json({ ok: true, ref }, 200, cors);
}
