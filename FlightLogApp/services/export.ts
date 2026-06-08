import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { getFlights, getFlightStats } from '../db/flights';
import type { Flight } from '../types/flight';
import { parseOperatorData, getRoleFields } from '../constants/operatorRoles';

// ── Tidsformatering ──────────────────────────────────────────────────────────

function toHHMM(decimal: number): string {
  if (!decimal || isNaN(decimal)) return '0:00';
  const h = Math.floor(decimal);
  const m = Math.round((decimal - h) * 60);
  if (m === 60) return `${h + 1}:00`;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function escapeCSV(val: string | number | null | undefined): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes(';')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ── CSV ──────────────────────────────────────────────────────────────────────

async function getTempIcaoCodes(): Promise<Set<string>> {
  try {
    const { getAllTempPlaces } = require('../db/icao');
    const temps = await getAllTempPlaces();
    const { getUnlocatedTemporaryPlaces } = require('../db/icao');
    const unloc = await getUnlocatedTemporaryPlaces();
    return new Set([...temps, ...unloc].map((t: any) => t.icao.toUpperCase()));
  } catch { return new Set(); }
}

function exportPlace(code: string, tempCodes: Set<string>): string {
  if (!code) return '';
  return tempCodes.has(code.toUpperCase()) ? 'ZZZZ' : code;
}

export async function exportToCSV(standard: 'easa' | 'faa' | 'caa' = 'easa'): Promise<void> {
  const flights = await getFlights(99999);
  const tempCodes = await getTempIcaoCodes();

  // Kolumndefinition — `optional` betyder att den utelämnas om ingen flygning har data.
  // `hasData` anger vad som räknas som "innehåller information".
  type Col = {
    header: string;
    value: (f: Flight) => string | number;
    optional?: boolean;
    hasData?: (f: Flight) => boolean;
  };

  const hasTime = (n: number | null | undefined) => !!n && n > 0;
  const hasText = (s: string | null | undefined) => !!s && s.trim() !== '';

  const cols: Col[] = [
    { header: 'Datum',                value: f => f.date },
    { header: 'Luftfartygstyp',       value: f => f.aircraft_type },
    { header: 'Registration',         value: f => f.registration },
    { header: 'Avgångsplats',         value: f => exportPlace(f.dep_place, tempCodes) },
    { header: 'Avgångstid UTC',       value: f => f.dep_utc },
    { header: 'Ankomstplats',         value: f => exportPlace(f.arr_place, tempCodes) },
    { header: 'Ankomsttid UTC',       value: f => f.arr_utc },
    { header: 'Total flygtid',        value: f => toHHMM(f.total_time) },
    { header: 'Flerpilottid',         value: f => toHHMM(f.multi_pilot ?? 0),  optional: true, hasData: f => hasTime(f.multi_pilot) },
    { header: 'Enpilottid',           value: f => toHHMM(f.single_pilot ?? 0), optional: true, hasData: f => hasTime(f.single_pilot) },
    { header: 'FFS/Sim',              value: f => f.flight_type === 'sim' ? toHHMM(f.total_time) : '0:00',
                                       optional: true, hasData: f => f.flight_type === 'sim' },
    { header: 'SE (Single Engine)',   value: f => toHHMM(f.se_time ?? 0),      optional: true, hasData: f => hasTime(f.se_time) },
    { header: 'ME (Multi Engine)',    value: f => toHHMM(f.me_time ?? 0),      optional: true, hasData: f => hasTime(f.me_time) },
    { header: 'PIC',                  value: f => toHHMM(f.pic),               optional: true, hasData: f => hasTime(f.pic) },
    { header: 'PICUS',                value: f => toHHMM(f.picus ?? 0),        optional: true, hasData: f => hasTime(f.picus) },
    { header: 'SPIC',                 value: f => toHHMM(f.spic ?? 0),         optional: true, hasData: f => hasTime(f.spic) },
    { header: 'Copilot',              value: f => toHHMM(f.co_pilot),          optional: true, hasData: f => hasTime(f.co_pilot) },
    { header: 'Relief Crew',          value: f => toHHMM(f.relief_crew ?? 0),  optional: true, hasData: f => hasTime(f.relief_crew) },
    { header: 'Ferry PIC',            value: f => toHHMM(f.ferry_pic ?? 0),    optional: true, hasData: f => hasTime(f.ferry_pic) },
    { header: 'Observer',             value: f => toHHMM(f.observer ?? 0),     optional: true, hasData: f => hasTime(f.observer) },
    { header: 'Dual (elev)',          value: f => toHHMM(f.dual),              optional: true, hasData: f => hasTime(f.dual) },
    { header: 'Instruktör',           value: f => toHHMM(f.instructor ?? 0),   optional: true, hasData: f => hasTime(f.instructor) },
    { header: 'Examinator',           value: f => toHHMM(f.examiner ?? 0),     optional: true, hasData: f => hasTime(f.examiner) },
    { header: 'Safety Pilot',         value: f => toHHMM(f.safety_pilot ?? 0), optional: true, hasData: f => hasTime(f.safety_pilot) },
    { header: 'IFR',                  value: f => toHHMM(f.ifr),               optional: true, hasData: f => hasTime(f.ifr) },
    { header: 'VFR',                  value: f => toHHMM(f.vfr ?? 0),          optional: true, hasData: f => hasTime(f.vfr) },
    { header: 'Natt',                 value: f => toHHMM(f.night),             optional: true, hasData: f => hasTime(f.night) },
    { header: 'NVG',                  value: f => toHHMM(f.nvg ?? 0),          optional: true, hasData: f => hasTime(f.nvg) },
    { header: 'Landningar dag',       value: f => f.landings_day },
    { header: 'Landningar natt',      value: f => f.landings_night,            optional: true, hasData: f => (f.landings_night ?? 0) > 0 },
    { header: 'Touch & Go',           value: f => f.tng_count ?? 0,            optional: true, hasData: f => (f.tng_count ?? 0) > 0 },
    { header: 'Flygregler',           value: f => f.flight_rules ?? 'VFR' },
    { header: 'Andrepilot',           value: f => f.second_pilot ?? '',        optional: true, hasData: f => hasText(f.second_pilot) },
    { header: 'Anmärkningar',         value: f => [f.second_pilot ? `2P: ${f.second_pilot}` : '', f.remarks ?? ''].filter(Boolean).join(' · '),
                                       optional: true, hasData: f => hasText(f.remarks) || hasText(f.second_pilot) },
    { header: 'Flygningstyp',         value: f => f.flight_type === 'sim' ? 'FFS/Sim' : f.flight_type === 'hot_refuel' ? 'Hot refuel' : 'Normal',
                                       optional: true, hasData: f => f.flight_type && f.flight_type !== 'normal' },
    { header: 'Sim-kategori',         value: f => f.flight_type === 'sim' ? (f.sim_category ?? '').replace(/_/g, '/') : '',
                                       optional: true, hasData: f => f.flight_type === 'sim' && hasText(f.sim_category) },
  ];

  // Filter columns based on regulation standard. CAA (UK) speglar EASA.
  let filteredCols = cols;
  if (standard === 'easa' || standard === 'caa') {
    // EASA/CAA: exclude some FAA-specific columns
    const easa_exclude = new Set(['Enpilottid', 'Flerpilottid', 'PICUS', 'SPIC', 'Ferry PIC']);
    filteredCols = cols.filter(c => !easa_exclude.has(c.header));
  } else {
    // FAA: include all columns, no exclusions
    filteredCols = cols;
  }

  const activeCols = filteredCols.filter(c => !c.optional || flights.some(f => c.hasData!(f)));
  const headers = activeCols.map(c => c.header);
  const rows = flights.map((f: Flight) =>
    activeCols.map(c => c.value(f)).map(escapeCSV).join(',')
  );

  const csv = [headers.join(','), ...rows].join('\r\n');
  const standardSuffix = standard === 'faa' ? '_faa' : standard === 'caa' ? '_caa' : '_easa';
  const filename = `loggbok${standardSuffix}_${new Date().toISOString().split('T')[0]}.csv`;
  const path = FileSystem.documentDirectory + filename;

  await FileSystem.writeAsStringAsync(path, '\uFEFF' + csv, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, {
      mimeType: 'text/csv',
      dialogTitle: 'Exportera loggbok — CSV',
    });
  }
}

