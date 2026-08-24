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
