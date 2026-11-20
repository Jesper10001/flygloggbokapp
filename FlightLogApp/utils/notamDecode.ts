// NOTAM i klartext för AD info-kortet, helt regelbaserat (ingen AI, inga gissningar). Reglerna är framtagna ur
// LFV:s riktiga bulletiner 2026-11-20 (VFR 24hr, IFR 24hr och 99 days: 256 NOTAM, 40 SNOWTAM):
// 1) Öppettider ("… HOURS OF SERVICE ARE NOW MON-FRI 0545-0645 0755-0915, SAT CLSD …" eller per datum
//    "24 DEC: 0700-1430") → rader per dag/datum; en hel vecka med högst ett pass per dag → veckorad.
// 2) SNOWTAM (GRF-formatet "ESMX 11201436 01 6/6/6 25/25/25 NR/NR/NR WET/WET/WET …") → en rad per bana:
//    beläggning, täckning, djup och bromsverkan (RWYCC), sedan anmärkningarna i klartext.
// 3) Övrig text: ICAO-förkortningar (Doc 8400) utskrivna, vanlig engelska med gemener, ortnamn med stor
//    bokstav, waypoints/fyrar/ICAO-koder i versaler, e-post och webbadresser orörda.
// Det som inte går att läsa entydigt visas som text — och originalet finns alltid ett tryck bort i kortet.

export type DayHours = { d: string; h: string | null; next: boolean; closed: boolean; h24: boolean }; // h = "0445-2100" (UTC)
export type HoursRow = { label: string; iv: string[]; closed: boolean; h24: boolean };
export type HoursNotam = { title: string; grid: DayHours[] | null; rows: HoursRow[]; note: string };

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const DAY_LABEL = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const IV = String.raw`(?:\d{4}\s*-\s*\d{4}\s*)+`;

/** Rättar PDF-hopklistringar ("ARE NOWMON-TUE", "AMSL.LGTD") innan texten tolkas. */
function prep(text: string): string {
  return text.toUpperCase()
    .replace(/\b(NOW|TO|ARE)(?=(MON|TUE|WED|THU|FRI|SAT|SUN)\b)/g, '$1 ')
    .replace(/\b(AMSL|AGL|FT)\.(?=[A-Z])/g, '$1. ');
}

function hoursTitle(t: string): string {
  if (/\bAPPROACH CONTROL\b|\(APP\)/.test(t)) return 'Approach hours';
  if (/\bAFIS\b/.test(t)) return 'AFIS hours';
  if (/\b(TWR|TOWER|ATS)\b/.test(t)) return 'Tower hours';
  if (/\b(AD|AERODROME|AIRPORT)\b/.test(t)) return 'Aerodrome hours';
  return 'Hours';
}
const ivList = (v: string) => (v.match(/\d{4}\s*-\s*\d{4}/g) ?? []).map((x) => x.replace(/\s+/g, ''));