// ── Operatörsexport (uppdragsdata) ───────────────────────────────────────────

export async function exportOperatorCSV(): Promise<void> {
  const flights = await getFlights(99999);
  const tempCodes = await getTempIcaoCodes();
  const ops = flights
    .map((f) => ({ f, op: parseOperatorData(f) }))
    .filter((x) => x.op !== null) as { f: Flight; op: any }[];

  // Union av rollfält i rollens ordning (exkl. mission_type → egen kolumn).
  const keyOrder: string[] = [];
  const seen = new Set<string>();
  const defByKey: Record<string, any> = {};
  for (const { op } of ops) {
    for (const def of getRoleFields(op.role)) {
      defByKey[def.key] = def;
      if (def.key !== 'mission_type' && !seen.has(def.key)) { seen.add(def.key); keyOrder.push(def.key); }
    }
  }

  const cell = (op: any, key: string): string => {
    const v = op[key];
    if (v == null) return '';
    if (Array.isArray(v)) return v.join('; ');
    if (v === true) return 'yes';
    if (v === false) return '';
    return String(v);
  };
  const missionCell = (op: any): string => {
    const mt = op.mission_type;
    return Array.isArray(mt) ? mt.join('; ') : (mt ?? '');
  };

  const headers = [
    'Date', 'Aircraft', 'Reg', 'Departure', 'Arrival', 'Duty time', 'Night', 'Role', 'Mission',
    ...keyOrder.map((k) => (defByKey[k] ? defByKey[k].label_en : k)),
    'Remarks',
  ];
  const rows = ops.map(({ f, op }) => [
    f.date, f.aircraft_type, f.registration,
    exportPlace(f.dep_place, tempCodes), exportPlace(f.arr_place, tempCodes),
    toHHMM(Number(f.total_time) || 0), toHHMM(Number(f.night) || 0),
    op.role, missionCell(op),
    ...keyOrder.map((k) => cell(op, k)),
    f.remarks ?? '',
  ].map(escapeCSV).join(','));

  const csv = [headers.join(','), ...rows].join('\r\n');
  const filename = `operator_log_${new Date().toISOString().split('T')[0]}.csv`;
  const path = FileSystem.documentDirectory + filename;
  await FileSystem.writeAsStringAsync(path, '﻿' + csv, { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, { mimeType: 'text/csv', dialogTitle: 'Export operator log — CSV' });
  }
}

