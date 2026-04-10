import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { getFlights } from '../db/flights';
import type { Flight } from '../types/flight';

function escapeCSV(val: string | number): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function exportToCSV(): Promise<void> {
  const flights = await getFlights(9999);

  const headers = [
    'Datum', 'Luftfartygstyp', 'Registration',
    'Avgångsplats', 'Avgångstid (UTC)', 'Ankomstplats', 'Ankomsttid (UTC)',
    'Total flygtid', 'IFR', 'Natt', 'PIC', 'Co-pilot', 'Dual',
    'Landningar dag', 'Landningar natt', 'Anmärkningar',
  ].join(',');

  const rows = flights.map((f: Flight) =>
    [
      f.date, f.aircraft_type, f.registration,
      f.dep_place, f.dep_utc, f.arr_place, f.arr_utc,
      f.total_time, f.ifr, f.night, f.pic, f.co_pilot, f.dual,
      f.landings_day, f.landings_night, f.remarks,
    ].map(escapeCSV).join(',')
  );

  const csv = [headers, ...rows].join('\n');
  const filename = `flightlog_${new Date().toISOString().split('T')[0]}.csv`;
  const path = FileSystem.documentDirectory + filename;

  await FileSystem.writeAsStringAsync(path, csv, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, {
      mimeType: 'text/csv',
      dialogTitle: 'Exportera loggbok (CSV)',
    });
  }
}

export async function exportToPDF(): Promise<void> {
  const flights = await getFlights(9999);

  // Bygg en HTML-sida i EASA-format
  const tableRows = flights.map((f: Flight) => `
    <tr>
      <td>${f.date}</td>
      <td>${f.dep_place}</td>
      <td>${f.dep_utc}</td>
      <td>${f.arr_place}</td>
      <td>${f.arr_utc}</td>
      <td>${f.aircraft_type}</td>
      <td>${f.registration}</td>
      <td>${f.total_time}</td>
      <td>${f.pic}</td>
      <td>${f.co_pilot}</td>
      <td>${f.dual}</td>
      <td>${f.ifr}</td>
      <td>${f.night}</td>
      <td>${f.landings_day}</td>
      <td>${f.landings_night}</td>
      <td>${f.remarks}</td>
    </tr>
  `).join('');

  const totals = flights.reduce((acc, f: Flight) => ({
    total_time: acc.total_time + f.total_time,
    pic: acc.pic + f.pic,
    co_pilot: acc.co_pilot + f.co_pilot,
    dual: acc.dual + f.dual,
    ifr: acc.ifr + f.ifr,
    night: acc.night + f.night,
    landings_day: acc.landings_day + f.landings_day,
    landings_night: acc.landings_night + f.landings_night,
  }), { total_time: 0, pic: 0, co_pilot: 0, dual: 0, ifr: 0, night: 0, landings_day: 0, landings_night: 0 });

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>FlightLog Pro — EASA Loggbok</title>
  <style>
    body { font-family: Arial, sans-serif; font-size: 9px; margin: 10mm; }
    h1 { font-size: 14px; margin-bottom: 4px; }
    p { margin: 0 0 8px; font-size: 10px; color: #666; }
    table { width: 100%; border-collapse: collapse; }
    th { background: #1a2235; color: white; padding: 4px 3px; text-align: left; font-size: 8px; }
    td { border: 1px solid #ddd; padding: 3px; font-size: 8px; }
    tr:nth-child(even) td { background: #f5f5f5; }
    .total td { background: #e8f0fe; font-weight: bold; }
  </style>
</head>
<body>
  <h1>FlightLog Pro — EASA Loggbok</h1>
  <p>Exportdatum: ${new Date().toLocaleDateString('sv-SE')} · Totalt ${flights.length} flygningar</p>
  <table>
    <thead>
      <tr>
        <th>Datum</th><th>Avg.plats</th><th>Avg.tid</th>
        <th>Ank.plats</th><th>Ank.tid</th>
        <th>Typ</th><th>Reg</th>
        <th>Total</th><th>PIC</th><th>Co-p</th><th>Dual</th>
        <th>IFR</th><th>Natt</th><th>L.dag</th><th>L.natt</th><th>Anm.</th>
      </tr>
    </thead>
    <tbody>
      ${tableRows}
    </tbody>
    <tfoot>
      <tr class="total">
        <td colspan="7">TOTALER (${flights.length} flygningar)</td>
        <td>${totals.total_time.toFixed(1)}</td>
        <td>${totals.pic.toFixed(1)}</td>
        <td>${totals.co_pilot.toFixed(1)}</td>
        <td>${totals.dual.toFixed(1)}</td>
        <td>${totals.ifr.toFixed(1)}</td>
        <td>${totals.night.toFixed(1)}</td>
        <td>${totals.landings_day}</td>
        <td>${totals.landings_night}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>
</body>
</html>`;

  const filename = `flightlog_${new Date().toISOString().split('T')[0]}.html`;
  const path = FileSystem.documentDirectory + filename;

  await FileSystem.writeAsStringAsync(path, html, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, {
      mimeType: 'text/html',
      dialogTitle: 'Exportera loggbok (PDF)',
      UTI: 'public.html',
    });
  }
}
