// HTML-renderare för ETT uppslag i den digitala loggboken.
//
// Samma renderare används på två ytor:
//   1. På skärmen via <WebView> (app/logbook) — bläddringsbar bok.
//   2. Senare för PDF/utskrift via expo-print — pixelidentiskt med skärmen.
//
// Uppslaget ritas alltid som papper (gräddvit), oavsett app-tema, så det ser
// ut som en riktig EASA-loggbok. Bredderna kommer från mallens kolumner
// (constants/logbookTemplates.ts) och summorna från paginate.ts.

import type { LogbookTemplate, LogbookColumn } from '../../constants/logbookTemplates';
import type { LogbookSpread, ColumnTotals } from './paginate';

export interface RenderSpreadOpts {
  template: LogbookTemplate;
  spread: LogbookSpread;
  rowsPerSpread: number;
  pilotName?: string;
  timeFormat: 'decimal' | 'hhmm';
  /** Pilotens signatur (SVG-paths + beskuren bounding box) — ritas på signaturraden. */
  signature?: { paths: string[]; w: number; h: number; x?: number; y?: number } | null;
  /** px marginal runt sidan; viewporten sätts till innehållets bredd. */
  margin?: number;
  /** false = statisk (PDF): inga tappbara "+"-rutor på tomma kolumner. Default true. */
  interactive?: boolean;
}

function signatureSvg(sig?: { paths: string[]; w: number; h: number; x?: number; y?: number } | null, h = 34): string {
  if (!sig || !Array.isArray(sig.paths) || !sig.paths.length || !sig.w || !sig.h) return '';
  const w = Math.round(h * (sig.w / sig.h));
  const vx = sig.x ?? 0;
  const vy = sig.y ?? 0;
  const paths = sig.paths
    .map((d) => `<path d="${esc(d)}" fill="none" stroke="#16243F" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`)
    .join('');
  return `<svg width="${w}" height="${h}" viewBox="${vx} ${vy} ${sig.w} ${sig.h}" preserveAspectRatio="xMinYMax meet" style="display:block;max-width:100%">${paths}</svg>`;
}

const esc = (s: any): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function fmtDecimal(v: number, timeFormat: 'decimal' | 'hhmm'): string {
  if (timeFormat === 'hhmm') {
    const h = Math.floor(v);
    let m = Math.round((v - h) * 60);
    if (m === 60) return `${h + 1}:00`;
    return `${h}:${String(m).padStart(2, '0')}`;
  }
  return v.toFixed(1);
}

const isNumericCol = (c: LogbookColumn) => c.format === 'decimal' || c.format === 'int';

/** En enskild flygnings värde i en kolumn. */
function cellValue(flight: any, c: LogbookColumn, timeFormat: 'decimal' | 'hhmm'): string {
  if (!c.flightKey) return '';
  const raw = flight[c.flightKey];
  if (raw === undefined || raw === null || raw === '') return '';
  switch (c.format) {
    case 'icao': return esc(String(raw).toUpperCase());
    case 'int': {
      const n = parseInt(String(raw), 10);
      return !n || isNaN(n) ? '' : String(n);
    }
    case 'decimal': {
      const n = parseFloat(String(raw).replace(',', '.'));
      return !n || isNaN(n) ? '' : fmtDecimal(n, timeFormat);
    }
    default: return esc(raw);
  }
}

/** Ett totalvärde i en summarad. */
function totalValue(c: LogbookColumn, totals: ColumnTotals, timeFormat: 'decimal' | 'hhmm', showZero: boolean): string {
  if (!isNumericCol(c) || !c.flightKey) return '';
  const v = totals[c.flightKey] ?? 0;
  if (!v && !showZero) return '';
  if (c.format === 'int') return String(Math.round(v));
  return fmtDecimal(v, timeFormat);
}

