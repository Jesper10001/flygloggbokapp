// Insights sections — composed from charts + primitives.

const { useState: useStateS } = React;

// ── 1. Hero totals ───────────────────────────────────────────────────────────
function HeroTotals({ accent }) {
  const C = window.IN_C, D = window.IN_DATA;
  const { useState } = React;
  const curAbs = D.curYear * 12 + D.curMonthIdx;
  const [open, setOpen] = useState(false);
  const [range, setRange] = useState(null);          // {s, e} absolute months
  const [dS, setDS] = useState(curAbs - 11);
  const [dE, setDE] = useState(curAbs);

  const monthTotal = (absM) => {
    const y = Math.floor(absM / 12), m = ((absM % 12) + 12) % 12;
    if (y === D.curYear) return D.monthly.cur[m] || 0;
    if (y === D.curYear - 1) return D.monthly.prev[m] || 0;
    return window.monthDailyHours(y, m).reduce((s, h) => s + h, 0);
  };
  const rangeHours = (s, e) => { let t = 0; for (let a = s; a <= e; a++) t += monthTotal(a); return t; };
  const fmtAbs = (absM) => { const y = Math.floor(absM / 12), m = ((absM % 12) + 12) % 12; return `${window.MONTH_FULL[m].slice(0, 3)} '${String(y).slice(2)}`; };

  const showRange = !!range;
  const ytdLabel = showRange ? `${fmtAbs(range.s)} – ${fmtAbs(range.e)}` : 'This year';
  const ytdVal = showRange ? rangeHours(range.s, range.e) : D.ytd;

  const Stepper = ({ label, val, set, min, max }) => (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontFamily: window.IN_MONO, fontSize: 9, fontWeight: 700, letterSpacing: '0.12em',
        textTransform: 'uppercase', color: C.muted, width: 34 }}>{label}</span>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: C.bgDeep, border: `1px solid ${C.border}`, borderRadius: 9, padding: '5px 6px' }}>
        <button onClick={() => set(Math.max(min, val - 1))} style={{ width: 26, height: 26, borderRadius: 6,
          border: 'none', background: C.elevated, color: C.text2, cursor: 'pointer', fontFamily: window.IN_MONO,
          fontSize: 13, fontWeight: 700, display: 'grid', placeItems: 'center' }}>‹</button>
        <span style={{ fontFamily: window.IN_MONO, fontSize: 12.5, fontWeight: 700, color: C.text,
          fontVariantNumeric: 'tabular-nums' }}>{fmtAbs(val)}</span>
        <button onClick={() => set(Math.min(max, val + 1))} style={{ width: 26, height: 26, borderRadius: 6,
          border: 'none', background: C.elevated, color: C.text2, cursor: 'pointer', fontFamily: window.IN_MONO,
          fontSize: 13, fontWeight: 700, display: 'grid', placeItems: 'center' }}>›</button>
      </div>
    </div>
  );

  return (
    <window.Card pad={0} style={{ overflow: 'hidden' }}>
      {/* total + this-year/range */}
      <div style={{ display: 'flex', position: 'relative' }}>
        <div style={{ flex: 1, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
          <span style={{ fontFamily: window.IN_MONO, fontSize: 9, fontWeight: 700, letterSpacing: '0.14em',
            textTransform: 'uppercase', color: C.muted }}>Total flight time</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontFamily: window.IN_SERIF, fontWeight: 500, fontSize: 32, lineHeight: 0.9,
              letterSpacing: '-0.03em', color: C.text, fontVariantNumeric: 'tabular-nums' }}>{window.fmtInt(D.total)}</span>
            <span style={{ fontFamily: window.IN_MONO, fontSize: 11, fontWeight: 700, color: accent }}>h</span>
          </div>
        </div>
        <div onClick={showRange ? () => setRange(null) : undefined} style={{ flex: 1, padding: '12px 14px', display: 'flex',
          flexDirection: 'column', gap: 3, borderLeft: `1px solid ${C.separator}`, alignItems: 'flex-end',
          cursor: showRange ? 'pointer' : 'default' }}>
          <span style={{ fontFamily: window.IN_MONO, fontSize: 9, fontWeight: 700, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: showRange ? accent : C.muted, whiteSpace: 'nowrap' }}>
            {ytdLabel}{showRange ? ' ✕' : ''}</span>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontFamily: window.IN_SERIF, fontWeight: 500, fontSize: 24, lineHeight: 0.9,
              letterSpacing: '-0.03em', color: C.text2, fontVariantNumeric: 'tabular-nums' }}>{window.fmtInt(ytdVal)}</span>
            <span style={{ fontFamily: window.IN_MONO, fontSize: 11, fontWeight: 700, color: C.muted }}>h</span>
          </div>
        </div>
      </div>
      {/* 3 / 6 / 12 + range */}
      <div style={{ display: 'flex', borderTop: `1px solid ${C.separator}` }}>
        {[{ l: '3 mo', v: window.fmtInt(D.m3) + 'h' }, { l: '6 mo', v: window.fmtInt(D.m6) + 'h' }, { l: '12 mo', v: window.fmtInt(D.m12) + 'h' }].map((s, i) => (
          <div key={i} style={{ flex: 1, padding: '9px 8px', display: 'flex', flexDirection: 'column', gap: 2,
            alignItems: 'center', borderLeft: i ? `1px solid ${C.separator}` : 'none' }}>
            <span style={{ fontFamily: window.IN_MONO, fontWeight: 700, fontSize: 13, color: C.text, fontVariantNumeric: 'tabular-nums' }}>{s.v}</span>
            <span style={{ fontFamily: window.IN_MONO, fontSize: 8, fontWeight: 700, letterSpacing: '0.1em',
              textTransform: 'uppercase', color: C.muted }}>Last {s.l}</span>
          </div>
        ))}
        <div onClick={() => { setOpen((o) => !o); if (range) { setDS(range.s); setDE(range.e); } }}
          style={{ flex: 1, padding: '9px 8px', display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'center',
          borderLeft: `1px solid ${C.separator}`, cursor: 'pointer', background: open ? 'var(--acc-soft)' : 'transparent' }}>
          <span style={{ fontFamily: window.IN_MONO, fontWeight: 700, fontSize: 13, color: accent }}>{open ? 'Close' : 'Pick →'}</span>
          <span style={{ fontFamily: window.IN_MONO, fontSize: 8, fontWeight: 700, letterSpacing: '0.1em',
            textTransform: 'uppercase', color: C.muted }}>Range</span>
        </div>
      </div>
      {/* range picker */}
      {open && (
        <div style={{ borderTop: `1px solid ${C.separator}`, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8,
          background: C.bgDeep }}>
          <Stepper label="From" val={dS} set={(x) => setDS(Math.min(x, dE))} min={curAbs - 120} max={dE}/>
          <Stepper label="To" val={dE} set={(x) => setDE(Math.max(x, dS))} min={dS} max={curAbs}/>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
            <span style={{ fontFamily: window.IN_MONO, fontSize: 11, fontWeight: 700, color: C.text2 }}>
              = {window.fmtInt(rangeHours(dS, dE))}<span style={{ color: C.muted }}>h</span>
              <span style={{ color: C.muted, fontSize: 9, marginLeft: 6 }}>{dE - dS + 1} mo</span></span>
            <button onClick={() => { setRange({ s: dS, e: dE }); setOpen(false); }} style={{ padding: '8px 16px', borderRadius: 9,
              border: 'none', background: accent, color: C.bgDeep, fontFamily: window.IN_MONO, fontSize: 12, fontWeight: 700,
              cursor: 'pointer' }}>Apply</button>
          </div>
        </div>
      )}
    </window.Card>
  );
}

