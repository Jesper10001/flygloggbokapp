// Workload-index (Flight load) på dashboarden: senaste 14 dagarnas timmar mot ditt eget normala 14-dagarssnitt,
// i procent (100 % = som vanligt). Delas av pilot- och drönardashboarden.
//
// Nya användare har inget eget snitt de första 14 dagarna (snittet bygger på flygningar äldre än 14 dagar) →
// 100 % i stället för max. När historiken växer tar det verkliga förhållandet över gradvis och gäller fullt efter
// BASELINE_FULL_DAYS dagar. Importerad historik (CSV) räknas direkt: lång historik → fullt genomslag från start.
export const BASELINE_FULL_DAYS = 60;

/** Halveringstid (dagar) för hur mycket en månad väger i ditt normala tempo: de senaste månaderna väger mest. */
export const NORMAL_HALF_LIFE_DAYS = 120;

/**
 * Ditt normala 14-dagarssnitt ur månaderna i året före de senaste 14 dagarna (delas av dashboarden,
 * db/stress.ts, och Stressfactor, stressSeries). Månader under 30 % av ditt vanliga tempo (semester,
 * säsongsuppehåll) räknas bort. Ditt normala ändras över tid, så varje månad väger efter hur nyligen den var
 * (halveringstid NORMAL_HALF_LIFE_DAYS): det följer hur du flyger nu, medan ett helt år håller det stabilt.
 * age = dagar från månadens mitt till fönstrets slut; days = månadens dagar i fönstret.
 */
export function normalFromMonths(months: { days: number; h: number; age: number }[]): number {
  if (!months.length) return 0;
  const w = (m: { age: number }) => Math.pow(0.5, Math.max(0, m.age) / NORMAL_HALF_LIFE_DAYS);
  // Vanligt tempo bedöms på månader med minst en vecka i fönstret (en kort kant-månad ska inte styra).
  const judged = months.filter((m) => m.days >= 7);
  const basis = judged.length ? judged : months;
  const usual = basis.reduce((s, m) => s + w(m) * (m.h / m.days), 0) / basis.reduce((s, m) => s + w(m), 0);
  const active = months.filter((m) => m.h > 0 && m.h / m.days >= usual * 0.3);
  const ah = active.reduce((s, m) => s + w(m) * m.h, 0);
  const ad = active.reduce((s, m) => s + w(m) * m.days, 0);
  return ad > 0 ? Math.round((ah / ad) * 14 * 100) / 100 : 0;
}

export function workloadIndex(recent14: number, yearAvg14: number, historyDays: number): number {
  if (yearAvg14 <= 0) return recent14 > 0 ? 100 : 0;
  const raw = (recent14 / yearAvg14) * 100;
  const confidence = Math.max(0, Math.min(1, (historyDays - 14) / (BASELINE_FULL_DAYS - 14)));
  return Math.round(100 + (raw - 100) * confidence);
}

// ── Stressfactor: Flight load över tid ───────────────────────────────────────
// Samma zoner och samma räkning som dashboardens siffra (db/stress.ts + workloadIndex), men dag för dag: för
// varje dag räknas de senaste 14 dagarnas timmar mot ditt normala 14-dagarssnitt som det såg ut den dagen.

export type StressZone = 'low' | 'light' | 'normal' | 'elevated' | 'high' | 'critical';

export function stressZone(index: number): StressZone {
  return index <= 29 ? 'low' : index <= 69 ? 'light' : index <= 130 ? 'normal'
    : index <= 169 ? 'elevated' : index <= 200 ? 'high' : 'critical';
}

export interface StressPoint { date: string; index: number; hours14: number; baseline14: number }

const DAY = 86400000;
const dayNum = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY); };
const isoOf = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);

