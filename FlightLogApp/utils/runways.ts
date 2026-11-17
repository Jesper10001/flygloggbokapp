// Rullbanor per ICAO (från OurAirports runways.csv → assets/icao-runways.json, filtrerad till
// flygplatser i vår seed). Lazy-laddas (require i funktion) så att 0.9 MB-datan bara parsas
// första gången en flygplatsdetalj öppnas.
export type Runway = {
  ident: string;      // t.ex. "01L/19R" eller "H1"
  lengthFt: number;
  lengthM: number;
  surface: string;    // läsbar yta, t.ex. "Asphalt"
  lighted: boolean;
  closed: boolean;
};

// [ident, length_ft, surface_raw, lighted(0/1), closed(0/1)]
type Row = [string, number, string, number, number];

let _data: Record<string, Row[]> | null | undefined;
function data(): Record<string, Row[]> | null {
  if (_data === undefined) {
    try { _data = require('../assets/icao-runways.json'); } catch { _data = null; }
  }
  return _data ?? null;
}

// OurAirports-ytkoder är röriga (ASP, ASPH-G, PEM, CON, GRS, TURF …) → läsbar etikett.
// Koder enligt OurAirports: GRE = graded/rolled earth eller gräs på jordbädd (gräsfält), GRS = gräs, GVL = grus,
// SAN = sand, WAT = vatten, BIT/MAC = bitumen/makadam (asfalt), PEM/PSP = delvis betong / stålmattor.
function surfaceLabel(raw: string): string {
  const s = (raw || '').toUpperCase();
  if (!s || s === 'U') return '';
  if (s.includes('WAT')) return 'Water';
  if (s.includes('SNO') || s.includes('ICE')) return 'Snow/Ice';
  if (s.includes('ASP') || s.includes('BIT') || s.includes('MAC')) return 'Asphalt';
  if (s.includes('CON') || s.includes('PEM') || s.includes('PSP')) return 'Concrete';
  if (s.includes('GRASS') || s.includes('GRS') || s.includes('GRE') || s.includes('TURF') || s.includes('SOD')) return 'Grass';
  if (s.includes('GRAV') || s.includes('GVL') || s.includes('GRV') || s.includes('COP') || s.includes('PIÇ') || s.includes('PIC')) return 'Gravel';
  if (s.includes('DIRT') || s.includes('EARTH') || s.includes('CLA') || s.includes('GROUND') || s.includes('LAT')) return 'Dirt';
  if (s.includes('SAN')) return 'Sand';
  // annars: title-case av råkoden
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

// Grov yt-klass för filter: hård (asfalt/betong) / gräs / annat (grus, jord, vatten …).
function surfaceKind(raw: string): 'hard' | 'grass' | 'other' {
  const s = (raw || '').toUpperCase();
  if (s.includes('ASP') || s.includes('CON') || s.includes('PEM') || s.includes('PSP') || s.includes('BIT') || s.includes('PAV') || s.includes('TAR') || s.includes('MAC') || s.includes('COP')) return 'hard';
  if (s.includes('GRASS') || s.includes('GRS') || s.includes('TURF') || s.includes('SOD')) return 'grass';
  return 'other';
}

// Ytorna man kan filtrera på i Global map (Properties). Bit per yta i RwyInfo.surfaces.
export const SURFACE_FILTERS = ['Asphalt', 'Concrete', 'Grass', 'Gravel', 'Dirt', 'Sand', 'Snow/Ice', 'Water'] as const;
export type SurfaceFilter = (typeof SURFACE_FILTERS)[number];
export const surfaceBit = (s: string) => { const i = (SURFACE_FILTERS as readonly string[]).indexOf(s); return i < 0 ? 0 : 1 << i; };

export type RwyInfo = { hasHard: boolean; hasGrass: boolean; hasData: boolean; maxLenM: number; anyLit: boolean; surfaces: number };

let _index: Map<string, RwyInfo> | undefined;
/** Index (ICAO → sammanfattning) för yt-/längd-/lit-filter. Byggs en gång, cachad. */
export function getRunwayIndex(): Map<string, RwyInfo> {
  if (_index === undefined) {
    const d = data();
    const m = new Map<string, RwyInfo>();
    if (d) {
      for (const icao in d) {
        let hasHard = false, hasGrass = false, maxFt = 0, anyLit = false, surfaces = 0;
        for (const r of d[icao]) {
          if (r[4] !== 1) surfaces |= surfaceBit(surfaceLabel(r[2]));   // bara öppna banor
          const k = surfaceKind(r[2]);
          if (k === 'hard') hasHard = true; else if (k === 'grass') hasGrass = true;
          // Vatten-landningsbanor (sjöflygbaser: surface "WAT"/water) räknas EJ som banlängd — de är
          // ofta km-långa sjö-/vikstråk (16–26 000 ft) och ska inte matcha runway length-filtret/kurvan.
          if (!/wat/i.test(r[2] || '') && r[1] > maxFt) maxFt = r[1];
          if (r[3] === 1) anyLit = true;
        }
        m.set(icao, { hasHard, hasGrass, hasData: true, maxLenM: Math.round(maxFt * 0.3048), anyLit, surfaces });
      }
    }
    _index = m;
  }
  return _index;
}

/** Rullbanor för en ICAO (tom array om ingen data finns). Öppna banor först, längsta först. */
export function getRunways(icao: string): Runway[] {
  const d = data(); if (!d) return [];
  const rows = d[(icao || '').toUpperCase()]; if (!rows) return [];
  return rows
    .map(([ident, lengthFt, surface, lighted, closed]) => ({
      ident, lengthFt, lengthM: Math.round(lengthFt * 0.3048),
      surface: surfaceLabel(surface), lighted: lighted === 1, closed: closed === 1,
    }))
    .sort((a, b) => (a.closed ? 1 : 0) - (b.closed ? 1 : 0) || b.lengthFt - a.lengthFt);
}
