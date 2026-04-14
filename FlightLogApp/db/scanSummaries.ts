import { getDatabase } from './database';
import type { PageTotals } from '../services/ocr';

export interface ScanSummary {
  id: number;
  book_name: string;
  page_name: string;
  created_at: string;
  total_this_page: PageTotals;
  brought_forward: PageTotals;
  total_to_date: PageTotals;
  row_count: number;
  flight_count_at_save: number;
}

export async function saveScanSummary(
  bookName: string,
  pageName: string,
  totalThisPage: PageTotals,
  broughtForward: PageTotals,
  totalToDate: PageTotals,
  rowCount: number,
  flightCountAtSave: number,
): Promise<number> {
  const db = await getDatabase();
  const result = await db.runAsync(
    `INSERT INTO scan_summaries (book_name, page_name, total_this_page, brought_forward, total_to_date, row_count, flight_count_at_save)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      bookName,
      pageName,
      JSON.stringify(totalThisPage),
      JSON.stringify(broughtForward),
      JSON.stringify(totalToDate),
      rowCount,
      flightCountAtSave,
    ]
  );
  return result.lastInsertRowId;
}

export async function getAllScanSummaries(): Promise<ScanSummary[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{
    id: number; book_name: string; page_name: string; created_at: string;
    total_this_page: string; brought_forward: string; total_to_date: string;
    row_count: number; flight_count_at_save: number;
  }>('SELECT * FROM scan_summaries ORDER BY created_at ASC');

  return rows.map(r => ({
    id: r.id,
    book_name: r.book_name,
    page_name: r.page_name,
    created_at: r.created_at,
    total_this_page: JSON.parse(r.total_this_page),
    brought_forward: JSON.parse(r.brought_forward),
    total_to_date: JSON.parse(r.total_to_date),
    row_count: r.row_count,
    flight_count_at_save: r.flight_count_at_save,
  }));
}

export async function deleteScanSummary(id: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM scan_summaries WHERE id = ?', [id]);
}

export async function updateScanSummaryNames(id: number, bookName: string, pageName: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE scan_summaries SET book_name = ?, page_name = ? WHERE id = ?', [bookName, pageName, id]);
}