// ── 2. Activity (monthly + 14-day, combined) ─────────────────────────────────
function ActivitySection({ accent, monthlyViz, setMonthlyViz }) {
  const C = window.IN_C, D = window.IN_DATA;
  const thisMonth = D.monthly.cur[D.curMonthIdx];
  // YoY so far
  const curYtd = D.monthly.cur.slice(0, D.curMonthIdx + 1).reduce((s, h) => s + h, 0);
  const prevYtd = D.monthly.prev.slice(0, D.curMonthIdx + 1).reduce((s, h) => s + h, 0);
  const yoy = prevYtd > 0 ? Math.round(((curYtd - prevYtd) / prevYtd) * 100) : 0;

  const [monthOffset, setMonthOffset] = React.useState(0);
  const [yearShift, setYearShift] = React.useState(0);
  const [barsView, setBarsView] = React.useState({ atPresent: true, curLabel: String(D.curYear) });
  const [loadView, setLoadView] = React.useState(null);
  const activeRef = new Date(D.curYear, D.curMonthIdx + monthOffset, 1);
  const activeYear = activeRef.getFullYear(), activeMonth = activeRef.getMonth();
  const monthName = activeRef
    .toLocaleString('en-US', { month: 'long', year: monthOffset === 0 ? undefined : 'numeric' });

  const VIZ = [['heatmap', 'Heatmap'], ['bars', 'Bars'], ['line', 'Line']];

  return (
    <window.Card>
      {/* monthly header + viz switch */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontFamily: window.IN_MONO, fontSize: 11, fontWeight: 700, letterSpacing: '0.12em',
                       textTransform: 'uppercase', color: C.text2 }}>Hours / month</span>
        <span style={{ fontFamily: window.IN_MONO, fontSize: 10, fontWeight: 700, color: C.success }}>
          {thisMonth.toFixed(0)}h this month</span>
      </div>
      {/* viz segmented */}
      <div style={{ display: 'flex', gap: 3, background: C.elevated, borderRadius: 9, padding: 3, marginBottom: 12 }}>
        {VIZ.map(([k, label]) => {
          const sel = monthlyViz === k;
          return (
            <button key={k} onClick={() => setMonthlyViz(k)} style={{ flex: 1, padding: '6px 0', borderRadius: 7,
              border: 'none', cursor: 'pointer', fontFamily: window.IN_MONO, fontSize: 10.5, fontWeight: 700,
              letterSpacing: '0.04em', background: sel ? accent : 'transparent', color: sel ? C.bgDeep : C.text3 }}>{label}</button>
          );
        })}
      </div>
      {/* legend — previous (grey) left, current (cyan) right; heatmap adds year nav */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        {monthlyViz === 'heatmap' && (
          <button onClick={() => setYearShift((s) => Math.min(8, s + 1))} aria-label="Earlier years"
            style={{ width: 16, height: 16, borderRadius: 5, border: `1px solid ${C.border}`, background: C.elevated,
              color: C.text2, cursor: 'pointer', fontFamily: window.IN_MONO, fontSize: 11, fontWeight: 700,
              display: 'grid', placeItems: 'center', padding: 0, marginRight: 2 }}>‹</button>
        )}
        {!(monthlyViz === 'bars' && !barsView.atPresent) && (
          <>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: C.muted, opacity: 0.6 }}/>
            <span style={{ fontFamily: window.IN_FONT, fontSize: 11, color: C.text3, marginRight: 8 }}>{monthlyViz === 'heatmap' ? D.curYear - yearShift - 1 : D.curYear - 1}</span>
          </>
        )}
        <span style={{ width: 8, height: 8, borderRadius: 4, background: accent }}/>
        <span style={{ fontFamily: window.IN_FONT, fontSize: 11, color: C.text3 }}>{monthlyViz === 'bars' ? barsView.curLabel : monthlyViz === 'heatmap' ? D.curYear - yearShift : D.curYear}</span>
        {monthlyViz === 'heatmap' && yearShift > 0 && (
          <button onClick={() => setYearShift((s) => Math.max(0, s - 1))} aria-label="Later years"
            style={{ width: 16, height: 16, borderRadius: 5, border: `1px solid ${C.border}`, background: C.elevated,
              color: C.text2, cursor: 'pointer', fontFamily: window.IN_MONO, fontSize: 11, fontWeight: 700,
              display: 'grid', placeItems: 'center', padding: 0, marginLeft: 4 }}>›</button>
        )}
      </div>
      {monthlyViz === 'bars' && <window.MonthlyBars accent={accent} onView={setBarsView}/>}
      {monthlyViz === 'line' && <window.MonthlyLine accent={accent}/>}
      {monthlyViz === 'heatmap' && <window.MonthlyHeatmap accent={accent} activeYear={activeYear} activeMonth={activeMonth} yearShift={yearShift}
        onPickMonth={(year, m) => { const off = (year - D.curYear) * 12 + (m - D.curMonthIdx); if (off <= 0) setMonthOffset(off); }}/>}
      {monthlyViz !== 'heatmap' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 8 }}>
          {monthlyViz === 'bars' && (
            <>
              <span style={{ fontFamily: window.IN_MONO, fontSize: 8.5, color: C.muted, letterSpacing: '0.06em' }}>← Swipe to scroll back</span>
              {prevYtd > 0 && <span style={{ width: 1, height: 11, background: C.border }}/>}
            </>
          )}
          {prevYtd > 0 && (
            <span style={{ fontFamily: window.IN_FONT, fontSize: 11, color: C.muted }}>
              <span style={{ color: yoy >= 0 ? C.success : C.warning, fontWeight: 700, fontFamily: window.IN_MONO }}>
                {yoy >= 0 ? '+' : ''}{yoy}%</span> vs same period last year
            </span>
          )}
        </div>
      )}

      {/* divider → 14-day load / month projection */}
      <div style={{ height: 1, background: C.separator, margin: '16px 0 14px' }}/>
      {monthlyViz === 'heatmap' ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={() => setMonthOffset((o) => o - 1)} style={{ width: 30, height: 30, borderRadius: 8,
                background: C.elevated, border: `1px solid ${C.border}`, color: C.text2, cursor: 'pointer',
                display: 'grid', placeItems: 'center', transform: 'rotate(180deg)' }}><window.IIcon name="chevron" size={15}/></button>
              <span style={{ fontFamily: window.IN_MONO, fontSize: 12, fontWeight: 700, letterSpacing: '0.14em',
                             textTransform: 'uppercase', color: C.text2 }}>{monthName}</span>
            </div>
            {monthOffset < 0 && (
              <button onClick={() => setMonthOffset((o) => Math.min(0, o + 1))} style={{ width: 30, height: 30, borderRadius: 8,
                background: C.elevated, border: `1px solid ${C.border}`, color: C.text2, cursor: 'pointer',
                display: 'grid', placeItems: 'center' }}><window.IIcon name="chevron" size={15}/></button>
            )}
          </div>
          <window.LoadMonthHeatmap accent={accent} monthOffset={monthOffset}
            onOpenDay={(d) => { if (window.__openLogbookDay) window.__openLogbookDay(d); }}/>
        </>
      ) : (
        <>
          {(() => {
            const iw = window.isoWeek;
            const today = new Date(D.curYear, D.curMonthIdx, D.today);
            const ms = 86400000;
            const fmtDM = (d) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
            const defCur = `${fmtDM(new Date(today - 13 * ms))}–${fmtDM(today)}`;
            const defPrev = `${fmtDM(new Date(today - 27 * ms))}–${fmtDM(new Date(today - 14 * ms))}`;
            const cv = loadView || { atPresent: true, curLabel: defCur, prevLabel: defPrev, sum: D.load.cur.reduce((s, h) => s + h, 0) };
            return (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2, flexWrap: 'wrap' }}>
                {cv.atPresent && (
                  <>
                    <span style={{ width: 8, height: 8, borderRadius: 4, background: C.muted, opacity: 0.6 }}/>
                    <span style={{ fontFamily: window.IN_FONT, fontSize: 11, color: C.text3, marginRight: 8 }}>{cv.prevLabel}</span>
                  </>
                )}
                <span style={{ width: 8, height: 8, borderRadius: 4, background: accent }}/>
                <span style={{ fontFamily: window.IN_FONT, fontSize: 11, color: C.text3 }}>{cv.curLabel}</span>
                <span style={{ flex: 1 }}/>
                <span style={{ fontFamily: window.IN_MONO, fontSize: 10, fontWeight: 700, color: C.success }}>
                  {cv.sum.toFixed(1)}h this period</span>
              </div>
            );
          })()}
          <window.RollingLoad accent={accent} viz={monthlyViz} onView={setLoadView}/>
        </>
      )}
    </window.Card>
  );
}

