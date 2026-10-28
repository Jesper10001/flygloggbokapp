/* BLADES — the flowing feature band (hold to stop, drag to move), and gentle entrances as sections scroll into view. Content is never left hidden. */
(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Feature band: flows on its own, stops while you hold it, follows your drag ---------- */
  const marquee = document.querySelector('.marquee');
  if (marquee) {
    const SPEED = 34;         // px per second when flowing
    const RESUME = 1600;      // ms of stillness after you let go before it flows again
    const strip = marquee.querySelector('.strip');
    const set = strip.querySelector('.set');
    strip.querySelectorAll('img').forEach((img) => { img.draggable = false; });

    // Copies of the set make the loop seamless; they are hidden from screen readers and keyboard.
    const copies = [];
    const addCopy = () => {
      const c = set.cloneNode(true);
      c.setAttribute('aria-hidden', 'true');
      c.inert = true;
      strip.appendChild(c);
      copies.push(c);
    };
    addCopy();

    let period = 0;           // width of one set, gap included
    let x = 0;                // how far the band has travelled, wrapped into [0, period)
    let speed = 0;            // current flow speed (eases in and out)
    let fling = 0;            // momentum after a drag, px per second
    let held = false;
    let focusHeld = false;
    let resumeAt = 0;
    const wrap = (n) => ((n % period) + period) % period;
    const measure = () => {
      period = copies[0].offsetLeft - set.offsetLeft;
      while (strip.scrollWidth < period + marquee.clientWidth + 40) addCopy();
      x = wrap(x);
    };
    measure();
    // Start with the first card in the middle of the screen.
    const first = set.firstElementChild;
    x = wrap(first.offsetWidth / 2 - marquee.clientWidth / 2);

    let raf = 0;
    let last = 0;
    let visible = true;
    const frame = (t) => {
      const dt = last ? Math.min(0.05, (t - last) / 1000) : 0;
      last = t;
      if (!held) {
        if (fling) {
          x += fling * dt;
          fling *= Math.pow(0.03, dt);
          if (Math.abs(fling) < 8) fling = 0;
        }
        const want = reduce || focusHeld || t < resumeAt ? 0 : SPEED;
        speed += (want - speed) * Math.min(1, dt * 2);
        x += (speed + (window.bladesScrollBoost || 0)) * dt;
      }
      x = wrap(x);
      const dpr = window.devicePixelRatio || 1;
      strip.style.transform = `translate3d(${-Math.round(x * dpr) / dpr}px, 0, 0)`;
      raf = requestAnimationFrame(frame);
    };
    const start = () => { if (!raf && visible && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); } };
    const stop = () => { cancelAnimationFrame(raf); raf = 0; };

    // Hold to stop; drag to move it; let go and it glides, then flows on.
    let lastX = 0;
    let lastT = 0;
    let vel = 0;
    marquee.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      held = true;
      speed = 0;
      fling = 0;
      vel = 0;
      lastX = e.clientX;
      lastT = e.timeStamp;
      marquee.classList.add('is-held');
      marquee.setPointerCapture(e.pointerId);
    });
    marquee.addEventListener('pointermove', (e) => {
      if (!held) return;
      const dx = e.clientX - lastX;
      const dtm = Math.max(1, e.timeStamp - lastT);
      x -= dx;
      vel = 0.7 * (-dx / dtm) * 1000 + 0.3 * vel;
      lastX = e.clientX;
      lastT = e.timeStamp;
    });
    const letGo = (e) => {
      if (!held) return;
      held = false;
      marquee.classList.remove('is-held');
      const fresh = e.timeStamp - lastT < 90;
      fling = fresh && !reduce ? Math.max(-2600, Math.min(2600, vel)) : 0;
      resumeAt = performance.now() + RESUME;
    };
    marquee.addEventListener('pointerup', letGo);
    marquee.addEventListener('pointercancel', letGo);

    // Keyboard: focus stops the flow, the arrow keys move it by a card.
    marquee.addEventListener('focus', () => { focusHeld = marquee.matches(':focus-visible'); });
    marquee.addEventListener('blur', () => { focusHeld = false; resumeAt = performance.now() + RESUME; });
    marquee.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      focusHeld = true;
      fling = (e.key === 'ArrowRight' ? 1 : -1) * first.offsetWidth * 3;
    });

    // Only run while it can be seen.
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) start(); else stop(); }).observe(marquee);
    }
    window.addEventListener('resize', measure);
    window.addEventListener('load', measure);
    start();
  }

  /* ---------- Entrances ---------- */
  const els = [];
  const add = (sel, gap = 90) => {
    document.querySelectorAll(sel).forEach((group) => {
      Array.from(group.children).forEach((el, i) => {
        if (el.matches('[data-words]')) return;
        el.classList.add('rv');
        el.style.setProperty('--d', `${Math.min(i, 6) * gap}ms`);
        els.push(el);
      });
    });
  };
  add('.roles');
  add('.role-cards', 110);
  add('.cards');
  add('.pricing');
  add('.plans', 120);
  add('.faq');
  add('.closer');

  if (reduce || !('IntersectionObserver' in window)) {
    els.forEach((el) => el.classList.add('in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    });
  }, { rootMargin: '0px 0px -6% 0px', threshold: 0.01 });
  els.forEach((el) => io.observe(el));
  setTimeout(() => els.forEach((el) => el.classList.add('in')), 5000);
})();
