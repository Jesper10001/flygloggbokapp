// Pilot CV, sidan: en HTML-sida i A4 (794 px bred = 595 pt) som både förhandsvisningen (WebView) och PDF:en
// (expo-print) ritar. Innehållet byggs som block (kontakt, licens, behörigheter, timmar, typer, erfarenhet …) och
// läggs sedan ut av en av fyra designer (cvConfig.TEMPLATES):
//   sidebar – färgad sidopanel med uppgifterna, huvudytan med timmarna (ursprungsdesignen)
//   classic – en kolumn med centrerat huvud, det traditionella CV:t
//   banner  – färgat huvud tvärs över sidan och två kolumner under
//   clean   – vit sida med avsnittens namn i vänstermarginalen
// Färger, typsnitt och storlek kommer från användarens val och gäller alla designer. Blir innehållet längre än en
// sida fortsätter det på nästa; i sidebar ligger panelens färg som bakgrund på hela dokumentet, så den följer med.

import { FONTS, TILES, type CvConfig } from './cvConfig';
import { prettyDate, type CvData } from './cvData';

const PAGE_W = 794;
const PAGE_H = 1123;
const SIDE_W = 240;

const esc = (s: any): string => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const multi = (s: string) => esc(s.trim()).replace(/\n/g, '<br>');
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

