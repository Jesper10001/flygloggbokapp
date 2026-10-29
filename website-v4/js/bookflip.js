/* BLADES — "Appears as it would in your actual logbook": the pilot logbook, or at the button, the drone logbook (one
   at a time, in the same place). Each is a 120-page book, open at the latest flight with filled pages before it and
   blank ones after, rendered by the app's own code from the demo logbooks (img/book/<kind>-<page>.webp).
   Once in view the book opens on its contents page and leafs through to the latest spread. On a phone the camera then
   comes in close, past the edges of the screen, travels across the spread (a finger can take over) and pulls back out.
   From then on the book is open to read: a swipe, a drag, a click on a page, the arrow keys or the buttons below turn
   the pages, back to the older flights or on to the blank pages. Without this script, or with reduced motion, the
   latest spread is shown as the app's HTML (demo/logbook-*.html). */
(() => {
  const sec = document.getElementById('logbook');
  if (!sec) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const phone = window.matchMedia('(max-width: 820px)');
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

  /* ---------- The spread as HTML (shown without the book): the app's page at its own size, scaled to the frame ---------- */
  const tracks = Array.from(sec.querySelectorAll('.book-track'));
  tracks.forEach((track) => {
    const frame = track.querySelector('.book-frame');
    const spread = track.querySelector('.book');
    const sizer = document.createElement('div');
    sizer.className = 'book-size';
    spread.parentNode.insertBefore(sizer, spread);
    sizer.appendChild(spread);
    const fit = () => {
      let doc;
      try { doc = spread.contentDocument; } catch (e) { return; }
      if (!doc || !doc.body) return;
      // Measure the spread's own size: shrink the frame first, so it isn't laid out in a width it was given before.
      spread.style.width = '10px';
      const w = Math.max(doc.documentElement.scrollWidth, doc.body.scrollWidth);
      spread.style.width = `${w}px`;
      spread.style.height = '10px';
      const h = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight);
      spread.style.height = `${h}px`;
      const s = phone.matches ? Math.max(0.5, frame.clientWidth / w) : Math.min(1, frame.clientWidth / w);
      spread.style.transform = `scale(${s})`;
      sizer.style.width = `${w * s}px`;
      sizer.style.height = `${h * s}px`;
    };
    spread.addEventListener('load', fit);
    window.addEventListener('resize', fit);
    if (spread.contentDocument && spread.contentDocument.readyState === 'complete') fit();
  });

  /* ---------- Two panes, one shown at a time: pilot, and at its button, drone ---------- */
  const paneEls = Array.from(sec.querySelectorAll('.lbk-pane'));
  let active = Math.max(0, paneEls.findIndex((el) => el.classList.contains('on')));
  let books = [];                   // filled below (none with reduced motion)
  paneEls.forEach((el, j) => { el.inert = j !== active; });
  const show = (i, fromKeyboard) => {
    if (i === active || !paneEls[i]) return;
    const from = paneEls[active];
    const to = paneEls[i];
    const book = books.find((b) => b.pane === to);
    const old = books.find((b) => b.pane === from);
    if (old) old.stop();
    sec.style.setProperty('--lbk-dir', i > active ? '1' : '-1');
    from.classList.remove('on', 'entering');
    from.inert = true;
    to.inert = false;
    to.classList.add('on');
    if (!reduce) {
      from.classList.add('leaving');
      to.classList.add('entering');
      setTimeout(() => { from.classList.remove('leaving'); to.classList.remove('entering'); }, 450);
    }
    active = i;
    // From the keyboard, focus follows to the button in the pane now shown (a tap leaves no ring behind).
    const btn = to.querySelector('[data-go]');
    if (btn && fromKeyboard) btn.focus({ preventScroll: true });
    // The book comes out and plays at once.
    if (book) { book.measure(); book.seen = true; book.play(); }
  };
  sec.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', (e) => show(+b.dataset.go, e.detail === 0)));
  if (reduce) return;

  /* ---------- The books ---------- */
  // The spreads there are pictures of (left page numbers), and the latest flight's spread (scratchpad render-book.cjs).
  const BOOKS = {
    pilot: { first: 63, last: 85, latest: 79, ratio: 549 / 1514, cover: 'PILOT<br>LOGBOOK' },
    drone: { first: 41, last: 63, latest: 57, ratio: 753 / 1410, cover: 'REMOTE PILOT<br>LOGBOOK' },
  };
  const LEAVES = 5;                // pages turned by the opening: the contents, then the four spreads before the latest
  const DURATION = 6200;           // ms of the opening, from the closed cover to the latest spread
  const FLIPPED = 0.8;             // the last page has turned
  const GROWN = 0.88;              // on a computer the book has grown to the frame
  const FIT = 0.92;                // the book's size once open (render: --fz)
  const BOARD = 0.516;             // half the book's width, boards included, as a share of the pages' width
  const SHARP = window.devicePixelRatio >= 1.5;

  function makeBook(track) {
    const kind = track.dataset.book === 'drone' ? 'drone' : 'pilot';
    const B = BOOKS[kind];
    const pane = track.closest('.lbk-pane');
    const stage = track.querySelector('.book-stage');
    const frame = track.querySelector('.book-frame');
    const spreads = [];
    for (let p = B.first; p <= B.last; p += 2) spreads.push(p);
    const LATEST = spreads.indexOf(B.latest);
    // A page's picture: sharp on a high-density computer screen, and for the spread seen close up on a phone.
    const url = (page) => {
      const hi = phone.matches ? page === B.latest || page === B.latest + 1 : SHARP;
      return `img/book/${kind}-${page}${hi ? '-2x' : ''}.webp?v=1`;
    };
    const tocUrl = () => `img/book/${kind}-toc${SHARP && !phone.matches ? '-2x' : ''}.webp?v=1`;
    const L = (i) => url(spreads[i]);         // left page of spread i
    const R = (i) => url(spreads[i] + 1);     // right page of spread i
    const loaded = new Set();
    const preload = (urls) => Promise.all(urls.filter((u) => !loaded.has(u)).map((u) => new Promise((res) => {
      const im = new Image();
      im.onload = im.onerror = () => { loaded.add(u); res(); };
      im.src = u;
    })));
    const setImg = (face, u) => { face.style.backgroundImage = `url(${u})`; };

    /* Build it */
    const flip = document.createElement('div');
    flip.className = 'flip';
    flip.setAttribute('aria-hidden', 'true');
    const book = document.createElement('div');
    book.className = 'flip-book';
    const shadow = document.createElement('div');
    shadow.className = 'flip-shadow';
    // The boards of the binding, a little larger than the pages; the left one shows once the cover is open.
    const boardR = document.createElement('div');
    boardR.className = 'flip-board r';
    const boardL = document.createElement('div');
    boardL.className = 'flip-board l';
    // The pages already turned, seen as a block of edges on the left.
    const blockL = document.createElement('div');
    blockL.className = 'flip-block l';
    const base = document.createElement('div');           // the right-hand page lying open, under the pages to turn
    base.className = 'flip-base';
    base.innerHTML = '<div class="face front paper"></div>';
    book.append(boardR, boardL, blockL, base);
    const leaves = [];
    for (let i = 0; i <= LEAVES; i += 1) {
      const leaf = document.createElement('div');
      leaf.className = 'leaf';
      leaf.innerHTML = i === 0
        ? `<div class="face front cover"><div class="cover-in"><img src="img/blades-mark-128.png" alt=""><span class="cover-title">${B.cover}</span><span class="cover-sub">BLADES</span></div></div><div class="face back endpaper"></div>`
        : '<div class="face front paper"></div><div class="face back paper"></div>';
      book.appendChild(leaf);
      leaves.push(leaf);
    }
    // The page being turned by hand, over the open spread.
    const turner = document.createElement('div');
    turner.className = 'leaf leaf-turn';
    turner.innerHTML = '<div class="face front paper"></div><div class="face back paper"></div>';
    turner.hidden = true;
    book.appendChild(turner);
    flip.append(shadow, book);
    stage.appendChild(flip);
    track.classList.add('flip-on');
    // The book takes the keyboard (arrow keys turn the pages); the hidden spread behind it does not.
    frame.tabIndex = -1;
    stage.tabIndex = 0;
    stage.setAttribute('role', 'group');
    stage.setAttribute('aria-label', `${kind === 'drone' ? 'Drone' : 'Pilot'} logbook, open at the latest flight. The arrow keys turn the pages.`);
    const openLeft = leaves[LEAVES].children[1];           // the left page lying open (the last leaf turned)
    const openRight = base.firstElementChild;

    // Under the book: which pages are open, and a button either way.
    const nav = document.createElement('div');
    nav.className = 'book-nav';
    nav.innerHTML = '<button type="button" class="bn-btn" data-turn="-1" aria-label="Previous pages"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg></button>'
      + '<span class="bn-pages" aria-live="polite"></span>'
      + '<button type="button" class="bn-btn" data-turn="1" aria-label="Next pages"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>'
      + '<span class="bn-hint"></span>';
    stage.insertAdjacentElement('afterend', nav);
    const navPages = nav.querySelector('.bn-pages');
    const navHint = nav.querySelector('.bn-hint');
    const [prevBtn, nextBtn] = nav.querySelectorAll('.bn-btn');

    // The opening's pages: leaf i shows the right page of the spread before on its front (leaf 1: the contents) and
    // the left page of its own spread on its back, ending on the latest spread.
    const paintOpening = () => {
      const urls = [];
      leaves.forEach((leaf, i) => {
        if (!i) return;
        const s = LATEST - LEAVES + i;
        const front = i === 1 ? tocUrl() : R(s - 1);
        setImg(leaf.children[0], front);
        setImg(leaf.children[1], L(s));
        urls.push(front, L(s));
      });
      setImg(openRight, R(LATEST));
      urls.push(R(LATEST));
      // Ready when the pages have loaded (or after a moment, so a slow connection still sees the book move).
      return Promise.race([preload(urls), new Promise((res) => setTimeout(res, 1400))]);
    };

    /* Size: the book takes the shape of the spread */
    let bookW = 0;
    let bookH = 0;
    function measure() {
      bookW = frame.clientWidth;
      bookH = Math.round(bookW * B.ratio);
      flip.style.setProperty('--fw', `${bookW}px`);
      flip.style.setProperty('--fh', `${bookH}px`);
      render(shown);
    }

    /* Reading: the book open at spread idx, its pages turned by hand */
    let idx = LATEST;
    let browsing = false;
    let turning = null;              // { dir, t, raf }
    const edges = () => String(5 + Math.round((idx - LATEST) / 2));    // the block of turned pages grows as you read on

    /* One moment of the opening
         0.00–0.21  the cover opens and the book slides to the middle; the contents page shows
         0.25–0.80  the pages leaf through to the latest spread
         0.80–0.88  on a computer the book grows to the width of the frame (on a phone it is seen close up instead) */
    let shown = 0;
    function render(p) {
      shown = p;
      const open = ease(clamp(p / 0.21));
      let turned = 0;
      leaves.forEach((leaf, i) => {
        // The contents page is held a moment before it turns; the record pages then follow one another.
        const start = i === 1 ? 0.25 : 0.34 + (i - 2) * 0.097;
        const t = i === 0 ? open : ease(clamp((p - start) / 0.17));
        leaf.style.setProperty('--r', t.toFixed(4));
        leaf.style.zIndex = t > 0.5 ? 10 + i : 40 - i;    // turned pages pile up on the left, newest on top
        leaf.style.setProperty('--sh', (Math.sin(t * Math.PI) * 0.9).toFixed(3));
        if (i && t > 0.5) turned += 1;
      });
      flip.style.setProperty('--tl', browsing ? edges() : String(turned));
      flip.style.setProperty('--open', open.toFixed(4));
      flip.style.setProperty('--landed', clamp((open - 0.9) / 0.1).toFixed(4));   // the cover lies flat on the left
      flip.style.setProperty('--shift', (1 - open).toFixed(4));
      const grow = phone.matches ? 0 : ease(clamp((p - FLIPPED) / (GROWN - FLIPPED)));
      const z0 = phone.matches ? 1 : 0.8;              // the closed book, larger on a phone
      flip.style.setProperty('--fz', (z0 + open * (FIT - z0) + grow * (1 - FIT)).toFixed(4));
      aim();
    }

    /* Phone: the book seen close up
       The camera comes in on the open book until it reaches past both edges of the screen, travels across it from the
       left edge to the right one (so the book moves left through the screen), and pulls back out. cam.z: how close
       (0 = the whole book, 1 = close up); cam.u: where along the spread (0 = its left edge, 1 = its right edge; a
       little past either while a finger pulls on). */
    const cam = { z: 0, u: 0, s: 3, span: 1, held: false };
    function aim() {
      const w = bookW;
      const h = bookH;
      if (!phone.matches) {
        frame.style.height = `${h}px`;
        track.classList.remove('flip-near');
        flip.style.removeProperty('--zx');
        flip.style.removeProperty('--zy');
        return;
      }
      // The stage is as tall as the book is now, so the text below follows it.
      const s = FIT + (cam.s - FIT) * cam.z;
      const fitTop = ((1 - FIT) * h) / 2 - FIT * h * 0.018;     // the boards' top edge with the whole book in view
      const top = fitTop + (4 - fitTop) * cam.z;
      const bottom = top + s * h * 1.044;                         // boards included
      frame.style.height = `${Math.max(h, bottom + s * h * 0.05 + 6 * cam.z).toFixed(1)}px`;
      track.classList.toggle('flip-near', cam.z > 0);
      // Close up, the book is laid out at that size rather than scaled to it, so the browser draws it sharp; from
      // then on it is only moved.
      const near = cam.z >= 1;
      flip.style.setProperty('--fw', `${near ? w * s : w}px`);
      flip.style.setProperty('--fh', `${near ? h * s : h}px`);
      if (!cam.z) { flip.style.removeProperty('--zx'); flip.style.removeProperty('--zy'); return; }
      flip.style.setProperty('--fz', near ? '1' : s.toFixed(4));
      const cx = near ? ((s - 1) * w) / 2 : 0;                   // its middle, laid out larger, sits further in
      const cy = near ? ((s - 1) * h) / 2 : 0;
      // Where the screen's edges are, seen from the stage.
      const left = -stage.getBoundingClientRect().left + pane.getBoundingClientRect().left;
      const right = left + pane.clientWidth;
      const edge = 12 + 6 * s;                                    // a little air, and the page edges
      const x0 = left + edge - w / 2 + s * w * BOARD;            // the book's left edge at the screen's left
      const x1 = right - edge - w / 2 - s * w * BOARD;           // its right edge at the screen's right
      cam.span = Math.max(1, x0 - x1);
      // Coming in, the book's left edge goes straight to its place at the screen's edge; then the camera travels;
      // pulling out, it eases back from wherever it is to the whole book.
      const fitLeft = w / 2 - FIT * w * BOARD;
      const leftEdge = fitLeft + (left + edge - fitLeft) * cam.z;
      const zx = leftEdge - (w / 2 - s * w * BOARD) + (x1 - x0) * cam.u * cam.z;
      flip.style.setProperty('--zx', `${(zx - cx).toFixed(1)}px`);
      flip.style.setProperty('--zy', `${(top - (((1 - s) * h) / 2 - s * h * 0.018) - cy).toFixed(1)}px`);
    }

    const label = () => {
      const p = spreads[idx];
      navPages.textContent = `Pages ${p}–${p + 1}`;
      prevBtn.disabled = idx <= 0;
      nextBtn.disabled = idx >= spreads.length - 1;
    };
    // The spreads either side, ready before they are turned to.
    const readyNear = () => {
      const urls = [];
      if (idx > 0) urls.push(L(idx - 1), R(idx - 1));
      if (idx < spreads.length - 1) urls.push(L(idx + 1), R(idx + 1));
      preload(urls);
    };
    function browse() {
      browsing = true;
      playing = false;
      track.classList.add('flip-done', 'flip-browse');
      flip.style.setProperty('--tl', edges());
      navHint.textContent = phone.matches ? 'Swipe to turn the page' : 'Drag, click a page or use the arrow keys';
      label();
      readyNear();
    }
    // Start a turn: forward lifts the right page, back lifts the left one; the pages under it already show.
    function lift(dir) {
      if (turning || !browsing) return false;
      const to = idx + dir;
      if (to < 0 || to >= spreads.length) return false;
      const [front, back] = turner.children;
      if (dir > 0) {
        setImg(front, R(idx)); setImg(back, L(to)); setImg(openRight, R(to));
      } else {
        setImg(front, R(to)); setImg(back, L(idx)); setImg(openLeft, L(to));
      }
      turner.hidden = false;
      turning = { dir, t: 0, raf: 0 };
      bend(0);
      return true;
    }
    // How far the page has turned (0 = still lying, 1 = over).
    function bend(t) {
      turning.t = t;
      const r = turning.dir > 0 ? t : 1 - t;
      turner.style.setProperty('--r', r.toFixed(4));
      turner.style.setProperty('--sh', (Math.sin(r * Math.PI) * 0.9).toFixed(3));
    }
    // Let go: the page falls over (or back), then the open spread takes its new pages.
    function settle(over, ms = 460) {
      if (!turning) return;
      const t0 = performance.now();
      const from = turning.t;
      const to = over ? 1 : 0;
      const dur = Math.max(140, ms * Math.abs(to - from));
      const step = (now) => {
        const k = clamp((now - t0) / dur);
        bend(from + (to - from) * ease(k));
        if (k < 1) { turning.raf = requestAnimationFrame(step); return; }
        const { dir } = turning;
        if (over) {
          idx += dir;
          if (dir > 0) setImg(openLeft, L(idx)); else setImg(openRight, R(idx));
        } else if (dir > 0) setImg(openRight, R(idx));
        else setImg(openLeft, L(idx));
        turner.hidden = true;
        turning = null;
        flip.style.setProperty('--tl', edges());
        label();
        readyNear();
      };
      turning.raf = requestAnimationFrame(step);
    }
    const turn = (dir) => { if (lift(dir)) settle(true, 620); };
    nav.addEventListener('click', (e) => {
      const b = e.target.closest('[data-turn]');
      if (b && !b.disabled) turn(+b.dataset.turn);
    });
    stage.addEventListener('keydown', (e) => {
      if (!browsing) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); turn(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); turn(-1); }
    });

    /* Play the opening */
    let raf = 0;
    let playing = false;
    let idle = 0;                    // close up, after a finger has let go: pull out after a pause
    function pullOut() {
      clearTimeout(idle);
      cancelAnimationFrame(raf);
      const z0 = cam.z;
      const t0 = performance.now();
      const step = (now) => {
        const k = clamp((now - t0) / 900);
        cam.z = z0 * (1 - ease(k));
        aim();
        if (k < 1) { raf = requestAnimationFrame(step); return; }
        cam.z = 0;
        render(FLIPPED);
        browse();
      };
      raf = requestAnimationFrame(step);
    }
    function closeUp() {
      // As close as the screen allows: about three times the whole book, but never taller than most of the screen.
      cam.s = Math.min(3, (window.innerHeight * 0.62) / (bookH * 1.044));
      const ZOOM = 1100;
      const HOLD = 250;
      const GLIDE = 5200;
      const t0 = performance.now();
      const step = (now) => {
        const t = now - t0;
        cam.z = ease(clamp(t / ZOOM));
        // Once a finger has the book, it stays where the finger puts it; the camera only finishes coming in.
        if (!cam.held) cam.u = ease(clamp((t - ZOOM - HOLD) / GLIDE));
        aim();
        if (t < (cam.held ? ZOOM : ZOOM + HOLD + GLIDE)) { raf = requestAnimationFrame(step); return; }
        if (!cam.held) pullOut();
        else if (!drag) idle = setTimeout(pullOut, 1600);
      };
      raf = requestAnimationFrame(step);
    }
    function play() {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(backRaf);
      clearTimeout(idle);
      if (turning) { cancelAnimationFrame(turning.raf); turning = null; }
      turner.hidden = true;
      drag = null;
      playing = true;
      browsing = false;
      idx = LATEST;
      track.classList.remove('flip-done', 'flip-browse');
      cam.z = 0;
      cam.u = 0;
      cam.held = false;
      render(0);
      paintOpening().then(() => {
        const t0 = performance.now();
        const end = phone.matches ? FLIPPED : GROWN;
        const step = (now) => {
          const p = Math.min(end, (now - t0) / DURATION);
          render(p);
          if (p < end) { raf = requestAnimationFrame(step); return; }
          // On a phone the camera comes in close once the pages have turned; on a computer the book is open to read.
          if (phone.matches) closeUp(); else browse();
        };
        raf = requestAnimationFrame(step);
      });
    }
    function stop() {
      cancelAnimationFrame(raf);
      cancelAnimationFrame(backRaf);
      clearTimeout(idle);
      if (turning) { cancelAnimationFrame(turning.raf); turning = null; turner.hidden = true; }
      drag = null;
      playing = false;
    }

    /* A finger (or a mouse) on the book: close up it moves the book along; open to read, it turns the page */
    let drag = null;
    let backRaf = 0;
    stage.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      if (phone.matches && cam.z > 0 && !browsing) {
        cancelAnimationFrame(backRaf);
        clearTimeout(idle);
        cam.held = true;
        drag = { id: e.pointerId, x: e.clientX, u: clamp(cam.u), mode: 'pan' };
        return;
      }
      if (!browsing || turning) return;
      const now = performance.now();
      drag = { id: e.pointerId, x0: e.clientX, x: e.clientX, t0: now, at: now, v: 0, dir: 0, mode: 'page' };
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (drag.mode === 'pan') {
        // Step by step, at the book's size right now (it may still be coming in), so it stays under the finger.
        drag.u -= (e.clientX - drag.x) / cam.span;
        drag.x = e.clientX;
        const { u } = drag;
        cam.u = u < 0 ? u * 0.3 : u > 1 ? 1 + (u - 1) * 0.3 : u;
        aim();
        return;
      }
      const dx = e.clientX - drag.x0;
      const now = performance.now();
      drag.v = (e.clientX - drag.x) / Math.max(1, now - drag.at);
      drag.x = e.clientX;
      drag.at = now;
      if (!drag.dir) {
        if (drag.dead || Math.abs(dx) < 8) return;
        drag.dir = dx < 0 ? 1 : -1;               // a finger moving left turns forward
        if (!lift(drag.dir)) { drag.dir = 0; drag.dead = true; return; }
        try { stage.setPointerCapture(e.pointerId); } catch (err) { /* the pointer has already gone */ }
      }
      bend(clamp((-dx * drag.dir) / (bookW * 0.5)));
    });
    const release = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag;
      drag = null;
      if (d.mode === 'pan') {
        const from = cam.u;
        const to = clamp(from);
        const after = () => { if (playing && cam.z >= 1) idle = setTimeout(pullOut, 1600); };
        if (from === to) { after(); return; }
        const t0 = performance.now();
        const back = (now) => {
          const k = clamp((now - t0) / 260);
          cam.u = from + (to - from) * ease(k);
          aim();
          if (k < 1) { backRaf = requestAnimationFrame(back); return; }
          after();
        };
        backRaf = requestAnimationFrame(back);
        return;
      }
      if (d.dir && turning) {
        // Over if it is more than a third of the way, or flicked that way.
        settle(turning.t > 0.33 || d.v * -d.dir > 0.45);
        return;
      }
      // A click or a tap on a page (no drag): the right page turns forward, the left one back.
      if (!d.dir && !d.dead && e.type === 'pointerup' && performance.now() - d.t0 < 400) {
        const r = flip.getBoundingClientRect();
        turn(e.clientX > r.left + r.width / 2 ? 1 : -1);
      }
    };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);

    window.addEventListener('resize', () => requestAnimationFrame(measure));
    measure();

    const api = { stage, pane, play, stop, measure, seen: false };
    return api;
  }

  books = tracks.map(makeBook);

  // The book shown plays once it can first be seen whole (the button plays the other one); scrolling away and back up
  // the page leaves it as it is.
  const first = (b) => { if (!b.seen && b.pane.classList.contains('on')) { b.seen = true; b.play(); } };
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        const b = books.find((x) => x.stage === e.target);
        if (b && e.isIntersecting) first(b);
      });
    }, { threshold: 0.9 });
    books.forEach((b) => io.observe(b.stage));
  } else books.forEach(first);
  // Turning a tablet across the phone width: play the book shown for the new width.
  phone.addEventListener('change', () => books.forEach((b) => { b.measure(); if (b.seen && b.pane.classList.contains('on')) b.play(); }));
})();
