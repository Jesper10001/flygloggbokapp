/* BLADES — "Find airport", as in the app: the search (db/icao.ts searchAirports), the airport card
   (components/AirportInfoCard.tsx) and the runway snippet (components/AirportRunwaySnippet.tsx) on
   Esri World Imagery, fetched through our own proxy so the ArcGIS key never reaches the browser. */
(() => {
  const input = document.getElementById('ap-q');
  if (!input) return;
  const list = document.getElementById('ap-list');
  const clearBtn = document.querySelector('.ap-clear');
  const result = document.querySelector('.ap-result');
  const PROXY = 'https://api.blades-app.com';
  const IMAGERY_FALLBACK = 'Esri, Vantor, Earthstar Geographics, and the GIS User Community';
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- Search, as db/icao.ts searchAirports ---------- */
  // foldDiacritics: Å/Ä→A, Ö/Ø→O, Æ→AE … so "Vasteras" finds Västerås.
  const SPECIAL = { Æ: 'AE', Œ: 'OE', ß: 'SS', ẞ: 'SS', Þ: 'TH', Ø: 'O', Ł: 'L', Đ: 'D', Ð: 'D', Ħ: 'H', Ŧ: 'T', ı: 'I' };
  const fold = (s) => s.toUpperCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[ÆŒẞÞØŁĐÐĦŦ]|ß|ı/g, (c) => SPECIAL[c] || c);
  let rows = null;          // [key, iata, gps, name, municipality, country]
  let names = null;         // upper-case and folded names, built once
  let loading = null;
  const loadIndex = () => {
    if (!loading) {
      loading = fetch('data/search.json').then((r) => r.json()).then((d) => {
        rows = d.rows;
        names = rows.map((r) => [r[3].toUpperCase(), fold(r[3])]);
      });
    }
    return loading;
  };

  const search = (raw) => {
    const q = raw.trim().toUpperCase();
    if (q.length < 2 || !rows) return [];
    const qf = fold(q);
    const hits = [];
    for (let i = 0; i < rows.length; i += 1) {
      const [key, iata, gps] = rows[i];
      let b = -1;
      if (key === q || gps === q) b = 0;
      else if (iata === q) b = 1;
      else if (key.startsWith(q) || (gps && gps.startsWith(q))) b = 2;
      else if (iata && iata.startsWith(q)) b = 3;
      else if (names[i][0].includes(q) || names[i][1].includes(qf)) b = 4;
      if (b >= 0) hits.push([b, i]);
    }
    hits.sort((a, b) => a[0] - b[0] || (rows[a[1]][3] < rows[b[1]][3] ? -1 : rows[a[1]][3] > rows[b[1]][3] ? 1 : 0));
    return hits.slice(0, 20).map((h) => rows[h[1]]);
  };

  let shown = [];
  let active = -1;
  const setOpen = (open) => {
    list.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    if (!open) { active = -1; input.removeAttribute('aria-activedescendant'); }
  };
  const renderList = (items, q) => {
    shown = items;
    active = -1;
    if (!items.length) {
      list.innerHTML = `<li class="ap-empty" role="option" aria-disabled="true">${rows ? 'No airports found' : 'Loading airports…'}</li>`;
    } else {
      list.innerHTML = items.map((r, i) => `
        <li class="ap-row" role="option" id="ap-opt-${i}" aria-selected="false" data-i="${i}">
          <b>${esc(r[0])}</b>
          <span class="ap-row-mid"><span class="ap-row-name">${esc(r[3])}</span><span class="ap-row-place">${esc([r[4], r[5]].filter(Boolean).join(', '))}</span></span>
          <i>${esc(r[1])}</i>
        </li>`).join('');
    }
    setOpen(q.length >= 2);
  };
  const highlight = (i) => {
    const opts = list.querySelectorAll('.ap-row');
    opts.forEach((o, k) => o.setAttribute('aria-selected', String(k === i)));
    active = i;
    if (opts[i]) { input.setAttribute('aria-activedescendant', opts[i].id); opts[i].scrollIntoView({ block: 'nearest' }); }
  };

  let timer = 0;
  input.addEventListener('focus', () => { loadIndex(); });
  input.addEventListener('input', () => {
    clearBtn.hidden = !input.value;
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) { setOpen(false); return; }
    timer = setTimeout(async () => {
      if (!rows) { renderList([], q); await loadIndex(); }
      if (input.value.trim() === q) renderList(search(q), q);
    }, 250);
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden || !shown.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); highlight(Math.min(shown.length - 1, active + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); highlight(Math.max(0, active - 1)); }
    if (e.key === 'Enter') { e.preventDefault(); pick(shown[Math.max(0, active)]); }
    if (e.key === 'Escape') setOpen(false);
  });
  list.addEventListener('mousedown', (e) => e.preventDefault());
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.ap-row');
    if (row) pick(shown[+row.dataset.i]);
  });
  clearBtn.addEventListener('click', () => { input.value = ''; clearBtn.hidden = true; setOpen(false); input.focus(); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.ap-find')) setOpen(false); });

  /* ---------- Details: one small file per first character of the code ---------- */
  const shards = {};
  const shardOf = (key) => { const c = key[0].toUpperCase(); return /[A-Z0-9]/.test(c) ? c : '_'; };
  const details = async (key) => {
    const c = shardOf(key);
    if (!shards[c]) shards[c] = fetch(`data/ap/${c}.json`).then((r) => r.json());
    return (await shards[c])[key];
  };

  /* ---------- The card (AirportInfoCard) ---------- */
  const TYPE = { large: 'Large', medium: 'Medium', small: 'Airfield', heliport: 'Heliport', seaplane: 'Seaplane base', altiport: 'Altiport', balloonport: 'Balloonport', closed: 'Closed' };
  const flag = (cc) => (/^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...cc.split('').map((ch) => 127397 + ch.charCodeAt(0))) : '');
  let regionName = (cc) => cc;
  try { const dn = new Intl.DisplayNames(['en'], { type: 'region' }); regionName = (cc) => { try { return dn.of(cc) || cc; } catch (e) { return cc; } }; } catch (e) { /* older browsers */ }

  const card = (r, d) => {
    const [key, iata, , name, muni, cc] = r;
    const [, , elev, type, freq] = d;
    const meta = [iata, elev != null ? `${Math.round(elev).toLocaleString('en-US')} ft` : '', TYPE[type] || ''].filter(Boolean).join('  ·  ');
    const place = [muni, regionName(cc)].filter(Boolean).join(', ');
    const f = freq || {};
    const cols = [['TWR', f.twr], ['GND', f.gnd], ['ATIS', f.atis], ['APP', f.app]].filter(([, v]) => v);
    return `
      <div class="ap-card">
        <button type="button" class="ap-close" aria-label="Close airport"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg></button>
        <div class="ap-top">
          <div class="ap-id"><b>${esc(key)}</b><span class="ap-flag" aria-hidden="true">${flag(cc)}</span></div>
          <div class="ap-main">
            <p class="ap-name">${esc(name)}</p>
            <p class="ap-meta">${esc(meta)}</p>
            ${place ? `<p class="ap-place">${esc(place)}</p>` : ''}
          </div>
        </div>
        ${cols.length ? `<div class="ap-freqs">${cols.map(([l, v]) => `<div><span>${l}</span><b>${esc(v)}</b></div>`).join('')}</div>` : ''}
      </div>`;
  };

  /* ---------- The runway snippet (AirportRunwaySnippet) ---------- */
  const M_LAT = 111320;
  const corners = (rw) => {   // constants/runwayGeo.ts runwayCorners: [le-left, he-left, he-right, le-right]
    const [, , la1, lo1, la2, lo2, w] = rw;
    const mLon = M_LAT * Math.cos(((la1 + la2) / 2) * Math.PI / 180);
    const dx = (lo2 - lo1) * mLon; const dy = (la2 - la1) * M_LAT;
    const len = Math.hypot(dx, dy) || 1;
    const px = -dy / len; const py = dx / len; const h = (w || 0) / 2;
    const off = (la, lo, s) => [la + (py * h * s) / M_LAT, lo + (px * h * s) / mLon];
    return [off(la1, lo1, 1), off(la2, lo2, 1), off(la2, lo2, -1), off(la1, lo1, -1)];
  };
  const sidePoint = (rw, dist) => {   // runwaySideLabelPoint: beside the middle, on the east (or south) side
    const [, , la1, lo1, la2, lo2] = rw;
    const mLon = M_LAT * Math.cos(((la1 + la2) / 2) * Math.PI / 180);
    const dx = (lo2 - lo1) * mLon; const dy = (la2 - la1) * M_LAT;
    const len = Math.hypot(dx, dy) || 1;
    let px = dy / len; let py = -dx / len;
    if (px < 0 || (px === 0 && py > 0)) { px = -px; py = -py; }
    return [(la1 + la2) / 2 + (py * dist) / M_LAT, (lo1 + lo2) / 2 + (px * dist) / mLon];
  };
  const world = (lat, lon, z) => {   // Web Mercator pixels at zoom z (256-px tiles)
    const s = 256 * 2 ** z;
    const sin = Math.sin(Math.max(-85.05, Math.min(85.05, lat)) * Math.PI / 180);
    return [((lon + 180) / 360) * s, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s];
  };

  const snippet = (lat, lon, rwys, box) => {
    const W = box.clientWidth; const H = box.clientHeight;
    // Initial view as the app: bounding box of all runway corners, deltas ×1.7, at least 0.006°.
    let n = lat; let s = lat; let e = lon; let w = lon;
    if (rwys.length) {
      n = -90; s = 90; e = -180; w = 180;
      rwys.forEach((rw) => corners(rw).forEach(([a, o]) => { n = Math.max(n, a); s = Math.min(s, a); e = Math.max(e, o); w = Math.min(w, o); }));
    }
    const cLat = (n + s) / 2; const cLon = (e + w) / 2;
    const dLat = rwys.length ? Math.max(0.006, (n - s) * 1.7) : 0.018;
    const dLon = rwys.length ? Math.max(0.006, (e - w) * 1.7) : 0.018;
    // Zoom that fits both spans, then tiles one level sharper on high-density screens (the proxy serves z12–16).
    const [ax, ay] = world(cLat + dLat / 2, cLon - dLon / 2, 0);
    const [bx, by] = world(cLat - dLat / 2, cLon + dLon / 2, 0);
    const zFit = Math.min(16.5, Math.max(11.5, Math.log2(Math.min(W / (bx - ax), H / (by - ay)))));
    const tz = Math.max(12, Math.min(16, Math.round(zFit + ((window.devicePixelRatio || 1) > 1.3 ? 0.5 : 0))));
    const scale = 2 ** (zFit - tz);
    const [cx, cy] = world(cLat, cLon, tz);
    const left = cx - W / 2 / scale; const top = cy - H / 2 / scale;
    const toScreen = (la, lo) => { const [x, y] = world(la, lo, tz); return [(x - left) * scale, (y - top) * scale]; };

    const tiles = [];
    const n2 = 2 ** tz;
    for (let ty = Math.floor(top / 256); ty <= Math.floor((top + H / scale) / 256); ty += 1) {
      for (let tx = Math.floor(left / 256); tx <= Math.floor((left + W / scale) / 256); tx += 1) {
        if (ty < 0 || ty >= n2) continue;
        const wx = ((tx % n2) + n2) % n2;
        tiles.push(`<img class="ap-tile" alt="" draggable="false" src="${PROXY}/web/imagery/${tz}/${ty}/${wx}" style="left:${((tx * 256 - left) * scale).toFixed(1)}px;top:${((ty * 256 - top) * scale).toFixed(1)}px;width:${(256 * scale).toFixed(2)}px;height:${(256 * scale).toFixed(2)}px">`);
      }
    }
    const polys = rwys.map((rw) => `<polygon points="${corners(rw).map(([a, o]) => toScreen(a, o).map((v) => v.toFixed(1)).join(',')).join(' ')}"/>`).join('');
    const labels = rwys.map((rw) => {
      const [le, he, la1, lo1, la2, lo2, wM, lM] = rw;
      const [x1, y1] = toScreen(la1, lo1); const [x2, y2] = toScreen(la2, lo2);
      const [sx, sy] = toScreen(...sidePoint(rw, (wM || 0) / 2 + 80));
      return `<span class="ap-ident" style="left:${x1.toFixed(1)}px;top:${y1.toFixed(1)}px">${esc(le)}</span>`
        + `<span class="ap-ident" style="left:${x2.toFixed(1)}px;top:${y2.toFixed(1)}px">${esc(he)}</span>`
        + (lM ? `<span class="ap-dim" style="left:${sx.toFixed(1)}px;top:${sy.toFixed(1)}px">${lM} m × ${wM} m</span>` : '');
    }).join('');
    const [px, py] = toScreen(lat, lon);
    const dot = rwys.length ? '' : `<span class="ap-dot" style="left:${px.toFixed(1)}px;top:${py.toFixed(1)}px"></span><span class="ap-nodata">No runway data</span>`;
    box.innerHTML = `<div class="ap-tiles">${tiles.join('')}</div><svg class="ap-rwy" width="${W}" height="${H}" aria-hidden="true">${polys}</svg>${labels}${dot}<p class="ap-attr">Powered by Esri · Source: ${IMAGERY_FALLBACK}</p>`;

    // No imagery (proxy unreachable or not configured): keep the runways on the app's dark ground.
    let failed = 0;
    box.querySelectorAll('.ap-tile').forEach((img) => img.addEventListener('error', () => {
      failed += 1;
      img.remove();
      if (failed === tiles.length) { box.classList.add('no-imagery'); box.querySelector('.ap-attr').hidden = true; }
    }));
    // Source line for the area shown, as the app's imageryCredit().
    const sw = [cLat - dLat / 2, cLon - dLon / 2]; const ne = [cLat + dLat / 2, cLon + dLon / 2];
    fetch(`${PROXY}/web/imagery/attribution?b=${[sw[0], sw[1], ne[0], ne[1], tz].map((v) => +v.toFixed(5)).join(',')}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        const p = (j && j.providers || []).filter((x) => !/^Esri$|GIS User Community/i.test(x));
        if (p.length) box.querySelector('.ap-attr').textContent = `Powered by Esri · Source: Esri, ${p.join(', ')}, and the GIS User Community`;
      })
      .catch(() => {});
  };

  /* ---------- Pick an airport ---------- */
  const close = () => {
    result.hidden = true;
    result.innerHTML = '';
    document.querySelector('.globe-panel').classList.remove('has-airport');
    if (window.bladesGlobe) window.bladesGlobe.release();
  };
  async function pick(r) {
    if (!r) return;
    setOpen(false);
    input.value = r[0];
    clearBtn.hidden = false;
    input.blur();
    const d = await details(r[0]);
    if (!d) return;
    const [lat, lon, , , , geo] = d;
    result.innerHTML = `${card(r, d)}<div class="ap-snip"></div>`;
    result.hidden = false;
    document.querySelector('.globe-panel').classList.add('has-airport');
    result.querySelector('.ap-close').addEventListener('click', close);
    snippet(lat, lon, geo || [], result.querySelector('.ap-snip'));
    if (window.bladesGlobe) window.bladesGlobe.show({ icao: r[0], lat, lng: lon });
    if (window.matchMedia('(max-width: 820px)').matches) result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !result.hidden && document.activeElement !== input) close(); });

  // The card and the runway snippet, for the "Closest airport" slide (js/more-demos.js).
  window.bladesAirport = { details, card, snippet };

  /* ---------- A few airports to try, one tap each ---------- */
  document.querySelectorAll('.ap-try [data-icao]').forEach((b) => b.addEventListener('click', async () => {
    await loadIndex();
    const r = rows.find((x) => x[0] === b.dataset.icao);
    if (r) pick(r);
  }));
})();
