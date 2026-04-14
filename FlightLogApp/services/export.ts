import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { getFlights, getFlightStats } from '../db/flights';
import type { Flight } from '../types/flight';

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

export async function exportToCSV(): Promise<void> {
  const flights = await getFlights(99999);

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
    { header: 'Avgångsplats',         value: f => f.dep_place },
    { header: 'Avgångstid UTC',       value: f => f.dep_utc },
    { header: 'Ankomstplats',         value: f => f.arr_place },
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
    { header: 'Sim-kategori',         value: f => f.flight_type === 'sim' ? (f.sim_category ?? '').replace('_', ' ') : '',
                                       optional: true, hasData: f => f.flight_type === 'sim' && hasText(f.sim_category) },
  ];

  const activeCols = cols.filter(c => !c.optional || flights.some(f => c.hasData!(f)));
  const headers = activeCols.map(c => c.header);
  const rows = flights.map((f: Flight) =>
    activeCols.map(c => c.value(f)).map(escapeCSV).join(',')
  );

  const csv = [headers.join(','), ...rows].join('\r\n');
  const filename = `loggbok_${new Date().toISOString().split('T')[0]}.csv`;
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

// ── PDF (HTML → dela → Skriv ut) ─────────────────────────────────────────────

export async function exportToPDF(): Promise<void> {
  const [flights, stats] = await Promise.all([getFlights(99999), getFlightStats()]);

  const realFlights = flights.filter((f: Flight) => f.flight_type !== 'sim');
  const simFlights  = flights.filter((f: Flight) => f.flight_type === 'sim');

  // Datumintervall
  const dates = flights.map((f: Flight) => f.date).sort();
  const firstDate = dates[0] ?? '—';
  const lastDate  = dates[dates.length - 1] ?? '—';

  // Summor för PDF (sim separerat)
  const sum = (key: keyof Flight, arr = realFlights) =>
    arr.reduce((acc, f) => acc + (Number(f[key]) || 0), 0);

  const totals = {
    total:       sum('total_time'),
    pic:         sum('pic'),
    co_pilot:    sum('co_pilot'),
    dual:        sum('dual'),
    instructor:  sum('instructor'),
    multi_pilot: sum('multi_pilot'),
    single_pilot:sum('single_pilot'),
    se:          sum('se_time'),
    me:          sum('me_time'),
    ifr:         sum('ifr'),
    night:       sum('night'),
    nvg:         sum('nvg'),
    sim:         sum('total_time', simFlights),
    ldg_day:     sum('landings_day'),
    ldg_night:   sum('landings_night'),
    tng:         sum('tng_count'),
  };

  const h = (n: number) => toHHMM(n);
  const exportDate = new Date().toLocaleDateString('sv-SE', { year: 'numeric', month: 'long', day: 'numeric' });

  // ── Tabellrader ───────────────────────────────────────────────────────────

  const rows = flights.map((f: Flight) => {
    const isSim = f.flight_type === 'sim';
    const rowClass = isSim ? 'sim-row' : (f.flight_rules === 'IFR' ? 'ifr-row' : '');
    return `<tr class="${rowClass}">
      <td>${f.date}</td>
      <td>${f.aircraft_type}</td>
      <td>${f.registration}</td>
      <td>${f.dep_place}</td>
      <td>${f.dep_utc}</td>
      <td>${f.arr_place}</td>
      <td>${f.arr_utc}</td>
      <td class="num">${isSim ? '—' : h(f.total_time)}</td>
      <td class="num">${isSim ? h(f.total_time) : '—'}</td>
      <td class="num">${h(f.multi_pilot ?? 0)}</td>
      <td class="num">${h(f.single_pilot ?? 0)}</td>
      <td class="num">${h(f.se_time ?? 0)}</td>
      <td class="num">${h(f.me_time ?? 0)}</td>
      <td class="num">${h(f.pic)}</td>
      <td class="num">${h(f.co_pilot)}</td>
      <td class="num">${h(f.dual)}</td>
      <td class="num">${h(f.instructor ?? 0)}</td>
      <td class="num">${h(f.ifr)}</td>
      <td class="num">${h(f.night)}</td>
      <td class="num">${h(f.nvg ?? 0)}</td>
      <td class="num">${f.landings_day}</td>
      <td class="num">${f.landings_night}</td>
      <td class="num">${f.tng_count ?? 0}</td>
      <td>${f.remarks ?? ''}</td>
    </tr>`;
  }).join('\n');

  // ── Sammanfattningskort ───────────────────────────────────────────────────

  const statCard = (label: string, value: string, sub = '') => `
    <div class="stat-card">
      <div class="stat-label">${label}</div>
      <div class="stat-value">${value}</div>
      ${sub ? `<div class="stat-sub">${sub}</div>` : ''}
    </div>`;

  const html = `<!DOCTYPE html>
<html lang="sv">
<head>
<meta charset="UTF-8">
<title>Flygloggbok — Export ${exportDate}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, Arial, sans-serif;
    font-size: 8pt;
    color: #1a1a2e;
    background: #fff;
  }

  /* ── Omslagssida ── */
  .cover {
    padding: 20mm 20mm 10mm;
    page-break-after: always;
  }
  .cover-title {
    font-size: 26pt;
    font-weight: 800;
    color: #1a2235;
    margin-bottom: 4pt;
    letter-spacing: -0.5pt;
  }
  .cover-sub {
    font-size: 11pt;
    color: #64748b;
    margin-bottom: 20pt;
  }
  .cover-meta {
    font-size: 9pt;
    color: #94a3b8;
    margin-top: 4pt;
  }

  /* ── Statistiksektionen ── */
  .section-title {
    font-size: 7pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1pt;
    color: #94a3b8;
    margin: 14pt 0 6pt;
    padding-bottom: 3pt;
    border-bottom: 1pt solid #e2e8f0;
  }
  .stat-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 6pt;
    margin-bottom: 4pt;
  }
  .stat-grid-3 {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6pt;
    margin-bottom: 4pt;
  }
  .stat-card {
    background: #f8fafc;
    border: 0.5pt solid #e2e8f0;
    border-radius: 5pt;
    padding: 7pt 8pt;
  }
  .stat-label {
    font-size: 6.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5pt;
    color: #94a3b8;
    margin-bottom: 2pt;
  }
  .stat-value {
    font-size: 14pt;
    font-weight: 800;
    color: #1a2235;
    font-variant-numeric: tabular-nums;
    font-family: 'SF Mono', 'Cascadia Code', 'Courier New', monospace;
  }
  .stat-sub {
    font-size: 6pt;
    color: #94a3b8;
    margin-top: 1pt;
  }
  .stat-card.accent .stat-value { color: #2563eb; }
  .stat-card.gold .stat-value { color: #d97706; }
  .stat-card.green .stat-value { color: #16a34a; }

  /* ── Loggbokstabell ── */
  .log-section {
    page-break-before: always;
    padding: 0 0 0;
  }
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    margin-bottom: 6pt;
    padding: 0 2pt;
  }
  .page-header-title {
    font-size: 9pt;
    font-weight: 700;
    color: #1a2235;
  }
  .page-header-meta {
    font-size: 7pt;
    color: #94a3b8;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 6.5pt;
  }
  thead tr th {
    background: #1a2235;
    color: #fff;
    padding: 3pt 2pt;
    text-align: left;
    font-size: 6pt;
    font-weight: 700;
    letter-spacing: 0.3pt;
    white-space: nowrap;
  }
  thead tr th.num { text-align: right; }

  tbody tr td {
    padding: 2.5pt 2pt;
    border-bottom: 0.3pt solid #e2e8f0;
    vertical-align: middle;
    white-space: nowrap;
  }
  tbody tr:nth-child(even) td { background: #f8fafc; }
  tbody tr:hover td { background: #eff6ff; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; font-family: monospace; }

  .sim-row td { color: #d97706; background: #fffbeb !important; }
  .ifr-row td { color: #2563eb; }

  tfoot tr td {
    background: #1a2235 !important;
    color: #fff;
    font-weight: 700;
    padding: 3pt 2pt;
    font-size: 6.5pt;
  }
  tfoot .num { text-align: right; font-variant-numeric: tabular-nums; font-family: monospace; }

  .legend {
    display: flex;
    gap: 12pt;
    margin-top: 6pt;
    font-size: 6.5pt;
    color: #64748b;
  }
  .legend-dot {
    display: inline-block;
    width: 6pt; height: 6pt;
    border-radius: 50%;
    margin-right: 3pt;
    vertical-align: middle;
  }

  @media print {
    body { font-size: 7pt; }
    .cover { padding: 15mm 15mm 8mm; }
    @page { size: A4 landscape; margin: 8mm; }
    @page :first { size: A4 portrait; margin: 15mm; }
  }
</style>
</head>
<body>

<!-- ── Omslagssida / Sammanfattning ── -->
<div class="cover">
  <div class="cover-title">Flygloggbok</div>
  <div class="cover-sub">EASA FCL.050 — Personlig loggbok</div>
  <div class="cover-meta">Exporterad: ${exportDate}</div>
  <div class="cover-meta">Period: ${firstDate} – ${lastDate} &nbsp;·&nbsp; ${flights.length} flygningar (varav ${simFlights.length} FFS/Sim)</div>

  <!-- Flygtider -->
  <div class="section-title">Flygtider</div>
  <div class="stat-grid">
    ${statCard('Total flygtid', h(totals.total), 'Exkl. FFS/Sim')}
    ${statCard('PIC', h(totals.pic), 'Pilot in Command')}
    ${statCard('Co-pilot', h(totals.co_pilot), 'SIC')}
    ${statCard('Dual (elev)', h(totals.dual), 'Mottagen')}
    ${statCard('Instruktör', h(totals.instructor), 'Given')}
  </div>

  <!-- Operativa förhållanden -->
  <div class="section-title">Operativa förhållanden</div>
  <div class="stat-grid">
    ${statCard('IFR', h(totals.ifr), 'Instrumentflyg')}
    ${statCard('Natt', h(totals.night), 'Natttid')}
    ${statCard('NVG', h(totals.nvg), 'Night Vision')}
    ${statCard('Multi-pilot', h(totals.multi_pilot), 'Flerpilot')}
    ${statCard('Single pilot', h(totals.single_pilot), 'Enpilot')}
    ${statCard('SE', h(totals.se), 'Single Engine')}
    ${statCard('ME', h(totals.me), 'Multi Engine')}
  </div>

  <!-- Simulator & landningar -->
  <div class="section-title">FFS / Simulator &amp; Landningar</div>
  <div class="stat-grid">
    ${statCard('FFS / Sim', h(totals.sim), 'Full Flight Sim')}
    ${statCard('Landningar dag', String(totals.ldg_day), '')}
    ${statCard('Landningar natt', String(totals.ldg_night), '')}
    ${statCard('Touch &amp; Go', String(totals.tng), '')}
    ${statCard('Flygningar', String(flights.length), `${realFlights.length} verkliga`)}
  </div>

  <!-- Senaste aktivitet -->
  <div class="section-title">Senaste aktivitet</div>
  <div class="stat-grid-3">
    ${statCard('Senaste 90 dagarna', h(stats.last_90_days), 'flygtimmar')}
    ${statCard('Senaste 12 månaderna', h(stats.last_12_months), 'flygtimmar')}
    ${statCard('Bästa veckan', h(stats.best_week_hours), stats.best_week_label || '—')}
  </div>
</div>

<!-- ── Loggbok ── -->
<div class="log-section">
  <div class="page-header">
    <span class="page-header-title">Loggbok — Alla flygningar</span>
    <span class="page-header-meta">${flights.length} poster · ${firstDate} – ${lastDate}</span>
  </div>

  <table>
    <thead>
      <tr>
        <th>Datum</th>
        <th>Typ</th>
        <th>Reg</th>
        <th>Avg.</th>
        <th>Avg.tid</th>
        <th>Ank.</th>
        <th>Ank.tid</th>
        <th class="num">Total</th>
        <th class="num">FFS</th>
        <th class="num">MP</th>
        <th class="num">SP</th>
        <th class="num">SE</th>
        <th class="num">ME</th>
        <th class="num">PIC</th>
        <th class="num">Co-P</th>
        <th class="num">Dual</th>
        <th class="num">Instr</th>
        <th class="num">IFR</th>
        <th class="num">Natt</th>
        <th class="num">NVG</th>
        <th class="num">L.dag</th>
        <th class="num">L.natt</th>
        <th class="num">T&amp;G</th>
        <th>Anmärkningar</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
    <tfoot>
      <tr>
        <td colspan="7">TOTALER — ${flights.length} poster</td>
        <td class="num">${h(totals.total)}</td>
        <td class="num">${h(totals.sim)}</td>
        <td class="num">${h(totals.multi_pilot)}</td>
        <td class="num">${h(totals.single_pilot)}</td>
        <td class="num">${h(totals.se)}</td>
        <td class="num">${h(totals.me)}</td>
        <td class="num">${h(totals.pic)}</td>
        <td class="num">${h(totals.co_pilot)}</td>
        <td class="num">${h(totals.dual)}</td>
        <td class="num">${h(totals.instructor)}</td>
        <td class="num">${h(totals.ifr)}</td>
        <td class="num">${h(totals.night)}</td>
        <td class="num">${h(totals.nvg)}</td>
        <td class="num">${totals.ldg_day}</td>
        <td class="num">${totals.ldg_night}</td>
        <td class="num">${totals.tng}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>

  <div class="legend">
    <span><span class="legend-dot" style="background:#d97706"></span>Gul rad = FFS/Simulator (räknas ej i flygtid)</span>
    <span><span class="legend-dot" style="background:#2563eb"></span>Blå text = IFR-flygning</span>
    <span>Tider i format HH:MM &nbsp;·&nbsp; MP = Multi-pilot &nbsp;·&nbsp; SP = Single pilot &nbsp;·&nbsp; Instr = Instruktör</span>
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
