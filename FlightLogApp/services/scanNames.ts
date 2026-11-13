// Andrepiloternas namn i en skanning, kontrollerade mot de namn som redan finns. Samma person skrivs lätt på flera
// sätt (WOLFF, Wolff) eller läses fel på en bokstav (WOFF), och varje skrivsätt blev en egen person i Log Flight.
// Här blir de ett namn: det mest använda. Ren logik utan I/O (scripts/test-scan-names.cjs).
//
//  - Samma bokstäver oavsett stora/små, mellanslag och accenter är alltid samma person.
//  - En bokstavs skillnad räknas som samma person när namnen har minst fyra bokstäver. Initialer (PU, PUA) är
//    korta och olika personer har ofta nästan samma, så de slås aldrig ihop på likhet.
//  - Två namn som båda används ofta (ESTABLISHED flygningar) är troligen två personer (Wolf, Wolff) och hålls isär.
// Likhet visas i rapporten, där de kan hållas isär.

const MIN_FUZZY = 4;
const ESTABLISHED = 5;

export const nameKey = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

export interface NameGroup {
  id: string;                    // nycklarna, sorterade
  name: string;                  // namnet raderna får
  spellings: string[];           // skrivsätten i skanningen som inte redan är namnet
  keys: string[];                // nycklarna som slagits ihop på likhet
  rows: number;
  similar: boolean;              // ihopslagna på likhet, inte bara stora/små bokstäver
}

export function resolveNames(
  scanned: string[], known: { name: string; n: number }[], separate: Set<string> = new Set(),
): { groups: NameGroup[]; nameOf: (written: string) => string } {
  // Skrivsätt och användning per nyckel, från skanningen och tidigare flygningar.
  const entries = new Map<string, { spell: Map<string, number>; flown: number; rows: number }>();
  const entry = (k: string) => { let e = entries.get(k); if (!e) { e = { spell: new Map(), flown: 0, rows: 0 }; entries.set(k, e); } return e; };
  for (const { name, n } of known) {
    const k = nameKey(name);
    if (!k) continue;
    const e = entry(k);
    e.flown += n;
    e.spell.set(name.trim(), (e.spell.get(name.trim()) ?? 0) + n);
  }
  for (const raw of scanned) {
    const k = nameKey(raw), name = raw.trim();
    if (!k) continue;
    const e = entry(k);
    e.rows++;
    e.spell.set(name, (e.spell.get(name) ?? 0) + 1);
  }
  // Mest använda först: ett felläst namn ansluter sig till det etablerade.
  const keys = [...entries.keys()].sort((a, b) => (entries.get(b)!.flown + entries.get(b)!.rows) - (entries.get(a)!.flown + entries.get(a)!.rows) || a.localeCompare(b));
  const root = new Map<string, string>();
  for (const k of keys) {
    const home = separate.has(k) || k.length < MIN_FUZZY ? null : [...new Set(root.values())].find((r) => {
      if (r.length < MIN_FUZZY || separate.has(r) || !withinOneEdit(r, k)) return false;
      return !(entries.get(r)!.flown >= ESTABLISHED && entries.get(k)!.flown >= ESTABLISHED);
    });
    root.set(k, home ?? k);
  }
  const best = (r: string) => {
    let top = '', n = -1;
    for (const k of keys) if (root.get(k) === r) for (const [s, c] of entries.get(k)!.spell) if (c + (k === r ? 0.5 : 0) > n) { top = s; n = c + (k === r ? 0.5 : 0); }
    return top;
  };
  const groups: NameGroup[] = [];
  for (const r of new Set(root.values())) {
    const members = keys.filter((k) => root.get(k) === r);
    const rows = members.reduce((t, k) => t + entries.get(k)!.rows, 0);
    if (!rows) continue;
    const name = best(r);
    const spellings = [...new Set(members.filter((k) => entries.get(k)!.rows > 0).flatMap((k) => [...entries.get(k)!.spell.keys()]))].filter((s) => s !== name);
    groups.push({ id: [...members].sort().join('|'), name, spellings, keys: members.filter((k) => k !== r), rows, similar: members.length > 1 });
  }
  return { groups, nameOf: (written) => { const r = root.get(nameKey(written)); return r ? best(r) : written; } };
}

// ── Är det en person? ────────────────────────────────────────────────────────
// Skanningen har tagit ord i anmärkningen eller namnkolumnen för en andrepilot ("Line check", "Ferry", "SELF").
// Ett namn är för- och efternamn (Anna Berg, J. Andersson, van der Berg), ett efternamn (Wolff, BERG) eller
// initialer/callsign på två–tre bokstäver (SZ, PUA). Flygtermer, vanliga ord, siffror och meningar är det inte.
// Ett namn som redan finns i loggboken godtas alltid.

