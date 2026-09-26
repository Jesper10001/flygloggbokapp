// Insights charts — monthly hours (bars / line-area / heatmap), 14-day load.
// All read from window.IN_DATA and animate on mount.

const { useState, useEffect, useRef } = React;

// planted demo records (in the app, computed from real daily sums). All-time sits
// in a past year so the current year still shows a distinct gold year-record.
const HL_ALLTIME = { y: 2025, m: 8, d: 12, h: 8.4 };  // Sep 12 2025 — most ever (purple)
const HL_YEARREC = { y: 2026, m: 4, d: 18, h: 6.6 };   // May 18 2026 — most this year (gold)

function useMounted() {
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOn(true), 60); return () => clearTimeout(t); }, []);
  return on;
}

// baseline of active months (mirrors FlightChart logic)
function monthlyBaseline(cur, prev) {
  // average of every flown month (each series' values counted individually),
  // so the line runs straight through the mean bar height.
  const all = [...cur, ...prev].filter((h) => h > 0);
  if (!all.length) return 0;
  return Math.round((all.reduce((s, h) => s + h, 0) / all.length) * 10) / 10;
}

// ── Monthly · BARS (this year vs last) ───────────────────────────────────────
function MonthlyBars({ accent, onView }) {
  const C = window.IN_C;
  const on = useMounted();
  const scrollRef = useRef(null);
  const [atPresent, setAtPresent] = useState(true);

  // monthly hours history (oldest→newest) from the journey series
  const J = window.IN_DATA.journey;
  const hist = J.map((p, i) => ({ date: p.date, h: i ? Math.max(0, p.cum - J[i - 1].cum) : p.cum }));
  const months = hist.slice(-42);
  const n = months.length;

  const flown = months.map((m) => m.h).filter((h) => h > 0);
  const base = flown.length ? Math.round((flown.reduce((s, h) => s + h, 0) / flown.length) * 10) / 10 : 0;
  // ghost = same month one year earlier (only drawn at present)
  const ghostFor = (i) => (i >= 12 ? months[i - 12].h : 0);
  const max = Math.max(...months.map((m) => m.h), base, 0.1);
  const PLOT = 120, BARW = 26;
  const px = (v) => Math.max((v / max) * PLOT, v > 0 ? 3 : 0);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) { el.scrollLeft = el.scrollWidth; report(el); } // start at present (right)
  }, []);
  const report = (el) => {
    const present = el.scrollWidth - el.clientWidth - el.scrollLeft < 8;
    const idx = Math.min(n - 1, Math.max(0, Math.round((el.scrollLeft + el.clientWidth) / BARW) - 1));
    setAtPresent(present);
    if (onView) onView({ atPresent: present, curLabel: String(months[idx].date.getFullYear()) });
  };

  return (
    <div>
      <div ref={scrollRef} onScroll={(e) => report(e.target)}
           style={{ overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none' }}>
        <div style={{ width: n * BARW, position: 'relative' }}>
          {/* baseline across the whole strip */}
          {atPresent && base > 0 && (
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 22 + (base / max) * PLOT, zIndex: 1, pointerEvents: 'none' }}>
              <div style={{ height: 1, background: C.gold, opacity: 0.7 }}/>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'flex-end', height: PLOT }}>
            {months.map((m, i) => {
              const isLast = i === n - 1;
              const showGhost = atPresent && i >= n - 12 && ghostFor(i) > 0;
              return (
                <div key={i} style={{ width: BARW, display: 'flex', alignItems: 'flex-end', gap: 1.5,
                                      justifyContent: 'center', height: '100%' }}>
                  {showGhost && (
                    <div style={{ width: 5, borderRadius: 2, background: C.muted, opacity: 0.55,
                                  height: on ? px(ghostFor(i)) : 0, transition: 'height .5s ease' }}/>
                  )}
                  {m.h > 0 && (
                    <div style={{ width: 5, borderRadius: 2, background: accent,
                                  height: on ? px(m.h) : 0,
                                  boxShadow: isLast ? `0 0 8px ${accent}` : 'none',
                                  transition: `height .6s cubic-bezier(.3,.8,.3,1) ${(n - 1 - i) * 20}ms` }}/>
                  )}
                </div>
              );
            })}
          </div>
          {/* month labels (year shown at each January) */}
          <div style={{ display: 'flex', marginTop: 6 }}>
            {months.map((m, i) => {
              const jan = m.date.getMonth() === 0;
              return (
                <span key={i} style={{ width: BARW, textAlign: 'center', fontFamily: window.IN_MONO,
                  fontSize: jan ? 8.5 : 9, fontWeight: 700,
                  color: i === n - 1 ? accent : jan ? C.text3 : C.faint }}>
                  {jan ? `'${String(m.date.getFullYear()).slice(2)}` : window.MONTHS[m.date.getMonth()]}</span>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Monthly · LINE / AREA ────────────────────────────────────────────────────
function MonthlyLine({ accent }) {
  const C = window.IN_C;
  const { cur, prev } = window.IN_DATA.monthly;
  const on = useMounted();
  const w = 320, h = 132, padB = 22, padT = 12;
  const curIdx = window.IN_DATA.curMonthIdx;
  // cumulative running totals
  const cumOf = (arr) => { let s = 0; return arr.map((v) => (s += v)); };
  const curCum = cumOf(cur).map((v, i) => (i <= curIdx ? v : null));
  const prevCum = cumOf(prev);
  const max = Math.max(...prevCum, curCum[curIdx] || 0, 0.1);
  const x = (i) => (i / 11) * w;
  const y = (v) => padT + (1 - v / max) * (h - padB - padT);
  // smooth path through points (only defined months for cur)
  const pathFor = (arr, upto) => {
    const pts = arr.map((v, i) => [x(i), y(v)]).filter((_, i) => upto == null || i <= upto);
    if (pts.length < 2) return '';
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      const [px, py] = pts[i - 1], [cx, cy] = pts[i];
      const mx = (px + cx) / 2;
      d += ` C ${mx} ${py} ${mx} ${cy} ${cx} ${cy}`;
    }
    return d;
  };
  const curPath = pathFor(curCum, curIdx);
  const prevPath = pathFor(prevCum, null);
  const areaPath = curPath ? `${curPath} L ${x(curIdx)} ${h - padB} L ${x(0)} ${h - padB} Z` : '';
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id="in-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.30"/>
          <stop offset="100%" stopColor={accent} stopOpacity="0"/>
        </linearGradient>
      </defs>
      {areaPath && <path d={areaPath} fill="url(#in-area)" opacity={on ? 1 : 0} style={{ transition: 'opacity .8s ease .3s' }}/>}
      <path d={prevPath} fill="none" stroke={C.muted} strokeWidth="1.6" opacity="0.5"
            strokeDasharray="900" strokeDashoffset={on ? 0 : 900} style={{ transition: 'stroke-dashoffset 1s ease' }}/>
      <path d={curPath} fill="none" stroke={accent} strokeWidth="2.4" strokeLinecap="round"
            strokeDasharray="900" strokeDashoffset={on ? 0 : 900} style={{ transition: 'stroke-dashoffset 1.1s ease .15s' }}/>
      {curCum.map((v, i) => i === curIdx && v != null ? (
        <circle key={i} cx={x(i)} cy={y(v)} r={3.5} fill={accent}
                opacity={on ? 1 : 0} style={{ transition: 'opacity .5s ease .9s' }}/>
      ) : null)}
      {/* same-point-last-year comparison */}
      {(() => {
        const cv = curCum[curIdx], pv = prevCum[curIdx];
        if (cv == null) return null;
        const xc = x(curIdx);
        const delta = Math.round(cv - pv);
        const up = delta >= 0;
        return (
          <g opacity={on ? 1 : 0} style={{ transition: 'opacity .5s ease 1s' }}>
            {/* connector between this year and last year at the same date */}
            <line x1={xc} y1={y(cv)} x2={xc} y2={y(pv)} stroke={C.text3} strokeWidth="1" strokeDasharray="2 2" opacity="0.5"/>
            {/* last-year marker */}
            <circle cx={xc} cy={y(pv)} r={3} fill={C.bgDeep} stroke={C.muted} strokeWidth="1.6"/>
            {/* labels placed away from each other: higher value's label above its dot, lower value's below */}
            <text x={xc - 7} y={y(cv) + (cv >= pv ? -7 : 12)} textAnchor="end" fontFamily={window.IN_MONO} fontSize="11" fontWeight="700" fill={accent}>
              {Math.round(cv)}h</text>
            <text x={xc - 7} y={y(pv) + (pv > cv ? -7 : 12)} textAnchor="end" fontFamily={window.IN_MONO} fontSize="9" fontWeight="700" fill={C.text3}>
              {Math.round(pv)}h</text>
          </g>
        );
      })()}
      {window.MONTHS.map((m, i) => (
        <text key={i} x={x(i)} y={h - 6} textAnchor="middle" fontFamily={window.IN_MONO} fontSize="9" fontWeight="700"
              fill={i === curIdx ? accent : C.faint}>{m}</text>
      ))}
    </svg>
  );
}

// ── Monthly · HEATMAP (month × this/last year) ───────────────────────────────
function MonthlyHeatmap({ accent, activeYear, activeMonth, onPickMonth, yearShift = 0 }) {
  const C = window.IN_C;
  const { cur, prev } = window.IN_DATA.monthly;
  const on = useMounted();
  const monthlyHoursFor = (yr) => {
    if (yr === window.IN_DATA.curYear) return cur;
    if (yr === window.IN_DATA.curYear - 1) return prev;
    const out = []; for (let m = 0; m < 12; m++) out.push(monthDailyHours(yr, m).reduce((s, h) => s + h, 0));
    return out;
  };
  const topYear = window.IN_DATA.curYear - yearShift;
  const rows = [topYear, topYear - 1].map((yr) => ({ label: String(yr), arr: monthlyHoursFor(yr), year: yr }));
  const max = Math.max(...rows[0].arr, ...rows[1].arr, 0.1);
  const hexA = (a) => {
    const h = accent.replace('#',''); const n = parseInt(h, 16);
    return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
  };
  const goldA = (a) => {
    const n = parseInt(C.gold.replace('#',''), 16);
    return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
  };
  const cell = (v, i, delay, active, year, recordColor) => {
    const intensity = v > 0 ? 0.16 + (v / max) * 0.84 : 0;
    const ringColor = recordColor || (active ? C.gold : (v > 0 ? hexA(Math.min(intensity + 0.15, 1)) : C.borderSoft));
    return (
      <div key={i} onClick={() => onPickMonth && onPickMonth(year, i)} style={{ flex: 1, aspectRatio: '1', borderRadius: 5, cursor: 'pointer',
        background: active ? goldA(v > 0 ? Math.max(intensity, 0.5) : 0.3) : (v > 0 ? hexA(intensity) : C.separator),
        border: `${recordColor ? 1.5 : 1}px solid ${ringColor}`,
        boxShadow: recordColor ? `0 0 6px ${recordColor}` : (active ? `0 0 8px ${goldA(0.55)}` : 'none'),
        opacity: on ? 1 : 0, transition: `opacity .4s ease ${delay}ms`,
        display: 'grid', placeItems: 'center' }}>
        {v > 0 && <span style={{ fontFamily: window.IN_MONO, fontSize: Math.round(v) >= 100 ? 7 : 8.5, fontWeight: 700,
          color: active ? C.bgDeep : (intensity > 0.55 ? C.bgDeep : C.text2) }}>{Math.round(v)}</span>}
      </div>
    );
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        {rows.map((row, r) => (
          <div key={r} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 30, fontFamily: window.IN_MONO, fontSize: 9, fontWeight: 700,
              color: row.year === activeYear ? C.gold : C.muted }}>{row.label.slice(2)}</span>
            <div style={{ flex: 1, display: 'flex', gap: 4 }}>
              {row.arr.map((v, i) => cell(v, i, (r * 12 + i) * 18, row.year === activeYear && i === activeMonth, row.year,
                (row.year === HL_ALLTIME.y && i === HL_ALLTIME.m) ? '#A855F7'
                  : (row.year === HL_YEARREC.y && i === HL_YEARREC.m) ? C.gold : null))}
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 4, paddingLeft: 36 }}>
          {window.MONTHS.map((m, i) => (
            <span key={i} style={{ flex: 1, textAlign: 'center', fontFamily: window.IN_MONO, fontSize: 8.5,
              fontWeight: 700, color: i === activeMonth ? C.gold : (i === window.IN_DATA.curMonthIdx ? accent : C.faint) }}>{m}</span>
          ))}
        </div>
    </div>
  );
}

// ── 14-day load · BARS (this period vs prev 14d) ─────────────────────────────
// ISO week number + deterministic continuous daily history (oldest→newest).
function isoWeek(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThu = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  return 1 + Math.round((date - firstThu) / (7 * 86400000));
}
function dailyHistory(endDate, nDays) {
  const out = [];
  for (let k = nDays - 1; k >= 0; k--) {
    const d = new Date(endDate); d.setDate(d.getDate() - k);
    let seed = ((d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()) * 2654435761) % 2147483647;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    out.push({ date: d, h: rnd() < 0.42 ? Math.round((1 + rnd() * 3.4) * 10) / 10 : 0 });
  }
  return out;
}

// ── 14-day load · BARS (full-width 14-bar window, swipe back to older periods) ──
function LoadBars({ accent, onView }) {
  const C = window.IN_C;
  const on = useMounted();
  const scrollRef = useRef(null);
  const today = new Date(window.IN_DATA.curYear, window.IN_DATA.curMonthIdx, window.IN_DATA.today);
  const PAGES = 9;
  const daily = dailyHistory(today, 14 * PAGES);
  const n = daily.length;
  const DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const PLOT = 84;
  const pad2 = (x) => String(x).padStart(2, '0');
  const fmtDM = (d) => `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
  // windowFor(p): p=0 is the most recent 14 days, p=1 the 14 before, …
  const windowFor = (p) => daily.slice(n - 14 * (p + 1), n - 14 * p);
  const allFlown = daily.map((d) => d.h).filter((h) => h > 0);
  const dailyBase = allFlown.length ? allFlown.reduce((s, h) => s + h, 0) / allFlown.length : 0;

  const report = (p) => {
    const present = p === 0;
    const win = windowFor(p);
    const start = win[0].date, end = win[win.length - 1].date;
    const curLabel = present ? `${fmtDM(start)}–${fmtDM(end)}` : `Week ${isoWeek(start)}–${isoWeek(end)}`;
    const pwin = windowFor(p + 1);
    const prevLabel = pwin.length ? `${fmtDM(pwin[0].date)}–${fmtDM(pwin[pwin.length - 1].date)}` : '';
    if (onView) onView({ atPresent: present, curLabel, prevLabel, sum: win.reduce((s, d) => s + d.h, 0) });
  };
  useEffect(() => { const el = scrollRef.current; if (el) { el.scrollLeft = el.scrollWidth; report(0); } }, []);
  const onScroll = (e) => {
    const el = e.target;
    const idxFromLeft = Math.round(el.scrollLeft / el.clientWidth);
    report(Math.max(0, (PAGES - 1) - idxFromLeft));
  };

  return (
    <div>
      <div ref={scrollRef} onScroll={onScroll}
           style={{ overflowX: 'auto', overflowY: 'hidden', scrollbarWidth: 'none',
                    scrollSnapType: 'x mandatory', display: 'flex' }}>
        {Array.from({ length: PAGES }, (_, j) => {
          const p = (PAGES - 1) - j;             // DOM left→right = oldest→newest
          const present = p === 0;
          const win = windowFor(p);
          const ghost = present ? windowFor(1) : [];
          const pageMax = Math.max(...win.map((d) => d.h), ...(present ? ghost.map((d) => d.h) : []), present ? dailyBase : 0, 0.1);
          const px = (v) => Math.max((v / pageMax) * PLOT, v > 0 ? 3 : 0);
          return (
            <div key={j} style={{ flex: '0 0 100%', scrollSnapAlign: 'start', position: 'relative' }}>
              {present && dailyBase > 0 && (
                <div style={{ position: 'absolute', left: 0, right: 0, bottom: 20 + (dailyBase / pageMax) * PLOT, zIndex: 1, pointerEvents: 'none' }}>
                  <div style={{ height: 1, background: C.gold, opacity: 0.7 }}/>
                </div>
              )}
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: PLOT }}>
                {win.map((d, i) => {
                  const gh = present && ghost[i] ? ghost[i].h : 0;
                  const isLast = present && i === win.length - 1;
                  return (
                    <div key={i} style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 1, justifyContent: 'center', height: '100%' }}>
                      {gh > 0 && <div style={{ width: 4, borderRadius: 1.5, background: C.muted, opacity: 0.5,
                        height: on ? px(gh) : 0, transition: `height .6s ease ${i * 25}ms` }}/>}
                      {d.h > 0 && <div style={{ width: 4, borderRadius: 1.5, background: accent,
                        height: on ? px(d.h) : 0, boxShadow: isLast ? `0 0 7px ${accent}` : 'none',
                        transition: `height .6s ease ${i * 25 + 60}ms` }}/>}
                      {d.h === 0 && gh === 0 && <div style={{ width: 4, height: 2, borderRadius: 1, background: C.separator }}/>}
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                {win.map((d, i) => (
                  <span key={i} style={{ flex: 1, textAlign: 'center', fontFamily: window.IN_MONO, fontSize: 8, fontWeight: 700,
                    color: present && i === win.length - 1 ? accent : C.faint }}>{DOW[d.date.getDay()]}</span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 14-day load · LINE / AREA ────────────────────────────────────────────────
function LoadLine({ accent }) {
  const C = window.IN_C;
  const { cur, prev, dayLabels } = window.IN_DATA.load;
  const on = useMounted();
  const w = 320, h = 104, padB = 18, padT = 10;
  const cumOf = (arr) => { let s = 0; return arr.map((v) => (s += v)); };
  const curCum = cumOf(cur), prevCum = cumOf(prev);
  const max = Math.max(...curCum, ...prevCum, 0.1);
  const n = cur.length;
  const x = (i) => (i / (n - 1)) * w;
  const y = (v) => padT + (1 - v / max) * (h - padB - padT);
  const smooth = (arr) => {
    let d = `M ${x(0)} ${y(arr[0])}`;
    for (let i = 1; i < arr.length; i++) {
      const mx = (x(i - 1) + x(i)) / 2;
      d += ` C ${mx} ${y(arr[i - 1])} ${mx} ${y(arr[i])} ${x(i)} ${y(arr[i])}`;
    }
    return d;
  };
  const curPath = smooth(curCum);
  const prevPath = smooth(prevCum);
  const area = `${curPath} L ${x(n - 1)} ${h - padB} L ${x(0)} ${h - padB} Z`;
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id="in-load-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.28"/>
          <stop offset="100%" stopColor={accent} stopOpacity="0"/>
        </linearGradient>
      </defs>
      <path d={area} fill="url(#in-load-area)" opacity={on ? 1 : 0} style={{ transition: 'opacity .8s ease .3s' }}/>
      <path d={prevPath} fill="none" stroke={C.muted} strokeWidth="1.4" opacity="0.45"
            strokeDasharray="800" strokeDashoffset={on ? 0 : 800} style={{ transition: 'stroke-dashoffset 1s ease' }}/>
      <path d={curPath} fill="none" stroke={accent} strokeWidth="2.2" strokeLinecap="round"
            strokeDasharray="800" strokeDashoffset={on ? 0 : 800} style={{ transition: 'stroke-dashoffset 1.1s ease .15s' }}/>
      <circle cx={x(n - 1)} cy={y(curCum[n - 1])} r="3.4" fill={accent} opacity={on ? 1 : 0} style={{ transition: 'opacity .5s ease .9s' }}/>
      {dayLabels.map((d, i) => (
        <text key={i} x={x(i)} y={h - 4} textAnchor="middle" fontFamily={window.IN_MONO} fontSize="8" fontWeight="700"
              fill={i === n - 1 ? accent : C.faint}>{d}</text>
      ))}
    </svg>
  );
}

// ── Deterministic per-day hours for any month (prototype projection) ─────────
// In the app these are real daily flight-hour sums; here we synthesise a stable
// pattern per (year, month) so stepping back shows distinct, believable months.
function monthDailyHours(year, monthIdx) {
  const days = new Date(year, monthIdx + 1, 0).getDate();
  let seed = ((year * 12 + monthIdx) * 2654435761) % 2147483647;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const out = [];
  for (let d = 0; d < days; d++) {
    out.push(rnd() < 0.42 ? Math.round((1 + rnd() * 3.4) * 10) / 10 : 0);
  }
  // current month: days after today haven't been flown yet
  if (year === window.IN_DATA.curYear && monthIdx === window.IN_DATA.curMonthIdx) {
    for (let d = window.IN_DATA.today; d < days; d++) out[d] = 0;
  }
  return out;
}

// synthetic per-day flights (in the app these are the real logbook rows).
function dayFlights(year, monthIdx, day, hours) {
  let seed = ((year * 372 + monthIdx * 31 + day) * 2654435761) % 2147483647;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const types = ['PA28', 'C172', 'DA40', 'PC-12', 'A320'];
  const regs = ['SE-MJZ', 'SE-LKP', 'OY-JRO', 'SE-GVB', 'LN-NTF'];
  const routes = [['ESSA', 'ESGG'], ['ESSB', 'ESNZ'], ['ESSA', 'EKCH'], ['ESGG', 'ENGM'], ['ESSA', 'ESSA'], ['ESOW', 'ESSA']];
  const n = hours >= 4 ? 3 : hours >= 2 ? 2 : 1;
  let remaining = hours; const out = [];
  for (let i = 0; i < n; i++) {
    const share = i === n - 1 ? remaining : Math.max(0.4, (hours / n) * (0.7 + rnd() * 0.6));
    remaining = Math.max(0, remaining - share);
    const r = routes[Math.floor(rnd() * routes.length)];
    out.push({ type: types[Math.floor(rnd() * types.length)], reg: regs[Math.floor(rnd() * regs.length)],
               dep: r[0], arr: r[1], h: Math.max(0.3, share) });
  }
  return out;
}

// ── 14-day load · HEATMAP → a full month, each cell = a day ──────────────────
function LoadMonthHeatmap({ accent, monthOffset = 0, onOpenDay }) {
  const C = window.IN_C;
  const on = useMounted();
  const [sel, setSel] = React.useState(null); // selected day {day, v, flights}
  const ref = new Date(window.IN_DATA.curYear, window.IN_DATA.curMonthIdx + monthOffset, 1);
  const year = ref.getFullYear(), monthIdx = ref.getMonth();
  React.useEffect(() => { setSel(null); }, [monthOffset]);
  const daily = monthDailyHours(year, monthIdx);
  const ALLTIME = HL_ALLTIME, YEARREC = HL_YEARREC;
  if (year === ALLTIME.y && monthIdx === ALLTIME.m) daily[ALLTIME.d - 1] = ALLTIME.h;
  if (year === YEARREC.y && monthIdx === YEARREC.m) daily[YEARREC.d - 1] = YEARREC.h;
  // demo: a two-digit-hours day in the CURRENT month so the label is visible
  if (year === window.IN_DATA.curYear && monthIdx === window.IN_DATA.curMonthIdx) daily[8] = 11.5;
  // the month's single busiest day is the only candidate for a highlight
  let monthMaxDay = 0, monthMaxV = 0;
  daily.forEach((v, i) => { if (v > monthMaxV) { monthMaxV = v; monthMaxDay = i + 1; } });
  const allTimeThisYear = ALLTIME.y === window.IN_DATA.curYear;
  const isAlltime = year === ALLTIME.y && monthIdx === ALLTIME.m && monthMaxDay === ALLTIME.d;
  const isYear = !allTimeThisYear && year === window.IN_DATA.curYear && year === YEARREC.y
    && monthIdx === YEARREC.m && monthMaxDay === YEARREC.d;
  const hlType = monthMaxV > 0 ? (isAlltime ? 'alltime' : isYear ? 'year' : 'month') : null;
  const hlFor = (d) => (d === monthMaxDay && hlType ? hlType : null);
  const HL_COLOR = { alltime: '#A855F7', year: C.gold, month: '#C8D2DE' };
  const HL_NOTE = { alltime: 'Most all time', year: 'Most this year', month: 'Most this month' };
  const shadeHex = (hex, mult, a = 1) => {
    const n = parseInt(hex.replace('#',''), 16);
    return `rgba(${Math.min(255,Math.round(((n>>16)&255)*mult))},${Math.min(255,Math.round(((n>>8)&255)*mult))},${Math.min(255,Math.round((n&255)*mult))},${a})`;
  };
  const max = Math.max(...daily, 0.1);
  const firstDow = (new Date(year, monthIdx, 1).getDay() + 6) % 7; // 0=Mon … 5=Sat 6=Sun
  const isCurMonth = year === window.IN_DATA.curYear && monthIdx === window.IN_DATA.curMonthIdx;
  const cols = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const hexA = (a) => {
    const n = parseInt(accent.replace('#',''), 16);
    return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${a})`;
  };
  const nWeeks = Math.ceil((firstDow + daily.length) / 7);

  // ── isometric projection — small 3D bars seen from the LEFT at an angle ──
  const TW = 38, TH = 19;        // tile spacing (iso) — larger = fills more
  const FW = 16, FH = 8;         // tile footprint half-extents
  const MAXBAR = 56;             // tallest bar in px
  // mirror back: weeks recede down-LEFT → camera sits on the right
  const isoX = (col, row) => (col - row) * (TW / 2);
  const isoY = (col, row) => (col + row) * (TH / 2);

  // colour faces from one accent value
  const rgb = (() => { const n = parseInt(accent.replace('#',''), 16); return [(n>>16)&255, (n>>8)&255, n&255]; })();
  const shade = (mult, a = 1) => `rgba(${Math.round(rgb[0]*mult)},${Math.round(rgb[1]*mult)},${Math.round(rgb[2]*mult)},${a})`;

  // build bars, ordered back→front for painter's algorithm
  const bars = [];
  daily.forEach((v, d) => {
    const idx = firstDow + d;
    bars.push({ v, day: d + 1, col: idx % 7, row: Math.floor(idx / 7) });
  });
  bars.sort((a, b) => (a.row + a.col) - (b.row + b.col));

  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  const polys = [];
  bars.forEach((b, k) => {
    const bx = isoX(b.col, b.row), by = isoY(b.col, b.row);
    const intensity = b.v > 0 ? 0.32 + (b.v / max) * 0.68 : 0;
    const bh = b.v > 0 ? 7 + (b.v / max) * MAXBAR : 0;
    const isToday = isCurMonth && b.day === window.IN_DATA.today;
    const ty = by - bh;
    const delay = (b.row + b.col) * 40;
    minX = Math.min(minX, bx - FW); maxX = Math.max(maxX, bx + FW);
    minY = Math.min(minY, ty - FH); maxY = Math.max(maxY, by + FH);
    if (b.v <= 0) {
      // flat empty tile — weekend (Sat/Sun) tinted red, weekday white
      const dow = new Date(year, monthIdx, b.day).getDay();
      const weekend = dow === 0 || dow === 6;
      const ord = (n) => { const s = ['th','st','nd','rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
      polys.push(
        <g key={`e${k}`} opacity={on ? 0.7 : 0} style={{ transition: `opacity .4s ease ${delay}ms` }}>
          <polygon points={`${bx-FW},${by} ${bx},${by-FH} ${bx+FW},${by} ${bx},${by+FH}`}
            fill={weekend ? 'rgba(255,107,91,0.22)' : 'rgba(255,255,255,0.07)'}
            stroke={weekend ? 'rgba(255,107,91,0.6)' : 'rgba(255,255,255,0.18)'} strokeWidth="0.6"/>
          <text fontFamily={window.IN_MONO} fontSize="5.5" fontWeight="700" fill="#FFFFFF" textAnchor="middle" dominantBaseline="central"
            transform={`matrix(0.894 0.447 -0.894 0.447 ${bx+3} ${by-FH+5})`}>{ord(b.day)}</text>
        </g>
      );
      return;
    }
    const hl = b.v > 0 ? hlFor(b.day) : null;
    const topFill = hl ? shadeHex(HL_COLOR[hl], 1.0) : (isToday ? '#FFFFFF' : shade(0.7 + intensity * 0.55));
    const leftFill = hl ? shadeHex(HL_COLOR[hl], 0.45) : shade(0.24 + intensity * 0.20);
    const rightFill = hl ? shadeHex(HL_COLOR[hl], 0.72) : shade(0.46 + intensity * 0.32);   // right face faces camera → brightest side
    const hrs = Math.floor(b.v);
    const isSel = sel && sel.day === b.day;
    polys.push(
      <g key={`b${k}`} opacity={on ? 1 : 0}
         onClick={() => { if (isSel) { onOpenDay && onOpenDay(new Date(year, monthIdx, b.day)); }
                          else { setSel({ day: b.day, v: b.v, flights: dayFlights(year, monthIdx, b.day, b.v), note: hl ? HL_NOTE[hl] : null, hl }); } }}
         style={{ cursor: 'pointer',
                  filter: hl === 'alltime' ? `drop-shadow(0 0 6px ${HL_COLOR.alltime})` : 'none',
                  transition: `opacity .45s ease ${delay}ms, transform .5s cubic-bezier(.3,.9,.3,1) ${delay}ms`,
                  transform: on ? 'none' : 'translateY(6px)' }}>
        {/* left face */}
        <polygon points={`${bx-FW},${by} ${bx},${by+FH} ${bx},${ty+FH} ${bx-FW},${ty}`} fill={leftFill}/>
        {/* right face (toward viewer) */}
        <polygon points={`${bx+FW},${by} ${bx},${by+FH} ${bx},${ty+FH} ${bx+FW},${ty}`} fill={rightFill}/>
        {/* top face */}
        <polygon points={`${bx-FW},${ty} ${bx},${ty-FH} ${bx+FW},${ty} ${bx},${ty+FH}`}
          fill={topFill} stroke={isSel ? C.gold : (hl ? shadeHex(HL_COLOR[hl], 1.3) : (isToday ? accent : shade(1.1)))} strokeWidth={isSel ? 2 : (hl ? 1.2 : (isToday ? 1.4 : 0.5))}/>
        {/* hours flown on top face — whole hours only, hidden under 1h */}
        {hrs >= 1 && (
          <text x={bx} y={ty} textAnchor="middle" dominantBaseline="central"
            fontFamily={window.IN_MONO} fontSize={hrs >= 10 ? 7.5 : 9} fontWeight="700"
            fill={hl || isToday || intensity > 0.55 ? C.bgDeep : shade(0.2)}>{hrs}h</text>
        )}
      </g>
    );
  });

  const pad = 8;
  const vbW = (maxX - minX) + pad * 2;
  const vbH = (maxY - minY) + pad * 2;
  return (
    <div style={{ overflow: 'visible' }}>
      <svg width="100%" viewBox={`${minX - pad} ${minY - pad} ${vbW} ${vbH}`}
           style={{ display: 'block', overflow: 'visible' }}>
        {polys}
      </svg>

      {/* day info popup — first tap shows it, tapping the bar again opens the logbook day */}
      {sel && (
        <div style={{ marginTop: 8, background: C.bgDeep, border: `1px solid ${C.gold}`,
                      borderRadius: 12, padding: '12px 14px', position: 'relative',
                      boxShadow: `0 8px 24px -12px rgba(0,0,0,0.6)` }}>
          <button onClick={() => setSel(null)} style={{ position: 'absolute', top: 8, right: 8, width: 20, height: 20,
            borderRadius: 6, border: 'none', background: C.elevated, color: C.muted, cursor: 'pointer',
            display: 'grid', placeItems: 'center', padding: 0, fontFamily: window.IN_MONO, fontSize: 11 }}>✕</button>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
            <span style={{ fontFamily: window.IN_SERIF, fontSize: 16, fontWeight: 600, color: C.text }}>
              {ref.toLocaleString('en-US', { month: 'short' })} {sel.day}</span>
            <span style={{ fontFamily: window.IN_MONO, fontSize: 10, fontWeight: 700, color: C.gold }}>
              {window.fmtH(sel.v)} · {sel.flights.length} flight{sel.flights.length > 1 ? 's' : ''}</span>
          </div>
          {sel.note && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 8, padding: '4px 9px',
              borderRadius: 7, alignSelf: 'flex-start',
              background: sel.hl === 'alltime' ? 'rgba(168,85,247,0.16)' : sel.hl === 'year' ? 'rgba(255,184,48,0.16)' : 'rgba(200,210,222,0.16)',
              border: `1px solid ${sel.hl === 'alltime' ? '#A855F7' : sel.hl === 'year' ? C.gold : '#C8D2DE'}` }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%',
                background: sel.hl === 'alltime' ? '#A855F7' : sel.hl === 'year' ? C.gold : '#C8D2DE',
                boxShadow: sel.hl === 'alltime' ? '0 0 6px #A855F7' : 'none' }}/>
              <span style={{ fontFamily: window.IN_MONO, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.06em',
                color: sel.hl === 'alltime' ? '#C9A6FF' : sel.hl === 'year' ? C.gold : '#C8D2DE' }}>{sel.note}</span>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sel.flights.map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: window.IN_MONO, fontSize: 10, fontWeight: 700, color: accent, width: 44 }}>{f.type}</span>
                <span style={{ flex: 1, fontFamily: window.IN_MONO, fontSize: 10.5, color: C.text2 }}>
                  {f.dep} → {f.arr}</span>
                <span style={{ fontFamily: window.IN_MONO, fontSize: 10, color: C.muted }}>{f.reg}</span>
                <span style={{ fontFamily: window.IN_MONO, fontSize: 10.5, fontWeight: 700, color: C.text, width: 38, textAlign: 'right' }}>{window.fmtH(f.h)}</span>
              </div>
            ))}
          </div>
          <button onClick={() => onOpenDay && onOpenDay(new Date(year, monthIdx, sel.day))}
            style={{ marginTop: 10, width: '100%', padding: '8px', borderRadius: 9, border: `1px solid ${C.border}`,
              background: C.elevated, color: accent, cursor: 'pointer', fontFamily: window.IN_MONO, fontSize: 11,
              fontWeight: 700, letterSpacing: '0.04em', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            Open this day in logbook →
          </button>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 6 }}>
        <span style={{ fontFamily: window.IN_MONO, fontSize: 8.5, color: C.muted, letterSpacing: '0.06em' }}>Tap bar for insights</span>
      </div>
    </div>
  );
}

