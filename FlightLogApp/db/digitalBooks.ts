// Digitala loggböcker (flera böcker) — lagras i logbook_books med kind='digital'.
// Skild från de gamla pappers-/transkriberingsböckerna (kind='paper', db/logbookBooks.ts).
// Flygningarna stämplas INTE; varje boks innehåll härleds i minnet (services/logbook/books.ts).

import { getDatabase } from './database';
import { getSetting, setSetting, getFlights } from './flights';
import { getTemplate } from '../constants/logbookTemplates';
import { buildBookSpreads } from '../services/logbook/paginate';
import { assignFlightsToBooks, sliceForBook, resolveOpeningBalance } from '../services/logbook/books';

export interface DigitalBook {
  id: number;
  name: string;
  template_id: string;
  starting_page: number;
  rows_per_spread: number;
  end_page: number;          // sista uppslagets vänstersida; 0 = obegränsad
  end_row: number;
  is_active: number;
  created_at: string;
  kind: string;
  opening_balance: string;   // JSON ColumnTotals (brought forward)
  custom_cols: string;       // JSON { colId: flightKey } (per bok)
  anchor_flight_id: number;
  anchor_page: number;
  anchor_row: number;
  display_order: number;
  acked_spread: number;      // högsta uppslag som kvitterats i dashboard-uppmaningen
}

const MIGRATED_KEY = 'dlb_books_migrated_v1';

/** Engångsmigration: skapa "Book 1" från de gamla dlb_*-settingsen om sådana finns. */
export async function ensureDigitalBooksMigrated(): Promise<void> {
  const db = await getDatabase();
  if ((await getSetting(MIGRATED_KEY)) === '1') return;

  const existing = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c FROM logbook_books WHERE kind='digital'`,
  );
  if ((existing?.c ?? 0) === 0) {
    const tplId = await getSetting('dlb_template_id');
    if (tplId) {
      const startPage = Math.max(1, parseInt((await getSetting('dlb_start_page')) || '1', 10) || 1);
      const openingBalance = (await getSetting('dlb_opening_balance')) || '{}';
      let customCols = '{}';
      try {
        const all = JSON.parse((await getSetting('dlb_custom_cols')) || '{}');
        customCols = JSON.stringify(all[tplId] ?? {});
      } catch { customCols = '{}'; }
      const rows = getTemplate(tplId).rows_per_spread;
      await db.runAsync(
        `INSERT INTO logbook_books
          (name, template_id, starting_page, rows_per_spread, is_active, end_page, end_row,
           kind, opening_balance, custom_cols, anchor_flight_id, anchor_page, anchor_row, display_order, acked_spread)
         VALUES (?, ?, ?, ?, 1, 0, 0, 'digital', ?, ?, 0, 0, 0, 0, 0)`,
        ['Book 1', tplId, startPage, rows, openingBalance, customCols],
      );
    }
  }
  await setSetting(MIGRATED_KEY, '1');
}

export async function listDigitalBooks(): Promise<DigitalBook[]> {
  await ensureDigitalBooksMigrated();
  const db = await getDatabase();
  return db.getAllAsync<DigitalBook>(
    `SELECT * FROM logbook_books WHERE kind='digital' ORDER BY display_order ASC, id ASC`,
  );
}

export async function getActiveDigitalBook(): Promise<DigitalBook | null> {
  const books = await listDigitalBooks();
  if (books.length === 0) return null;
  return books.find((b) => b.is_active === 1) ?? books[books.length - 1];
}

export async function setActiveDigitalBook(id: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE logbook_books SET is_active=0 WHERE kind='digital'`);
  await db.runAsync(`UPDATE logbook_books SET is_active=1 WHERE id=? AND kind='digital'`, [id]);
}

export interface CreateDigitalBookInput {
  name: string;
  templateId: string;
  startingPage: number;
  rowsPerSpread: number;
  endPage?: number;
  endRow?: number;
  anchorFlightId?: number;
  anchorPage?: number;
  anchorRow?: number;
  openingBalance?: Record<string, number>;
  customCols?: Record<string, string>;
}

