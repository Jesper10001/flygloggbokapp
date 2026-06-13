// Drone UX — router, tab bar, map-proposal screen, and Tweaks.

const DR_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#22D3EE",
  "timeFmt": "mmss",
  "density": "compact",
  "showMap": true,
  "dashLayout": "A"
}/*EDITMODE-END*/;

// derive soft/line tints from accent
function injectAccent(hex) {
  const h = hex.replace('#',''); const n = parseInt(h, 16);
  const r = (n>>16)&255, g = (n>>8)&255, b = n&255;
  const root = document.documentElement.style;
  root.setProperty('--acc', hex);
  root.setProperty('--acc-soft', `rgba(${r},${g},${b},0.14)`);
  root.setProperty('--acc-line', `rgba(${r},${g},${b},0.42)`);
}

function MapScreen({ nav }) {
  const C = window.DR_C;
  const pts = [[60,80],[120,52],[180,70],[240,40],[300,64],[150,96],[210,108],[90,44],[270,92],[170,130],[40,120],[320,110]];
  return (
    <div style={{ paddingBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button onClick={() => nav('back')} style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0,
          background: C.surface, border: `1px solid ${C.border}`, color: C.text,
          display: 'grid', placeItems: 'center', cursor: 'pointer' }}><window.DIcon name="back" size={18}/></button>
        <div style={{ fontFamily: window.DR_SERIF, fontSize: 22, fontWeight: 500, color: C.text }}>Where you've flown</div>
      </div>
      <window.Chip tone="acc">Proposal · drone flights store GPS</window.Chip>
      <window.Card pad={0} style={{ overflow: 'hidden', marginTop: 12 }}>
        <div style={{ height: 320, background: C.bgDeep, position: 'relative' }}>
          <svg width="100%" height="320" viewBox="0 0 345 320" preserveAspectRatio="xMidYMid slice" style={{ display: 'block' }}>
            <defs><radialGradient id="mapglow2" cx="50%" cy="40%" r="60%">
              <stop offset="0%" stopColor="var(--acc)" stopOpacity="0.16"/><stop offset="100%" stopColor={C.bgDeep} stopOpacity="0"/>
            </radialGradient></defs>
            <rect width="345" height="320" fill="url(#mapglow2)"/>
            {[40,80,120,160,200,240,280].map((y) => <line key={y} x1="0" y1={y} x2="345" y2={y} stroke={C.border} strokeWidth="0.5" opacity="0.5"/>)}
            {[57,115,173,230,288].map((x) => <line key={x} x1={x} y1="0" x2={x} y2="320" stroke={C.border} strokeWidth="0.5" opacity="0.5"/>)}
            {pts.map(([x,y],i) => (<g key={i}><circle cx={x} cy={y*2.4} r="11" fill="var(--acc)" opacity="0.16"/><circle cx={x} cy={y*2.4} r="3.6" fill="var(--acc)"/></g>))}
          </svg>
          <div style={{ position: 'absolute', bottom: 12, left: 12, right: 12, display: 'flex', gap: 10 }}>
            {[{v:'48',k:'Sites'},{v:'12',k:'Regions'},{v:'3',k:'Countries'}].map((s)=>(
              <div key={s.k} style={{ flex:1, background:'rgba(6,16,30,0.78)', backdropFilter:'blur(8px)',
                border:`1px solid ${C.border}`, borderRadius:10, padding:'8px 10px' }}>
                <div style={{ fontFamily:window.DR_MONO, fontSize:15, fontWeight:700, color:'var(--acc)' }}>{s.v}</div>
                <div style={{ fontFamily:window.DR_MONO, fontSize:8, fontWeight:700, letterSpacing:'0.12em',
                  textTransform:'uppercase', color:C.muted, marginTop:2 }}>{s.k}</div>
              </div>
            ))}
          </div>
        </div>
      </window.Card>
      <div style={{ fontFamily: window.DR_MONO, fontSize: 9.5, color: C.muted, marginTop: 14,
                    letterSpacing: '0.04em', lineHeight: 1.6, textAlign: 'center' }}>
        In-app this renders on the native Apple map, the same one used under<br/>Settings → Manage airports.
      </div>
    </div>
  );
}

const TABS = [
  { key: 'dashboard', icon: 'grid',   label: 'Home' },
  { key: 'log',       icon: 'list',   label: 'Log' },
  { key: 'add',       icon: 'plus',   label: '', fab: true },
  { key: 'book',      icon: 'book',   label: 'Book' },
  { key: 'settings',  icon: 'settings', label: 'More' },
];

