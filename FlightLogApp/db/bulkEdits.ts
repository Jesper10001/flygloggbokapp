// Ändra många flygningar på en gång: sparar en plan från services/bulkEdit/engine.ts och kan ångra den.
//
// Säkerheten:
//  - Bara kolumnerna i BULK_COLUMNS skrivs (kolumnnamnen kommer aldrig från användaren).
//  - Hela ändringen sparas i EN transaktion: allt eller inget.
//  - Varje flygnings gamla och nya värde sparas i bulk_edit_changes, så ändringen kan ångras senare.
//    Ångra rör bara fält som fortfarande har ändringens värde: det man har ändrat själv efteråt ligger kvar.
//  - Pilotläget skriver dessutom till audit_log som alla andra ändringar av en flygning.
import { getDatabase } from './database';
import { BULK_COLUMNS, isTextField, type BulkMode, type BulkPlan } from '../services/bulkEdit/engine';

export interface BulkEditEntry {
  id: number;
  mode: BulkMode;
  label: string;
  flight_count: number;
  created_at: string;
  undone_at: string | null;
}

const TABLE: Record<BulkMode, string> = { pilot: 'flights', drone: 'drone_flights' };
const enc = (v: number | string): string => String(v);
const dec = (field: string, v: string | null): number | string => (isTextField(field) ? (v ?? '') : (parseFloat(v ?? '0') || 0));
const equal = (field: string, a: any, b: string | null): boolean =>
  (isTextField(field) ? String(a ?? '') === (b ?? '') : Math.abs((parseFloat(String(a ?? '0')) || 0) - (parseFloat(b ?? '0') || 0)) < 0.005);

/** Sparar planen. Ger ändringens id (för ångra), eller 0 när planen inte ändrar något. */
export async function applyBulkEdit(mode: BulkMode, label: string, plan: BulkPlan): Promise<number> {
  if (!plan.changes.length) return 0;
  const allowed = new Set(BULK_COLUMNS[mode]);
  const table = TABLE[mode];
  const db = await getDatabase();
  let editId = 0;
  await db.withTransactionAsync(async () => {
    const res = await db.runAsync('INSERT INTO bulk_edits (mode, label, flight_count) VALUES (?,?,?)', [mode, label, plan.changes.length]);
    editId = res.lastInsertRowId as number;
    for (const c of plan.changes) {
      const fields = Object.keys(c.fields).filter((f) => allowed.has(f));
      if (!fields.length) continue;
      await db.runAsync(`UPDATE ${table} SET ${fields.map((f) => `${f}=?`).join(', ')} WHERE id=?`, [...fields.map((f) => c.fields[f].to), c.id]);
      for (const f of fields) {
        const { from, to } = c.fields[f];
        await db.runAsync('INSERT INTO bulk_edit_changes (edit_id, flight_id, field, old_value, new_value) VALUES (?,?,?,?,?)', [editId, c.id, f, enc(from), enc(to)]);
        if (mode === 'pilot') {
          await db.runAsync('INSERT INTO audit_log (flight_id, field_name, old_value, new_value, reason) VALUES (?,?,?,?,?)', [c.id, f, enc(from), enc(to), `Changed with many flights: ${label}`]);
        }
      }
    }
  });
  return editId;
}

/** Ångrar en ändring. restored = fält som fick tillbaka sitt gamla värde, kept = fält som har ändrats sedan dess
 *  (eller vars flygning är borttagen) och därför lämnas. */
export async function undoBulkEdit(editId: number): Promise<{ restored: number; kept: number; flights: number }> {
  const db = await getDatabase();
  const edit = await db.getFirstAsync<BulkEditEntry>('SELECT * FROM bulk_edits WHERE id=?', [editId]);
  if (!edit || edit.undone_at) return { restored: 0, kept: 0, flights: 0 };
  const mode: BulkMode = edit.mode === 'drone' ? 'drone' : 'pilot';
  const allowed = new Set(BULK_COLUMNS[mode]);
  const table = TABLE[mode];
  const rows = await db.getAllAsync<{ flight_id: number; field: string; old_value: string | null; new_value: string | null }>(
    'SELECT flight_id, field, old_value, new_value FROM bulk_edit_changes WHERE edit_id=? ORDER BY id', [editId]);
  let restored = 0, kept = 0;
  const touched = new Set<number>();
  await db.withTransactionAsync(async () => {
    const cache = new Map<number, Record<string, any> | null>();
    for (const ch of rows) {
      if (!allowed.has(ch.field)) { kept++; continue; }
      if (!cache.has(ch.flight_id)) cache.set(ch.flight_id, await db.getFirstAsync<Record<string, any>>(`SELECT * FROM ${table} WHERE id=?`, [ch.flight_id]));
      const cur = cache.get(ch.flight_id);
      if (!cur || !equal(ch.field, cur[ch.field], ch.new_value)) { kept++; continue; }
      await db.runAsync(`UPDATE ${table} SET ${ch.field}=? WHERE id=?`, [dec(ch.field, ch.old_value), ch.flight_id]);
      if (mode === 'pilot') {
        await db.runAsync('INSERT INTO audit_log (flight_id, field_name, old_value, new_value, reason) VALUES (?,?,?,?,?)', [ch.flight_id, ch.field, ch.new_value, ch.old_value, `Undid: ${edit.label}`]);
      }
      restored++;
      touched.add(ch.flight_id);
    }
    await db.runAsync(`UPDATE bulk_edits SET undone_at=datetime('now') WHERE id=?`, [editId]);
  });
  return { restored, kept, flights: touched.size };
}

/** De senaste ändringarna som inte är ångrade (för "Recent changes"). */
export async function listBulkEdits(mode: BulkMode, limit = 5): Promise<BulkEditEntry[]> {
  const db = await getDatabase();
  return db.getAllAsync<BulkEditEntry>('SELECT * FROM bulk_edits WHERE mode=? AND undone_at IS NULL ORDER BY id DESC LIMIT ?', [mode, limit]);
}
