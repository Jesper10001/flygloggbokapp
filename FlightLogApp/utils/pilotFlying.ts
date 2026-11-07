// Pilot flying för flygningar från CSV-import och skanning. Säger loggboken något om det (PF-tid, "Yes"/"No",
// "PF"/"PM") gäller det. Annars sätts det automatiskt: hela flygtiden om flygningen har en landning, annars 0,
// eftersom en flygning utan tillgodoräknad landning betyder att man inte var pilot flying.

export type PfStated = 'yes' | 'no' | undefined;

const PF_YES = /^(yes|y|true|x|pf|✓|✔)$/i;
const PF_NO = /^(no|n|false|pm)$/i;

// Ett textvärde i en PF-kolumn: 'yes', 'no' eller undefined (en tid eller tomt).
export function pfFromText(raw: string): PfStated {
  const t = raw.trim();
  return PF_YES.test(t) ? 'yes' : PF_NO.test(t) ? 'no' : undefined;
}

type PfFlight = {
  pilot_flying?: string; total_time?: string;
  landings_day?: string; landings_night?: string; landings_fs_day?: string; landings_fs_night?: string;
};

export function landingsOf(d: PfFlight): number {
  return [d.landings_day, d.landings_night, d.landings_fs_day, d.landings_fs_night]
    .reduce((s, v) => s + (parseInt(String(v ?? '0'), 10) || 0), 0);
}

export function autoPilotFlying(d: PfFlight, stated?: PfStated): void {
  if (stated === 'yes') { d.pilot_flying = d.total_time ?? '0'; return; }
  if (stated === 'no') { d.pilot_flying = '0'; return; }
  if ((parseFloat(d.pilot_flying ?? '0') || 0) > 0) return;
  d.pilot_flying = landingsOf(d) > 0 ? (d.total_time ?? '0') : '0';
}
