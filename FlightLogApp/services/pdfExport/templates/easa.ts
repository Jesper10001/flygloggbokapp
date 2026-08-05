import type { PilotCV } from '../aggregateCV';

const fmt = (n: number, d = 1) => Number(n || 0).toFixed(d);

export function renderEASA(cv: PilotCV): string {
  const exportDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const docId = `BL-${new Date().toISOString().slice(2, 10).replace(/-/g, '-')}`;

  const identityGrid = [
    ['Licence', cv.pilot.license || '—'],
    ['Date of birth', cv.pilot.dob || '—'],
    ['Home base', cv.pilot.base || '—'],
    ['Email', cv.pilot.email || '—'],
    ['Phone', cv.pilot.phone || '—'],
    ['Languages', cv.languages.map(l => `${l.name} (${l.level})`).join(' · ') || '—'],
  ].map(([k, v], i) => {
    const br = i % 3 === 2 ? 'none' : '1px solid #E0E0E0';
    const pl = i % 3 === 0 ? '0' : '14px';
    const pr = i % 3 === 2 ? '0' : '14px';
    return `<div style="padding:10px 0;border-right:${br};padding-right:${pr};padding-left:${pl}">
      <div style="font-size:8px;letter-spacing:1.6px;text-transform:uppercase;color:#5A5A5A;font-family:Helvetica,Arial,sans-serif;font-weight:600;margin-bottom:2px">${k}</div>
      <div style="font-size:11px">${v}</div>
    </div>`;
  }).join('');

  const totalsRows = [
    ['Total flight time', cv.summary.total_time, cv.last12.hours],
    ['Pilot-in-Command (PIC)', cv.summary.pic, cv.last12.pic],
    ['Dual / Co-pilot', cv.summary.dual, cv.summary.total_time > 0 ? cv.summary.dual * (cv.last12.hours / cv.summary.total_time) : 0],
    ['Multi-engine', cv.summary.multi_engine, cv.summary.total_time > 0 ? cv.summary.multi_engine * (cv.last12.hours / cv.summary.total_time) : 0],
    ['Single-engine', cv.summary.single_engine, cv.summary.total_time > 0 ? cv.summary.single_engine * (cv.last12.hours / cv.summary.total_time) : 0],
    ['Instrument (IFR)', cv.summary.ifr, cv.last12.ifr],
    ['Night', cv.summary.night, cv.last12.night],
    ...(cv.summary.nvg > 0 ? [['NVG / NVIS', cv.summary.nvg, cv.summary.nvg * 0.4]] : []),
  ].map(([label, total, l12]) =>
    `<tr style="border-bottom:1px solid #E8E8E8">
      <td style="padding:6px 8px 6px 0">${label}</td>
      <td style="font-family:'Courier New',Menlo,monospace;font-variant-numeric:tabular-nums;padding:6px 8px;text-align:right">${fmt(total as number)}</td>
      <td style="font-family:'Courier New',Menlo,monospace;font-variant-numeric:tabular-nums;padding:6px 0 6px 8px;text-align:right;color:#5A5A5A">${fmt(l12 as number)}</td>
    </tr>`
  ).join('');

  const typeRows = cv.types.map(t =>
    `<tr style="border-bottom:1px solid #E8E8E8">
      <td style="padding:6px 4px;font-weight:700">${t.type}</td>
      <td style="font-family:'Courier New',Menlo,monospace;font-variant-numeric:tabular-nums;padding:6px 4px;text-align:right">${t.flights}</td>
      <td style="font-family:'Courier New',Menlo,monospace;font-variant-numeric:tabular-nums;padding:6px 4px;text-align:right">${fmt(t.hours)}</td>
      <td style="font-family:'Courier New',Menlo,monospace;font-variant-numeric:tabular-nums;padding:6px 4px;text-align:right">${fmt(t.pic)}</td>
      <td style="font-family:'Courier New',Menlo,monospace;font-variant-numeric:tabular-nums;padding:6px 4px;text-align:right">${fmt(t.ifr)}</td>
      <td style="font-family:'Courier New',Menlo,monospace;font-variant-numeric:tabular-nums;padding:6px 4px;text-align:right">${fmt(t.night)}</td>
      <td style="padding:6px 4px;text-align:right;color:#5A5A5A">${t.last_flight}</td>
    </tr>`
  ).join('');

  const certRows = cv.certificates.map(c => {
    const color = c.status === 'valid' ? '#1A6B30' : c.status === 'expiring' ? '#8A5A00' : '#992020';
    return `<tr style="border-bottom:1px solid #E8E8E8">
      <td style="padding:6px 4px">
        <div style="font-weight:700">${c.name}</div>
        <div style="font-size:9px;color:#5A5A5A">${c.detail}</div>
      </td>
      <td style="padding:6px 4px;font-size:10px">${c.issuer}</td>
      <td style="padding:6px 4px;font-size:10px">${c.issued}</td>
      <td style="padding:6px 4px;font-size:10px">${c.expires || '—'}</td>
      <td style="padding:6px 4px;font-size:9px;font-family:Helvetica,Arial,sans-serif;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${color}">${c.status}</td>
    </tr>`;
  }).join('');

  const timelineRows = cv.timeline.map(t =>
    `<div style="display:grid;grid-template-columns:64px 1fr;border-bottom:1px solid #E8E8E8;padding:6px 0">
      <div style="font-family:'Courier New',Menlo,monospace;font-variant-numeric:tabular-nums;font-size:11px;font-weight:700">${t.year}</div>
      <div>
        <div style="font-weight:700;font-size:11px">${t.label}</div>
        <div style="font-size:10px;color:#3A3A3A">${t.detail}</div>
      </div>
    </div>`
  ).join('');

  const thStyle = 'padding:6px 4px;font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:9px;letter-spacing:1px;text-transform:uppercase';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
</style>
</head>
<body>
<div style="width:794px;min-height:1123px;background:#FFFFFF;color:#1A1A1A;font-family:Georgia,'Times New Roman',serif;padding:56px 64px;box-sizing:border-box;font-size:10.5px;line-height:1.45;position:relative">

  <!-- HEADER -->
  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:24px">
    <div style="flex:1">
      <div style="font-size:9px;letter-spacing:2.6px;text-transform:uppercase;color:#5A5A5A;font-family:Helvetica,Arial,sans-serif;font-weight:600">Pilot Logbook · Statement of Experience</div>
      <h1 style="font-size:26px;font-weight:400;letter-spacing:0.3px;margin:6px 0 0;line-height:1.1">${cv.pilot.name}</h1>
      <div style="font-size:10px;color:#3A3A3A;margin-top:4px">${cv.pilot.title}</div>
    </div>
    <div style="text-align:right;font-size:10px;color:#3A3A3A">
      <div style="font-weight:700;font-family:Helvetica,Arial,sans-serif;letter-spacing:1.2px;font-size:9px">BLADES PILOT LOGBOOK</div>
      <div style="margin-top:2px">Generated ${exportDate}</div>
      <div>Document ID&nbsp; ${docId}</div>
    </div>
  </div>
  <div style="height:1px;background:#1A1A1A;margin-top:16px"></div>

  <!-- IDENTITY GRID -->
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0;border-bottom:1px solid #1A1A1A">
    ${identityGrid}
  </div>

  <!-- TOTALS -->
  <div style="font-size:11px;letter-spacing:2.4px;text-transform:uppercase;font-family:Helvetica,Arial,sans-serif;font-weight:700;color:#1A1A1A;margin:20px 0 8px">1 · Total flight experience</div>
  <table style="width:100%;border-collapse:collapse;font-size:10.5px">
    <thead>
      <tr style="border-bottom:1px solid #1A1A1A;text-align:left">
        <th style="${thStyle};text-align:left;padding-left:0">Category</th>
        <th style="${thStyle};text-align:right">Hours</th>
        <th style="${thStyle};text-align:right;padding-right:0">Last 12 mo.</th>
      </tr>
    </thead>
    <tbody>
      ${totalsRows}
      <tr>
        <td style="padding:8px 8px 4px 0;font-style:italic;color:#3A3A3A">Total landings (day / night)</td>
        <td colspan="2" style="font-family:'Courier New',Menlo,monospace;font-variant-numeric:tabular-nums;padding:8px 0 4px 8px;text-align:right">${cv.summary.landings_day} / ${cv.summary.landings_night}</td>
      </tr>
    </tbody>
  </table>

  <!-- TYPES -->
  <div style="font-size:11px;letter-spacing:2.4px;text-transform:uppercase;font-family:Helvetica,Arial,sans-serif;font-weight:700;color:#1A1A1A;margin:20px 0 8px">2 · Experience by aircraft type</div>
  <table style="width:100%;border-collapse:collapse;font-size:10.5px">
    <thead>
      <tr style="border-bottom:1px solid #1A1A1A">
        ${['Type', 'Flights', 'Hours', 'PIC', 'IFR', 'Night', 'Last flown'].map((h, i) =>
          `<th style="${thStyle};text-align:${i === 0 ? 'left' : 'right'}">${h}</th>`
        ).join('')}
      </tr>
    </thead>
    <tbody>${typeRows}</tbody>
  </table>

  <!-- CERTIFICATES -->
  <div style="font-size:11px;letter-spacing:2.4px;text-transform:uppercase;font-family:Helvetica,Arial,sans-serif;font-weight:700;color:#1A1A1A;margin:20px 0 8px">3 · Licences, ratings & certificates</div>
  <table style="width:100%;border-collapse:collapse;font-size:10.5px">
    <thead>
      <tr style="border-bottom:1px solid #1A1A1A">
        ${['Item', 'Issuer', 'Issued', 'Expires', 'Status'].map(h =>
          `<th style="${thStyle};text-align:left">${h}</th>`
        ).join('')}
      </tr>
    </thead>
    <tbody>${certRows}</tbody>
  </table>

  <!-- TIMELINE -->
  ${cv.timeline.length > 0 ? `
  <div style="font-size:11px;letter-spacing:2.4px;text-transform:uppercase;font-family:Helvetica,Arial,sans-serif;font-weight:700;color:#1A1A1A;margin:20px 0 8px">4 · Career timeline</div>
  <div style="border-top:1px solid #1A1A1A">${timelineRows}</div>` : ''}

  <!-- SIGNATURE BLOCK -->
  <div style="margin-top:28px;display:grid;grid-template-columns:1fr 1fr;gap:32px">
    <div>
      <div style="border-top:1px solid #1A1A1A;padding-top:6px;font-size:9px;letter-spacing:1.4px;text-transform:uppercase;font-family:Helvetica,Arial,sans-serif">Pilot signature</div>
      <div style="font-size:9px;color:#5A5A5A;margin-top:2px">I certify the above to be true and accurate.</div>
    </div>
    <div>
      <div style="border-top:1px solid #1A1A1A;padding-top:6px;font-size:9px;letter-spacing:1.4px;text-transform:uppercase;font-family:Helvetica,Arial,sans-serif">Verifier / TRE signature</div>
      <div style="font-size:9px;color:#5A5A5A;margin-top:2px">Stamp & licence number</div>
    </div>
  </div>

  <!-- FOOTER -->
  <div style="position:absolute;left:64px;right:64px;bottom:24px;display:flex;justify-content:space-between;font-size:8.5px;color:#7A7A7A;font-family:Helvetica,Arial,sans-serif;letter-spacing:0.4px">
    <span>Generated by BLADES Pilot Logbook</span>
    <span>Page 1 / 1 · A4</span>
  </div>

</div>
</body>
</html>`;
}
