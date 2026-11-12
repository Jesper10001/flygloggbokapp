/* BLADES — the motion layer: words that arrive and light up as you scroll, a pinned statement per chapter,
   the hero's parallax, the scroll progress line, counting numbers and cards that lean towards the pointer.
   Everything is visible without this script; it only hides what it is about to animate. */
(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const desktop = window.matchMedia('(min-width: 821px)');
  const root = document.documentElement;
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

  /* ---------- Split headings into words (keeps <em>, <br> and non-breaking spaces) ---------- */
  const split = (el) => {
    let i = 0;
    const walk = (node) => {
      Array.from(node.childNodes).forEach((n) => {
        if (n.nodeType === 3) {
          const parts = n.textContent.split(/( +)/);   // regular spaces only: "or&nbsp;both" stays one word
          const frag = document.createDocumentFragment();
          parts.forEach((part) => {
            if (!part) return;
            if (/^ +$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
            const w = document.createElement('span');
            w.className = 'w';
            w.style.setProperty('--i', i++);
            w.textContent = part;
            frag.appendChild(w);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1 && n.tagName !== 'BR') walk(n);
      });
    };
    walk(el);
    return Array.from(el.querySelectorAll('.w'));
  };
  const statements = Array.from(document.querySelectorAll('.say')).map((sec) => ({
    sec,
    pin: sec.querySelector('.say-pin'),
    words: split(sec.querySelector('.say-text')),
    sub: sec.querySelector('.say-sub'),
  }));
  document.querySelectorAll('.hero h1[data-split]').forEach(split);
  const revealers = Array.from(document.querySelectorAll('[data-words]'));
  revealers.forEach(split);
  root.classList.add('motion-on');

  /* ---------- Headings that rise in when they come into view ---------- */
  if (reduce || !('IntersectionObserver' in window)) {
    revealers.forEach((h) => h.classList.add('in'));
  } else {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
    }), { rootMargin: '0px 0px -12% 0px' });
    revealers.forEach((h) => io.observe(h));
  }

  /* ---------- Numbers count up once ---------- */
  const fmt = (n) => Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');
  const counters = Array.from(document.querySelectorAll('[data-count]'));
  const count = (el) => {
    const to = +el.dataset.count;
    const from = el.dataset.from ? +el.dataset.from : 0;
    if (reduce) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    const dur = 1600;
    const tick = (t) => {
      const k = clamp((t - t0) / dur);
      const e = 1 - (1 - k) ** 4;
      el.textContent = fmt(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(tick);
    };
    el.textContent = fmt(from);
    requestAnimationFrame(tick);
  };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (e.isIntersecting) { count(e.target); io.unobserve(e.target); }
    }), { threshold: 0.6 });
    counters.forEach((c) => io.observe(c));
  }

  /* ---------- Scroll: progress line, pinned statements, hero parallax, band boost ---------- */
  const bar = document.querySelector('.progress');
  const heroImg = document.querySelector('.hero-img');
  const heroText = document.querySelector('.hero-text');
  let lastY = window.scrollY;
  let lastT = performance.now();
  let boost = 0;
  let ticking = false;

  const update = () => {
    ticking = false;
    const y = window.scrollY;
    const vh = window.innerHeight;
    const max = document.documentElement.scrollHeight - vh;
    if (bar) bar.style.setProperty('--sp', max > 0 ? (y / max).toFixed(4) : 0);

    if (!reduce) {
      // Each statement: words light up over the first 70% of its pinned stretch, the line under it last.
      statements.forEach(({ sec, pin, words, sub }) => {
        const r = sec.getBoundingClientRect();
        if (r.bottom < -vh || r.top > vh * 1.5) return;
        const span = Math.max(1, sec.offsetHeight - vh);
        const p = clamp(-r.top / span);
        const n = words.length;
        const t = clamp(p / 0.68) * (n + 0.9);       // every word fully lit by 68% of the stretch
        words.forEach((w, i) => w.style.setProperty('--p', clamp(t - i).toFixed(3)));
        if (sub) sub.style.setProperty('--s', clamp((p - 0.72) / 0.18).toFixed(3));
        pin.style.setProperty('--g', clamp(p * 1.4).toFixed(3));
      });

      // Hero: the picture sinks a little slower than the page and the words drift up and fade.
      if (heroImg && y < vh * 1.3) {
        if (desktop.matches) {
          heroImg.style.translate = `0 ${(y * 0.28).toFixed(1)}px`;
          heroImg.style.scale = (1 + y * 0.00012).toFixed(4);
          heroText.style.translate = `0 ${(-y * 0.12).toFixed(1)}px`;
          heroText.style.opacity = clamp(1 - y / (vh * 0.75)).toFixed(3);
        } else {
          heroImg.style.translate = '';
          heroImg.style.scale = (1 + y * 0.00018).toFixed(4);
          heroText.style.translate = '';
          heroText.style.opacity = '';
        }
      }
    }
  };

  // Scrolling fast nudges the image band along (js/site.js reads window.bladesScrollBoost).
  const decay = () => {
    boost *= 0.9;
    window.bladesScrollBoost = boost;
    if (boost > 1) requestAnimationFrame(decay); else window.bladesScrollBoost = 0;
  };
  window.addEventListener('scroll', () => {
    const now = performance.now();
    const v = Math.abs(window.scrollY - lastY) / Math.max(8, now - lastT) * 1000;
    lastY = window.scrollY; lastT = now;
    if (!reduce) {
      const start = boost <= 1;
      boost = Math.min(700, Math.max(boost, v * 0.35));
      if (start) requestAnimationFrame(decay);
    }
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }, { passive: true });
  window.addEventListener('resize', update);
  update();

  /* ---------- Role cards lean towards the pointer (desktop) ---------- */
  if (!reduce && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    document.querySelectorAll('.role-card').forEach((card) => {
      card.addEventListener('pointermove', (e) => {
        const r = card.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width;
        const py = (e.clientY - r.top) / r.height;
        card.style.transform = `perspective(900px) rotateX(${((0.5 - py) * 6).toFixed(2)}deg) rotateY(${((px - 0.5) * 7).toFixed(2)}deg) translateY(-4px)`;
        card.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
        card.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
        card.style.setProperty('--glow', 1);
      });
      card.addEventListener('pointerleave', () => {
        card.style.transform = '';
        card.style.setProperty('--glow', 0);
      });
    });
  }
})();
