// NOTAM i klartext för Info-kortet, helt regelbaserat (ingen AI, inga gissningar):
// 1) Öppettider ("… HOURS OF SERVICE ARE NOW MON-TUE 0445-2100, …, SAT CLSD, SUN 1325-2215") → veckorad,
//    men bara när alla sju dagarna går att läsa entydigt; annars blir det en vanlig NOTAM.
// 2) Övriga: ICAO-förkortningar (Doc 8400) skrivs ut, gemener med stor bokstav i meningsbörjan. Det som
//    inte finns i listan lämnas som det står. Originaltexten visas alltid ett tryck bort i kortet.

export type DayHours = { d: string; h: string | null; next: boolean; closed: boolean; h24: boolean }; // h = "0445-2100" (UTC); next = slutar dagen efter
export type HoursNotam = { title: string; days: DayHours[] };

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const DAY_LABEL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function parseHoursNotam(text: string): HoursNotam | null {
  const t = text.toUpperCase();
  if (!/\b(HOURS|HR)\b/.test(t) || !/\b(SER|SERVICE|OPS|OPERATING|OPERATIONAL)\b/.test(t)) return null;
  // En dag (eller ett spann) följt av ett eller flera intervall, CLSD eller H24
  const re = /\b(MON|TUE|WED|THU|FRI|SAT|SUN)(?:\s*-\s*(MON|TUE|WED|THU|FRI|SAT|SUN))?\s+((?:\d{4}\s*-\s*\d{4}\s*)+|CLSD\b|CLOSED\b|H24\b)/g;
  const got: ({ iv: string[]; closed: boolean; h24: boolean } | undefined)[] = new Array(7).fill(undefined);
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(t))) {
    const a = DAYS.indexOf(m[1]), b = m[2] ? DAYS.indexOf(m[2]) : a;
    if (b < a) return null;
    const v = m[3].trim();
    const closed = /^CLOSED|^CLSD/.test(v), h24 = v === 'H24';
    const iv = closed || h24 ? [] : (v.match(/\d{4}\s*-\s*\d{4}/g) ?? []).map((x) => x.replace(/\s+/g, ''));
    for (let i = a; i <= b; i++) {
      if (got[i]) return null;                       // samma dag två gånger → inte entydigt
      got[i] = { iv: [...iv], closed, h24 };
    }
    n++;
  }
  if (!n || got.some((x) => !x)) return null;
  const g = got as { iv: string[]; closed: boolean; h24: boolean }[];
  // Öppet över midnatt: "MON 0530-2359, TUE 0000-0115 …" → måndag 0530–0115 (+1)
  const next = new Array(7).fill(false);
  for (let i = 0; i < 7; i++) {
    const j = (i + 1) % 7, last = g[i].iv[g[i].iv.length - 1], first = g[j].iv[0];
    if (last?.endsWith('-2359') && first?.startsWith('0000-')) {
      g[i].iv[g[i].iv.length - 1] = last.slice(0, 5) + first.slice(5);
      next[i] = true;
      g[j].iv.shift();
    }
  }
  if (g.some((x) => x.iv.length > 1)) return null;  // flera pass samma dag ryms inte i veckoraden → vanlig NOTAM
  const days = g.map((x, i) => ({
    d: DAY_LABEL[i], h: x.iv[0] ?? null, next: next[i], h24: x.h24, closed: x.closed || (!x.h24 && !x.iv.length),
  }));
  const title = /\b(TWR|TOWER|ATS|AFIS)\b/.test(t) ? 'Tower hours' : /\b(AD|AERODROME|AIRPORT)\b/.test(t) ? 'Aerodrome hours' : 'Hours';
  return { title, days };
}

/** Svensk lokal tid (CET/CEST) för en UTC-tid "HHMM" ett visst datum: EU-sommartid sista söndagen i mars–oktober. */
export function seOffsetHours(at: Date): number {
  const y = at.getUTCFullYear();
  const lastSun = (mon: number) => { const d = new Date(Date.UTC(y, mon + 1, 0, 1)); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d; };
  return at >= lastSun(2) && at < lastSun(9) ? 2 : 1;
}
export function shiftHHMM(hhmm: string, hours: number): string {
  const h = (+hhmm.slice(0, 2) + hours) % 24;
  return String(h).padStart(2, '0') + hhmm.slice(2);
}

