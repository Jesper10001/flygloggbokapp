// BLADES — Insights page redesign · shared foundation.
// Palette = the app's Navy theme (constants/colors.ts). All demo data maps to
// what the app already computes (getMonthlyHours, getStressHours / yearAvg14,
// getHourTotals, getAdaptiveRates, the PPL/CPL/ATPL requirement tables).
// Demo persona: a CPL(A) holder working toward ATPL(A) (~920 h) — so the
// licence journey has a meaningful "next licence" to show.

const IN_C = {
  bg:        '#0A1628',
  bgDeep:    '#06101E',
  surface:   '#0F1E3A',
  surface2:  '#132845',
  elevated:  '#16314E',
  card:      '#102441',
  border:    '#1A3A5A',
  borderSoft:'#142B45',
  separator: '#122030',

  primary:   '#00C8E8',   // cyan — accent (tweakable)
  gold:      '#FFB830',   // baseline lines, licence/premium accents
  success:   '#00E8A0',
  warning:   '#FFB830',
  danger:    '#FF6B5B',
  info:      '#5DA9FF',

  text:      '#FFFFFF',
  text2:     '#A8BFD6',
  text3:     '#7FA8C8',
  muted:     '#5A7FA0',
  faint:     '#3A5A7A',
};

const IN_FONT  = '-apple-system, "SF Pro Display", "Inter", system-ui, sans-serif';
const IN_SERIF = '"Fraunces", Georgia, serif';
const IN_MONO  = '"JetBrains Mono", "SF Mono", ui-monospace, monospace';

const IN_ACCENTS = ['#00C8E8', '#FFB830', '#00E8A0', '#5DA9FF'];

// ─────────────────────────────────────────────────────────────
// DEMO DATA
// ─────────────────────────────────────────────────────────────
const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH_FULL = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const IN_DATA = {
  pilot: 'Johan',
  curYear: 2026,
  curMonthIdx: 5, // June (0-indexed)
  today: 13,      // 13 June 2026

  // getMonthlyHours() — this year vs last year
  monthly: {
    cur:  [21, 17, 24, 19, 26, 108, 0, 0, 0, 0, 0, 0],   // 2026 (to June; Jun=108 demo for 3-digit cell)
    prev: [18, 15, 22, 20, 24, 19, 12, 16, 21, 23, 20, 17], // 2025
  },

  // total + windows (getHourTotals + sumSince)
  total: 921,
  ytd: 121,
  m3: 59, m6: 121, m12: 226,

  // hour categories (getHourTotals)
  cats: {
    pic: 281, co_pilot: 541, dual: 95, ifr: 96, night: 45, nvg: 22, vfr: 426,
    xc: 242, multi_pilot: 182, instructor: 0, picus: 64, sim: 38,
  },
  landings: { day: 412, night: 58 },

  // adaptive per-month rates (getAdaptiveRates) — used for forecasts
  rates: { total: 22, multi_pilot: 13, pic: 6, xc: 7, ifr: 4, night: 3, nvg: 1, vfr: 9 },

  // intersection (overlap) categories — hours flown as BOTH at once, e.g.
  // 'pic+night' = time logged that was simultaneously PIC and night. Their own
  // logbook measures, NOT the sum of the two columns.
  combos: {
    'pic+ifr':   { have: 64, rate: 3 },
    'pic+nvg':   { have: 15, rate: 0.7 },
    'pic+night': { have: 28, rate: 2 },
    'vfr+night': { have: 12, rate: 1.5 },
  },

  // 14-day rolling load: daily hours, this period vs previous 14 days
  load: {
    cur:  [0, 2.4, 0, 3.1, 1.6, 0, 0, 3.8, 0, 2.2, 3.4, 0, 1.2, 2.6],
    prev: [1.8, 0, 2.2, 0, 2.8, 1.4, 0, 0, 3.1, 1.0, 0, 2.4, 0, 1.6],
    dayLabels: ['S','M','T','W','T','F','S','S','M','T','W','T','F','S'],
    thisWeek: 9.4,
    yearAvg14: 24.8, // baseline (getStressHours.yearAvg14)
  },

  // licence journey (EASA Part-FCL, fixed-wing). current values from cats.
  licences: [
    { code: 'PPL(A)', ref: 'FCL.210.A', met: true,
      reqs: [
        { label: 'Total flight time', key: 'total', req: 45 },
        { label: 'Dual instruction', key: 'dual', req: 25 },
        { label: 'Solo flight', key: 'pic', req: 10 },
        { label: 'Solo cross-country', key: 'xc', req: 5 },
        { label: 'Night', key: 'night', req: 5 },
      ] },
    { code: 'CPL(A)', ref: 'FCL.310.A', met: true,
      reqs: [
        { label: 'Total flight time', key: 'total', req: 200 },
        { label: 'PIC', key: 'pic', req: 100 },
        { label: 'Cross-country PIC', key: 'xc', req: 20 },
        { label: 'Instrument', key: 'ifr', req: 10 },
        { label: 'Night', key: 'night', req: 5 },
      ] },
    { code: 'ATPL(A)', ref: 'FCL.510.A', met: false, next: true,
      reqs: [
        { label: 'Total flight time', key: 'total', req: 1500 },
        { label: 'Multi-crew ops', key: 'multi_pilot', req: 500 },
        { label: 'PIC', key: 'pic', req: 250 },
        { label: 'Cross-country', key: 'xc', req: 200 },
        { label: 'Instrument (IFR)', key: 'ifr', req: 75 },
        { label: 'Night', key: 'night', req: 100 },
      ] },
  ],
};

