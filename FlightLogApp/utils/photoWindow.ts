// Flygalbumets tidsfönster: hur långt före start och efter landning en bild får vara tagen för att räknas till
// flygningen. Synken sparar alla bilder inom tre timmar (MAX_WINDOW_MIN); fönstret väljer bara vilka som visas,
// så det kan ändras i efterhand utan att biblioteket läses igen. Bilder tagna i luften räknas alltid.

export const WINDOW_CHOICES = [0, 15, 30, 60, 120, 180];          // minuter
export const WINDOW_LABELS = ['None', '15 min', '30 min', '1 h', '2 h', '3 h'];
export const WINDOW_SHORT = ['0 min', '15 min', '30 min', '1 h', '2 h', '3 h'];
export const MAX_WINDOW_MIN = WINDOW_CHOICES[WINDOW_CHOICES.length - 1];

/** before/after = index i WINDOW_CHOICES. */
export interface PhotoWindow { before: number; after: number; videos: boolean }
export const DEFAULT_WINDOW: PhotoWindow = { before: 2, after: 2, videos: true };

// unknown: tidpunkten okänd (ett foto kopplat innan albumet fick tider) → visas alltid.
export type Phase = 'before' | 'air' | 'after' | 'unknown';
export interface Placement {
  phase: Phase;
  rel: number;   // minuter före start / efter landning; i luften: minuter efter start
  frac: number;  // i luften: andel av flygningen (0–1), annars 0
}

/** Var en bild tagen vid t (ms) ligger i förhållande till flygningen dep–arr (ms). */
export function placeTime(t: number | null | undefined, dep: number, arr: number): Placement {
  if (t == null || !isFinite(t)) return { phase: 'unknown', rel: 0, frac: 0 };
  if (t < dep) return { phase: 'before', rel: Math.ceil((dep - t) / 60000), frac: 0 };
  if (t > arr) return { phase: 'after', rel: Math.ceil((t - arr) / 60000), frac: 0 };
  const span = Math.max(1, arr - dep);
  return { phase: 'air', rel: Math.floor((t - dep) / 60000), frac: Math.min(1, (t - dep) / span) };
}

export interface WindowItem extends Placement { flightId: number; isVideo: boolean }

export function inWindow(p: Placement & { isVideo: boolean }, w: PhotoWindow): boolean {
  if (p.isVideo && !w.videos) return false;
  if (p.phase === 'before') return p.rel <= WINDOW_CHOICES[w.before];
  if (p.phase === 'after') return p.rel <= WINDOW_CHOICES[w.after];
  return true;
}

export interface WindowStats {
  photos: number;     // med i albumet
  flights: number;    // flygningar med minst en bild
  left: number;       // inom tre timmar men utanför fönstret
  before: number; air: number; after: number;
  videos: number;     // videor inom tre timmar (oavsett fönstret)
  // Staplarna i tidslinjen: antal per intervall mellan valen (index 0 = närmast start/landning), och i luften
  // sex lika delar av flygtiden.
  bars: { before: number[]; air: number[]; after: number[] };
}

/** Bucket för en bild före start/efter landning: 0 = inom 15 min, … 4 = 2–3 h. */
export function bucketOf(rel: number): number {
  for (let i = 1; i < WINDOW_CHOICES.length; i++) if (rel <= WINDOW_CHOICES[i]) return i - 1;
  return WINDOW_CHOICES.length - 2;
}

export function windowStats(items: WindowItem[], w: PhotoWindow): WindowStats {
  const s: WindowStats = {
    photos: 0, flights: 0, left: 0, before: 0, air: 0, after: 0, videos: 0,
    bars: { before: [0, 0, 0, 0, 0], air: [0, 0, 0, 0, 0, 0], after: [0, 0, 0, 0, 0] },
  };
  const flights = new Set<number>();
  for (const p of items) {
    if (p.isVideo) s.videos++;
    if (!(w.videos || !p.isVideo)) { s.left++; continue; }
    if (p.phase === 'before') s.bars.before[bucketOf(p.rel)]++;
    else if (p.phase === 'after') s.bars.after[bucketOf(p.rel)]++;
    else if (p.phase === 'air') s.bars.air[Math.min(5, Math.floor(p.frac * 6))]++;
    if (!inWindow(p, w)) { s.left++; continue; }
    s.photos++;
    flights.add(p.flightId);
    if (p.phase === 'before') s.before++;
    else if (p.phase === 'after') s.after++;
    else s.air++;
  }
  s.flights = flights.size;
  return s;
}

/** Fönstret i ord: "±30 min", "In the air only", "30 min before · 1 h after". */
export function windowLabel(w: PhotoWindow): string {
  if (w.before === 0 && w.after === 0) return 'In the air only';
  if (w.before === w.after) return `±${WINDOW_SHORT[w.before]}`;
  return `${WINDOW_SHORT[w.before]} before · ${WINDOW_SHORT[w.after]} after`;
}

/** Sparat som minuter (tål att valen ändras); okända värden → närmaste val. */
export function windowFromMinutes(m: { before?: number; after?: number; videos?: boolean } | null | undefined): PhotoWindow {
  const idx = (v: number | undefined, d: number) => {
    if (typeof v !== 'number' || !isFinite(v)) return d;
    let best = 0;
    for (let i = 0; i < WINDOW_CHOICES.length; i++) if (Math.abs(WINDOW_CHOICES[i] - v) < Math.abs(WINDOW_CHOICES[best] - v)) best = i;
    return best;
  };
  return { before: idx(m?.before, DEFAULT_WINDOW.before), after: idx(m?.after, DEFAULT_WINDOW.after), videos: m?.videos !== false };
}
export function windowToMinutes(w: PhotoWindow): { before: number; after: number; videos: boolean } {
  return { before: WINDOW_CHOICES[w.before], after: WINDOW_CHOICES[w.after], videos: w.videos };
}
