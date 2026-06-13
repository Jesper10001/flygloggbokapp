// Drone Log — two sub-tabs: Flights (month-grouped) and Fleet (drones + batteries).

function SubTabs({ tab, setTab }) {
  const tabs = [['flights', 'Flights'], ['fleet', 'Fleet']];
  return (
    <div style={{ display: 'flex', gap: 4, background: window.DR_C.surface, border: `1px solid ${window.DR_C.border}`,
                  borderRadius: 12, padding: 4, marginBottom: 16 }}>
      {tabs.map(([k, label]) => (
        <button key={k} onClick={() => setTab(k)} style={{
          flex: 1, padding: '9px 0', borderRadius: 9, border: 'none', cursor: 'pointer',
          fontFamily: window.DR_FONT, fontSize: 13, fontWeight: 700, letterSpacing: '-0.1px',
          background: tab === k ? 'var(--acc)' : 'transparent',
          color: tab === k ? window.DR_C.bg : window.DR_C.text3,
        }}>{label}</button>
      ))}
    </div>
  );
}

function FlightsTab({ nav, timeFmt }) {
  const D = window.DR_DATA;
  // group by month label
  const groups = {};
  D.recent.forEach((f) => {
    const m = new Date(f.date + 'T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    (groups[m] = groups[m] || []).push(f);
  });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* summary row */}
      <div style={{ display: 'flex', gap: 10 }}>
        {[
          { v: window.fmtInt(D.flights), k: 'Total flights' },
          { v: window.fmtTotal(D.totalMin, 'hhmm'), k: 'Total time' },
          { v: D.last30Flights, k: 'Last 30 d' },
        ].map((s, i) => (
          <window.Card key={i} pad={12} style={{ flex: 1 }}>
            <div style={{ fontFamily: window.DR_MONO, fontWeight: 700, fontSize: 17, color: i === 0 ? 'var(--acc)' : window.DR_C.text,
                          fontVariantNumeric: 'tabular-nums' }}>{s.v}</div>
            <div style={{ fontFamily: window.DR_MONO, fontSize: 8, fontWeight: 700, letterSpacing: '0.1em',
                          textTransform: 'uppercase', color: window.DR_C.muted, marginTop: 4 }}>{s.k}</div>
          </window.Card>
        ))}
      </div>

      {Object.entries(groups).map(([month, items]) => (
        <div key={month}>
          <window.SectionLabel>{month}</window.SectionLabel>
          <window.Card pad={0} style={{ overflow: 'hidden' }}>
            {items.map((f, i) => (
              <div key={i} onClick={() => nav('flight', { flight: f })}
                   style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', cursor: 'pointer',
                            borderTop: i ? `1px solid ${window.DR_C.separator}` : 'none' }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, background: window.DR_C.elevated,
                              display: 'grid', placeItems: 'center', color: 'var(--acc)' }}>
                  <window.DIcon name={f.mission === 'Mapping' || f.mission === 'Survey' ? 'map' : f.mission === 'Film' ? 'camera' : 'route'} size={18}/>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ fontFamily: window.DR_FONT, fontSize: 14, fontWeight: 600, color: window.DR_C.text }}>{f.mission}</span>
                    <window.Chip tone={f.mode === 'BVLOS' ? 'warn' : 'muted'}>{f.mode}</window.Chip>
                    <window.Chip tone="acc">{f.cat}</window.Chip>
                  </div>
                  <div style={{ fontFamily: window.DR_MONO, fontSize: 10, color: window.DR_C.text3, marginTop: 3,
                                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.drone} · {f.place}</div>
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
      ))}
    </div>
  );
}

function FleetTab({ nav, timeFmt }) {
  const D = window.DR_DATA;
  const healthTone = (h) => h >= 90 ? 'good' : h >= 80 ? 'warn' : 'danger';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div>
        <window.SectionLabel action="+ Add">Drones · {D.fleet.length}</window.SectionLabel>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {D.fleet.map((d) => (
            <window.Card key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
              <div style={{ width: 44, height: 44, borderRadius: 11, flexShrink: 0, background: window.DR_C.elevated,
                            display: 'grid', placeItems: 'center', color: 'var(--acc)' }}>
                <window.DIcon name="drone" size={22}/>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <span style={{ fontFamily: window.DR_FONT, fontSize: 14, fontWeight: 600, color: window.DR_C.text,
                                 whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.model}</span>
                  {d.status === 'maintenance' && <window.Chip tone="warn">Service</window.Chip>}
                </div>
                <div style={{ fontFamily: window.DR_MONO, fontSize: 10, color: window.DR_C.text3, marginTop: 3 }}>
                  {d.id} · {window.fmtInt(d.flights)} flt · {window.fmtTotal(d.min, 'hhmm')} h · {d.batteries} batt
                </div>
              </div>
              <window.DIcon name="chevron" size={16}/>
            </window.Card>
          ))}
        </div>
      </div>

      <div>
        <window.SectionLabel action="+ Add">Batteries · {D.batteries.length}</window.SectionLabel>
        <window.Card pad={0} style={{ overflow: 'hidden' }}>
          {D.batteries.map((b, i) => (
            <div key={b.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                                     borderTop: i ? `1px solid ${window.DR_C.separator}` : 'none' }}>
              <div style={{ color: window.DR_C.text3 }}><window.DIcon name="battery" size={20}/></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: window.DR_MONO, fontSize: 12, fontWeight: 700, color: window.DR_C.text }}>{b.id}</div>
                <div style={{ fontFamily: window.DR_MONO, fontSize: 9.5, color: window.DR_C.muted, marginTop: 2 }}>{b.drone} · {b.cycles} cycles</div>
              </div>
              <div style={{ width: 96 }}>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 5 }}>
                  <window.Chip tone={healthTone(b.health)}>{b.health}%</window.Chip>
                </div>
                <window.ProgressBar pct={b.health} h={4}
                  color={b.health >= 90 ? window.DR_C.success : b.health >= 80 ? window.DR_C.warning : window.DR_C.danger}/>
              </div>
            </div>
          ))}
        </window.Card>
      </div>
    </div>
  );
}

function LogScreen({ tw, nav, logTab, setLogTab }) {
  const timeFmt = tw.timeFmt || 'mmss';
  return (
    <div style={{ paddingBottom: 8 }}>
      <div style={{ fontFamily: window.DR_SERIF, fontSize: 26, fontWeight: 500, color: window.DR_C.text,
                    letterSpacing: '-0.02em', marginBottom: 16 }}>Log</div>
      <SubTabs tab={logTab} setTab={setLogTab}/>
      {logTab === 'flights' ? <FlightsTab nav={nav} timeFmt={timeFmt}/> : <FleetTab nav={nav} timeFmt={timeFmt}/>}
    </div>
  );
}

Object.assign(window, { LogScreen });
