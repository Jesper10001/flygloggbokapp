// Vad som är nytt i "Blades was updated"-popupen (UpdateAppliedModal). Varje EAS Update har en egen post i
// constants/updateNotes.json (id +1 varje gång). Popupen visar bara posterna som kommit sedan den senast visades:
// oftast den senaste uppdateringens egna rader. Har flera uppdateringar kommit sedan dess (appen har inte
// startats emellan, eller ett nytt App Store-bygge har inte öppnats) slås de ihop och de största visas först.
import DATA from '../constants/updateNotes.json';
import { parseReleaseNotes, POPUP_MAX, type ReleaseNote } from '../store/versionStore';

export interface UpdateNotesEntry { id: number; notes: string[] }

export const UPDATE_NOTES: UpdateNotesEntry[] = DATA.updates;
/** Den senaste postens id: koden som körs (bygget eller uppdateringen) innehåller allt till och med den. */
export const NOTES_ID = UPDATE_NOTES.reduce((m, e) => Math.max(m, e.id), 0);
/** Id:t före den senaste posten. */
export const PREVIOUS_NOTES_ID = UPDATE_NOTES.reduce((m, e) => (e.id < NOTES_ID ? Math.max(m, e.id) : m), 0);

const RANK: Record<ReleaseNote['kind'], number> = { new: 0, improved: 1, fix: 2, other: 3 };

/** Raderna i posterna efter `since` (null = alla). En post: i den ordning de skrevs. Flera: New före Improved
 *  före Fixed, varje posts första rad före dess andra, och nyare före äldre. Samma rad visas bara en gång. */
export function notesSince(since: number | null, entries: UpdateNotesEntry[] = UPDATE_NOTES): { notes: ReleaseNote[]; more: boolean } {
  const missed = entries.filter((e) => since == null || e.id > since);
  const items = missed.flatMap((e) => parseReleaseNotes(e.notes, Infinity).notes.map((n, pos) => ({ n, pos, id: e.id })));
  if (missed.length > 1) items.sort((a, b) => RANK[a.n.kind] - RANK[b.n.kind] || a.pos - b.pos || b.id - a.id);
  const seen = new Set<string>();
  const unique = items.filter(({ n }) => {
    const key = n.text.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { notes: unique.slice(0, POPUP_MAX).map((x) => x.n), more: unique.length > POPUP_MAX };
}
