// BLADES — Drone UX prototype · shared foundation.
//
// Identity: SAME navy base as pilot-manned (so it reads as one app), but its
// own ACCENT (amber, from the app's existing drone-industrial palette) so drone
// mode feels like a distinct, deliberate surface. Accent is a single tweakable
// prop threaded everywhere via the --acc CSS variable.

const DR_C = {
  bg:        '#0A1628',   // navy — identical to manned
  bgDeep:    '#06101E',
  surface:   '#0F1E3A',
  surface2:  '#132845',
  elevated:  '#16314E',
  border:    '#1A3A5A',
  borderSoft:'#142B45',
  separator: '#122030',

  // accent is injected at runtime (default amber). These are fallbacks.
  text:      '#FFFFFF',
  text2:     '#A8BFD6',
  text3:     '#7FA8C8',
  muted:     '#5A7FA0',
  faint:     '#3A5A7A',

  success:   '#3FB950',
  warning:   '#FFC857',
  danger:    '#FF6B5B',
  good:      '#00E8A0',
};

const DR_FONT  = '-apple-system, "SF Pro Display", "Inter", system-ui, sans-serif';
const DR_SERIF = '"Fraunces", Georgia, serif';
const DR_MONO  = '"JetBrains Mono", "SF Mono", ui-monospace, monospace';

const DR_ACCENTS = ['#FF8C42', '#A855F7', '#7BE25B', '#22D3EE']; // amber / violet / lime / cyan

// ─────────────────────────────────────────────────────────────
// DEMO DATA — professional operator (inspection/mapping, Specific, BVLOS)
// All fields map to what the app already stores for drone flights.
// ─────────────────────────────────────────────────────────────
const DR_DATA = {
  pilot: 'Erik Lund',
  operator: 'SkyMap Survey AB',
  opId: 'SWE.OP.0042',

  totalMin: 18760,       // 312h 40m
  ytdMin: 5180,          // 86h 20m
  flights: 1240,
  last30Flights: 64,
  last30Min: 1420,

  categories: [
    { key: 'Specific',  count: 770, color: '#FF8C42' },
    { key: 'A2',        count: 300, color: '#FFC857' },
    { key: 'A3',        count: 110, color: '#7FA8C8' },
    { key: 'A1',        count: 50,  color: '#5A7FA0' },
    { key: 'Certified', count: 10,  color: '#A855F7' },
  ],

  modes: [
    { key: 'VLOS',  label: 'Visual',   count: 842, pct: 68 },
    { key: 'EVLOS', label: 'Extended', count: 150, pct: 12 },
    { key: 'BVLOS', label: 'Beyond',   count: 248, pct: 20 },
  ],

  missions: [
    { key: 'Inspection', count: 486 },
    { key: 'Mapping',    count: 372 },
    { key: 'Survey',     count: 248 },
    { key: 'Film',       count: 94 },
    { key: 'SAR',        count: 40 },
  ],

  fleet: [
    { id: 'M350-01',  model: 'DJI Matrice 350 RTK', type: 'Multirotor', flights: 412, min: 5760, batteries: 4, status: 'active',  mtow: '9.2 kg' },
    { id: 'MAV3E-02', model: 'DJI Mavic 3 Enterprise', type: 'Multirotor', flights: 388, min: 4320, batteries: 6, status: 'active', mtow: '0.92 kg' },
    { id: 'M300-03',  model: 'DJI Matrice 300 RTK', type: 'Multirotor', flights: 286, min: 5280, batteries: 4, status: 'active',  mtow: '9.0 kg' },
    { id: 'EVO-04',   model: 'Autel EVO Max 4T',   type: 'Multirotor', flights: 98,  min: 1920, batteries: 3, status: 'active',  mtow: '1.6 kg' },
    { id: 'WING-05',  model: 'WingtraOne GEN II',  type: 'VTOL fixed-wing', flights: 56, min: 1480, batteries: 2, status: 'maintenance', mtow: '3.7 kg' },
  ],

  batteries: [
    { id: 'TB65 · A1', drone: 'M350-01', cycles: 142, health: 88 },
    { id: 'TB65 · A2', drone: 'M350-01', cycles: 138, health: 90 },
    { id: 'TB30 · B1', drone: 'M300-03', cycles: 211, health: 79 },
    { id: 'BT3 · C4',  drone: 'MAV3E-02', cycles: 96,  health: 94 },
    { id: 'BT3 · C5',  drone: 'MAV3E-02', cycles: 88,  health: 95 },
  ],

  // competency / compliance — EASA UAS credentials
  certs: [
    { name: 'A1/A2 Certificate of Competency', code: 'CofC', expires: '2028-03-14', status: 'valid' },
    { name: 'A1/A3 Training Certificate',      code: 'OPEN', expires: '2028-03-14', status: 'valid' },
    { name: 'Specific · PDRA-S01 Authorisation', code: 'STS', expires: '2026-09-02', status: 'expiring' },
    { name: 'Operator Registration',            code: 'SWE.OP', expires: '2026-12-31', status: 'valid' },
  ],

  // recency per category — days since last flight
  recency: [
    { key: 'Specific',  days: 2,   limit: 90 },
    { key: 'A2',        days: 5,   limit: 90 },
    { key: 'A3',        days: 21,  limit: 90 },
    { key: 'A1',        days: 48,  limit: 90 },
    { key: 'Certified', days: 180, limit: 90 },
  ],

  recent: [
    { date: '2026-06-09', drone: 'M350-01',  mission: 'Inspection', mode: 'BVLOS', cat: 'Specific', sec: 1122, place: 'Powerline corridor · Sundsvall' },
    { date: '2026-06-08', drone: 'MAV3E-02', mission: 'Mapping',    mode: 'VLOS',  cat: 'A2',       sec: 1450, place: 'Quarry survey · Gävle' },
    { date: '2026-06-06', drone: 'M300-03',  mission: 'Survey',     mode: 'EVLOS', cat: 'Specific', sec: 1915, place: 'Wind farm · Piteå' },
    { date: '2026-06-04', drone: 'MAV3E-02', mission: 'Film',       mode: 'VLOS',  cat: 'A2',       sec: 750,  place: 'Construction · Uppsala' },
    { date: '2026-06-02', drone: 'EVO-04',   mission: 'Inspection', mode: 'VLOS',  cat: 'A3',       sec: 558,  place: 'Solar array · Visby' },
    { date: '2026-05-30', drone: 'M350-01',  mission: 'Survey',     mode: 'BVLOS', cat: 'Specific', sec: 2040, place: 'Forest health · Umeå' },
  ],
};

