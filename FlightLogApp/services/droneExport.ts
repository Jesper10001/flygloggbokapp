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

function escapeCSV(val: string | number | null | undefined): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes(';')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function droneLabel(f: DroneFlight): string {
  const t = (f.drone_type ?? '').trim();
  const r = (f.registration ?? '').trim();
  if (t && r) return `${t} / ${r}`;
  return t || r;
}

// Begränsad CSV — Datum, Drönare, Flygtid + totalrad
// Använder ';' som avgränsare (standard på Excel/Numbers i svensk locale) så
// filen öppnas korrekt i kolumner utan manuell import.
export async function exportDroneToCSV(): Promise<void> {
  const flights = await getDroneFlights(99999);

  const headers = ['Date', 'Drone', 'Flight time'];
  const rows = flights.map((f) =>
    [f.date, droneLabel(f), toHHMM(f.total_time)].map(escapeCSV).join(DELIM)
  );

  const totalHours = flights.reduce((sum, f) => sum + (f.total_time || 0), 0);
  const totalRow = ['TOTAL', `${flights.length} flights`, toHHMM(totalHours)]
    .map(escapeCSV)
    .join(DELIM);

  // "sep=" hint — Excel/Numbers läser första raden för att välja avgränsare
  const sepHint = `sep=${DELIM}`;
  const csv = [sepHint, headers.join(DELIM), ...rows, totalRow].join('\r\n');
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