// Renderar bara select uppslagets .page-div (utan dokument-wrapper) så den kan
// återanvändas både i en helsida (WebView) och staplat i en flersides-PDF.
function spreadBody(opts: RenderSpreadOpts): string {
  const { template, spread, rowsPerSpread, pilotName, timeFormat } = opts;
  const sigInk = signatureSvg(opts.signature);
  const interactive = opts.interactive !== false;

  const cols = [...template.left_columns, ...template.right_columns];
  const leftWidth = template.left_columns.reduce((s, c) => s + c.width, 0); // bindningslinjens x-position
  const dashAfter = new Set<string>(template.dashed_after ?? []);

  const firstNumericIdx = cols.findIndex(isNumericCol);
  const labelColIdx = Math.max(0, firstNumericIdx - 1);
  // Endast fri-text-kolumnen (Remarks) lämnas öppen i totals — Sea m.fl. stannar i rutnätet.
  const isOpenCol = (c: LogbookColumn) => c.format === 'text';

  // Gruppera intilliggande kolumner med samma group-etikett.
  type Seg = { group?: string; span: number };
  const segs: Seg[] = [];
  for (const c of cols) {
    const last = segs[segs.length - 1];
    if (last && last.group === c.group) last.span += 1;
    else segs.push({ group: c.group, span: 1 });
  }

  const groupRow = segs
    .map((s) =>
      s.group
        ? `<th class="grp" colspan="${s.span}">${esc(s.group)}</th>`
        : `<th class="grp grp--empty" colspan="${s.span}"></th>`,
    )
    .join('');

  const headerRow = cols
    .map((c) => `<th class="hdr">${esc(c.label)}</th>`)
    .join('');

  // Nästlad rubrik om mallen anger header_rows (som en riktig bok),
  // annars härleds en tvåradig rubrik från kolumnernas group.
  const headerHTML = template.header_rows
    ? template.header_rows
        .map((row) =>
          `<tr>${row
            .map((cell) => {
              const cs = cell.colSpan ? ` colspan="${cell.colSpan}"` : '';
              const rs = cell.rowSpan ? ` rowspan="${cell.rowSpan}"` : '';
              const dash = cell.dashR ? ' dash-r' : '';
              // Tom, valbar kolumn: tryck på rubriken → välj flygtidstyp (postar till appen).
              // Två varianter: blank kolumn (label '') visar "+", förtryckt kolumn
              // (t.ex. Sea/Instrument/IRI) visar bokens etikett med ett diskret "+".
              if (cell.colId) {
                const col = cols.find((c) => c.id === cell.colId);
                const assigned = col && col.flightKey ? esc(col.label) : '';
                const printed = esc(cell.label);
                const sub = cell.sub ? `<div class="hx-sub">${esc(cell.sub)}</div>` : '';
                if (!interactive) {
                  // Statisk PDF: tilldelad typ, annars bokens tryckta etikett (eller tomt).
                  return `<th class="hx${dash}"${cs}${rs}>${assigned || printed}${sub}</th>`;
                }
                let inner: string;
                if (assigned) {
                  inner = `<span class="hx-pick">${assigned}</span>`;
                } else if (printed) {
                  inner = `<span class="hx-pick hx-pick--label">${printed}<span class="hx-plus">+</span></span>${sub}`;
                } else {
                  inner = `<span class="hx-pick hx-pick--empty">+</span>`;
                }
                return `<th class="hx hx-tap${dash}"${cs}${rs} onclick="if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify({type:'assignCol',colId:'${cell.colId}'}))">${inner}</th>`;
              }
              const sub = cell.sub ? `<div class="hx-sub">${esc(cell.sub)}</div>` : '';
              return `<th class="hx${dash}"${cs}${rs}>${esc(cell.label)}${sub}</th>`;
            })
            .join('')}</tr>`,
        )
        .join('')
    : `<tr>${groupRow}</tr><tr>${headerRow}</tr>`;

  // En summarad (brought forward / total this page / total to date).
  const summaryRow = (label: string, totals: ColumnTotals, variant: 'bf' | 'tot', showZero: boolean, topLine = false) => {
    const cells = cols
      .map((c, i) => {
        if (isOpenCol(c)) return `<td class="sum-open"></td>`;
        const dash = dashAfter.has(c.id) ? ' dash-r' : '';
        if (i === labelColIdx) {
          return `<td class="sum-label${dash}">${esc(label)}</td>`;
        }
        if (isNumericCol(c)) {
          return `<td class="sum-num${dash}">${totalValue(c, totals, timeFormat, showZero)}</td>`;
        }
        return `<td class="sum-blank${dash}"></td>`;
      })
      .join('');
    return `<tr class="sum sum--${variant}${topLine ? ' sum-top' : ''}">${cells}</tr>`;
  };

  // Dataraderna (fyllda + tomma upp till rowsPerSpread).
  const dataRows: string[] = [];
  for (let r = 0; r < rowsPerSpread; r++) {
    const f = spread.flights[r];
    const cells = cols
      .map((c) => {
        const align = isNumericCol(c) ? 'num' : (c.format === 'text' ? 'txt' : 'mid');
        const dash = dashAfter.has(c.id) ? ' dash-r' : '';
        const val = f ? cellValue(f, c, timeFormat) : '';
        return `<td class="cell ${align}${dash}">${val}</td>`;
      })
      .join('');
    dataRows.push(`<tr class="row${r % 2 ? ' odd' : ''}">${cells}</tr>`);
  }

  const bfTop = template.summary_layout !== 'bottom';
  let topBF = '';
  let bottomRows = '';
  let sigBlock = '';
  if (bfTop) {
    topBF = summaryRow('Brought forward', spread.brought_forward, 'bf', false);
    bottomRows =
      summaryRow('Total this page', spread.total_this_page, 'tot', true, true) +
      summaryRow('Total to date', spread.total_to_date, 'tot', true);
    sigBlock =
      `<div class="sig"><span class="cert">Certified true and correct.</span>` +
      `<span class="sname">Pilot's signature</span><span class="line">${sigInk}</span></div>`;
  } else {
    // Bokstil: pilotsignatur till vänster om Total this page / Brought forward / Total to date.
    const labelSpan = Math.min(2, firstNumericIdx) || 1;
    const sigSpan = Math.max(0, firstNumericIdx - labelSpan);
    const rightCells = (label: string, totals: ColumnTotals, showZero: boolean) => {
      let h = `<td class="sum-label" colspan="${labelSpan}">${esc(label)}</td>`;
      for (let i = firstNumericIdx; i < cols.length; i++) {
        const c = cols[i];
        if (isOpenCol(c)) { h += `<td class="sum-open"></td>`; continue; }
        const dash = dashAfter.has(c.id) ? ' dash-r' : '';
        h += isNumericCol(c)
          ? `<td class="sum-num${dash}">${totalValue(c, totals, timeFormat, showZero)}</td>`
          : `<td class="sum-blank${dash}"></td>`;
      }
      return h;
    };
    const sigCell = sigSpan > 0
      ? `<td class="sig-cell" colspan="${sigSpan}" rowspan="3"><div class="sig-cert">Certified true and correct.</div><div class="sig-line"><span class="sig-name3">Pilot's signature</span><span class="sig-fill">${sigInk}</span></div></td>`
      : '';
    bottomRows =
      `<tr class="sum sum--tot sum-top">${sigCell}${rightCells('Total this page', spread.total_this_page, true)}</tr>` +
      `<tr class="sum sum--tot">${rightCells('Brought forward', spread.brought_forward, false)}</tr>` +
      `<tr class="sum sum--tot">${rightCells('Total to date', spread.total_to_date, true)}</tr>`;
  }

  const pageL = spread.page_left;
  const pageR = spread.page_right;

  return `<div class="page">
    <div class="top">
      <div class="who">${esc(pilotName || '')}</div>
      <div class="lbl">Pilot Logbook · ${pageL}–${pageR}</div>
    </div>

    <div class="tbl-wrap">
      <div class="gutter-line" style="left:${leftWidth}px"></div>
      <table class="lb">
        <colgroup>${cols.map((c) => `<col style="width:${c.width}px" />`).join('')}</colgroup>
        <thead>${headerHTML}</thead>
        <tbody>
          ${topBF}
          ${dataRows.join('')}
          ${bottomRows}
        </tbody>
      </table>
    </div>

    ${sigBlock}

    <div class="brand">Blades · digital logbook</div>
    <div class="pg l">p. ${pageL}</div>
    <div class="pg r">p. ${pageR}</div>
  </div>`;
}

