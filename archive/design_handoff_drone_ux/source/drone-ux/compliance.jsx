// Compliance — competency (EASA UAS credentials) + recency per category.
// Plus the physical-logbook screen (buttons only, not yet wired).

function daysUntil(iso) {
  const d = new Date(iso + 'T00:00:00'), now = new Date('2026-06-11T00:00:00');
  return Math.round((d - now) / 86400000);
}

function ComplianceScreen({ nav }) {
  const D = window.DR_DATA;
  return (
    <div style={{ paddingBottom: 16 }}>
      <div style={{ fontFamily: window.DR_SERIF, fontSize: 26, fontWeight: 500, color: window.DR_C.text,
                    letterSpacing: '-0.02em', marginBottom: 4 }}>Competency</div>
      <div style={{ fontFamily: window.DR_FONT, fontSize: 13.5, color: window.DR_C.text3, marginBottom: 18 }}>
        Your EASA UAS credentials &amp; flight recency.
      </div>

      {/* credentials */}
      <window.SectionLabel>Credentials</window.SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 22 }}>
        {D.certs.map((c) => {
          const days = daysUntil(c.expires);
          const tone = c.status === 'expiring' ? 'warn' : c.status === 'expired' ? 'danger' : 'good';
          return (
            <window.Card key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
              <div style={{ width: 42, height: 42, borderRadius: 11, flexShrink: 0,
                            background: tone === 'good' ? 'rgba(63,185,80,0.12)' : tone === 'warn' ? 'rgba(255,200,87,0.12)' : 'rgba(255,107,91,0.12)',
                            border: `1px solid ${tone === 'good' ? 'rgba(63,185,80,0.4)' : tone === 'warn' ? 'rgba(255,200,87,0.4)' : 'rgba(255,107,91,0.4)'}`,
                            display: 'grid', placeItems: 'center',
                            color: tone === 'good' ? window.DR_C.success : tone === 'warn' ? window.DR_C.warning : window.DR_C.danger }}>
                <window.DIcon name={tone === 'good' ? 'check' : 'warn'} size={19}/>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: window.DR_FONT, fontSize: 13.5, fontWeight: 600, color: window.DR_C.text,
                              lineHeight: 1.3 }}>{c.name}</div>
                <div style={{ fontFamily: window.DR_MONO, fontSize: 10, color: window.DR_C.text3, marginTop: 3 }}>
                  {c.code} · expires {new Date(c.expires + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                </div>
              </div>
              <window.Chip tone={tone}>{c.status === 'valid' ? 'Valid' : c.status === 'expiring' ? `${days} d` : 'Expired'}</window.Chip>
            </window.Card>
          );
        })}
      </div>

      {/* recency */}
      <window.SectionLabel>Recency by category</window.SectionLabel>
      <window.Card>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {D.recency.map((r) => {
            const pct = Math.max(4, 100 - (r.days / r.limit) * 100);
            const stale = r.days > r.limit;
            return (
              <div key={r.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: window.DR_MONO, fontSize: 11.5, fontWeight: 700, color: window.DR_C.text2,
                                 letterSpacing: '0.04em' }}>{r.key}</span>
                  <span style={{ fontFamily: window.DR_MONO, fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap',
                                 color: stale ? window.DR_C.danger : r.days > r.limit * 0.6 ? window.DR_C.warning : window.DR_C.success }}>
                    {stale ? `${r.days} d · stale` : `${r.days} d ago`}
                  </span>
                </div>
                <window.ProgressBar pct={pct} h={5}
                  color={stale ? window.DR_C.danger : r.days > r.limit * 0.6 ? window.DR_C.warning : window.DR_C.success}/>
              </div>
            );
          })}
        </div>
        <div style={{ fontFamily: window.DR_MONO, fontSize: 9.5, color: window.DR_C.muted, marginTop: 14,
                      letterSpacing: '0.04em', lineHeight: 1.5 }}>
          Stay current by flying each category within 90 days. Recency keeps you proficient and audit-ready.
        </div>
      </window.Card>
    </div>
  );
}

// ── physical logbook entry — buttons only (spread view comes later) ──────────
function BookScreen({ nav }) {
  const D = window.DR_DATA;
  return (
    <div style={{ paddingBottom: 16 }}>
      <div style={{ fontFamily: window.DR_SERIF, fontSize: 26, fontWeight: 500, color: window.DR_C.text,
                    letterSpacing: '-0.02em', marginBottom: 4 }}>Logbook</div>
      <div style={{ fontFamily: window.DR_FONT, fontSize: 13.5, color: window.DR_C.text3, marginBottom: 20 }}>
        Your drone flights, presented as a physical EASA logbook spread.
      </div>

      {/* book cover preview */}
      <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', marginBottom: 18,
                    border: `1px solid ${window.DR_C.border}`,
                    background: `linear-gradient(150deg, ${window.DR_C.surface2}, ${window.DR_C.bgDeep})`,
                    aspectRatio: '3 / 2', display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center', gap: 14 }}>
        <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1,
                      background: window.DR_C.border, opacity: 0.6 }}/>
        <div style={{ position: 'absolute', top: -40, right: -20, width: 160, height: 160,
                      background: 'radial-gradient(circle, var(--acc-soft), transparent 65%)' }}/>
        <div style={{ color: 'var(--acc)', position: 'relative' }}><window.DIcon name="book" size={40}/></div>
        <div style={{ fontFamily: window.DR_MONO, fontSize: 10, fontWeight: 700, letterSpacing: '0.18em',
                      textTransform: 'uppercase', color: window.DR_C.text3, position: 'relative', whiteSpace: 'nowrap' }}>
          {window.fmtInt(D.flights)} flights · {D.fleet.length} drones
        </div>
        <window.Chip tone="muted">Spread view · coming soon</window.Chip>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <button style={btnPrimary}>
          <window.DIcon name="book" size={18}/> Open logbook spread
        </button>
        <div style={{ display: 'flex', gap: 10 }}>
          <button style={btnGhost}><window.DIcon name="grid" size={16}/> Choose layout</button>
          <button style={btnGhost}><window.DIcon name="camera" size={16}/> Export PDF</button>
        </div>
      </div>

      <div style={{ fontFamily: window.DR_MONO, fontSize: 9.5, color: window.DR_C.muted, marginTop: 16,
                    letterSpacing: '0.04em', lineHeight: 1.6, textAlign: 'center' }}>
        Drone-specific columns — category, mode, MTOW, battery —<br/>render in the same EASA spread used by pilot-manned.
      </div>
    </div>
  );
}

const btnPrimary = {
  width: '100%', padding: '15px', borderRadius: 13, border: 'none',
  background: 'var(--acc)', color: window.DR_C.bg, fontFamily: window.DR_FONT, fontSize: 15, fontWeight: 700,
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 9,
  boxShadow: '0 14px 30px -16px var(--acc)',
};
const btnGhost = {
  flex: 1, padding: '13px', borderRadius: 13, background: window.DR_C.surface,
  border: `1px solid ${window.DR_C.border}`, color: window.DR_C.text2, fontFamily: window.DR_FONT,
  fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center',
  justifyContent: 'center', gap: 8,
};

Object.assign(window, { ComplianceScreen, BookScreen });
