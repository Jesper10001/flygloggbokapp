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
