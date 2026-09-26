// Drone Dashboard — two layout variants (A: editorial stack, B: compact grid).
// Props come from tweaks: { timeFmt, density, showMap, layout }. nav(screen,params) routes.

function HeroTotals({ timeFmt, big }) {
  const D = window.DR_DATA;
  return (
    <window.Card pad={big ? 20 : 16} glow style={{ position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: -50, right: -30, width: 180, height: 180,
                    background: 'radial-gradient(circle, var(--acc-soft), transparent 65%)', pointerEvents: 'none' }}/>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
        <span style={{ fontFamily: window.DR_MONO, fontSize: 10, fontWeight: 700, letterSpacing: '0.16em',
                       textTransform: 'uppercase', color: window.DR_C.text3 }}>Total flight time</span>
        <window.Chip tone="acc"><window.DIcon name="drone" size={11}/> {D.fleet.filter(f=>f.status==='active').length} active</window.Chip>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 10, position: 'relative' }}>
        <span style={{ fontFamily: window.DR_SERIF, fontWeight: 500, fontSize: big ? 64 : 52, lineHeight: 0.85,
                       letterSpacing: '-0.03em', color: window.DR_C.text, fontVariantNumeric: 'tabular-nums' }}>
          {window.fmtTotal(D.totalMin, timeFmt === 'decimal' ? 'decimal' : 'hhmm')}
        </span>
        <span style={{ fontFamily: window.DR_MONO, fontWeight: 700, fontSize: 14, color: 'var(--acc)', letterSpacing: '0.1em' }}>
          {timeFmt === 'decimal' ? 'HRS' : 'H:MM'}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 0, marginTop: 16, position: 'relative' }}>
        {[
          { v: window.fmtTotal(D.ytdMin, 'hhmm'), k: 'This year' },
          { v: window.fmtInt(D.flights), k: 'Flights' },
          { v: window.fmtTotal(D.last30Min, 'hhmm'), k: 'Last 30 d' },
        ].map((s, i) => (
          <div key={i} style={{ flex: 1, paddingLeft: i ? 14 : 0,
                                borderLeft: i ? `1px solid ${window.DR_C.separator}` : 'none' }}>
            <div style={{ fontFamily: window.DR_MONO, fontWeight: 700, fontSize: 16, color: window.DR_C.text,
                          fontVariantNumeric: 'tabular-nums' }}>{s.v}</div>
            <div style={{ fontFamily: window.DR_MONO, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.12em',
                          textTransform: 'uppercase', color: window.DR_C.muted, marginTop: 3 }}>{s.k}</div>
          </div>
        ))}
      </div>
    </window.Card>
  );
}

function CategoryCard() {
  const D = window.DR_DATA;
  const total = D.categories.reduce((s, c) => s + c.count, 0);
  return (
    <window.Card>
      <window.SectionLabel>Category mix</window.SectionLabel>
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <window.Donut segments={D.categories} centerTop={D.categories.length} centerBottom="cats"/>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {D.categories.map((c) => (
            <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: c.color, flexShrink: 0 }}/>
              <span style={{ flex: 1, fontFamily: window.DR_MONO, fontSize: 11, fontWeight: 700, color: window.DR_C.text2 }}>{c.key}</span>
              <span style={{ fontFamily: window.DR_MONO, fontSize: 11, fontWeight: 700, color: window.DR_C.text,
                             fontVariantNumeric: 'tabular-nums' }}>{Math.round(c.count / total * 100)}%</span>
            </div>
          ))}
        </div>
      </div>
    </window.Card>
  );
}