// ── Custom CSV export ────────────────────────────────────────────────────────

type CustomColumn = { key: string; header: string };
type CustomExportOpts = { columns: CustomColumn[]; separator: string; timeFormat: 'hhmm' | 'decimal'; standard?: 'easa' | 'faa' | 'caa' };

const timeFields = new Set([
  'total_time', 'pic', 'co_pilot', 'dual', 'instructor', 'examiner', 'safety_pilot',
  'ifr', 'vfr', 'night', 'nvg', 'multi_pilot', 'single_pilot', 'se_time', 'me_time',
  'picus', 'spic', 'ferry_pic', 'observer', 'relief_crew',
]);

function getFlightValue(f: Flight, key: string, fmt: 'hhmm' | 'decimal', tempCodes: Set<string>): string | number {
  const raw = (f as any)[key];
  if (key === 'dep_place' || key === 'arr_place') return exportPlace(String(raw ?? ''), tempCodes);
  if (key === 'flight_type') return f.flight_type === 'sim' ? 'Sim' : f.flight_type === 'hot_refuel' ? 'Hot refuel' : 'Normal';
  if (key === 'sim_category') return f.flight_type === 'sim' ? (f.sim_category ?? '').replace(/_/g, '/') : '';
  if (timeFields.has(key)) {
    const n = parseFloat(String(raw)) || 0;
    return fmt === 'hhmm' ? toHHMM(n) : n;
  }
  return raw ?? '';
}

