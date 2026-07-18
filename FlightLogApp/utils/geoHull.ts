// Convex hull (Andrew's monotone chain) + sfärisk polygonarea. Används för "matrix"-höljet
// (största möjliga area mellan besökta flygplatser) på både dashboard-widgeten och visited-kartan.
export type LatLon = { lat: number; lon: number };

// Kollinjära punkter (<= 0) tas bort → bara äkta hörn behålls.
export function convexHull<T extends LatLon>(pts: T[]): T[] {
  if (pts.length < 3) return [...pts];
  const p = [...pts].sort((a, b) => a.lon - b.lon || a.lat - b.lat);
  const cross = (o: LatLon, a: LatLon, b: LatLon) => (a.lon - o.lon) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lon - o.lon);
  const lower: T[] = [];
  for (const pt of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pt) <= 0) lower.pop(); lower.push(pt); }
  const upper: T[] = [];
  for (let i = p.length - 1; i >= 0; i--) { const pt = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pt) <= 0) upper.pop(); upper.push(pt); }
  lower.pop(); upper.pop();
  const hull = lower.concat(upper);
  return hull.length >= 3 ? hull : [...pts];
}

// Sfärisk polygonarea (km²) — tar hänsyn till jordens krökning för stora höljen.
export function sphericalAreaKm2(hull: LatLon[]): number {
  if (hull.length < 3) return 0;
  const R = 6371.0088; // km
  const rad = Math.PI / 180;
  let total = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    total += (b.lon * rad - a.lon * rad) * (2 + Math.sin(a.lat * rad) + Math.sin(b.lat * rad));
  }
  return Math.abs(total * R * R / 2);
}

const group = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export function formatArea(km2: number): string {
  if (km2 <= 0) return '—';
  if (km2 >= 1_000_000) return `${(km2 / 1_000_000).toFixed(2)} M km²`;
  if (km2 >= 1) return `${group(Math.round(km2))} km²`;
  return `${group(Math.round(km2 * 1_000_000))} m²`;
}

// Ordna höljet så att det börjar vid den nordligaste punkten (för animeringens startpunkt).
export function ringFromNorth<T extends LatLon>(hull: T[]): T[] {
  if (hull.length < 3) return [...hull];
  let ni = 0;
  for (let i = 1; i < hull.length; i++) if (hull[i].lat > hull[ni].lat) ni = i;
  return [...hull.slice(ni), ...hull.slice(0, ni)];
}

