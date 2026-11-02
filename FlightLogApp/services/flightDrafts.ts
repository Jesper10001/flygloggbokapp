// "Save as draft" i Log Flight (pilot och drönare): ett ofullständigt formulär sparas och fortsätts från
// dashboarden (kortet under Log flight-knappen, components/DraftBanner). Ett utkast per läge, i
// inställningarna som JSON. Utkastet tas bort när flygningen sparas på riktigt. Ett utkast är ingen flygning:
// det räknas inte mot gratisgränsen och syns inte i loggboken eller statistiken.
import { getSetting, setSetting } from '../db/flights';

export type DraftMode = 'pilot' | 'drone';

export interface FlightDraft {
  savedAt: string;                    // ISO-tid när utkastet sparades
  title: string;                      // t.ex. "ESSA → ESGG" eller "No route yet"
  subtitle: string;                   // t.ex. "12 Oct · AT76 SE-MVA"
  state: Record<string, unknown>;     // formulärets tillstånd (läses tillbaka av Log Flight)
}

const key = (mode: DraftMode) => `flight_draft_${mode}`;

export async function loadFlightDraft(mode: DraftMode): Promise<FlightDraft | null> {
  try {
    const raw = await getSetting(key(mode));
    if (!raw) return null;
    const d = JSON.parse(raw);
    return d && typeof d === 'object' && d.state ? (d as FlightDraft) : null;
  } catch {
    return null;
  }
}

export async function saveFlightDraft(mode: DraftMode, draft: FlightDraft): Promise<void> {
  await setSetting(key(mode), JSON.stringify(draft));
}

export async function clearFlightDraft(mode: DraftMode): Promise<void> {
  await setSetting(key(mode), '');
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Rubrik och undertext för kortet: rutt, datum och farkost (det som hunnit fyllas i). */
export function draftLabels(p: { from?: string; to?: string; date?: string; aircraft?: string }): { title: string; subtitle: string } {
  const from = (p.from ?? '').trim().toUpperCase(), to = (p.to ?? '').trim().toUpperCase();
  const title = from || to ? `${from || '—'} → ${to || '—'}` : 'No route yet';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p.date ?? '');
  const date = m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : '';
  return { title, subtitle: [date, (p.aircraft ?? '').trim()].filter(Boolean).join(' · ') };
}
