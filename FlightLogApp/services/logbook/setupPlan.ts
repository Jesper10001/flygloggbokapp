// Bokplanen när den digitala loggboken skapas (components/logbook/BookSetupFlow): var den senaste flygningen som
// står i pappersboken ligger (sida + rad) avgör hur många flygningar som får plats i boken före den. Resten står i
// tidigare böcker: antingen fler böcker av samma sort (ankar-styrda: varje bok efter den första börjar på sin
// ankar-flygning, services/logbook/books.ts) eller Brought forward i en enda bok (bokens ankare = flygningen).

export interface PlannedBook {
  startingPage: number;
  endPage: number;          // 0 = obegränsad
  anchorFlightId: number;
  anchorPage: number;
  anchorRow: number;
  count: number;            // flygningar i en tidigare bok (0 för den aktuella)
}

export interface SetupPlan {
  leftPage: number;         // uppslagets vänstersida
  room: number;             // rader fram till och med flygningen
  earlier: number;          // flygningar som står i tidigare böcker
  books: PlannedBook[];     // den aktuella boken sist
}

export function planBooks(o: {
  bookFlightIds: number[];  // bokens flygningar i kronologisk ordning (utan summerings- och backfill-rader)
  anchorPos: number;        // index för flygningen som står sist i pappersboken (-1 = inga flygningar)
  firstPage: number;
  lastPage: number;         // 0 = vet inte
  rowsPerSpread: number;
  page: number;             // sidan flygningen står på (vilken sida av uppslaget som helst)
  row: number;
  earlierChoice: 'books' | 'bf' | null;
  earlierLastPage: number;  // de tidigare böckernas sista sida
}): SetupPlan {
  const fp = Math.max(1, o.firstPage);
  const rs = Math.max(1, o.rowsPerSpread);
  const spreadIdx = Math.max(0, Math.floor((Math.max(fp, o.page) - fp) / 2));
  const leftPage = fp + spreadIdx * 2;
  const row = Math.max(1, Math.min(rs, o.row));
  const room = spreadIdx * rs + row;
  const earlier = Math.max(0, o.anchorPos + 1 - room);
  const anchorId = o.anchorPos >= 0 ? o.bookFlightIds[o.anchorPos] ?? 0 : 0;
  const single: PlannedBook[] = [{
    startingPage: fp, endPage: o.lastPage, anchorFlightId: anchorId,
    anchorPage: anchorId ? leftPage : 0, anchorRow: anchorId ? row : 0, count: 0,
  }];
  if (!(earlier > 0 && o.earlierChoice === 'books')) return { leftPage, room, earlier, books: single };

  const eLast = Math.max(fp + 1, o.earlierLastPage);
  const cap = (Math.floor((eLast - fp) / 2) + 1) * rs;
  const n = Math.max(1, Math.ceil(earlier / cap));
  // De nyaste av de tidigare böckerna är fulla; den äldsta tar resten.
  const starts = Array.from({ length: n }, (_, k) => (k === 0 ? 0 : earlier - (n - k) * cap));
  const books: PlannedBook[] = starts.map((s, k) => ({
    startingPage: fp, endPage: eLast,
    anchorFlightId: k === 0 ? 0 : o.bookFlightIds[s], anchorPage: k === 0 ? 0 : fp, anchorRow: k === 0 ? 0 : 1,
    count: (k + 1 < n ? starts[k + 1] : earlier) - s,
  }));
  books.push({ startingPage: fp, endPage: o.lastPage, anchorFlightId: o.bookFlightIds[earlier], anchorPage: fp, anchorRow: 1, count: 0 });
  return { leftPage, room, earlier, books };
}