// ── Concave hull (edge-digging, Park–Oh) ─────────────────────────────────────
// Rundar konkava regioner (ex California runt Nevada) som en convex hull inte kan återge. Börjar
// från convex hull och "gräver in" långa kanter mot närmaste inre punkt när det skapar en tydlig
// konkavitet. Faller tillbaka till convex hull om resultatet blir självkorsande/ogiltigt.
const kmBetween = (a: LatLon, b: LatLon) => {
  const dla = a.lat - b.lat, dlo = (a.lon - b.lon) * Math.cos(a.lat * Math.PI / 180);
  return Math.sqrt(dla * dla + dlo * dlo) * 111;
};
// avstånd (km) från punkt till segment a→b (plan approximation, räcker regionalt)
function distToSeg(p: LatLon, a: LatLon, b: LatLon): number {
  const dx = b.lon - a.lon, dy = b.lat - a.lat, L = dx * dx + dy * dy;
  let t = L ? ((p.lon - a.lon) * dx + (p.lat - a.lat) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return kmBetween(p, { lat: a.lat + t * dy, lon: a.lon + t * dx });
}
// korsar segmenten a→b och c→d varandra (äkta korsning)?
function segCross(a: LatLon, b: LatLon, c: LatLon, d: LatLon): boolean {
  const s = (p: LatLon, q: LatLon, r: LatLon) => (q.lon - p.lon) * (r.lat - p.lat) - (q.lat - p.lat) * (r.lon - p.lon);
  const d1 = s(c, d, a), d2 = s(c, d, b), d3 = s(a, b, c), d4 = s(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
function isSimple(ring: LatLon[]): boolean {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (i === j || (i + 1) % n === j || (j + 1) % n === i) continue; // hoppa angränsande kanter
      if (segCross(ring[i], ring[(i + 1) % n], ring[j], ring[(j + 1) % n])) return false;
    }
  }
  return true;
}

export function concaveHull<T extends LatLon>(pts: T[], opts?: { minEdgeKm?: number; digRatio?: number; maxIter?: number }): T[] {
  // Konservativt: gräv bara LÅNGA kanter (minEdgeKm) och bara vid TYDLIga konkaviteter (digRatio),
  // annars blir konvexa/rektangulära regioner (ex South Dakota, Kansas) onödigt lobiga. Djupa
  // konkaviteter (ex Michigans halvöar) fångas ändå. Resultatet jämnas sedan med Chaikin (smoothRing).
  const minEdgeKm = opts?.minEdgeKm ?? 150;
  const digRatio = opts?.digRatio ?? 2.8;
  const maxIter = opts?.maxIter ?? 80;
  const hull = convexHull(pts);
  if (hull.length < 3) return hull;
  const onHull = new Set<T>(hull);
  const avail = new Set<T>(pts.filter((p) => !onHull.has(p)));
  if (!avail.size) return hull;

  const ring: T[] = [...hull];
  let iter = 0, changed = true;
  while (changed && iter < maxIter && avail.size) {
    changed = false;
    for (let i = 0; i < ring.length; i++) {
      if (iter >= maxIter) break;
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if (kmBetween(a, b) < minEdgeKm) continue;
      let best: T | null = null, bestD = Infinity;
      for (const p of avail) { const dd = distToSeg(p, a, b); if (dd < bestD) { bestD = dd; best = p; } }
      if (best && bestD > 0 && kmBetween(a, b) / bestD > digRatio) {
        ring.splice(i + 1, 0, best); avail.delete(best); changed = true; iter++;
      }
    }
  }
  // Säkerhet: bara använd om polygonen förblev enkel (annars convex hull).
  return ring.length >= 3 && isSimple(ring) ? ring : hull;
}

// Chaikin corner-cutting: rundar av en sluten polygon till mjuka kurvor (varje hörn → två punkter
// vid 1/4 och 3/4 längs sina kanter). Gör region-gränserna släta i stället för hackiga/lobiga.
export function smoothRing(ring: LatLon[], iterations = 2): LatLon[] {
  let pts: LatLon[] = ring;
  if (pts.length < 4) return pts;
  for (let it = 0; it < iterations; it++) {
    const n = pts.length, out: LatLon[] = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      out.push({ lat: a.lat * 0.75 + b.lat * 0.25, lon: a.lon * 0.75 + b.lon * 0.25 });
      out.push({ lat: a.lat * 0.25 + b.lat * 0.75, lon: a.lon * 0.25 + b.lon * 0.75 });
    }
    pts = out;
  }
  return pts;
}

// Delvis-fylld solfjäder från ring[0] (norr) svept `p` (0..1) av vägen runt höljet. Ger en
// mjuk "målas-fram"-animation: en tunn kil som växer till hela (konvexa) höljet vid p=1.
export function sweepPolygon(ring: LatLon[], p: number): LatLon[] {
  const n = ring.length;
  if (n < 3) return [];
  const boundary = [...ring.slice(1), ring[0]]; // yttre kant som sveps: v1 … v(n-1), v0
  const segs: number[] = [];
  let total = 0;
  for (let i = 0; i < boundary.length - 1; i++) {
    const d = Math.hypot(boundary[i + 1].lat - boundary[i].lat, boundary[i + 1].lon - boundary[i].lon);
    segs.push(d); total += d;
  }
  const target = Math.max(0, Math.min(1, p)) * total;
  const poly: LatLon[] = [{ lat: ring[0].lat, lon: ring[0].lon }, { lat: boundary[0].lat, lon: boundary[0].lon }];
  let acc = 0;
  for (let i = 0; i < segs.length; i++) {
    if (acc + segs[i] <= target) { poly.push({ lat: boundary[i + 1].lat, lon: boundary[i + 1].lon }); acc += segs[i]; }
    else {
      const t = segs[i] > 0 ? (target - acc) / segs[i] : 0;
      poly.push({ lat: boundary[i].lat + (boundary[i + 1].lat - boundary[i].lat) * t, lon: boundary[i].lon + (boundary[i + 1].lon - boundary[i].lon) * t });
      break;
    }
  }
  return poly;
}
