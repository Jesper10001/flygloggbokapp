// Onboardingens "varför Blades"-ruta: texterna vävs ihop av tre svar. Vägen (var timmarna finns i dag) ger
// rubriken och blocket överst, svaret på "What matters most to you?" ger underraden och första raden, och svaret på
// "What do you want out of your logbook?" ger andra raden. Sista raden säger hur timmarna kommer in.
// Här ligger också räkningen bakom "vad kostar en hel loggbok att skanna" och prisjämförelsen mot en annan app:
// allt räknas på App Stores priser för användaren (RevenueCat), aldrig på inskrivna belopp. Saknas priserna visas
// inga belopp alls.

import type { Ionicons } from '@expo/vector-icons';

export type Prio = 'fast' | 'trust' | 'licence' | 'proof';       // proof = drönarlägets tredje svar
export type Want = 'place' | 'current' | 'overview' | 'split';    // split = drönarlägets andra svar
export type Where = 'paper' | 'digital';
export type Src = 'app' | 'sheet';
export type PitchPath = 'start' | 'paper' | 'paperNoScan' | 'appPricey' | 'appMid' | 'app' | 'sheet';
type Icon = keyof typeof Ionicons.glyphMap;
export interface PitchRow { key: string; icon: Icon; title: string; sub: string }

export const PILOT_PRIOS: { k: Prio; title: string }[] = [
  { k: 'fast', title: 'Logging fast' },
  { k: 'trust', title: 'Numbers I can trust' },
  { k: 'licence', title: 'Reaching my next licence' },
];
export const DRONE_PRIOS: { k: Prio; title: string }[] = [
  { k: 'fast', title: 'Logging fast' },
  { k: 'trust', title: 'Numbers I can trust' },
  { k: 'proof', title: 'Proving my experience' },
];
export const PILOT_WANTS: { k: Want; title: string }[] = [
  { k: 'place', title: 'Everything in one place' },
  { k: 'current', title: "Knowing I'm current" },
  { k: 'overview', title: 'A better overview' },
];
export const DRONE_WANTS: { k: Want; title: string }[] = [
  { k: 'place', title: 'Everything in one place' },
  { k: 'split', title: 'Hours per drone and category' },
  { k: 'overview', title: 'A better overview' },
];
export const PILOT_APPS = ['ForeFlight', 'LogTen', 'mccPILOTLOG', 'eFlightbook', 'Another app'];

// En hel loggbok, som siffrorna i rutan räknar med.
export const BOOK = { flightsLo: 420, flightsHi: 600, spreadsLo: 35, spreadsHi: 50, secondsPerFlight: 20 };

const ROWS = (pilot: boolean): Record<string, PitchRow> => ({
  fast: pilot
    ? { key: 'fast', icon: 'timer-outline', title: 'About 20 seconds a flight', sub: 'Route, times and aircraft. Night, distance and landings are worked out for you.' }
    : { key: 'fast', icon: 'timer-outline', title: 'A day in the field, logged in one go', sub: 'One session holds several flights. About 20 seconds each.' },
  trust: pilot
    ? { key: 'trust', icon: 'checkmark-done-outline', title: 'Numbers that add up', sub: 'Totals carried forward on every page, night worked out from route and times, duplicates caught when you import.' }
    : { key: 'trust', icon: 'checkmark-done-outline', title: 'Numbers that add up', sub: 'Totals carried forward on every page, and duplicates caught when you import.' },
  licence: { key: 'licence', icon: 'ribbon-outline', title: 'Your next licence, with a date', sub: 'How far you are from each requirement, and when you get there.' },
  proof: { key: 'proof', icon: 'document-text-outline', title: 'A logbook you can hand over', sub: 'Real remote pilot logbook pages, with a PDF when a client or an authority asks.' },
  place: { key: 'place', icon: 'albums-outline', title: 'Every hour in one logbook', sub: 'Paper pages, old apps and new flights, together and searchable.' },
  current: { key: 'current', icon: 'time-outline', title: 'Current today?', sub: 'Landings, night and instrument recency, checked every time you open the app.' },
  overview: pilot
    ? { key: 'overview', icon: 'stats-chart-outline', title: 'See how your flying adds up', sub: 'Hours by aircraft, role and conditions, your year so far, and where it is all heading.' }
    : { key: 'overview', icon: 'stats-chart-outline', title: 'See how your flying adds up', sub: 'Hours over time, by drone and by place, and your year so far.' },
  split: { key: 'split', icon: 'layers-outline', title: 'Hours per category and sight mode', sub: 'A1 to Specific, VLOS to BVLOS, and per drone, added up for you.' },
  totals: { key: 'totals', icon: 'calculator-outline', title: 'Totals that add themselves up', sub: 'Every column, carried forward on every page. No more adding by hand.' },
  book: pilot
    ? { key: 'book', icon: 'book-outline', title: 'A book that looks like your book', sub: 'Your flights on real logbook pages, with a PDF whenever you need one.' }
    : { key: 'book', icon: 'book-outline', title: 'A real remote pilot logbook', sub: 'Your flights on logbook pages, with a PDF whenever you need one.' },
  map: { key: 'map', icon: 'earth-outline', title: 'Every flight on the map', sub: 'Your longest cross-country and your best week, replayed.' },
  fleet: { key: 'fleet', icon: 'hardware-chip-outline', title: 'Every drone you fly', sub: 'Hours per drone in your fleet, picked with one tap when you log.' },
});