function spreadStyles(contentWidth: number, pageWidth: number, pagePad: number, margin: number): string {
  return `
  * { box-sizing: border-box; margin: 0; padding: 0; -webkit-text-size-adjust: 100%; }
  html, body {
    background: #ECE3CC;
    font-family: Georgia, 'Times New Roman', serif;
    color: #2A2620;
  }
  .page {
    width: ${pageWidth}px;
    margin: ${margin}px auto;
    background: #FCF8EE;
    padding: 14px ${pagePad}px 30px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.18);
    border: 1px solid #D9CEB4;
    position: relative;
  }
  .top {
    display: flex; align-items: baseline; justify-content: space-between;
    border-bottom: 1.5px solid #B7AA8A; padding-bottom: 6px; margin-bottom: 8px;
  }
  .top .who { font-size: 13px; font-weight: bold; letter-spacing: .3px; }
  .top .lbl {
    font-family: Helvetica, Arial, sans-serif; font-size: 9px; letter-spacing: 2px;
    text-transform: uppercase; color: #8A7E60;
  }
  table.lb { border-collapse: collapse; width: ${contentWidth}px; table-layout: fixed; }
  table.lb th, table.lb td { border-right: 0.8px solid #8A7048; overflow: hidden; }
  table.lb th:first-child, table.lb td:first-child { border-left: 0.8px solid #8A7048; }
  /* streckad kolumnkant (t.ex. SE|ME, Day|Night, Night|Sea) — brun som övriga */
  .dash-r { border-right: 0.8px dashed #8A7048 !important; }
  /* vågräta linjer endast i rubrik + summarader — inte mellan dataraderna */
  th.hx, th.hdr, th.grp { border-top: 0.8px solid #8A7048; border-bottom: 0.8px solid #8A7048; }
  tr.sum td { border-top: 0.8px solid #8A7048; border-bottom: 0.8px solid #8A7048; }
  .tbl-wrap { position: relative; }
  .gutter-line { position: absolute; top: 0; bottom: 0; width: 2.8px; background: #8A7048; z-index: 2; }
  th.hx {
    background: #F4EDD9; color: #4A4030;
    font-family: Helvetica, Arial, sans-serif; font-size: 8.5px; font-weight: 700;
    padding: 4px 3px; text-align: center; line-height: 1.15; vertical-align: middle;
  }
  th.hx .hx-sub { font-size: 7px; font-weight: 600; color: #8A7E60; letter-spacing: .2px; margin-top: 1px; text-transform: none; }
  th.hx-tap { cursor: pointer; }
  .hx-pick { display: inline-block; color: #16243F; font-weight: 800; }
  .hx-pick--empty { color: #B0A179; border: 1px dashed #B0A179; border-radius: 4px; padding: 0 6px; font-size: 13px; font-weight: 700; }
  /* förtryckt fri kolumn (Sea/Instrument/IRI): bokens etikett + diskret "+" */
  .hx-pick--label { color: #4A4030; font-weight: 700; }
  .hx-plus { color: #B0A179; font-weight: 800; font-size: 9px; vertical-align: super; margin-left: 2px; }
  th.grp {
    background: #F1E8D4; color: #6E6242;
    font-family: Helvetica, Arial, sans-serif; font-size: 8.5px; font-weight: 700;
    letter-spacing: 1px; text-transform: uppercase; padding: 3px 2px; text-align: center;
  }
  th.grp--empty { background: transparent; border-left: none; border-top: none; }
  th.hdr {
    background: #F7F1E1; color: #4A4030;
    font-family: Helvetica, Arial, sans-serif; font-size: 8.5px; font-weight: 700;
    padding: 4px 2px; text-align: center; line-height: 1.1; vertical-align: middle;
  }
  td.cell { height: 21px; padding: 1px 4px; font-size: 11px; vertical-align: middle; }
  td.num { text-align: center; font-family: 'Courier New', monospace; font-variant-numeric: tabular-nums; }
  td.mid { text-align: center; }
  td.txt { text-align: left; }
  tr.odd td.cell { background: #FBF5E6; }
  tr.sum td { padding: 5px 4px; font-weight: bold; }
  .sum-num { text-align: center; font-family: 'Courier New', monospace; font-variant-numeric: tabular-nums; font-size: 11.5px; }
  .sum-label {
    text-align: right; font-family: Helvetica, Arial, sans-serif; font-size: 8.5px;
    letter-spacing: .6px; text-transform: uppercase; font-weight: 800;
  }
  tr.sum--bf td { background: #F4EEDC; color: #5A5240; }
  tr.sum--tot td { background: #EFE6CE; color: #2A2620; }
  tr.sum--tot .sum-label { color: #2A2620; }
  /* öppen (tom) cell — t.ex. under Remarks; inga inre linjer, papperston */
  .sum-open { border: none !important; background: #FCF8EE !important; }
  /* separatorlinjen data→totaler fortsätter ut till sidkanten över de öppna fälten */
  tr.sum-top td.sum-open { border-top: 0.8px solid #8A7048 !important; }
  .sig {
    display: flex; align-items: flex-end; gap: 14px; margin-top: 8px;
    font-size: 10px; color: #6E6242;
  }
  .sig .cert { font-style: italic; }
  .sig .line { flex: 1; border-bottom: 1px solid #8A7048; min-height: 34px; display: flex; align-items: flex-end; }
  .sig .sname { font-family: Helvetica, Arial, sans-serif; font-size: 8.5px; letter-spacing: .6px; text-transform: uppercase; }
  /* signatur till vänster om summa-raderna (bokstil) */
  .sig-cell { text-align: left; padding: 7px 10px; vertical-align: top; background: #FCF8EE !important; border-left: none !important; border-bottom: none !important; }
  .sig-cert { font-style: italic; font-size: 10px; color: #6E6242; }
  .sig-line { display: flex; align-items: flex-end; gap: 8px; margin-top: 12px; }
  .sig-name3 { font-family: Helvetica, Arial, sans-serif; font-size: 8.5px; letter-spacing: .6px; text-transform: uppercase; color: #6E6242; white-space: nowrap; padding-bottom: 2px; }
  .sig-fill { flex: 1; border-bottom: 1px solid #8A7048; display: flex; align-items: flex-end; min-height: 34px; }
  .pg {
    position: absolute; bottom: 9px; font-family: 'Courier New', monospace;
    font-size: 10px; color: #9A8F76;
  }
  .pg.l { left: 16px; }
  .pg.r { right: 16px; }
  .brand {
    text-align: center; font-family: Helvetica, Arial, sans-serif; font-size: 7.5px;
    letter-spacing: 1.5px; text-transform: uppercase; color: #C4B89A; margin-top: 14px;
  }
`;
}

