/* BLADES — the app's fleet cards (aircraft and drones, taking turns) and the airport globe. (The logbook has its own
   section, js/bookflip.js.) */
(() => {
  const section = document.getElementById('inside');
  if (!section) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const FLEET = window.BLADES_FLEET || { manned: [], unmanned: [], credits: {} };
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- Fleet cards ---------- */
  const strip = document.getElementById('fleet');
  const ICON = {
    perf: '<svg viewBox="0 0 24 24"><path d="M3.5 16a8.5 8.5 0 1 1 17 0"/><path d="M12 16l4.5-5.5"/></svg>',
    weight: '<svg viewBox="0 0 24 24"><path d="M6 7v10M18 7v10M3 9.5v5M21 9.5v5M6 12h12"/></svg>',
    range: '<svg viewBox="0 0 24 24"><path d="M3.5 11 20.5 3.5 13 20.5l-2-7.5z"/></svg>',
  };
  const cell = (label, value, unit) => `<div class="fc-cell"><span>${label}</span><b>${esc(value)}${unit ? ` <i>${unit}</i>` : ''}</b></div>`;
  const group = (title, icon, cells) => `<div class="fc-group"><div class="fc-gh">${icon || ''}${title}</div><div class="fc-row">${cells}</div></div>`;
  const regs = (list) => {
    const rows = list.map(([r, h], i) => `<div class="fc-reg"${i > 2 ? ' hidden' : ''}><b>${esc(r)}</b><i></i><span>${esc(h)} h</span></div>`).join('');
    const more = list.length > 3 ? `<button type="button" class="fc-more" aria-expanded="false">Show all ${list.length}</button>` : '';
    return `<div class="fc-regs"><div class="fc-regs-h"><span>REGISTRATIONS</span><b>${list.length}</b></div>${rows}${more}</div>`;
  };
  const credit = (key) => {
    const c = FLEET.credits[key];
    return c ? `<a class="fc-credit" href="${esc(c.page)}" target="_blank" rel="noopener">Photo: ${esc(c.author)} · ${esc(c.license)} · Wikimedia Commons</a>` : '';
  };
  const foot = (a) => `<div class="fc-foot"><div><span>First flight</span><b>${a.first}</b></div><div><span>Last flown</span><b>${a.last}</b></div></div>`;
  // The banner as in the app (components/logbook-page/FleetCard.tsx): the photo fades into the card, and a cut-out
  // of the aircraft (the app lifts it with Apple's subject lift; here made beforehand, img/fleet/cut/) sits on top
  // in the same place and spills over the edge. Mavic 3T stands on its case, so it keeps the plain banner.
  const AR = {da42: 1.4307, h125: 1.4977, r44: 1.493, m300: 1.5764, at76: 1.4977, m30t: 1.5, m4t: 1.6517, m3t: 1.5, c172: 1.7021, h145: 1.3333, wingtra: 1.4977};
  const CUT = new Set(['at76', 'c172', 'da42', 'h125', 'h145', 'r44', 'm300', 'm30t', 'm4t', 'wingtra']);
  const banner = (a) => {
    const ar = AR[a.key] || 1.5;
    const cut = CUT.has(a.key) ? `<div class="fc-cutwrap"><img class="fc-cut" src="img/fleet/cut/${a.key}.webp" alt="" loading="lazy" draggable="false" style="--ar:${ar}"></div>` : '';
    return `<div class="fc-top"><div class="fc-banner"><img class="fc-photo" src="img/fleet/${a.key}.jpg" alt="" loading="lazy" draggable="false" style="--ar:${ar}">${credit(a.key)}</div>${cut}</div>`;
  };

  const aircraftCard = (a) => `
    <article class="fc${CUT.has(a.key) ? ' has-cut' : ''}" aria-label="${esc(a.maker)} ${esc(a.type)}">
      ${banner(a)}
      <div class="fc-body">
        <div class="fc-head">
          <div><p class="fc-type">${esc(a.type)}</p><p class="fc-maker">${esc(a.maker)}</p></div>
          <p class="fc-total">${a.total}<span class="fc-h"> h</span></p>
        </div>
        ${group('Performance', ICON.perf, cell('VNE', a.perf[0], a.units[0]) + cell('Cruise', a.perf[1], 'kt') + cell('Ceiling', a.perf[2], 'ft'))}
        ${group('Weights', ICON.weight, cell('MTOW', a.wt[0], 'kg') + cell('Empty', a.wt[1], 'kg') + cell('Fuel', a.wt[2], 'L'))}
        ${group('Range &amp; endurance', ICON.range, cell('Range', a.rng[0], 'NM') + cell('Endurance', a.rng[1], 'h') + cell('Burn', a.rng[2], a.units[1]))}
        ${regs(a.regs)}
        ${foot(a)}
      </div>
    </article>`;

  const droneCard = (d) => `
    <article class="fc drone${CUT.has(d.key) ? ' has-cut' : ''}" aria-label="${esc(d.maker)} ${esc(d.type)}">
      ${banner(d)}
      <div class="fc-body">
        <div class="fc-head"><div><p class="fc-type">${esc(d.type)}</p><p class="fc-maker">${esc(d.maker)}</p></div></div>
        <div class="fc-ft"><span>Total flight time</span><b>${d.total}<i> h</i></b></div>
        ${group('Airframe &amp; properties', '', cell('Type', d.kind) + cell('Range', d.range, 'km') + cell('MTOW', d.mtow))}
        ${group('Performance', '', cell('Max flight', d.flight, 'min') + cell('Max speed', d.speed, 'km/h') + cell('Ceiling', d.ceil, 'm'))}
        ${regs(d.regs)}
        ${foot(d)}
      </div>
    </article>`;

  // Every other card a drone: aircraft, drone, aircraft, … (the longer list finishes the row). The cards flow on a band
  // like the feature cards above (js/site.js); it holds still while a card's registrations are open.
  const renderFleet = () => {
    if (!strip) return;
    const cards = [];
    for (let i = 0; i < Math.max(FLEET.manned.length, FLEET.unmanned.length); i += 1) {
      if (FLEET.manned[i]) cards.push(aircraftCard(FLEET.manned[i]));
      if (FLEET.unmanned[i]) cards.push(droneCard(FLEET.unmanned[i]));
    }
    strip.innerHTML = cards.join('');
  };
  if (strip) {
    renderFleet();
    const band = strip.closest('.marquee');
    const flow = band && window.bladesMarquee ? window.bladesMarquee(band) : null;
    // "Show all" opens a card's registrations (on the band's copies too, which keep working buttons).
    (band || strip).addEventListener('click', (e) => {
      const btn = e.target.closest('.fc-more');
      if (!btn) return;
      const open = btn.getAttribute('aria-expanded') !== 'true';
      btn.closest('.fc-regs').querySelectorAll('.fc-reg').forEach((r, i) => { if (i > 2) r.hidden = !open; });
      btn.setAttribute('aria-expanded', String(open));
      btn.textContent = open ? 'Show fewer' : `Show all ${btn.closest('.fc-regs').querySelectorAll('.fc-reg').length}`;
      if (flow) flow.hold(!!(band.querySelector('.fc-more[aria-expanded="true"]')));
    });
  }

  /* ---------- Airport globe: globe.gl + Supercluster, turning on its own; loaded when it comes near ---------- */
  const globeEl = document.getElementById('globe');
  const panel = section.querySelector('.globe-panel');
  if (!globeEl || !panel) return;

  const load = (src) => new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  const SPAN = 53;                               // degrees of longitude in view per unit of camera altitude
  const fmt = (n) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
  const toRad = Math.PI / 180;
  const arc = (a1, o1, a2, o2) => Math.acos(Math.min(1, Math.sin(a1 * toRad) * Math.sin(a2 * toRad) + Math.cos(a1 * toRad) * Math.cos(a2 * toRad) * Math.cos((o2 - o1) * toRad))) / toRad;

  let world = null;
  let picked = null;
  let index = null;

  const pin = (d) => {
    const el = document.createElement('div');
    el.className = `gp gp-${d.kind}`;
    if (d.kind === 'cluster') el.textContent = fmt(d.n);
    else el.textContent = d.icao;
    if (d.kind === 'sel') el.className = 'gp gp-ap gp-sel';
    el.title = d.kind === 'cluster' ? `${d.n.toLocaleString('en-US')} airports` : d.icao;
    return el;
  };

  const refresh = () => {
    if (!world) return;
    const pov = world.pointOfView();
    const span = Math.min(360, pov.altitude * SPAN);
    // Clusters all the way out (Supercluster, as in the app's map); on the far side of the globe nothing is drawn.
    // A chosen airport (Find airport) is shown on its own, with nothing on top of it.
    if (picked) { world.htmlElementsData([{ kind: 'sel', icao: picked.icao, lat: picked.lat, lng: picked.lng }]); return; }
    if (!index) { world.htmlElementsData([]); return; }
    // A smaller globe on screen gets coarser clusters, so the pins keep their spacing on a phone.
    const px = Math.log2(Math.max(0.35, Math.min(globeEl.clientWidth, globeEl.clientHeight) / 640));
    const zf = Math.log2(360 / span) + px;
    const z = Math.max(0, Math.min(16, span > 60 ? Math.floor(zf) : Math.round(zf)));
    const norm = (x) => ((((x + 180) % 360) + 360) % 360) - 180;
    const halfLng = Math.min(180, (span * 0.85) / Math.max(0.2, Math.cos(pov.lat * toRad)));
    const halfLat = span * 0.6;
    const bbox = halfLng >= 180 || span > 90
      ? [-180, -85, 180, 85]
      : [norm(pov.lng - halfLng), Math.max(-85, pov.lat - halfLat), norm(pov.lng + halfLng), Math.min(85, pov.lat + halfLat)];
    const items = index.getClusters(bbox, z)
      .filter((f) => arc(pov.lat, pov.lng, f.geometry.coordinates[1], f.geometry.coordinates[0]) < (span > 60 ? 62 : 80))
      .sort((a, b) => (b.properties.point_count || 1) - (a.properties.point_count || 1))
      .slice(0, 160)
      .map((f) => {
        const [lng, lat] = f.geometry.coordinates;
        return f.properties.cluster
          ? { kind: 'cluster', id: f.properties.cluster_id, n: f.properties.point_count, lat, lng }
          : { kind: 'ap', icao: f.properties.icao, lat, lng };
      });
    world.htmlElementsData(items);
  };
  let lastRefresh = 0;
  let refreshTimer = 0;
  const scheduleRefresh = () => {
    const now = performance.now();
    clearTimeout(refreshTimer);
    if (now - lastRefresh > 300) { lastRefresh = now; refresh(); }
    else refreshTimer = setTimeout(() => { lastRefresh = performance.now(); refresh(); }, 160);
  };

  const size = () => { if (world) world.width(globeEl.clientWidth).height(globeEl.clientHeight); };

  const init = async () => {
    try {
      await load('vendor/supercluster-8.0.1.min.js');
      await load('vendor/globe.gl-2.34.4.min.js');
    } catch (e) { return; }
    world = window.Globe({ animateIn: !reduce })(globeEl)
      .backgroundColor('rgba(0,0,0,0)')
      .globeImageUrl('img/earth-night.jpg')
      .bumpImageUrl('img/earth-topology.jpg')
      .showAtmosphere(true).atmosphereColor('lightskyblue').atmosphereAltitude(0.15)
      .htmlElementsData([]).htmlLat('lat').htmlLng('lng').htmlAltitude(0.002).htmlElement(pin);
    size();
    world.pointOfView({ lat: 42, lng: 14, altitude: 2.3 });
    const c = world.controls();
    c.autoRotate = !reduce; c.autoRotateSpeed = 0.55;
    c.enablePan = false; c.enableZoom = false; c.enableRotate = false;
    c.addEventListener('change', scheduleRefresh);
    // The airport search (js/airport.js) flies the globe to an airport and marks it, then lets it turn again.
    window.bladesGlobe = {
      show(ap) {
        picked = ap;
        c.autoRotate = false;
        world.pointOfView({ lat: ap.lat, lng: ap.lng, altitude: 0.42 }, reduce ? 0 : 1600);
        refresh();
      },
      // Off screen in the carousel (js/more.js) the globe rests.
      pause() { world.pauseAnimation(); },
      resume() { world.resumeAnimation(); },
      release() {
        picked = null;
        c.autoRotate = !reduce;
        const pov = world.pointOfView();
        world.pointOfView({ lat: pov.lat, lng: pov.lng, altitude: 2.3 }, reduce ? 0 : 1200);
        refresh();
      },
    };
    // Started while another slide of the carousel is showing: rest until its own comes up.
    const slide = globeEl.closest('.more-slide');
    if (slide && !slide.classList.contains('is-on')) world.pauseAnimation();

    const res = await fetch('data/airports.json');
    const rows = await res.json();
    refresh();
    const build = () => {
      index = new window.Supercluster({ radius: 64, maxZoom: 10, minZoom: 0 });
      index.load(rows.map(([icao, lat, lng]) => ({ type: 'Feature', properties: { icao }, geometry: { type: 'Point', coordinates: [lng, lat] } })));
      refresh();
    };
    (window.requestIdleCallback || ((f) => setTimeout(f, 200)))(build);
  };

  window.addEventListener('resize', size);

  if ('IntersectionObserver' in window) {
    let started = false;
    new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !started) { started = true; init(); }
      if (world) {
        if (e.isIntersecting) world.resumeAnimation(); else world.pauseAnimation();
      }
    }, { rootMargin: '400px 0px' }).observe(panel);
  } else init();
})();
