// Add-flight (form) + Flight detail screens.

function FormRow({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      <span style={{ fontFamily: window.DR_MONO, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.14em',
                     textTransform: 'uppercase', color: window.DR_C.muted }}>{label}</span>
      {children}
    </div>
  );
}

function FieldBox({ children, onClick }) {
  return (
    <div onClick={onClick} style={{
      background: window.DR_C.surface, border: `1px solid ${window.DR_C.border}`, borderRadius: 11,
      padding: '13px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      cursor: onClick ? 'pointer' : 'default',
    }}>{children}</div>
  );
}

function Segmented({ options, value, onChange, accentSel }) {
  return (
    <div style={{ display: 'flex', gap: 4, background: window.DR_C.surface, border: `1px solid ${window.DR_C.border}`,
                  borderRadius: 11, padding: 4 }}>
      {options.map((o) => {
        const sel = value === o;
        return (
          <button key={o} onClick={() => onChange(o)} style={{
            flex: 1, padding: '9px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
            fontFamily: window.DR_MONO, fontSize: 11.5, fontWeight: 700, letterSpacing: '0.04em',
            background: sel ? 'var(--acc)' : 'transparent',
            color: sel ? window.DR_C.bg : window.DR_C.text3,
          }}>{o}</button>
        );
      })}
    </div>
  );
}

