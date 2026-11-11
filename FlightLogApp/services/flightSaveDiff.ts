// Vad som ändrades när en flygning sparades om: raden i databasen före och efter jämförs fält för fält.
// Ren funktion (inga importer) så att den kan testas i Node: scripts/test-flight-save-diff.cjs.
// Används av notisen "Saved flight" (components/SavedFlightNotice).

export interface SavedLine {
  kind: 'time' | 'count' | 'text';
  /** Skillnaden: timmar (time) eller antal (count). 0 för text. */
  delta: number;
  label: string;
}

const TIME_FIELDS: [string, string][] = [
  ['total_time', 'Total'], ['vfr', 'VFR'], ['ifr', 'IFR'], ['night', 'Night'], ['nvg', 'NVG'],
  ['pic', 'PIC'], ['co_pilot', 'Co-pilot'], ['dual', 'Dual'], ['instructor', 'Instructor'], ['picus', 'PICUS'], ['spic', 'SPIC'],
  ['examiner', 'Examiner'], ['safety_pilot', 'Safety pilot'], ['observer', 'Observer'], ['ferry_pic', 'Ferry PIC'], ['relief_crew', 'Relief crew'],
  ['multi_pilot', 'Multi-pilot'], ['single_pilot', 'Single-pilot'], ['pilot_flying', 'Pilot flying'], ['solo', 'Solo'],
];
const COUNT_FIELDS: [string, string][] = [
  ['landings_day', 'Day landings'], ['landings_night', 'Night landings'], ['takeoffs_day', 'Day take-offs'], ['takeoffs_night', 'Night take-offs'],
  ['tng_count', 'Touch-and-goes'], ['app_2d', '2D approaches'], ['app_3d', '3D approaches'], ['holds', 'Holds'],
];
// Text: flera kolumner kan höra till samma sak (platsen har kod + det piloten skrev).
const TEXT_FIELDS: [string[], string][] = [
  [['date'], 'Date'], [['aircraft_type'], 'Aircraft type'], [['registration'], 'Registration'],
  [['dep_place', 'dep_place_raw'], 'Departure'], [['arr_place', 'arr_place_raw'], 'Arrival'],
  [['dep_utc'], 'Departure time'], [['arr_utc'], 'Arrival time'],
  [['second_pilot', 'second_pilot_role', 'extra_pilots'], 'Crew'], [['flight_type', 'sim_category'], 'Flight type'],
  [['max_fl'], 'Max FL'], [['stop_place'], 'Route'], [['remarks'], 'Remarks'], [['photo_uri', 'media_type'], 'Photo'],
];

const num = (v: unknown) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '')); return Number.isFinite(n) ? n : 0; };
const text = (v: unknown) => { const s = String(v ?? '').trim(); return s === '0' ? '' : s; };

/** Ändringarna mellan raden före och efter: tider först (+/−), sedan antal, sedan övriga fält vid namn. */
export function diffSavedFlight(before: Record<string, any> | null | undefined, after: Record<string, any> | null | undefined): SavedLine[] {
  if (!before || !after) return [];
  const out: SavedLine[] = [];
  for (const [f, label] of TIME_FIELDS) {
    const d = Math.round((num(after[f]) - num(before[f])) * 100) / 100;
    if (Math.abs(d) >= 0.01) out.push({ kind: 'time', delta: d, label });
  }
  for (const [f, label] of COUNT_FIELDS) {
    const d = Math.round(num(after[f]) - num(before[f]));
    if (d !== 0) out.push({ kind: 'count', delta: d, label });
  }
  for (const [fields, label] of TEXT_FIELDS) {
    const changed = fields.some((f) => {
      const a = text(before[f]), b = text(after[f]);
      return f === 'dep_place' || f === 'arr_place' || f === 'dep_place_raw' || f === 'arr_place_raw' ? a.toUpperCase() !== b.toUpperCase() : a !== b;
    });
    if (changed) out.push({ kind: 'text', delta: 0, label });
  }
  // Flygreglerna syns redan som IFR-/VFR-tid; nämns bara vid namn när ingen av tiderna rördes.
  if (text(before.flight_rules) !== text(after.flight_rules) && !out.some((l) => l.label === 'IFR' || l.label === 'VFR')) {
    out.push({ kind: 'text', delta: 0, label: 'Flight rules' });
  }
  return out;
}
