// Ditto-tecken ("-::-", "〃", '"') i skanningen: vilken cell ovanför syftar tecknet på?
// En cell med ett ditto-tecken har fått värdet från närmaste rad ovanför där värdet står utskrivet (kan vara
// flera rader upp). När cellen granskas ringas den källcellen in också, annars går det inte att kontrollera.
//
// Nya skanningar: Claude listar per rad vilka fält som var ditto-tecken (data.ditto). Äldre skanningar saknar
// listan → samma värde som raden direkt ovanför räknas som en upprepning, och källan är den översta raden i
// följden med samma värde.

import type { ScanRow } from './scanImport';

// Fält där ett ditto-tecken förekommer (text som upprepas rad för rad). Tider och antal räknas aldrig.
const DITTO_FIELDS = new Set(['date', 'aircraft_type', 'registration', 'dep_place', 'arr_place', 'stop_place', 'second_pilot', 'sim_category']);

const val = (r: ScanRow, field: string) => String((r.data as any)?.[field] ?? '').trim().toUpperCase();

export function dittoSource(pageRows: ScanRow[], row: ScanRow, field: string | null | undefined): { rowIndex: number; value: string } | null {
  if (!field || !DITTO_FIELDS.has(field)) return null;
  const above = pageRows
    .filter((r) => r.page === row.page && r.rowIndex < row.rowIndex)
    .sort((a, b) => b.rowIndex - a.rowIndex);
  if (!above.length) return null;
  const listed = Array.isArray(row.data?.ditto) ? row.data.ditto : null;
  if (listed) {
    if (!listed.includes(field)) return null;
    for (const r of above) {
      if (Array.isArray(r.data?.ditto) && r.data.ditto.includes(field)) continue;   // också ett ditto-tecken → längre upp
      const v = val(r, field);
      if (v) return { rowIndex: r.rowIndex, value: v };
    }
    return null;
  }
  // Äldre skanning: bara när raden direkt ovanför har samma värde.
  const v = val(row, field);
  if (!v || above[0].rowIndex !== row.rowIndex - 1 || val(above[0], field) !== v) return null;
  let src = above[0];
  for (let i = 1; i < above.length; i++) {
    const r = above[i];
    if (r.rowIndex !== src.rowIndex - 1 || val(r, field) !== v) break;
    src = r;
  }
  return { rowIndex: src.rowIndex, value: v };
}
