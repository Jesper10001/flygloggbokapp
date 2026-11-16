// Bangeometri för att rita ut landningsbanor på deras faktiska plats i kartan (som AeroWeather).
// Koordinaterna är banändarnas trösklar (le/he) från OurAirports (runways.csv). Datat ligger i
// assets/runway-geo.json (~11 350 flygplatser) — regenereras med `node scripts/build-runways.mjs`.
import RWY_DATA from '../assets/runway-geo.json';

export type RunwayGeo = {
  leIdent: string;
  heIdent: string;
  le: { lat: number; lon: number }; // "low end"-tröskel
  he: { lat: number; lon: number }; // "high end"-tröskel
  widthM: number;
  lengthM: number;
  surface?: string;
};

// Kompakt lagring: [leIdent, heIdent, leLat, leLon, heLat, heLon, widthM, lengthM] per bana.
type RunwayTuple = [string, string, number, number, number, number, number, number];
const DATA = RWY_DATA as unknown as Record<string, RunwayTuple[]>;

// Bangeometri för en flygplats (tom lista om okänd). Tuplerna → objekt on-demand (bara vald flygplats).
export function getRunwayGeo(icao: string): RunwayGeo[] {
  const arr = DATA[(icao || '').trim().toUpperCase()];
  if (!arr) return [];
  return arr.map((t) => ({
    leIdent: t[0], heIdent: t[1],
    le: { lat: t[2], lon: t[3] }, he: { lat: t[4], lon: t[5] },
    widthM: t[6], lengthM: t[7],
  }));
}

// Finns ritbar bangeometri för flygplatsen?
export function hasRunwayGeo(icao: string): boolean {
  return !!DATA[(icao || '').trim().toUpperCase()];
}

export type LatLng = { latitude: number; longitude: number };

// Fyra hörn (rektangel) för en bana, härledda ur de två tröskelkoordinaterna + bredden.
// Lokal ekvirektangulär approximation (banan är bara ~km → felet är försumbart).
export function runwayCorners(rw: RunwayGeo): LatLng[] {
  const M_PER_DEG_LAT = 111320;
  const midLat = (rw.le.lat + rw.he.lat) / 2;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180);
  // le→he som meter-vektor (x = öst, y = nord), relativt le.
  const dx = (rw.he.lon - rw.le.lon) * mPerDegLon;
  const dy = (rw.he.lat - rw.le.lat) * M_PER_DEG_LAT;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;        // enhetsvektor längs banan
  const half = rw.widthM / 2;
  const px = -uy * half, py = ux * half;     // vinkelrätt × halva bredden (meter)
  const toLL = (mx: number, my: number): LatLng => ({
    latitude: rw.le.lat + my / M_PER_DEG_LAT,
    longitude: rw.le.lon + mx / mPerDegLon,
  });
  return [
    toLL(px, py),           // le, vänster kant
    toLL(dx + px, dy + py), // he, vänster kant
    toLL(dx - px, dy - py), // he, höger kant
    toLL(-px, -py),         // le, höger kant
  ];
}

// Bandels-mittpunkt (för ev. etikett).
export function runwayMid(rw: RunwayGeo): LatLng {
  return { latitude: (rw.le.lat + rw.he.lat) / 2, longitude: (rw.le.lon + rw.he.lon) / 2 };
}

// Banans bäring (grader från norr, le→he).
export function runwayBearing(rw: RunwayGeo): number {
  const M_PER_DEG_LAT = 111320;
  const midLat = (rw.le.lat + rw.he.lat) / 2;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180);
  const dx = (rw.he.lon - rw.le.lon) * mPerDegLon;
  const dy = (rw.he.lat - rw.le.lat) * M_PER_DEG_LAT;
  return (Math.atan2(dx, dy) * 180 / Math.PI + 360) % 360;
}

// Textrotation (grader) så en etikett löper LÄNGS banan, normaliserad till [-90, 90) → aldrig upp-och-ner.
// (bearing − 90 eftersom text läses längs öst = bäring 90°; modulo 180 kring 0, ej kring 90.)
export function runwayLabelRotation(rw: RunwayGeo): number {
  const raw = runwayBearing(rw) - 90;
  return raw - 180 * Math.round(raw / 180);
}

// Punkt vid banans mitt men förskjuten VINKELRÄT ut åt sidan (offsetM meter) så en etikett hamnar
// bredvid banan i stället för ovanpå. Väljer höger sida (öst); för öst-västliga banor → nedåt (syd = "under").
export function runwaySideLabelPoint(rw: RunwayGeo, offsetM: number): LatLng {
  const M_PER_DEG_LAT = 111320;
  const midLat = (rw.le.lat + rw.he.lat) / 2;
  const midLon = (rw.le.lon + rw.he.lon) / 2;
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((midLat * Math.PI) / 180);
  const dx = (rw.he.lon - rw.le.lon) * mPerDegLon;
  const dy = (rw.he.lat - rw.le.lat) * M_PER_DEG_LAT;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  let px = -uy, py = ux;                                  // vinkelrät enhetsvektor
  if (px < 0) { px = -px; py = -py; }                      // peka åt höger (öst)
  if (Math.abs(px) < 1e-6 && py > 0) { py = -py; }         // lodrät (öst-väst-bana) → nedåt (syd)
  return {
    latitude: midLat + (py * offsetM) / M_PER_DEG_LAT,
    longitude: midLon + (px * offsetM) / mPerDegLon,
  };
}