// ── 3. Goal journey — cumulative hours over time, with future projection ─────
function GoalCard({ accent }) {
  const C = window.IN_C, D = window.IN_DATA;
  const [metric, setMetric] = useStateS('total');
  const series = metric === 'pic' ? D.journeyPic : D.journey;
  const rate = metric === 'pic' ? D.rates.pic : D.rates.total;
  const now = series[series.length - 1].cum;
  const base = Math.floor(now / 500) * 500;
  const presets = [base + 500, base + 1000];
  const [goal, setGoal] = useStateS(null); // number = single projection, null = history
  const [customMode, setCustomMode] = useStateS(false);
  const CAT_LABELS = { total: 'Total', pic: 'PIC', ifr: 'IFR', nvg: 'NVG', 'vfr+night': 'VFR-Night', multi_pilot: 'Multi-pilot', 'pic+ifr': 'PIC + IFR', 'pic+nvg': 'PIC + NVG', 'pic+night': 'PIC + Night',
    co_pilot: 'Co-pilot', dual: 'Dual', picus: 'PICUS', night: 'Night', xc: 'Cross-country', instructor: 'Instructor', sim: 'Sim' };
  const CAT_KEYS = ['total', 'pic', 'ifr', 'nvg', 'vfr+night', 'multi_pilot', 'pic+ifr', 'pic+nvg', 'pic+night'];
  // every other flight-time category present in the logbook
  const OTHER_KEYS = ['co_pilot', 'dual', 'picus', 'night', 'xc', 'instructor', 'sim'];
  const [cats, setCats] = useStateS([{ key: 'total', hours: base + 1000 }]);
  const [pickKey, setPickKey] = useStateS('pic');
  const [pickOther, setPickOther] = useStateS('co_pilot');
  const [pickHours, setPickHours] = useStateS('');

  const goalNum = (!customMode && typeof goal === 'number') ? goal : null;
  const remaining = goalNum ? Math.max(0, goalNum - now) : 0;
  const fc = goalNum ? window.forecast(remaining, rate) : null;

  const usedKeys = cats.map((c) => c.key);
  const effectiveKey = () => (pickKey === 'other' ? pickOther : pickKey);
  const addCat = () => {
    const h = parseInt(pickHours, 10);
    const key = effectiveKey();
    if (!h || h <= 0 || usedKeys.includes(key)) return;
    setCats([...cats, { key, hours: h }]);
    setPickHours('');
    const free = CAT_KEYS.find((k) => !usedKeys.includes(k) && k !== key);
    if (free) setPickKey(free);
  };
  const customLic = { code: 'Custom goal', ref: 'Your target', reqs: cats.filter((c) => c.hours > 0).map((c) => ({ label: CAT_LABELS[c.key], key: c.key, req: c.hours })) };

  return (
    <window.Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 4 }}>
        <span style={{ color: accent, display: 'flex' }}><window.IIcon name="route" size={17}/></span>
        <span style={{ flex: 1, fontFamily: window.IN_SERIF, fontSize: 18, fontWeight: 500, color: C.text }}>
          Experience &amp; projections</span>
        <span style={{ fontFamily: window.IN_MONO, fontSize: 10, fontWeight: 700, color: accent }}>{Math.round(now)}h</span>
      </div>

      {!customMode && (
        <>
          {/* total / PIC metric toggle */}
          <div style={{ display: 'flex', gap: 3, background: C.elevated, borderRadius: 9, padding: 3, margin: '8px 0 10px' }}>
            {[['total', 'Total time'], ['pic', 'PIC time']].map(([k, label]) => {
              const sel = metric === k;
              return (
                <button key={k} onClick={() => { setMetric(k); setGoal(null); }} style={{ flex: 1, padding: '6px 0', borderRadius: 7,
                  border: 'none', cursor: 'pointer', fontFamily: window.IN_MONO, fontSize: 10.5, fontWeight: 700,
                  letterSpacing: '0.04em', background: sel ? accent : 'transparent', color: sel ? C.bgDeep : C.text3 }}>{label}</button>
              );
            })}
          </div>
          <div style={{ fontFamily: window.IN_MONO, fontSize: 9.5, color: C.muted, letterSpacing: '0.04em', marginBottom: 6 }}>
            Cumulative {metric === 'pic' ? 'PIC' : 'flight'} time · hours over time
          </div>
          <window.JourneyChart accent={accent} goal={goalNum} rate={rate} series={series}/>
          {fc && (
            <div style={{ textAlign: 'center', margin: '4px 0 12px' }}>
              <div style={{ fontFamily: window.IN_MONO, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.14em',
                textTransform: 'uppercase', color: C.muted }}>{window.fmtInt(goalNum)}h {metric === 'pic' ? 'PIC' : 'total'} projected</div>
              <div style={{ fontFamily: window.IN_SERIF, fontSize: 24, fontWeight: 600, color: C.gold, letterSpacing: '-0.02em', marginTop: 2 }}>
                {fc.label}</div>
              <div style={{ fontFamily: window.IN_MONO, fontSize: 10, color: C.muted, marginTop: 2 }}>
                {window.fmtInt(remaining)}h to go · {fc.months} mo at {rate}h/mo</div>
            </div>
          )}
        </>
      )}

      {customMode && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontFamily: window.IN_MONO, fontSize: 9.5, color: C.muted, letterSpacing: '0.04em', marginBottom: 8 }}>
            Multi-category target · e.g. a job's hour requirements
          </div>
          {/* current targets */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {cats.map((c, i) => (
              <span key={c.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 8px',
                borderRadius: 8, background: 'var(--acc-soft)', border: `1px solid var(--acc-line)` }}>
                <span style={{ fontFamily: window.IN_MONO, fontSize: 10.5, fontWeight: 700, color: accent }}>{CAT_LABELS[c.key]} {window.fmtInt(c.hours)}h</span>
                <span onClick={() => setCats(cats.filter((_, j) => j !== i))} style={{ cursor: 'pointer', color: C.muted, fontFamily: window.IN_MONO, fontSize: 11 }}>✕</span>
              </span>
            ))}
            {cats.length === 0 && <span style={{ fontFamily: window.IN_MONO, fontSize: 10, color: C.faint }}>Add a category below.</span>}
          </div>
          {/* add row */}
          {usedKeys.length < (CAT_KEYS.length + OTHER_KEYS.length) && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
              <select value={pickKey} onChange={(e) => setPickKey(e.target.value)} style={{ flex: 1, minWidth: 100, padding: '9px 10px',
                borderRadius: 9, background: C.elevated, border: `1px solid ${C.border}`, color: C.text,
                fontFamily: window.IN_MONO, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
                {CAT_KEYS.filter((k) => !usedKeys.includes(k)).map((k) => <option key={k} value={k}>{CAT_LABELS[k]}</option>)}
                <option value="other">Other…</option>
              </select>
              {pickKey === 'other' && (
                <select value={pickOther} onChange={(e) => setPickOther(e.target.value)} style={{ flex: 1, minWidth: 100, padding: '9px 10px',
                  borderRadius: 9, background: C.elevated, border: `1px solid var(--acc-line)`, color: C.text,
                  fontFamily: window.IN_MONO, fontSize: 11.5, fontWeight: 700, cursor: 'pointer' }}>
                  {OTHER_KEYS.filter((k) => !usedKeys.includes(k)).map((k) => <option key={k} value={k}>{CAT_LABELS[k]}</option>)}
                </select>
              )}
              <input value={pickHours} onChange={(e) => setPickHours(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="hours"
                style={{ width: 70, padding: '9px 10px', borderRadius: 9, background: C.elevated, border: `1px solid ${C.border}`,
                  color: C.text, fontFamily: window.IN_MONO, fontSize: 11.5, fontWeight: 700, outline: 'none' }}/>
              <button onClick={addCat} style={{ padding: '9px 12px', borderRadius: 9, border: 'none', cursor: 'pointer',
                background: accent, color: C.bgDeep, fontFamily: window.IN_MONO, fontSize: 11.5, fontWeight: 700 }}>Add</button>
            </div>
          )}
          {/* multi-category projection chart */}
          {customLic.reqs.length > 0
            ? <LicenceChart lic={customLic} accent={accent}/>
            : <div style={{ fontFamily: window.IN_MONO, fontSize: 10, color: C.faint, textAlign: 'center', padding: '20px 0' }}>Add at least one category to see the projection.</div>}
        </div>
      )}

      {/* expand-to-future buttons */}
      <div style={{ fontFamily: window.IN_MONO, fontSize: 9, fontWeight: 700, letterSpacing: '0.14em',
        textTransform: 'uppercase', color: C.muted, margin: '14px 0 7px' }}>Project forward to</div>
      <div style={{ display: 'flex', gap: 6 }}>
        {presets.map((p) => {
          const sel = !customMode && goal === p;
          return (
            <button key={p} onClick={() => { setCustomMode(false); setGoal(sel ? null : p); }} style={{ flex: 1, padding: '9px 0', borderRadius: 9,
              border: `1px solid ${sel ? accent : C.border}`, cursor: 'pointer', background: sel ? accent : C.elevated,
              color: sel ? C.bgDeep : C.text2, fontFamily: window.IN_MONO, fontSize: 12.5, fontWeight: 700 }}>
              {window.fmtInt(p)}h</button>
          );
        })}
        <button onClick={() => { setCustomMode((v) => !v); setGoal(null); }} style={{ flex: 1, padding: '9px 0', borderRadius: 9,
          border: `1px solid ${customMode ? accent : C.border}`, cursor: 'pointer',
          background: customMode ? accent : C.elevated, color: customMode ? C.bgDeep : C.text3,
          fontFamily: window.IN_MONO, fontSize: 12.5, fontWeight: 700 }}>Custom</button>
      </div>
    </window.Card>
  );
}