// values for licence/goal keys. 'a+b' is an INTERSECTION (hours flown as both),
// read from IN_DATA.combos — NOT the sum of the two columns.
IN_DATA.haveFor = (key) => {
  if (key.indexOf('+') >= 0) return (IN_DATA.combos[key] || {}).have ?? 0;
  const c = IN_DATA.cats;
  if (key === 'total') return IN_DATA.total;
  return c[key] ?? 0;
};
IN_DATA.rateFor = (key) => {
  if (key.indexOf('+') >= 0) return (IN_DATA.combos[key] || {}).rate ?? 0;
  return IN_DATA.rates[key] ?? 0;
};

// ── cumulative flight-hours journey — monthly points oldest→newest, ending at
// total now. 2023–24 synthesised, 2025/2026 are the real monthly arrays. ──────
IN_DATA.journey = (() => {
  let seed = 99173;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let early = Array.from({ length: 24 }, () => 14 + rnd() * 20);
  const prevSum = IN_DATA.monthly.prev.reduce((a, b) => a + b, 0);
  const curSum = IN_DATA.monthly.cur.slice(0, IN_DATA.curMonthIdx + 1).reduce((a, b) => a + b, 0);
  const scale = (IN_DATA.total - prevSum - curSum) / early.reduce((a, b) => a + b, 0);
  early = early.map((v) => v * scale);
  const monthly = [...early, ...IN_DATA.monthly.prev, ...IN_DATA.monthly.cur.slice(0, IN_DATA.curMonthIdx + 1)];
  const base = new Date(IN_DATA.curYear, IN_DATA.curMonthIdx, 1);
  let cum = 0; const out = [];
  for (let i = 0; i < monthly.length; i++) {
    cum += monthly[i];
    const d = new Date(base); d.setMonth(d.getMonth() - (monthly.length - 1 - i));
    out.push({ date: d, cum: Math.round(cum * 10) / 10 });
  }
  return out;
})();

// cumulative PIC-hours journey (same months, PIC weight ramps up over the
// career, scaled to the real PIC total). Used as the alternate projection.
IN_DATA.journeyPic = (() => {
  const J = IN_DATA.journey;
  const n = J.length;
  // per-month total deltas
  const deltas = J.map((p, i) => p.cum - (i ? J[i - 1].cum : 0));
  // PIC weight ramps 0.04 → 0.55 across the career
  let picMonthly = deltas.map((d, i) => d * (0.04 + (0.51 * i) / (n - 1)));
  const scale = IN_DATA.cats.pic / picMonthly.reduce((a, b) => a + b, 0);
  picMonthly = picMonthly.map((v) => v * scale);
  let cum = 0;
  return J.map((p, i) => { cum += picMonthly[i]; return { date: p.date, cum: Math.round(cum * 10) / 10 }; });
})();

// ── formatters ───────────────────────────────────────────────
function fmtH(dec) {
  // decimal hours → "H:MM"
  const h = Math.floor(dec), m = Math.round((dec - h) * 60);
  if (m === 60) return `${h + 1}:00`;
  return `${h}:${String(m).padStart(2, '0')}`;
}
const fmtInt = (n) => Math.round(n).toLocaleString('sv-SE');

function forecast(remaining, ratePerMonth) {
  if (remaining <= 0 || ratePerMonth <= 0) return null;
  const months = Math.ceil(remaining / ratePerMonth);
  const d = new Date(2026, 5, 1);
  d.setMonth(d.getMonth() + months);
  return { label: `${MONTH_FULL[d.getMonth()]} ${d.getFullYear()}`, months };
}