// ── Banmarkeringar i verklig skala (Global map, Find airport, Closest to me) ──────────────────────────────
// Samma utseende som vädersidans bankarta, men i meter på kartan: asfalt i banans riktiga bredd och längd,
// tröskelstreck, streckad mittlinje och en plats för bannumret innanför tröskeln. Korsande banor: mittlinjen
// går obruten på den längsta banan och bryts på den korsande. Allt räknas i ett gemensamt lokalt meter-plan
// (ekvirektangulärt kring första banans le-tröskel; en flygplats är några km → felet är försumbart).
export type RunwayMarkings = {
  corners: LatLng[];                         // banans rektangel
  centre: LatLng[][];                        // mittlinjens delar (bruten i korsningar med en längre bana)
  keys: { le: LatLng[][]; he: LatLng[][] };  // tröskelstreck som små rektanglar
  chevron: { le: LatLng[]; he: LatLng[] };   // pil utanför tröskeln, pekar i landningsriktningen
  num: { le: LatLng; he: LatLng };           // bannumrets mitt, innanför tröskeln
  bearing: number;                           // le→he, grader från norr
};
export function runwayMarkings(runways: RunwayGeo[]): RunwayMarkings[] {
  if (!runways.length) return [];
  const M = 111320;
  const o = runways[0].le;
  const kLon = M * Math.cos((o.lat * Math.PI) / 180);
  const toM = (p: { lat: number; lon: number }) => ({ x: (p.lon - o.lon) * kLon, y: (p.lat - o.lat) * M });
  const toLL = (x: number, y: number): LatLng => ({ latitude: o.lat + y / M, longitude: o.lon + x / kLon });
  const frames = runways.map((rw) => {
    const a = toM(rw.le), b = toM(rw.he);
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const ux = (b.x - a.x) / L, uy = (b.y - a.y) / L;
    const w = rw.widthM > 0 ? rw.widthM : 30;
    // s = meter längs banan från le, c = meter tvärs (positivt åt vänster i banriktningen).
    const at = (s: number, c: number) => toLL(a.x + ux * s - uy * c, a.y + uy * s + ux * c);
    return { a, b, L, ux, uy, w, at };
  });
  return frames.map((f, i) => {
    const { L, w, at } = f;
    const keyIn = 6, keyLen = L >= 300 ? 30 : 0;
    const numAt = keyIn + keyLen + 45;
    // Mittlinjen börjar efter numret; bryts där en längre bana korsar.
    const gaps: [number, number][] = [];
    frames.forEach((g, j) => {
      if (j === i || g.L < L || (g.L === L && j > i)) return;
      const den = f.ux * g.uy - f.uy * g.ux;
      if (Math.abs(den) < 1e-6) return;
      const dx = g.a.x - f.a.x, dy = g.a.y - f.a.y;
      const s = (dx * g.uy - dy * g.ux) / den;     // meter längs denna bana
      const u = (dx * f.uy - dy * f.ux) / den;     // meter längs den andra
      if (s < 0 || s > L || u < -w / 2 || u > g.L + w / 2) return;
      const half = (g.w / 2 + 8) / Math.max(0.35, Math.abs(den));
      gaps.push([s - half, s + half]);
    });
    gaps.sort((p, q) => p[0] - q[0]);
    const centre: LatLng[][] = [];
    if (L > 400) {
      let from = numAt + 60;
      const end = L - numAt - 60;
      for (const [g1, g2] of gaps) { if (g1 - from > 20) centre.push([at(from, 0), at(Math.min(g1, end), 0)]); from = Math.max(from, g2); }
      if (end - from > 20) centre.push([at(from, 0), at(end, 0)]);
    }
    // Tröskelstreck: n streck jämnt över bredden, med lika breda mellanrum och kant.
    const n = w >= 30 ? 4 : 2;
    const slot = w / (2 * n + 1);
    const stripes = (s1: number, s2: number) => Array.from({ length: n }, (_, k) => {
      const c1 = -w / 2 + slot * (2 * k + 1), c2 = c1 + slot;
      return [at(s1, c1), at(s2, c1), at(s2, c2), at(s1, c2)];
    });
    const wing = Math.max(w * 0.38, 10);
    return {
      corners: [at(0, w / 2), at(L, w / 2), at(L, -w / 2), at(0, -w / 2)],
      centre,
      keys: keyLen ? { le: stripes(keyIn, keyIn + keyLen), he: stripes(L - keyIn - keyLen, L - keyIn) } : { le: [], he: [] },
      chevron: {
        le: [at(-18 - wing, wing), at(-18, 0), at(-18 - wing, -wing)],
        he: [at(L + 18 + wing, wing), at(L + 18, 0), at(L + 18 + wing, -wing)],
      },
      num: { le: at(Math.min(numAt, L * 0.25), 0), he: at(L - Math.min(numAt, L * 0.25), 0) },
      bearing: runwayBearing(runways[i]),
    };
  });
}
