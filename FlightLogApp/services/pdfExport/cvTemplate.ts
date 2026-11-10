// Pilot CV, sidan: en HTML-sida i A4 (794 px bred = 595 pt) som både förhandsvisningen (WebView) och PDF:en
// (expo-print) ritar. Sidopanelen har initialer, kontakt, licens, behörigheter och språk; huvudytan namn, profiltext,
// total flygtid, valda totaler, typer, senaste tolv månaderna, erfarenhet och milstolpar. Färger, typsnitt och
// storlek kommer från användarens val (cvConfig). Blir innehållet längre än en sida fortsätter det på nästa:
// sidopanelens färg ligger som bakgrund på hela dokumentet, så den följer med.

import { FONTS, TILES, type CvConfig } from './cvConfig';
import { prettyDate, type CvData } from './cvData';

const PAGE_W = 794;
const PAGE_H = 1123;
const SIDE_W = 240;

const esc = (s: any): string => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hex = (c: string) => { const m = /^#?([0-9a-f]{6})$/i.exec((c || '').trim()); return m ? m[1] : '0A1628'; };
const rgb = (c: string) => { const h = hex(c); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); };
const mix = (a: string, b: string, t: number) => { const x = rgb(a), y = rgb(b); return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`; };
const luminance = (c: string) => { const [r, g, b] = rgb(c); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };

const group = (v: number) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
function hours(v: number, fmt: 'decimal' | 'hhmm'): string {
  const x = Number(v) || 0;
  if (fmt === 'hhmm') {
    const m = Math.round(x * 60);
    return `${group(Math.floor(m / 60))}:${String(m % 60).padStart(2, '0')}`;
  }
  const r = Math.round(x * 10) / 10;
  return `${group(Math.floor(r))}.${Math.round((r - Math.floor(r)) * 10)}`;
}

export interface CvRenderOpts {
  timeFormat: 'decimal' | 'hhmm';
  attached: { from: number; to: number } | null; // bifogade loggbokssidor
  preview?: boolean;                             // förhandsvisning: sidan skalas till skärmens bredd
}

export function renderCV(cfg: CvConfig, data: CvData, opts: CvRenderOpts): string {
  const d = cfg.details, on = cfg.sections, look = cfg.look;
  const font = FONTS.find((f) => f.k === look.font) ?? FONTS[0];
  const k = look.size === 'compact' ? 0.92 : look.size === 'large' ? 1.08 : 1;
  const z = (n: number) => `${Math.round(n * k * 10) / 10}px`;
  const side = `#${hex(look.side)}`, accent = `#${hex(look.accent)}`;
  const darkSide = luminance(side) < 0.55;
  const sideText = darkSide ? '#E6EEF7' : '#0A1628';
  const sideMuted = darkSide ? mix(side, '#FFFFFF', 0.62) : '#4A5B70';
  const sideAccent = darkSide ? mix(accent, '#FFFFFF', 0.42) : mix(accent, '#000000', 0.18);
  const ink = '#0A1628', muted = '#4A5B70', rule = '#DCE3EB';
  const accentInk = luminance(accent) > 0.5 ? mix(accent, '#000000', 0.35) : accent; // läsbar på vitt
  const label = font.mono ? "Menlo,'SF Mono',monospace" : font.body;
  const h = (v: number) => hours(v, opts.timeFormat);

  const name = `${d.firstName} ${d.lastName}`.trim() || 'Your name';
  const initials = `${d.firstName.trim().charAt(0)}${d.lastName.trim().charAt(0)}`.toUpperCase() || name.charAt(0).toUpperCase();

  // ── Sidopanelen ──
  const sideBlocks: string[] = [];
  if (on.monogram) sideBlocks.push(`<div class="mono">${esc(initials)}</div>`);
  if (on.contact) {
    const rows = [d.email, d.phone, d.base ? `Base: ${d.base}` : '', d.nationality, d.dob ? `Born ${prettyDate(d.dob)}` : ''].filter((x) => x.trim());
    if (rows.length) sideBlocks.push(`<div><p class="l sl">Contact</p>${rows.map((r) => `<p class="si">${esc(r)}</p>`).join('')}</div>`);
  }
  if (on.licence && (d.licence.trim() || d.licenceNo.trim())) {
    sideBlocks.push(`<div><p class="l sl">Licence</p>${d.licence.trim() ? `<p class="si strong">${esc(d.licence)}</p>` : ''}${d.licenceNo.trim() ? `<p class="sm">No. ${esc(d.licenceNo)}</p>` : ''}</div>`);
  }
  const certs = cfg.certs.filter((c) => c.name.trim());
  if (on.certs && certs.length) {
    sideBlocks.push(`<div><p class="l sl">Ratings and certificates</p>${certs.map((c) => `<div class="ce"><p class="si">${esc(c.name)}</p>${c.valid.trim() ? `<p class="sm">Valid to ${esc(prettyDate(c.valid))}</p>` : ''}</div>`).join('')}</div>`);
  }
  const langs = cfg.languages.filter((l) => l.name.trim());
  if (on.languages && langs.length) {
    sideBlocks.push(`<div><p class="l sl">Languages</p>${langs.map((l) => `<p class="si">${esc(l.name)}${l.level.trim() ? ` · ${esc(l.level)}` : ''}</p>`).join('')}</div>`);
  }

  // ── Huvudytan ──
  const main: string[] = [];
  main.push(`<div><h1>${esc(name)}</h1>${d.title.trim() ? `<p class="title">${esc(d.title)}</p>` : ''}</div>`);
  if (on.summary && d.summary.trim()) main.push(`<p class="sum">${esc(d.summary.trim()).replace(/\n/g, '<br>')}</p>`);
  if (on.totals) {
    main.push(`<div class="hero"><div style="flex:1"><p class="l" style="color:${accentInk};margin:0 0 3px">Total flight time</p><span class="big">${h(data.total)}</span></div>
      <div class="heroR">${group(data.flights)} flights<br>${group(data.landings)} landings<br>as of ${esc(data.asOf)}</div></div>`);
    const tiles = cfg.tiles.map((key) => TILES.find((t) => t.k === key)).filter(Boolean) as typeof TILES;
    if (tiles.length) {
      main.push(`<div class="tiles">${tiles.map((t) => `<div class="k"><b>${t.count ? group(Math.round(data.totals[t.k])) : h(data.totals[t.k])}</b><span>${esc(t.label)}</span></div>`).join('')}</div>`);
    }
  }
  const types = data.types.slice(0, cfg.aircraftRows);
  if (on.aircraft && types.length) {
    const rest = data.types.length - types.length;
    main.push(`<div><p class="l ml">Aircraft</p><table><tr><th>Type</th><th>Hours</th><th>PIC</th><th>IFR</th><th>Last flown</th></tr>${
      types.map((t) => `<tr><td class="strong">${esc(t.type)}</td><td>${h(t.hours)}</td><td>${h(t.pic)}</td><td>${h(t.ifr)}</td><td>${esc(t.last)}</td></tr>`).join('')
    }</table>${rest > 0 ? `<p class="fine" style="margin-top:6px">And ${rest} more ${rest === 1 ? 'type' : 'types'}.</p>` : ''}</div>`);
  }
  if (on.last12) {
    const max = Math.max(...data.months.map((m) => m.hours), 0.01);
    main.push(`<div><p class="l ml">Last 12 months · ${h(data.last12)}</p><div class="bars">${
      data.months.map((m) => `<span style="height:${Math.max(2, Math.round((m.hours / max) * 100))}%"></span>`).join('')
    }</div><div class="barL">${data.months.map((m) => `<span>${m.label}</span>`).join('')}</div></div>`);
  }
  const jobs = cfg.experience.filter((j) => j.role.trim() || j.detail.trim());
  if (on.experience && jobs.length) {
    main.push(`<div><p class="l ml">Experience</p><div class="tl">${jobs.map((j) => `<span class="yr">${esc(j.period)}</span><span><b>${esc(j.role)}</b>${j.detail.trim() ? `<br>${esc(j.detail)}` : ''}</span>`).join('')}</div></div>`);
  }
  if (on.milestones && data.milestones.length) {
    main.push(`<div><p class="l ml">Milestones</p><div class="tl">${data.milestones.slice(0, 5).map((m) => `<span class="yr">${m.year}</span><span>${esc(m.text)}</span>`).join('')}</div></div>`);
  }
  const foot = on.footer
    ? `<p class="foot">Totals are computed from ${group(data.flights)} flights in the pilot's logbook.${opts.attached ? ` Logbook pages ${opts.attached.from} to ${opts.attached.to} are attached.` : ''}</p>`
    : '';

  const bg = look.sideRight
    ? `linear-gradient(90deg,#FFFFFF 0,#FFFFFF ${PAGE_W - SIDE_W}px,${side} ${PAGE_W - SIDE_W}px,${side} 100%)`
    : `linear-gradient(90deg,${side} 0,${side} ${SIDE_W}px,#FFFFFF ${SIDE_W}px,#FFFFFF 100%)`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
${opts.preview ? `<meta name="viewport" content="width=${PAGE_W}, user-scalable=yes" />` : ''}
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; width: ${PAGE_W}px; background: ${bg}; }
  body { color: ${ink}; font-family: ${font.body}; -webkit-text-size-adjust: 100%; }
  .page { width: ${PAGE_W}px; min-height: ${PAGE_H}px; display: flex; flex-direction: ${look.sideRight ? 'row-reverse' : 'row'}; }
  .side { width: ${SIDE_W}px; padding: 46px 26px 30px; display: flex; flex-direction: column; gap: ${z(28)}; color: ${sideText}; }
  .main { flex: 1; min-width: 0; padding: 46px 40px 30px; display: flex; flex-direction: column; gap: ${z(24)}; }
  p { margin: 0; }
  .l { font-family: ${label}; font-size: ${z(font.mono ? 9.5 : 10)}; letter-spacing: 1.8px; font-weight: 700; text-transform: uppercase; }
  .sl { color: ${sideAccent}; margin-bottom: ${z(9)}; }
  .ml { color: ${accentInk}; margin-bottom: ${z(10)}; padding-bottom: ${z(6)}; border-bottom: 1px solid ${rule}; }
  .si { font-size: ${z(12.5)}; line-height: ${z(19)}; overflow-wrap: anywhere; }
  .sm { font-size: ${z(11.5)}; line-height: ${z(16)}; color: ${sideMuted}; }
  .strong { font-weight: 700; }
  .ce { margin-bottom: ${z(9)}; }
  .mono { width: 86px; height: 86px; border-radius: 43px; border: 2px solid ${sideAccent}; display: flex; align-items: center; justify-content: center; font-family: ${font.head}; font-size: 33px; font-weight: 600; }
  h1 { margin: 0; font-family: ${font.head}; font-size: ${z(45)}; line-height: ${z(48)}; font-weight: 600; letter-spacing: -0.5px; overflow-wrap: anywhere; }
  .title { margin-top: ${z(6)}; font-size: ${z(16)}; font-weight: 600; color: ${accentInk}; }
  .sum { font-size: ${z(13)}; line-height: ${z(20)}; color: #223046; }
  .hero { display: flex; align-items: flex-end; gap: 18px; padding: ${z(18)} ${z(21)}; background: ${mix(accent, '#FFFFFF', 0.92)}; border-radius: 13px; }
  .big { font-family: ${font.head}; font-size: ${z(61)}; line-height: ${z(61)}; font-weight: 600; letter-spacing: -1px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .heroR { text-align: right; font-size: ${z(12)}; line-height: ${z(17)}; color: ${muted}; white-space: nowrap; }
  .tiles { display: flex; flex-wrap: wrap; row-gap: ${z(16)}; }
  .k { width: 25%; display: flex; flex-direction: column; gap: 2px; padding-right: 8px; }
  .k b { font-family: ${font.head}; font-size: ${z(22.5)}; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .k span { font-size: ${z(11.5)}; color: ${muted}; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: ${z(6.5)} 0; font-size: ${z(12.5)}; text-align: right; font-variant-numeric: tabular-nums; border-bottom: 1px solid #E7ECF2; white-space: nowrap; }
  th { font-family: ${label}; font-size: ${z(9.5)}; letter-spacing: 1.3px; font-weight: 700; color: ${muted}; text-transform: uppercase; }
  td:first-child, th:first-child { text-align: left; }
  .bars { height: ${z(82)}; display: flex; align-items: flex-end; gap: 8px; }
  .bars span { flex: 1; background: ${accent}; border-radius: 3px 3px 0 0; }
  .barL { display: flex; gap: 8px; margin-top: 4px; font-family: ${label}; font-size: ${z(9.5)}; color: ${muted}; }
  .barL span { flex: 1; text-align: center; }
  .tl { display: grid; grid-template-columns: ${z(92)} 1fr; row-gap: ${z(8)}; font-size: ${z(12.5)}; line-height: ${z(18)}; }
  .tl .yr { font-weight: 700; color: ${accentInk}; }
  .fine { font-size: ${z(10.5)}; color: ${muted}; }
  .foot { margin-top: auto; font-size: ${z(10)}; line-height: ${z(15)}; color: ${muted}; border-top: 1px solid ${rule}; padding-top: 8px; }
  .gen { margin-top: auto; font-size: ${z(10)}; line-height: ${z(14)}; color: ${sideMuted}; }
  .main > div, .side > div, table tr { break-inside: avoid; page-break-inside: avoid; }
</style>
</head>
<body>
<div class="page">
  <div class="side">${sideBlocks.join('')}<p class="gen">Generated from the Blades logbook on ${esc(data.asOf)}.</p></div>
  <div class="main">${main.join('')}${foot}</div>
</div>
</body>
</html>`;
}