// Flyg- och anmärkningsord (engelska och svenska) som aldrig är en andrepilot. Jämförs som nameKey (A–Z utan
// accenter), så ÖVNING står som OVNING.
const NOT_NAME_WORDS = new Set([
  // Inflygning, navigation, regler
  'ILS', 'NDB', 'VOR', 'GPS', 'RNAV', 'LOC', 'DME', 'PAR', 'GCA', 'RNP', 'LPV', 'LNAV', 'VNAV', 'RVR', 'GLS', 'SRA', 'ASR',
  'NPA', 'PA', 'APV', 'TACAN', 'ADF', 'IFR', 'VFR', 'SVFR', 'IMC', 'VMC', 'SID', 'STAR', 'ATC', 'TWR', 'TOWER', 'GND', 'RWY',
  'RUNWAY', 'APP', 'APPS', 'APPR', 'APPROACH', 'APPROACHES', 'HOLD', 'HOLDS', 'HOLDING', 'MISSED', 'CIRCLING', 'VISUAL', 'NAV',
  'NAVEX', 'XC', 'CROSS', 'COUNTRY', 'ROUTE', 'VIA', 'WX', 'WEATHER', 'DIVERT', 'DIVERSION', 'RTB', 'RETURN', 'ALT', 'ALTN',
  // Roller och personal
  'PIC', 'SIC', 'PICUS', 'SPIC', 'PUS', 'COP', 'COPILOT', 'FO', 'CAPT', 'CAPTAIN', 'CMD', 'COMMANDER', 'PF', 'PM', 'INSTR',
  'INSTRUCTOR', 'STUDENT', 'TRAINEE', 'CANDIDATE', 'EXAMINER', 'PAX', 'PASSENGER', 'PASSENGERS', 'CREW', 'DUAL', 'SOLO',
  // Utbildning och kontroller
  'PC', 'OPC', 'LPC', 'CRM', 'MCC', 'JOC', 'IR', 'EIR', 'CBIR', 'SE', 'ME', 'SP', 'MP', 'SEP', 'MEP', 'CPL', 'PPL', 'LAPL',
  'ATPL', 'FI', 'CRI', 'IRI', 'TRI', 'SFI', 'TRE', 'SFE', 'FE', 'IRE', 'CRE', 'ATO', 'CAA', 'TS', 'SKILL', 'PROFICIENCY',
  'CHECK', 'CHECKRIDE', 'CK', 'EXAM', 'EXAMINATION', 'TEST', 'LINE', 'BASE', 'TYPE', 'RATING', 'REVALIDATION', 'RENEWAL',
  'RECURRENT', 'INITIAL', 'CONVERSION', 'DIFFERENCES', 'FAM', 'FAMILIARISATION', 'FAMILIARIZATION', 'LIFUS', 'IOE',
  'SUPERVISED', 'RELEASE', 'UPGRADE', 'TRAINING', 'LESSON', 'EXERCISE', 'EX', 'STAGE', 'PHASE', 'BRIEF', 'BRIEFING', 'DEBRIEF',
  'SCHOOL', 'SIM', 'SIMULATOR', 'FFS', 'FTD', 'FNPT', 'BITD',
  // Flygningens slag och manövrar
  'FLIGHT', 'FLT', 'FLYING', 'LOCAL', 'AREA', 'GENERAL', 'HANDLING', 'GH', 'CIRCUIT', 'CIRCUITS', 'CCTS', 'TGL', 'TNG', 'TOUCH',
  'GO', 'LANDING', 'LANDINGS', 'TAKEOFF', 'TAKEOFFS', 'NIGHT', 'DAY', 'FERRY', 'POSITIONING', 'POS', 'REPO', 'DEADHEAD', 'DH',
  'TAXI', 'TOW', 'TOWING', 'GLIDER', 'BANNER', 'AEROBATICS', 'SPIN', 'SPINS', 'STALL', 'STALLS', 'STEEP', 'TURNS', 'FORCED',
  'PFL', 'EFATO', 'EMERG', 'EMERGENCY', 'ENGINE', 'FAILURE', 'OEI', 'AEO', 'AUTO', 'AUTOS', 'AUTOROTATION', 'HOVER',
  'CONFINED', 'PINNACLE', 'SLOPE', 'MOUNTAIN', 'OFFSHORE', 'RIG', 'SHIP', 'DECK', 'HOIST', 'WINCH', 'SLING', 'EXTERNAL',
  'LOAD', 'CARGO', 'MISSION', 'SORTIE', 'OPS', 'OPERATION', 'SAR', 'HEMS', 'HHO', 'MEDEVAC', 'AMBULANCE', 'RESCUE', 'POLICE',
  'PATROL', 'FIRE', 'FIREFIGHTING', 'BAMBI', 'SURVEY', 'PHOTO', 'DEMO', 'AIRTEST', 'TECH', 'MAINT', 'MAINTENANCE', 'ABORT',
  'ABORTED', 'CANCELLED', 'CANCELED', 'NVG', 'NVD', 'NVIS', 'TER', 'AR', 'LL', 'LLR', 'KF', 'FF', 'ERF', 'TIS',
  'ACFT', 'AIRCRAFT', 'HELI', 'HELICOPTER', 'PLANE', 'DRONE', 'FIELD', 'STRIP', 'HOME', 'APRON', 'UPPER', 'AIR', 'WORK',
  'SELF', 'MYSELF', 'NIL', 'NONE', 'NA', 'TBA', 'TBC', 'SEE', 'NOTE', 'NOTES', 'REMARK', 'REMARKS', 'OK',
  // Vanliga småord
  'THE', 'AND', 'WITH', 'FROM', 'TO', 'FOR', 'OF', 'IN', 'ON', 'AT', 'BY', 'NO', 'NOT', 'AS', 'ALL', 'GOOD', 'OFF', 'OUT',
  // Svenska
  'SKOLFLYG', 'SKOLNING', 'OVNING', 'NATT', 'LOKALT', 'LOKAL', 'NAVIGERING', 'STRACKA', 'FLYGNING', 'FLYG', 'PROV',
  'KONTROLL', 'UTBILDNING', 'TRAFIKVARV', 'VARV', 'LANDNING', 'LANDNINGAR', 'INFLYGNING', 'INFLYGNINGAR', 'ELEV', 'LARARE',
  'INSTRUKTOR', 'BEFALHAVARE', 'PASSAGERARE', 'FRAKT', 'OVERFLYGNING', 'FARJNING', 'UPPVISNING', 'RADDNING', 'BRAND',
  'POLIS', 'AMBULANS', 'SJUKTRANSPORT', 'UPPDRAG', 'TEKNISK', 'PROVFLYGNING', 'AVBRUTEN', 'INSTALLD', 'VADER', 'MED', 'OCH',
  'TILL', 'FRAN', 'PA', 'SJALV', 'JAG', 'MIG',
]);
// Betyder att piloten själv var befälhavare: ingen andrepilot alls (tas bort, inte till anmärkningen).
const SELF_WORDS = new Set(['SELF', 'MYSELF', 'SJALV', 'JAG', 'MIG']);
// Småord i namn: van der Berg, af Klint, de la Cruz, bin Rashid.
const PARTICLES = new Set(['VAN', 'VON', 'DER', 'DEN', 'DE', 'DA', 'DI', 'DU', 'LA', 'LE', 'DEL', 'AF', 'AV', 'TER', 'TEN', 'BIN', 'AL', 'EL', 'MAC', 'MC', 'ST']);

