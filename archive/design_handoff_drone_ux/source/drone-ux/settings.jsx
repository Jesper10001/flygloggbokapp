// Drone Settings — mirrors the pilot-manned settings screen (profile card →
// certificates → premium, then collapsible sections + About), but every row is
// drone-relevant. Competency lives inside the Certificates detail screen.

const C = window.DR_C;

function SettingsRow({ icon, iconColor, iconBg, title, subtitle, right, onClick, border = true, pressable = true }) {
  const content = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 14px',
                  borderBottom: border ? `0.5px solid ${C.separator}` : 'none' }}>
      {iconBg ? (
        <div style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: iconBg,
                      display: 'grid', placeItems: 'center', color: iconColor || C.text }}>
          <window.DIcon name={icon} size={16}/>
        </div>
      ) : (
        <span style={{ color: iconColor || C.text, flexShrink: 0, display: 'flex' }}><window.DIcon name={icon} size={18}/></span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: window.DR_FONT, fontSize: 14.5, fontWeight: 600, color: C.text }}>{title}</div>
        {subtitle && <div style={{ fontFamily: window.DR_FONT, fontSize: 11.5, color: C.muted, marginTop: 2,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{subtitle}</div>}
      </div>
      {right || (onClick ? <span style={{ color: C.muted, display: 'flex' }}><window.DIcon name="chevron" size={16}/></span> : null)}
    </div>
  );
  if (!pressable || !onClick) return content;
  return <div onClick={onClick} style={{ cursor: 'pointer' }}>{content}</div>;
}

function Toggle2({ options, value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 3, background: C.elevated, borderRadius: 8, padding: 3 }}>
      {options.map(([k, label]) => {
        const sel = value === k;
        return (
          <button key={k} onClick={(e) => { e.stopPropagation(); onChange(k); }} style={{
            padding: '6px 11px', borderRadius: 6, border: 'none', cursor: 'pointer',
            fontFamily: window.DR_MONO, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em',
            background: sel ? 'var(--acc)' : 'transparent', color: sel ? C.bg : C.text3,
          }}>{label}</button>
        );
      })}
    </div>
  );
}

function CollapsibleHeader({ children, expanded, onPress }) {
  return (
    <div onClick={onPress} style={{ display: 'flex', alignItems: 'center', cursor: 'pointer',
        margin: '14px 0 0', padding: '12px 14px', background: C.surface, borderRadius: 12,
        border: `1px solid ${C.border}` }}>
      <span style={{ flex: 1, fontFamily: window.DR_MONO, fontSize: 11, fontWeight: 700, letterSpacing: '0.14em',
                     textTransform: 'uppercase', color: expanded ? 'var(--acc)' : C.text }}>{children}</span>
      <span style={{ color: expanded ? 'var(--acc)' : 'var(--acc)', display: 'flex',
                     transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>
        <window.DIcon name="chevron" size={15}/>
      </span>
    </div>
  );
}

function PlainSectionLabel({ children }) {
  return (
    <div style={{ padding: '20px 6px 8px', fontFamily: window.DR_MONO, fontSize: 11, fontWeight: 700,
                  letterSpacing: '0.14em', textTransform: 'uppercase', color: C.muted }}>{children}</div>
  );
}

function GroupCard({ children }) {
  return (
    <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 16, overflow: 'hidden' }}>
      {children}
    </div>
  );
}

function PremiumPill() {
  return (
    <span style={{ padding: '3px 8px', borderRadius: 6, background: 'rgba(255,200,87,0.18)',
                   fontFamily: window.DR_MONO, fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
                   textTransform: 'uppercase', color: C.warning }}>Premium</span>
  );
}

