import { getDatabase } from './database';
import type { Flight } from '../types/flight';

export interface LogbookBook {
  id: number;
  name: string;
  template_id: string;
  starting_page: number;
  rows_per_spread: number;
  transcribed_spreads: number;
  is_active: number;
  end_page: number;
  end_row: number;
  created_at: string;
}

export interface SpreadInfo {
  book: LogbookBook;
  spread_number: number;          // vilket uppslag (1-indexed)
  page_left: number;              // sidnummer vänster
  page_right: number;             // sidnummer höger
  flights: Flight[];              // exakt `rows_per_spread` flygningar (eller färre om ej fullt uppslag än)
  is_current: boolean;            // om det är nästa uppslag som väntar på transkribering
}

export async function listBooks(): Promise<LogbookBook[]> {
  const db = await getDatabase();
  return db.getAllAsync<LogbookBook>(`SELECT * FROM logbook_books ORDER BY created_at`);
}

export async function getActiveBook(): Promise<LogbookBook | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<LogbookBook>(`SELECT * FROM logbook_books WHERE is_active=1 ORDER BY created_at DESC LIMIT 1`);
  return row ?? null;
}

export async function addBook(
  name: string, templateId: string, startingPage: number, rowsPerSpread: number,
  endPage?: number, endRow?: number,
): Promise<number> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE logbook_books SET is_active=0`);
  const r = await db.runAsync(
    `INSERT INTO logbook_books (name, template_id, starting_page, rows_per_spread, transcribed_spreads, is_active, end_page, end_row)
     VALUES (?, ?, ?, ?, 0, 1, ?, ?)`,
    [name.trim(), templateId, startingPage, rowsPerSpread, endPage ?? 0, endRow ?? 0],
  );
  return r.lastInsertRowId as number;
}

export function isBookFull(book: LogbookBook): boolean {
  if (book.end_page <= 0) return false;
  const totalSpreads = Math.floor((book.end_page - book.starting_page) / 2) + 1;
  return book.transcribed_spreads >= totalSpreads;
}

export async function renameBook(id: number, name: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE logbook_books SET name=? WHERE id=?`, [name.trim(), id]);
}

export async function setActiveBook(id: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE logbook_books SET is_active=0`);
  await db.runAsync(`UPDATE logbook_books SET is_active=1 WHERE id=?`, [id]);
}

export async function deleteBook(id: number): Promise<void> {
  const db = await getDatabase();
  // Nollställ stämplar på flygningar — vi tappar inte data, bara kopplingen
  await db.runAsync(`UPDATE flights SET book_id=0, spread_number=0 WHERE book_id=?`, [id]);
  await db.runAsync(`DELETE FROM logbook_books WHERE id=?`, [id]);
}

// Hämtar alla otranskriberade flygningar (book_id=0) sorterat efter datum stigande
export async function getUntranscribedFlights(): Promise<Flight[]> {
  const db = await getDatabase();
  return db.getAllAsync<Flight>(
    `SELECT * FROM flights WHERE book_id=0 AND flight_type != 'summary' ORDER BY date ASC, dep_utc ASC, id ASC`
  );
}

export async function getUntranscribedCount(): Promise<number> {
  const db = await getDatabase();
  const r = await db.getFirstAsync<{ c: number }>(
    `SELECT COUNT(*) as c FROM flights WHERE book_id=0 AND flight_type != 'summary'`,
  );
  return r?.c ?? 0;
}

export async function getSpreadsForBook(book: LogbookBook): Promise<SpreadInfo[]> {
  const db = await getDatabase();
  // Redan transkriberade uppslag (ett per unikt spread_number)
  const past = await db.getAllAsync<{ spread_number: number }>(
    `SELECT DISTINCT spread_number FROM flights
       WHERE book_id=? AND spread_number>0
       ORDER BY spread_number ASC`,
    [book.id],
  );
  const results: SpreadInfo[] = [];
  for (const p of past) {
    const flights = await db.getAllAsync<Flight>(
      `SELECT * FROM flights WHERE book_id=? AND spread_number=? ORDER BY date ASC, dep_utc ASC, id ASC`,
      [book.id, p.spread_number],
    );
    results.push({
      book,
      spread_number: p.spread_number,
      page_left: book.starting_page + (p.spread_number - 1) * 2,
      page_right: book.starting_page + (p.spread_number - 1) * 2 + 1,
      flights,
      is_current: false,
    });
  }
  // Nuvarande uppslag — de första `rows_per_spread` otranskriberade flygningarna
  const current = await getUntranscribedFlights();
  if (current.length > 0) {
    const nextSpread = book.transcribed_spreads + 1;
    results.push({
      book,
      spread_number: nextSpread,
      page_left: book.starting_page + (nextSpread - 1) * 2,
      page_right: book.starting_page + (nextSpread - 1) * 2 + 1,
      flights: current.slice(0, book.rows_per_spread),
      is_current: true,
    });
  }
  return results;
}

// Markerar ett uppslag som transkriberat — sätter book_id + spread_number på flygningarna
// och stegar upp bokens räknare. Returnerar antal flygningar som stämplades.
export async function markSpreadTranscribed(bookId: number, flightIds: number[]): Promise<number> {
  if (flightIds.length === 0) return 0;
  const db = await getDatabase();
  const book = await db.getFirstAsync<LogbookBook>(`SELECT * FROM logbook_books WHERE id=?`, [bookId]);
  if (!book) throw new Error('Bok hittades inte');
  const nextSpread = book.transcribed_spreads + 1;
  const placeholders = flightIds.map(() => '?').join(',');
  await db.runAsync(
    `UPDATE flights SET book_id=?, spread_number=? WHERE id IN (${placeholders})`,
    [bookId, nextSpread, ...flightIds],
  );
  await db.runAsync(
    `UPDATE logbook_books SET transcribed_spreads=? WHERE id=?`,
    [nextSpread, bookId],
  );
  return flightIds.length;
}

// Backar det senast transkriberade uppslaget (ångra)
export async function unmarkLastSpread(bookId: number): Promise<void> {
  const db = await getDatabase();
  const book = await db.getFirstAsync<LogbookBook>(`SELECT * FROM logbook_books WHERE id=?`, [bookId]);
  if (!book || book.transcribed_spreads === 0) return;
  const last = book.transcribed_spreads;
  await db.runAsync(
    `UPDATE flights SET book_id=0, spread_number=0 WHERE book_id=? AND spread_number=?`,
    [bookId, last],
  );
  await db.runAsync(
    `UPDATE logbook_books SET transcribed_spreads=? WHERE id=?`,
    [last - 1, bookId],
  );
}