export const isNotNameWord = (word: string) => NOT_NAME_WORDS.has(nameKey(word));

export type PersonKind = 'known' | 'name' | 'initials' | 'self' | 'not';

/** Är texten en person (namn, efternamn, initialer/callsign)? known = nameKey för namn som redan finns. */
export function personCheck(raw: unknown, known?: Set<string>, places: string[] = []): { kind: PersonKind; reason?: string } {
  const text = String(raw ?? '').trim().replace(/\s+/g, ' ');
  const key = nameKey(text);
  if (!key) return { kind: 'not', reason: 'empty' };
  if (SELF_WORDS.has(key)) return { kind: 'self' };
  if (known?.has(key)) return { kind: 'known' };
  if (/\d/.test(text)) return { kind: 'not', reason: 'contains numbers' };
  if (places.some((p) => nameKey(p) === key)) return { kind: 'not', reason: 'a place' };
  const tokens = text.split(/[\s,]+/).map((t) => t.replace(/^[("'“]+|[)"'”.:;]+$/g, '')).filter(Boolean);
  if (text.length > 40 || tokens.length > 4) return { kind: 'not', reason: 'too long for a name' };
  if (/[/&+=@#%<>→?!]/.test(text)) return { kind: 'not', reason: 'not a name' };
  const letters = (t: string) => nameKey(t).replace(/[^A-Z]/g, '');
  if (tokens.some((t) => NOT_NAME_WORDS.has(letters(t)))) return { kind: 'not', reason: 'an aviation or ordinary word' };

  // Ett ord: initialer/callsign (2–3 bokstäver, även "J.T.") eller ett efternamn med stor bokstav.
  if (tokens.length === 1) {
    const t = tokens[0];
    if (/^([A-Za-zÀ-ÿ]\.?){2,3}$/.test(t) && /^[A-ZÀ-Þ]/.test(t)) return { kind: 'initials' };
    if (/^[A-ZÀ-Þ][A-Za-zÀ-ÿ'’-]{3,}$/.test(t)) return { kind: 'name' };
    return { kind: 'not', reason: 'not a name' };
  }
  // Flera ord: varje ord ett namn med stor bokstav, en initial (J. eller J) eller ett småord (van, af, de).
  let named = 0;
  for (const t of tokens) {
    if (PARTICLES.has(letters(t)) && /^[a-zà-ÿ]/.test(t)) continue;
    if (/^[A-ZÀ-Þ]\.?$/.test(t)) continue;
    if (/^[A-ZÀ-Þ][A-Za-zÀ-ÿ'’-]+$/.test(t)) { named++; continue; }
    if (PARTICLES.has(letters(t))) continue;
    return { kind: 'not', reason: 'reads like text, not a name' };
  }
  return named ? { kind: 'name' } : { kind: 'not', reason: 'not a name' };
}

export const isPerson = (raw: unknown, known?: Set<string>, places?: string[]) => {
  const k = personCheck(raw, known, places).kind;
  return k === 'known' || k === 'name' || k === 'initials';
};
