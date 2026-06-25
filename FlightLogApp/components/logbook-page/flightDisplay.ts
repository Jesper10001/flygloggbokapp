// Härledda visningsvärden för en flygning (roll, ankomst-UTC, badges).
import type { Flight } from '../../types/flight';

// Pilotroll härledd ur tidsfälten, kort etikett för listraderna.
export function roleLabel(f: Flight): string {
  if ((f.pic ?? 0) > 0) return 'PIC';
  if ((f.picus ?? 0) > 0) return 'PICUS';
  if ((f.spic ?? 0) > 0) return 'SPIC';
  if ((f.co_pilot ?? 0) > 0) return 'CO-PI';
  if ((f.dual ?? 0) > 0) return 'DUAL';
  if ((f.instructor ?? 0) > 0) return 'INSTR';
  return '—';
}

export function isPicFlight(f: Flight): boolean {
  return (f.pic ?? 0) > 0 || (f.picus ?? 0) > 0 || (f.spic ?? 0) > 0;
}

const validHHMM = (s?: string) => !!s && /^\d{1,2}:\d{2}$/.test(s);

// Ankomst-UTC: använd lagrat arr_utc om giltigt, annars beräkna från dep_utc + total_time.
export function arrUtc(f: Flight): string {
  if (validHHMM(f.arr_utc)) return f.arr_utc;
  if (!validHHMM(f.dep_utc)) return '';
  const [h, m] = f.dep_utc.split(':').map(Number);
  const t = h * 60 + m + Math.round((f.total_time ?? 0) * 60);
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

// 'YYYY-MM-DD' → Date (lokal, middag för att undvika TZ-glapp).
export function parseDate(iso: string): Date {
  const [y, m, d] = (iso || '').split('-').map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1, 12, 0, 0);
}

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function weekdayShort(iso: string): string {
  return WEEKDAY[parseDate(iso).getDay()] ?? '';
}

export function dayOfMonth(iso: string): string {
  return iso?.split('-')[2] ?? '??';
}
