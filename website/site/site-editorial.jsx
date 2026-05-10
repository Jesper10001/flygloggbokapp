// EDITORIAL DIRECTION — magazine, big serifs, warm narrative
const Icon = window.SiteIcon;

// ──────────────────────────────────────────────────────────────────────
// Nav
// ──────────────────────────────────────────────────────────────────────
function EdNav({ t, lang, onLang }) {
  return (
    <nav className="ed-nav">
      <div className="ed-nav-inner">
        <a href="#top" className="ed-brand">
          <img src="blades-logo.png" alt="" className="ed-brand-mark" />
          <span className="ed-brand-text">BLADES</span>
        </a>
        <div className="ed-nav-links">
          <a href="#features">{t.nav.features}</a>
          <a href="#roles">{t.nav.roles}</a>
          <a href="#pricing">{t.nav.pricing}</a>
          <a href="#changelog">{t.nav.changelog}</a>
        </div>
        <div className="ed-nav-actions">
          <a href="https://apps.apple.com" className="ed-nav-cta">{t.nav.download}</a>
        </div>
      </div>
    </nav>
  );
}

function LangToggle({ lang, onChange, variant }) {
  const cls = variant === 'ed' ? 'ed-lang' : 'tx-lang';
  return (
    <div className={cls} role="group" aria-label="Language">
      <button onClick={() => onChange('en')} aria-pressed={lang === 'en'} className={lang === 'en' ? 'is-on' : ''}>EN</button>
      <button onClick={() => onChange('sv')} aria-pressed={lang === 'sv'} className={lang === 'sv' ? 'is-on' : ''}>SV</button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Phone screenshot placeholder — used in hero + screenshots row
// Visual: dark phone bezel + empty navy screen with "screenshot coming soon"
// ──────────────────────────────────────────────────────────────────────
function PhonePlaceholder({ caption, size = 'lg' }) {
  return (
    <div className={`ed-phone-ph ed-phone-ph--${size}`}>
      <div className="ed-phone-ph-bezel">
        <div className="ed-phone-ph-notch" />
        <div className="ed-phone-ph-screen">
          <div className="ed-phone-ph-grid" aria-hidden="true" />
          <div className="ed-phone-ph-msg">
            <Icon name="camera" size={26} color="rgba(255,255,255,0.45)" />
            <span>{caption}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Hero
// ──────────────────────────────────────────────────────────────────────
function EdHero({ t, variant }) {
  if (variant === 'centered') {
    return (
      <header className="ed-hero ed-hero--centered">
        <div className="ed-eyebrow">{t.hero.eyebrow}</div>
        <h1 className="ed-h1">
          <span className="ed-h1-a">{t.hero.title_a}</span>
          <span className="ed-h1-b">{t.hero.title_b}</span>
        </h1>
        <p className="ed-sub">{t.hero.sub}</p>
        <div className="ed-cta-row">
          <a href="https://apps.apple.com" className="ed-cta">
            <Icon name="apple" size={18} />
            {t.hero.cta_primary}
          </a>
          <a href="#how" className="ed-cta-ghost">{t.hero.cta_secondary} →</a>
        </div>
        <div className="ed-hero-phone-wrap">
          <PhonePlaceholder caption={t.screenshots.placeholder} />
        </div>
      </header>
    );
  }
  if (variant === 'editorial') {
    return (
      <header className="ed-hero ed-hero--editorial">
        <div className="ed-hero-rail-l">
          <div className="ed-hero-issue">No. 01 — May 2026</div>
          <div className="ed-hero-rule" />
          <div className="ed-hero-meta">A field journal · Vol. 1</div>
        </div>
        <div className="ed-hero-center">
          <h1 className="ed-h1 ed-h1--editorial">
            <span className="ed-h1-a">{t.hero.title_a}</span>
            <span className="ed-h1-b">{t.hero.title_b}</span>
          </h1>
          <p className="ed-sub ed-sub--editorial">{t.hero.sub}</p>
          <div className="ed-cta-row">
            <a href="https://apps.apple.com" className="ed-cta">
              <Icon name="apple" size={18} />
              {t.hero.cta_primary}
            </a>
            <a href="#how" className="ed-cta-ghost">{t.hero.cta_secondary} →</a>
          </div>
        </div>
        <div className="ed-hero-rail-r">
          <div className="ed-hero-issue">{t.hero.preview_caption}</div>
        </div>
      </header>
    );
  }
  // default: split
  return (
    <header className="ed-hero ed-hero--split">
      <div className="ed-hero-text">
        <div className="ed-eyebrow">{t.hero.eyebrow}</div>
        <h1 className="ed-h1">
          <span className="ed-h1-a">{t.hero.title_a}</span>
          <span className="ed-h1-b">{t.hero.title_b}</span>
        </h1>
        <p className="ed-sub">{t.hero.sub}</p>
        <div className="ed-cta-row">
          <a href="https://apps.apple.com" className="ed-cta">
            <Icon name="apple" size={18} />
            {t.hero.cta_primary}
          </a>
          <a href="#how" className="ed-cta-ghost">{t.hero.cta_secondary} →</a>
        </div>
        <div className="ed-hero-stats">
          {t.hero.stats.map((s, i) => (
            <div key={i}><b>{s.v}</b><span>{s.k}</span></div>
          ))}
        </div>
      </div>
      <div className="ed-hero-visual">
        <PhonePlaceholder caption={t.screenshots.placeholder} />
        <div className="ed-hero-tag">{t.hero.preview_caption}</div>
      </div>
    </header>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Roles
// ──────────────────────────────────────────────────────────────────────
function EdRoles({ t }) {
  return (
    <section id="roles" className="ed-section ed-roles">
      <div className="ed-section-head">
        <div className="ed-eyebrow">{t.roles.eyebrow}</div>
        <h2 className="ed-h2">{t.roles.title}</h2>
        <p className="ed-section-sub">{t.roles.sub}</p>
      </div>
      <div className="ed-roles-grid">
        {t.roles.items.map((r, i) => (
          <article key={i} className="ed-role">
            <div className="ed-role-icon"><Icon name={r.icon} size={28} /></div>
            <h3>{r.title}</h3>
            <p>{r.desc}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// How it works
// ──────────────────────────────────────────────────────────────────────
function EdHow({ t }) {
  return (
    <section id="how" className="ed-section ed-how">
      <div className="ed-section-head">
        <div className="ed-eyebrow">{t.how.eyebrow}</div>
        <h2 className="ed-h2">{t.how.title}</h2>
      </div>
      <ol className="ed-how-list">
        {t.how.steps.map((s, i) => (
          <li key={i} className="ed-how-step">
            <div className="ed-how-n">{s.n}</div>
            <div className="ed-how-body">
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Feature visuals — small visual proofs per feature
// ──────────────────────────────────────────────────────────────────────
function FeatViz({ kind }) {
  if (kind === 'load') {
    // 14-day rolling load mini-chart
    const bars = [42, 55, 38, 60, 72, 48, 65, 80, 70, 58, 85, 92, 78, 88];
    const baseline = 65;
    return (
      <div className="ed-feat-viz ed-viz-load">
        <div className="ed-viz-load-baseline" style={{ bottom: baseline + '%' }}>
          <span>baseline</span>
        </div>
        <div className="ed-viz-load-bars">
          {bars.map((h, i) => (
            <span key={i} style={{ height: h + '%' }} className={h > baseline ? 'is-over' : ''} />
          ))}
        </div>
        <div className="ed-viz-load-foot">
          <span className="ed-viz-load-tag">Last 14 days · +18% over baseline</span>
        </div>
      </div>
    );
  }
  if (kind === 'easa') {
    // CPL/ATPL progress bars
    const reqs = [
      { label: 'PIC time', cur: 142, req: 200 },
      { label: 'IFR', cur: 88, req: 100 },
      { label: 'Night', cur: 32, req: 50 },
      { label: 'Cross-country', cur: 168, req: 200 }
    ];
    return (
      <div className="ed-feat-viz ed-viz-easa">
        {reqs.map((r, i) => {
          const pct = Math.min(100, (r.cur / r.req) * 100);
          return (
            <div key={i} className="ed-viz-easa-row">
              <div className="ed-viz-easa-label">
                <span>{r.label}</span>
                <span className="ed-viz-easa-num">{r.cur}<span className="dim">/{r.req}h</span></span>
              </div>
              <div className="ed-viz-easa-track"><span style={{ width: pct + '%' }} /></div>
            </div>
          );
        })}
      </div>
    );
  }
  if (kind === 'ocr') {
    // OCR row with confidence dots
    return (
      <div className="ed-feat-viz ed-viz-ocr">
        <div className="ed-viz-ocr-grid">
          <div className="ed-viz-ocr-h">DATE</div>
          <div className="ed-viz-ocr-h">FROM</div>
          <div className="ed-viz-ocr-h">TO</div>
          <div className="ed-viz-ocr-h">TIME</div>

          <div className="ed-viz-ocr-c">14/03</div>
          <div className="ed-viz-ocr-c">ESSA</div>
          <div className="ed-viz-ocr-c">ESGG</div>
          <div className="ed-viz-ocr-c">1:24</div>

          <div className="ed-viz-ocr-c">15/03</div>
          <div className="ed-viz-ocr-c"><em>"</em></div>
          <div className="ed-viz-ocr-c ed-viz-ocr-flag">??</div>
          <div className="ed-viz-ocr-c">0:48</div>
        </div>
        <div className="ed-viz-ocr-foot">
          <span className="ed-viz-conf ed-viz-conf--hi"><span /><span /><span /> 98%</span>
          <span className="ed-viz-conf ed-viz-conf--lo"><span /><span /><span /> 41%</span>
        </div>
      </div>
    );
  }
  if (kind === 'certs') {
    // Certificate radar — list with days
    const certs = [
      { label: 'Class rating SEP', days: 412, status: 'ok' },
      { label: 'Class 1 medical', days: 86, status: 'soon' },
      { label: 'IPC', days: 21, status: 'warn' },
      { label: 'NVG currency', days: -3, status: 'over' }
    ];
    return (
      <div className="ed-feat-viz ed-viz-certs">
        {certs.map((c, i) => (
          <div key={i} className={`ed-viz-cert ed-viz-cert--${c.status}`}>
            <span className="ed-viz-cert-dot" />
            <span className="ed-viz-cert-label">{c.label}</span>
            <span className="ed-viz-cert-days">
              {c.days < 0 ? `${Math.abs(c.days)}d over` : `${c.days}d`}
            </span>
          </div>
        ))}
      </div>
    );
  }
  if (kind === 'rules') {
    // VFR/IFR mixed flight visualisation
    return (
      <div className="ed-feat-viz ed-viz-rules">
        <div className="ed-viz-rules-route">
          <span>ESSA</span>
          <span className="ed-viz-rules-line">
            <span className="ed-viz-rules-vfr" />
            <span className="ed-viz-rules-ifr" />
          </span>
          <span>ESGG</span>
        </div>
        <div className="ed-viz-rules-legend">
          <span><i className="lg lg-vfr" />VFR · 0:38</span>
          <span><i className="lg lg-ifr" />IFR · 0:46</span>
          <span className="ed-viz-rules-pill">Type · Y</span>
        </div>
        <div className="ed-viz-rules-roles">
          <span className="role">PIC</span>
          <span className="role">PICUS</span>
          <span className="role">DUAL</span>
          <span className="role">SAFETY</span>
        </div>
      </div>
    );
  }
  if (kind === 'battery') {
    // Battery cycle counter
    return (
      <div className="ed-feat-viz ed-viz-battery">
        <div className="ed-viz-battery-row">
          <div className="ed-viz-battery-label">
            <span className="ed-viz-battery-name">Mavic 3 Pro · Bat A</span>
            <span className="ed-viz-battery-id">SN 4021</span>
          </div>
          <div className="ed-viz-battery-num">142</div>
        </div>
        <div className="ed-viz-battery-row">
          <div className="ed-viz-battery-label">
            <span className="ed-viz-battery-name">Mavic 3 Pro · Bat B</span>
            <span className="ed-viz-battery-id">SN 4022</span>
          </div>
          <div className="ed-viz-battery-num">98</div>
        </div>
        <div className="ed-viz-battery-row ed-viz-battery-row--new">
          <div className="ed-viz-battery-label">
            <span className="ed-viz-battery-name">Mini 4 Pro · Bat A</span>
            <span className="ed-viz-battery-id">+1 cycle</span>
          </div>
          <div className="ed-viz-battery-num">17</div>
        </div>
      </div>
    );
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────
// Features
// ──────────────────────────────────────────────────────────────────────
function EdFeatures({ t }) {
  return (
    <section id="features" className="ed-section ed-features">
      <div className="ed-section-head">
        <div className="ed-eyebrow">{t.features.eyebrow}</div>
        <h2 className="ed-h2">{t.features.title}</h2>
      </div>
      <div className="ed-features-grid">
        {t.features.items.map((f, i) => (
          <article key={i} className="ed-feat">
            <div className="ed-feat-viz-wrap">
              <FeatViz kind={f.visual} />
            </div>
            <div className="ed-feat-body">
              <div className="ed-feat-tag">{f.tag}</div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Cockpit detail — deep-dive on the small things
// ──────────────────────────────────────────────────────────────────────
function EdCockpit({ t }) {
  return (
    <section className="ed-section ed-cockpit">
      <div className="ed-section-head">
        <div className="ed-eyebrow">{t.cockpit.eyebrow}</div>
        <h2 className="ed-h2">{t.cockpit.title}</h2>
        <p className="ed-section-sub">{t.cockpit.sub}</p>
      </div>
      <div className="ed-cockpit-grid">
        {t.cockpit.items.map((it, i) => (
          <div key={i} className="ed-cockpit-item">
            <div className="ed-cockpit-num">{String(i + 1).padStart(2, '0')}</div>
            <div className="ed-cockpit-body">
              <h4>{it.h}</h4>
              <p>{it.p}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Screenshots placeholder row
// ──────────────────────────────────────────────────────────────────────
function EdScreenshots({ t }) {
  return (
    <section className="ed-section ed-shots">
      <div className="ed-section-head ed-section-head--center">
        <div className="ed-eyebrow">{t.screenshots.eyebrow}</div>
        <h2 className="ed-h2">{t.screenshots.title}</h2>
        <p className="ed-section-sub">{t.screenshots.sub}</p>
      </div>
      <div className="ed-shots-row">
        {['Dashboard', 'Scan & review', 'PDF export'].map((label, i) => (
          <div key={i} className={`ed-shot ed-shot--${i}`}>
            <PhonePlaceholder caption={t.screenshots.placeholder} size="md" />
            <div className="ed-shot-label">{label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Testimonials
// ──────────────────────────────────────────────────────────────────────
function EdTestimonials({ t }) {
  return (
    <section className="ed-section ed-testimonials">
      <div className="ed-section-head">
        <div className="ed-eyebrow">{t.testimonials.eyebrow}</div>
        <h2 className="ed-h2">{t.testimonials.title}</h2>
      </div>
      <div className="ed-testimonials-grid">
        {t.testimonials.items.map((q, i) => (
          <figure key={i} className="ed-quote">
            <div className="ed-quote-mark">"</div>
            <blockquote>{q.quote}</blockquote>
            <figcaption>
              <div className="ed-quote-author">{q.author}</div>
              <div className="ed-quote-role">{q.role}</div>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Changelog
// ──────────────────────────────────────────────────────────────────────
function EdChangelog({ t }) {
  return (
    <section id="changelog" className="ed-section ed-changelog">
      <div className="ed-section-head">
        <div className="ed-eyebrow">{t.changelog.eyebrow}</div>
        <h2 className="ed-h2">{t.changelog.title}</h2>
      </div>
      <ul className="ed-changelog-list">
        {t.changelog.items.map((c, i) => (
          <li key={i} className="ed-changelog-row">
            <div className="ed-changelog-meta">
              <div className="ed-changelog-v">v{c.v}</div>
              <div className="ed-changelog-date">{c.date}</div>
            </div>
            <div className="ed-changelog-body">
              <div className="ed-changelog-h">
                <span className={`ed-changelog-tag ed-changelog-tag--${c.tag.toLowerCase()}`}>{c.tag}</span>
                <h3>{c.title}</h3>
              </div>
              <p>{c.desc}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Pricing
// ──────────────────────────────────────────────────────────────────────
function EdPricing({ t }) {
  return (
    <section id="pricing" className="ed-section ed-pricing">
      <div className="ed-section-head ed-section-head--center">
        <div className="ed-eyebrow">{t.pricing.eyebrow}</div>
        <h2 className="ed-h2">{t.pricing.title}</h2>
        <p className="ed-section-sub">{t.pricing.sub}</p>
      </div>
      <div className="ed-pricing-grid">
        <article className="ed-plan">
          <div className="ed-plan-head">
            <h3>{t.pricing.free.name}</h3>
          </div>
          <div className="ed-plan-price">
            <span className="ed-plan-amount">{t.pricing.free.price}</span>
            <span className="ed-plan-period">kr · {t.pricing.free.period}</span>
          </div>
          <ul className="ed-plan-features">
            {t.pricing.free.features.map((f, i) => (
              <li key={i}><Icon name="check" size={16} /> {f}</li>
            ))}
          </ul>
        </article>
        <article className="ed-plan ed-plan--featured">
          <div className="ed-plan-head">
            <h3>{t.pricing.premium.name}</h3>
            <span className="ed-plan-badge">{t.pricing.premium.badge}</span>
          </div>
          <div className="ed-plan-price">
            <span className="ed-plan-amount">{t.pricing.premium.price}</span>
            <span className="ed-plan-period">{t.pricing.premium.currency} · {t.pricing.premium.period}</span>
          </div>
          <ul className="ed-plan-features">
            {t.pricing.premium.features.map((f, i) => (
              <li key={i}><Icon name="check" size={16} /> {f}</li>
            ))}
          </ul>
          <a href="https://apps.apple.com" className="ed-cta ed-cta--full">
            <Icon name="apple" size={18} />
            {t.hero.cta_primary}
          </a>
        </article>
      </div>
    </section>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Footer
// ──────────────────────────────────────────────────────────────────────
function EdFooter({ t }) {
  return (
    <footer className="ed-footer">
      <div className="ed-footer-inner">
        <div className="ed-footer-brand">
          <div className="ed-brand">
            <img src="blades-logo.png" alt="" className="ed-brand-mark" />
            <span className="ed-brand-text">BLADES</span>
          </div>
          <p className="ed-footer-tagline">{t.footer.tagline}</p>
        </div>
        <div className="ed-footer-news">
          <div className="ed-footer-news-h">{t.footer.newsletter}</div>
          <form className="ed-footer-form" onSubmit={(e) => e.preventDefault()}>
            <input type="email" placeholder={t.footer.newsletter_placeholder} />
            <button type="submit">{t.footer.newsletter_cta}</button>
          </form>
        </div>
      </div>
      <div className="ed-footer-bottom">
        <span>{t.footer.copyright}</span>
        <div className="ed-footer-links">
          <a href="/privacy.html">{t.footer.privacy}</a>
          <a href="/terms.html">{t.footer.terms}</a>
          <a href="mailto:support@blades-app.com">{t.footer.support}</a>
        </div>
      </div>
    </footer>
  );
}

// ──────────────────────────────────────────────────────────────────────
// Root
// ──────────────────────────────────────────────────────────────────────
window.EditorialSite = function EditorialSite({ t, lang, onLang, heroVariant }) {
  return (
    <div className="ed-root" id="top">
      <EdNav t={t} lang={lang} onLang={onLang} />
      <EdHero t={t} variant={heroVariant} />
      <EdRoles t={t} />
      <EdHow t={t} />
      <EdFeatures t={t} />
      <EdCockpit t={t} />
      <EdScreenshots t={t} />
      {/* EdTestimonials hidden until real reviews */}
      <EdChangelog t={t} />
      <EdPricing t={t} />
      <EdFooter t={t} />
    </div>
  );
};
