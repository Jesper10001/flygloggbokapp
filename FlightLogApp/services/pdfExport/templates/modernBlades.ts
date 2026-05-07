import type { PilotCV } from '../aggregateCV';

const fmt = (n: number, d = 0) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const accent = '#00C8E8';
const navy = '#0A1628';
const numStyle = "font-family:Menlo,'SF Mono',monospace;font-variant-numeric:tabular-nums";

export function renderModern(cv: PilotCV): string {
  const exportDate = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const docId = `BL-${new Date().toISOString().slice(2, 10).replace(/-/g, '-')}`;

  const max = Math.max(...cv.months_bar.map(m => m.hours), 1);

  // Donut data
  const ifr = cv.summary.ifr;
  const night = cv.summary.night;
  const vfr = Math.max(cv.summary.total_time - ifr - night, 0);
  const total = ifr + vfr + night || 1;
  const r = 36;
  const c = 2 * Math.PI * r;
  const arc = (frac: number) => c * frac;

  // Hero stats
  const heroStats = [
    ['Total time', fmt(cv.summary.total_time, 1) + ' h', `${cv.summary.total_flights} flights`],
    ['PIC', fmt(cv.summary.pic, 1) + ' h', cv.summary.total_time > 0 ? `${Math.round(cv.summary.pic / cv.summary.total_time * 100)}% of total` : ''],
    ['Multi-engine', fmt(cv.summary.multi_engine, 1) + ' h', cv.types.length > 0 ? `${cv.types[0].type} primary` : ''],
    ['Last 12 months', fmt(cv.last12.hours, 1) + ' h', `${cv.last12.flights} flights · ${cv.last12.landings} ldgs`],
  ].map(([label, big, sub], i) => {
    const br = i < 3 ? 'border-right:1px solid #E6EAF0;' : '';
    const pl = i > 0 ? 'padding-left:18px;' : '';
    return `<div style="padding:18px 14px 18px 0;${br}${pl}">
      <div style="font-size:10px;letter-spacing:1.6px;text-transform:uppercase;color:#5F7FA0;font-weight:700">${label}</div>
      <div style="${numStyle};font-size:28px;font-weight:700;margin-top:4px;color:${navy};letter-spacing:-0.5px">${big}</div>
      <div style="font-size:10.5px;color:#5F7FA0;margin-top:2px">${sub}</div>
    </div>`;
  }).join('');

  // Bar chart
  const bars = cv.months_bar.map(m =>
    `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px">
      <div style="${numStyle};font-size:8.5px;color:#5F7FA0">${m.hours > 0 ? m.hours.toFixed(1) : ''}</div>
      <div style="width:100%;height:${(m.hours / max) * 90}px;background:${m.hours > 0 ? accent : '#EDF1F5'};border-radius:3px 3px 0 0"></div>
      <div style="font-size:9px;color:#5F7FA0;margin-top:2px">${m.label}</div>
    </div>`
  ).join('');

  // Donut SVG
  const donutSvg = `<svg width="100" height="100" viewBox="0 0 100 100">
    <circle cx="50" cy="50" r="${r}" fill="none" stroke="#EDF1F5" stroke-width="14"/>
    <circle cx="50" cy="50" r="${r}" fill="none" stroke="${accent}" stroke-width="14" stroke-dasharray="${arc(vfr / total)} ${c}" transform="rotate(-90 50 50)"/>
    <circle cx="50" cy="50" r="${r}" fill="none" stroke="#0A6B7E" stroke-width="14" stroke-dasharray="${arc(ifr / total)} ${c}" stroke-dashoffset="${-arc(vfr / total)}" transform="rotate(-90 50 50)"/>
    <circle cx="50" cy="50" r="${r}" fill="none" stroke="${navy}" stroke-width="14" stroke-dasharray="${arc(night / total)} ${c}" stroke-dashoffset="${-arc((vfr + ifr) / total)}" transform="rotate(-90 50 50)"/>
  </svg>`;

  // Type rows
  const topHours = cv.types.length > 0 ? cv.types[0].hours : 1;
  const typeRows = cv.types.map(t =>
    `<div style="display:grid;grid-template-columns:90px 1fr 70px 70px 70px 80px;align-items:center;padding:10px 0;border-bottom:1px solid #EDF1F5;font-size:11px">
      <div style="font-weight:700;font-size:13px">${t.type}</div>
      <div style="padding-right:12px">
        <div style="height:5px;background:#EDF1F5;border-radius:3px;position:relative;overflow:hidden">
          <div style="position:absolute;left:0;top:0;bottom:0;width:${(t.hours / topHours) * 100}%;background:${accent}"></div>
        </div>
      </div>
      <div style="${numStyle};text-align:right">${t.flights}</div>
      <div style="${numStyle};text-align:right;font-weight:700">${t.hours.toFixed(1)}h</div>
      <div style="${numStyle};text-align:right;color:#5F7FA0">${t.pic.toFixed(1)} PIC</div>
      <div style="text-align:right;color:#5F7FA0;font-size:10px">${t.last_flight}</div>
    </div>`
  ).join('');

  // Cert cards
  const certCards = cv.certificates.map(c => {
    const dot = c.status === 'valid' ? '#00C896' : c.status === 'expiring' ? '#FFB830' : '#FF4D6A';
    return `<div style="border:1px solid #E6EAF0;border-radius:8px;padding:10px 12px;background:#FBFCFD">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div style="font-weight:700;font-size:11.5px;color:${navy}">${c.name}</div>
        <div style="font-size:8.5px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;color:${dot};display:flex;align-items:center;gap:4px">
          <span style="width:6px;height:6px;border-radius:3px;background:${dot};display:inline-block"></span>${c.status}
        </div>
      </div>
      <div style="font-size:9.5px;color:#5F7FA0;margin-top:2px">${c.detail}</div>
      <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:9.5px;color:#5F7FA0">
        <span>${c.issuer}</span>
        <span style="${numStyle}">${c.issued} → ${c.expires || '∞'}</span>
      </div>
    </div>`;
  }).join('');

  // Timeline
  const timelineDots = cv.timeline.map(t =>
    `<div style="position:relative;padding-bottom:10px">
      <div style="position:absolute;left:-18px;top:4px;width:12px;height:12px;border-radius:6px;background:#FFFFFF;border:2px solid ${accent}"></div>
      <div style="display:flex;gap:10px;font-size:11.5px">
        <div style="${numStyle};font-weight:700;color:${navy};width:36px">${t.year}</div>
        <div>
          <div style="font-weight:600;color:${navy}">${t.label}</div>
          <div style="font-size:10.5px;color:#5F7FA0">${t.detail}</div>
        </div>
      </div>
    </div>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
</style>
</head>
<body>
<div style="width:794px;min-height:1123px;background:#FFFFFF;color:${navy};font-family:'Inter',-apple-system,BlinkMacSystemFont,'Helvetica Neue',sans-serif;box-sizing:border-box;position:relative;overflow:hidden">

  <!-- HEADER BAND -->
  <div style="background:${navy};color:#FFFFFF;padding:38px 56px 32px">
    <div style="display:flex;align-items:flex-start;justify-content:space-between">
      <div>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
          <div style="width:22px;height:22px;border-radius:5px;background:${accent};display:grid;place-items:center;color:${navy};font-weight:800;font-size:13px">B</div>
          <div style="font-size:10px;letter-spacing:3px;font-weight:700;color:#7FA8C8">BLADES · JOINT LOGBOOK</div>
        </div>
        <div style="font-size:32px;font-weight:700;letter-spacing:-0.6px;line-height:1.05">${cv.pilot.name}</div>
        <div style="font-size:14px;color:#7FA8C8;margin-top:4px">${cv.pilot.title}</div>
        <div style="display:flex;gap:18px;margin-top:16px;font-size:11px;color:#B5C8D8">
          ${cv.pilot.license ? `<span><span style="color:#5F7FA0">Licence&nbsp;</span>${cv.pilot.license}</span>` : ''}
          ${cv.pilot.base ? `<span><span style="color:#5F7FA0">Base&nbsp;</span>${cv.pilot.base}</span>` : ''}
          ${cv.pilot.email ? `<span><span style="color:#5F7FA0">Email&nbsp;</span>${cv.pilot.email}</span>` : ''}
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:9px;letter-spacing:2px;color:#5F7FA0;font-weight:600">STATEMENT OF EXPERIENCE</div>
        <div style="font-size:11px;color:#B5C8D8;margin-top:4px">${exportDate}</div>
      </div>
    </div>
  </div>

  <!-- HERO STATS -->
  <div style="padding:24px 56px 0">
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:0;border-top:2px solid ${accent};border-bottom:1px solid #E6EAF0">
      ${heroStats}
    </div>
  </div>

  <!-- CHARTS ROW -->
  <div style="padding:28px 56px 0;display:grid;grid-template-columns:1.6fr 1fr;gap:32px">
    <div>
      <div style="font-size:10px;letter-spacing:1.6px;text-transform:uppercase;color:#5F7FA0;font-weight:700;margin-bottom:10px">Hours flown · last 12 months</div>
      <div style="display:flex;align-items:flex-end;gap:6px;height:110px;border-bottom:1px solid #E6EAF0;padding-bottom:6px">
        ${bars}
      </div>
    </div>
    <div>
      <div style="font-size:10px;letter-spacing:1.6px;text-transform:uppercase;color:#5F7FA0;font-weight:700;margin-bottom:10px">Flight conditions</div>
      <div style="display:flex;align-items:center;gap:14px">
        ${donutSvg}
        <div style="font-size:10.5px;line-height:1.7">
          <div><span style="display:inline-block;width:8px;height:8px;background:${accent};border-radius:2px;margin-right:6px"></span>VFR&nbsp;<b style="${numStyle}">${fmt(vfr, 0)}h</b></div>
          <div><span style="display:inline-block;width:8px;height:8px;background:#0A6B7E;border-radius:2px;margin-right:6px"></span>IFR&nbsp;<b style="${numStyle}">${fmt(ifr, 0)}h</b></div>
          <div><span style="display:inline-block;width:8px;height:8px;background:${navy};border-radius:2px;margin-right:6px"></span>Night&nbsp;<b style="${numStyle}">${fmt(night, 0)}h</b></div>
        </div>
      </div>
    </div>
  </div>

  <!-- TYPE TABLE -->
  <div style="padding:28px 56px 0">
    <div style="font-size:10px;letter-spacing:1.6px;text-transform:uppercase;color:#5F7FA0;font-weight:700;margin-bottom:10px">Experience by aircraft type</div>
    <div style="border-top:1px solid ${navy}">${typeRows}</div>
  </div>

  <!-- CERTS -->
  <div style="padding:24px 56px 0">
    <div style="font-size:10px;letter-spacing:1.6px;text-transform:uppercase;color:#5F7FA0;font-weight:700;margin-bottom:10px">Licences, ratings & certificates</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${certCards}</div>
  </div>

  <!-- TIMELINE -->
  ${cv.timeline.length > 0 ? `
  <div style="padding:24px 56px 60px">
    <div style="font-size:10px;letter-spacing:1.6px;text-transform:uppercase;color:#5F7FA0;font-weight:700;margin-bottom:10px">Career milestones</div>
    <div style="position:relative;padding-left:18px">
      <div style="position:absolute;left:5px;top:4px;bottom:4px;width:2px;background:#E6EAF0"></div>
      ${timelineDots}
    </div>
  </div>` : ''}

  <!-- FOOTER -->
  <div style="position:absolute;left:56px;right:56px;bottom:18px;display:flex;justify-content:space-between;font-size:9px;color:#94A8BC;border-top:1px solid #E6EAF0;padding-top:8px">
    <span>Verified by BLADES · ID ${docId}</span>
    <span>blades-app.com · 1/1</span>
  </div>

</div>
</body>
</html>`;
}