/** En kort profiltext ur loggbokens siffror, som förslag att skriva vidare på. */
export function suggestSummary(cfg: CvConfig, data: CvData): string {
  const h = (v: number) => String(Math.round(Number(v) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const list = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  const who = cfg.details.title.split(/[·|,]/)[0].trim() || 'Pilot';
  const s1 = `${who} with ${h(data.total)} hours total flight time${data.totals.pic > 0 ? `, ${h(data.totals.pic)} as pilot in command` : ''}.`;
  const types = data.types.slice(0, 3).map((t) => t.type);
  const s2 = types.length ? `Most of the flying is on the ${list(types)}.` : '';
  const extra = [data.totals.ifr > 0 ? `${h(data.totals.ifr)} hours IFR` : '', data.totals.night > 0 ? `${h(data.totals.night)} hours at night` : '', data.totals.me > 0 ? `${h(data.totals.me)} hours multi-engine` : ''].filter(Boolean);
  const s3 = extra.length ? `Experience includes ${list(extra)}.` : '';
  return [s1, s2, s3].filter(Boolean).join(' ');
}

export function renderCV(cfg: CvConfig, data: CvData, opts: CvRenderOpts): string {
  const d = cfg.details, on = cfg.sections, look = cfg.look, tpl = cfg.template;
  const font = FONTS.find((f) => f.k === look.font) ?? FONTS[0];
  const k = look.size === 'compact' ? 0.92 : look.size === 'large' ? 1.08 : 1;
  const z = (n: number) => `${Math.round(n * k * 10) / 10}px`;
  const side = `#${hex(look.side)}`, accent = `#${hex(look.accent)}`;
  const darkSide = luminance(side) < 0.55;
  const ink = '#0A1628', muted = '#4A5B70', rule = '#DCE3EB';
  const accentInk = luminance(accent) > 0.5 ? mix(accent, '#000000', 0.35) : accent; // läsbar på vitt
  // Färgerna i den färgade ytan (sidopanelen, bannern) och på den vita.
  const zoneColor = `--tx:${darkSide ? '#E6EEF7' : ink};--mu:${darkSide ? mix(side, '#FFFFFF', 0.62) : muted};--ac:${darkSide ? mix(accent, '#FFFFFF', 0.42) : mix(accent, '#000000', 0.18)};--rl:${darkSide ? mix(side, '#FFFFFF', 0.22) : mix(side, '#000000', 0.14)};`;
  const zoneWhite = `--tx:${ink};--mu:${muted};--ac:${accentInk};--rl:${rule};`;
  const label = font.mono ? "Menlo,'SF Mono',monospace" : font.body;
  const h = (v: number) => hours(v, opts.timeFormat);

  const name = `${d.firstName} ${d.lastName}`.trim() || 'Your name';
  const initials = `${d.firstName.trim().charAt(0)}${d.lastName.trim().charAt(0)}`.toUpperCase() || name.charAt(0).toUpperCase();
  const sec = (title: string, inner: string, cls = '') => (inner ? `<div class="sec ${cls}"><p class="l lab">${esc(title)}</p><div class="body">${inner}</div></div>` : '');

  // ── Blocken ──
  const contactRows = on.contact ? [d.email, d.phone, d.base ? `Base: ${d.base}` : '', d.nationality, d.dob ? `Born ${prettyDate(d.dob)}` : ''].map((x) => x.trim()).filter(Boolean) : [];
  const B: Record<string, string> = {};
  B.contact = sec('Contact', contactRows.map((r) => `<p class="si">${esc(r)}</p>`).join(''));
  B.licence = on.licence && (d.licence.trim() || d.licenceNo.trim())
    ? sec('Licence', `${d.licence.trim() ? `<p class="si strong">${esc(d.licence)}</p>` : ''}${d.licenceNo.trim() ? `<p class="sm">No. ${esc(d.licenceNo)}</p>` : ''}`) : '';
  const certs = cfg.certs.filter((c) => c.name.trim());
  B.certs = on.certs && certs.length
    ? sec('Ratings and certificates', `<div class="cgrid">${certs.map((c) => `<div class="ce"><span class="si">${esc(c.name)}</span>${c.valid.trim() ? `<span class="sm">Valid to ${esc(prettyDate(c.valid))}</span>` : ''}</div>`).join('')}</div>`) : '';
  const langs = cfg.languages.filter((l) => l.name.trim());
  B.languages = on.languages && langs.length
    ? sec('Languages', `<div class="cgrid">${langs.map((l) => `<p class="si">${esc(l.name)}${l.level.trim() ? ` · ${esc(l.level)}` : ''}</p>`).join('')}</div>`) : '';
  const skills = cfg.skills.map((x) => x.trim()).filter(Boolean);
  B.skills = on.skills && skills.length ? sec('Skills', `<div class="sk">${skills.map((x) => `<span>${esc(x)}</span>`).join('')}</div>`) : '';
  B.summary = on.summary && d.summary.trim() ? sec('Profile', `<p class="sum">${multi(d.summary)}</p>`, 'nolab') : '';
  if (on.totals) {
    const tiles = cfg.tiles.map((key) => TILES.find((t) => t.k === key)).filter(Boolean) as typeof TILES;
    B.totals = sec('Flight hours', `<div class="hero"><div style="flex:1"><p class="l hl">Total flight time</p><span class="big">${h(data.total)}</span></div>
      <div class="heroR">${group(data.flights)} flights<br>${group(data.landings)} landings<br>as of ${esc(data.asOf)}</div></div>${
      tiles.length ? `<div class="tiles">${tiles.map((t) => `<div class="k"><b>${t.count ? group(Math.round(data.totals[t.k])) : h(data.totals[t.k])}</b><span>${esc(t.label)}</span></div>`).join('')}</div>` : ''}`, 'nolab');
  }
  const types = data.types.slice(0, cfg.aircraftRows);
  if (on.aircraft && types.length) {
    const rest = data.types.length - types.length;
    B.aircraft = sec('Aircraft', `<table><tr><th>Type</th><th>Hours</th><th>PIC</th><th>IFR</th><th>Last flown</th></tr>${
      types.map((t) => `<tr><td class="strong">${esc(t.type)}</td><td>${h(t.hours)}</td><td>${h(t.pic)}</td><td>${h(t.ifr)}</td><td>${esc(t.last)}</td></tr>`).join('')
    }</table>${rest > 0 ? `<p class="fine" style="margin-top:6px">And ${rest} more ${rest === 1 ? 'type' : 'types'}.</p>` : ''}`);
  }
  if (on.last12) {
    const max = Math.max(...data.months.map((m) => m.hours), 0.01);
    B.last12 = sec(`Last 12 months · ${h(data.last12)}`, `<div class="bars">${
      data.months.map((m) => `<span style="height:${Math.max(2, Math.round((m.hours / max) * 100))}%"></span>`).join('')
    }</div><div class="barL">${data.months.map((m) => `<span>${m.label}</span>`).join('')}</div>`);
  }
  const jobs = cfg.experience.filter((j) => j.role.trim() || j.detail.trim());
  B.experience = on.experience && jobs.length
    ? sec('Experience', `<div class="tl">${jobs.map((j) => `<span class="yr">${esc(j.period)}</span><span><b>${esc(j.role)}</b>${j.detail.trim() ? `<br>${multi(j.detail)}` : ''}</span>`).join('')}</div>`) : '';
  const schools = cfg.education.filter((e) => e.school.trim() || e.detail.trim());
  B.education = on.education && schools.length
    ? sec('Education', `<div class="tl">${schools.map((e) => `<span class="yr">${esc(e.period)}</span><span><b>${esc(e.school)}</b>${e.detail.trim() ? `<br>${multi(e.detail)}` : ''}</span>`).join('')}</div>`) : '';
  B.milestones = on.milestones && data.milestones.length
    ? sec('Milestones', `<div class="tl">${data.milestones.slice(0, 5).map((m) => `<span class="yr">${m.year}</span><span>${esc(m.text)}</span>`).join('')}</div>`) : '';
  B.additional = on.additional && cfg.additional.trim() ? sec('Additional information', `<p class="sum">${multi(cfg.additional)}</p>`) : '';
  B.references = on.references && cfg.references.trim() ? sec('References', `<p class="sum">${multi(cfg.references)}</p>`) : '';
  const foot = on.footer
    ? `<p class="foot">Totals are computed from ${group(data.flights)} flights in the pilot's logbook.${opts.attached ? ` Logbook pages ${opts.attached.from} to ${opts.attached.to} are attached.` : ''} Generated from the Blades logbook on ${esc(data.asOf)}.</p>`
    : '';

  // Huvudblockens ordning: timmarna, erfarenheten eller utbildningen först.
  const flight = ['totals', 'aircraft', 'last12'];
  const lead = cfg.lead === 'experience' ? ['experience', ...flight, 'education'] : cfg.lead === 'education' ? ['education', ...flight, 'experience'] : [...flight, 'experience', 'education'];
  const tail = ['milestones', 'additional', 'references'];
  const pick = (keys: string[]) => keys.map((x) => B[x] ?? '').join('');
  const mono = on.monogram ? `<div class="mono">${esc(initials)}</div>` : '';
  const head = `<h1>${esc(name)}</h1>${d.title.trim() ? `<p class="title">${esc(d.title)}</p>` : ''}`;
  const contactLine = contactRows.length ? `<p class="cline">${contactRows.map(esc).join('<span class="dot"> · </span>')}</p>` : '';

  let body: string, layoutCss: string, bg = '#FFFFFF';
  if (tpl === 'classic' || tpl === 'clean') {
    body = `<div class="page one" style="${zoneWhite}">
      <div class="top">${head}${contactLine}</div>
      ${pick(['summary', 'licence', 'certs', ...lead, 'skills', 'languages', ...tail])}${foot}</div>`;
    layoutCss = tpl === 'classic' ? `
      .one { padding: 54px 62px 34px; display: flex; flex-direction: column; gap: ${z(22)}; }
      .top { text-align: center; padding-bottom: ${z(16)}; border-bottom: 2px solid ${ink}; }
      .cline { margin-top: ${z(8)}; font-size: ${z(12.5)}; color: ${muted}; }
      .lab { margin-bottom: ${z(9)}; padding-bottom: ${z(5)}; border-bottom: 1px solid var(--rl); }
      .hero { background: none; border-radius: 0; padding: 0 0 ${z(12)}; }
    ` : `
      .one { padding: 54px 56px 34px; display: flex; flex-direction: column; gap: ${z(20)}; }
      .top { padding-bottom: ${z(6)}; }
      .cline { margin-top: ${z(8)}; font-size: ${z(12.5)}; color: ${muted}; }
      .sec { display: grid; grid-template-columns: 150px 1fr; column-gap: 22px; padding-top: ${z(16)}; border-top: 1px solid var(--rl); }
      .sec.nolab .lab { display: block; }
      .lab { margin: 3px 0 0; }
    `;
  } else if (tpl === 'banner') {
    body = `<div class="page ban">
      <div class="band" style="${zoneColor}">${mono}<div style="flex:1;min-width:0">${head}</div><div class="bc">${contactRows.map((r) => `<p class="si">${esc(r)}</p>`).join('')}</div></div>
      <div class="cols" style="${zoneWhite}"><div class="main">${pick(['summary', ...lead, ...tail])}</div><div class="aside">${pick(['licence', 'certs', 'skills', 'languages'])}</div></div>
      <div style="${zoneWhite}padding:0 44px 30px">${foot}</div></div>`;
    layoutCss = `
      .ban { display: flex; flex-direction: column; }
      .band { background: ${side}; color: var(--tx); display: flex; align-items: center; gap: 22px; padding: 40px 44px 34px; }
      .band h1 { color: var(--tx); } .band .title { color: var(--ac); }
      .bc { text-align: right; }
      .cols { flex: 1; display: flex; gap: 34px; padding: 30px 44px 20px; }
      .main { flex: 1.9; min-width: 0; display: flex; flex-direction: column; gap: ${z(22)}; }
      .aside { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: ${z(22)}; }
      .lab { margin-bottom: ${z(9)}; padding-bottom: ${z(5)}; border-bottom: 1px solid var(--rl); }
      .aside .cgrid { display: block; } .aside .ce { display: block; margin-bottom: ${z(8)}; } .aside .ce .sm { display: block; }
    `;
  } else {
    bg = look.sideRight
      ? `linear-gradient(90deg,#FFFFFF 0,#FFFFFF ${PAGE_W - SIDE_W}px,${side} ${PAGE_W - SIDE_W}px,${side} 100%)`
      : `linear-gradient(90deg,${side} 0,${side} ${SIDE_W}px,#FFFFFF ${SIDE_W}px,#FFFFFF 100%)`;
    body = `<div class="page sb">
      <div class="side" style="${zoneColor}">${mono}${pick(['contact', 'licence', 'certs', 'skills', 'languages'])}</div>
      <div class="main" style="${zoneWhite}"><div>${head}</div>${pick(['summary', ...lead, ...tail])}${foot}</div></div>`;
    layoutCss = `
      .sb { display: flex; flex-direction: ${look.sideRight ? 'row-reverse' : 'row'}; }
      .side { width: ${SIDE_W}px; padding: 46px 26px 30px; display: flex; flex-direction: column; gap: ${z(26)}; color: var(--tx); }
      .main { flex: 1; min-width: 0; padding: 46px 40px 30px; display: flex; flex-direction: column; gap: ${z(22)}; }
      .side .lab { margin-bottom: ${z(9)}; }
      .main .lab { margin-bottom: ${z(9)}; padding-bottom: ${z(5)}; border-bottom: 1px solid var(--rl); }
      .side .cgrid { display: block; } .side .ce { display: block; margin-bottom: ${z(8)}; } .side .ce .sm { display: block; }
    `;
  }

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
  .page { width: ${PAGE_W}px; min-height: ${PAGE_H}px; }
  p { margin: 0; }
  .l { font-family: ${label}; font-size: ${z(font.mono ? 9.5 : 10)}; letter-spacing: 1.8px; font-weight: 700; text-transform: uppercase; }
  .lab { color: var(--ac); }
  .sec.nolab .lab { display: none; }
  .hl { color: var(--ac); margin: 0 0 3px; }
  .si { font-size: ${z(12.5)}; line-height: ${z(19)}; color: var(--tx); overflow-wrap: anywhere; }
  .sm { font-size: ${z(11.5)}; line-height: ${z(16)}; color: var(--mu); }
  .strong { font-weight: 700; }
  .cgrid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 28px; }
  .ce { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; padding: ${z(2.5)} 0; }
  .sk span { display: inline-block; font-size: ${z(11.5)}; line-height: ${z(15)}; color: var(--tx); border: 1px solid var(--rl); border-radius: 20px; padding: ${z(3)} ${z(10)}; margin: 0 ${z(6)} ${z(7)} 0; }
  .mono { width: 86px; height: 86px; flex: none; border-radius: 43px; border: 2px solid var(--ac); color: var(--tx); display: flex; align-items: center; justify-content: center; font-family: ${font.head}; font-size: 33px; font-weight: 600; }
  h1 { margin: 0; font-family: ${font.head}; font-size: ${z(45)}; line-height: ${z(48)}; font-weight: 600; letter-spacing: -0.5px; overflow-wrap: anywhere; }
  .title { margin-top: ${z(6)}; font-size: ${z(16)}; font-weight: 600; color: ${accentInk}; }
  .sum { font-size: ${z(13)}; line-height: ${z(20)}; color: #223046; }
  .hero { display: flex; align-items: flex-end; gap: 18px; padding: ${z(18)} ${z(21)}; background: ${mix(accent, '#FFFFFF', 0.92)}; border-radius: 13px; }
  .big { font-family: ${font.head}; font-size: ${z(61)}; line-height: ${z(61)}; font-weight: 600; letter-spacing: -1px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .heroR { text-align: right; font-size: ${z(12)}; line-height: ${z(17)}; color: ${muted}; white-space: nowrap; }
  .tiles { display: flex; flex-wrap: wrap; row-gap: ${z(16)}; margin-top: ${z(20)}; }
  .k { width: 25%; display: flex; flex-direction: column; gap: 2px; padding-right: 8px; }
  .k b { font-family: ${font.head}; font-size: ${z(22.5)}; font-weight: 600; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .k span { font-size: ${z(11.5)}; color: ${muted}; }
  table { width: 100%; border-collapse: collapse; }
  td, th { padding: ${z(6.5)} 0; font-size: ${z(12.5)}; text-align: right; font-variant-numeric: tabular-nums; border-bottom: 1px solid #E7ECF2; white-space: nowrap; }
  th { font-family: ${label}; font-size: ${z(9.5)}; letter-spacing: 1.3px; font-weight: 700; color: ${muted}; text-transform: uppercase; }
  td:first-child, th:first-child { text-align: left; }
  .bars { height: ${z(76)}; display: flex; align-items: flex-end; gap: 8px; }
  .bars span { flex: 1; background: ${accent}; border-radius: 3px 3px 0 0; }
  .barL { display: flex; gap: 8px; margin-top: 4px; font-family: ${label}; font-size: ${z(9.5)}; color: ${muted}; }
  .barL span { flex: 1; text-align: center; }
  .tl { display: grid; grid-template-columns: ${z(92)} 1fr; row-gap: ${z(8)}; font-size: ${z(12.5)}; line-height: ${z(18)}; }
  .tl .yr { font-weight: 700; color: ${accentInk}; }
  .fine { font-size: ${z(10.5)}; color: ${muted}; }
  .foot { margin-top: auto; font-size: ${z(10)}; line-height: ${z(15)}; color: ${muted}; border-top: 1px solid ${rule}; padding-top: 8px; }
  .sec, table tr { break-inside: avoid; page-break-inside: avoid; }
  ${layoutCss}
</style>
</head>
<body>
${body}
</body>
</html>`;
}