// ── 4. Licence journey (next licence big, others collapsed) ──────────────────
function ReqRow({ r, accent }) {
  const C = window.IN_C;
  const have = window.IN_DATA.haveFor(r.key);
  const met = have >= r.req;
  const pct = Math.min(100, (have / r.req) * 100);
  const rate = window.IN_DATA.rates[r.key] ?? 0;
  const fc = met ? null : window.forecast(r.req - have, rate);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span style={{ fontFamily: window.IN_FONT, fontSize: 12.5, color: C.text, fontWeight: 500 }}>{r.label}</span>
        <span style={{ fontFamily: window.IN_MONO, fontSize: 11, fontWeight: 700, color: met ? C.success : C.text }}>
          {Math.round(have)}<span style={{ color: C.muted, fontWeight: 400 }}>/{r.req}h</span></span>
      </div>
      <window.ProgressBar pct={pct} h={6} color={met ? C.success : pct > 70 ? accent : C.warning}/>
      {!met && fc && (
        <span style={{ fontFamily: window.IN_MONO, fontSize: 9, color: C.muted }}>
          📅 {fc.label} · {rate.toFixed(0)}h/mo</span>
      )}
    </div>
  );
}

const REQ_COLORS = ['#00C8E8', '#FFB830', '#00E8A0', '#9B8CFF', '#5DA9FF', '#FF6B5B'];