export async function createDigitalBook(input: CreateDigitalBookInput): Promise<number> {
  await ensureDigitalBooksMigrated();
  const db = await getDatabase();
  const max = await db.getFirstAsync<{ m: number }>(
    `SELECT MAX(display_order) as m FROM logbook_books WHERE kind='digital'`,
  );
  const order = (max?.m ?? -1) + 1;
  await db.runAsync(`UPDATE logbook_books SET is_active=0 WHERE kind='digital'`);
  const r = await db.runAsync(
    `INSERT INTO logbook_books
      (name, template_id, starting_page, rows_per_spread, is_active, end_page, end_row,
       kind, opening_balance, custom_cols, anchor_flight_id, anchor_page, anchor_row, display_order, acked_spread)
     VALUES (?, ?, ?, ?, 1, ?, ?, 'digital', ?, ?, ?, ?, ?, ?, 0)`,
    [
      input.name.trim() || 'Logbook',
      input.templateId,
      Math.max(1, input.startingPage),
      Math.max(1, input.rowsPerSpread),
      input.endPage ?? 0,
      input.endRow ?? 0,
      JSON.stringify(input.openingBalance ?? {}),
      JSON.stringify(input.customCols ?? {}),
      input.anchorFlightId ?? 0,
      input.anchorPage ?? 0,
      input.anchorRow ?? 0,
      order,
    ],
  );
  return r.lastInsertRowId as number;
}

export type UpdateDigitalBookFields = Partial<{
  name: string;
  template_id: string;
  starting_page: number;
  rows_per_spread: number;
  end_page: number;
  end_row: number;
  anchor_flight_id: number;
  anchor_page: number;
  anchor_row: number;
  opening_balance: string;
  custom_cols: string;
}>;

export async function updateDigitalBook(id: number, fields: UpdateDigitalBookFields): Promise<void> {
  const keys = Object.keys(fields) as (keyof UpdateDigitalBookFields)[];
  if (keys.length === 0) return;
  const db = await getDatabase();
  const set = keys.map((k) => `${k}=?`).join(', ');
  const vals = keys.map((k) => fields[k] as string | number);
  await db.runAsync(`UPDATE logbook_books SET ${set} WHERE id=? AND kind='digital'`, [...vals, id]);
}

export async function renameDigitalBook(id: number, name: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE logbook_books SET name=? WHERE id=? AND kind='digital'`, [name.trim(), id]);
}

export async function deleteDigitalBook(id: number): Promise<void> {
  const db = await getDatabase();
  const wasActive = await db.getFirstAsync<{ a: number }>(
    `SELECT is_active as a FROM logbook_books WHERE id=? AND kind='digital'`, [id],
  );
  await db.runAsync(`DELETE FROM logbook_books WHERE id=? AND kind='digital'`, [id]);
  if (wasActive?.a === 1) {
    const next = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM logbook_books WHERE kind='digital' ORDER BY display_order DESC, id DESC LIMIT 1`,
    );
    if (next) await setActiveDigitalBook(next.id);
  }
}

export async function setAckedSpread(bookId: number, spreadNumber: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE logbook_books SET acked_spread=? WHERE id=? AND kind='digital'`,
    [spreadNumber, bookId],
  );
}

export interface SpreadPrompt {
  bookId: number;
  bookName: string;
  spreadNumber: number;
  pageLeft: number;
  pageRight: number;
}

/** Returnerar info om ett nyligen fullbordat (men ej kvitterat) uppslag i den
 *  aktiva digitala boken — annars null. Driver dashboard-uppmaningen. */
export async function getDashboardSpreadPrompt(): Promise<SpreadPrompt | null> {
  const books = await listDigitalBooks();
  const active = books.find((b) => b.is_active === 1) ?? books[books.length - 1];
  if (!active) return null;

  const flights = await getFlights(10000);
  const slices = assignFlightsToBooks(books, flights);
  const slice = sliceForBook(slices, active.id);
  if (!slice) return null;

  const rows = Math.max(1, active.rows_per_spread);
  const spreads = buildBookSpreads(slice.flights, getTemplate(active.template_id), {
    startingPage: active.starting_page,
    rowsPerSpread: rows,
    openingBalance: resolveOpeningBalance(active, flights, getTemplate(active.template_id)),
    leadingEmptyRows: slice.leadingEmptyRows,
  });

  // Högsta HELT fyllda uppslag (leading-blanks + flygningar = rows_per_spread).
  let latestFull: typeof spreads[number] | null = null;
  for (const s of spreads) {
    if ((s.leadingBlanks ?? 0) + s.flights.length >= rows) latestFull = s;
  }
  if (!latestFull) return null;
  if (latestFull.spread_number <= active.acked_spread) return null;

  return {
    bookId: active.id,
    bookName: active.name,
    spreadNumber: latestFull.spread_number,
    pageLeft: latestFull.page_left,
    pageRight: latestFull.page_right,
  };
}
