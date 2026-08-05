// Delad igenkänning av auto-genererade remarks-rader (route/approach/pilot/cabin/Max FL) så att
// t.ex. flight-overview kan visa ENBART den fria texten. Måste hållas i synk med route-/roll-modellen
// i app/flight/add.tsx.
import { APP_FIRST_WORDS } from '../components/logflight/ApproachFlow';

const KIND_TOK_RE = 'TnG|LA|PU\\/DO|PU|DO|HR';
const STOP_LINE_RE = new RegExp(`^([A-Z]{2,4})\\s+(${KIND_TOK_RE})\\b`, 'i');
const APPROACH_LINE_RE = new RegExp(`^([A-Z]{3,4})\\s+(?:${APP_FIRST_WORDS.join('|')})\\b`, 'i');

export const SP_SHORTS = ['PIC', 'SIC', 'FI', 'SPIC', 'PICUS'];
export const CREW_KEYS = ['Crew chief', 'Rescue swimmer', 'Winch operator', 'HEMS operator', 'Loadmaster'];
const PILOT_ENTRY_RE = new RegExp(`^(?:${SP_SHORTS.join('|')}): `);
const CREW_ENTRY_RE = new RegExp(`^(?:${CREW_KEYS.join('|')}): `);

export const isPilotLine = (t: string) => { const ps = t.split(', ').map((s) => s.trim()).filter(Boolean); return ps.length > 0 && ps.every((p) => PILOT_ENTRY_RE.test(p)); };
export const isCabinLine = (t: string) => { const ps = t.split(', ').map((s) => s.trim()).filter(Boolean); return ps.length > 0 && ps.every((p) => CREW_ENTRY_RE.test(p)); };

export const isManagedRemarkLine = (l: string) => {
  const t = l.trim();
  return STOP_LINE_RE.test(t) || APPROACH_LINE_RE.test(t) || /^Max FL\d+/i.test(t) || isPilotLine(t) || isCabinLine(t);
};

// Endast den fria texten (icke-hanterade rader) ur remarks.
export const freeRemarks = (remarks: string | null | undefined): string =>
  (remarks || '').split('\n').map((l) => l.trim()).filter((l) => l && !isManagedRemarkLine(l)).join('\n');
