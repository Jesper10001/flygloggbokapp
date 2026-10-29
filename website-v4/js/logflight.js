/* BLADES — "In the air. Or on the ground.": the app's Log Flight screens on two iPhones fill in as you scroll, then the sheets close
   onto the dashboard and the logbook. Swiped left, a second pane shows Quicklog: one phone logs a flight in
   under ten seconds, timed by a stopwatch. The HTML holds the finished screens; without this script, or with reduced
   motion, that is what is shown. */
(() => {
  const sec = document.querySelector('.lfs');
  if (!sec) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stage = sec.querySelector('.lfs-pane-a .lfs-stage');
  const k = sec.querySelector('.lfs-pane-a .lfs-k');
  const stagesB = Array.from(sec.querySelectorAll('.lfs-stage-b'));   // the one-phone panes: Quicklog, Scan-log
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const span = (s) => s.split(',').map(Number);
  const W = 402;
  const H = 874;

  /* ---------- Place each screen on its phone (projective transform from the screen's four corners) ---------- */
  // Screen corners measured on img/phone-pilot.webp (586 × 1519) and img/phone-drone.webp (612 × 1584).
  const CORNERS = {
    left: [[89.2, 2.6], [556.3, 193.4], [564.9, 1490.0], [79.6, 1329.3]],
    right: [[20.1, 217.1], [497.8, 0.0], [529.8, 1372.2], [32.2, 1557.0]],
  };
  // Where the phones stand: side by side as in the mockup, or stacked on a phone (pilot top left, drone below right).
  const LAYOUT = {
    wide: { w: 1248, h: 2060, pilot: [5, 308.5], drone: [631, 5], tag: { pilot: [330, 1846], drone: [930, 1612] } },
    phone: { w: 1112, h: 2060, pilot: [0, 0], drone: [500, 470], tag: { pilot: [255, 1540], drone: [806, 450, 'above'] } },
  };
  const tags = Array.from(sec.querySelectorAll('.lfs-tag'));
  const groups = { pilot: sec.querySelector('.lfp-pilot'), drone: sec.querySelector('.lfp-drone') };
  const solve = (A, b) => {          // Gaussian elimination
    const n = b.length;
    for (let i = 0; i < n; i += 1) {
      let m = i;
      for (let r = i + 1; r < n; r += 1) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r;
      [A[i], A[m]] = [A[m], A[i]]; [b[i], b[m]] = [b[m], b[i]];
      for (let r = i + 1; r < n; r += 1) {
        const f = A[r][i] / A[i][i];
        for (let c = i; c < n; c += 1) A[r][c] -= f * A[i][c];
        b[r] -= f * b[i];
      }
    }
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i -= 1) {
      let s = b[i];
      for (let c = i + 1; c < n; c += 1) s -= A[i][c] * x[c];
      x[i] = s / A[i][i];
    }
    return x;
  };
  // The projective map that takes a w × h box onto four corners (top left, top right, bottom right, bottom left).
  const homography = (dst, w = W, h = H) => {
    const src = [[0, 0], [w, 0], [w, h], [0, h]];
    const A = []; const b = [];
    src.forEach(([x, y], i) => {
      const [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    });
    return solve(A, b);
  };
  const project = ([a, b, c, d, e, f, g, h], x, y) => {
    const z = g * x + h * y + 1;
    return [(a * x + b * y + c) / z, (d * x + e * y + f) / z];
  };
  const matrix3d = (dst, w = W, h = H) => {
    const [a, bb, c, d, e, f, g, hh] = homography(dst, w, h);
    return `matrix3d(${[a, d, 0, g, bb, e, 0, hh, 0, 0, 1, 0, c, f, 0, 1].map((n) => +n.toFixed(9)).join(',')})`;
  };
  sec.querySelectorAll('.lf-screen').forEach((s) => { s.style.transform = matrix3d(CORNERS[s.dataset.screen]); });

  /* ---------- The one-phone panes (Quicklog, Scan-log): as the form fills in, the phone turns to face you and comes a
     little closer. The screen's corners move from the photographed phone's to a straight-on screen; a straight frame
     follows them as the photograph fades. ---------- */
  const BZ0 = 14;                                    // the frame around the 402 × 874 screen
  const solos = Array.from(sec.querySelectorAll('.lfs-pane-b .lfp-solo')).map((box) => {
    const scr = box.querySelector('.lf-screen');
    const flat = document.createElement('div');
    flat.className = 'lfp-flat';
    flat.setAttribute('aria-hidden', 'true');
    box.insertBefore(flat, scr);
    return { scr, flat, img: box.querySelector('.lfp-img'), k: -1 };
  });
  // Straight on, in the 612 × 1584 box of the phone photograph: as large as fits, a little over its sides.
  const SS = Math.min((1584 * 0.9) / (H + 2 * BZ0), (612 * 1.08) / (W + 2 * BZ0));
  const SX = 306 - (W * SS) / 2;
  const SY = 792 - (H * SS) / 2;
  const STRAIGHT = [[SX, SY], [SX + W * SS, SY], [SX + W * SS, SY + H * SS], [SX, SY + H * SS]];
  const turn = (s, k) => {
    if (Math.abs(s.k - k) < 0.0005) return;
    s.k = k;
    const quad = CORNERS.right.map(([x, y], i) => [x + (STRAIGHT[i][0] - x) * k, y + (STRAIGHT[i][1] - y) * k]);
    s.scr.style.transform = matrix3d(quad);
    const hm = homography(quad);
    const frame = [[-BZ0, -BZ0], [W + BZ0, -BZ0], [W + BZ0, H + BZ0], [-BZ0, H + BZ0]].map(([x, y]) => project(hm, x, y));
    s.flat.style.transform = matrix3d(frame, W + 2 * BZ0, H + 2 * BZ0);
    s.img.style.opacity = (1 - clamp((k - 0.04) / 0.36)).toFixed(3);
    s.flat.style.opacity = clamp(k / 0.32).toFixed(3);
  };
  // Four points on each screen's corners: where the browser draws them is where the screen is on the page.
  sec.querySelectorAll('.lfs-pane-a .lf-screen').forEach((s) => {
    s.insertAdjacentHTML('beforeend', '<i class="lf-pt" style="left:0;top:0"></i><i class="lf-pt" style="right:0;top:0"></i><i class="lf-pt" style="right:0;bottom:0"></i><i class="lf-pt" style="left:0;bottom:0"></i>');
  });

  // The first pane's "Swipe for full log" and the italic half of its title
  const swipe = sec.querySelector('.lfs-pane .lfs-swipe:not(.lfs-back)');
  const em = swipe && swipe.closest('.lfs-pane').querySelector('h2 em');
  const fit = () => {
    const phone = window.matchMedia('(max-width: 820px)').matches;
    // On a phone the title is one line: the swipe hint sits centred under its italic half ("In 10 seconds.").
    if (swipe && em) {
      swipe.style.marginLeft = '';
      if (phone) {
        const base = parseFloat(getComputedStyle(swipe).marginLeft) || 0;
        const pane = swipe.closest('.lfs-pane').getBoundingClientRect();
        const b = swipe.getBoundingClientRect();
        const e = em.getBoundingClientRect();
        let x = base + (e.left + e.width / 2) - (b.left + b.width / 2);
        x = Math.min(x, base + (pane.right - 14) - b.right);     // keep clear of the right edge
        x = Math.max(x, base - (b.left - pane.left - 10));       // and of the left one
        swipe.style.marginLeft = `${x.toFixed(1)}px`;
      }
    }
    const L = phone ? LAYOUT.phone : LAYOUT.wide;
    const vh = window.innerHeight;
    const s = phone
      ? Math.min((vh - stage.offsetTop - 12) / L.h, (window.innerWidth - 12) / L.w)   // both phones fit below the title
      : Math.min(vh * 0.88, 920, vh - 140) / L.h;        // below the pane's top margin, captions included
    tags.forEach((t) => {
      const [x, y, where] = L.tag[t.dataset.for];   // a caption sits under its phone, or above it
      t.style.transform = `translate(${(x * s).toFixed(1)}px, ${(y * s).toFixed(1)}px) translate(-50%, ${where === 'above' ? '-100%' : '0'})`;
    });
    ['pilot', 'drone'].forEach((n) => { groups[n].style.left = `${L[n][0]}px`; groups[n].style.top = `${L[n][1]}px`; });
    k.style.width = `${L.w}px`; k.style.height = `${L.h}px`;
    stage.style.setProperty('--sw', `${(L.w * s).toFixed(1)}px`);
    stage.style.setProperty('--sh', `${(L.h * s).toFixed(1)}px`);
    k.style.setProperty('--k', s.toFixed(5));
    stagesB.forEach((stageB) => {
      // One phone (612 × 1584); on a phone it shares the width with the steps beside it.
      const kB = stageB.querySelector('.lfs-kb');
      const b = phone
        ? Math.min((vh - stageB.offsetTop - 14) / 1584, (window.innerWidth * 0.62) / 612)
        : Math.min(vh * 0.84, 860, vh - 150) / 1584;
      stageB.style.setProperty('--bw', `${(612 * b).toFixed(1)}px`);
      stageB.style.setProperty('--bh', `${(1584 * b).toFixed(1)}px`);
      kB.style.setProperty('--k', b.toFixed(5));
    });
  };
  fit();
  window.addEventListener('resize', fit);

  /* ---------- Swipe between the panes (a native snap scroller; the buttons scroll it too) ---------- */
  const panes = sec.querySelector('.lfs-panes');
  const paneEls = Array.from(sec.querySelectorAll('.lfs-pane'));
  let active = 0;
  let onArrive = () => {};            // set below: the pane you swipe to starts from its beginning
  const setActive = (i) => {
    const moved = i !== active;
    active = i;
    paneEls.forEach((el, j) => { el.inert = j !== i; });
    sec.classList.toggle('lfs-full', paneEls[i].classList.contains('lfs-pane-a'));
    if (moved) onArrive();
  };
  if (panes && paneEls.length > 1) {
    setActive(0);
    sec.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', (e) => {
      const i = +b.dataset.go;
      paneEls[i].inert = false;
      const left = i * panes.clientWidth;
      panes.scrollTo({ left, behavior: reduce ? 'auto' : 'smooth' });
      // A smooth scroll can be cut short (the page itself still gliding): make sure the row gets there.
      setTimeout(() => { if (Math.abs(panes.scrollLeft - left) > 2) panes.scrollLeft = left; }, 700);
      // From the keyboard, focus follows to the other pane's button (a tap leaves no ring behind).
      const to = paneEls[i].querySelector('[data-go]');
      if (to && e.detail === 0) setTimeout(() => to.focus({ preventScroll: true }), reduce ? 0 : 450);
    }));
    let settle = 0;
    panes.addEventListener('scroll', () => {
      clearTimeout(settle);
      settle = setTimeout(() => {
        // Only once the row has come to rest on a pane (not while a finger holds it halfway).
        const w = Math.max(1, panes.clientWidth);
        const i = Math.round(panes.scrollLeft / w);
        if (i !== active && Math.abs(panes.scrollLeft - i * w) < 2) setActive(i);
      }, 90);
    }, { passive: true });
    window.addEventListener('resize', () => { panes.scrollLeft = active * panes.clientWidth; });
  }
  if (reduce) return;

  /* ---------- Full screen: a copy of each phone's screen, shown straight on (opened from the captions) ---------- */
  const fv = sec.querySelector('.fv');
  const dev = fv && fv.querySelector('.fv-dev');
  const pageScreens = { pilot: sec.querySelector('.lfp-pilot .lf-screen'), drone: sec.querySelector('.lfp-drone .lf-screen') };
  if (fv) {
    Object.entries(pageScreens).forEach(([kind, scr]) => {
      const copy = scr.cloneNode(true);
      copy.removeAttribute('style');
      copy.querySelectorAll('.lf-pt').forEach((pt) => pt.remove());
      copy.dataset.for = kind;
      dev.appendChild(copy);
    });
    sec.classList.add('fv-ready');
  }
  const fvScroll = fv && fv.querySelector('.fv-scroll');
  let fvOpen = false;
  let fvFrom = 0;                    // where the full-screen scroll started: the hint shows until you scroll
  const fvTrack = fv && fv.querySelector('.fv-track');
  // The phone plays out over the track; after it, the tail lifts the whole view away onto the next section.
  const fvMax = () => Math.max(1, fvTrack.offsetHeight - fvScroll.clientHeight);
  const fvProgress = () => clamp(fvScroll.scrollTop / fvMax());
  let fvFrame = () => {};            // set below: moves the full-screen view while it is lifted away

  /* ---------- What fills in, and when ----------
     The Log Flight sheets run on 0–1 in their markup, squeezed into the first TS of the scroll; after Save the
     sheets slide away and the screens under them (dashboard, logbook) play out on real progress. */
  const TS = 0.8;
  const sc = (el) => (el.closest('.lf-under, .lfs-pane-b, .fv-copy') ? 1 : TS);
  const spanOf = (el, attr) => el.dataset[attr].split(',').map((v) => +v * sc(el));
  const minutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  const lerpText = (from, to, f) => {
    const a = from.match(/\d+(?::\d+)?/g) || [];
    let i = 0;
    return to.replace(/\d+(?::\d+)?/g, (num) => {
      const fr = a[i++] ?? '0';
      if (num.includes(':')) {
        const t = Math.round(minutes(fr) + (minutes(num) - minutes(fr)) * f);
        return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
      }
      return String(Math.round(+fr + (+num - +fr) * f));
    });
  };
  const fmtLike = (final, f) => final.replace(/\d+(?:[.,:]\d+)*/g, (num) => {
    if (num.includes(':')) {          // h:mm
      const [hh, mm] = num.split(':').map(Number);
      const t = Math.round((hh * 60 + mm) * f);
      return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
    }
    const plain = num.replace(/,/g, '');
    const v = Math.round(parseFloat(plain) * f);
    return num.includes(',') ? v.toLocaleString('en-US') : String(v);
  });
  const typed = Array.from(sec.querySelectorAll('[data-type]')).map((el) => ({ el, full: el.textContent, ph: el.dataset.ph || '', t: spanOf(el, 'type') }));
  const ticks = Array.from(sec.querySelectorAll('[data-tick]')).map((el) => ({ el, full: el.textContent, from: el.dataset.from, t: spanOf(el, 'tick') }));
  const shows = Array.from(sec.querySelectorAll('[data-show]')).map((el) => ({ el, at: +el.dataset.show * sc(el) }));
  const sels = Array.from(sec.querySelectorAll('[data-sel]')).map((el) => ({ el, at: +el.dataset.sel * sc(el) }));
  const wins = Array.from(sec.querySelectorAll('[data-on]')).map((el) => ({ el, t: spanOf(el, 'on') }));
  const ins = Array.from(sec.querySelectorAll('[data-win]')).map((el) => ({ el, t: spanOf(el, 'win') }));     // overlays, taps
  const curs = Array.from(sec.querySelectorAll('[data-cur]')).map((el) => ({ el, t: spanOf(el, 'cur') }));    // the step being shown
  const unsels = Array.from(sec.querySelectorAll('[data-unsel]')).map((el) => ({ el, at: +el.dataset.unsel * sc(el) }));
  // The stopwatch beside the Quicklog phone: data-clock="start,stop,seconds"
  const clocks = Array.from(sec.querySelectorAll('[data-clock]')).map((el) => {
    const [a, b, secs] = el.dataset.clock.split(',').map(Number);
    return { el, a, b, secs, num: el.querySelector('b') };
  });
  const bars = Array.from(sec.querySelectorAll('[data-bar]')).map((el) => ({ el, t: spanOf(el, 'bar'), pct: parseFloat(getComputedStyle(el.closest('[style*="--pct"]') || el).getPropertyValue('--pct')) || 0 }));
  const totTwo = Array.from(sec.querySelectorAll('.tot2'));      // the drone's total, on the page and in full screen

  // Each screen scrolls so the part being filled in sits near the top.
  // Every scrolling view (a Log Flight sheet, a flight's detail); only views with data-scroll marks move.
  const screens = Array.from(sec.querySelectorAll('.lf-view')).filter((view) => view.querySelector('[data-scroll]')).map((view) => {
    const scr = view.querySelector('.lf-scr');
    return { view, scr, stops: [] };
  });
  const measure = () => {
    sec.classList.add('lfs-measure');
    screens.forEach((sc) => {
      const max = Math.max(0, sc.scr.offsetHeight - sc.view.offsetHeight);
      sc.stops = [{ t: [0, 0], y: 0 }];
      sc.scr.querySelectorAll('[data-scroll]').forEach((el) => {
        let y = 0;
        for (let n = el; n && n !== sc.scr; n = n.offsetParent) y += n.offsetTop;
        sc.stops.push({ t: spanOf(el, 'scroll'), y: Math.min(max, Math.max(0, y - 14)) });
      });
      const last = sc.stops[sc.stops.length - 1];
      const tail = sc.view.closest('.lfs-pane-b') ? [last.t[1], last.t[1] + 0.03] : [0.9 * TS, 0.93 * TS];
      sc.stops.push({ t: [Math.max(last.t[1], tail[0]), tail[1]], y: max });
    });
    sec.classList.add('lfs-notrans');
    sec.classList.remove('lfs-measure');
    void sec.offsetHeight;
    sec.classList.remove('lfs-notrans');
  };
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
  const scrollAt = (sc, p) => {
    let y = 0;
    for (let i = 1; i < sc.stops.length; i += 1) {
      const { t: [a, b], y: to } = sc.stops[i];
      const from = sc.stops[i - 1].y;
      if (p <= a) break;
      y = from + (to - from) * ease(clamp((p - a) / Math.max(0.0001, b - a)));
    }
    return y;
  };

  // A sheet slides up when opened (data-present) and away after Save (data-dismiss).
  const modals = Array.from(sec.querySelectorAll('[data-dismiss]')).map((el) => ({ el, t: el.dataset.dismiss.split(',').map(Number), pr: el.dataset.present ? el.dataset.present.split(',').map(Number) : null }));
  // Every dashboard's load ring (one per phone that ends on the dashboard)
  const rings = Array.from(sec.querySelectorAll('.db-ringw')).map((w) => {
    const db = w.closest('.db');
    return {
      from: +w.dataset.from, to: +w.dataset.to, t: w.dataset.t.split(',').map(Number),
      len: +w.querySelector('.ring').dataset.len,
      val: w.querySelector('.ring-val'), glow: w.querySelector('.ring-glow'), knob: w.querySelector('.ring-knob'),
      pct: w.querySelector('.db-pct b'), zoneEl: w.querySelector('.db-zone'),
      chip: db.querySelector('.db-chip'), zoneVal: db.querySelector('.db-r b.zn'), bar: db.querySelector('.db-bar'),
    };
  });
  const zone = (i) => (i <= 29 ? ['LOW', '#8A97A8'] : i <= 69 ? ['LIGHT', '#00C8E8'] : i <= 130 ? ['NORMAL', '#00E8A0'] : i <= 169 ? ['ELEVATED', '#FFB830'] : ['HIGH', '#FF4D6A']);
  // A new day in the isometric month (components drawn as in the app's activity calendar)
  const NS = 'http://www.w3.org/2000/svg';
  const grow = Array.from(sec.querySelectorAll('.iso-grow')).map((el) => {
    const [bx, by, h, mx] = el.dataset.iso.split(',').map(Number);
    const polys = [0, 1, 2].map(() => el.appendChild(document.createElementNS(NS, 'polygon')));
    const label = el.appendChild(document.createElementNS(NS, 'text'));
    return { el, bx, by, h, mx, polys, label, t: el.dataset.t.split(',').map(Number) };
  });
  const rgbF = (f) => `rgb(0,${Math.min(255, Math.round(200 * f))},${Math.min(255, Math.round(232 * f))})`;
  function isoDraw(g, h) {
    const { bx, by, mx, polys, label } = g;
    const bh = 3.5 + (h / mx) * 28; const ty = by - bh; const i = 0.32 + 0.68 * (h / mx);
    const pts = (a) => a.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    polys[0].setAttribute('points', pts([[bx - 16, by], [bx, by + 8], [bx, ty + 8], [bx - 16, ty]])); polys[0].setAttribute('fill', rgbF(0.24 + 0.2 * i));
    polys[1].setAttribute('points', pts([[bx + 16, by], [bx, by + 8], [bx, ty + 8], [bx + 16, ty]])); polys[1].setAttribute('fill', rgbF(0.46 + 0.32 * i));
    polys[2].setAttribute('points', pts([[bx - 16, ty], [bx, ty - 8], [bx + 16, ty], [bx, ty + 8]])); polys[2].setAttribute('fill', rgbF(0.7 + 0.55 * i));
    label.setAttribute('transform', `matrix(0.894 0.447 -0.894 0.447 ${bx.toFixed(1)} ${ty.toFixed(1)})`);
    label.setAttribute('x', '-7'); label.setAttribute('y', '2.5'); label.setAttribute('font-size', '7.5'); label.setAttribute('fill', '#0A1628');
    label.textContent = `${h.toFixed(1)}h`;
  }

  sec.classList.add('lfs-on');
  measure();

  // Progress per pane, and which pane each element is in.
  const FV = paneEls.length;                 // the panes in page order (Quicklog, full log, Scan-log), then full screen
  const pv = new Array(FV + 1).fill(0);
  const paneOf = new WeakMap();
  const P = (el) => {
    let i = paneOf.get(el);
    if (i === undefined) { i = el.closest('.fv') ? FV : Math.max(0, paneEls.indexOf(el.closest('.lfs-pane'))); paneOf.set(el, i); }
    return pv[i];
  };

  let ticking = false;
  const update = () => {
    ticking = false;
    const r = sec.getBoundingClientRect();
    const vh = window.innerHeight;
    if (r.bottom < -vh || r.top > vh * 1.5) return;
    const p = clamp(-r.top / Math.max(1, sec.offsetHeight - vh));

    // The pane on show follows the scroll; the other one waits at its start, so a swipe always begins there.
    paneEls.forEach((el, i) => { pv[i] = active === i ? p : 0; });     // a pane not on show waits at its start
    pv[FV] = fvOpen ? fvProgress() : 0;
    // The one-phone panes turn their phone straight on over the first fifth of the scene.
    solos.forEach((s) => { const k = clamp((P(s.scr) - 0.015) / 0.2); turn(s, k * k * (3 - 2 * k)); });
    if (fvOpen) { fv.classList.toggle('fv-start', Math.abs(fvScroll.scrollTop - fvFrom) < 40); fvFrame(); }

    typed.forEach(({ el, full, ph, t: [a, b] }) => {
      const f = clamp((P(el) - a) / (b - a));
      const n = Math.round(full.length * f);
      const txt = n ? full.slice(0, n) : ph;
      if (el.textContent !== txt) el.textContent = txt;
      el.classList.toggle('ph', !n);
      el.classList.toggle('typing', f > 0 && f < 1);
    });
    ticks.forEach(({ el, full, from, t: [a, b] }) => {
      const f = clamp((P(el) - a) / (b - a || 0.001));
      const txt = f >= 1 ? full : from ? lerpText(from, full, ease(f)) : fmtLike(full, f);
      if (el.textContent !== txt) el.textContent = txt;
    });
    shows.forEach(({ el, at }) => el.classList.toggle('on', P(el) >= at));
    sels.forEach(({ el, at }) => el.classList.toggle('sel', P(el) >= at));
    wins.forEach(({ el, t: [a, b] }) => { const q = P(el); el.classList.toggle('off', q < a || q >= b); });
    ins.forEach(({ el, t: [a, b] }) => { const q = P(el); el.classList.toggle('in', q >= a && q < b); });
    unsels.forEach(({ el, at }) => el.classList.toggle('sel', P(el) < at));
    curs.forEach(({ el, t: [a, b] }) => { const q = P(el); el.classList.toggle('cur', q >= a && q < b); el.classList.toggle('done', q >= b); });
    clocks.forEach(({ el, a, b, secs, num }) => {
      const f = clamp((P(el) - a) / (b - a));
      const txt = (secs * f).toFixed(1);
      if (num.textContent !== txt) num.textContent = txt;
      el.classList.toggle('run', f > 0 && f < 1);
      el.classList.toggle('done', f >= 1);
    });
    bars.forEach(({ el, t: [a, b], pct }) => el.style.setProperty('--w', (pct * clamp((P(el) - a) / (b - a))).toFixed(2)));
    totTwo.forEach((el) => el.classList.toggle('two', P(el) >= 0.25 * TS));     // 0:42 + the 2nd flight's 0:36
    screens.forEach((sc) => { sc.scr.style.transform = `translate3d(0, ${(-scrollAt(sc, P(sc.scr))).toFixed(1)}px, 0)`; });

    // After Save: the sheets slide away, the dashboard's load ring turns up, the logbook's new day grows.
    modals.forEach(({ el, t: [a, b], pr }) => {
      const q = P(el);
      const up = pr ? 1 - ease(clamp((q - pr[0]) / (pr[1] - pr[0]))) : 0;
      el.style.transform = `translate3d(0, ${((up + ease(clamp((q - a) / (b - a)))) * 105).toFixed(2)}%, 0)`;
    });
    rings.forEach((r) => {
      const f = ease(clamp((P(r.val) - r.t[0]) / (r.t[1] - r.t[0])));
      const idx = r.from + (r.to - r.from) * f;
      const pct = Math.min(idx, 200) / 200;
      r.val.style.strokeDashoffset = (r.len * (1 - pct)).toFixed(2);
      r.glow.style.strokeDashoffset = (r.len * (1 - pct)).toFixed(2);
      const ang = (135 + 270 * pct) * Math.PI / 180;
      r.knob.setAttribute('transform', `translate(${(55 + 44 * Math.cos(ang)).toFixed(2)} ${(55 + 44 * Math.sin(ang)).toFixed(2)})`);
      r.pct.textContent = String(Math.round(idx));
      const [word, col] = zone(idx);
      [r.zoneEl, r.chip].forEach((z) => { z.textContent = word; z.style.setProperty('--z', col); });
      r.zoneVal.style.setProperty('--z', col);
      r.bar.style.setProperty('--bw', `${(pct * 100).toFixed(2)}%`);
    });
    grow.forEach((g) => {
      const f = ease(clamp((P(g.el) - g.t[0]) / (g.t[1] - g.t[0])));
      g.el.style.display = f <= 0.001 ? 'none' : '';
      if (f > 0.001) isoDraw(g, g.h * f);
    });

  };
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
  // Arriving at a pane: wind the page back to the start of the scene (the stage is pinned, so nothing moves but
  // the phones' content), and that pane plays from its beginning.
  onArrive = () => {
    const top = sec.getBoundingClientRect().top;
    if (top < 0) {
      const root = document.documentElement;
      const was = root.style.scrollBehavior;
      root.style.scrollBehavior = 'auto';
      window.scrollTo(0, window.scrollY + top);
      root.style.scrollBehavior = was;
    }
    update();
  };
  window.addEventListener('resize', () => { fit(); measure(); update(); });
  // The title's final size (web font) decides how much room the phones get: fit again once fonts and images are in.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { fit(); measure(); update(); });
  window.addEventListener('load', () => { fit(); measure(); update(); });

  /* ---------- Full screen: tap a caption (or a phone), the phone comes forward straight on; scroll it through ---------- */
  if (fv) {
    const slot = fv.querySelector('.fv-slot');
    const closeBtn = fv.querySelector('.fv-x');
    const BZ = 14;                                   // frame around the 402 × 874 screen
    const DW = W + 2 * BZ;
    const DH = H + 2 * BZ;
    let kind = null;
    let opener = null;
    let cur = null;                                  // where the phone sits: slot corner + scale
    let flying = 0;
    let inFlight = false;
    let shut = [];
    let byKeys = false;                              // closed from the keyboard: focus goes back to the caption
    let handedOver = false;                          // the page under the view already waits at the next section
    const bg = fv.querySelector('.fv-bg');
    const nextSection = sec.nextElementSibling;
    const tail = fv.querySelector('.fv-tail');

    // The page phone's screen corners as drawn, grown by the frame (through the same perspective).
    const pageQuad = (k2) => {
      const pts = Array.from(pageScreens[k2].querySelectorAll('.lf-pt')).map((pt) => { const r = pt.getBoundingClientRect(); return [r.left, r.top]; });
      const hm = homography(pts);
      return [[-BZ, -BZ], [W + BZ, -BZ], [W + BZ, H + BZ], [-BZ, H + BZ]].map(([x, y]) => project(hm, x, y));
    };
    const place = () => {
      const phone = window.matchMedia('(max-width: 820px)').matches;
      const kk = phone
        ? Math.min((window.innerHeight - 56) / DH, (window.innerWidth * 0.62) / DW)
        : Math.min(window.innerHeight * 0.86, 860) / DH;
      fv.style.setProperty('--dw', `${(DW * kk).toFixed(1)}px`);
      fv.style.setProperty('--dh', `${(DH * kk).toFixed(1)}px`);
      tail.style.height = `${fvScroll.clientHeight}px`;     // exactly one screen: the view lifts away in one screen of scroll
      const r = slot.getBoundingClientRect();
      dev.style.left = `${r.left.toFixed(1)}px`;
      dev.style.top = `${r.top.toFixed(1)}px`;
      return { x: r.left, y: r.top, kk };
    };
    const slotQuad = (o) => [[o.x, o.y], [o.x + DW * o.kk, o.y], [o.x + DW * o.kk, o.y + DH * o.kk], [o.x, o.y + DH * o.kk]];
    const setQuad = (q, o) => { dev.style.transform = matrix3d(q.map(([x, y]) => [x - o.x, y - o.y]), DW, DH); };
    const fly = (from, to, o, ms, done) => {
      cancelAnimationFrame(flying);
      inFlight = true;
      const t0 = performance.now();
      const step = (now) => {
        const f = ease(clamp((now - t0) / ms));
        setQuad(from.map((pt, i) => [pt[0] + (to[i][0] - pt[0]) * f, pt[1] + (to[i][1] - pt[1]) * f]), o);
        if (f < 1) { flying = requestAnimationFrame(step); return; }
        inFlight = false;
        if (done) done();
      };
      flying = requestAnimationFrame(step);
    };
    // Everything outside the dialog is out of reach while it is open.
    const shutOut = () => {
      shut = [];
      for (let n = fv; n && n !== document.body; n = n.parentElement) {
        Array.from(n.parentElement.children).forEach((sib) => { if (sib !== n && !sib.inert) { sib.inert = true; shut.push(sib); } });
      }
    };

    const open = (k2, btn) => {
      if (kind || !paneEls[active].classList.contains('lfs-pane-a')) return;   // only from the full log
      kind = k2;
      opener = btn;
      const r = sec.getBoundingClientRect();
      const p = clamp(-r.top / Math.max(1, sec.offsetHeight - window.innerHeight));
      fv.hidden = false;
      fv.classList.remove('fv-pilot', 'fv-drone', 'fv-in');
      fv.classList.add(`fv-${k2}`);
      fv.setAttribute('aria-labelledby', `fv-h-${k2}`);
      document.documentElement.classList.add('fv-open');
      cur = place();
      fvOpen = true;
      measure();
      // Carry on from where the page is (or from the start, if the page has played it through).
      fvScroll.scrollTop = (p < 0.85 ? p : 0) * fvMax();
      handedOver = false;
      fv.style.removeProperty('--lift');
      fvFrom = fvScroll.scrollTop;
      update();
      const from = pageQuad(k2);
      setQuad(from, cur);
      pageScreens[k2].style.visibility = 'hidden';
      shutOut();
      requestAnimationFrame(() => {
        fv.classList.add('fv-in');
        fly(from, slotQuad(cur), cur, 720, () => fvScroll.focus({ preventScroll: true }));
      });
    };
    const close = (e) => {
      if (!kind || inFlight) return;
      byKeys = !e || e.type === 'keydown' || e.detail === 0;
      const k2 = kind;
      const q = pv[FV];
      bg.style.transform = '';
      fv.style.removeProperty('--lift');
      fv.classList.remove('fv-in');
      document.documentElement.classList.remove('fv-open');
      shut.forEach((el) => { el.inert = false; });
      // Back on the page at the same point of the flight.
      const top = sec.getBoundingClientRect().top + window.scrollY;
      const root = document.documentElement;
      const was = root.style.scrollBehavior;
      root.style.scrollBehavior = 'auto';
      window.scrollTo(0, top + q * (sec.offsetHeight - window.innerHeight));
      root.style.scrollBehavior = was;
      update();
      fly(slotQuad(cur), pageQuad(k2), cur, 620, () => {
        pageScreens[k2].style.visibility = '';
        fv.hidden = true;
        fvOpen = false;
        kind = null;
        update();
        if (opener && byKeys) opener.focus({ preventScroll: true });
      });
    };

    // Scrolled past the end: the view lifts away like a section of the page, and the page goes on from the next
    // section, which has been put in place underneath.
    const finish = () => {
      const k2 = kind;
      shut.forEach((el) => { el.inert = false; });
      document.documentElement.classList.remove('fv-open');
      pageScreens[k2].style.visibility = '';
      fv.hidden = true;
      fv.classList.remove('fv-in');
      fvOpen = false;
      kind = null;
      bg.style.transform = '';
      fv.style.removeProperty('--lift');
      update();
    };
    fvFrame = () => {
      if (!kind || inFlight) return;
      const vh = fvScroll.clientHeight;
      const lift = clamp(fvScroll.scrollTop - fvMax(), 0, vh);
      if (lift > 0 && !handedOver && nextSection) {
        handedOver = true;
        const root = document.documentElement;
        const was = root.style.scrollBehavior;
        root.style.scrollBehavior = 'auto';
        window.scrollTo(0, nextSection.getBoundingClientRect().top + window.scrollY);
        root.style.scrollBehavior = was;
      }
      bg.style.transform = lift ? `translate3d(0, ${(-lift).toFixed(1)}px, 0)` : '';
      fv.style.setProperty('--lift', (lift / vh).toFixed(3));
      setQuad(slotQuad({ ...cur, y: cur.y - lift }), cur);
      if (lift >= vh - 2) finish();
    };

    sec.querySelectorAll('.lfs-tag').forEach((b) => b.addEventListener('click', () => open(b.dataset.for, b)));
    ['pilot', 'drone'].forEach((k2) => {
      sec.querySelector(`.lfp-${k2}`).addEventListener('click', () => open(k2, sec.querySelector(`.lfs-tag[data-for="${k2}"]`)));
    });
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && kind) close(e); });
    fvScroll.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(update); } }, { passive: true });
    window.addEventListener('resize', () => {
      if (!kind || inFlight) return;
      cur = place();
      setQuad(slotQuad(cur), cur);
      measure();
      update();
    });
  }
  update();
})();
