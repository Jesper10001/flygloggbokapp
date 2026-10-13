// BLADES marknadssajt — liten vanilla-JS (ersätter React + Babel i webbläsaren).
// Sköter: rolltoggel pilot/drönare, mobilmeny, scroll-reveal, Graph/Hours i mockupen,
// skärmdumpar (progressiv förbättring: visas när filen finns, annars mockup) och globen.
(function () {
  'use strict';
  var root = document.documentElement;
  root.classList.add('js', 'js-ready');
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  // ── Skärmdumpar ─────────────────────────────────────────────────────────────
  // <figure class="shot" data-shot="…"> eller data-shot-pilot/data-shot-drone. Bilden förladdas;
  // finns den visas den (has-img), annars ligger mockupen/fallbacken kvar. Inga trasiga bilder.
  var cache = {};
  function preload(src) {
    if (cache[src]) return cache[src];
    cache[src] = new Promise(function (resolve) {
      var im = new Image();
      im.onload = function () { resolve(true); };
      im.onerror = function () { resolve(false); };
      im.src = src;
    });
    return cache[src];
  }
  function role() { return root.classList.contains('role-drone') ? 'drone' : 'pilot'; }
  function shotSrc(fig) {
    var d = fig.dataset;
    if (role() === 'drone' && d.shotDrone) return d.shotDrone;
    return d.shotPilot || d.shot || '';
  }
  function applyShot(fig) {
    var src = shotSrc(fig);
    fig.dataset.active = '1';
    if (!src) return;
    fig.dataset.want = src;
    preload(src).then(function (ok) {
      if (fig.dataset.want !== src) return; // rollen bytte medan bilden laddade
      var img = fig.querySelector('.shot-img');
      var host = fig.closest('[data-shot-host]');
      if (ok && img && img.getAttribute('src') !== src) img.src = src;
      fig.classList.toggle('has-img', ok);
      if (host) host.classList.toggle('has-img', ok);
      var step = fig.closest('.how-step');
      if (step) step.classList.toggle('has-shot', ok);
      if (host && host.id === 'map-wrap') updateGlobe();
    });
  }
  var figs = $$('figure.shot');
  figs.filter(function (f) { return f.hasAttribute('data-eager'); }).forEach(applyShot);
  var lazyFigs = figs.filter(function (f) { return !f.hasAttribute('data-eager'); });
  if ('IntersectionObserver' in window) {
    // Observera sektionen (alltid synlig) — inte figuren, som kan vara dold tills bilden finns.
    var shotIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        shotIO.unobserve(e.target);
        lazyFigs.forEach(function (f) { if (e.target.contains(f)) applyShot(f); });
      });
    }, { rootMargin: '500px 0px' });
    var seen = [];
    lazyFigs.forEach(function (f) {
      var s = f.closest('section') || f;
      if (seen.indexOf(s) === -1) { seen.push(s); shotIO.observe(s); }
    });
  } else {
    lazyFigs.forEach(applyShot);
  }

  // ── Rolltoggel ──────────────────────────────────────────────────────────────
  function syncTabs() {
    var r = role();
    $$('.role-tab').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.role === r)); });
  }
  function setRole(r) {
    root.classList.toggle('role-drone', r === 'drone');
    syncTabs();
    figs.forEach(function (f) {
      if (f.dataset.active && (f.dataset.shotDrone || f.dataset.shotPilot)) applyShot(f);
    });
    try { sessionStorage.setItem('blades-role', r); } catch (e) { /* privat läge */ }
  }
  syncTabs();

  // ── Mobilmeny ───────────────────────────────────────────────────────────────
  var nav = document.querySelector('.nav');
  var burger = document.querySelector('.burger');
  function setMenu(open) {
    if (!nav || !burger) return;
    nav.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  }
  if (burger) burger.addEventListener('click', function () { setMenu(!nav.classList.contains('open')); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setMenu(false); });
  window.addEventListener('resize', function () { if (window.innerWidth > 980) setMenu(false); });

  // Delegerade klick: rolltabbar, menylänkar, klick utanför menyn, Graph/Hours.
  document.addEventListener('click', function (e) {
    var t = e.target;
    var tab = t.closest('.role-tab');
    if (tab) { setRole(tab.dataset.role); return; }
    if (t.closest('.nav-panel a')) { setMenu(false); return; }
    if (nav && nav.classList.contains('open') && !t.closest('.nav')) setMenu(false);
    var seg = t.closest('.ins-seg button');
    if (seg) {
      var lic = seg.closest('.lic');
      if (!lic) return;
      lic.classList.toggle('show-hours', seg.dataset.view === 'hours');
      $$('.ins-seg button', lic).forEach(function (b) { b.setAttribute('aria-pressed', String(b === seg)); });
    }
  });

  // ── Scroll-reveal ───────────────────────────────────────────────────────────
  var reveals = $$('.reveal');
  if (reduceMotion || !('IntersectionObserver' in window)) {
    reveals.forEach(function (el) { el.classList.add('in'); });
  } else {
    var rio = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); rio.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    reveals.forEach(function (el) { rio.observe(el); });
  }

  // ── Glob (visas tills en riktig kartskärmdump finns) ─────────────────────────
  // Mobilvänlig: lodräta svep scrollar sidan (touch-action: pan-y), animationen pausas när globen
  // inte syns eller fliken är dold, och står still vid "reducerad rörelse".
  var PTS = [
    ['Stockholm',59.3,18.1,1],['Oslo',59.9,10.7],['Copenhagen',55.6,12.6],['Helsinki',60.2,24.9],
    ['London',51.5,-0.1],['Paris',48.9,2.4],['Amsterdam',52.3,4.8],['Frankfurt',50.0,8.6],
    ['Munich',48.1,11.6],['Zurich',47.4,8.5],['Vienna',48.1,16.4],['Rome',41.9,12.5],
    ['Madrid',40.4,-3.7],['Barcelona',41.4,2.2],['Lisbon',38.7,-9.1],['Athens',38.0,23.7],
    ['Istanbul',41.0,28.9],['Warsaw',52.2,21.0],['Reykjavik',64.1,-21.9],['Dublin',53.3,-6.3],
    ['Moscow',55.8,37.6],['Dubai',25.3,55.4],['Doha',25.3,51.5],['Cairo',30.1,31.4],
    ['Nairobi',-1.3,36.9],['Johannesburg',-26.1,28.2],['Lagos',6.6,3.3],['Casablanca',33.4,-7.6],
    ['New York',40.6,-73.8],['Toronto',43.7,-79.6],['Chicago',41.9,-87.9],['Los Angeles',33.9,-118.4],
    ['Miami',25.8,-80.3],['Mexico City',19.4,-99.1],['Sao Paulo',-23.4,-46.5],['Buenos Aires',-34.8,-58.5],
    ['Bogota',4.7,-74.1],['Tokyo',35.6,140.0],['Seoul',37.5,127.0],['Beijing',40.1,116.6],
    ['Shanghai',31.1,121.8],['Hong Kong',22.3,113.9],['Singapore',1.4,103.9],['Bangkok',13.7,100.7],
    ['Delhi',28.6,77.1],['Mumbai',19.1,72.9],['Sydney',-33.9,151.2],['Auckland',-37.0,174.8]
  ];
  var HUBS = ['London','Frankfurt','New York','Dubai','Tokyo','Sao Paulo'];

  function makeGlobe(cv) {
    var ctx = cv.getContext && cv.getContext('2d');
    if (!ctx) return null;
    var raf = 0, rotY = 20, rotX = -18, vY = reduceMotion ? 0 : 0.12, vX = 0, drag = false, lastX = 0, lastY = 0;
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var D2R = Math.PI / 180, home = PTS[0];
    function size() {
      var r = cv.getBoundingClientRect();
      cv.width = Math.max(1, Math.round(r.width * dpr));
      cv.height = Math.max(1, Math.round(r.height * dpr));
    }
    function proj(lat, lon) {
      var la = lat * D2R, lo = (lon + rotY) * D2R;
      var x = Math.cos(la) * Math.sin(lo), y = Math.sin(la), z = Math.cos(la) * Math.cos(lo);
      var rx = rotX * D2R;
      return { x: x, y: y * Math.cos(rx) - z * Math.sin(rx), z: y * Math.sin(rx) + z * Math.cos(rx) };
    }
    function unit(lat, lon) {
      var la = lat * D2R, lo = lon * D2R;
      return { x: Math.cos(la) * Math.sin(lo), y: Math.sin(la), z: Math.cos(la) * Math.cos(lo) };
    }
    function slerp(a, b, t) {
      var d = a.x * b.x + a.y * b.y + a.z * b.z, o = Math.acos(Math.max(-1, Math.min(1, d)));
      if (o < 1e-4) return a;
      var s = Math.sin(o), k0 = Math.sin((1 - t) * o) / s, k1 = Math.sin(t * o) / s;
      return { x: a.x * k0 + b.x * k1, y: a.y * k0 + b.y * k1, z: a.z * k0 + b.z * k1 };
    }
    function line(pts, cx, cy, R) {
      ctx.beginPath();
      var started = false;
      pts.forEach(function (p) {
        if (p.z > 0) {
          var sx = cx + p.x * R, sy = cy - p.y * R;
          if (!started) { ctx.moveTo(sx, sy); started = true; } else ctx.lineTo(sx, sy);
        } else started = false;
      });
      ctx.stroke();
    }
    function draw() {
      var W = cv.width, H = cv.height, cx = W / 2, cy = H / 2, R = Math.min(W, H) * 0.4;
      var acc = (getComputedStyle(root).getPropertyValue('--acc') || '#00C8E8').trim();
      if (!/^#[0-9a-f]{6}$/i.test(acc)) acc = '#00C8E8';
      ctx.clearRect(0, 0, W, H);
      var gl = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 1.5);
      gl.addColorStop(0, acc + '22'); gl.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gl; ctx.beginPath(); ctx.arc(cx, cy, R * 1.5, 0, 7); ctx.fill();
      var og = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.35, R * 0.2, cx, cy, R);
      og.addColorStop(0, '#12294A'); og.addColorStop(1, '#0A1628');
      ctx.fillStyle = og; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
      ctx.strokeStyle = acc + '44'; ctx.lineWidth = dpr; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
      ctx.strokeStyle = 'rgba(127,168,200,.16)'; ctx.lineWidth = dpr * 0.7;
      var lat, lon, pts;
      for (lat = -60; lat <= 60; lat += 30) { pts = []; for (lon = -180; lon <= 180; lon += 4) pts.push(proj(lat, lon)); line(pts, cx, cy, R); }
      for (lon = -180; lon < 180; lon += 30) { pts = []; for (lat = -90; lat <= 90; lat += 4) pts.push(proj(lat, lon)); line(pts, cx, cy, R); }
      var hU = unit(home[1], home[2]);
      ctx.strokeStyle = acc + '88'; ctx.lineWidth = dpr * 1.1;
      HUBS.forEach(function (name) {
        var t = PTS.filter(function (p) { return p[0] === name; })[0];
        if (!t) return;
        var tU = unit(t[1], t[2]), arc = [];
        for (var k = 0; k <= 24; k++) {
          var v = slerp(hU, tU, k / 24);
          arc.push(proj(Math.asin(v.y) / D2R, Math.atan2(v.x, v.z) / D2R));
        }
        line(arc, cx, cy, R);
      });
      PTS.forEach(function (p) {
        var pr = proj(p[1], p[2]);
        if (pr.z <= 0) return;
        var sx = cx + pr.x * R, sy = cy - pr.y * R, isHome = p[3], r = (isHome ? 4.5 : 2.6) * dpr * (0.6 + pr.z * 0.4);
        ctx.fillStyle = acc + '33'; ctx.beginPath(); ctx.arc(sx, sy, r * 2.4, 0, 7); ctx.fill();
        ctx.fillStyle = isHome ? '#FFFFFF' : acc; ctx.beginPath(); ctx.arc(sx, sy, r, 0, 7); ctx.fill();
        if (isHome) { ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(sx, sy, r * 0.5, 0, 7); ctx.fill(); }
      });
    }
    function frame() {
      draw();
      if (!drag) {
        rotY += vY; rotX += vX; vX *= 0.94;
        if (!reduceMotion && Math.abs(vY) < 0.12) vY += (0.12 - vY) * 0.02;
      }
      raf = requestAnimationFrame(frame);
    }
    function start() { if (!raf) raf = requestAnimationFrame(frame); }
    function stop() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
    function endDrag() { drag = false; if (!reduceMotion && Math.abs(vY) < 0.05) vY = 0.12; }
    cv.addEventListener('pointerdown', function (e) {
      drag = true; lastX = e.clientX; lastY = e.clientY; vY = 0; vX = 0;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { /* äldre webbläsare */ }
    });
    cv.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dx = e.clientX - lastX, dy = e.clientY - lastY;
      rotY += dx * 0.35; rotX = Math.max(-85, Math.min(85, rotX - dy * 0.35));
      vY = dx * 0.35; vX = -dy * 0.02; lastX = e.clientX; lastY = e.clientY;
      if (!raf) draw();
    });
    cv.addEventListener('pointerup', endDrag);
    cv.addEventListener('pointercancel', endDrag); // webbläsaren tog över (t.ex. lodrät scroll)
    cv.addEventListener('pointerleave', endDrag);
    window.addEventListener('resize', function () { size(); draw(); });
    size(); draw();
    return { start: start, stop: stop };
  }

  var globeCv = document.querySelector('.globe-cv');
  var globe = globeCv ? makeGlobe(globeCv) : null;
  var globeVisible = false;
  function updateGlobe() {
    if (!globe) return;
    var wrap = document.getElementById('map-wrap');
    var shotShown = wrap && wrap.classList.contains('has-img');
    if (globeVisible && !shotShown && !document.hidden && !reduceMotion) globe.start(); else globe.stop();
  }
  if (globe && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      globeVisible = entries[0].isIntersecting;
      updateGlobe();
    }, { threshold: 0.05 }).observe(globeCv);
    document.addEventListener('visibilitychange', updateGlobe);
  } else if (globe) {
    globeVisible = true; updateGlobe();
  }
})();
