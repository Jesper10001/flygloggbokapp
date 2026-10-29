/* BLADES — the demos in "And much more" (js/more.js): each feature's screen, rebuilt in HTML from the app's own
   components (labels, colours and type as in the app), with the demo pilot's numbers, and how it plays when its slide
   comes up. build(box) fills the slide once; play(box, slide, still) starts it from the beginning (still: reduced
   motion, show the end state); stop() halts it when the slide leaves. */
window.bladesMoreDemos = (() => {
  const D = {};
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const ease = (x) => 1 - (1 - x) ** 3;                       // ease-out cubic, as the app's gauges
  const inOut = (x) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);
  const rad = Math.PI / 180;
  const pad2 = (n) => String(n).padStart(2, '0');
  const intH = (n) => Math.round(n).toLocaleString('en-US').replace(/,/g, ' ');     // fmtIntH: "1 320"
  const hm = (h) => { const m = Math.round(h * 60); return `${Math.floor(m / 60)}:${pad2(m % 60)}`; };
  // Timers and frames that one stop() clears.
  const scope = () => {
    let timers = [];
    const frames = new Set();
    return {
      at(ms, f) { timers.push(setTimeout(f, ms)); },
      tween(ms, frame, done) {
        const id = { r: 0 };
        frames.add(id);
        const t0 = performance.now();
        const step = (now) => {
          const k = clamp((now - t0) / ms);
          frame(k);
          if (k < 1) id.r = requestAnimationFrame(step); else { frames.delete(id); if (done) done(); }
        };
        id.r = requestAnimationFrame(step);
      },
      clear() { timers.forEach(clearTimeout); timers = []; frames.forEach((id) => cancelAnimationFrame(id.r)); frames.clear(); },
    };
  };
  // A finger's tap on an element.
  const tap = (el) => { if (!el) return; el.classList.remove('md-tapped'); void el.offsetWidth; el.classList.add('md-tapped'); };
  const ICON = {
    sunny: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/></svg>',
    chevD: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
    network: '<svg viewBox="0 0 24 24"><circle cx="6" cy="5" r="2.2"/><circle cx="18" cy="5" r="2.2"/><circle cx="12" cy="19" r="2.2"/><path d="M6 7.2v2.3a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V7.2M12 12.5v4.3"/></svg>',
    ribbon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="9" r="6"/><path d="M8.5 13.8 7 22l5-3 5 3-1.5-8.2"/></svg>',
    lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10.5" rx="2.4"/><path d="M8.2 10.5V7.6a3.8 3.8 0 0 1 7.6 0v2.9"/></svg>',
    finger: '<svg viewBox="0 0 24 24"><path d="M7.5 5.6A8 8 0 0 1 19.4 10M5 9.4a8 8 0 0 0-.5 2.8c0 1.2.2 2.4.6 3.5M9 20.4a14 14 0 0 1-1.8-7.1 4.8 4.8 0 0 1 9.6 0c0 .9-.1 1.8-.2 2.7M12 13.2c0 3 .6 5.7 1.8 8M16.3 19.5c.3-.9.6-1.9.7-2.9"/></svg>',
    pencil: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
    navigate: '<svg viewBox="0 0 24 24"><path class="fill" d="M20.5 3.5 3.8 10.6l7.1 2.5 2.5 7.1z"/></svg>',
    cloud: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8.5" r="3.2"/><path d="M9 2.8v1.4M3.3 8.5h1.4M5 4.5l1 1M13 4.5l-1 1"/><path d="M8.4 20h9.1a3.6 3.6 0 0 0 .4-7.2 5 5 0 0 0-9.6 1.2 3 3 0 0 0 .1 6z"/></svg>',
    plane: '<svg viewBox="0 0 24 24"><path class="fill" d="M21 15.5v-1.9l-7.6-4.7V3.7a1.4 1.4 0 0 0-2.8 0v5.2L3 13.6v1.9l7.6-2.4v5.2l-2 1.5v1.4l3.4-1 3.4 1v-1.4l-2-1.5v-5.2z"/></svg>',
    search: '<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>',
    pulse: '<svg viewBox="0 0 24 24"><path d="M2.5 12h4l2.5-6 4 12 2.6-6h5.9"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6h.01"/></svg>',
    share: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 12v7.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V12"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>',
    doc: '<svg viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 3 5 6v5.5c0 4.4 3 8.2 7 9.5 4-1.3 7-5.1 7-9.5V6z"/></svg>',
  };

  /* ================= 2. Insights (components/insights: HeroTotals, GoalCard, LicenceJourney) =================
     The demo pilot: 1 320 h in total, 393 h this year, 36 h a month over the last twelve; the next mark 1 500 h, the
     next licence ATPL(A). */
  D.insights = (() => {
    const sc = scope();
    // Hours per year since the first lesson (2019), adding up to 1 320 h by October 2026.
    const YEARS = [[2019, 45], [2020, 70], [2021, 85], [2022, 60], [2023, 180], [2024, 230], [2025, 257], [2026, 393]];
    const NOW = 1320;
    const GOAL = 1500;
    const RATE = 36.3;                     // last 12 months ÷ 12
    const series = [];
    let tot = 0;
    YEARS.forEach(([y, h]) => {
      const months = y === 2026 ? 10 : 12;
      for (let m = 0; m < months; m += 1) {
        // A little seasonal: more in summer, as pilots fly.
        const w = 1 + 0.35 * Math.sin(((m - 3) / 12) * Math.PI * 2);
        series.push([y + m / 12, w]);
      }
      const ws = series.slice(-months).reduce((s, p) => s + p[1], 0);
      series.slice(-months).forEach((p) => { tot += (h * p[1]) / ws; p[1] = tot; });
    });
    const X0 = 2019;
    const NOWX = 2026 + 10 / 12;
    const GOALX = NOWX + (GOAL - NOW) / RATE / 12;       // Mar 2027
    const X1 = 2027.35;
    const YMAX = Math.max(GOAL, NOW) * 1.08;
    const CW = 320; const CH = 176; const L = 30; const R = 8; const T = 8; const B = 18;
    const px = (x) => L + ((x - X0) / (X1 - X0)) * (CW - L - R);
    const py = (y) => T + (1 - y / YMAX) * (CH - T - B);
    const LIC = [
      ['Total flight time', NOW, 1500, 'Mar 2027 · 36h/mo'],
      ['Multi-crew ops', 1031, 500],
      ['PIC', 204, 250, 'Sep 2028 · 2h/mo'],
      ['Cross-country', 860, 200],
      ['Instrument (IFR)', 1067, 75],
      ['Night', 172, 100],
    ];
    const met = LIC.filter(([, h, n]) => h >= n).length;
    const pct = Math.round((LIC.reduce((s, [, h, n]) => s + Math.min(1, h / n), 0) / LIC.length) * 100);
    function build(box) {
      const line = series.map(([x, y], i) => `${i ? 'L' : 'M'}${px(x).toFixed(1)} ${py(y).toFixed(1)}`).join(' ');
      const area = `${line} L${px(NOWX).toFixed(1)} ${py(0)} L${px(X0)} ${py(0)} Z`;
      const grid = [0, 0.25, 0.5, 0.75, 1].map((f) => {
        const y = py(YMAX * f);
        return `<line x1="${L}" x2="${CW - R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" class="g"/><text x="${L - 5}" y="${(y + 3).toFixed(1)}" text-anchor="end">${Math.round(YMAX * f)}</text>`;
      }).join('');
      const years = [2019, 2021, 2023, 2025, 2027].map((y) => `<text x="${px(y).toFixed(1)}" y="${CH - 4}" text-anchor="middle" class="yr">${y}</text>`).join('');
      box.innerHTML = `
        <div class="mi">
          <div class="mi-col">
            <div class="ac ah">
              <div class="ah-1">
                <div><span class="cap">TOTAL FLIGHT TIME</span><span class="ah-v"><b class="seg" data-n="${NOW}">0</b><i>h</i></span></div>
                <div class="r"><span class="cap lo">This year</span><span class="ah-v s"><b class="seg" data-n="393">0</b><i>h</i></span></div>
              </div>
              <div class="ah-2">
                <div><span class="ah-v x"><b class="seg" data-n="118">0</b><i>h</i></span><span class="cap s">LAST 3 MO</span></div>
                <div><span class="ah-v x"><b class="seg" data-n="221">0</b><i>h</i></span><span class="cap s">LAST 6 MO</span></div>
                <div><span class="ah-v x"><b class="seg" data-n="436">0</b><i>h</i></span><span class="cap s">LAST 12 MO</span></div>
                <div><b class="ah-pick">Pick →</b><span class="cap s">RANGE</span></div>
              </div>
            </div>
            <div class="ac lic">
              <div class="ac-h">${ICON.ribbon}<b>Next licence</b><span class="pill"><i>Chart</i><i class="on">List</i></span><em>${met}/${LIC.length} met</em></div>
              <div class="lic-big"><b>ATPL(A)</b><span>${pct}%</span></div>
              ${LIC.map(([lab, h, n, when]) => {
                const f = Math.min(1, h / n);
                const c = f >= 1 ? '#00E8A0' : f > 0.7 ? '#00C8E8' : '#FFB830';
                return `<div class="lic-r"><div class="lic-t"><span>${lab}</span><b><em class="${f >= 1 ? 'met' : ''}">${intH(h)}</em>/${intH(n)}h</b></div><div class="lic-bar"><i style="--w:${f};--c:${c}"></i></div>${when ? `<div class="lic-d">📅 ${when}</div>` : ''}</div>`;
              }).join('')}
            </div>
          </div>
          <div class="ac goal">
            <div class="ac-h">${ICON.network}<b>Experience &amp; projections</b><em>${intH(NOW)}h</em></div>
            <div class="seg2"><span class="on">Total time</span><span>PIC time</span></div>
            <p class="cap2">Cumulative flight time · hours over time</p>
            <svg class="chart" viewBox="0 0 ${CW} ${CH}">
              <defs><linearGradient id="mi-a" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#00C8E8" stop-opacity=".28"/><stop offset="1" stop-color="#00C8E8" stop-opacity="0"/></linearGradient></defs>
              ${grid}${years}
              <path class="area" d="${area}" fill="url(#mi-a)"/>
              <path class="act" d="${line}" pathLength="1"/>
              <line class="goal-l" x1="${L}" x2="${CW - R}" y1="${py(GOAL).toFixed(1)}" y2="${py(GOAL).toFixed(1)}"/>
              <path class="proj" d="M${px(NOWX).toFixed(1)} ${py(NOW).toFixed(1)} L${px(GOALX).toFixed(1)} ${py(GOAL).toFixed(1)}"/>
              <circle class="now" cx="${px(NOWX).toFixed(1)}" cy="${py(NOW).toFixed(1)}" r="4.5"/>
              <circle class="gdot" cx="${px(GOALX).toFixed(1)}" cy="${py(GOAL).toFixed(1)}" r="4"/>
            </svg>
            <div class="proj-t"><span class="cap">1 500h total projected</span><b>Mar 2027</b><span class="cap3">180h to go · 5 mo at 36h/mo</span></div>
            <span class="cap">PROJECT FORWARD TO</span>
            <div class="to"><span class="on">1 500h</span><span>2 000h</span><span>Custom</span></div>
          </div>
        </div>`;
    }
    function play(box, slide, still) {
      sc.clear();
      const root = box.querySelector('.mi');
      root.classList.remove('go');
      void root.offsetWidth;
      const nums = Array.from(box.querySelectorAll('[data-n]'));
      const set = (k) => nums.forEach((el) => { el.textContent = intH(+el.dataset.n * k); });
      if (still) { set(1); root.classList.add('go', 'still'); return; }
      set(0);
      sc.at(150, () => { root.classList.add('go'); sc.tween(1300, (k) => set(ease(k))); });
    }
    return { build, play, stop() { sc.clear(); } };
  })();

  /* ================= 3. Milestones (components/milestones: LXCardCompact, BWCardCompact, BWDayBars) =================
     The longest cross-country, ESSA → KJFK, and the best week, W41 2026 (Mon 5 – Sun 11 October). */
  const MAP = { lon0: -82, lon1: 28, lat0: 30, lat1: 70, w: 1100, h: 680 };   // img/dn-day.jpg (Mercator)
  const merc = (la) => Math.log(Math.tan(Math.PI / 4 + (la * rad) / 2));
  const MY0 = merc(MAP.lat1);
  const MY1 = merc(MAP.lat0);
  const toXY = (lat, lon) => [((lon - MAP.lon0) / (MAP.lon1 - MAP.lon0)) * MAP.w, ((MY0 - merc(lat)) / (MY0 - MY1)) * MAP.h];
  const fromY = (y) => (2 * Math.atan(Math.exp(MY0 - (y / MAP.h) * (MY0 - MY1))) - Math.PI / 2) / rad;
  const greatCircle = (a, b, n) => {
    const [la1, lo1, la2, lo2] = [a[0], a[1], b[0], b[1]].map((v) => v * rad);
    const dd = 2 * Math.asin(Math.sqrt(Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2));
    const pts = [];
    for (let i = 0; i <= n; i += 1) {
      const f = i / n;
      const A = Math.sin((1 - f) * dd) / Math.sin(dd);
      const B = Math.sin(f * dd) / Math.sin(dd);
      const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
      const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
      const z = A * Math.sin(la1) + B * Math.sin(la2);
      pts.push([Math.atan2(z, Math.hypot(x, y)) / rad, Math.atan2(y, x) / rad]);
    }
    return pts;
  };
  const ESSA = [59.6519, 17.9186];
  const KJFK = [40.6398, -73.7789];

  D.milestones = (() => {
    const sc = scope();
    const DAYS = [['MON', '05', 4 + 10 / 60], ['TUE', '06', 5 + 5 / 60], ['WED', '07', 0], ['THU', '08', 3 + 40 / 60], ['FRI', '09', 6.25], ['SAT', '10', 2 + 50 / 60], ['SUN', '11', 2.5]];
    const PEAK = 6.25;
    function build(box) {
      const pts = greatCircle(ESSA, KJFK, 80).map(([la, lo]) => toXY(la, lo));
      const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
      const pin = (p, icao, side) => { const [x, y] = toXY(...p); return `<span class="lx-ap" style="left:${((x / MAP.w) * 100).toFixed(2)}%;top:${((y / MAP.h) * 100).toFixed(2)}%"><i></i><b class="${side}">${icao}</b></span>`; };
      box.innerHTML = `
        <div class="mm">
          <div class="mm-row">
            <div class="ac lx">
              <div class="lx-map">
                <img src="img/dn-day.jpg" alt="" width="1100" height="680">
                <svg viewBox="0 0 ${MAP.w} ${MAP.h}" preserveAspectRatio="none"><path class="o" d="${d}"/><path class="c" d="${d}" pathLength="1"/></svg>
                ${pin(ESSA, 'ESSA', 'r')}${pin(KJFK, 'KJFK', 'l')}
                <span class="lx-badge"><i></i>LONGEST XC</span>
              </div>
              <div class="lx-b">
                <div class="lx-hero"><b data-n="3397">0</b><i>NM</i></div>
                <div class="lx-route">ESSA <i>→</i> KJFK</div>
                <div class="lx-foot"><span>8H 35M</span><span>28 OCT 2026</span></div>
              </div>
            </div>
            <div class="ac bw">
              <div class="bw-eye"><i></i>BEST WEEK</div>
              <div class="bw-wk">W41 · 2026</div>
              <div class="bw-hero"><b data-hm="24.5">0:00</b><i>h</i></div>
              <div class="bw-bars">${DAYS.map(([wd, dd, h]) => `
                <div class="bw-d${h === PEAK ? ' peak' : ''}${h ? '' : ' none'}">
                  <span class="bw-v">${h ? hm(h) : '—'}</span>
                  <span class="bw-t"><i style="--h:${(h / PEAK).toFixed(3)}"></i></span>
                  <span class="bw-wd">${wd}</span><span class="bw-dd">${dd}</span>
                </div>`).join('')}</div>
              <div class="bw-foot"><span><b>12</b> SECTORS</span><span><b>9</b> AIRPORTS</span></div>
            </div>
          </div>
          <div class="ac pace">
            <div class="pace-h"><span class="cap">PACE</span><b>Against your typical week</b><em>3.0×</em></div>
            <div class="pace-r"><span>THIS WEEK</span><span class="pace-t"><i class="a" style="--w:1"></i></span><b>24:30</b></div>
            <div class="pace-r"><span>TYPICAL AVG</span><span class="pace-t"><i style="--w:0.333"></i></span><b>8:10</b></div>
          </div>
        </div>`;
    }
    function play(box, slide, still) {
      sc.clear();
      const root = box.querySelector('.mm');
      root.classList.remove('go');
      void root.offsetWidth;
      const nm = box.querySelector('[data-n]');
      const hh = box.querySelector('[data-hm]');
      const set = (k) => { nm.textContent = Math.round(3397 * k).toLocaleString('en-US'); hh.textContent = hm(24.5 * k); };
      if (still) { set(1); root.classList.add('go', 'still'); return; }
      set(0);
      sc.at(150, () => { root.classList.add('go'); sc.tween(1400, (k) => set(ease(k))); });
    }
    return { build, play, stop() { sc.clear(); } };
  })();

  /* ================= 4. Share card (components/FlightShareCard.tsx) =================
     ESSB → ESGG, 28 Oct 2026: the photo from the day, then the card's three layers in turn, then Share. */
  D.share = (() => {
    const sc = scope();
    const LAYERS = ['perf', 'route', 'post'];
    const lockup = '<span class="sh-lock"><i>logged in</i><b>BLADES</b><em>Pilot Logbook</em></span>';
    let tiles = false;
    function build(box) {
      box.innerHTML = `
        <div class="msh">
          <div class="sh-card">
            <img class="sh-photo" src="img/dash-photo.jpg" alt="">
            <div class="sh-l sh-perf">
              <div class="sh-stats"><div><span>Distance</span><b>378 km</b></div><div><span>Pace</span><b>0:09 /km</b></div><div><span>Elev gained</span><b>7,620 m</b></div></div>
              ${lockup}
            </div>
            <div class="sh-l sh-route">
              <i class="sh-scrim t"></i><i class="sh-scrim b"></i>
              <svg class="sh-dash" viewBox="0 0 100 125" preserveAspectRatio="none"><path d="M70 30 L32 92"/></svg>
              <div class="sh-tile sh-a"><div class="sh-img"></div><span class="sh-ic"><b>ESSB</b><em>Departure</em></span></div>
              <div class="sh-tile sh-b"><div class="sh-img"></div><span class="sh-ic"><b>ESGG</b><em>Arrival</em></span></div>
              ${lockup.replace('sh-lock', 'sh-lock tl')}
              <div class="sh-bottom"><i class="sh-hair"></i><span class="sh-date">28 OCT 2026</span>
                <div class="sh-row"><div><b>204<i>NM</i></b><span>DISTANCE</span></div><div><b>25,000<i>FT</i></b><span>MAX ALT</span></div><div><b>189<i>KT</i></b><span>AVG SPEED</span></div></div></div>
            </div>
            <div class="sh-l sh-post">
              <div class="sh-title"><i>From</i><b>Stockholm</b><i>to Gothenburg</i></div>
              <span class="sh-edge">No. 352 · 2026.10.28 · afternoon flight</span>
              <div class="sh-ft"><span>FLIGHT TIME</span><b>1:05h · AT76</b></div>
              ${lockup}
            </div>
          </div>
          <div class="sh-ctl">
            <div class="sh-seg"><span data-l="perf" class="on">Performance</span><span data-l="route">Route</span><span data-l="post">Postcard</span></div>
            <div class="sh-btns"><span class="sh-close">Close</span><span class="sh-share">${ICON.share}Share</span></div>
          </div>
        </div>`;
    }
    // The route layer's satellite tiles: the same imagery and runways as the airport card (js/airport.js).
    async function loadTiles(box) {
      if (tiles || !window.bladesAirport) return;
      tiles = true;
      const A = window.bladesAirport;
      for (const [icao, sel] of [['ESSB', '.sh-a .sh-img'], ['ESGG', '.sh-b .sh-img']]) {
        try {
          const d = await A.details(icao);
          const el = box.querySelector(sel);
          if (d && el) A.snippet(d[0], d[1], d[5] || [], el);
        } catch (e) { /* the tiles stay plain */ }
      }
    }
    function layer(box, l) {
      box.querySelector('.sh-card').dataset.l = l;
      box.querySelectorAll('.sh-seg span').forEach((s) => s.classList.toggle('on', s.dataset.l === l));
    }
    function play(box, slide, still) {
      sc.clear();
      loadTiles(box);
      if (still) { layer(box, 'route'); return; }
      layer(box, 'perf');
      LAYERS.slice(1).forEach((l, i) => sc.at(2500 * (i + 1), () => { tap(box.querySelector(`.sh-seg [data-l="${l}"]`)); sc.at(160, () => layer(box, l)); }));
      sc.at(7000, () => tap(box.querySelector('.sh-share')));
    }
    return { build, play, stop() { sc.clear(); } };
  })();

  /* ================= 5. Closest airport (components/AirportQuickSearch.tsx, AirportInfoCard.tsx, AirportNavPanel.tsx) =========
     Closest to me, from where the visitor is: /api/near asks Cloudflare where the connection comes from (about city
     level, nothing stored) and answers with the nearest medium or large airport. Its card, its runways, and the way
     there by C172. The course is true (°T), as the app shows it without the compass. Without an answer: Stockholm
     and Bromma. */
  D.closest = (() => {
    const sc = scope();
    const R = 3440.065;
    let place = { you: { lat: 59.3303, lon: 18.0583 }, airport: { icao: 'ESSB', lat: 59.3544, lon: 17.9417, name: 'Stockholm-Bromma Airport', city: 'Stockholm', cc: 'SE', iata: 'BMA' } };
    let ready = null;
    const flag = (cc) => (/^[A-Z]{2}$/.test(cc || '') ? String.fromCodePoint(...cc.split('').map((ch) => 127397 + ch.charCodeAt(0))) : '');
    let region = (cc) => cc;
    try { const dn = new Intl.DisplayNames(['en'], { type: 'region' }); region = (cc) => { try { return dn.of(cc) || cc; } catch (e) { return cc; } }; } catch (e) { /* older browsers */ }
    const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    function way() {
      const { you, airport: ap } = place;
      const [la1, lo1, la2, lo2] = [you.lat, you.lon, ap.lat, ap.lon].map((v) => v * rad);
      const nm = 2 * R * Math.asin(Math.sqrt(Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2));
      const crs = (Math.atan2(Math.sin(lo2 - lo1) * Math.cos(la2), Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(lo2 - lo1)) / rad + 360) % 360;
      const h = nm / 110;                    // C172, 110 kt, 30 l/h
      return { nm, crs, h, l: Math.max(1, Math.round(h * 30)) };
    }
    // Fill the card from the place found (and the airport's own data: frequencies, runways).
    async function fill(box) {
      const { airport: ap } = place;
      const w = way();
      box.querySelector('.mc-id b').textContent = ap.icao;
      box.querySelector('.mc-id span').textContent = flag(ap.cc);
      box.querySelector('.mc-nm span').textContent = ap.name;
      box.querySelector('.mc-pl').textContent = [ap.iata, [ap.city, region(ap.cc)].filter(Boolean).join(', ')].filter(Boolean).join('  ·  ');
      box.querySelector('.mc-d').innerHTML = `${w.nm < 10 ? w.nm.toFixed(1) : Math.round(w.nm)}<i> NM</i>`;
      box.querySelector('.mc-crs').innerHTML = `${String(Math.round(w.crs) % 360).padStart(3, '0')}<i>°T</i>`;
      box.querySelector('.mc-ft').innerHTML = `${hm(w.h)}<i> h</i>`;
      box.querySelector('.mc-l').innerHTML = `${w.l}<i> L</i>`;
      const fq = box.querySelector('.mc-fq');
      const map = box.querySelector('.mc-map');
      if (!window.bladesAirport) return;
      try {
        const d = await window.bladesAirport.details(ap.icao);
        if (!d) return;
        const f = d[4] || {};
        const cols = [['TWR', f.twr], ['GND', f.gnd], ['ATIS', f.atis], ['APP', f.app]].filter(([, v]) => v);
        fq.innerHTML = cols.map(([l, v]) => `<div><span>${l}</span><b>${esc(v)}</b></div>`).join('');
        fq.hidden = !cols.length;
        map.innerHTML = '';
        window.bladesAirport.snippet(d[0], d[1], d[5] || [], map);
      } catch (e) { /* the card keeps what it has */ }
    }
    function build(box) {
      box.innerHTML = `
        <div class="mc">
          <div class="mc-search"><span class="mc-ib">${ICON.search}</span><span class="mc-ph">Find airport — ICAO / IATA</span></div>
          <div class="mc-row">
            <span class="mc-closest">${ICON.navigate}Closest to me</span>
            <span class="mc-chip">${ICON.cloud}All${ICON.chevD}</span>
            <span class="mc-chip">${ICON.plane}All${ICON.chevD}</span>
          </div>
          <div class="mc-out">
            <div class="mc-radar"><i></i><i></i><i></i><b></b></div>
            <div class="mc-res">
              <div class="mc-card">
                <div class="mc-id"><b></b><span></span></div>
                <div class="mc-main">
                  <div class="mc-nm"><span></span></div>
                  <p class="mc-pl"></p>
                  <div class="mc-fq"></div>
                </div>
              </div>
              <div class="mc-map"></div>
              <div class="mc-nav">
                <div><span>DISTANCE</span><b class="mc-d"></b><em>from your area</em></div>
                <div class="crs"><span>COURSE</span><b class="mc-crs"></b></div>
                <div><span>FLIGHT TIME</span><b class="mc-ft"></b><em>based on C172 ⌄</em></div>
                <div><span>CONSUMPTION ⇄</span><b class="mc-l"></b></div>
              </div>
            </div>
          </div>
        </div>`;
      // Where the visitor is, roughly: asked once; the demo shows Stockholm until (or unless) it answers.
      ready = fetch('/api/near').then((r) => (r.ok ? r.json() : null)).then((j) => {
        if (j && j.airport && j.you) place = j;
      }).catch(() => {});
    }
    function play(box, slide, still) {
      sc.clear();
      const root = box.querySelector('.mc');
      root.classList.remove('seek', 'found');
      void root.offsetWidth;
      fill(box);
      if (ready) ready.then(() => fill(box));
      if (still) { root.classList.add('found'); return; }
      sc.at(700, () => tap(box.querySelector('.mc-closest')));
      sc.at(900, () => root.classList.add('seek'));
      sc.at(2700, () => { root.classList.remove('seek'); root.classList.add('found'); });
    }
    return { build, play, stop() { sc.clear(); } };
  })();

  /* ================= 6. Security (components/AppLockGate.tsx, app/settings/auditlog.tsx) =================
     Blades opens with Face ID; inside, the change log keeps every edit with its original value. */
  D.security = (() => {
    const sc = scope();
    const LOG = [
      ['ESSB→ESGG · 2026-10-28', '2026-10-28 18:02:41', [['Night', '0:38', '0:41'], ['Land.night', '0', '1']], 'Recomputed after place located'],
      ['ESSV→ESSB · 2026-10-28', '2026-10-28 08:15:09', [['Remarks', 'Holding', 'Holding 8 min – fog at ESGG']], ''],
      ['ESSB→ESSV · 2026-10-27', '2026-10-27 19:40:52', [['Reg', 'SE-MVA', 'SE-MVC'], ['Status', 'flagged', 'verified']], 'Pilot marked as reviewed'],
    ];
    function build(box) {
      box.innerHTML = `
        <div class="ms">
          <div class="ac ms-set">
            <span class="ms-h">Security</span>
            <div class="ms-r"><span class="ms-i">${ICON.lock}</span><div><b>Require Face ID to open</b><em>On · Face ID required to open the app</em></div><span class="ms-tg"><i></i></span></div>
            <div class="ms-r"><span class="ms-i">${ICON.shield}</span><div><b>Encryption</b><em>Protected by iOS · optional AES-256</em></div><span class="ms-ch">›</span></div>
            <div class="ms-r"><span class="ms-i">${ICON.doc}</span><div><b>Audit log</b><em>All changes logged with original value</em></div><span class="ms-ch">›</span></div>
          </div>
          <div class="ms-phone">
            <div class="ms-log">
              <div class="ms-lt">Change log</div>
              ${LOG.map(([h, t, rows, why]) => `
                <div class="ms-e">
                  <div class="ms-eh"><b>${h}</b><span>${t}</span>${ICON.pencil}</div>
                  ${rows.map(([f, a, b]) => `<div class="ms-d"><span>${f}</span><s>${a}</s><i>→</i><em>${b}</em></div>`).join('')}
                  ${why ? `<p class="ms-why">Reason: ${why}</p>` : ''}
                </div>`).join('')}
            </div>
            <div class="ms-lock">
              <img src="img/blades-mark-128.png" alt="" width="64" height="64">
              <span class="ms-lc">${ICON.lock}</span>
              <b>Blades is locked</b>
              <p>Unlock with Face ID to continue.</p>
              <span class="ms-btn">${ICON.finger}Unlock</span>
            </div>
            <div class="ms-face"><svg viewBox="0 0 60 60"><path class="fid-fr" d="M4 18V10a6 6 0 0 1 6-6h8M42 4h8a6 6 0 0 1 6 6v8M56 42v8a6 6 0 0 1-6 6h-8M18 56h-8a6 6 0 0 1-6-6v-8"/><g class="fid-fc"><path d="M21 22v4M39 22v4M30 23v10h-3M23 41c4 3.4 10 3.4 14 0"/></g><path class="fid-ok" d="M18 31l8 8 16-17"/></svg><span>Face ID</span></div>
          </div>
        </div>`;
    }
    function play(box, slide, still) {
      sc.clear();
      const root = box.querySelector('.ms');
      root.classList.remove('scan', 'ok', 'open');
      void root.offsetWidth;
      if (still) { root.classList.add('open'); return; }
      sc.at(900, () => tap(box.querySelector('.ms-btn')));
      sc.at(1150, () => root.classList.add('scan'));
      sc.at(2350, () => root.classList.add('ok'));
      sc.at(3050, () => root.classList.add('open'));
    }
    return { build, play, stop() { sc.clear(); } };
  })();

  /* ================= 7. Flight load (components/WorkloadGauge.tsx, StressInfo.tsx; zones from app/(tabs)/index.tsx) ======
     The last 14 days against the pilot's own 14-day average: 34:15 against 30:00, NORMAL; then a long flight logged
     (+ 8:35) takes it to 143 %, ELEVATED. */
  D.load = (() => {
    const sc = scope();
    const ZONES = [['LOW', 29, '#8A97A8', 'Well below your normal — plenty of margin'], ['LIGHT', 69, '#00C8E8', 'Below your usual pace — a good time to refresh skills'], ['NORMAL', 130, '#00E8A0', 'Around your usual pace'], ['ELEVATED', 169, '#FFB830', 'Busier than normal — keep an eye on rest'], ['HIGH', 200, '#FF4D6A', 'Well above normal — watch for fatigue'], ['CRITICAL', Infinity, '#FF4D6A', 'Far above your baseline over a short period']];
    const zoneOf = (v) => ZONES.find((z) => v <= z[1]);
    const AVG = 30;
    const A = 34.25;
    const B = A + 8 + 35 / 60;
    const ARC = 2 * Math.PI * 44 * 0.75;
    function build(box) {
      // The ring: an open 270° arc, gap at the bottom; 100 % (your average) straight up.
      const cx = 55; const cy = 55; const r = 44;
      const a0 = 135 * rad; const a1 = 405 * rad;
      const arc = `M${(cx + r * Math.cos(a0)).toFixed(2)} ${(cy + r * Math.sin(a0)).toFixed(2)} A${r} ${r} 0 1 1 ${(cx + r * Math.cos(a1)).toFixed(2)} ${(cy + r * Math.sin(a1)).toFixed(2)}`;
      box.innerHTML = `
        <div class="ml">
          <div class="ac ml-p">
            <div class="ml-h"><span>WORKLOAD · 14D</span><b class="ml-chip">NORMAL</b><em>Fetch WX ↓</em></div>
            <div class="ml-bar"><i class="ml-f"></i><b class="ml-k"></b><span class="ml-t"></span></div>
            <div class="ml-row">
              <div class="ml-ring">
                <svg viewBox="0 0 110 110">
                  <defs><linearGradient id="ml-g" x1="11" x2="99" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#00C8E8" stop-opacity=".35"/><stop offset="1" stop-color="#00C8E8"/></linearGradient></defs>
                  <path d="${arc}" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="6" stroke-linecap="round"/>
                  <path class="ml-glow" d="${arc}" fill="none" stroke="#00C8E8" stroke-opacity=".1" stroke-width="12" stroke-linecap="round" stroke-dasharray="${ARC.toFixed(2)}"/>
                  <path class="ml-val" d="${arc}" fill="none" stroke="url(#ml-g)" stroke-width="6" stroke-linecap="round" stroke-dasharray="${ARC.toFixed(2)}"/>
                  <path d="M55 4v4" stroke="#fff" stroke-opacity=".5" stroke-width="1.5"/>
                  <g class="ml-knob"><circle r="5.5" fill="#00C8E8" fill-opacity=".18"/><circle r="3.6" fill="#fff" stroke="#00C8E8" stroke-width="1.6"/></g>
                </svg>
                <div class="ml-pct"><b>0</b><em>%</em></div>
                <span class="ml-zone">NORMAL</span>
                <span class="ml-info">${ICON.info}</span>
              </div>
              <div class="ml-ro">
                <div><span>TOTAL</span><span class="ml-badge">+ 8:35</span><b class="cy ml-tot">1320:53</b></div>
                <div><span>YTD</span><b class="cy ml-ytd">392:35</b></div>
                <div><span>14D / AVG</span><b class="zn"><i class="ml-14">34:15</i><s> / </s><i>30:00</i></b></div>
              </div>
            </div>
          </div>
          <div class="ac ml-info-card">
            <div class="ml-ih">${ICON.pulse}<b>Flight load</b></div>
            <p>Flight load compares how much you've flown recently against your own normal pace, so you can spot when you're ramping up faster than usual.</p>
            <p class="lo">100% = flying at your usual pace. Above 100% means more than normal (higher load); below means less.</p>
            <div class="ml-zs">${ZONES.map(([n, , c, t]) => `<div class="ml-z" data-z="${n}"><b style="color:${c}">${n}</b><span>${t}</span></div>`).join('')}</div>
          </div>
        </div>`;
    }
    function show(box, v, h14) {
      const z = zoneOf(v);
      const f = clamp(v / 200);
      const ring = box.querySelector('.ml-val');
      ring.style.strokeDashoffset = (ARC * (1 - f)).toFixed(2);
      box.querySelector('.ml-glow').style.strokeDashoffset = (ARC * (1 - f)).toFixed(2);
      const ang = (135 + 270 * f) * rad;
      box.querySelector('.ml-knob').setAttribute('transform', `translate(${(55 + 44 * Math.cos(ang)).toFixed(2)} ${(55 + 44 * Math.sin(ang)).toFixed(2)})`);
      box.querySelector('.ml-pct b').textContent = String(Math.round(v));
      box.querySelector('.ml-bar').style.setProperty('--f', f.toFixed(4));
      ['.ml-chip', '.ml-zone'].forEach((s) => { const el = box.querySelector(s); el.textContent = z[0]; el.style.setProperty('--zc', z[2]); });
      box.querySelector('.ml-14').textContent = hm(h14);
      box.querySelectorAll('.ml-z').forEach((el) => el.classList.toggle('on', el.dataset.z === z[0]));
    }
    function play(box, slide, still) {
      sc.clear();
      const root = box.querySelector('.ml');
      root.classList.remove('bump');
      const tot = box.querySelector('.ml-tot');
      const ytd = box.querySelector('.ml-ytd');
      tot.textContent = '1320:53';
      ytd.textContent = '392:35';
      const v0 = (A / AVG) * 100;
      const v1 = (B / AVG) * 100;
      if (still) { show(box, v0, A); return; }
      show(box, 0, A);
      sc.at(250, () => sc.tween(1400, (k) => show(box, v0 * ease(k), A)));
      // A long flight is logged: the load climbs over 1.2 s, as on the dashboard.
      sc.at(3600, () => {
        root.classList.add('bump');
        sc.tween(1200, (k) => {
          const e = ease(k);
          show(box, v0 + (v1 - v0) * e, A + (B - A) * e);
          tot.textContent = hm(1320 + 53 / 60 + (8 + 35 / 60) * e);
          ytd.textContent = hm(392 + 35 / 60 + (8 + 35 / 60) * e);
        });
      });
    }
    return { build, play, stop() { sc.clear(); } };
  })();

  /* ================= 8. Day and night: "Sun & route" (components/DayNightMap.tsx, utils/dayNight.ts) =================
     ESSA → KJFK on 28 Oct 2026, 16:30–01:05 UTC. The twilight (sun below −0.833°) and the night (below −6°) move
     west over the North Atlantic; the route is coloured by the sun where the aircraft is at each moment. */
  const sun = (ms) => {
    const d = ms / 86400000 - 10957.5;
    const g = (357.529 + 0.98560028 * d) * rad;
    const q = 280.459 + 0.98564736 * d;
    const Ls = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
    const e = (23.439 - 0.00000036 * d) * rad;
    const ra = Math.atan2(Math.cos(e) * Math.sin(Ls), Math.cos(Ls)) / rad;
    const dec = Math.asin(Math.sin(e) * Math.sin(Ls));
    const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
    let lon = ra - gmst * 15;
    lon = ((lon + 540) % 360) - 180;
    return { dec, lon };
  };
  const elev = (s, lat, lon) => Math.asin(Math.sin(lat * rad) * Math.sin(s.dec) + Math.cos(lat * rad) * Math.cos(s.dec) * Math.cos((lon - s.lon) * rad)) / rad;
  const SUN = { day: '#F5C84B', dusk: '#F2914A', night: '#7FC4FF', dawn: '#F291C8' };
  const phase = (e, rising) => (e > -0.833 ? 'day' : e > -6 ? (rising ? 'dawn' : 'dusk') : 'night');
  const FLIGHT = { from: 'ESSA', to: 'KJFK', a: ESSA, b: KJFK, dep: Date.UTC(2026, 9, 28, 16, 30), min: 515 };

  D.daynight = (() => {
    const sc = scope();
    let ctx;
    let mask;
    let mctx;
    let pts;
    let states;
    let els;
    const N = 100;
    const MW = 220;
    const MH = Math.round((MW * MAP.h) / MAP.w);
    function build(box) {
      // Where the aircraft is, and the sun's state there, at each of 101 moments of the flight.
      pts = greatCircle(FLIGHT.a, FLIGHT.b, N);
      states = pts.map((p, i) => {
        const t = FLIGHT.dep + (i / N) * FLIGHT.min * 60000;
        const e = elev(sun(t), p[0], p[1]);
        return phase(e, elev(sun(t + 600000), p[0], p[1]) > e);
      });
      let segs = '';
      pts.forEach((p, i) => {
        if (!i) return;
        const [x1, y1] = toXY(...pts[i - 1]);
        const [x2, y2] = toXY(...p);
        segs += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${SUN[states[i]]}"/>`;
      });
      // The track under the scrubber, coloured by the sun state over time.
      const stops = states.map((s, i) => `${SUN[s]} ${((i / N) * 100).toFixed(1)}%`).join(', ');
      const chip = (p, icao) => { const [x, y] = toXY(...p); return `<span class="dn-chip" style="left:${((x / MAP.w) * 100).toFixed(2)}%;top:${((y / MAP.h) * 100).toFixed(2)}%">${icao}</span>`; };
      box.innerHTML = `
        <div class="ac dn">
          <div class="dn-h">${ICON.sunny}<b>Sun &amp; route</b>${ICON.chevD}</div>
          <div class="dn-map">
            <img src="img/dn-day.jpg" alt="" width="${MAP.w}" height="${MAP.h}">
            <canvas class="dn-night" width="${MAP.w}" height="${MAP.h}"></canvas>
            <svg viewBox="0 0 ${MAP.w} ${MAP.h}" preserveAspectRatio="none"><g class="dn-line">${segs}</g></svg>
            ${chip(FLIGHT.a, FLIGHT.from)}${chip(FLIGHT.b, FLIGHT.to)}
            <span class="dn-plane"></span>
          </div>
          <div class="dn-bar">
            <span class="dn-play"><svg viewBox="0 0 24 24"><path d="M8 5.5v13l10-6.5z"/></svg></span>
            <span class="dn-tt">16:30</span>
            <span class="dn-track" style="background:linear-gradient(90deg, ${stops})"><span class="dn-thumb"></span></span>
            <span class="dn-tt">01:05</span>
          </div>
          <div class="dn-st"><b class="dn-clock">16:30 UTC</b><span class="dn-phase">Dusk</span></div>
          <div class="dn-lg"><span><i style="background:${SUN.day}"></i>Day</span><span><i style="background:${SUN.dusk}"></i>Dusk</span><span><i style="background:${SUN.night}"></i>Night</span><span><i style="background:${SUN.dawn}"></i>Dawn</span></div>
        </div>`;
      ctx = box.querySelector('.dn-night').getContext('2d');
      mask = document.createElement('canvas');
      mask.width = MW; mask.height = MH;
      mctx = mask.getContext('2d');
      els = { plane: box.querySelector('.dn-plane'), thumb: box.querySelector('.dn-thumb'), clock: box.querySelector('.dn-clock'), phase: box.querySelector('.dn-phase') };
    }
    // The terminator at one moment, in two tones: twilight below −0.833°, night below −6°.
    function shade(ms) {
      const s = sun(ms);
      const img = mctx.createImageData(MW, MH);
      for (let j = 0; j < MH; j += 1) {
        const lat = fromY(((j + 0.5) / MH) * MAP.h);
        for (let i = 0; i < MW; i += 1) {
          const lon = MAP.lon0 + ((i + 0.5) / MW) * (MAP.lon1 - MAP.lon0);
          const e = elev(s, lat, lon);
          const tw = clamp((-0.833 - e) / 0.5 + 0.5);
          const nt = clamp((-6 - e) / 0.5 + 0.5);
          const a = 1 - (1 - 0.42 * tw) * (1 - 0.62 * nt);
          const k = (j * MW + i) * 4;
          img.data[k] = 6; img.data[k + 1] = 11; img.data[k + 2] = 22;
          img.data[k + 3] = Math.round(a * 255);
        }
      }
      mctx.putImageData(img, 0, 0);
      ctx.clearRect(0, 0, MAP.w, MAP.h);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(mask, 0, 0, MAP.w, MAP.h);
    }
    function at(k) {
      const ms = FLIGHT.dep + k * FLIGHT.min * 60000;
      shade(ms);
      const f = k * N;
      const i = Math.min(N - 1, Math.floor(f));
      const p = pts[i];
      const q = pts[i + 1];
      const [x, y] = toXY(p[0] + (q[0] - p[0]) * (f - i), p[1] + (q[1] - p[1]) * (f - i));
      els.plane.style.left = `${((x / MAP.w) * 100).toFixed(2)}%`;
      els.plane.style.top = `${((y / MAP.h) * 100).toFixed(2)}%`;
      els.thumb.style.left = `${(k * 100).toFixed(2)}%`;
      const d = new Date(ms);
      els.clock.textContent = `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())} UTC`;
      const st = states[Math.round(f)];
      els.phase.textContent = st[0].toUpperCase() + st.slice(1);
      els.phase.style.setProperty('--sc', SUN[st]);
    }
    return {
      build,
      // Plays once through the flight, as the app does when the card is shown (about ten seconds there).
      play(box, slide, still) {
        sc.clear();
        if (still) { at(0.3); return; }
        at(0);
        sc.at(400, () => sc.tween(8200, (k) => at(k)));
      },
      stop() { sc.clear(); },
    };
  })();

  return D;
})();
