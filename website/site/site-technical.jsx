// TECHNICAL DIRECTION — instrument-panel, mono accents, dark navy
const TxIcon = window.SiteIcon;

function TxNav({ t, lang, onLang }) {
  return (
    <nav className="tx-nav">
      <div className="tx-nav-inner">
        <a href="#tx-top" className="tx-brand">
          <div className="tx-brand-mark">B</div>
          <span className="tx-brand-text">BLADES</span>
          <span className="tx-brand-sub">/ JOINT LOGBOOK</span>
        </a>
        <div className="tx-nav-links">
          <a href="#tx-features">{t.nav.features}</a>
          <a href="#tx-roles">{t.nav.roles}</a>
          <a href="#tx-pricing">{t.nav.pricing}</a>
          <a href="#tx-changelog">{t.nav.changelog}</a>
        </div>
        <div className="tx-nav-actions">
          <div className="tx-lang">
            <button onClick={() => onLang('en')} className={lang === 'en' ? 'is-on' : ''}>EN</button>
            <button onClick={() => onLang('sv')} className={lang === 'sv' ? 'is-on' : ''}>SV</button>
          </div>
          <a href="https://apps.apple.com" className="tx-nav-cta">
            <TxIcon name="apple" size={14} />
            {t.nav.download}
          </a>
        </div>
      </div>
    </nav>
  );
}

function TxHero({ t, variant }) {
  if (variant === 'centered') {
    return (
      <header className="tx-hero tx-hero--centered">
        <div className="tx-eyebrow"><span className="tx-dot" />{t.hero.eyebrow}</div>
        <h1 className="tx-h1">
          <span>{t.hero.title_a}</span>
          <span className="tx-h1-accent">{t.hero.title_b}</span>
        </h1>
        <p className="tx-sub">{t.hero.sub}</p>
        <div className="tx-cta-row">
          <a href="https://apps.apple.com" className="tx-cta">
            <TxIcon name="apple" size={16} />{t.hero.cta_primary}
          </a>
          <a href="#tx-how" className="tx-cta-ghost">{t.hero.cta_secondary} <TxIcon name="arrow-right" size={14} /></a>
        </div>
        <div className="tx-instruments">
          <Instrument label="FLIGHTS" value="1 247" sub="LOGGED IN BETA" />
          <Instrument label="SCANS" value="98.2%" sub="OCR ACCURACY" big />
          <Instrument label="LAYOUTS" value="3" sub="PDF FORMATS" />
        </div>
      </header>
    );
  }
  return (
    <header className="tx-hero tx-hero--split">
      <div className="tx-hero-text">
        <div className="tx-eyebrow"><span className="tx-dot" />{t.hero.eyebrow}</div>
        <h1 className="tx-h1">
          <span>{t.hero.title_a}</span>
          <span className="tx-h1-accent">{t.hero.title_b}</span>
        </h1>
        <p className="tx-sub">{t.hero.sub}</p>
        <div className="tx-cta-row">
          <a href="https://apps.apple.com" className="tx-cta">
            <TxIcon name="apple" size={16} />{t.hero.cta_primary}
          </a>
          <a href="#tx-how" className="tx-cta-ghost">{t.hero.cta_secondary} <TxIcon name="arrow-right" size={14} /></a>
        </div>
        <div className="tx-hero-grid">
          <Instrument label="FLIGHTS" value="1 247" sub="LOGGED IN BETA" />
          <Instrument label="SCANS" value="98.2%" sub="OCR ACCURACY" />
          <Instrument label="LAYOUTS" value="3" sub="PDF FORMATS" />
          <Instrument label="OFFLINE" value="100%" sub="LOCAL ONLY" />
        </div>
      </div>
      <div className="tx-hero-visual">
        <TxPhone />
        <div className="tx-hero-grid-bg" />
      </div>
    </header>
  );
}

function Instrument({ label, value, sub, big }) {
  return (
    <div className={`tx-inst ${big ? 'tx-inst--big' : ''}`}>
      <div className="tx-inst-label">{label}</div>
      <div className="tx-inst-value">{value}</div>
      <div className="tx-inst-sub">{sub}</div>
    </div>
  );
}