function SettingsScreen({ tw, nav, setTweak }) {
  const D = window.DR_DATA;
  const [expanded, setExpanded] = React.useState('logbook');
  const toggle = (s) => setExpanded(expanded === s ? null : s);
  const expiring = D.certs.filter(c => c.status === 'expiring').length;

  return (
    <div style={{ paddingBottom: 16 }}>
      <div style={{ fontFamily: window.DR_FONT, fontSize: 26, fontWeight: 800, color: C.text,
                    letterSpacing: '-0.6px', marginBottom: 14 }}>Settings</div>

      {/* Profile card */}
      <GroupCard>
        <SettingsRow icon="person" iconColor={C.bg} iconBg="var(--acc)"
          title={D.pilot} subtitle={`${D.operator} · ${D.opId}`} onClick={() => {}}/>
        <SettingsRow icon="shield" iconColor={expiring ? C.warning : C.success}
          iconBg={expiring ? 'rgba(255,200,87,0.18)' : 'rgba(63,185,80,0.18)'}
          title="Certificates & competency"
          subtitle={expiring ? `${D.certs.length} credentials · ${expiring} expiring` : `${D.certs.length} credentials · all valid`}
          onClick={() => nav('certificates')}/>
        <SettingsRow icon="star" iconColor={C.warning} iconBg="rgba(255,200,87,0.18)"
          title="Blades Premium" subtitle="Discover all features" onClick={() => {}} border={false}/>
      </GroupCard>

      {/* LOGBOOK */}
      <CollapsibleHeader expanded={expanded === 'logbook'} onPress={() => toggle('logbook')}>Logbook</CollapsibleHeader>
      {expanded === 'logbook' && (
        <div style={{ marginTop: 8 }}>
          <GroupCard>
            <SettingsRow icon="chip" iconColor="var(--acc)" title="Logbook type" subtitle="Pilot · Unmanned Aircraft" pressable={false}/>
            <SettingsRow icon="drone" iconColor="var(--acc)" title="Manage drones" subtitle={`${D.fleet.length} drones · ${D.batteries.length} batteries`} onClick={() => nav('log')}/>
            <SettingsRow icon="book" iconColor="var(--acc)" title="Your logbook" subtitle="Physical EASA spread" onClick={() => nav('book')}/>
            <SettingsRow icon="clock" iconColor="var(--acc)" title="Audit log" subtitle="All changes logged" onClick={() => {}} border={false}/>
          </GroupCard>
        </div>
      )}

      {/* IMPORT */}
      <CollapsibleHeader expanded={expanded === 'import'} onPress={() => toggle('import')}>Import</CollapsibleHeader>
      {expanded === 'import' && (
        <div style={{ marginTop: 8 }}>
          <GroupCard>
            <SettingsRow icon="doc" iconColor="var(--acc)" title="Import CSV" subtitle="Any drone-log format" onClick={() => {}}/>
            <SettingsRow icon="camera" iconColor="var(--acc)" title="Scan controller log" subtitle="DJI / Autel export"
              right={<PremiumPill/>} onClick={() => {}}/>
            <SettingsRow icon="plus" iconColor="var(--acc)" title="Add manually" subtitle="Log a single flight" onClick={() => nav('add')} border={false}/>
          </GroupCard>
        </div>
      )}

      {/* DATA & EXPORT */}
      <CollapsibleHeader expanded={expanded === 'export'} onPress={() => toggle('export')}>Data &amp; Export</CollapsibleHeader>
      {expanded === 'export' && (
        <div style={{ marginTop: 8 }}>
          <GroupCard>
            <SettingsRow icon="cloud" iconColor={C.text3} title="iCloud sync" subtitle="Coming soon"
              right={<span style={{ fontFamily: window.DR_MONO, fontSize: 10, color: C.muted }}>OFF</span>} pressable={false}/>
            <SettingsRow icon="download" iconColor="var(--acc)" title="Export CSV" subtitle="Always free — all fields" onClick={() => {}}/>
            <SettingsRow icon="book" iconColor="var(--acc)" title="Export logbook pages" subtitle="PDF spread, EASA layout"
              right={<PremiumPill/>} onClick={() => {}}/>
            <SettingsRow icon="settings" iconColor="var(--acc)" title="Custom export" subtitle="Pick your own columns" onClick={() => {}} border={false}/>
          </GroupCard>
        </div>
      )}

      {/* APP */}
      <CollapsibleHeader expanded={expanded === 'app'} onPress={() => toggle('app')}>App</CollapsibleHeader>
      {expanded === 'app' && (
        <div style={{ marginTop: 8 }}>
          <GroupCard>
            <SettingsRow icon="globe" iconColor="var(--acc)" title="Language" subtitle="English"
              right={<Toggle2 options={[['en','ENG'],['sv','SWE']]} value={'en'} onChange={() => {}}/>} pressable={false}/>
            <SettingsRow icon="contrast" iconColor="var(--acc)" title="Accent" subtitle="Drone signature colour"
              right={<Toggle2 options={[['mmss','●'],['hhmm','○']]} value={'mmss'} onChange={() => {}}/>} pressable={false}/>
            <SettingsRow icon="clock" iconColor="var(--acc)" title="Flight time format" subtitle="Per-flight display"
              right={<Toggle2 options={[['mmss','MM:SS'],['hhmm','H:MM']]} value={tw.timeFmt || 'mmss'}
                       onChange={(v) => setTweak('timeFmt', v)}/>} pressable={false} border={false}/>
          </GroupCard>
        </div>
      )}

      {/* ABOUT */}
      <PlainSectionLabel>About</PlainSectionLabel>
      <GroupCard>
        <SettingsRow icon="info" iconColor={C.text3} title="Version"
          right={<span style={{ fontFamily: window.DR_MONO, fontSize: 12, color: C.muted }}>1.0.0</span>} pressable={false}/>
        <SettingsRow icon="lock" iconColor={C.text3} title="Local storage" subtitle="No account · your data stays yours" pressable={false}/>
        <SettingsRow icon="mail" iconColor={C.text3} title="Support" subtitle="support@blades-app.com" onClick={() => {}}/>
        <SettingsRow icon="globe" iconColor={C.text3} title="blades-app.com" subtitle="What's new & roadmap" onClick={() => {}}/>
        <SettingsRow icon="doc" iconColor={C.text3} title="Privacy policy" onClick={() => {}} border={false}/>
      </GroupCard>
    </div>
  );
}

