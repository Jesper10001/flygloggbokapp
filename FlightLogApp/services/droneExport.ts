import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { getDroneFlights, type DroneFlight } from '../db/drones';

function toHHMM(decimal: number): string {
  if (!decimal || isNaN(decimal)) return '0:00';
  const h = Math.floor(decimal);
  const m = Math.round((decimal - h) * 60);
  if (m === 60) return `${h + 1}:00`;
  return `${h}:${String(m).padStart(2, '0')}`;
}

const DELIM = ';';

function esc(val: string | number | null | undefined): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes(';')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

type Col = {
  header: string;
  value: (f: DroneFlight) => string | number;
  optional?: boolean;
  hasData?: (f: DroneFlight) => boolean;
};

export async function exportDroneToCSV(): Promise<void> {
  const flights = await getDroneFlights(99999);

  const hasVal = (n: number | null | undefined) => !!n && n > 0;
  const hasText = (s: string | null | undefined) => !!s && s.trim() !== '';

  const cols: Col[] = [
    { header: 'Date', value: f => f.date },
    { header: 'Drone type', value: f => f.drone_type },
    { header: 'Registration', value: f => f.registration },
    { header: 'Location', value: f => f.location, optional: true, hasData: f => hasText(f.location) },
    { header: 'Mission type', value: f => f.mission_type, optional: true, hasData: f => hasText(f.mission_type) },
    { header: 'Category', value: f => f.category, optional: true, hasData: f => hasText(f.category) },
    { header: 'Flight mode', value: f => f.flight_mode },
    { header: 'Flight time', value: f => toHHMM(f.total_time) },
    { header: 'Max altitude (m)', value: f => f.max_altitude_m || '', optional: true, hasData: f => hasVal(f.max_altitude_m) },
    { header: 'Night', value: f => f.is_night ? 'Yes' : 'No', optional: true, hasData: f => f.is_night === 1 },
    { header: 'Observer', value: f => f.has_observer ? (f.observer_name || 'Yes') : '', optional: true, hasData: f => f.has_observer === 1 },
    { header: 'Remarks', value: f => f.remarks, optional: true, hasData: f => hasText(f.remarks) },
  ];

  const activeCols = cols.filter(c => !c.optional || flights.some(f => c.hasData!(f)));

  const headers = activeCols.map(c => c.header);
  const rows = flights.map(f =>
    activeCols.map(c => esc(c.value(f))).join(DELIM)
  );

  const totalHours = flights.reduce((sum, f) => sum + (f.total_time || 0), 0);
  const totalRow = activeCols.map((c, i) => {
    if (i === 0) return esc('TOTAL');
    if (c.header === 'Flight time') return esc(toHHMM(totalHours));
    if (c.header === 'Drone type') return esc(`${flights.length} flights`);
    return '';
  }).join(DELIM);

  const sepHint = `sep=${DELIM}`;
  const csv = [sepHint, headers.join(DELIM), ...rows, '', totalRow].join('\r\n');
  const filename = `dronelog_${new Date().toISOString().split('T')[0]}.csv`;
  const path = FileSystem.documentDirectory + filename;

  await FileSystem.writeAsStringAsync(path, '\uFEFF' + csv, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, {
      mimeType: 'text/csv',
      dialogTitle: 'Export drone log — CSV',
    });
  }
}
