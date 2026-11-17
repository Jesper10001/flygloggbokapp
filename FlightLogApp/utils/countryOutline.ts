// Landskonturen i Visited airports (guld, när man väljer ett land). Data: assets/country-outlines.json
// (scripts/build-country-outlines.mjs, Natural Earth 50m förenklad till ~1 km). Hörnen rundas av med Chaikin
// (två varv, ringarna är slutna) så att kantiga kuster inte ser hackiga ut men linjen ändå följer kusten.
export type LL = { latitude: number; longitude: number };

let _data: Record<string, number[][]> | null | undefined;
function data(): Record<string, number[][]> | null {
  if (_data === undefined) {
    try { _data = require('../assets/country-outlines.json'); } catch { _data = null; }
  }
  return _data ?? null;
}

function chaikin(ring: LL[], rounds: number): LL[] {
  let pts = ring;
  for (let k = 0; k < rounds; k++) {
    const out: LL[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      out.push({ latitude: a.latitude * 0.75 + b.latitude * 0.25, longitude: a.longitude * 0.75 + b.longitude * 0.25 });
      out.push({ latitude: a.latitude * 0.25 + b.latitude * 0.75, longitude: a.longitude * 0.25 + b.longitude * 0.75 });
    }
    pts = out;
  }
  return pts;
}

const cache = new Map<string, LL[][] | null>();

/** Utjämnade, slutna ringar (första punkten upprepas sist) för ett land, eller null om data saknas. */
export function countryOutline(cc: string): LL[][] | null {
  const key = (cc || '').toUpperCase();
  if (cache.has(key)) return cache.get(key) ?? null;
  const flat = data()?.[key];
  let out: LL[][] | null = null;
  if (flat?.length) {
    out = [];
    for (const f of flat) {
      const ring: LL[] = [];
      for (let i = 0; i + 1 < f.length; i += 2) ring.push({ latitude: f[i + 1], longitude: f[i] });
      // Källan sluter ringen själv; ta bort dubbletten innan utjämningen och slut den igen efteråt.
      if (ring.length > 2 && ring[0].latitude === ring[ring.length - 1].latitude && ring[0].longitude === ring[ring.length - 1].longitude) ring.pop();
      if (ring.length < 3) continue;
      const smooth = chaikin(ring, ring.length > 1500 ? 1 : 2);
      smooth.push(smooth[0]);
      out.push(smooth);
    }
    if (!out.length) out = null;
  }
  cache.set(key, out);
  return out;
}