// Licence chart — one curve per requirement over time; circles at projected
// completion, horizontal completion lines + dates for met requirements.
function LicenceChart({ lic, accent }) {
  const C = window.IN_C;
  const on = window.useInMount ? window.useInMount() : true;
  const J = window.IN_DATA.journey;
  const careerStart = J[0].date, now = J[J.length - 1].date;
  const mBetween = (a, b) => (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth()) + (b.getDate() - a.getDate()) / 30;
  const addM = (d, m) => { const x = new Date(d); x.setMonth(x.getMonth() + Math.round(m)); return x; };
  const fmtD = (d) => d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });
  const careerMonths = Math.max(1, mBetween(careerStart, now));

  const reqs = lic.reqs.map((r, i) => {
    const have = window.IN_DATA.haveFor(r.key);
    if (have <= 0) return null;                       // 0h → not plottable
    const met = have >= r.req;
    const slopeHist = have / careerMonths;
    const rate = window.IN_DATA.rateFor(r.key) || slopeHist || 1;
    const completion = met ? addM(careerStart, r.req / (slopeHist || 1)) : addM(now, (r.req - have) / rate);
    return { ...r, have, met, completion, color: REQ_COLORS[i % REQ_COLORS.length], normNow: have / r.req };
  }).filter(Boolean);

  const futureMax = reqs.reduce((mx, r) => (r.completion > mx ? r.completion : mx), now);
  const t0 = careerStart.getTime(), t1 = futureMax.getTime();
  const W = 320, H = 188, padL = 8, padR = 8, padT = 14, padB = 30;
  const yMaxPct = 1.25;
  const x = (date) => padL + ((date.getTime() - t0) / (t1 - t0 || 1)) * (W - padL - padR);
  const y = (pct) => padT + (1 - Math.min(pct, yMaxPct) / yMaxPct) * (H - padT - padB);
  const y100 = y(1);

  // year ticks (adaptive ≤8)
  const years = [];
  const yr0 = careerStart.getFullYear(), yr1 = futureMax.getFullYear();
  const step = Math.max(1, Math.ceil((yr1 - yr0 + 1) / 8));
  for (let yr = yr0; yr <= yr1; yr++) if ((yr - yr0) % step === 0) years.push(new Date(yr, 0, 1));

  return (
    <div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block', overflow: 'visible' }}>
        {/* 100% target line */}
        <line x1={padL} y1={y100} x2={W - padR} y2={y100} stroke={C.gold} strokeWidth="1" strokeDasharray="3 3" opacity="0.55"/>
        <text x={padL} y={y100 - 4} textAnchor="start" fontFamily={window.IN_MONO} fontSize="7.5" fontWeight="700" fill={C.gold}>TARGET 100%</text>
        {/* year ticks */}
        {years.map((d, i) => (
          <g key={i}>
            <line x1={x(d)} y1={padT} x2={x(d)} y2={H - padB} stroke={C.separator} strokeWidth="1"/>
            <text x={x(d)} y={H - padB + 12} textAnchor="middle" fontFamily={window.IN_MONO} fontSize="8" fontWeight="700" fill={C.faint}>{d.getFullYear()}</text>
          </g>
        ))}
        {/* "now" marker */}
        <line x1={x(now)} y1={padT} x2={x(now)} y2={H - padB} stroke={C.text3} strokeWidth="1" strokeDasharray="1 3" opacity="0.5"/>
        <text x={x(now)} y={padT - 4} textAnchor="middle" fontFamily={window.IN_MONO} fontSize="7" fontWeight="700" fill={C.text3}>NOW</text>

        {reqs.map((r, i) => {
          // met curves stop at the moment they reach 100% (the completion point);
          // unmet curves run to "now" then dash-project to the target.
          const histPath = r.met
            ? `M ${x(careerStart)} ${y(0)} L ${x(r.completion)} ${y100}`
            : `M ${x(careerStart)} ${y(0)} L ${x(now)} ${y(r.normNow)}`;
          const projPath = !r.met ? `M ${x(now)} ${y(r.normNow)} L ${x(r.completion)} ${y100}` : '';
          return (
            <g key={i}>
              {/* historical curve */}
              <path d={histPath} fill="none" stroke={r.color} strokeWidth="2" strokeLinecap="round"/>
              {/* projection (dashed) for unmet */}
              {projPath && <path d={projPath} fill="none" stroke={r.color} strokeWidth="1.6" strokeDasharray="3 3" opacity="0.85"/>}
              {/* completion circle on the target line */}
              <circle cx={x(r.completion)} cy={y100} r="4.5" fill={r.met ? r.color : C.bgDeep} stroke={r.color} strokeWidth="2"/>
            </g>
          );
        })}
      </svg>

      {/* legend with per-requirement completion dates */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
        {reqs.map((r, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0,
              background: r.met ? r.color : C.bgDeep, border: `2px solid ${r.color}` }}/>
            <span style={{ flex: 1, fontFamily: window.IN_FONT, fontSize: 12, color: C.text2 }}>{r.label}</span>
            <span style={{ fontFamily: window.IN_MONO, fontSize: 10, fontWeight: 700, color: C.text, minWidth: 64, textAlign: 'right' }}>
              {Math.round(r.have)}<span style={{ color: C.muted, fontWeight: 400 }}>/{r.req}h</span></span>
            <span style={{ fontFamily: window.IN_MONO, fontSize: 10, fontWeight: 700, color: r.met ? C.success : C.muted, minWidth: 62, textAlign: 'right' }}>
              {r.met ? `✓ ${fmtD(r.completion)}` : `→ ${fmtD(r.completion)}`}</span>
          </div>
        ))}
        {lic.reqs.some((r) => window.IN_DATA.haveFor(r.key) <= 0) && (
          <div style={{ fontFamily: window.IN_MONO, fontSize: 9, color: C.faint, marginTop: 2 }}>
            Requirements with 0 h logged aren't plotted yet.
          </div>
        )}
      </div>
    </div>
  );
}

