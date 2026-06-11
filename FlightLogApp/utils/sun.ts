// Sunrise / sunset in UTC for a given date + position.
// Port of the SunCalc core (https://github.com/mourner/suncalc), MIT.
// Returns "HH:MM" UTC strings, or null at polar day/night (no event).

const rad = Math.PI / 180;
const dayMs = 86400000;
const J1970 = 2440588;
const J2000 = 2451545;
const e = rad * 23.4397; // obliquity of the Earth
const J0 = 0.0009;

const toJulian = (d: Date) => d.valueOf() / dayMs - 0.5 + J1970;
const fromJulian = (j: number) => new Date((j + 0.5 - J1970) * dayMs);
const toDays = (d: Date) => toJulian(d) - J2000;

const solarMeanAnomaly = (d: number) => rad * (357.5291 + 0.98560028 * d);
const eclipticLongitude = (M: number) => {
  const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const P = rad * 102.9372;
  return M + C + P + Math.PI;
};
const declination = (L: number) => Math.asin(Math.sin(e) * Math.sin(L));
const approxTransit = (Ht: number, lw: number, n: number) => J0 + (Ht + lw) / (2 * Math.PI) + n;
const solarTransitJ = (ds: number, M: number, L: number) => J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
const hourAngle = (h: number, phi: number, dec: number) =>
  Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));

function fmtUtc(d: Date): string {
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function sunTimesUTC(date: Date, lat: number, lng: number, altitudeDeg = -0.833): { sunrise: string | null; sunset: string | null } {
  const lw = rad * -lng;
  const phi = rad * lat;
  const h0 = altitudeDeg * rad; // tröskel: −0.833 = soluppgång/-nedgång, −6 = borgerlig skymning
  const d = toDays(date);
  const n = Math.round(d - J0 - lw / (2 * Math.PI));
  const ds = approxTransit(0, lw, n);
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = declination(L);
  const Jnoon = solarTransitJ(ds, M, L);

  const w = hourAngle(h0, phi, dec);
  if (Number.isNaN(w)) return { sunrise: null, sunset: null }; // polar day/night

  const Jset = solarTransitJ(approxTransit(w, lw, n), M, L);
  const Jrise = Jnoon - (Jset - Jnoon);
  return { sunrise: fmtUtc(fromJulian(Jrise)), sunset: fmtUtc(fromJulian(Jset)) };
}

// ── Solens höjd över horisonten (grader) vid en given tidpunkt + position ──
// Används för att avgöra om en punkt längs rutten är i "natt" (sol < −6°).
const rightAscension = (L: number) => Math.atan2(Math.sin(L) * Math.cos(e), Math.cos(L));
const siderealTime = (d: number, lw: number) => rad * (280.16 + 360.9856235 * d) - lw;

export function solarAltitudeDeg(date: Date, lat: number, lng: number): number {
  const lw = rad * -lng;
  const phi = rad * lat;
  const d = toDays(date);
  const M = solarMeanAnomaly(d);
  const L = eclipticLongitude(M);
  const dec = declination(L);
  const ra = rightAscension(L);
  const H = siderealTime(d, lw) - ra;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  return alt / rad;
}