function TabBar({ current, go }) {
  const C = window.DR_C;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 20,
                  background: `linear-gradient(180deg, transparent, ${C.bg} 22%)`,
                  paddingTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around',
                    background: 'rgba(15,30,58,0.92)', backdropFilter: 'blur(16px)',
                    borderTop: `1px solid ${C.border}`, padding: '8px 8px 24px' }}>
        {TABS.map((t) => {
          if (t.fab) {
            return (
              <button key={t.key} onClick={() => go('add')} style={{
                width: 52, height: 52, borderRadius: 16, border: 'none', cursor: 'pointer',
                background: 'var(--acc)', color: C.bg, display: 'grid', placeItems: 'center',
                marginBottom: 4, boxShadow: '0 10px 24px -10px var(--acc)' }}>
                <window.DIcon name="plus" size={26}/>
              </button>
            );
          }
          const active = current === t.key;
          return (
            <button key={t.key} onClick={() => go(t.key)} style={{
              flex: 1, background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '4px 0',
              color: active ? 'var(--acc)' : C.muted }}>
              <window.DIcon name={t.icon} size={22}/>
              <span style={{ fontFamily: window.DR_MONO, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.08em',
                             textTransform: 'uppercase' }}>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DroneApp() {
  const [tw, setTweak] = window.useTweaks(DR_DEFAULTS);
  const accent = tw.accent || DR_DEFAULTS.accent;
  const [stack, setStack] = React.useState([{ screen: 'dashboard' }]);
  const [logTab, setLogTab] = React.useState('flights');
  const scrollRef = React.useRef(null);

  React.useEffect(() => { injectAccent(accent); }, [accent]);

  const top = stack[stack.length - 1];
  const TAB_KEYS = ['dashboard', 'log', 'book', 'settings'];

  const nav = (screen, params) => {
    if (screen === 'back') { setStack((s) => s.length > 1 ? s.slice(0, -1) : s); return; }
    setStack((s) => [...s, { screen, params }]);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };
  // tab switch resets the stack to that tab root
  const go = (key) => {
    if (key === 'add') { setStack((s) => [...s, { screen: 'add' }]); }
    else setStack([{ screen: key }]);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  const C = window.DR_C;
  const isFlow = top.screen === 'add'; // full-bleed flows hide tab bar
  const currentTab = TAB_KEYS.includes(top.screen) ? top.screen : (stack.find(s => TAB_KEYS.includes(s.screen))?.screen || 'dashboard');

  let body;
  switch (top.screen) {
    case 'dashboard':  body = <window.DashboardScreen tw={tw} nav={nav}/>; break;
    case 'log':        body = <window.LogScreen tw={tw} nav={nav} logTab={logTab} setLogTab={setLogTab}/>; break;
    case 'book':       body = <window.BookScreen nav={nav}/>; break;
    case 'settings':   body = <window.SettingsScreen tw={tw} nav={nav} setTweak={setTweak}/>; break;
    case 'certificates': body = <window.CertificatesScreen nav={nav}/>; break;
    case 'compliance': body = <window.CertificatesScreen nav={nav}/>; break;
    case 'flight':     body = <window.FlightDetailScreen nav={nav} params={top.params} timeFmt={tw.timeFmt}/>; break;
    case 'add':        body = <window.AddFlightScreen nav={nav}/>; break;
    case 'map':        body = <MapScreen nav={nav}/>; break;
    default:           body = <window.DashboardScreen tw={tw} nav={nav}/>;
  }

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center',
                    background: 'radial-gradient(1100px 700px at 50% -200px, #0E1E33, transparent 70%), #05080F',
                    padding: 20, boxSizing: 'border-box' }}>
        <window.IOSDevice width={393} height={812} dark={true}>
          <div style={{ position: 'absolute', inset: 0, background: C.bg, fontFamily: window.DR_FONT }}>
            <div ref={scrollRef} style={{ position: 'absolute', inset: 0, overflowY: 'auto',
                  padding: '64px 18px 0', paddingBottom: isFlow ? 0 : 108, boxSizing: 'border-box' }}>
              {body}
            </div>
            {!isFlow && <TabBar current={currentTab} go={go}/>}
          </div>
        </window.IOSDevice>
      </div>

      <window.TweaksPanel title="Tweaks">
        <window.TweakSection label="Dashboard"/>
        <window.TweakRadio label="Layout" value={tw.dashLayout || 'A'}
          options={['A', 'B']} onChange={(v) => setTweak('dashLayout', v)}/>
        <window.TweakRadio label="Density" value={tw.density || 'cozy'}
          options={['cozy', 'compact']} onChange={(v) => setTweak('density', v)}/>
        <window.TweakToggle label="Location map" value={tw.showMap !== false}
          onChange={(v) => setTweak('showMap', v)}/>
        <window.TweakSection label="Data"/>
        <window.TweakRadio label="Flight time" value={tw.timeFmt || 'mmss'}
          options={['mmss', 'hhmm']} onChange={(v) => setTweak('timeFmt', v)}/>
        <window.TweakSection label="Identity"/>
        <window.TweakColor label="Drone accent" value={accent}
          options={window.DR_ACCENTS} onChange={(v) => setTweak('accent', v)}/>
      </window.TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<DroneApp/>);
