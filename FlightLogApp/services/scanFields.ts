// Fält i en skannad loggboksrad: etiketter, visning (tidsformat) och tolkning av inmatning. Delas av
// granskningen (app/flight/scan-review.tsx) och skanningsrapporten (components/scan/ScanReport.tsx).

import type { OcrFlightResult } from '../types/flight';
import type { TimeFormat } from '../store/timeFormatStore';
import { formatTimeValue, parseTimeInput } from '../hooks/useTimeFormat';
import { clockValue } from '../utils/format';


export const FIELD_LABEL: Record<string, string> = {
  date: 'Date', aircraft_type: 'Aircraft type', registration: 'Registration',
  dep_place: 'Departure', dep_utc: 'Departure time', arr_place: 'Arrival', arr_utc: 'Arrival time',
  stop_place: 'Via', total_time: 'Total time', pic: 'PIC', co_pilot: 'Co-pilot', dual: 'Dual',
  instructor: 'Instructor', ifr: 'IFR', night: 'Night', multi_pilot: 'Multi-pilot', single_pilot: 'Single-pilot',
  picus: 'PICUS', spic: 'SPIC', nvg: 'NVG', examiner: 'Examiner', safety_pilot: 'Safety pilot',
  sim: 'Simulator time', sim_category: 'Simulator type', other_time_role: 'Kind of time',
  landings_day: 'Day landings', landings_night: 'Night landings', tng_count: 'Touch-and-goes',
  remarks: 'Remarks', second_pilot: 'Second pilot', se_time: 'Single-engine time', me_time: 'Multi-engine time',
};
export const label = (f: string) => FIELD_LABEL[f] ?? f.replace(/_/g, ' ');

export const DURATION = new Set([
  'total_time', 'pic', 'co_pilot', 'dual', 'instructor', 'ifr', 'night', 'multi_pilot', 'single_pilot',
  'picus', 'spic', 'nvg', 'examiner', 'safety_pilot', 'sim', 'se_time', 'me_time',
]);
export const CLOCK = new Set(['dep_utc', 'arr_utc']);
export const PLACE = new Set(['dep_place', 'arr_place', 'stop_place']);
export const COUNT = new Set(['landings_day', 'landings_night', 'tng_count']);
export const UPPER = new Set(['aircraft_type', 'registration']);

export const SIM_TYPES = ['FFS', 'FTD', 'FNPT II', 'FNPT I', 'BITD', 'CPT/PPT', 'CBT'];
export const TIME_ROLES = ['Instructor', 'PICUS', 'SPIC', 'Multi-pilot', 'Single-pilot', 'Examiner', 'Safety pilot', 'NVG', 'SE time', 'ME time'];
export const chipKey = (opt: string) => opt.replace(/[\s\/\-]/g, '_').toLowerCase();
export const CHOICES: Record<string, string[]> = { sim_category: SIM_TYPES, other_time_role: TIME_ROLES };

export function display(d: OcrFlightResult, field: string, fmt: TimeFormat): string {
  const v = (d as any)[field];
  if (v == null || v === '') return '';
  if (DURATION.has(field)) {
    const n = parseFloat(String(v));
    return Number.isFinite(n) && n > 0 ? formatTimeValue(n, fmt) : '';
  }
  if (COUNT.has(field)) return String(v) === '0' ? '' : String(v);
  if (CHOICES[field]) return CHOICES[field].find((o) => chipKey(o) === String(v).toLowerCase()) ?? String(v);
  return String(v);
}

export function parseInput(field: string, text: string, fmt: TimeFormat): string | null {
  const t = text.trim();
  if (DURATION.has(field)) {
    if (t === '') return '0';
    const n = parseTimeInput(t, fmt);
    return n == null || n < 0 || n > 24 ? null : String(Math.round(n * 100) / 100);
  }
  if (CLOCK.has(field)) return t === '' ? '' : clockValue(t);
  if (COUNT.has(field)) {
    if (t === '') return '0';
    return /^\d{1,3}$/.test(t) ? String(parseInt(t, 10)) : null;
  }
  if (field === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
  if (PLACE.has(field) || UPPER.has(field)) return t.toUpperCase();
  return t;
}

export const inputValue = (d: OcrFlightResult, field: string, fmt: TimeFormat) =>
  DURATION.has(field) ? display(d, field, fmt) : String((d as any)[field] ?? '');

export function shapeInput(field: string, text: string): string {
  if (CLOCK.has(field)) {
    const digits = text.replace(/\D/g, '').slice(0, 4);
    return digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`;
  }
  return PLACE.has(field) || UPPER.has(field) ? text.toUpperCase() : text;
}