function ModesCard() {
  const D = window.DR_DATA;
  return (
    <window.Card>
      <window.SectionLabel>Flight modes</window.SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
        {D.modes.map((m) => (
          <div key={m.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                <span style={{ color: 'var(--acc)', flexShrink: 0, display: 'flex' }}><window.DIcon name={m.key === 'BVLOS' ? 'signal' : 'eye'} size={13}/></span>
                <span style={{ fontFamily: window.DR_MONO, fontSize: 11.5, fontWeight: 700, color: window.DR_C.text,
                               letterSpacing: '0.04em', flexShrink: 0 }}>{m.key}</span>
                <span style={{ fontFamily: window.DR_FONT, fontSize: 11, color: window.DR_C.muted,
                               whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.count} flt</span>
              </div>
              <span style={{ fontFamily: window.DR_MONO, fontSize: 11, fontWeight: 700, color: 'var(--acc)', flexShrink: 0 }}>{m.pct}%</span>
            </div>
            <window.ProgressBar pct={m.pct} h={5}/>
          </div>
        ))}
      </div>
    </window.Card>
  );
}

function LogbookCard({ nav }) {
  return (
    <window.Card onClick={() => nav('book')} pad={0} style={{ overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 16 }}>
        <div style={{ width: 46, height: 46, borderRadius: 12, flexShrink: 0,
                      background: 'var(--acc-soft)', border: '1px solid var(--acc-line)',
                      display: 'grid', placeItems: 'center', color: 'var(--acc)' }}>
          <window.DIcon name="book" size={22}/>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: window.DR_SERIF, fontSize: 17, fontWeight: 500, color: window.DR_C.text }}>Your logbook</div>
          <div style={{ fontFamily: window.DR_FONT, fontSize: 12.5, color: window.DR_C.text3, marginTop: 1 }}>
            See your flights as a physical EASA spread
          </div>
        </div>
        <window.DIcon name="chevron" size={18}/>
      </div>
    </window.Card>
  );
}

function MapCard({ nav }) {
  const D = window.DR_DATA;
  return (
    <window.Card pad={0} style={{ overflow: 'hidden' }} onClick={() => nav('map')}>
      <div style={{ position: 'relative', height: 132, background: window.DR_C.bgDeep }}>
        {/* stylized location field */}
        <svg width="100%" height="132" viewBox="0 0 345 132" preserveAspectRatio="xMidYMid slice" style={{ display: 'block' }}>
          <defs>
            <radialGradient id="mapglow" cx="50%" cy="40%" r="60%">
              <stop offset="0%" stopColor="var(--acc)" stopOpacity="0.16"/>
              <stop offset="100%" stopColor={window.DR_C.bgDeep} stopOpacity="0"/>
            </radialGradient>
          </defs>
          <rect width="345" height="132" fill="url(#mapglow)"/>
          {[26,52,78,104].map((y) => <line key={y} x1="0" y1={y} x2="345" y2={y} stroke={window.DR_C.border} strokeWidth="0.5" opacity="0.5"/>)}
          {[57,115,173,230,288].map((x) => <line key={x} x1={x} y1="0" x2={x} y2="132" stroke={window.DR_C.border} strokeWidth="0.5" opacity="0.5"/>)}
          {[[60,80],[120,52],[180,70],[240,40],[300,64],[150,96],[210,100],[90,44]].map(([x,y],i) => (
            <g key={i}>
              <circle cx={x} cy={y} r="9" fill="var(--acc)" opacity="0.18"/>
              <circle cx={x} cy={y} r="3.4" fill="var(--acc)"/>
            </g>
          ))}
        </svg>
        <div style={{ position: 'absolute', top: 10, left: 12 }}>
          <window.Chip tone="acc"><window.DIcon name="pin" size={11}/> 48 sites</window.Chip>
        </div>
        <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '20px 14px 12px',
                      background: `linear-gradient(180deg, transparent, ${window.DR_C.bgDeep})`,
                      display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontFamily: window.DR_SERIF, fontSize: 15, fontWeight: 500, color: window.DR_C.text }}>Where you've flown</div>
            <div style={{ fontFamily: window.DR_MONO, fontSize: 9.5, letterSpacing: '0.1em', color: window.DR_C.muted,
                          textTransform: 'uppercase', marginTop: 2 }}>Proposal · GPS per flight</div>
          </div>
          <window.DIcon name="chevron" size={16}/>
        </div>
      </div>
    </window.Card>
  );
}

function RecentList({ nav, timeFmt, limit = 4 }) {
  const D = window.DR_DATA;
  return (
    <div>
      <window.SectionLabel action="All →" onAction={() => nav('log')}>Recent flights</window.SectionLabel>
      <window.Card pad={0} style={{ overflow: 'hidden' }}>
        {D.recent.slice(0, limit).map((f, i) => (
          <div key={i} onClick={() => nav('flight', { flight: f })}
               style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', cursor: 'pointer',
                        borderTop: i ? `1px solid ${window.DR_C.separator}` : 'none' }}>
            <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, background: window.DR_C.elevated,
                          display: 'grid', placeItems: 'center', color: 'var(--acc)' }}>
              <window.DIcon name={f.mission === 'Mapping' || f.mission === 'Survey' ? 'map' : f.mission === 'Film' ? 'camera' : 'route'} size={17}/>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ fontFamily: window.DR_FONT, fontSize: 13.5, fontWeight: 600, color: window.DR_C.text }}>{f.mission}</span>
                <window.Chip tone={f.mode === 'BVLOS' ? 'warn' : 'muted'}>{f.mode}</window.Chip>
              </div>
              <div style={{ fontFamily: window.DR_MONO, fontSize: 10, color: window.DR_C.text3, marginTop: 2,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {f.drone} · {f.place}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontFamily: window.DR_MONO, fontSize: 13, fontWeight: 700, color: window.DR_C.text,
                            fontVariantNumeric: 'tabular-nums' }}>{window.fmtFlight(f.sec, timeFmt === 'hhmm' ? 'hhmm' : 'mmss')}</div>
              <div style={{ fontFamily: window.DR_MONO, fontSize: 9, color: window.DR_C.muted, marginTop: 2 }}>{window.relDate(f.date)}</div>
            </div>
          </div>
        ))}
      </window.Card>
    </div>
  );
}