export function renderSpreadHTML(opts: RenderSpreadOpts): string {
  const cols = [...opts.template.left_columns, ...opts.template.right_columns];
  const contentWidth = cols.reduce((s, c) => s + c.width, 0);
  const pagePad = 16;
  const pageWidth = contentWidth + pagePad * 2 + 2;
  const margin = opts.margin ?? 26;
  const viewportWidth = pageWidth + margin * 2;
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=${viewportWidth}, user-scalable=yes" />
<style>${spreadStyles(contentWidth, pageWidth, pagePad, margin)}</style>
</head>
<body>
${spreadBody(opts)}
</body>
</html>`;
}

export interface RenderSpreadsPdfOpts {
  template: LogbookTemplate;
  spreads: LogbookSpread[];
  pilotName?: string;
  timeFormat: 'decimal' | 'hhmm';
  signature?: { paths: string[]; w: number; h: number; x?: number; y?: number } | null;
}

export interface RenderedPdf {
  html: string;
  width: number;   // sidbredd i punkter (till expo-print)
  height: number;  // sidhöjd i punkter
}

// Flersidig PDF: ett uppslag per liggande sida, senaste först. Naturlig storlek
// (ingen transform/zoom) — sidan görs lika bred som uppslaget och tillräckligt
// hög för alla rader. Speglar mönstret i den fungerande CV-PDF:en (px @96dpi →
// pt @72dpi) så att WKWebViews paginering inte hänger sig.
export function renderSpreadsPDF(opts: RenderSpreadsPdfOpts): RenderedPdf {
  const { template, spreads, pilotName, timeFormat, signature } = opts;
  const cols = [...template.left_columns, ...template.right_columns];
  const contentWidth = cols.reduce((s, c) => s + c.width, 0);
  const pagePad = 16;
  const pageWidth = contentWidth + pagePad * 2 + 2;
  const pageHeightPx = 320 + template.rows_per_spread * 22; // generöst — uppslaget klipps aldrig
  // Sidbredden låses till standard A4-liggande bredd (842 pt). En bredare sida
  // ger en enorm renderingsyta i WKWebView → segt. WKWebView skalar innehållet
  // till sidbredden automatiskt (samma som CV-PDF:en), så höjden blir proportionell.
  const widthPt = 842;
  const heightPt = Math.round(pageHeightPx * (widthPt / pageWidth));

  const bodies = spreads.map((s) =>
    spreadBody({ template, spread: s, rowsPerSpread: template.rows_per_spread, pilotName, timeFormat, signature, interactive: false }),
  );

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: ${widthPt}pt ${heightPt}pt; margin: 0; }
  ${spreadStyles(contentWidth, pageWidth, pagePad, 0)}
  html, body { background: #FCF8EE; }
  .page { margin: 0 !important; box-shadow: none; min-height: ${pageHeightPx}px; page-break-after: always; }
  .page:last-child { page-break-after: auto; }
</style>
</head>
<body>
${bodies.join('')}
</body>
</html>`;

  return { html, width: widthPt, height: heightPt };
}