// ── Journey chart — cumulative hours (Y) over time (X), + future projection ──
function JourneyChart({ accent, goal, rate, series }) {
  const C = window.IN_C;
  const on = useMounted();
  const J = series || window.IN_DATA.journey;
  const now = J[J.length - 1];
  // projection from now at `rate`/month until it reaches goal
  let proj = [];
  if (goal && goal > now.cum && rate > 0) {
    let cum = now.cum; const d = new Date(now.date); let guard = 0;
    proj.push({ date: new Date(d), cum });
    while (cum < goal && guard++ < 600) { cum += rate; d.setMonth(d.getMonth() + 1); proj.push({ date: new Date(d), cum: Math.min(cum, goal) }); }
  }
  const W = 320, H = 176, padL = 36, padB = 26, padT = 10, padR = 10;
  const t0 = J[0].date.getTime();
  const tEnd = (proj.length ? proj[proj.length - 1].date : now.date).getTime();
  const yMax = (goal && goal > now.cum ? goal : now.cum) * 1.08;
  const x = (date) => padL + ((date.getTime() - t0) / (tEnd - t0 || 1)) * (W - padL - padR);
  const y = (v) => padT + (1 - v / yMax) * (H - padB - padT);
  const line = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'} ${x(p.date).toFixed(1)} ${y(p.cum).toFixed(1)}`).join(' ');
  const actualPath = line(J);
  const projPath = proj.length ? line(proj) : '';
  const area = `${actualPath} L ${x(now.date).toFixed(1)} ${H - padB} L ${x(J[0].date).toFixed(1)} ${H - padB} Z`;

  // Y ticks
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(yMax * f));
  // X ticks: adaptive — show ≤10 year labels. step grows so 11–20 yrs → every
  // 2nd, 21–30 → every 3rd, 31–40 → every 4th, …
  const years = [];
  const y0 = J[0].date.getFullYear(), y1 = new Date(tEnd).getFullYear();
  const span = y1 - y0 + 1;
  const step = Math.max(1, Math.ceil(span / 10));
  for (let yr = y0; yr <= y1; yr++) if ((yr - y0) % step === 0) years.push(new Date(yr, 0, 1));

  return (
    <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id="in-journey" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={accent} stopOpacity="0.28"/>
          <stop offset="100%" stopColor={accent} stopOpacity="0"/>
        </linearGradient>
      </defs>
      {/* gridlines + Y labels */}
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke={C.separator} strokeWidth="1"/>
          <text x={padL - 6} y={y(v) + 3} textAnchor="end" fontFamily={window.IN_MONO} fontSize="8" fill={C.muted}>{v}</text>
        </g>
      ))}
      {/* X year ticks */}
      {years.map((d, i) => (
        x(d) >= padL - 1 && x(d) <= W - padR + 1 ? (
          <text key={i} x={x(d)} y={H - 8} textAnchor="middle" fontFamily={window.IN_MONO} fontSize="8" fontWeight="700" fill={C.faint}>{d.getFullYear()}</text>
        ) : null
      ))}
      {/* projection (dashed) */}
      {projPath && <path d={projPath} fill="none" stroke={C.gold} strokeWidth="2" strokeLinecap="round"
        strokeDasharray="4 4" opacity={on ? 0.95 : 0} style={{ transition: 'opacity .6s ease .4s' }}/>}
      {/* goal line + marker */}
      {goal && goal > now.cum && (
        <g opacity={on ? 1 : 0} style={{ transition: 'opacity .5s ease .5s' }}>
          <line x1={padL} y1={y(goal)} x2={W - padR} y2={y(goal)} stroke={C.gold} strokeWidth="1" strokeDasharray="2 3" opacity="0.5"/>
          <circle cx={x(proj[proj.length - 1].date)} cy={y(goal)} r="4" fill={C.gold}/>
        </g>
      )}
      {/* actual area + line */}
      <path d={area} fill="url(#in-journey)" opacity={on ? 1 : 0} style={{ transition: 'opacity .8s ease .3s' }}/>
      <path d={actualPath} fill="none" stroke={accent} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"
        strokeDasharray="1400" strokeDashoffset={on ? 0 : 1400} style={{ transition: 'stroke-dashoffset 1.3s ease' }}/>
      {/* now marker */}
      <circle cx={x(now.date)} cy={y(now.cum)} r="4.5" fill={accent} stroke={C.card} strokeWidth="2"
        opacity={on ? 1 : 0} style={{ transition: 'opacity .5s ease 1s' }}/>
    </svg>
  );
}