/**
 * Flight load för varje dag i [from, to]. daily = timmar per datum (YYYY-MM-DD) för de flygningar som räknas
 * (samma urval som dashboarden). Speglar computeStressHours: 15 kalenderdagar bakåt (date >= idag − 14),
 * ditt normala som det var den dagen (normalFromMonths, nyare månader väger mer) och upptrappningen för ny
 * historik (workloadIndex).
 */
export function stressSeries(daily: Record<string, number>, from: string, to: string): StressPoint[] {
  const f = dayNum(from), t = dayNum(to);
  if (t < f) return [];
  const flown = Object.keys(daily).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).map(dayNum).sort((a, b) => a - b);
  const base = Math.min(f - 400, flown[0] ?? f);
  const n = t - base + 2;
  const P = new Float64Array(n + 1);                                  // prefixsummor: timmar i [base, base+k)
  const H = new Float64Array(n);
  for (const [d, h] of Object.entries(daily)) { const k = dayNum(d) - base; if (k >= 0 && k < n) H[k] += h || 0; }
  for (let k = 0; k < n; k++) P[k + 1] = P[k] + H[k];
  const sum = (a: number, b: number) => P[Math.max(0, Math.min(n, b - base))] - P[Math.max(0, Math.min(n, a - base))];   // [a, b)

  const out: StressPoint[] = [];
  let fi = 0;                                                          // första flygdag ≥ dag − 379
  for (let d = f; d <= t; d++) {
    const start379 = d - 379, end14 = d - 14;
    const recent14 = Math.round(sum(end14, d + 1) * 100) / 100;
    while (fi < flown.length && flown[fi] < start379) fi++;
    const first = fi < flown.length && flown[fi] <= d ? flown[fi] : null;
    const historyDays = first == null ? 0 : d - first;
    let baseline14 = 0;
    if (first != null && first < end14) {
      const months: { days: number; h: number; age: number }[] = [];
      for (let cur = Math.max(first, start379); cur < end14;) {
        const dt = new Date(cur * DAY);
        const next = Math.min(Math.round(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 1) / DAY), end14);
        months.push({ days: next - cur, h: sum(cur, next), age: end14 - (cur + next) / 2 });
        cur = next;
      }
      baseline14 = normalFromMonths(months);
    }
    out.push({ date: isoOf(d), index: workloadIndex(recent14, baseline14, historyDays), hours14: recent14, baseline14 });
  }
  return out;
}

/** Stressfactor-knappens nivå: snittet av Flight load de senaste 60 dagarna, toppen och dagar över normalt. */
export function stressFactorSummary(series: StressPoint[]): { avg: number; zone: StressZone; peak: StressPoint | null; daysAbove: number } {
  if (!series.length) return { avg: 0, zone: 'low', peak: null, daysAbove: 0 };
  const avg = Math.round(series.reduce((s, p) => s + p.index, 0) / series.length);
  const peak = series.reduce((a, b) => (b.index > a.index ? b : a));
  return { avg, zone: stressZone(avg), peak, daysAbove: series.filter((p) => p.index > 130).length };
}

/** Finns någon flygtid i perioden? Utan flygningar säger Stressfactor-knappen ingenting och visas inte. */
export const hasFlightsIn = (daily: Record<string, number>, from: string, to: string): boolean =>
  Object.entries(daily).some(([d, h]) => d >= from && d <= to && h > 0);

/** Sammanhängande perioder över normalt (> 130 %) i minst `minDays` dagar, nyast först. */
export function busyPeriods(series: StressPoint[], minDays = 3): { from: string; to: string; days: number; peak: number }[] {
  const out: { from: string; to: string; days: number; peak: number }[] = [];
  let run: StressPoint[] = [];
  const close = () => {
    if (run.length >= minDays) out.push({ from: run[0].date, to: run[run.length - 1].date, days: run.length, peak: Math.max(...run.map((p) => p.index)) });
    run = [];
  };
  for (const p of series) { if (p.index > 130) run.push(p); else close(); }
  close();
  return out.reverse();
}