function LicenceCardFull({ lic, accent, chart, onToggleChart }) {
  const C = window.IN_C;
  const met = lic.reqs.filter((r) => window.IN_DATA.haveFor(r.key) >= r.req).length;
  const overall = Math.round(lic.reqs.reduce((s, r) => s + Math.min(1, window.IN_DATA.haveFor(r.key) / r.req), 0) / lic.reqs.length * 100);
  return (
    <window.Card style={{ borderColor: 'var(--acc-line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span style={{ fontFamily: window.IN_MONO, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.16em',
                       textTransform: 'uppercase', color: accent }}>Next licence</span>
        <button onClick={onToggleChart} style={{ display: 'flex', alignItems: 'center', gap: 4,
          padding: '4px 9px', borderRadius: 7, border: `1px solid ${chart ? accent : C.border}`,
          background: chart ? 'var(--acc-soft)' : C.elevated, color: chart ? accent : C.text3, cursor: 'pointer',
          fontFamily: window.IN_MONO, fontSize: 9, fontWeight: 700, letterSpacing: '0.08em' }}>
          <window.IIcon name={chart ? 'list' : 'insights'} size={12}/>{chart ? 'List' : 'Chart'}
        </button>
        <span style={{ flex: 1 }}/>
        <span style={{ fontFamily: window.IN_MONO, fontSize: 10, fontWeight: 700, color: C.muted }}>{met}/{lic.reqs.length} met</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
        <span style={{ fontFamily: window.IN_SERIF, fontSize: 30, fontWeight: 500, color: C.text, letterSpacing: '-0.02em' }}>{lic.code}</span>
        <span style={{ fontFamily: window.IN_MONO, fontSize: 10, color: C.muted }}>{lic.ref}</span>
        <span style={{ flex: 1 }}/>
        <span style={{ fontFamily: window.IN_SERIF, fontSize: 26, fontWeight: 600, color: accent }}>{overall}%</span>
      </div>
      {chart ? (
        <LicenceChart lic={lic} accent={accent}/>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          {lic.reqs.map((r, i) => <ReqRow key={i} r={r} accent={accent}/>)}
        </div>
      )}
    </window.Card>
  );
}

