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
function surfaceLabel(raw: string): string {
  const s = (raw || '').toUpperCase();
  if (!s) return '';
  if (s.includes('ASP')) return 'Asphalt';
  if (s.includes('CONC') || s.includes('CON') || s.includes('PEM') || s.includes('PSP') || s.includes('BIT')) return 'Concrete';
  if (s.includes('GRASS') || s.includes('GRS') || s.includes('TURF') || s.includes('SOD')) return 'Grass';
  if (s.includes('GRAVEL') || s.includes('GVL') || s.includes('GRV') || s.includes('GRE') || s.includes('COP')) return 'Gravel';
  if (s.includes('WATER')) return 'Water';
  if (s.includes('SNOW') || s.includes('ICE')) return 'Snow/Ice';
  if (s.includes('DIRT') || s.includes('EARTH') || s.includes('CLAY') || s.includes('GROUND')) return 'Dirt';
  if (s.includes('SAND')) return 'Sand';
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

export type RwyInfo = { hasHard: boolean; hasGrass: boolean; hasData: boolean; maxLenM: number; anyLit: boolean };

let _index: Map<string, RwyInfo> | undefined;
/** Index (ICAO → sammanfattning) för yt-/längd-/lit-filter. Byggs en gång, cachad. */
export function getRunwayIndex(): Map<string, RwyInfo> {
  if (_index === undefined) {
    const d = data();
    const m = new Map<string, RwyInfo>();
    if (d) {
      for (const icao in d) {
        let hasHard = false, hasGrass = false, maxFt = 0, anyLit = false;
        for (const r of d[icao]) {
          const k = surfaceKind(r[2]);
          if (k === 'hard') hasHard = true; else if (k === 'grass') hasGrass = true;
          if (r[1] > maxFt) maxFt = r[1];
          if (r[3] === 1) anyLit = true;
        }
        m.set(icao, { hasHard, hasGrass, hasData: true, maxLenM: Math.round(maxFt * 0.3048), anyLit });
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