// ── Certificates detail = competency (credentials + recency) ─────────────────
function daysUntil(iso) {
  const d = new Date(iso + 'T00:00:00'), now = new Date('2026-06-11T00:00:00');
  return Math.round((d - now) / 86400000);
}

function CertificatesScreen({ nav }) {
  const D = window.DR_DATA;
  return (
    <div style={{ paddingBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button onClick={() => nav('back')} style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0,
          background: C.surface, border: `1px solid ${C.border}`, color: C.text,
          display: 'grid', placeItems: 'center', cursor: 'pointer' }}><window.DIcon name="back" size={18}/></button>
        <div>
          <div style={{ fontFamily: window.DR_SERIF, fontSize: 21, fontWeight: 500, color: C.text }}>Certificates</div>
          <div style={{ fontFamily: window.DR_MONO, fontSize: 9.5, letterSpacing: '0.1em', color: C.muted,
                        textTransform: 'uppercase', marginTop: 1 }}>Competency &amp; recency</div>
        </div>
      </div>

      {/* credentials */}
      <window.SectionLabel action="+ Add">Credentials</window.SectionLabel>
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
                            color: tone === 'good' ? C.success : tone === 'warn' ? C.warning : C.danger }}>
                <window.DIcon name={tone === 'good' ? 'check' : 'warn'} size={19}/>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: window.DR_FONT, fontSize: 13.5, fontWeight: 600, color: C.text, lineHeight: 1.3 }}>{c.name}</div>
                <div style={{ fontFamily: window.DR_MONO, fontSize: 10, color: C.text3, marginTop: 3 }}>
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
                  <span style={{ fontFamily: window.DR_MONO, fontSize: 11.5, fontWeight: 700, color: C.text2, letterSpacing: '0.04em' }}>{r.key}</span>
                  <span style={{ fontFamily: window.DR_MONO, fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap',
                                 color: stale ? C.danger : r.days > r.limit * 0.6 ? C.warning : C.success }}>
                    {stale ? `${r.days} d · stale` : `${r.days} d ago`}
                  </span>
                </div>
                <window.ProgressBar pct={pct} h={5}
                  color={stale ? C.danger : r.days > r.limit * 0.6 ? C.warning : C.success}/>
              </div>
            );
          })}
        </div>
        <div style={{ fontFamily: window.DR_MONO, fontSize: 9.5, color: C.muted, marginTop: 14,
                      letterSpacing: '0.04em', lineHeight: 1.5 }}>
          Stay current by flying each category within 90 days. Recency keeps you proficient and audit-ready.
        </div>
      </window.Card>
    </div>
  );
}

Object.assign(window, { SettingsScreen, CertificatesScreen });
