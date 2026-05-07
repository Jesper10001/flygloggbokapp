import type { PilotCV } from '../aggregateCV';

const fmt = (n: number, d = 1) => Number(n || 0).toFixed(d);
const ink = '#1A1815';
const accent = '#A23E2A';
const muted = '#7A6F5E';
const sans = "font-family:'Inter',-apple-system,sans-serif";
const num = "font-family:'JetBrains Mono',Menlo,monospace;font-variant-numeric:tabular-nums;letter-spacing:-0.5px";

export function renderEditorial(cv: PilotCV): string {
  const exportDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, ' / ');
  const docId = `BL-${new Date().toISOString().slice(2, 10).replace(/-/g, '-')}`;
  const firstName = cv.pilot.name.split(' ')[0] || '';
  const restName = cv.pilot.name.split(' ').slice(1).join(' ') || '';

  // Stats grid
  const statsData: [string, number, string, string][] = [
    ['I', cv.summary.total_time, 'h', 'Total flight time'],
    ['II', cv.summary.pic, 'h', 'As pilot-in-command'],
    ['III', cv.summary.multi_engine, 'h', 'Multi-engine'],
    ['IV', cv.summary.ifr, 'h', 'Instrument flight'],
    ['V', cv.summary.night, 'h', 'Night ops'],
    ['VI', cv.summary.total_landings, '', 'Landings recorded'],
  ];

  const statsGrid = statsData.map(([roman, val, unit, label], i) => {
    const br = (i + 1) % 3 !== 0 ? `border-right:1px solid ${ink}22;` : '';
    const bb = i < 3 ? `border-bottom:1px solid ${ink}22;` : '';
    const pl = i % 3 === 0 ? '0' : '16px';
    return `<div style="padding:16px 16px 16px 0;${br}${bb}padding-left:${pl};position:relative">
      <div style="${sans};font-size:9px;letter-spacing:2px;color:${accent};font-weight:700">№ ${roman}</div>
      <div style="display:flex;align-items:baseline;gap:4px;margin-top:6px">
        <span style="${num};font-size:38px;font-weight:500">${fmt(val, val < 100 ? 1 : 0)}</span>
        <span style="font-style:italic;font-size:16px;color:${muted}">${unit}</span>
      </div>
      <div style="${sans};font-size:10.5px;color:${muted};margin-top:2px">${label}</div>
    </div>`;
  }).join('');

  // Type rows (narrative)
  const typeRows = cv.types.map(t => {
    let detail = `${t.flights} flights · last flown ${t.last_flight}.`;
    if (t.ifr > 0) detail += ` ${fmt(t.ifr)} h IFR.`;
    if (t.night > 0) detail += ` ${fmt(t.night)} h night.`;
    return `<div style="display:grid;grid-template-columns:110px 1fr 90px 90px;align-items:baseline;padding:14px 0;border-bottom:1px solid ${ink}22">
      <div style="font-size:22px;font-weight:600;font-style:italic">${t.type}</div>
      <div style="${sans};font-size:11px;color:${muted};padding-right:16px;line-height:1.5">${detail}</div>
      <div style="${num};font-size:16px;text-align:right">${fmt(t.hours)} h</div>
      <div style="${num};font-size:12px;text-align:right;color:${muted}">${fmt(t.pic)} PIC</div>
    </div>`;
  }).join('');

  // Certificates
  const certCards = cv.certificates.map(c => {
    const tone = c.status === 'valid' ? muted : c.status === 'expiring' ? '#B8860B' : accent;
    return `<div style="padding:12px 0;border-bottom:1px solid ${ink}22">
      <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
        <div style="font-size:14px;font-weight:600">${c.name}</div>
        <div style="${sans};font-size:8.5px;font-style:italic;color:${tone};text-transform:lowercase;letter-spacing:0.4px">${c.status}</div>
      </div>
      <div style="${sans};font-size:10px;color:${muted};margin-top:2px;line-height:1.4">${c.detail}</div>
      <div style="${sans};font-size:9.5px;color:${muted};margin-top:4px;${num}">
        <span>${c.issuer}</span>
        <span style="margin:0 6px;color:${ink}44">·</span>
        <span>${c.issued}</span>
        ${c.expires ? `<span style="margin:0 6px;color:${ink}44">→</span><span>${c.expires}</span>` : ''}
      </div>
    </div>`;
  }).join('');

  // Timeline
  const timelineRows = cv.timeline.map(t =>
    `<div style="${num};font-size:14px;font-weight:600;padding:8px 12px 8px 0;border-bottom:1px solid ${ink}11;color:${accent}">${t.year}</div>
     <div style="padding:8px 0;border-bottom:1px solid ${ink}11;font-size:12.5px;line-height:1.55">
       <span style="font-weight:600">${t.label}.</span> <span style="color:${muted}">${t.detail}.</span>
     </div>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Inter:wght@400;500;600;700&family=JetBrains+Mono&display=swap" rel="stylesheet"/>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
</style>
</head>
<body>
<div style="width:794px;min-height:1123px;background:#F4EFE6;color:${ink};font-family:'Cormorant Garamond','EB Garamond',Georgia,serif;box-sizing:border-box;position:relative;padding:0;overflow:hidden">

  <!-- MASTHEAD -->
  <div style="display:flex;justify-content:space-between;align-items:baseline;padding:24px 56px 12px;border-bottom:1px solid ${ink}">
    <div style="${sans};font-size:9px;letter-spacing:4px;font-weight:700;text-transform:uppercase">Blades · Vol. I</div>
    <div style="${sans};font-size:9px;letter-spacing:3px;color:${muted}">Pilot dossier · ${exportDate}</div>
    <div style="${sans};font-size:9px;letter-spacing:4px;font-weight:700;text-transform:uppercase">Issue №&nbsp;47</div>
  </div>

  <!-- HERO -->
  <div style="padding:36px 56px 28px;border-bottom:1px solid ${ink}">
    <div style="${sans};font-size:9px;letter-spacing:3px;color:${accent};font-weight:700;text-transform:uppercase">A statement of experience</div>
    <h1 style="font-size:64px;font-weight:500;font-style:italic;line-height:0.95;margin:14px 0 6px;letter-spacing:-2px">
      ${firstName}<br/>
      <span style="font-style:normal;font-weight:400">${restName}</span>
    </h1>
    <div style="${sans};font-size:11px;color:${muted};margin-top:8px;max-width:460px;line-height:1.5">
      ${cv.pilot.title}${cv.pilot.license ? ` · ${cv.pilot.license}` : ''}${cv.pilot.base ? ` · Based at ${cv.pilot.base}` : ''}.<br/>
      ${fmt(cv.summary.total_time, 0)} hours flown across ${cv.types.length} types${cv.timeline.length > 0 ? ` since ${cv.timeline[0].year}` : ''}.
    </div>
  </div>

  <!-- STATS GRID -->
  <div style="padding:28px 56px 8px;display:grid;grid-template-columns:1fr 1fr 1fr;gap:0">
    ${statsGrid}
  </div>

  <!-- TYPES -->
  <div style="padding:24px 56px 0">
    <div style="display:flex;align-items:baseline;justify-content:space-between;border-bottom:1px solid ${ink};padding-bottom:8px">
      <div style="font-size:22px;font-style:italic;font-weight:500">Per&nbsp;type</div>
      <div style="${sans};font-size:9px;letter-spacing:2px;color:${muted};text-transform:uppercase">Hours · flights · most-recent</div>
    </div>
    ${typeRows}
  </div>

  <!-- CREDENTIALS -->
  <div style="padding:28px 56px 0">
    <div style="display:flex;align-items:baseline;justify-content:space-between;border-bottom:1px solid ${ink};padding-bottom:8px">
      <div style="font-size:22px;font-style:italic;font-weight:500">Credentials</div>
      <div style="${sans};font-size:9px;letter-spacing:2px;color:${muted};text-transform:uppercase">${cv.certificates.length} on file</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0 32px">
      ${certCards}
    </div>
  </div>

  <!-- TIMELINE -->
  ${cv.timeline.length > 0 ? `
  <div style="padding:28px 56px 12px">
    <div style="border-bottom:1px solid ${ink};padding-bottom:8px;font-size:22px;font-style:italic;font-weight:500">A short biography</div>
    <div style="display:grid;grid-template-columns:60px 1fr;gap:0">
      ${timelineRows}
    </div>
  </div>` : ''}

  <!-- COLOPHON -->
  <div style="position:absolute;left:56px;right:56px;bottom:22px;display:flex;justify-content:space-between;align-items:baseline;border-top:1px solid ${ink};padding-top:8px;${sans};font-size:9px;color:${muted};letter-spacing:1px">
    <span style="text-transform:uppercase;font-weight:700;color:${ink}">Blades</span>
    <span style="font-style:italic;font-family:'Cormorant Garamond',Georgia,serif;font-size:10px">Compiled from a verified flight log of ${cv.summary.total_flights} entries.</span>
    <span>${docId}</span>
  </div>

</div>
</body>
</html>`;
}
