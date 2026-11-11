// Edit flights, kolumnen Route: vilka flygplatskoder som visas i loggboken (ICAO eller IATA).
// Flygningen har två fält per plats: dep_place/arr_place är flygplatsen (ICAO, det appen räknar position, natt
// och avstånd på) och dep_place_raw/arr_place_raw är koden så som den visas i loggbok och export. Bara den
// visade koden byts här; flygplatsen är densamma. Ren kod: uppslaget (icao → koder) kommer utifrån.
export interface AirportCodes { icao: string; iata: string }
export type CodeLookup = Record<string, AirportCodes | undefined>;

export function codeValues(
  rows: { id: number; dep_place?: string | null; arr_place?: string | null; dep_place_raw?: string | null; arr_place_raw?: string | null }[],
  lookup: CodeLookup,
  target: 'icao' | 'iata',
): Record<number, { dep?: string; arr?: string }> {
  const out: Record<number, { dep?: string; arr?: string }> = {};
  const code = (place?: string | null) => {
    const a = lookup[String(place || '').trim().toUpperCase()];
    const c = a ? (target === 'icao' ? a.icao : a.iata) : '';
    return (c || '').trim().toUpperCase();
  };
  for (const r of rows) {
    const dep = code(r.dep_place), arr = code(r.arr_place);
    const v: { dep?: string; arr?: string } = {};
    if (dep) v.dep = dep;
    if (arr) v.arr = arr;
    if (v.dep || v.arr) out[r.id] = v;
  }
  return out;
}