export interface Tile { value: string; label: string; good?: boolean }
export interface Solution { hero: 'paper' | 'file' | 'type' | 'drone'; kicker: string; title: string; tiles: Tile[]; rows: PitchRow[] }

/**
 * Lösningssidan: bilden överst, rubriken, tre siffror och tre korta rader. Tre grunddesigner: piloten med bara
 * pappersbok (fotografera, Blades skriver in), piloten med digital loggbok (flytta över, Blades fyller i resten)
 * och drönarpiloten (bevis för varje flygning). Raderna börjar med det användaren svarat är viktigt.
 */
export function buildSolution(a: {
  pilot: boolean; prio: Prio; want: Want; path: PitchPath; deal: { month: string; year: string } | null;
  drone?: 'hobby' | 'commercial' | 'military' | null;
  bookShort: string | null; freeSpreads: number;
}): Solution {
  const R = ROWS(a.pilot);
  const mine = [R[a.prio], R[a.want]];
  const privacy: PitchRow = { key: 'private', icon: 'lock-closed-outline', title: 'Stays on your phone. No account needed.', sub: 'Your logbook is stored on this phone.' };
  const fast: Tile = { value: '20 s', label: 'to log a flight', good: true };
  const auto: Tile = { value: 'Auto', label: 'night, distance and landings' };
  const pdf: Tile = { value: 'PDF', label: 'logbook pages, like paper' };
  if (!a.pilot) {
    // Kategorierna följer den sortens flygning man valt: militära piloter loggar per NATO-klass, inte A1–Specific.
    const mil = a.drone === 'military';
    const split: PitchRow = mil
      ? { key: 'split', icon: 'layers-outline', title: 'Hours per NATO class and sight mode', sub: 'Class I to III, VLOS to BVLOS, and per drone, added up for you.' }
      : R.split;
    const proof: PitchRow = mil
      ? { key: 'proof', icon: 'document-text-outline', title: 'A logbook you can hand over', sub: 'Real remote pilot logbook pages, with a PDF when your unit asks.' }
      : R.proof;
    const pick = (r: PitchRow) => (r.key === 'split' ? split : r.key === 'proof' ? proof : r);
    return {
      hero: 'drone', kicker: 'YOUR DRONE LOGBOOK', title: 'Proof of every flight, ready when asked.',
      tiles: [
        mil ? { value: 'NATO I–III', label: 'hours per class', good: true }
          : a.drone === 'hobby' ? { value: 'A1–A3', label: 'hours per category', good: true }
          : { value: 'A1–SPEC', label: 'hours per category', good: true },
        { value: 'BVLOS', label: 'time per sight mode' },
        { value: 'PDF', label: 'logbook to hand over' },
      ],
      rows: [...mine.map(pick), { key: 'dscan', icon: 'scan-outline', title: 'Scan the flight list from your drone app', sub: 'A screenshot is enough.' }],
    };
  }
  if (a.path === 'paper') {
    return {
      hero: 'paper', kicker: 'WE HAVE THE SOLUTION FOR YOU', title: 'Photograph it.\nBlades types it.',
      tiles: [
        { value: '30–45', label: 'minutes, not 5–10+ hours', good: true },
        a.bookShort ? { value: a.bookShort, label: 'for the whole book' } : { value: '3 steps', label: 'photo, read, check' },
        { value: `${a.freeSpreads} free`, label: 'spreads to try it' },
      ],
      rows: [...mine, privacy],
    };
  }
  if (a.path === 'start' || a.path === 'paperNoScan') {
    return {
      hero: 'type', kicker: 'WHY BLADES', title: 'Log it once.\nBlades does the rest.',
      tiles: [fast, { value: '20', label: 'flights free by hand' }, { value: 'PDF', label: 'logbook pages' }],
      rows: [...mine, privacy],
    };
  }
  return {
    hero: 'file', kicker: 'WHY BLADES', title: 'Bring it over.\nBlades fills in the rest.',
    // Siffrorna säger det bilden ovanför visar (Blades räknar ut natt, distans och landningar) och det man får ut.
    tiles: a.deal
      ? [{ value: a.deal.month, label: `less a month, ${a.deal.year} a year`, good: true }, auto, pdf]
      : [{ ...auto, good: true }, pdf, { value: '20', label: 'flights free by hand' }],
    rows: [...mine, privacy],
  };
}

// ── Pengar ──────────────────────────────────────────────────────────────────

