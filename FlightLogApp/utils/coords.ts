// Koordinater i olika system för flygplatsvyn på Global map (systemväljaren ovanför kartan).
// WGS84. UTM/MGRS med Norge- och Svalbard-undantagen; utanför 80°S–84°N (UPS) finns ingen UTM/MGRS → null.
export type CoordSystem = 'mgrs' | 'dms' | 'ddm' | 'dd' | 'utm';

export const COORD_SYSTEMS: { id: CoordSystem; name: string; desc: string }[] = [
  { id: 'mgrs', name: 'MGRS', desc: 'Military grid reference' },
  { id: 'dms', name: 'DMS', desc: 'Degrees, minutes, seconds' },
  { id: 'ddm', name: 'DDM', desc: 'Degrees, decimal minutes' },
  { id: 'dd', name: 'DD', desc: 'Decimal degrees' },
  { id: 'utm', name: 'UTM', desc: 'Universal Transverse Mercator' },
];

const pad = (n: number, w: number) => String(n).padStart(w, '0');

function utm(lat: number, lon: number): { zone: number; band: string; E: number; N: number } | null {
  if (!(lat >= -80 && lat < 84) || !Number.isFinite(lon)) return null;
  let zone = Math.floor((lon + 180) / 6) + 1;
  if (zone > 60) zone = 60;
  if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) zone = 32;                 // Norge
  if (lat >= 72 && lat < 84) {                                                  // Svalbard
    if (lon >= 0 && lon < 9) zone = 31; else if (lon >= 9 && lon < 21) zone = 33;
    else if (lon >= 21 && lon < 33) zone = 35; else if (lon >= 33 && lon < 42) zone = 37;
  }
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const phi = (lat * Math.PI) / 180, lam = (lon * Math.PI) / 180, lam0 = (((zone - 1) * 6 - 180 + 3) * Math.PI) / 180;
  const sin = Math.sin(phi), cos = Math.cos(phi), tan = Math.tan(phi);
  const Nr = a / Math.sqrt(1 - e2 * sin * sin), T = tan * tan, C = ep2 * cos * cos, A = cos * (lam - lam0);
  const M = a * ((1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 ** 3) / 256) * phi
    - ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 ** 3) / 1024) * Math.sin(2 * phi)
    + ((15 * e2 * e2) / 256 + (45 * e2 ** 3) / 1024) * Math.sin(4 * phi)
    - ((35 * e2 ** 3) / 3072) * Math.sin(6 * phi));
  const E = k0 * Nr * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
  let N = k0 * (M + Nr * tan * ((A * A) / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
  if (lat < 0) N += 10000000;
  const band = 'CDEFGHJKLMNPQRSTUVWXX'[Math.floor((lat + 80) / 8)];
  return { zone, band, E, N };
}

function mgrs(lat: number, lon: number): string | null {
  const u = utm(lat, lon);
  if (!u) return null;
  const E = Math.floor(u.E), N = Math.floor(u.N);
  const cols = ['ABCDEFGH', 'JKLMNPQR', 'STUVWXYZ'][(u.zone - 1) % 3];
  const rows = 'ABCDEFGHJKLMNPQRSTUV';
  const col = cols[Math.floor(E / 100000) - 1];
  const row = rows[(Math.floor(N / 100000) + (u.zone % 2 === 0 ? 5 : 0)) % 20];
  return `${u.zone}${u.band} ${col}${row} ${pad(E % 100000, 5)} ${pad(N % 100000, 5)}`;
}

function dms(v: number, pos: string, neg: string, degW: number): string {
  const h = v >= 0 ? pos : neg;
  let s = Math.round(Math.abs(v) * 36000) / 10;   // tiondels bågsekunder
  const d = Math.floor(s / 3600); s -= d * 3600;
  const m = Math.floor(s / 60); s -= m * 60;
  return `${pad(d, degW)}°${pad(m, 2)}′${s.toFixed(1).padStart(4, '0')}″${h}`;
}
function ddm(v: number, pos: string, neg: string, degW: number): string {
  const h = v >= 0 ? pos : neg;
  let mm = Math.round(Math.abs(v) * 60000) / 1000;   // tusendels minuter
  const d = Math.floor(mm / 60); mm -= d * 60;
  return `${h}${pad(d, degW)}°${mm.toFixed(3).padStart(6, '0')}′`;
}

/** Koordinaten i valt system. null = finns inte (UTM/MGRS nära polerna). */
export function formatCoord(lat: number, lon: number, sys: CoordSystem): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  switch (sys) {
    case 'mgrs': return mgrs(lat, lon);
    case 'utm': { const u = utm(lat, lon); return u ? `${u.zone}${u.band} ${Math.floor(u.E)}E ${Math.floor(u.N)}N` : null; }
    case 'dms': return `${dms(lat, 'N', 'S', 2)} ${dms(lon, 'E', 'W', 3)}`;
    case 'ddm': return `${ddm(lat, 'N', 'S', 2)} ${ddm(lon, 'E', 'W', 3)}`;
    case 'dd': return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  }
}
