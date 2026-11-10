// Tilldelning av flygningar till digitala böcker (flera böcker) + anchor-matematik.
//
// Modell: böckerna är ordnade (display_order) och flygningarna sorteras kronologiskt.
// Varje bok kan ha ett ankare: en flygning och sidan + raden den står på i pappersboken.
// Ankaret avgör var boken börjar (flygningen hamnar på sin sida och rad, och raderna före
// den fylls bakåt). En bok utan ankare tar vid där boken före blir full. Allt härleds i
// minnet; inga flygningar stämplas.

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
  overCapacity: number;     // rader utöver bokens sidor i en bok som har en bok efter sig (visas efter sista sidan)
}

/** Flygningar som är rader i boken. Summeringsrader, gamla dolda backfill-poster och sim-raden från
 *  Backfill missing hours ("Blades previous experience") är tidigare erfarenhet: de räknas i Brought
 *  forward (computeBroughtForward) och tar ingen rad. */
export function isBookRow(f: Flight): boolean {
  const type = (f as any).flight_type;
  const remarks = (f as any).remarks;
  if (type === 'summary' || remarks === '[BACKFILL]') return false;
  return !(type === 'sim' && remarks === 'Blades previous experience');
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
 *  Tidigare erfarenhet (isBookRow) blir brought-forward, inte bokrader.
 *  Flera böcker: en bok EFTER den första börjar där dess ankare säger. Ankar-flygningen står på
 *  ankarets sida och rad, så boken börjar så många rader före den (sida = bokens första, rad 1 →
 *  boken börjar med flygningen). En bok utan ankare tar vid där boken före blir full. Den sista
 *  boken slutar vid sin sista sida; resten väntar på nästa bok (overflowCount). */
export function assignFlightsToBooks(books: DigitalBook[], flights: Flight[]): BookSlice[] {
  const ordered = [...books].sort((a, b) => (a.display_order - b.display_order) || (a.id - b.id));
  const sorted = sortFlightsChrono(flights.filter(isBookRow));

  // ── Enskild bok = den SENASTE boken. Fönstret SLUTAR vid ankar-flygningen (senaste flygningen,
  //    placerad på anchor-sidan/raden) och fylls BAKÅT. Vid överspill faller de ÄLDSTA flygningarna
  //    bort — de ligger i tidigare böcker vi inte bygger och blir brought-forward — INTE de senaste.
  //    (Tidigare: kapacitetsfyllningen nedan tog alltid de FÖRSTA flygningarna från index 0, så en
  //    ensam bok hamnade över de första timmarna i stället för de senaste.) */
  if (ordered.length === 1) {
    const book = ordered[0];
    const rows = Math.max(1, book.rows_per_spread);
    const spreadCap = bookSpreadCapacity(book);
    const totalRowCap = spreadCap === Infinity ? Infinity : spreadCap * rows;
    const ari = anchorRowIndex(book);
    let anchorIdx = book.anchor_flight_id > 0 ? sorted.findIndex((f) => f.id === book.anchor_flight_id) : -1;
    if (anchorIdx < 0) anchorIdx = Math.max(0, sorted.length - 1); // inget/borttaget ankare → senaste flygningen
    // Global rad där ankar-flygningen ska sitta. Utan rad-ankare → sista möjliga raden (fyll till slutet).
    const anchorRow = ari !== null
      ? ari
      : (totalRowCap === Infinity ? anchorIdx : Math.min(anchorIdx, totalRowCap - 1));
    const leading = Math.max(0, anchorRow - anchorIdx);        // tomma rader överst om få flygningar
    const start = Math.max(0, anchorIdx - anchorRow);          // hoppa över de äldsta (brought-forward) vid överspill
    const rowCap = totalRowCap === Infinity ? Infinity : Math.max(0, totalRowCap - leading);
    const take = rowCap === Infinity ? sorted.length - start : Math.min(sorted.length - start, rowCap);
    const flightsSlice = sorted.slice(start, start + take);
    const isFull = totalRowCap !== Infinity && leading + flightsSlice.length >= totalRowCap;
    const overflowCount = Math.max(0, sorted.length - (start + take));
    return [{ book, flights: flightsSlice, leadingEmptyRows: leading, isFull, overflowCount, overCapacity: 0 }];
  }

  // ── Flera böcker ──
  const n = ordered.length;
  const rowCap = (b: DigitalBook) => { const c = bookSpreadCapacity(b); return c === Infinity ? Infinity : c * Math.max(1, b.rows_per_spread); };
  const indexOf = (id: number) => (id > 0 ? sorted.findIndex((f) => f.id === id) : -1);
  const starts: number[] = new Array(n).fill(0);
  const leads: number[] = new Array(n).fill(0);
  // Första boken: som en ensam bok. Står ankar-flygningen längre ned än raderna före den räcker till är de
  // äldsta flygningarna Brought forward (boken börjar senare); är de färre blir det tomma rader överst.
  {
    const ari = anchorRowIndex(ordered[0]);
    const g = indexOf(ordered[0].anchor_flight_id);
    if (ari !== null && g >= 0) { starts[0] = Math.max(0, g - ari); leads[0] = Math.max(0, ari - g); }
    else leads[0] = computeLeading(ordered[0], sorted);
  }
  for (let i = 1; i < n; i++) {
    const book = ordered[i];
    const g = indexOf(book.anchor_flight_id);
    if (g < 0) {
      // Inget ankare (eller flygningen är borttagen): boken tar vid där boken före blir full.
      const cap = rowCap(ordered[i - 1]);
      starts[i] = cap === Infinity ? sorted.length : Math.min(sorted.length, starts[i - 1] + Math.max(0, cap - leads[i - 1]));
      continue;
    }
    const want = g - (anchorRowIndex(book) ?? 0);
    if (want < starts[i - 1]) { starts[i] = starts[i - 1]; leads[i] = starts[i - 1] - want; }
    else starts[i] = want;
  }
  return ordered.map((book, i) => {
    const last = i === n - 1;
    const cap = rowCap(book);
    let slice = sorted.slice(starts[i], last ? sorted.length : Math.max(starts[i], starts[i + 1]));
    let overflowCount = 0;
    if (last && cap !== Infinity) {
      const room = Math.max(0, cap - leads[i]);
      if (slice.length > room) { overflowCount = slice.length - room; slice = slice.slice(0, room); }
    }
    const used = leads[i] + slice.length;
    return {
      book, flights: slice, leadingEmptyRows: leads[i],
      isFull: cap !== Infinity && used >= cap,
      overflowCount,
      overCapacity: !last && cap !== Infinity ? Math.max(0, used - cap) : 0,
    };
  });
}

/** Bokens ingående balans (brought-forward): användarens override (opening_balance-JSON om
 *  ifylld = korrigering mot riktig loggbok), annars auto-härledd.
 *
 *  VIKTIGT: brought-forward = erfarenhet FÖRE bokens EGNA flighter (summeringsrader + tidigare
 *  böckers flighter). Gränsen är bokens FÖRSTA slice-flight — INTE `anchor_flight_id`, som är
 *  den SENASTE flygningen (används bara för layout-positionering via leadingEmptyRows). Om man
 *  använder ankaret här summeras nästan alla bokens EGNA flighter som "tidigare erfarenhet" och
 *  läggs sedan till EN GÅNG TILL som siduppslags-rader → total to date fördubblas. */
export function resolveOpeningBalance(book: DigitalBook, allBooks: DigitalBook[], allFlights: Flight[], template: LogbookTemplate): ColumnTotals {
  let override: ColumnTotals = {};
  try { override = JSON.parse(book.opening_balance || '{}'); } catch { override = {}; }
  if (Object.keys(override).length > 0) return override;   // användarkorrigering
  // Gräns = bokens första EGNA flight → allt kronologiskt före den (summeringsrader + tidigare
  // böcker) blir brought-forward. Första boken → oftast tomt (0), vilket är korrekt.
  const slices = assignFlightsToBooks(allBooks, allFlights);
  const i = slices.findIndex((s) => s.book.id === book.id);
  const firstOwnFlightId = slices[i]?.flights?.[0]?.id ?? 0;
  if (firstOwnFlightId > 0 || i < 0) return computeBroughtForward(allFlights, template, firstOwnFlightId);
  // Tom bok: det som står i böckerna före den är Brought forward (en ny bok som inte har några flygningar än).
  const later = slices.slice(i + 1).find((s) => s.flights.length > 0);
  if (later) return computeBroughtForward(allFlights, template, later.flights[0].id);
  const earlier = slices.slice(0, i).some((s) => s.flights.length > 0);
  return computeBroughtForward(allFlights, template, 0, undefined, { noAnchorBase: earlier ? 'all' : 'summary' });
}

/** Plocka ut en boks slice (eller bygg en tom om boken saknas i listan). */
export function sliceForBook(slices: BookSlice[], bookId: number): BookSlice | undefined {
  return slices.find((s) => s.book.id === bookId);
}