export function parseHoursNotam(text: string): HoursNotam | null {
  const t = prep(text);
  if (!/\b(HOURS|HRS|HR)\b/.test(t)) return null;
  const title = hoursTitle(t);
  let lastEnd = 0;

  // ── Veckodagar ──
  const reDay = new RegExp(String.raw`\b(MON|TUE|WED|THU|FRI|SAT|SUN)(?:\s*-\s*(MON|TUE|WED|THU|FRI|SAT|SUN))?\s+(${IV}|CLSD\b|CLOSED\b|H24\b)`, 'g');
  const got: ({ iv: string[]; closed: boolean; h24: boolean } | undefined)[] = new Array(7).fill(undefined);
  let m: RegExpExecArray | null, n = 0;
  while ((m = reDay.exec(t))) {
    const a = DAYS.indexOf(m[1]), b = m[2] ? DAYS.indexOf(m[2]) : a;
    if (b < a) return null;
    const v = m[3].trim(), closed = /^(CLSD|CLOSED)/.test(v), h24 = v === 'H24';
    for (let i = a; i <= b; i++) {
      if (got[i]) return null;                       // samma dag två gånger → inte entydigt
      got[i] = { iv: closed || h24 ? [] : ivList(v), closed, h24 };
    }
    n++; lastEnd = reDay.lastIndex;
  }
  if (n) {
    const note = restNote(t.slice(lastEnd));
    if (got.every(Boolean)) {
      const g = (got as { iv: string[]; closed: boolean; h24: boolean }[]).map((x) => ({ ...x, iv: [...x.iv] }));
      const next = new Array(7).fill(false);
      for (let i = 0; i < 7; i++) {                  // över midnatt: "MON 0530-2359, TUE 0000-0115 …" → 0530–0115 (+1)
        const j = (i + 1) % 7, last = g[i].iv[g[i].iv.length - 1], first = g[j].iv[0];
        if (last?.endsWith('-2359') && first?.startsWith('0000-')) {
          g[i].iv[g[i].iv.length - 1] = last.slice(0, 5) + first.slice(5); next[i] = true; g[j].iv.shift();
        }
      }
      if (g.every((x) => x.iv.length <= 1)) {
        const grid = g.map((x, i) => ({ d: DAY_LABEL[i], h: x.iv[0] ?? null, next: next[i], h24: x.h24, closed: x.closed || (!x.h24 && !x.iv.length) }));
        return { title, grid, rows: [], note };
      }
    }
    // Flera pass per dag eller bara vissa dagar: rader, intilliggande dagar med samma tider slås ihop ("Mon–Fri")
    const rows: HoursRow[] = [];
    let i = 0;
    while (i < 7) {
      if (!got[i]) { i++; continue; }
      let j = i;
      while (j + 1 < 7 && got[j + 1] && JSON.stringify(got[j + 1]) === JSON.stringify(got[i])) j++;
      const x = got[i]!;
      rows.push({ label: i === j ? DAY_LABEL[i] : `${DAY_LABEL[i]}–${DAY_LABEL[j]}`, iv: x.iv, closed: x.closed, h24: x.h24 });
      i = j + 1;
    }
    return { title, grid: null, rows, note };
  }

  // ── Datum ("24 DEC: 0700-1430", "31DEC 0530-1030, 01JAN CLSD") ──
  const reDate = new RegExp(String.raw`\b(\d{1,2})\s?(${MONTHS.join('|')})(?:\s\d{4})?:?\s+(${IV}|CLSD\b|CLOSED\b)`, 'g');
  const rows: HoursRow[] = [];
  while ((m = reDate.exec(t))) {
    const closed = /^(CLSD|CLOSED)/.test(m[3]);
    rows.push({ label: `${+m[1]} ${m[2][0]}${m[2].slice(1).toLowerCase()}`, iv: closed ? [] : ivList(m[3]), closed, h24: false });
    lastEnd = reDate.lastIndex;
  }
  if (rows.length) return { title, grid: null, rows, note: restNote(t.slice(lastEnd)) };
  return null;
}
/** Text efter tiderna ("OTHER HRS O/R TEL …", "SERVICE PROVIDED ACCORDING TO …") i klartext. */
function restNote(rest: string): string {
  const r = rest.replace(/^[\s.,;]+/, '').trim();
  return r.length > 3 ? decodeNotamText(r) : '';
}

/** Svensk lokal tid (CET/CEST) för en UTC-tid ett visst datum: EU-sommartid sista söndagen i mars–oktober. */
export function seOffsetHours(at: Date): number {
  const y = at.getUTCFullYear();
  const lastSun = (mon: number) => { const d = new Date(Date.UTC(y, mon + 1, 0, 1)); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d; };
  return at >= lastSun(2) && at < lastSun(9) ? 2 : 1;
}
export function shiftHHMM(hhmm: string, hours: number): string {
  const h = (+hhmm.slice(0, 2) + hours) % 24;
  return String(h).padStart(2, '0') + hhmm.slice(2);
}

// ── SNOWTAM (ICAO GRF) ──
const CONTAMINANTS = ['DRY SNOW ON TOP OF COMPACTED SNOW', 'WET SNOW ON TOP OF COMPACTED SNOW', 'WATER ON TOP OF COMPACTED SNOW',
  'DRY SNOW ON TOP OF ICE', 'WET SNOW ON TOP OF ICE', 'SPECIALLY PREPARED WINTER RUNWAY', 'COMPACTED SNOW', 'STANDING WATER',
  'SLIPPERY WET', 'DRY SNOW', 'WET SNOW', 'WET ICE', 'SLUSH', 'FROST', 'ICE', 'WET', 'DRY', 'NR'];
