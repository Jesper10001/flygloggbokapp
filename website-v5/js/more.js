/* BLADES — "And much more": the app's other features, one slide after another. The global map comes first (the live
   globe and airport search, js/demo.js and js/airport.js); each following slide shows one feature at work, its screen
   rebuilt in HTML from the app's own components, played from the start whenever its slide comes up.
   The slides move on by themselves; they hold while a pointer rests on them, while something in them has the focus and
   while they are out of view, and stop once the airport search is used. The tabs (or a swipe) go to any slide. */
(() => {
  const root = document.getElementById('more');
  if (!root) return;
  const stage = root.querySelector('.more-stage');
  const slides = Array.from(stage.querySelectorAll('.more-slide'));
  if (slides.length < 2) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const DWELL = { globe: 9000, daynight: 10000 };     // ms on a slide (the rest: SLIDE)
  const SLIDE = 8000;

  root.classList.add('more-on');

  /* ---------- Tabs ---------- */
  const bar = document.createElement('div');
  bar.className = 'more-bar';
  bar.innerHTML = `<div class="more-tabs" role="tablist" aria-label="Features">${slides.map((s, i) => `<button type="button" class="more-tab" role="tab" id="more-tab-${i}" aria-selected="false" aria-controls="more-slide-${i}">${s.dataset.name}</button>`).join('')}</div>`;
  stage.insertAdjacentElement('beforebegin', bar);
  const tabsBox = bar.querySelector('.more-tabs');
  const tabs = Array.from(tabsBox.children);
  slides.forEach((s, i) => {
    if (!s.id) s.id = `more-slide-${i}`;
    tabs[i].setAttribute('aria-controls', s.id);
    s.setAttribute('role', 'tabpanel');
    s.setAttribute('aria-labelledby', tabs[i].id);
  });

  /* ---------- The demos (filled in below, one per slide) ---------- */
  const DEMOS = window.bladesMoreDemos || {};
  const built = new Set();
  const demoOf = (s) => DEMOS[s.dataset.demo];

  let at = -1;
  let stopped = reduce;
  const holds = new Set();
  let t0 = 0;              // when the slide shown began (moved on by the pause)
  let spent = 0;           // ms of the slide shown already played, while held
  let raf = 0;

  function show(i, dir) {
    const n = slides.length;
    const to = ((i % n) + n) % n;
    if (to === at) return;
    const from = at;
    root.style.setProperty('--dir', String(dir || (from < 0 || to > from ? 1 : -1)));
    slides.forEach((s, k) => {
      s.classList.toggle('is-on', k === to);
      s.classList.toggle('was-on', k === from);
      s.inert = k !== to;
    });
    tabs.forEach((t, k) => { t.setAttribute('aria-selected', String(k === to)); t.style.setProperty('--p', '0'); t.tabIndex = k === to ? 0 : -1; });
    // The tab row follows along on a narrow screen.
    const tab = tabs[to];
    tabsBox.scrollTo({ left: tab.offsetLeft - (tabsBox.clientWidth - tab.offsetWidth) / 2, behavior: reduce ? 'auto' : 'smooth' });
    // The demo leaving stops; the one arriving plays from the start.
    if (from >= 0 && demoOf(slides[from]) && demoOf(slides[from]).stop) demoOf(slides[from]).stop(slides[from]);
    at = to;
    const s = slides[to];
    const d = demoOf(s);
    if (d) {
      const box = s.querySelector('.more-demo');
      if (!built.has(s) && d.build) { d.build(box, s); built.add(s); }
      if (d.play) d.play(box, s, reduce);
    }
    // The globe only turns while it can be seen.
    if (window.bladesGlobe) { if (s.dataset.demo === 'globe') { if (window.bladesGlobe.resume) window.bladesGlobe.resume(); } else if (window.bladesGlobe.pause) window.bladesGlobe.pause(); }
    t0 = performance.now();
    spent = 0;
  }

  /* ---------- Moving on by itself ---------- */
  const dwell = () => DWELL[slides[at].dataset.demo] || SLIDE;
  const running = () => !stopped && !holds.size;
  function tick(now) {
    raf = requestAnimationFrame(tick);
    if (!running()) { t0 = now - spent; return; }
    spent = now - t0;
    const p = clamp(spent / dwell());
    tabs[at].style.setProperty('--p', p.toFixed(4));
    if (p >= 1) show(at + 1, 1);
  }
  function setStopped(v) { stopped = v; }
  const hold = (why, on) => { if (on) holds.add(why); else holds.delete(why); };

  tabs.forEach((t, k) => t.addEventListener('click', () => show(k)));
  tabsBox.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    show(at + (e.key === 'ArrowRight' ? 1 : -1));
    tabs[at].focus();
  });
  // A pointer resting on the slides holds them; the airport search in use holds them too.
  stage.addEventListener('mouseenter', () => hold('hover', true));
  stage.addEventListener('mouseleave', () => hold('hover', false));
  stage.addEventListener('focusin', () => hold('focus', true));
  stage.addEventListener('focusout', () => hold('focus', false));
  // Searching for an airport, or opening one, stops the slides (the card stays to be read).
  stage.addEventListener('input', () => setStopped(true));
  stage.addEventListener('click', (e) => { if (e.target.closest('.ap-try button, .ap-row')) setStopped(true); });
  // A sideways swipe goes to the next or the previous slide.
  let sw = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('input, button, a, .ap-list, .ap-result')) return;
    sw = { x: e.clientX, y: e.clientY, id: e.pointerId };
  });
  stage.addEventListener('pointerup', (e) => {
    if (!sw || e.pointerId !== sw.id) return;
    const dx = e.clientX - sw.x;
    const dy = e.clientY - sw.y;
    sw = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) show(at + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
  });
  stage.addEventListener('pointercancel', () => { sw = null; });

  // Out of view the slides hold (and the globe rests).
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      const seen = entries.some((e) => e.isIntersecting);
      hold('away', !seen);
    }, { threshold: 0.25 }).observe(stage);
  }
  // A link to the airport search (#airports) brings its slide.
  const toHash = () => { const k = slides.findIndex((s) => `#${s.id}` === location.hash); if (k >= 0) show(k); };
  window.addEventListener('hashchange', toHash);

  setStopped(stopped);
  show(0);
  toHash();
  raf = requestAnimationFrame(tick);
})();
