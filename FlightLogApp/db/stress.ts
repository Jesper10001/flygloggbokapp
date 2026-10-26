// Underlag för dashboardens Flight load (pilot + drönare): timmar de senaste 14 dagarna + ditt normala
// 14-dagarssnitt + hur lång historik snittet bygger på. Själva procenten räknas i utils/workload.
import { getDatabase } from './database';

export type StressHours = { recent14: number; yearAvg14: number; historyDays: number };

const DAY_MS = 86400000;
const toUtc = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

/** Snittet = timmar per 14 KALENDERDAGAR under dina aktiva månader det senaste året (de senaste 14 dagarna
 *  räknas inte — de är det som jämförs). Månader med under 30 % av ditt vanliga tempo (semester, säsongsuppehåll)
 *  räknas bort, så snittet speglar hur du flyger när du flyger. Exakta dagar per månad, från första flygningen →
 *  en påbörjad första månad drar inte ner snittet och flygdagsmönster (t.ex. bara helger) blåser inte upp det.
 *  realWhere filtrerar bort klumpsummor (summeringsrader) — se anroparna i db/flights.ts och db/drones.ts. */
export async function computeStressHours(
  table: 'flights' | 'drone_flights', realWhere: string, params: (string | number)[] = [],
): Promise<StressHours> {
  const db = await getDatabase();
  const bounds = await db.getFirstAsync<{ end14: string; start379: string }>(
    `SELECT date('now', '-14 days') AS end14, date('now', '-379 days') AS start379`,
  );
  const end14 = bounds!.end14;
  const start379 = bounds!.start379;

  const r14 = await db.getFirstAsync<{ h: number | null }>(
    `SELECT ROUND(SUM(total_time), 2) AS h FROM ${table} WHERE date >= ? AND ${realWhere}`,
    [end14, ...params],
  );
  const first = await db.getFirstAsync<{ d: string | null; days: number | null }>(
    `SELECT MIN(date) AS d, julianday('now') - julianday(MIN(date)) AS days FROM ${table}
     WHERE date >= ? AND date != '' AND ${realWhere}`,
    [start379, ...params],
  );
  const recent14 = r14?.h ?? 0;
  const historyDays = Math.max(0, Math.floor(first?.days ?? 0));
  const firstDate = first?.d ?? null;
  // Ingen flygning äldre än 14 dagar inom året → inget eget snitt ännu.
  if (!firstDate || firstDate >= end14) return { recent14, yearAvg14: 0, historyDays };

  const start = firstDate > start379 ? firstDate : start379;
  const rows = await db.getAllAsync<{ ym: string; h: number | null }>(
    `SELECT strftime('%Y-%m', date) AS ym, SUM(total_time) AS h FROM ${table}
     WHERE date >= ? AND date < ? AND ${realWhere} GROUP BY ym`,
    [start, end14, ...params],
  );
  const hoursByMonth = new Map(rows.map((r) => [r.ym, r.h ?? 0]));

  // Kalendermånaderna i [start, end14) med antal dagar som ligger i fönstret.
  const months: { days: number; h: number }[] = [];
  const stopAt = toUtc(end14);
  for (let cur = toUtc(start); cur < stopAt;) {
    const d = new Date(cur);
    const next = Math.min(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1), stopAt);
    const ym = d.toISOString().slice(0, 7);
    months.push({ days: Math.round((next - cur) / DAY_MS), h: hoursByMonth.get(ym) ?? 0 });
    cur = next;
  }
  // Vanligt tempo bedöms på månader med minst en vecka i fönstret (en kort kant-månad ska inte styra).
  const judged = months.filter((m) => m.days >= 7);
  const basis = judged.length ? judged : months;
  const usualRate = basis.reduce((s, m) => s + m.h / m.days, 0) / basis.length;
  const active = months.filter((m) => m.h > 0 && m.h / m.days >= usualRate * 0.3);
  const activeHours = active.reduce((s, m) => s + m.h, 0);
  const activeDays = active.reduce((s, m) => s + m.days, 0);
  const yearAvg14 = activeDays > 0 ? Math.round((activeHours / activeDays) * 14 * 100) / 100 : 0;
  return { recent14, yearAvg14, historyDays };
}