function LicenceCollapsed({ lic }) {
  const C = window.IN_C;
  return (
    <window.Card pad={14} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 34, height: 34, borderRadius: 9, flexShrink: 0, background: 'rgba(0,232,160,0.12)',
                    border: '1px solid rgba(0,232,160,0.4)', display: 'grid', placeItems: 'center', color: C.success }}>
        <window.IIcon name="check" size={17}/>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: window.IN_FONT, fontSize: 14, fontWeight: 600, color: C.text }}>{lic.code}</div>
        <div style={{ fontFamily: window.IN_MONO, fontSize: 10, color: C.muted, marginTop: 1 }}>{lic.ref}</div>
      </div>
      <window.Pill tone="success">✓ COMPLETE</window.Pill>
    </window.Card>
  );
}

function LicenceJourney({ accent }) {
  const C = window.IN_C;
  const next = window.IN_DATA.licences.find((l) => l.next) || window.IN_DATA.licences[window.IN_DATA.licences.length - 1];
  const done = window.IN_DATA.licences.filter((l) => l.met);
  const [open, setOpen] = useStateS(false);
  const [chart, setChart] = useStateS(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <LicenceCardFull lic={next} accent={accent} chart={chart} onToggleChart={() => setChart((v) => !v)}/>
      <button onClick={() => setOpen((v) => !v)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: 6, padding: '10px', borderRadius: 11, border: `1px solid ${C.border}`, background: C.elevated,
        cursor: 'pointer', color: C.text2, fontFamily: window.IN_FONT, fontSize: 12.5, fontWeight: 600 }}>
        {open ? 'Hide' : 'Show'} completed licences ({done.length})
        <span style={{ display: 'flex', transform: open ? 'rotate(90deg)' : 'rotate(90deg) scaleX(-1)', transition: 'transform .15s' }}>
          <window.IIcon name="chevron" size={14}/></span>
      </button>
      {open && done.map((l) => <LicenceCollapsed key={l.code} lic={l}/>)}
    </div>
  );
}