// ── 14-day rolling load wrapper — switches with the monthly chart ────────────
function RollingLoad({ accent, viz = 'bars', onView }) {
  const C = window.IN_C;
  const { cur, yearAvg14 } = window.IN_DATA.load;
  const thisPeriod = cur.reduce((s, h) => s + h, 0);
  const popPct = yearAvg14 > 0 ? Math.round(((thisPeriod - yearAvg14) / yearAvg14) * 100) : 0;
  const up = popPct >= 0;
  return (
    <div style={{ position: 'relative', paddingTop: 6 }}>
      {viz === 'bars' && <LoadBars accent={accent} onView={onView}/>}
      {viz === 'line' && <LoadLine accent={accent}/>}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 8 }}>
        {viz === 'bars' && (
          <>
            <span style={{ fontFamily: window.IN_MONO, fontSize: 8.5, color: C.muted, letterSpacing: '0.06em' }}>← Swipe to scroll back</span>
            <span style={{ width: 1, height: 11, background: C.border }}/>
          </>
        )}
        <span style={{ fontFamily: window.IN_FONT, fontSize: 11, color: C.muted }}>
          <span style={{ color: up ? C.success : C.warning, fontWeight: 700, fontFamily: window.IN_MONO }}>
            {up ? '+' : ''}{popPct}%
          </span> {up ? 'over' : 'under'} annual baseline
        </span>
      </div>
    </div>
  );
}

Object.assign(window, { MonthlyBars, MonthlyLine, MonthlyHeatmap, RollingLoad, LoadBars, LoadLine, LoadMonthHeatmap, monthDailyHours, JourneyChart, monthlyBaseline, isoWeek });