function AddFlightScreen({ nav }) {
  const D = window.DR_DATA;
  const [mode, setMode] = React.useState('VLOS');
  const [cat, setCat] = React.useState('Specific');
  const [mission, setMission] = React.useState('Inspection');
  const [drone, setDrone] = React.useState(D.fleet[0].model);
  const [date, setDate] = React.useState(new Date('2026-06-11T00:00:00'));
  const [showDate, setShowDate] = React.useState(false);
  const stepDay = (delta) => setDate((d) => { const n = new Date(d); n.setDate(n.getDate() + delta); return n; });
  const [passes, setPasses] = React.useState(['12:20', '06:22']);
  const [maxAlt, setMaxAlt] = React.useState('118');

  const parsePass = (s) => { const m = /^(\d+):(\d{1,2})$/.exec((s || '').trim()); return m ? parseInt(m[1]) * 60 + parseInt(m[2]) : 0; };
  const totalSec = passes.reduce((sum, p) => sum + parsePass(p), 0);
  const fmtMMSS = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  const setPass = (i, v) => setPasses((prev) => prev.map((p, idx) => idx === i ? v : p));
  const addPass = () => setPasses((prev) => prev.length < 5 ? [...prev, ''] : prev);
  const removePass = (i) => setPasses((prev) => prev.filter((_, idx) => idx !== i));

  const dateLabel = date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'long' });

  return (
    <div style={{ paddingBottom: 90 }}>
      {/* date-in-header — mirrors pilot-manned add-flight */}
      <div style={{ margin: '-64px -18px 18px', paddingTop: 50, paddingBottom: 12,
                    paddingLeft: 16, paddingRight: 16, position: 'relative',
                    background: window.DR_C.surface, borderBottom: `0.5px solid ${window.DR_C.separator}`,
                    display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <button onClick={() => nav('back')} style={{ position: 'absolute', left: 14, bottom: 10,
          width: 34, height: 34, borderRadius: 9, background: window.DR_C.elevated,
          border: `1px solid ${window.DR_C.border}`, color: window.DR_C.text,
          display: 'grid', placeItems: 'center', cursor: 'pointer' }}><window.DIcon name="back" size={17}/></button>
        <div onClick={() => setShowDate(true)} style={{ display: 'flex', flexDirection: 'column',
              alignItems: 'center', gap: 3, cursor: 'pointer', maxWidth: 230 }}>
          <span style={{ fontFamily: window.DR_SERIF, fontSize: 21, fontWeight: 600, color: window.DR_C.text,
                         letterSpacing: '-0.4px', textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{dateLabel}</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: window.DR_MONO,
                         fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
                         color: 'var(--acc)', whiteSpace: 'nowrap' }}>
            <window.DIcon name="clock" size={10}/> Tap to change
          </span>
        </div>
      </div>

      {/* scan shortcut */}
      <window.Card glow style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <div style={{ width: 42, height: 42, borderRadius: 11, flexShrink: 0, background: 'var(--acc-soft)',
                      border: '1px solid var(--acc-line)', display: 'grid', placeItems: 'center', color: 'var(--acc)' }}>
          <window.DIcon name="camera" size={20}/>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: window.DR_FONT, fontSize: 13.5, fontWeight: 600, color: window.DR_C.text }}>Scan controller log</div>
          <div style={{ fontFamily: window.DR_MONO, fontSize: 10, color: window.DR_C.text3, marginTop: 1 }}>Auto-fill from DJI / Autel export</div>
        </div>
        <window.DIcon name="chevron" size={16}/>
      </window.Card>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <FormRow label="Drone">
          <FieldBox onClick={() => {}}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10, color: window.DR_C.text, fontFamily: window.DR_FONT, fontSize: 14 }}>
              <span style={{ color: 'var(--acc)' }}><window.DIcon name="drone" size={18}/></span>{drone}
            </span>
            <window.DIcon name="chevron" size={16}/>
          </FieldBox>
        </FormRow>

        <FormRow label="Mission type">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {D.missions.map((m) => {
              const sel = mission === m.key;
              return (
                <button key={m.key} onClick={() => setMission(m.key)} style={{
                  padding: '9px 14px', borderRadius: 10, cursor: 'pointer',
                  fontFamily: window.DR_FONT, fontSize: 13, fontWeight: 600,
                  background: sel ? 'var(--acc-soft)' : window.DR_C.surface,
                  border: `1px solid ${sel ? 'var(--acc-line)' : window.DR_C.border}`,
                  color: sel ? 'var(--acc)' : window.DR_C.text2,
                }}>{m.key}</button>
              );
            })}
          </div>
        </FormRow>

        <FormRow label="Operating category">
          <Segmented options={['A1', 'A2', 'A3', 'Specific']} value={cat} onChange={setCat}/>
        </FormRow>

        <FormRow label="Flight mode">
          <Segmented options={['VLOS', 'EVLOS', 'BVLOS']} value={mode} onChange={setMode}/>
        </FormRow>

        <FormRow label="Flight time · add a pass per sortie">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {passes.map((p, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10,
                              background: window.DR_C.surface, border: `1px solid ${window.DR_C.border}`,
                              borderRadius: 11, padding: '11px 14px' }}>
                  <span style={{ fontFamily: window.DR_MONO, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.1em',
                                 textTransform: 'uppercase', color: window.DR_C.muted, width: 52, flexShrink: 0 }}>Pass {i + 1}</span>
                  <input value={p} onChange={(e) => setPass(i, e.target.value)} placeholder="MM:SS"
                    inputMode="numeric"
                    style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: window.DR_C.text,
                             fontFamily: window.DR_MONO, fontSize: 15, fontWeight: 700, letterSpacing: '0.04em',
                             width: '100%' }}/>
                  <span style={{ color: 'var(--acc)', display: 'flex', flexShrink: 0 }}><window.DIcon name="clock" size={15}/></span>
                </div>
                {passes.length > 1 && (
                  <button onClick={() => removePass(i)} style={{ width: 42, height: 42, borderRadius: 10, flexShrink: 0,
                    background: 'rgba(255,107,91,0.10)', border: '1px solid rgba(255,107,91,0.4)', cursor: 'pointer',
                    color: window.DR_C.danger, display: 'grid', placeItems: 'center' }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
                  </button>
                )}
              </div>
            ))}

            {/* glowing total bar */}
            <div style={{ marginTop: 2, borderRadius: 14, background: 'var(--acc-soft)',
                          border: '1.5px solid var(--acc)', padding: '13px 16px',
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          boxShadow: '0 0 16px -2px var(--acc-line)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <div style={{ width: 28, height: 28, borderRadius: 14, background: 'var(--acc-line)',
                              border: '1px solid var(--acc)', display: 'grid', placeItems: 'center', color: 'var(--acc)' }}>
                  <window.DIcon name="clock" size={15}/>
                </div>
                <span style={{ fontFamily: window.DR_MONO, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.18em',
                               textTransform: 'uppercase', color: 'var(--acc)' }}>Flight time</span>
              </div>
              <span style={{ fontFamily: window.DR_MONO, fontSize: 25, fontWeight: 800, color: 'var(--acc)',
                             letterSpacing: '0.06em', fontVariantNumeric: 'tabular-nums' }}>{fmtMMSS(totalSec)}</span>
            </div>

            {passes.length < 5 && (
              <button onClick={addPass} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '11px', borderRadius: 11, border: '1px dashed var(--acc-line)', background: 'var(--acc-soft)',
                cursor: 'pointer', color: 'var(--acc)', fontFamily: window.DR_FONT, fontSize: 13, fontWeight: 700 }}>
                <window.DIcon name="plus" size={15}/> Add pass
              </button>
            )}
          </div>
        </FormRow>

        <FormRow label="Max altitude">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: window.DR_C.surface,
                        border: `1px solid ${window.DR_C.border}`, borderRadius: 11, padding: '11px 14px' }}>
            <input value={maxAlt} onChange={(e) => setMaxAlt(e.target.value.replace(/\D/g, ''))} inputMode="numeric"
              style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: window.DR_C.text,
                       fontFamily: window.DR_MONO, fontSize: 15, fontWeight: 700 }}/>
            <span style={{ fontFamily: window.DR_MONO, fontSize: 12, color: window.DR_C.muted }}>m AGL</span>
            <span style={{ color: window.DR_C.muted, display: 'flex' }}><window.DIcon name="alt" size={16}/></span>
          </div>
        </FormRow>

        <FormRow label="Location">
          <FieldBox onClick={() => {}}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 10, color: window.DR_C.text, fontFamily: window.DR_FONT, fontSize: 14 }}>
              <span style={{ color: 'var(--acc)' }}><window.DIcon name="pin" size={17}/></span>Powerline corridor · Sundsvall
            </span>
            <window.DIcon name="chevron" size={16}/>
          </FieldBox>
        </FormRow>

        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <FormRow label="Battery cycle">
              <FieldBox><span style={{ fontFamily: window.DR_MONO, fontSize: 14, color: window.DR_C.text }}>TB65 · A1</span>
                <span style={{ color: window.DR_C.muted }}><window.DIcon name="battery" size={16}/></span></FieldBox>
            </FormRow>
          </div>
          <div style={{ flex: 1 }}>
            <FormRow label="Observer">
              <FieldBox><span style={{ fontFamily: window.DR_FONT, fontSize: 14, color: window.DR_C.text }}>1 · M. Berg</span>
                <span style={{ color: window.DR_C.muted }}><window.DIcon name="eye" size={16}/></span></FieldBox>
            </FormRow>
          </div>
        </div>
      </div>

      {/* sticky save */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '14px 20px 28px',
                    background: `linear-gradient(180deg, transparent, ${window.DR_C.bg} 30%)` }}>
        <button onClick={() => nav('back')} style={{ width: '100%', padding: '15px', borderRadius: 13, border: 'none',
          background: 'var(--acc)', color: window.DR_C.bg, fontFamily: window.DR_FONT, fontSize: 15, fontWeight: 700,
          cursor: 'pointer', boxShadow: '0 14px 30px -14px var(--acc)' }}>Save flight</button>
      </div>

      {/* date picker sheet */}
      {showDate && (
        <div onClick={() => setShowDate(false)} style={{ position: 'absolute', inset: 0, zIndex: 40,
              background: 'rgba(4,16,31,0.6)', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: window.DR_C.surface,
                borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTop: `1px solid ${window.DR_C.border}`,
                padding: '10px 18px 30px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0 14px' }}>
              <span style={{ fontFamily: window.DR_MONO, fontSize: 11, fontWeight: 700, letterSpacing: '0.14em',
                             textTransform: 'uppercase', color: window.DR_C.text3 }}>Flight date</span>
              <button onClick={() => setShowDate(false)} style={{ border: 'none', background: 'none', cursor: 'pointer',
                       fontFamily: window.DR_FONT, fontSize: 14, fontWeight: 700, color: 'var(--acc)' }}>Done</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          background: window.DR_C.bgDeep, border: `1px solid ${window.DR_C.border}`,
                          borderRadius: 14, padding: '14px 18px' }}>
              <button onClick={() => stepDay(-1)} style={{ width: 40, height: 40, borderRadius: 10,
                background: window.DR_C.elevated, border: `1px solid ${window.DR_C.border}`, color: window.DR_C.text,
                cursor: 'pointer', display: 'grid', placeItems: 'center', transform: 'rotate(180deg)' }}><window.DIcon name="chevron" size={18}/></button>
              <div style={{ flex: 1, minWidth: 0, textAlign: 'center' }}>
                <div style={{ fontFamily: window.DR_SERIF, fontSize: 22, fontWeight: 600, color: window.DR_C.text,
                              textTransform: 'capitalize', whiteSpace: 'nowrap' }}>{date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })}</div>
                <div style={{ fontFamily: window.DR_MONO, fontSize: 10, color: window.DR_C.muted, marginTop: 2 }}>
                  {date.toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric' })}
                </div>
              </div>
              <button onClick={() => stepDay(1)} style={{ width: 40, height: 40, borderRadius: 10,
                background: window.DR_C.elevated, border: `1px solid ${window.DR_C.border}`, color: window.DR_C.text,
                cursor: 'pointer', display: 'grid', placeItems: 'center' }}><window.DIcon name="chevron" size={18}/></button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              {[['Today', 0], ['Yesterday', -1]].map(([label, delta]) => (
                <button key={label} onClick={() => { const n = new Date('2026-06-11T00:00:00'); n.setDate(n.getDate() + delta); setDate(n); }}
                  style={{ flex: 1, padding: '10px', borderRadius: 10, background: window.DR_C.elevated,
                           border: `1px solid ${window.DR_C.border}`, color: window.DR_C.text2, cursor: 'pointer',
                           fontFamily: window.DR_FONT, fontSize: 13, fontWeight: 600 }}>{label}</button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FlightDetailScreen({ nav, params, timeFmt }) {
  const f = (params && params.flight) || window.DR_DATA.recent[0];
  const stats = [
    { k: 'Category', v: f.cat, ic: 'shield' },
    { k: 'Mode', v: f.mode, ic: f.mode === 'BVLOS' ? 'signal' : 'eye' },
    { k: 'Drone', v: f.drone, ic: 'drone' },
    { k: 'Max alt', v: '118 m', ic: 'alt' },
  ];
  return (
    <div style={{ paddingBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
        <button onClick={() => nav('back')} style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0,
          background: window.DR_C.surface, border: `1px solid ${window.DR_C.border}`, color: window.DR_C.text,
          display: 'grid', placeItems: 'center', cursor: 'pointer' }}><window.DIcon name="back" size={18}/></button>
        <div style={{ fontFamily: window.DR_MONO, fontSize: 11, fontWeight: 700, letterSpacing: '0.1em',
                      color: window.DR_C.text3, textTransform: 'uppercase' }}>{window.relDate(f.date)} · {f.date}</div>
      </div>

      {/* hero */}
      <window.Card glow style={{ position: 'relative', overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ position: 'absolute', top: -50, right: -30, width: 170, height: 170,
                      background: 'radial-gradient(circle, var(--acc-soft), transparent 65%)', pointerEvents: 'none' }}/>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'relative' }}>
          <span style={{ color: 'var(--acc)' }}><window.DIcon name={f.mission === 'Film' ? 'camera' : f.mission === 'Mapping' || f.mission === 'Survey' ? 'map' : 'route'} size={20}/></span>
          <span style={{ fontFamily: window.DR_SERIF, fontSize: 24, fontWeight: 500, color: window.DR_C.text }}>{f.mission}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 12, position: 'relative' }}>
          <span style={{ fontFamily: window.DR_SERIF, fontWeight: 500, fontSize: 52, lineHeight: 0.85,
                         letterSpacing: '-0.03em', color: window.DR_C.text, fontVariantNumeric: 'tabular-nums' }}>
            {window.fmtFlight(f.sec, timeFmt === 'hhmm' ? 'hhmm' : 'mmss')}
          </span>
          <span style={{ fontFamily: window.DR_MONO, fontWeight: 700, fontSize: 13, color: 'var(--acc)', letterSpacing: '0.1em' }}>
            {timeFmt === 'hhmm' ? 'H:MM' : 'MM:SS'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 8, position: 'relative',
                      fontFamily: window.DR_MONO, fontSize: 11, color: window.DR_C.text3 }}>
          <window.DIcon name="pin" size={13}/>{f.place}
        </div>
      </window.Card>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
        {stats.map((s) => (
          <window.Card key={s.k} pad={13} style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
            <span style={{ color: 'var(--acc)' }}><window.DIcon name={s.ic} size={18}/></span>
            <div>
              <div style={{ fontFamily: window.DR_MONO, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.12em',
                            textTransform: 'uppercase', color: window.DR_C.muted }}>{s.k}</div>
              <div style={{ fontFamily: window.DR_FONT, fontSize: 14, fontWeight: 600, color: window.DR_C.text, marginTop: 2 }}>{s.v}</div>
            </div>
          </window.Card>
        ))}
      </div>

      {/* mini map */}
      <window.Card pad={0} style={{ overflow: 'hidden' }}>
        <div style={{ height: 150, background: window.DR_C.bgDeep, position: 'relative' }}>
          <svg width="100%" height="150" viewBox="0 0 345 150" preserveAspectRatio="xMidYMid slice" style={{ display: 'block' }}>
            <rect width="345" height="150" fill="var(--acc-soft)" opacity="0.3"/>
            {[30,60,90,120].map((y) => <line key={y} x1="0" y1={y} x2="345" y2={y} stroke={window.DR_C.border} strokeWidth="0.5" opacity="0.5"/>)}
            {[57,115,173,230,288].map((x) => <line key={x} x1={x} y1="0" x2={x} y2="150" stroke={window.DR_C.border} strokeWidth="0.5" opacity="0.5"/>)}
            <path d="M70 110 Q120 60 175 80 T280 50" fill="none" stroke="var(--acc)" strokeWidth="2.4" strokeLinecap="round" strokeDasharray="4 5"/>
            <circle cx="70" cy="110" r="5" fill="var(--acc)"/><circle cx="280" cy="50" r="5" fill="var(--acc)"/>
          </svg>
          <div style={{ position: 'absolute', top: 10, left: 12 }}><window.Chip tone="acc"><window.DIcon name="route" size={11}/> Flight path</window.Chip></div>
        </div>
      </window.Card>
    </div>
  );
}

Object.assign(window, { AddFlightScreen, FlightDetailScreen });