export async function exportCustomCSV(opts: CustomExportOpts): Promise<void> {
  const flights = await getFlights(99999);
  const tempCodes = await getTempIcaoCodes();
  const sep = opts.separator;

  const escapeVal = (val: string | number | null | undefined): string => {
    const s = String(val ?? '');
    if (s.includes(sep) || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const headers = opts.columns.map(c => escapeVal(c.header));
  const rows = flights.map(f =>
    opts.columns.map(c => escapeVal(getFlightValue(f, c.key, opts.timeFormat, tempCodes))).join(sep)
  );

  const csv = [headers.join(sep), ...rows].join('\r\n');
  const filename = `logbook_custom_${new Date().toISOString().split('T')[0]}.csv`;
  const path = FileSystem.documentDirectory + filename;

  await FileSystem.writeAsStringAsync(path, '\uFEFF' + csv, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, {
      mimeType: 'text/csv',
      dialogTitle: 'Custom CSV Export',
    });
  }
}

// ── PDF (HTML → dela → Skriv ut) ─────────────────────────────────────────────

export async function exportToPDF(): Promise<void> {
  const { listCertificates, certStatus } = require('../db/drones');
  const { getSetting } = require('../db/flights');
  const { getAllAircraftTypes } = require('../db/flights');

  const [flights, stats, certs] = await Promise.all([
    getFlights(99999),
    getFlightStats(),
    listCertificates(),
  ]);

  const firstName = (await getSetting('profile_first_name')) ?? '';
  const lastName = (await getSetting('profile_last_name')) ?? '';
  const pilotName = `${firstName} ${lastName}`.trim() || 'Pilot';

  const realFlights = flights.filter((f: Flight) => f.flight_type !== 'sim');
  const simFlights  = flights.filter((f: Flight) => f.flight_type === 'sim');

  const dates = flights.map((f: Flight) => f.date).sort();
  const firstDate = dates[0] ?? '—';
  const lastDate  = dates[dates.length - 1] ?? '—';

  const sum = (key: keyof Flight, arr = realFlights) =>
    arr.reduce((acc, f) => acc + (Number(f[key]) || 0), 0);

  const totals = {
    total: sum('total_time'), pic: sum('pic'), co_pilot: sum('co_pilot'),
    dual: sum('dual'), instructor: sum('instructor'),
    multi_pilot: sum('multi_pilot'), single_pilot: sum('single_pilot'),
    se: sum('se_time'), me: sum('me_time'),
    ifr: sum('ifr'), night: sum('night'), nvg: sum('nvg'),
    sim: sum('total_time', simFlights),
    ldg_day: sum('landings_day'), ldg_night: sum('landings_night'), tng: sum('tng_count'),
  };

  // Aircraft experience breakdown
  const acMap = new Map<string, { hours: number; flights: number; lastDate: string }>();
  for (const f of realFlights) {
    const t = f.aircraft_type;
    if (!t) continue;
    const cur = acMap.get(t) ?? { hours: 0, flights: 0, lastDate: '' };
    cur.hours += f.total_time || 0;
    cur.flights++;
    if (f.date > cur.lastDate) cur.lastDate = f.date;
    acMap.set(t, cur);
  }
  const aircraftList = Array.from(acMap.entries())
    .sort((a, b) => b[1].hours - a[1].hours);

  // Unique airports
  const airports = new Set<string>();
  for (const f of flights) {
    if (f.dep_place) airports.add(f.dep_place);
    if (f.arr_place) airports.add(f.arr_place);
  }

  const h = (n: number) => toHHMM(n);
  const dec = (n: number) => n.toFixed(1);
  const exportDate = new Date().toLocaleDateString('sv-SE', { year: 'numeric', month: 'long', day: 'numeric' });

  // Certificates HTML
  const activeCerts = certs.filter((c: any) => {
    const s = certStatus(c);
    return s === 'valid' || s === 'expiring';
  });
  const expiredCerts = certs.filter((c: any) => certStatus(c) === 'expired');

  const certRows = activeCerts.map((c: any) => {
    const status = certStatus(c);
    const color = status === 'expiring' ? '#d97706' : '#16a34a';
    return `<div class="cert-item">
      <span class="cert-dot" style="background:${color}"></span>
      <span class="cert-name">${c.cert_type}${c.label ? ` — ${c.label}` : ''}</span>
      <span class="cert-date">${c.expires_date ? `exp. ${c.expires_date}` : 'No expiry'}</span>
    </div>`;
  }).join('\n');

  const aircraftRows = aircraftList.map(([type, data]) =>
    `<tr>
      <td style="font-weight:700">${type}</td>
      <td class="num">${h(data.hours)}</td>
      <td class="num">${dec(data.hours)}</td>
      <td class="num">${data.flights}</td>
      <td>${data.lastDate}</td>
    </tr>`
  ).join('\n');

  // Year breakdown for last 5 years
  const yearMap = new Map<string, number>();
  for (const f of realFlights) {
    const yr = f.date.slice(0, 4);
    yearMap.set(yr, (yearMap.get(yr) ?? 0) + (f.total_time || 0));
  }
  const years = Array.from(yearMap.entries()).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 5);
  const maxYearHours = Math.max(...years.map(y => y[1]), 1);

  const yearBars = years.map(([yr, hrs]) => {
    const pct = Math.round((hrs / maxYearHours) * 100);
    return `<div class="year-row">
      <span class="year-label">${yr}</span>
      <div class="year-bar-bg"><div class="year-bar-fill" style="width:${pct}%"></div></div>
      <span class="year-value">${h(hrs)}</span>
    </div>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="UTF-8">
<title>${pilotName} — Flight Experience ${exportDate}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; font-size: 9pt; color: #1e293b; background: #fff; }

  .page { padding: 18mm 20mm; }

  /* Header */
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 16pt; padding-bottom: 12pt; border-bottom: 2pt solid #1e293b; }
  .header-left {}
  .pilot-name { font-size: 28pt; font-weight: 800; color: #0f172a; letter-spacing: -0.8pt; }
  .pilot-sub { font-size: 11pt; color: #64748b; margin-top: 2pt; }
  .header-right { text-align: right; }
  .header-total-label { font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1pt; color: #94a3b8; }
  .header-total { font-size: 32pt; font-weight: 800; color: #1e293b; font-family: 'SF Mono', 'Courier New', monospace; font-variant-numeric: tabular-nums; }
  .header-total-sub { font-size: 8pt; color: #64748b; }

  /* Section */
  .section { margin-top: 16pt; }
  .section-title { font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 1.2pt; color: #94a3b8; margin-bottom: 6pt; padding-bottom: 3pt; border-bottom: 0.5pt solid #e2e8f0; }

  /* Stat grid */
  .grid { display: grid; gap: 6pt; margin-bottom: 4pt; }
  .grid-4 { grid-template-columns: repeat(4, 1fr); }
  .grid-5 { grid-template-columns: repeat(5, 1fr); }
  .grid-6 { grid-template-columns: repeat(6, 1fr); }
  .card { background: #f8fafc; border: 0.5pt solid #e2e8f0; border-radius: 5pt; padding: 7pt 8pt; }
  .card-label { font-size: 6pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5pt; color: #94a3b8; margin-bottom: 1pt; }
  .card-value { font-size: 14pt; font-weight: 800; color: #0f172a; font-family: 'SF Mono', 'Courier New', monospace; font-variant-numeric: tabular-nums; }
  .card-sub { font-size: 6pt; color: #94a3b8; }
  .card-value.blue { color: #2563eb; }
  .card-value.amber { color: #d97706; }

  /* Certificates */
  .cert-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3pt 16pt; }
  .cert-item { display: flex; align-items: center; gap: 4pt; padding: 3pt 0; }
  .cert-dot { width: 5pt; height: 5pt; border-radius: 50%; flex-shrink: 0; }
  .cert-name { font-size: 8pt; font-weight: 600; color: #1e293b; flex: 1; }
  .cert-date { font-size: 7pt; color: #94a3b8; white-space: nowrap; }

  /* Aircraft table */
  .ac-table { width: 100%; border-collapse: collapse; font-size: 8pt; }
  .ac-table th { text-align: left; font-size: 6pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5pt; color: #94a3b8; padding: 3pt 4pt; border-bottom: 1pt solid #e2e8f0; }
  .ac-table th.num { text-align: right; }
  .ac-table td { padding: 4pt; border-bottom: 0.3pt solid #f1f5f9; }
  .ac-table td.num { text-align: right; font-family: 'SF Mono', 'Courier New', monospace; font-variant-numeric: tabular-nums; }
  .ac-table tr:nth-child(even) td { background: #fafbfc; }

  /* Year bars */
  .year-row { display: flex; align-items: center; gap: 6pt; margin-bottom: 4pt; }
  .year-label { font-size: 8pt; font-weight: 700; color: #475569; width: 28pt; }
  .year-bar-bg { flex: 1; height: 10pt; background: #f1f5f9; border-radius: 5pt; overflow: hidden; }
  .year-bar-fill { height: 100%; background: linear-gradient(90deg, #2563eb, #3b82f6); border-radius: 5pt; }
  .year-value { font-size: 8pt; font-weight: 700; color: #1e293b; font-family: 'SF Mono', monospace; width: 36pt; text-align: right; }

  /* Two column layout */
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 16pt; }
  .cols-wide { display: grid; grid-template-columns: 3fr 2fr; gap: 16pt; }

  /* Footer */
  .footer { margin-top: 20pt; padding-top: 8pt; border-top: 0.5pt solid #e2e8f0; display: flex; justify-content: space-between; font-size: 7pt; color: #94a3b8; }

  @media print {
    @page { size: A4 portrait; margin: 12mm; }
    .page { padding: 0; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div class="header-left">
      <div class="pilot-name">${pilotName}</div>
      <div class="pilot-sub">${activeCerts.length > 0 ? activeCerts.slice(0, 3).map((c: any) => c.cert_type).join(' · ') : 'Pilot'}</div>
    </div>
    <div class="header-right">
      <div class="header-total-label">Total flight time</div>
      <div class="header-total">${h(totals.total)}</div>
      <div class="header-total-sub">${dec(totals.total)} hours · ${realFlights.length} flights · ${airports.size} airports</div>
    </div>
  </div>

  <!-- Flight time summary -->
  <div class="section">
    <div class="section-title">Flight Time Summary</div>
    <div class="grid grid-6">
      <div class="card"><div class="card-label">PIC</div><div class="card-value">${h(totals.pic)}</div></div>
      <div class="card"><div class="card-label">Co-pilot</div><div class="card-value">${h(totals.co_pilot)}</div></div>
      <div class="card"><div class="card-label">Dual received</div><div class="card-value">${h(totals.dual)}</div></div>
      <div class="card"><div class="card-label">Instructor</div><div class="card-value">${h(totals.instructor)}</div></div>
      <div class="card"><div class="card-label">Multi-pilot</div><div class="card-value">${h(totals.multi_pilot)}</div></div>
      <div class="card"><div class="card-label">Single-pilot</div><div class="card-value">${h(totals.single_pilot)}</div></div>
    </div>
    <div class="grid grid-6">
      <div class="card"><div class="card-label">IFR</div><div class="card-value blue">${h(totals.ifr)}</div></div>
      <div class="card"><div class="card-label">Night</div><div class="card-value">${h(totals.night)}</div></div>
      <div class="card"><div class="card-label">NVG</div><div class="card-value">${h(totals.nvg)}</div></div>
      <div class="card"><div class="card-label">SE</div><div class="card-value">${h(totals.se)}</div></div>
      <div class="card"><div class="card-label">ME</div><div class="card-value">${h(totals.me)}</div></div>
      <div class="card"><div class="card-label">FFS / Sim</div><div class="card-value amber">${h(totals.sim)}</div></div>
    </div>
    <div class="grid grid-4">
      <div class="card"><div class="card-label">Landings day</div><div class="card-value">${totals.ldg_day}</div></div>
      <div class="card"><div class="card-label">Landings night</div><div class="card-value">${totals.ldg_night}</div></div>
      <div class="card"><div class="card-label">Last 90 days</div><div class="card-value">${h(stats.last_90_days)}</div></div>
      <div class="card"><div class="card-label">Last 12 months</div><div class="card-value">${h(stats.last_12_months)}</div></div>
    </div>
  </div>

  <div class="cols-wide">
    <!-- Aircraft experience -->
    <div class="section">
      <div class="section-title">Aircraft Experience</div>
      <table class="ac-table">
        <thead><tr><th>Type</th><th class="num">HH:MM</th><th class="num">Decimal</th><th class="num">Flights</th><th>Last flown</th></tr></thead>
        <tbody>${aircraftRows}</tbody>
      </table>
    </div>

    <!-- Right column -->
    <div>
      <!-- Certificates -->
      ${activeCerts.length > 0 ? `
      <div class="section">
        <div class="section-title">Certificates &amp; Ratings (${activeCerts.length} active)</div>
        <div class="cert-grid">${certRows}</div>
      </div>` : ''}

      <!-- Year breakdown -->
      ${years.length > 0 ? `
      <div class="section">
        <div class="section-title">Annual Flight Hours</div>
        ${yearBars}
      </div>` : ''}
    </div>
  </div>

  <div class="footer">
    <span>Generated from BLADES — Joint Logbook</span>
    <span>${exportDate} · Period: ${firstDate} – ${lastDate}</span>
  </div>

</div>
</body>
</html>`;

  const filename = `loggbok_${new Date().toISOString().split('T')[0]}.html`;
  const path = FileSystem.documentDirectory + filename;

  await FileSystem.writeAsStringAsync(path, html, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, {
      mimeType: 'text/html',
      dialogTitle: 'Exportera loggbok — öppna i Safari → Dela → Skriv ut',
      UTI: 'public.html',
    });
  }
}