const BRAKING: Record<string, string> = { '6': 'normal', '5': 'good', '4': 'good to medium', '3': 'medium', '2': 'medium to poor', '1': 'poor', '0': 'less than poor' };
export type SnowRunway = { rwy: string; line: string };
export type Snowtam = { observed: string; runways: SnowRunway[]; remarks: string };

export function parseSnowtam(text: string): Snowtam | null {
  const t = text.toUpperCase().replace(/^\d{2} [A-Z]{3} \d{4} \d{2}:\d{2}FROM:\s*/, '').replace(/\s+/g, ' ').trim();
  const C = `(${CONTAMINANTS.join('|')})`;
  const re = new RegExp(String.raw`(\d{8}) (\d{2}[LRC]?) ([0-6]|NR)\/([0-6]|NR)\/([0-6]|NR) (\d{1,3}|NR)\/(\d{1,3}|NR)\/(\d{1,3}|NR) (\d{2,3}|NR)\/(\d{2,3}|NR)\/(\d{2,3}|NR) ${C}\/${C}\/${C}(?= |$)`, 'g');
  const runways: SnowRunway[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null, end = 0, observed = '';
  while ((m = re.exec(t))) {
    end = re.lastIndex;
    const mon = MONTHS[+m[1].slice(0, 2) - 1];
    if (!observed && mon) observed = `${+m[1].slice(2, 4)} ${mon[0]}${mon.slice(1).toLowerCase()} ${m[1].slice(4, 6)}:${m[1].slice(6, 8)}Z`;
    const key = m.slice(2, 15).join(' ');
    if (seen.has(key)) continue;                     // samma bana upprepad i bulletinen
    seen.add(key);
    const cc = [m[3], m[4], m[5]], cov = [m[6], m[7], m[8]], dep = [m[9], m[10], m[11]], con = [m[12], m[13], m[14]];
    const same = (a: string[]) => a[0] === a[1] && a[1] === a[2];
    const low = (s: string) => s.toLowerCase();
    const surface = con.every((x) => x === 'NR') ? '' : same(con) ? cap(low(con[0])) : cap(con.map((x) => (x === 'NR' ? '–' : low(x))).join(' / '));
    const covTxt = cov.every((x) => x === 'NR') ? '' : same(cov) ? `${+cov[0]} %` : `${cov.map((x) => (x === 'NR' ? '–' : +x)).join('/')} %`;
    const depTxt = dep.every((x) => x === 'NR') ? '' : same(dep) ? `${+dep[0]} mm deep` : `${dep.map((x) => (x === 'NR' ? '–' : +x)).join('/')} mm deep`;
    const brk = cc.every((x) => x === 'NR') ? '' : same(cc)
      ? `Braking ${BRAKING[cc[0]]}`
      : `Braking ${cc.map((x) => BRAKING[x] ?? '–').join(' / ')}`;
    const surfacePart = [surface, covTxt, depTxt].filter(Boolean).join(', ');
    runways.push({ rwy: m[2], line: [surfacePart, brk ? `${brk} (${cc.join('/')})` : ''].filter(Boolean).join(' · ') });
  }
  if (!runways.length) return null;
  const rest = t.slice(end).split(/\bE[A-Z]{3} - /)[0].trim();   // bulletinens nästa flygplats hör inte hit
  // Anmärkningar: "REMARK/" och " / " som skiljetecken, dubbletter bort
  const parts = [...new Set(rest.replace(/REMARK\//g, '. ').split(/\s*(?:\.\s|\.$|\s\/\s)\s*/).map((x) => x.trim().replace(/\.$/, '')).filter((x) => x.length > 1))];
  return { observed, runways, remarks: parts.length ? decodeNotamText(parts.join('. ') + '.') : '' };
}

// ── Klartext ──
const ABBR: Record<string, string> = {
  RWY: 'runway', RWYS: 'runways', TWY: 'taxiway', TWYS: 'taxiways', APN: 'apron', APNS: 'aprons', THR: 'threshold',
  CLSD: 'closed', 'U/S': 'unserviceable', AVBL: 'available', UNAVBL: 'unavailable', BTN: 'between', WIP: 'work in progress',
  RCL: 'runway centre line', EQPT: 'equipment', HGT: 'height', ELEV: 'elevation', AD: 'aerodrome', ACFT: 'aircraft',
  LDG: 'landing', TKOF: 'take-off', TAKEOFF: 'take-off', COND: 'condition', MIL: 'military', SER: 'service', HR: 'hours', HRS: 'hours',
  OPS: 'operations', FLT: 'flight', FLTS: 'flights', OBST: 'obstacle', OBSTS: 'obstacles', LGT: 'light', LGTS: 'lights',
  LGTD: 'lighted', ACT: 'active', ADJ: 'adjacent', ARR: 'arrival', DEP: 'departure', INFO: 'information', NML: 'normal',
  OPR: 'operating', PSN: 'position', REF: 'reference', REQ: 'request', SFC: 'surface', SKED: 'scheduled', TEMPO: 'temporary',
  TRG: 'training', VIS: 'visibility', FM: 'from', TIL: 'until', WEF: 'with effect from', APCH: 'approach', LOC: 'localizer',
  GP: 'glide path', INOP: 'inoperative', MAINT: 'maintenance', CTN: 'caution', DIST: 'distance', EXC: 'except',
  FLW: 'following', INSTL: 'installed', MOV: 'movement', PARL: 'parallel', PERM: 'permanent', PROC: 'procedure', RTE: 'route',
  SVC: 'service', TFC: 'traffic', TWR: 'tower', WI: 'within', WID: 'width', AVL: 'available', DTHR: 'displaced threshold',
  BLW: 'below', ABV: 'above', APRX: 'approximately', ESTB: 'established', CONST: 'construction', CONS: 'construction',
  TDZ: 'touchdown zone', SPD: 'speed', LEN: 'length', RMK: 'remark', DLY: 'daily', HOL: 'holidays', HOSP: 'hospital',
  MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun',
  JAN: 'Jan', FEB: 'Feb', MAR: 'Mar', APR: 'Apr', MAY: 'May', JUN: 'Jun', JUL: 'Jul', AUG: 'Aug', SEP: 'Sep', OCT: 'Oct', NOV: 'Nov', DEC: 'Dec',
  'O/R': 'on request', TEL: 'phone', PN: 'prior notice', BLD: 'building', CHG: 'changed', CHNAGED: 'changed', AVAIABLE: 'available',
  ADVICED: 'advised', TGL: 'touch-and-go landings', ARP: 'aerodrome reference point', RGL: 'runway guard lights',
  IAP: 'instrument approach procedures', IAC: 'instrument approach chart', WPT: 'waypoint', WPTS: 'waypoints', VAR: 'variation',
  MAG: 'magnetic', GND: 'ground', APP: 'approach', MHZ: 'MHz', KHZ: 'kHz', AMDT: 'amendment', RWYCC: 'runway condition code',
  KFOR: 'potassium formate', OBS: 'observed', VNA: 'vertical navigation', LDI: 'landing direction indicator',
};
// Står kvar i versaler (förkortningar piloter känner)
const KEEP = new Set(['PPR', 'PAPI', 'ILS', 'VOR', 'DME', 'NDB', 'TACAN', 'UHF', 'VHF', 'ATS', 'AFIS', 'ATC', 'ATIS', 'VFR', 'IFR', 'AGL', 'AMSL', 'MSL',
  'FT', 'NM', 'KG', 'MTOW', 'MTOM', 'GNSS', 'GPS', 'RNAV', 'RNP', 'LPV', 'LNAV', 'VNAV', 'UTC', 'GA', 'FOD', 'SNOWTAM', 'NOTAM', 'AIP', 'SUP',
  'AIC', 'AIRAC', 'CTR', 'TMA', 'TIZ', 'TIA', 'ATZ', 'RVR', 'ALS', 'SALS', 'HIALS', 'REDL', 'RTIL', 'TODA', 'TORA', 'ASDA', 'LDA', 'UAS',
  'HEMS', 'SAR', 'ACC', 'FATO', 'TLOF', 'SID', 'STAR', 'OCA', 'OCH', 'RDH', 'PAR', 'SRE', 'EASA', 'VFG', 'LED', 'SMS', 'CAT', 'FIR', 'FL', 'ENR']);
// Vanliga engelska ord i NOTAM → gemener (allt annat räknas som namn)
const ENGLISH = new Set(`A AN AS AT BE BY IF IN IS IT NO OF ON OR TO UP WAS ALSO ANY EACH ITS NORTH EAST SOUTH WEST NORTHEAST NORTHWEST
SOUTHEAST SOUTHWEST HAVE HAD WERE NOR PER INTO ONTO OFF THEN THERE THESE THOSE THEY WHICH WHILE ABOVE ACCORDANCE ACCORDING ACTIVATED
ADDITIONAL ADDITIONALLY ADMINISTRATION ADVISED AERODROME AFFECTED AFTER AGREES AIRCRAFT AIRPORT ALL ALLOWED ALTITUDE AMBULANCE AND
ANEMOMETER APPLICABLE APPLIED APPLY APPROACH APRON APRONS ARE AREA AREAS ARRESTING AUTHORITY AUTHORIZED AVAILABILITY AVAILABLE AVGAS
AVIATION AVOID BEACON BEARING BEEN BEFORE BEING BELOW BETWEEN BOUNDED BREACH CAN CAPABILITY CAPACITY CAUTION CENTERED CENTRED CERTIFICATE
CHANGED CHARGE CHART CHARTS CHEMICALLY CHRISTMAS CIRCLE CIRCLING CIVIL CLEARANCE CLOSED COAST CODING COMMISSION COMPACTED COMPLIANCE
COMPLY CONDITION CONDITIONS CONSTRUCTION CONTACT CONTAMINANT CONTINGENCY CONTROL CONTROLS CRACKS CRANE CRANES CREW CROSS DANGER DATED
DAYLIGHT DEBRIS DEICED DEPARTURE DEPARTURES DIRECTED DIRECTION DIRECTIVE DISABLED DISTANCE DOWN DOWNGRADED DRIFTING DRY DUE DURING EDGE
ELEMENT EMAIL MAIL EMISSION END ENSURE ERECTED ESTABLISHED EXCAVATOR EXCEPT EXEMPTED EXIT EXTENDED FADED FAILURE FIRST FIX FIXED RED
FLASHING WHITE GREEN YELLOW BLUE FLIGHT FLIGHTS FOLLOWING FOLLOWS FOR FORE FOREIGN FOUND FREQUENCY FRICTION FROM FROST FROZEN FUEL FUELING
FURTHER GRASS GROUNDHANDLER GROUNDHANDLING GUARD HANDLING HARBOUR HAS HELIPORT HOLDING HOLES HOURS IDENTIFIER INCIDENT INCLUDE INCLUDING
INDICATOR INSTEAD INSTRUMENT INTERRUPTIONS ISSUED JAMMING JET LANDING LASER LATERAL LIGHTS LIGHT LIGHTED LIMIT LIMITED LIMITS LINE
LOCALIZER LOCATION LONGER LOOSE LOSE LOWER MACROTEXTURE MAINTENANCE MAKE MARKINGS MAST MAX MAY METERS METRES MILITARY MINIMA MISSION
MOBILE MODE MORE MOVING MUST NEAR NEEDS NET NEW NON NOT NOTICE NOTIFICATION NOW OBJECT OBTAIN OBTAINED OMNIDIRECTIONAL ONLY OPEN OPENING
OPERATING OPERATIONS OPERATOR OPERATORS ORDER OTHER OUT OUTSIDE OVER OWN PARKING PART PARTICIPATING PARTLY PATCHES PERCENT PERFORMED
PERMISSION PERMITS PERMITTED PHONE PLACE POINT POLICE POOR POSSIBLE PRECIPITATION PRECISION PROCEDURE PROCEDURES PROCESSING PROGRESS
PROHIBITED PROTECTION PROVIDED PROVIDER PUBLISHED PURPOSES RADAR RADIO RADIUS RAISED READ REFERENCE REGARDING REMARK REMOVAL REPORT
REPORTED REQUEST REQUESTS REQUIRED REQUIREMENTS RESCUE RESPECTIVE RESTRICTED RESULT RIDGES RIGHT LEFT RISK RUTS SAFETY SANCTION SANCTIONS
SAND SANDED SCHEDULED SCHEDULE SCHOOL SECOND SECTOR SECURITY SELF SEPARATE SERVICE SERVICES SHALL SHARP SHOULD SIDE SIGNAL SIGNED
SIGNIFICANT SIGNS SLUSH SNOW SOFT SPACE SPOOFING STAND STATE STATION STEP STRENGTH STRETCHER SUBMISSION SUBMITTED SUNDAYS SURFACE
SURVEILLANCE SUSPICION SYSTEM TABLE TABLES TAKE TALL TAXIWAYS TEMPLATE TEMPORARY THAN THAT THE THIN THIRD THIS TIME TIMES TOP TOWER
TRAFFIC TREATED TRIGGER TRUCK TURNS TYPE UNDERTAKING UNTIL UPDATED UPGRADED UPON UPPER UREA USE USING VALID VECTORING VERIFICATION VIA
VICINITY VISITING WAYPOINT WEEKLY WET WHEN WHERE WILL WIND WITH WITHDRAWN WITHIN WORK YEAR WATER STANDING ICE RUNWAY RUNWAYS
TAXIWAY OBSTACLE OBSTACLES EQUIPMENT HEIGHT ELEVATION SERVICEABLE UNSERVICEABLE PERMANENT ACTIVE INACTIVE AMENDMENT
DAILY DAYS DAY WEEK MONTH HOLIDAYS EVERY ONE TWO THREE`.split(/\s+/));
// Ortnamn på fem bokstäver (annars räknas fem versaler som waypoint- eller fyrnamn)
const PLACES5 = new Set(['VISBY', 'LULEA', 'MALMO', 'BORAS']);

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const isUrl = (s: string) => /@|^(WWW\.|HTTPS?:)/i.test(s) || /\.(SE|COM|NET|ORG|EU)(\/|$)/i.test(s);

function word(core: string): string {
  if (!core) return core;
  if (isUrl(core)) return core.toLowerCase();
  const up = core.toUpperCase();
  if (ABBR[up]) return ABBR[up];
  if (KEEP.has(up) || /\d/.test(core)) return core;
  if (/^[A-Z]+([-/][A-Z]+)+$/.test(up)) return up.split(/([-/])/).map((p) => (p === '-' || p === '/' ? p : p.length === 1 ? p : word(p))).join('');
  if (ENGLISH.has(up)) return up.toLowerCase();
  if (/^E[A-Z]{3}$/.test(up)) return up;                                    // ICAO-kod (ESMS, EKRN)
  if (up.length <= 3 || (up.length === 5 && !PLACES5.has(up))) return up;    // fyr-/waypointnamn (ROE, ORCOX), korta förkortningar
  return up[0] + up.slice(1).toLowerCase();                                // ortnamn: Ostgota, Linkoping
}

const DIR: Record<string, string> = { N: 'NORTH', S: 'SOUTH', E: 'EAST', W: 'WEST', NE: 'NORTHEAST', NW: 'NORTHWEST', SE: 'SOUTHEAST', SW: 'SOUTHWEST' };

export function decodeNotamText(text: string): string {
  const t = prep(text)
    .replace(/\(AT\)/g, '@')
    .replace(/\b(AERODROME )?CONTROL TOWER \(TWR\)/g, 'TOWER')
    .replace(/\bAPPROACH CONTROL SERVICE \(APP\)/g, 'APPROACH CONTROL')
    .replace(/\bLGTD F R\b/g, 'LIGHTED (FIXED RED)')
    .replace(/\bLGTD FLG W\b/g, 'LIGHTED (FLASHING WHITE)')
    .replace(/\b(NE|NW|SE|SW|N|S|E|W) OF\b/g, (_, c) => `${DIR[c]} OF`)
    .replace(/\bDUE (?!TO\b)/g, 'DUE TO ')
    .replace(/\s+/g, ' ').trim();
  let start = true, prev = '', prevDesig = false;
  return t.split(' ').map((w) => {
    const mm = w.match(/^([("'[]*)(.*?)([.,;:)\]"'!?]*)$/);
    const [, pre, core, post] = mm ?? ['', '', w, ''];
    // Beteckningar (TWY A, TWYS A/C, APN S, CAT A, "TWY A B C") står kvar i versaler
    const desig = /^[A-Z]\d?([/][A-Z]\d?)*$/.test(core) && (/^(TWY|TWYS|TAXIWAY|TAXIWAYS|APN|APNS|APRON|APRONS|CAT|POINT|AND)$/.test(prev) || prevDesig);
    let out = desig ? core : word(core);
    prevDesig = desig || (/^(TWY|TWYS|APN|APNS)$/.test(prev) && /^[A-Z]\d?([/][A-Z]\d?)*$/.test(core));
    prev = core;
    if (start && out && !isUrl(core) && /^[a-z]/.test(out)) out = cap(out);
    start = /[.!?]$/.test(post);
    return pre + out + post;
  }).join(' ');
}