// ── 5. Hours bank (categories + add-missing rows) ────────────────────────────
function HoursBank({ accent, onMissing }) {
  const C = window.IN_C, D = window.IN_DATA, c = D.cats;
  const M = window.IN_MONO;
  const [bfOpen, setBfOpen] = useStateS(false);
  const [view, setView] = useStateS('grouped');
  const land = D.landings || { day: 0, night: 0 };
  // every flight-time category (flat grid)
  const stats = [
    { label: 'Total', v: D.total }, { label: 'PIC', v: c.pic }, { label: 'PICUS', v: c.picus },
    { label: 'Co-pilot', v: c.co_pilot }, { label: 'Dual', v: c.dual }, { label: 'Instr', v: c.instructor },
    { label: 'Multi-pilot', v: c.multi_pilot }, { label: 'Cross-ctry', v: c.xc }, { label: 'IFR', v: c.ifr },
    { label: 'Night', v: c.night }, { label: 'NVG', v: c.nvg }, { label: 'Sim', v: c.sim },
  ];
  // categorised groups (alternative layout)
  const groups = [
    { title: 'Roles', unit: 'h', items: [
      { label: 'PIC', v: c.pic }, { label: 'Co-pilot', v: c.co_pilot }, { label: 'Dual', v: c.dual }, { label: 'PICUS', v: c.picus } ] },
    { title: 'Special roles', unit: 'h', items: [
      { label: 'Instructor', v: c.instructor }, { label: 'Multi-pilot', v: c.multi_pilot }, { label: 'NVG', v: c.nvg }, { label: 'Sim', v: c.sim } ] },
    { title: 'Rules & conditions', unit: 'h', items: [
      { label: 'IFR', v: c.ifr }, { label: 'Night', v: c.night }, { label: 'Cross-ctry', v: c.xc } ] },
    { title: 'Landings', unit: '', items: [
      { label: 'Total', v: land.day + land.night }, { label: 'Day', v: land.day }, { label: 'Night', v: land.night } ] },
  ];
  // app's guided backfill fix-flows — only categories currently at 0 h
  const missing = [
    { label: 'Dual', key: 'dual', v: c.dual },
    { label: 'Instructor', key: 'instr', v: c.instructor },
    { label: 'NVG', key: 'nvg', v: c.nvg },
  ].filter((m) => m.v === 0);

  return (
    <window.Card pad={0} style={{ overflow: 'hidden' }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px 7px' }}>
        <span style={{ flex: 1, fontFamily: M, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.14em',
          textTransform: 'uppercase', color: C.text2 }}>Hours bank</span>
      </div>

      {/* categorised groups */}
      {groups.map((g, gi) => (
        <div key={g.title} style={{ borderTop: `1px solid ${C.separator}` }}>
          <div style={{ padding: '5px 14px 3px', display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ width: 5, height: 5, borderRadius: '50%', background: accent }}/>
            <span style={{ fontFamily: M, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.14em',
              textTransform: 'uppercase', color: C.text3 }}>{g.title}</span>
          </div>
          <div style={{ display: 'flex', padding: '0 8px 6px' }}>
            {g.items.map((it, i) => (
              <div key={it.label} style={{ flex: 1, padding: '2px 6px', display: 'flex', flexDirection: 'column', gap: 2,
                alignItems: 'flex-start', borderLeft: i ? `1px solid ${C.separator}` : 'none' }}>
                <span style={{ fontFamily: M, fontSize: 8, fontWeight: 700, letterSpacing: '0.04em',
                  textTransform: 'uppercase', color: C.muted, whiteSpace: 'nowrap' }}>{it.label}</span>
                <span style={{ fontFamily: M, fontWeight: 700, fontSize: 15, color: it.v === 0 ? C.faint : C.text,
                  fontVariantNumeric: 'tabular-nums' }}>{window.fmtInt(it.v)}<span style={{ fontSize: 8, color: C.muted }}>{g.unit}</span></span>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* backfill — only for categories at 0 h */}
      {missing.length > 0 && (
        <>
          <div onClick={() => setBfOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8,
            padding: '11px 16px', cursor: 'pointer', borderTop: `1px solid ${C.separator}` }}>
            <span style={{ flex: 1, fontFamily: M, fontSize: 9, fontWeight: 700,
              letterSpacing: '0.14em', textTransform: 'uppercase', color: C.muted }}>Backfill missing hours</span>
            <span style={{ fontFamily: M, fontSize: 9, fontWeight: 700, color: accent }}>{missing.length}</span>
            <span style={{ display: 'flex', color: accent, transform: bfOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>
              <window.IIcon name="chevron" size={14}/></span>
          </div>
          {bfOpen && missing.map((m) => (
            <div key={m.key} onClick={() => onMissing(m.key)} style={{ display: 'flex', alignItems: 'center', gap: 12,
              padding: '11px 16px', cursor: 'pointer', borderTop: `1px solid ${C.separator}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: window.IN_FONT, fontSize: 13.5, fontWeight: 600, color: C.text }}>{m.label} hours</div>
                <div style={{ fontFamily: M, fontSize: 10, color: C.muted, marginTop: 1 }}>None logged — add retroactively</div>
              </div>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: M, fontSize: 11,
                fontWeight: 700, color: accent }}><window.IIcon name="plus" size={13}/> Add</span>
            </div>
          ))}
        </>
      )}
    </window.Card>
  );
}

Object.assign(window, { HeroTotals, ActivitySection, GoalCard, LicenceJourney, HoursBank });
