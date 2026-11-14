// Slår ihop registreringar som finns sparade två gånger, en gång med nolla och en gång med bokstaven O
// (KIL026 och KILO26). Vilken stavning som gäller avgörs i services/registrationTwins.ts.
//
// Säkerheten:
//  - Flygningarna ändras genom applyBulkEdit: en transaktion, gamla och nya värdet sparas per flygning, raden
//    syns under "Recent changes" i Edit flights och kan ångras där, och ändringen står i audit_log.
//  - Bara fältet registration ändras. Simulatorpass och summarader rörs inte.
//  - Registret (aircraft_registry): raden med den gamla stavningen flyttas till den nya, eller tas bort om den
//    nya redan finns (samma som renameRegistration).
//  - Körs en gång per databas (inställningen reg_oz_merged). Efter det hindrar importen, skanningen och
//    "+" i Log flight att nya tvillingar kommer in, och ett eget val där ("Keep as written") skrivs inte över.
import { getDatabase } from './database';
import { getSetting, setSetting } from './flights';
import { applyBulkEdit } from './bulkEdits';
import { protectedReason, type PlannedChange } from '../services/bulkEdit/engine';
import { twinMerges, groupId } from '../services/registrationTwins';

const FLAG = 'reg_oz_merged';
const up = (v: unknown) => String(v ?? '').trim().toUpperCase();

export interface MergedRegistration { from: string; to: string; flights: number }

export async function mergeRegistrationTwins(): Promise<MergedRegistration[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ id: number; registration: string; flight_type: string; remarks: string }>(
    `SELECT id, registration, flight_type, remarks FROM flights WHERE registration != ''`,
  );
  const real = rows.filter((r) => !protectedReason('pilot', r));
  const registry = await db.getAllAsync<{ registration: string }>(
    `SELECT DISTINCT registration FROM aircraft_registry WHERE registration != ''`,
  );
  const merges = twinMerges([
    ...real.map((r) => ({ registration: r.registration, n: 1 })),
    ...registry.map((r) => ({ registration: r.registration, n: 0 })),
  ]);
  if (!merges.size) return [];

  const changes: PlannedChange[] = [];
  const perReg = new Map<string, number>();
  for (const r of real) {
    const from = up(r.registration), to = merges.get(from);
    if (!to) continue;
    changes.push({ id: r.id, fields: { registration: { from: r.registration, to } } });
    perReg.set(from, (perReg.get(from) ?? 0) + 1);
  }
  await applyBulkEdit('pilot', 'Merged registrations written with both 0 and O', { changes, skipped: [], unchanged: 0, totals: [] });
  await db.withTransactionAsync(async () => {
    for (const [from, to] of merges) {
      await db.runAsync(`UPDATE OR IGNORE aircraft_registry SET registration=? WHERE UPPER(TRIM(registration))=?`, [to, from]);
      await db.runAsync(`DELETE FROM aircraft_registry WHERE UPPER(TRIM(registration))=?`, [from]);
    }
  });
  return [...merges.entries()].map(([from, to]) => ({ from, to, flights: perReg.get(from) ?? 0 }));
}

/** Vid appstart: slår ihop tvillingarna en gång. Ett fel här får aldrig stoppa starten (anroparen fångar). */
export async function mergeRegistrationTwinsOnce(): Promise<MergedRegistration[]> {
  if ((await getSetting(FLAG)) === '1') return [];
  const merged = await mergeRegistrationTwins();
  await setSetting(FLAG, '1');
  return merged;
}


// ── Fleet: användaren väljer den rätta av snarlika stavningar ─────────────────────────────────────────────
// Samma säkerhet som ovan: applyBulkEdit (ångra under Recent changes), bara registration, simulatorpass och
// summarader rörs inte; registret flyttas till den valda stavningen.
export async function syncRegistrations(froms: string[], to: string): Promise<number> {
  const target = up(to);
  const fromSet = new Set(froms.map(up).filter((f) => f && f !== target));
  if (!target || !fromSet.size) return 0;
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ id: number; registration: string; flight_type: string; remarks: string }>(
    `SELECT id, registration, flight_type, remarks FROM flights WHERE registration != ''`,
  );
  const changes: PlannedChange[] = rows
    .filter((r) => fromSet.has(up(r.registration)) && !protectedReason('pilot', r))
    .map((r) => ({ id: r.id, fields: { registration: { from: r.registration, to: target } } }));
  if (changes.length) {
    await applyBulkEdit('pilot', `Synced registrations to ${target}`, { changes, skipped: [], unchanged: 0, totals: [] });
  }
  await db.withTransactionAsync(async () => {
    for (const from of fromSet) {
      await db.runAsync(`UPDATE OR IGNORE aircraft_registry SET registration=? WHERE UPPER(TRIM(registration))=?`, [target, from]);
      await db.runAsync(`DELETE FROM aircraft_registry WHERE UPPER(TRIM(registration))=?`, [from]);
    }
  });
  return changes.length;
}

const KEPT = 'reg_similar_kept';
/** Grupper som användaren sagt är olika luftfartyg ("Keep both"). */
export async function getKeptSimilar(): Promise<Set<string>> {
  try { return new Set(JSON.parse((await getSetting(KEPT)) || '[]')); } catch { return new Set(); }
}
export async function keepSimilar(group: string[]): Promise<void> {
  const s = await getKeptSimilar();
  s.add(groupId(group));
  await setSetting(KEPT, JSON.stringify([...s]));
}
