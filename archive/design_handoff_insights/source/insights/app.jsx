// Insights — tab scaffold, scroll page, missing-hours modal stubs, Tweaks.

const IN_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#00C8E8",
  "monthlyViz": "heatmap"
}/*EDITMODE-END*/;

function injectAccent(hex) {
  const n = parseInt(hex.replace('#',''), 16);
  const r = (n>>16)&255, g = (n>>8)&255, b = n&255;
  const s = document.documentElement.style;
  s.setProperty('--acc', hex);
  s.setProperty('--acc-soft', `rgba(${r},${g},${b},0.14)`);
  s.setProperty('--acc-line', `rgba(${r},${g},${b},0.42)`);
}

const IN_TABS = [
  { key: 'home', icon: 'home', label: 'Home' },
  { key: 'log', icon: 'list', label: 'Log' },
  { key: 'insights', icon: 'insights', label: 'Insights' },
  { key: 'book', icon: 'book', label: 'Book' },
  { key: 'more', icon: 'gear', label: 'More' },
];

function TabBar({ current }) {
  const C = window.IN_C;
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 20,
                  background: `linear-gradient(180deg, transparent, ${C.bg} 22%)`, paddingTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-around', background: 'rgba(15,30,58,0.92)',
                    backdropFilter: 'blur(16px)', borderTop: `1px solid ${C.border}`, padding: '8px 8px 24px' }}>
        {IN_TABS.map((t) => {
          const active = current === t.key;
          return (
            <div key={t.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center',
              gap: 4, padding: '4px 0', color: active ? 'var(--acc)' : C.muted }}>
              <window.IIcon name={t.icon} size={22}/>
              <span style={{ fontFamily: window.IN_MONO, fontSize: 8.5, fontWeight: 700, letterSpacing: '0.06em',
                textTransform: 'uppercase' }}>{t.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MissingModal({ which, onClose }) {
  const C = window.IN_C;
  const meta = {
    dual:  { title: 'Add Dual hours', body: 'Scan back through flights flown as a student and tag dual-instruction time the OCR or import may have missed.' },
    instr: { title: 'Add Instructor hours', body: 'Flag flights where you acted as flight instructor (FI) so instructor time flows into your totals.' },
    nvg:   { title: 'Add NVG hours', body: 'A guided flow walks you through which night flights were flown on night-vision goggles.' },
  }[which] || {};
  return (
    <div onClick={onClose} style={{ position: 'absolute', inset: 0, zIndex: 40, background: 'rgba(4,12,24,0.7)',
      display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: C.surface, borderTopLeftRadius: 22,
        borderTopRightRadius: 22, borderTop: `1px solid ${C.border}`, padding: '20px 20px 32px' }}>
        <div style={{ width: 38, height: 4, borderRadius: 2, background: C.border, margin: '0 auto 18px' }}/>
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 10 }}>
          <div style={{ width: 40, height: 40, borderRadius: 11, background: 'var(--acc-soft)',
            border: '1px solid var(--acc-line)', display: 'grid', placeItems: 'center', color: 'var(--acc)' }}>
            <window.IIcon name="plus" size={20}/></div>
          <span style={{ fontFamily: window.IN_SERIF, fontSize: 20, fontWeight: 600, color: C.text }}>{meta.title}</span>
        </div>
        <p style={{ fontFamily: window.IN_FONT, fontSize: 14, lineHeight: 1.5, color: C.text2, margin: '0 0 18px' }}>{meta.body}</p>
        <button onClick={onClose} style={{ width: '100%', padding: '14px', borderRadius: 13, border: 'none',
          background: 'var(--acc)', color: C.bgDeep, fontFamily: window.IN_FONT, fontSize: 15, fontWeight: 700,
          cursor: 'pointer' }}>Start guided flow</button>
        <div style={{ textAlign: 'center', marginTop: 10, fontFamily: window.IN_MONO, fontSize: 10, color: C.muted }}>
          Existing function — unchanged</div>
      </div>
    </div>
  );
}

function InsightsApp() {
  const [tw, setTweak] = window.useTweaks(IN_DEFAULTS);
  const accent = tw.accent || IN_DEFAULTS.accent;
  const [monthlyViz, setMonthlyViz] = React.useState(tw.monthlyViz || 'heatmap');
  const [missing, setMissing] = React.useState(null);
  const C = window.IN_C;

  React.useEffect(() => { injectAccent(accent); }, [accent]);
  React.useEffect(() => { if (tw.monthlyViz) setMonthlyViz(tw.monthlyViz); }, [tw.monthlyViz]);

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center',
                    background: 'radial-gradient(1100px 700px at 50% -200px, #0E1E33, transparent 70%), #05080F',
                    padding: 20, boxSizing: 'border-box' }}>
        <window.IOSDevice width={393} height={812} dark={true}>
          <div style={{ position: 'absolute', inset: 0, background: C.bg, fontFamily: window.IN_FONT }}>
            <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', padding: '60px 16px 108px', boxSizing: 'border-box' }}>
              {/* header */}
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontFamily: window.IN_SERIF, fontSize: 30, fontWeight: 500, color: C.text,
                  letterSpacing: '-0.02em' }}>Insights</div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
                <window.HeroTotals accent={accent}/>

                <div>
                  <window.HoursBank accent={accent} onMissing={setMissing}/>
                </div>

                <div>
                  <window.ActivitySection accent={accent} monthlyViz={monthlyViz} setMonthlyViz={(v) => { setMonthlyViz(v); setTweak('monthlyViz', v); }}/>
                </div>

                <div>
                  <window.GoalCard accent={accent}/>
                </div>

                <div>
                  <window.LicenceJourney accent={accent}/>
                </div>
              </div>
            </div>
            <TabBar current="insights"/>
            {missing && <MissingModal which={missing} onClose={() => setMissing(null)}/>}
          </div>
        </window.IOSDevice>
      </div>

      <window.TweaksPanel title="Tweaks">
        <window.TweakSection label="Monthly chart"/>
        <window.TweakRadio label="Style" value={monthlyViz} options={['heatmap', 'bars', 'line']}
          onChange={(v) => { setMonthlyViz(v); setTweak('monthlyViz', v); }}/>
        <window.TweakSection label="Accent"/>
        <window.TweakColor label="Color" value={accent} options={window.IN_ACCENTS}
          onChange={(v) => setTweak('accent', v)}/>
      </window.TweaksPanel>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<InsightsApp/>);