// ── time formatting (HH:MM total · MM:SS per-flight, toggleable) ─────────────
function fmtTotal(min, mode) {
  // mode: 'hhmm' | 'decimal'
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  if (mode === 'decimal') return (min / 60).toFixed(1);
  return `${h}:${String(m).padStart(2, '0')}`;
}
function fmtFlight(sec, mode) {
  // mode: 'mmss' | 'hhmm'
  if (mode === 'hhmm') {
    const totalMin = sec / 60;
    const h = Math.floor(totalMin / 60), m = Math.round(totalMin % 60);
    return `${h}:${String(m).padStart(2, '0')}`;
  }
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
const fmtInt = (n) => Math.round(n).toLocaleString('sv-SE');
function relDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  const now = new Date('2026-06-11T00:00:00');
  const days = Math.round((now - d) / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} d ago`;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

// ─────────────────────────────────────────────────────────────
// ICONS — line, currentColor, 24 grid
// ─────────────────────────────────────────────────────────────
const IS = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' };
function DIcon({ name, size = 22 }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24' };
  switch (name) {
    case 'drone': return <svg {...p}><rect {...IS} x="9.5" y="9.5" width="5" height="5" rx="1.2"/><path {...IS} d="M9.5 9.5 7 7M14.5 9.5 17 7M9.5 14.5 7 17M14.5 14.5 17 17"/><circle {...IS} cx="5.5" cy="5.5" r="2.3"/><circle {...IS} cx="18.5" cy="5.5" r="2.3"/><circle {...IS} cx="5.5" cy="18.5" r="2.3"/><circle {...IS} cx="18.5" cy="18.5" r="2.3"/></svg>;
    case 'grid': return <svg {...p}><rect {...IS} x="3" y="3" width="7.5" height="7.5" rx="1.6"/><rect {...IS} x="13.5" y="3" width="7.5" height="7.5" rx="1.6"/><rect {...IS} x="3" y="13.5" width="7.5" height="7.5" rx="1.6"/><rect {...IS} x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6"/></svg>;
    case 'list': return <svg {...p}><path {...IS} d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/></svg>;
    case 'book': return <svg {...p}><path {...IS} d="M4 4.5A1.5 1.5 0 0 1 5.5 3H11v17H5.5A1.5 1.5 0 0 0 4 21.5V4.5zM20 4.5A1.5 1.5 0 0 0 18.5 3H13v17h5.5A1.5 1.5 0 0 1 20 21.5V4.5z"/></svg>;
    case 'shield': return <svg {...p}><path {...IS} d="M12 3 5 6v5.5c0 4.3 3 7.6 7 9 4-1.4 7-4.7 7-9V6l-7-3z"/><path {...IS} d="M9 12l2 2 4-4.5"/></svg>;
    case 'plus': return <svg {...p}><path {...IS} d="M12 5v14M5 12h14"/></svg>;
    case 'battery': return <svg {...p}><rect {...IS} x="2.5" y="7" width="16" height="10" rx="2.2"/><path {...IS} d="M21.5 10.5v3"/><path {...IS} d="M5.5 10v4M8.5 10v4M11.5 10v4"/></svg>;
    case 'clock': return <svg {...p}><circle {...IS} cx="12" cy="12" r="8.5"/><path {...IS} d="M12 7v5l3.5 2"/></svg>;
    case 'pin': return <svg {...p}><path {...IS} d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z"/><circle {...IS} cx="12" cy="10" r="2.6"/></svg>;
    case 'eye': return <svg {...p}><path {...IS} d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle {...IS} cx="12" cy="12" r="2.8"/></svg>;
    case 'signal': return <svg {...p}><path {...IS} d="M5 18v-3M10 18v-7M15 18v-11M20 18v-15"/></svg>;
    case 'route': return <svg {...p}><circle {...IS} cx="6" cy="18" r="2.4"/><circle {...IS} cx="18" cy="6" r="2.4"/><path {...IS} d="M8.4 18H14a3 3 0 0 0 0-6H10a3 3 0 0 1 0-6h5.6"/></svg>;
    case 'chevron': return <svg {...p}><path {...IS} d="M9 6l6 6-6 6"/></svg>;
    case 'back': return <svg {...p}><path {...IS} d="M15 6l-6 6 6 6"/></svg>;
    case 'camera': return <svg {...p}><path {...IS} d="M3 8.5A1.5 1.5 0 0 1 4.5 7h2L8 5h8l1.5 2h2A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5v-9z"/><circle {...IS} cx="12" cy="13" r="3.2"/></svg>;
    case 'map': return <svg {...p}><path {...IS} d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4z"/><path {...IS} d="M9 4v13M15 6.5v13"/></svg>;
    case 'alt': return <svg {...p}><path {...IS} d="M12 3v18M12 3l4 4M12 3 8 7M5 21h14"/></svg>;
    case 'warn': return <svg {...p}><path {...IS} d="M12 3.5 21 19H3L12 3.5z"/><path {...IS} d="M12 10v4M12 16.5h.01"/></svg>;
    case 'check': return <svg {...p}><path {...IS} d="M4 12.5 9 17.5 20 6.5"/></svg>;
    case 'settings': return <svg {...p}><circle {...IS} cx="12" cy="12" r="3"/><path {...IS} d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3"/></svg>;
    case 'person': return <svg {...p}><circle {...IS} cx="12" cy="8" r="4"/><path {...IS} d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>;
    case 'star': return <svg {...p}><path {...IS} d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 17l-5.3 2.6 1-5.8L3.5 9.7l5.9-.9L12 3.5z"/></svg>;
    case 'globe': return <svg {...p}><circle {...IS} cx="12" cy="12" r="9"/><path {...IS} d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18"/></svg>;
    case 'contrast': return <svg {...p}><circle {...IS} cx="12" cy="12" r="9"/><path {...IS} d="M12 3v18a9 9 0 0 0 0-18z" fill="currentColor" stroke="none"/></svg>;
    case 'info': return <svg {...p}><circle {...IS} cx="12" cy="12" r="9"/><path {...IS} d="M12 11v5M12 7.5h.01"/></svg>;
    case 'mail': return <svg {...p}><rect {...IS} x="3" y="5.5" width="18" height="13" rx="2.4"/><path {...IS} d="M4 7l8 6 8-6"/></svg>;
    case 'cloud': return <svg {...p}><path {...IS} d="M7 18a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 9.5a3.8 3.8 0 0 1-.3 7.5H7z"/></svg>;
    case 'doc': return <svg {...p}><path {...IS} d="M6 3h8l4 4v14H6V3z"/><path {...IS} d="M14 3v4h4M8.5 12h7M8.5 15.5h7M8.5 8.5h2"/></svg>;
    case 'lock': return <svg {...p}><rect {...IS} x="5" y="11" width="14" height="9" rx="2"/><path {...IS} d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>;
    case 'chip': return <svg {...p}><rect {...IS} x="6" y="6" width="12" height="12" rx="2"/><path {...IS} d="M9 1.5v3M15 1.5v3M9 19.5v3M15 19.5v3M1.5 9h3M1.5 15h3M19.5 9h3M19.5 15h3"/></svg>;
    case 'download': return <svg {...p}><path {...IS} d="M12 3v12M7 10l5 5 5-5M5 21h14"/></svg>;
    default: return null;
  }
}

// ─────────────────────────────────────────────────────────────
// PRIMITIVES
// ─────────────────────────────────────────────────────────────
function Card({ children, style, pad = 16, onClick, glow }) {
  return (
    <div onClick={onClick} style={{
      background: DR_C.surface, border: `1px solid ${DR_C.border}`,
      borderRadius: 16, padding: pad,
      boxShadow: glow ? `0 0 0 1px var(--acc-line), 0 14px 30px -22px var(--acc)` : 'none',
      cursor: onClick ? 'pointer' : 'default',
      ...style,
    }}>{children}</div>
  );
}

function SectionLabel({ children, action, onAction }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
      <span style={{ fontFamily: DR_MONO, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.18em',
                     textTransform: 'uppercase', color: DR_C.text3, whiteSpace: 'nowrap' }}>{children}</span>
      {action && <span onClick={onAction} style={{ fontFamily: DR_MONO, fontSize: 10.5, fontWeight: 700,
                     letterSpacing: '0.08em', color: 'var(--acc)', cursor: 'pointer', whiteSpace: 'nowrap' }}>{action}</span>}
    </div>
  );
}

function Chip({ children, tone = 'muted', solid }) {
  const map = {
    acc:    { c: 'var(--acc)', b: 'var(--acc-line)', bg: 'var(--acc-soft)' },
    muted:  { c: DR_C.text3, b: DR_C.border, bg: 'rgba(127,168,200,0.08)' },
    good:   { c: DR_C.success, b: 'rgba(63,185,80,0.4)', bg: 'rgba(63,185,80,0.12)' },
    warn:   { c: DR_C.warning, b: 'rgba(255,200,87,0.4)', bg: 'rgba(255,200,87,0.12)' },
    danger: { c: DR_C.danger, b: 'rgba(255,107,91,0.4)', bg: 'rgba(255,107,91,0.12)' },
  };
  const t = map[tone] || map.muted;
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      fontFamily: DR_MONO, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em',
      textTransform: 'uppercase', color: solid ? DR_C.bg : t.c,
      background: solid ? t.c : t.bg, border: `1px solid ${solid ? t.c : t.b}`,
      padding: '3px 8px', borderRadius: 6, whiteSpace: 'nowrap',
    }}>{children}</span>
  );
}

function ProgressBar({ pct, color = 'var(--acc)', track = DR_C.separator, h = 6 }) {
  return (
    <div style={{ height: h, borderRadius: 99, background: track, overflow: 'hidden' }}>
      <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: '100%', borderRadius: 99,
                    background: color }}/>
    </div>
  );
}

// segmented donut for category split
function Donut({ segments, size = 116, stroke = 13, centerTop, centerBottom }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.count, 0);
  let offset = 0;
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={DR_C.separator} strokeWidth={stroke}/>
        {segments.map((s, i) => {
          const frac = s.count / total;
          const dash = circ * frac;
          const el = (
            <circle key={i} cx={size/2} cy={size/2} r={r} fill="none"
                    stroke={s.color} strokeWidth={stroke}
                    strokeDasharray={`${dash} ${circ - dash}`} strokeDashoffset={-offset}/>
          );
          offset += dash;
          return el;
        })}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontFamily: DR_SERIF, fontSize: 26, fontWeight: 500, color: DR_C.text, lineHeight: 1 }}>{centerTop}</span>
        <span style={{ fontFamily: DR_MONO, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.14em',
                       color: DR_C.muted, textTransform: 'uppercase', marginTop: 3 }}>{centerBottom}</span>
      </div>
    </div>
  );
}

Object.assign(window, {
  DR_C, DR_FONT, DR_SERIF, DR_MONO, DR_ACCENTS, DR_DATA,
  fmtTotal, fmtFlight, fmtInt, relDate,
  DIcon, Card, SectionLabel, Chip, ProgressBar, Donut,
});