// ─────────────────────────────────────────────────────────────
// ICONS
// ─────────────────────────────────────────────────────────────
const IS = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' };
function IIcon({ name, size = 20 }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24' };
  switch (name) {
    case 'insights': return <svg {...p}><path {...IS} d="M4 19V5M4 19h16M8 16l3.5-4 3 2.5L20 8"/></svg>;
    case 'home': return <svg {...p}><path {...IS} d="M4 11l8-7 8 7M6 9.5V20h12V9.5"/></svg>;
    case 'list': return <svg {...p}><path {...IS} d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>;
    case 'book': return <svg {...p}><path {...IS} d="M4 4.5A1.5 1.5 0 0 1 5.5 3H11v17H5.5A1.5 1.5 0 0 0 4 21.5V4.5zM20 4.5A1.5 1.5 0 0 0 18.5 3H13v17h5.5A1.5 1.5 0 0 1 20 21.5V4.5z"/></svg>;
    case 'gear': return <svg {...p}><circle {...IS} cx="12" cy="12" r="3"/><path {...IS} d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3"/></svg>;
    case 'calendar': return <svg {...p}><rect {...IS} x="3" y="4.5" width="18" height="16" rx="2.5"/><path {...IS} d="M3 9h18M8 2.5v4M16 2.5v4"/></svg>;
    case 'clock': return <svg {...p}><circle {...IS} cx="12" cy="12" r="8.5"/><path {...IS} d="M12 7v5l3.5 2"/></svg>;
    case 'target': return <svg {...p}><circle {...IS} cx="12" cy="12" r="8.5"/><circle {...IS} cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/></svg>;
    case 'trophy': return <svg {...p}><path {...IS} d="M7 4h10v5a5 5 0 0 1-10 0V4zM5 5H3v1.5A3 3 0 0 0 6 9.5M19 5h2v1.5a3 3 0 0 1-3 3M9 14.5h6M8 21h8M12 16.5V21"/></svg>;
    case 'route': return <svg {...p}><circle {...IS} cx="6" cy="18" r="2.4"/><circle {...IS} cx="18" cy="6" r="2.4"/><path {...IS} d="M8.4 18H14a3 3 0 0 0 0-6H10a3 3 0 0 1 0-6h5.6"/></svg>;
    case 'moon': return <svg {...p}><path {...IS} d="M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5z"/></svg>;
    case 'plane': return <svg {...p}><path {...IS} d="M10.2 3.3a1.7 1.7 0 0 1 3.6 0V9l8 4.5v2.2L13.8 13v4.2l2.4 1.8v1.8L12 19.6 7.8 20.8V19l2.4-1.8V13L2 15.7v-2.2L10.2 9V3.3z"/></svg>;
    case 'chevron': return <svg {...p}><path {...IS} d="M9 6l6 6-6 6"/></svg>;
    case 'plus': return <svg {...p}><path {...IS} d="M12 5v14M5 12h14"/></svg>;
    case 'check': return <svg {...p}><path {...IS} d="M4 12.5 9 17.5 20 6.5"/></svg>;
    case 'help': return <svg {...p}><circle {...IS} cx="12" cy="12" r="9"/><path {...IS} d="M9.5 9.5a2.5 2.5 0 1 1 3.2 2.4c-.7.3-1.2.9-1.2 1.6v.5M12 17h.01"/></svg>;
    case 'spark': return <svg {...p}><path {...IS} d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/></svg>;
    case 'up': return <svg {...p}><path {...IS} d="M7 14l5-5 5 5"/></svg>;
    case 'flag': return <svg {...p}><path {...IS} d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>;
    default: return null;
  }
}

// ─────────────────────────────────────────────────────────────
// PRIMITIVES
// ─────────────────────────────────────────────────────────────
function Card({ children, style, pad = 16, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: IN_C.card, border: `1px solid ${IN_C.border}`, borderRadius: 16, padding: pad,
      cursor: onClick ? 'pointer' : 'default', position: 'relative', ...style,
    }}>{children}</div>
  );
}

function SectionHead({ icon, title, hint }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12, marginTop: 4 }}>
      {icon && <span style={{ color: 'var(--acc)', display: 'flex' }}><IIcon name={icon} size={17}/></span>}
      <span style={{ flex: 1, fontFamily: IN_MONO, fontSize: 11, fontWeight: 700, letterSpacing: '0.16em',
                     textTransform: 'uppercase', color: IN_C.text2 }}>{title}</span>
      {hint && <span style={{ fontFamily: IN_MONO, fontSize: 10, fontWeight: 700, color: IN_C.muted }}>{hint}</span>}
    </div>
  );
}

function HelpDot({ onClick }) {
  return (
    <button onClick={onClick} style={{ position: 'absolute', top: 12, right: 12, width: 18, height: 18,
      borderRadius: 9, background: IN_C.elevated, border: `1px solid ${IN_C.border}`, color: IN_C.muted,
      cursor: 'pointer', display: 'grid', placeItems: 'center', padding: 0 }}>
      <span style={{ fontFamily: IN_MONO, fontSize: 10, fontWeight: 700 }}>?</span>
    </button>
  );
}

function Pill({ children, tone = 'success' }) {
  const map = { success: IN_C.success, warning: IN_C.warning, danger: IN_C.danger, acc: 'var(--acc)', muted: IN_C.muted };
  const c = map[tone] || IN_C.success;
  return (
    <span style={{ fontFamily: IN_MONO, fontSize: 10, fontWeight: 700, color: c, letterSpacing: '0.04em' }}>{children}</span>
  );
}

function ProgressBar({ pct, color = 'var(--acc)', h = 6, track = IN_C.separator }) {
  return (
    <div style={{ height: h, borderRadius: 99, background: track, overflow: 'hidden' }}>
      <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', borderRadius: 99, background: color }}/>
    </div>
  );
}

Object.assign(window, {
  IN_C, IN_FONT, IN_SERIF, IN_MONO, IN_ACCENTS, IN_DATA, MONTHS, MONTH_FULL,
  fmtH, fmtInt, forecast, IIcon, Card, SectionHead, HelpDot, Pill, ProgressBar,
});
