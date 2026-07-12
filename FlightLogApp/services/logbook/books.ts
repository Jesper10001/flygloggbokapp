// Tilldelning av flygningar till digitala böcker (flera böcker) + anchor-matematik.
//
// Modell: böckerna är ordnade (display_order). Flygningarna sorteras kronologiskt
// och fylls FRAMÅT bok för bok efter kapacitet (hård gräns). Den FÖRSTA boken kan
// ha `leadingEmptyRows` — rader som var fyllda i pappersboken innan appen började
// användas — härledda ur bokens anchor (vilken sida/rad den SENASTE flygningen låg
// på vid konfigurationen). Allt härleds i minnet; inga flygningar stämplas.

import type { Flight } from '../../types/flight';
import type { DigitalBook } from '../../db/digitalBooks';
import type { LogbookTemplate } from '../../constants/logbookTemplates';
import { sortFlightsChrono, computeBroughtForward, type ColumnTotals } from './paginate';

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

/** Fördelar alla flygningar över böckerna (ordnade per display_order).
 *  Summeringsrader (flight_type='summary') är tidigare erfarenhet → de blir brought-forward,
 *  inte bokrader, så de exkluderas här.
 *  Ankar-driven delning: om varje bok EFTER den första har en giltig ankar-flygning delas
 *  flygningarna vid ankaren (bokens första rad = dess ankar-flygning). Annars faller vi
 *  tillbaka på kapacitets-fyllning (bakåtkompatibelt för äldre böcker). */
export function assignFlightsToBooks(books: DigitalBook[], flights: Flight[]): BookSlice[] {
  const ordered = [...books].sort((a, b) => (a.display_order - b.display_order) || (a.id - b.id));
  // Summeringsrader + dolda backfill-poster ('[BACKFILL]') är inte bokrader.
  const sorted = sortFlightsChrono(flights.filter((f) => (f as any).flight_type !== 'summary' && (f as any).remarks !== '[BACKFILL]'));

  const anchorDriven = ordered.length > 1 && ordered.slice(1).every(
    (b) => b.anchor_flight_id > 0 && sorted.some((f) => f.id === b.anchor_flight_id),
  );

  if (anchorDriven) {
    // Startindex per bok: bok 0 börjar vid 0, bok i vid sin ankar-flygnings index.
    const starts = ordered.map((b, i) => {
      if (i === 0) return 0;
      const idx = sorted.findIndex((f) => f.id === b.anchor_flight_id);
      return idx >= 0 ? idx : sorted.length;
    });
    return ordered.map((book, i) => {
      const rows = Math.max(1, book.rows_per_spread);
      const start = starts[i];
      const end = i + 1 < ordered.length ? starts[i + 1] : sorted.length;
      const flightsSlice = sorted.slice(start, Math.max(start, end));
      const leading = i === 0 ? computeLeading(book, sorted) : 0;
      const spreadCap = bookSpreadCapacity(book);
      const isFull = spreadCap !== Infinity && leading + flightsSlice.length >= spreadCap * rows;
      return { book, flights: flightsSlice, leadingEmptyRows: leading, isFull, overflowCount: 0 };
    });
  }

  // ── Fallback: kapacitets-fyllning (oförändrat beteende) ──
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

/** Bokens ingående balans (brought-forward): användarens override (opening_balance-JSON om
 *  ifylld = korrigering mot riktig loggbok), annars auto-härledd ur flygdata + summeringsrader. */
export function resolveOpeningBalance(book: DigitalBook, allFlights: Flight[], template: LogbookTemplate): ColumnTotals {
  let override: ColumnTotals = {};
  try { override = JSON.parse(book.opening_balance || '{}'); } catch { override = {}; }
  if (Object.keys(override).length > 0) return override;   // användarkorrigering
  return computeBroughtForward(allFlights, template, book.anchor_flight_id);
}

/** Plocka ut en boks slice (eller bygg en tom om boken saknas i listan). */
export function sliceForBook(slices: BookSlice[], bookId: number): BookSlice | undefined {
  return slices.find((s) => s.book.id === bookId);
}
