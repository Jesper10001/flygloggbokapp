// OSINT-lagret med militära flygbaser (appens Global map → Air Bases → Specific), GET /osint/airbases.
// Filtreringen sker HÄR på servern (INSTRUKTION_osint_lager.md 1, 5.1): uteslutna baser och förband skickas aldrig
// till appen. Anrop från länderna i blocked_countries får 451 utan data. Ren JS (ingen Worker-specifik kod) så att
// scripts/test-osint.mjs kan köra exakt samma funktioner i Node.

/** Lagret efter reglerna. Baserna i layer.bases har landet i c (flygplatsens land) och förband i ops[].o. */
export function filterLayer(bases, cfg) {
  const nato = new Set([...cfg.nato, ...cfg.nato_operator_labels]);
  const noBase = new Set([...cfg.nato, ...cfg.nato_territories, ...cfg.extra_excluded_countries]);
  const noOp = new Set([...nato, cfg.ukraine, ...cfg.extra_excluded_countries]);
  const noKey = new Set(cfg.excluded_keys);
  const out = {};
  for (const [key, b] of Object.entries(bases)) {
    if (noKey.has(key) || noBase.has(b.c)) continue;                      // 1.1.1: baser i Natoländer och deras territorier
    let ops = b.ops.filter((op) => !noOp.has(op.o));                      // 1.1.3: Nato- och Ukrainaförband döljs överallt
    if (b.c === cfg.ukraine) ops = ops.filter((op) => op.o === cfg.occupied_ukraine_allowed_operator); // 1.1.2: bara ryska på ockuperat område
    if (!ops.length) continue;
    out[key] = { ...b, ops };
  }
  return out;
}

/** Anroparens land: Cloudflares request.cf.country (går inte att förfalska), annars CF-IPCountry (tester). */
export function requestCountry(request) {
  return String(request.cf?.country || request.headers.get('CF-IPCountry') || '').toUpperCase();
}

/** Svarsfunktion med filtrerat lager i minnet (en gång per isolat) och ETag = lagrets version. */
export function makeOsintHandler(layer, cfg) {
  let cached = null;
  return (request) => {
    if (cfg.blocked_countries.includes(requestCountry(request))) {
      return new Response(JSON.stringify({ error: 'unavailable_in_region' }), {
        status: 451, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
    }
    if (!cached) {
      const bases = filterLayer(layer.bases, cfg);
      // Types: bara typer och familjer som finns på baserna som skickas
      const fam = {}, desc = {};
      for (const b of Object.values(bases)) for (const op of b.ops) for (const [, ts] of op.g) for (const t of ts) {
        const f = layer.fam?.[t];
        if (!f) continue;
        fam[t] = f;
        if (layer.desc?.[f]) desc[f] = layer.desc[f];
      }
      cached = { etag: `"${layer.v}"`, body: JSON.stringify({ v: layer.v, compiled: layer.compiled, bases, fam, desc }) };
    }
    const headers = { ETag: cached.etag, 'Cache-Control': 'private, max-age=3600', Vary: 'CF-IPCountry' };
    if (request.headers.get('If-None-Match') === cached.etag) return new Response(null, { status: 304, headers });
    return new Response(cached.body, { headers: { ...headers, 'Content-Type': 'application/json' } });
  };
}