const ABBR: Record<string, string> = {
  RWY: 'runway', RWYS: 'runways', TWY: 'taxiway', TWYS: 'taxiways', APN: 'apron', APNS: 'aprons', THR: 'threshold',
  CLSD: 'closed', 'U/S': 'unserviceable', AVBL: 'available', UNAVBL: 'unavailable', BTN: 'between', WIP: 'work in progress',
  RCL: 'runway centre line', EQPT: 'equipment', HGT: 'height', ELEV: 'elevation', AD: 'aerodrome', ACFT: 'aircraft',
  LDG: 'landing', TKOF: 'take-off', COND: 'condition', MIL: 'military', SER: 'service', HR: 'hours', OPS: 'operations',
  FLT: 'flight', FLTS: 'flights', OBST: 'obstacle', OBSTS: 'obstacles', LGT: 'light', LGTS: 'lights', LGTD: 'lighted',
  ACT: 'active', ADJ: 'adjacent', ARR: 'arrival', DEP: 'departure', INFO: 'information', NML: 'normal', OPR: 'operating',
  PSN: 'position', REF: 'reference', REQ: 'required', SFC: 'surface', SKED: 'schedule', TEMPO: 'temporary', TRG: 'training',
  VIS: 'visibility', FM: 'from', TIL: 'until', WEF: 'with effect from', APCH: 'approach', LOC: 'localizer', GP: 'glide path',
  INOP: 'inoperative', MAINT: 'maintenance', CTN: 'caution', DIST: 'distance', EXC: 'except', FLW: 'following',
  INSTL: 'installed', MOV: 'movement', PARL: 'parallel', PERM: 'permanent', PROC: 'procedure', RTE: 'route', SVC: 'service',
  TFC: 'traffic', TWR: 'tower', WI: 'within', WID: 'width', AVL: 'available', DTHR: 'displaced threshold', NR: 'number',
  BLW: 'below', ABV: 'above', APRX: 'approximately', ESTB: 'established', CONST: 'construction', CONS: 'construction',
  TDZ: 'touchdown zone', SPD: 'speed', LEN: 'length', RMK: 'remark', OBS: 'observed', DLY: 'daily', HOL: 'holidays',
  MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun', DUE: 'due to',
};
// Står kvar som de är (förkortningar piloter känner, enheter, frekvenser)
const KEEP = new Set(['PPR', 'PAPI', 'ILS', 'VOR', 'DME', 'NDB', 'ATS', 'AFIS', 'ATC', 'ATIS', 'VFR', 'IFR', 'AGL', 'AMSL', 'MSL',
  'FT', 'NM', 'KG', 'MTOW', 'MTOM', 'GNSS', 'RNAV', 'RNP', 'LPV', 'UTC', 'GA', 'FOD', 'SNOWTAM', 'NOTAM', 'AIP', 'SUP', 'AIC',
  'CTR', 'TMA', 'TIZ', 'TIA', 'ATZ', 'RVR', 'ALS', 'SALS', 'HIALS', 'REDL', 'RTIL', 'TODA', 'TORA', 'ASDA', 'LDA', 'UAS', 'HEMS', 'SAR']);

export function decodeNotamText(text: string): string {
  const words = text.replace(/\(AT\)/g, '@').replace(/\s+/g, ' ').trim().split(' ');
  const out = words.map((w) => {
    const m = w.match(/^([("']*)(.*?)([.,;:)"']*)$/);
    const [, pre, core, post] = m ?? ['', '', w, ''];
    const up = core.toUpperCase();
    if (ABBR[up]) return pre + ABBR[up] + post;
    // Sammansatt med bindestreck (PPR-REQUESTS): varje del för sig
    if (/^[A-Z]+(-[A-Z]+)+$/.test(core)) return pre + core.split('-').map((x) => ABBR[x] ?? (KEEP.has(x) ? x : x.toLowerCase())).join('-') + post;
    if (KEEP.has(up) || /\d/.test(core)) return pre + core + post;
    if (/^[A-Z]{1,2}$/.test(core) && words.length > 1 && /^(TWY|RWY|APN)$/i.test(words[words.indexOf(w) - 1] ?? '')) return w; // TWY B
    return pre + core.toLowerCase() + post;
  }).join(' ');
  // Stor bokstav i början av varje mening
  return out.replace(/(^|[.!?]\s+)([a-z])/g, (_, a, b) => a + b.toUpperCase());
}