function ComplianceStrip({ nav }) {
  const D = window.DR_DATA;
  const expiring = D.certs.filter(c => c.status === 'expiring').length;
  return (
    <window.Card onClick={() => nav('compliance')} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0,
                    background: expiring ? 'rgba(255,200,87,0.12)' : 'rgba(63,185,80,0.12)',
                    border: `1px solid ${expiring ? 'rgba(255,200,87,0.4)' : 'rgba(63,185,80,0.4)'}`,
                    display: 'grid', placeItems: 'center', color: expiring ? window.DR_C.warning : window.DR_C.success }}>
        <window.DIcon name="shield" size={18}/>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontFamily: window.DR_FONT, fontSize: 13.5, fontWeight: 600, color: window.DR_C.text }}>Competency &amp; recency</div>
        <div style={{ fontFamily: window.DR_MONO, fontSize: 10, color: expiring ? window.DR_C.warning : window.DR_C.text3, marginTop: 2 }}>
          {expiring ? `${expiring} credential expiring soon` : 'All credentials valid'}
        </div>
      </div>
      <window.DIcon name="chevron" size={18}/>
    </window.Card>
  );
}

// ── compact-grid metric tiles (variant B) ───────────────────────────────────
function MetricTile({ icon, value, label, tone }) {
  return (
    <window.Card pad={13} style={{ flex: 1 }}>
      <div style={{ color: tone || 'var(--acc)', marginBottom: 8 }}><window.DIcon name={icon} size={18}/></div>
      <div style={{ fontFamily: window.DR_SERIF, fontSize: 24, fontWeight: 500, color: window.DR_C.text, lineHeight: 1,
                    fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      <div style={{ fontFamily: window.DR_MONO, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.12em',
                    textTransform: 'uppercase', color: window.DR_C.muted, marginTop: 5 }}>{label}</div>
    </window.Card>
  );
}

function DashboardScreen({ tw, nav }) {
  const timeFmt = tw.timeFmt || 'mmss';
  const density = tw.density || 'cozy';
  const showMap = tw.showMap !== false;
  const layout = tw.dashLayout || 'A';
  const gap = density === 'compact' ? 10 : 14;
  const D = window.DR_DATA;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap, paddingBottom: 8 }}>
      {layout === 'B' ? (
        <>
          {/* compact grid */}
          <div style={{ display: 'flex', gap }}>
            <MetricTile icon="clock" value={window.fmtTotal(D.totalMin, 'hhmm')} label="Total H:MM"/>
            <MetricTile icon="route" value={window.fmtInt(D.flights)} label="Flights"/>
          </div>
          <div style={{ display: 'flex', gap }}>
            <MetricTile icon="signal" value={`${D.modes[2].pct}%`} label="BVLOS" tone={window.DR_C.warning}/>
            <MetricTile icon="drone" value={D.fleet.length} label="Drones"/>
          </div>
          <ComplianceStrip nav={nav}/>
          <div style={{ display: 'flex', gap }}>
            <div style={{ flex: 1 }}><CategoryCard/></div>
          </div>
          <ModesCard/>
          {showMap && <MapCard nav={nav}/>}
          <RecentList nav={nav} timeFmt={timeFmt} limit={4}/>
        </>
      ) : (
        <>
          {/* editorial stack */}
          <HeroTotals timeFmt={timeFmt} big={density !== 'compact'}/>
          <CategoryCard/>
          <ModesCard/>
          {showMap && <MapCard nav={nav}/>}
          <RecentList nav={nav} timeFmt={timeFmt} limit={density === 'compact' ? 3 : 5}/>
        </>
      )}
    </div>
  );
}

Object.assign(window, { DashboardScreen });