function TxPhone() {
  return (
    <div className="tx-phone">
      <div className="tx-phone-frame">
        <div className="tx-phone-status">
          <span>9:41</span><span>●●●●● 5G</span>
        </div>
        <div className="tx-phone-h">DASHBOARD</div>
        <div className="tx-phone-card">
          <div className="tx-phone-card-l">LAST 30 DAYS</div>
          <div className="tx-phone-card-v">28:45<span>H</span></div>
          <div className="tx-phone-bars">
            {[40, 65, 30, 80, 55, 90, 70, 60].map((h, i) => (
              <span key={i} style={{ height: h + '%' }} />
            ))}
          </div>
        </div>
        <div className="tx-phone-row">
          <div className="tx-phone-mini">
            <div className="tx-phone-mini-l">STRESS</div>
            <div className="tx-phone-mini-v">STEADY</div>
          </div>
          <div className="tx-phone-mini">
            <div className="tx-phone-mini-l">IPC</div>
            <div className="tx-phone-mini-v">182d</div>
          </div>
        </div>
        <div className="tx-phone-list">
          <div className="tx-phone-list-h">RECENT</div>
          <div className="tx-phone-flight">
            <div className="tx-phone-flight-route">ESSA→ESGG</div>
            <div className="tx-phone-flight-meta">R44 · 1:24 · PIC</div>
          </div>
          <div className="tx-phone-flight">
            <div className="tx-phone-flight-route">ESSP→ESSA</div>
            <div className="tx-phone-flight-meta">R66 · 0:48 · PIC</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TxSection({ id, eyebrow, title, sub, children, idx }) {
  return (
    <section id={id} className="tx-section">
      <div className="tx-section-head">
        <div className="tx-section-idx">/{String(idx).padStart(2, '0')}</div>
        <div>
          <div className="tx-eyebrow"><span className="tx-dot" />{eyebrow}</div>
          <h2 className="tx-h2">{title}</h2>
          {sub && <p className="tx-section-sub">{sub}</p>}
        </div>
      </div>
      <div className="tx-section-body">{children}</div>
    </section>
  );
}

function TxRoles({ t }) {
  return (
    <TxSection id="tx-roles" idx={1} eyebrow={t.roles.eyebrow} title={t.roles.title} sub={t.roles.sub}>
      <div className="tx-roles-grid">
        {t.roles.items.map((r, i) => (
          <div key={i} className="tx-role">
            <div className="tx-role-num">/{String(i + 1).padStart(2, '0')}</div>
            <div className="tx-role-icon"><TxIcon name={r.icon} size={28} /></div>
            <h3>{r.title}</h3>
            <p>{r.desc}</p>
          </div>
        ))}
      </div>
    </TxSection>
  );
}

function TxHow({ t }) {
  return (
    <TxSection id="tx-how" idx={2} eyebrow={t.how.eyebrow} title={t.how.title}>
      <div className="tx-how-grid">
        {t.how.steps.map((s, i) => (
          <div key={i} className="tx-how-step">
            <div className="tx-how-track">
              <div className="tx-how-num">{s.n}</div>
              {i < t.how.steps.length - 1 && <div className="tx-how-line" />}
            </div>
            <div className="tx-how-body">
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </TxSection>
  );
}

function TxFeatures({ t }) {
  return (
    <TxSection id="tx-features" idx={3} eyebrow={t.features.eyebrow} title={t.features.title}>
      <div className="tx-features-grid">
        {t.features.items.map((f, i) => (
          <div key={i} className="tx-feat">
            <div className="tx-feat-head">
              <div className="tx-feat-icon"><TxIcon name={window.FEATURE_ICONS[i]} size={20} /></div>
              <div className="tx-feat-tag">[{f.tag.toUpperCase()}]</div>
            </div>
            <h3>{f.title}</h3>
            <p>{f.desc}</p>
          </div>
        ))}
      </div>
    </TxSection>
  );
}

function TxScreenshots({ t }) {
  return (
    <TxSection id="tx-shots" idx={4} eyebrow={t.screenshots.eyebrow} title={t.screenshots.title} sub={t.screenshots.sub}>
      <div className="tx-shots-row">
        {['DASHBOARD.TSX', 'OCR_REVIEW.TSX', 'PDF_EXPORT.TSX'].map((label, i) => (
          <div key={i} className="tx-shot">
            <div className="tx-shot-bar">
              <span className="tx-shot-dot" /><span className="tx-shot-dot" /><span className="tx-shot-dot" />
              <span className="tx-shot-label">{label}</span>
            </div>
            <div className="tx-shot-body">
              <div className="tx-shot-placeholder">
                <TxIcon name="camera" size={24} color="rgba(0, 200, 232, 0.4)" />
                <span>{t.screenshots.placeholder}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </TxSection>
  );
}

function TxTestimonials({ t }) {
  return (
    <TxSection id="tx-testimonials" idx={5} eyebrow={t.testimonials.eyebrow} title={t.testimonials.title}>
      <div className="tx-testimonials-grid">
        {t.testimonials.items.map((q, i) => (
          <div key={i} className="tx-quote">
            <div className="tx-quote-meta">/{String(i + 1).padStart(2, '0')}</div>
            <blockquote>{q.quote}</blockquote>
            <div className="tx-quote-cap">
              <div className="tx-quote-author">{q.author}</div>
              <div className="tx-quote-role">{q.role}</div>
            </div>
          </div>
        ))}
      </div>
    </TxSection>
  );
}

function TxChangelog({ t }) {
  return (
    <TxSection id="tx-changelog" idx={6} eyebrow={t.changelog.eyebrow} title={t.changelog.title}>
      <div className="tx-changelog">
        {t.changelog.items.map((c, i) => (
          <div key={i} className="tx-change-row">
            <div className="tx-change-meta">
              <div className="tx-change-v">v{c.v}</div>
              <div className="tx-change-d">{c.date.toUpperCase()}</div>
            </div>
            <div className="tx-change-body">
              <div className="tx-change-h">
                <span className={`tx-change-tag tx-change-tag--${c.tag.toLowerCase()}`}>[{c.tag.toUpperCase()}]</span>
                <h3>{c.title}</h3>
              </div>
              <p>{c.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </TxSection>
  );
}

function TxPricing({ t }) {
  return (
    <TxSection id="tx-pricing" idx={7} eyebrow={t.pricing.eyebrow} title={t.pricing.title} sub={t.pricing.sub}>
      <div className="tx-pricing-grid">
        <div className="tx-plan">
          <div className="tx-plan-h">
            <h3>{t.pricing.free.name}</h3>
            <span className="tx-plan-tag">[FREE]</span>
          </div>
          <div className="tx-plan-price">
            <span className="tx-plan-v">{t.pricing.free.price}</span>
            <span className="tx-plan-p">kr / {t.pricing.free.period}</span>
          </div>
          <ul className="tx-plan-features">
            {t.pricing.free.features.map((f, i) => (
              <li key={i}><TxIcon name="check" size={14} /> {f}</li>
            ))}
          </ul>
        </div>
        <div className="tx-plan tx-plan--featured">
          <div className="tx-plan-h">
            <h3>{t.pricing.premium.name}</h3>
            <span className="tx-plan-tag tx-plan-tag--hot">[{t.pricing.premium.badge.toUpperCase()}]</span>
          </div>
          <div className="tx-plan-price">
            <span className="tx-plan-v">{t.pricing.premium.price}</span>
            <span className="tx-plan-p">{t.pricing.premium.currency} / {t.pricing.premium.period}</span>
          </div>
          <ul className="tx-plan-features">
            {t.pricing.premium.features.map((f, i) => (
              <li key={i}><TxIcon name="check" size={14} /> {f}</li>
            ))}
          </ul>
          <a href="https://apps.apple.com" className="tx-cta tx-cta--full">
            <TxIcon name="apple" size={16} />{t.hero.cta_primary}
          </a>
        </div>
      </div>
    </TxSection>
  );
}

function TxFooter({ t }) {
  return (
    <footer className="tx-footer">
      <div className="tx-footer-grid">
        <div>
          <div className="tx-brand">
            <div className="tx-brand-mark">B</div>
            <span className="tx-brand-text">BLADES</span>
          </div>
          <p className="tx-footer-tag">{t.footer.tagline}</p>
        </div>
        <div>
          <div className="tx-footer-h">{t.footer.newsletter}</div>
          <form className="tx-footer-form" onSubmit={(e) => e.preventDefault()}>
            <input type="email" placeholder={t.footer.newsletter_placeholder} />
            <button type="submit">{t.footer.newsletter_cta}<TxIcon name="arrow-right" size={14} /></button>
          </form>
        </div>
      </div>
      <div className="tx-footer-bottom">
        <span>{t.footer.copyright} · BUILT WITH PRECISION IN SWEDEN</span>
        <div className="tx-footer-links">
          <a href="/privacy">{t.footer.privacy}</a>
          <a href="/terms">{t.footer.terms}</a>
          <a href="mailto:support@blades-app.com">{t.footer.support}</a>
        </div>
      </div>
    </footer>
  );
}

window.TechnicalSite = function TechnicalSite({ t, lang, onLang, heroVariant }) {
  return (
    <div className="tx-root" id="tx-top">
      <TxNav t={t} lang={lang} onLang={onLang} />
      <TxHero t={t} variant={heroVariant} />
      <TxRoles t={t} />
      <TxHow t={t} />
      <TxFeatures t={t} />
      <TxScreenshots t={t} />
      <TxTestimonials t={t} />
      <TxChangelog t={t} />
      <TxPricing t={t} />
      <TxFooter t={t} />
    </div>
  );
};
