// Tilldelning av flygningar till digitala böcker (flera böcker) + anchor-matematik.
//
// Modell: böckerna är ordnade (display_order). Flygningarna sorteras kronologiskt
// och fylls FRAMÅT bok för bok efter kapacitet (hård gräns). Den FÖRSTA boken kan
// ha `leadingEmptyRows` — rader som var fyllda i pappersboken innan appen började
// användas — härledda ur bokens anchor (vilken sida/rad den SENASTE flygningen låg
// på vid konfigurationen). Allt härleds i minnet; inga flygningar stämplas.

import type { Flight } from '../../types/flight';
import type { DigitalBook } from '../../db/digitalBooks';
import { sortFlightsChrono } from './paginate';

export interface BookSlice {
  book: DigitalBook;
  flights: Flight[];        // flygningar som hör till denna bok (kronologisk ordning)
  leadingEmptyRows: number; // tomma rader överst (endast första boken)
  isFull: boolean;          // hård kapacitet nådd
  overflowCount: number;    // flygningar som inte fick plats och saknar nästa bok
}

/** Antal uppslag boken rymmer; Infinity om end_page saknas (obegränsad). */
export function bookSpreadCapacity(book: DigitalBook): number {
  if (!book.end_page || book.end_page <= 0) return Infinity;
  return Math.floor((book.end_page - book.starting_page) / 2) + 1;
}

/** Global 0-indexerad rad där bokens anchor-flygning sitter, eller null om ingen anchor. */
export function anchorRowIndex(book: DigitalBook): number | null {
  if (!book.anchor_page || book.anchor_page <= 0 || !book.anchor_row || book.anchor_row <= 0) return null;
  const rows = Math.max(1, book.rows_per_spread);
  const spreadIndex = Math.floor((book.anchor_page - book.starting_page) / 2);
  if (spreadIndex < 0) return null;
  return spreadIndex * rows + (book.anchor_row - 1);
}

/** Hur många tomma rader första boken ska ha överst för att anchor-flygningen ska
 *  hamna på rätt (sida, rad). Klampas till >= 0 (fler flygningar än som ryms före
 *  ankaret → börja från rad 1, behåll alla). */
function computeLeading(book: DigitalBook, sorted: Flight[]): number {
  const ari = anchorRowIndex(book);
  if (ari === null) return 0;
  if (sorted.length === 0) return ari;
  let g = -1;
  if (book.anchor_flight_id > 0) g = sorted.findIndex((f) => f.id === book.anchor_flight_id);
  if (g < 0) g = sorted.length - 1; // anchor-flygning borttagen → förankra på senaste
  return Math.max(0, ari - g);
}

/** Fördelar alla flygningar över böckerna (ordnade per display_order). */
export function assignFlightsToBooks(books: DigitalBook[], flights: Flight[]): BookSlice[] {
  const ordered = [...books].sort((a, b) => (a.display_order - b.display_order) || (a.id - b.id));
  const sorted = sortFlightsChrono(flights);
  const slices: BookSlice[] = [];
  let cursor = 0;
  for (let i = 0; i < ordered.length; i++) {
    const book = ordered[i];
    const rows = Math.max(1, book.rows_per_spread);
    const leading = i === 0 ? computeLeading(book, sorted) : 0;
    const spreadCap = bookSpreadCapacity(book);
    const isLast = i === ordered.length - 1;

    let take: number;
    let isFull = false;
    if (spreadCap === Infinity) {
      take = sorted.length - cursor; // obegränsad bok tar resten
    } else {
      const rowCap = Math.max(0, spreadCap * rows - leading);
      take = Math.min(sorted.length - cursor, rowCap);
      isFull = leading + take >= spreadCap * rows;
    }
    const slice = sorted.slice(cursor, cursor + take);
    cursor += take;
    const overflowCount = isLast ? sorted.length - cursor : 0;
    slices.push({ book, flights: slice, leadingEmptyRows: leading, isFull, overflowCount });
  }
  return slices;
}

/** Plocka ut en boks slice (eller bygg en tom om boken saknas i listan). */
export function sliceForBook(slices: BookSlice[], bookId: number): BookSlice | undefined {
  return slices.find((s) => s.book.id === bookId);
}