export interface Prices {
  currency: string;
  sample: string;          // ett pris som App Store skrivit det, t.ex. "39,00 kr"
  premiumString: string | null; // Premiums månadspris som App Store skriver det
  premium: number | null;  // per månad
  max: number | null;
  packs: { coins: number; price: number }[];
}

// Belopp skrivs som App Store skriver dem för användaren: priset på betalväggen ("39,00 kr", "$2.99") är mallen,
// och bara siffrorna byts. Då står valutan på samma sida och med samma tecken som på köpknappen.
export function money(v: number, pr: Pick<Prices, 'sample' | 'currency'>, decimals = 0): string {
  const m = /\d(?:[\d\s.,\u00A0\u202F]*\d)?/.exec(pr.sample);
  const comma = /,\d{1,2}\s*(\D*)$/.test(pr.sample) && !/\.\d{1,2}\s*(\D*)$/.test(pr.sample);
  const [int, frac] = v.toFixed(decimals).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, comma ? '\u00A0' : ',');
  const num = frac ? `${grouped}${comma ? ',' : '.'}${frac}` : grouped;
  if (!m) return `${num} ${pr.currency}`;
  return pr.sample.slice(0, m.index) + num + pr.sample.slice(m.index + m[0].length);
}
// Jämna belopp: tiotal över 100, annars heltal.
const round = (v: number) => (v >= 100 ? Math.round(v / 10) * 10 : Math.round(v));
const floor = (v: number) => (v >= 100 ? Math.floor(v / 10) * 10 : Math.floor(v));
// Närmaste "jämna" belopp uppåt: 1, 2, 2,5 eller 5 gånger en tiopotens (468 → 500, 35,88 → 50).
function niceCeil(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

// Billigaste sättet att få ihop `coins`: en månad Premium eller Max och coinpaket för resten.
function cheapest(coins: number, pr: Prices): number | null {
  if (!pr.packs.length) return null;
  const packCost = (need: number): number => {
    if (need <= 0) return 0;
    const step = 50, n = Math.ceil(need / step);
    const best = new Array<number>(n + 1).fill(Infinity);
    best[0] = 0;
    for (let i = 1; i <= n; i++) for (const p of pr.packs) {
      const from = Math.max(0, i - Math.ceil(p.coins / step));
      if (best[from] + p.price < best[i]) best[i] = best[from] + p.price;
    }
    return best[n];
  };
  const opts: number[] = [];
  if (pr.max != null) opts.push(pr.max + packCost(coins - 500));
  if (pr.premium != null) opts.push(pr.premium + packCost(coins - 250));
  const v = Math.min(...opts);
  return Number.isFinite(v) ? v : null;
}

/** "170 kr to 210 kr" för en hel bok. null när priserna saknas. */
export function bookCost(pr: Prices | null, coinsPerSpread: number): { range: string; short: string } | null {
  if (!pr) return null;
  const lo = cheapest(BOOK.spreadsLo * coinsPerSpread, pr), hi = cheapest(BOOK.spreadsHi * coinsPerSpread, pr);
  if (lo == null || hi == null) return null;
  // Kort form till siffer-rutan: "$12–15" eller "170–210 kr" (valutan står en gång, på sin vanliga sida).
  const prefix = !/^\s*\d/.test(pr.sample);
  const bare = (v: number) => money(v, { ...pr, sample: '0' });
  const short = round(lo) === round(hi) ? money(round(lo), pr)
    : prefix ? `${money(round(lo), pr)}–${bare(round(hi))}` : `${bare(round(lo))}–${money(round(hi), pr)}`;
  return { range: `${money(round(lo), pr)} to ${money(round(hi), pr)}`, short };
}

/**
 * Frågan "What does it cost you a month?": gränserna sätts efter Premiums månadspris i användarens valuta, så att
 * "över den övre gränsen" alltid betyder en besparing man kan stå för. null när priset saknas (frågan ställs inte).
 */
export interface Deal { today: string; month: string; year: string }
export function costChoices(pr: Prices | null): { labels: string[]; premium: string; deals: Record<number, Deal | null> } | null {
  if (!pr || pr.premium == null) return null;
  const price = pr.premium;
  const t1 = niceCeil(price), t2 = t1 * 2;
  const f = (v: number) => money(v, pr);
  // Besparingen räknas från intervallets nedre gräns, så "at least" alltid stämmer. Ingen besparing att tala om
  // (under en hel valutaenhet i månaden) → ingen jämförelse.
  const deal = (from: number, today: string): Deal | null => {
    const m = floor(from - price);
    return m >= 1 ? { today, month: f(m), year: f(floor((from - price) * 12)) } : null;
  };
  return {
    labels: ['Free', `Under ${f(t1)}`, `${f(t1)} to ${f(t2)}`, `Over ${f(t2)}`, 'Not sure'],
    premium: pr.premiumString ?? money(price, pr, 2),
    deals: { 2: deal(t1, `${f(t1)} to ${f(t2)}`), 3: deal(t2, `Over ${f(t2)}`) },
  };
}
