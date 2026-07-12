// Currency/recency-motor (BLADES). Speglar drönar-recencymotorn (getCategoryRecency) men
// generaliserad till pilotregler per regelverk (EASA/FAA/UK CAA), styrt av settings.ruleset.
// Passagerarcurrency per rating_class (fallback aircraft_type), nattcurrency, instrument (EASA
// datum resp FAA 6HITS), medical och ratings. FFS inkluderas för landningar; FFS/FTD/FNPT_II
// för approaches. IR-som-nattsubstitut (EASA) kräver giltig IR om ir_substitute_requires_valid.
import { getDatabase } from './database';
import { getSetting } from './flights';
import { listCertificates, certStatus } from './drones';

export type Ruleset = 'EASA' | 'FAA' | 'UK CAA';
export type CurrencyStatus = 'current' | 'warning' | 'expired' | 'na';

export interface CurrencyItem {
  key: string;
  label: string;
  group?: string;         // rating_class för passagerarrader
  status: CurrencyStatus;
  detail: string;         // människoläsbar text ("3/3 · 12d kvar", "Behöver 2 landningar till")
  daysLeft?: number;      // för brådska/progress
}

export interface CurrencyReport {
  ruleset: Ruleset;
  irSubstituteRequiresValid: boolean;
  hasValidIR: boolean;
  items: CurrencyItem[];
  worst: CurrencyItem | null;
}

const DAY = 86400000;
const daysSince = (iso: string) => Math.floor((Date.now() - Date.parse(iso + 'T00:00:00')) / DAY);
const daysUntil = (iso: string) => Math.floor((Date.parse(iso + 'T00:00:00') - Date.now()) / DAY);

// Datum då den ackumulerade räkningen (nyast först) först når `need` → currency löper ut `window` dagar senare.
function reachDate(rowsDesc: { date: string; n: number }[], need: number): { total: number; reach: string | null } {
  let cum = 0, reach: string | null = null;
  for (const r of rowsDesc) { cum += r.n || 0; if (cum >= need && !reach) reach = r.date; }
  return { total: cum, reach };
}
const leftFrom = (reachISO: string, windowDays: number) => Math.max(0, windowDays - daysSince(reachISO));

const isIR = (t: string) => /instrument|^\s*ir\b|^\s*bir\b/i.test(t);
const isMedical = (t: string) => /medical|basicmed/i.test(t);
const certToStatus = (s: ReturnType<typeof certStatus>): CurrencyStatus =>
  s === 'valid' ? 'current' : s === 'expired' ? 'expired' : s === 'no_date' ? 'na' : 'warning';
function ratingToStatus(expiry: string): CurrencyStatus {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return 'na';
  const d = daysUntil(expiry);
  return d < 0 ? 'expired' : d <= 90 ? 'warning' : 'current';
}
const rank: Record<CurrencyStatus, number> = { expired: 0, warning: 1, current: 2, na: 3 };

export async function getPilotCurrency(): Promise<CurrencyReport> {
  const db = await getDatabase();
  const ruleset = (((await getSetting('ruleset')) as Ruleset) || 'EASA');
  const irReqValid = (await getSetting('ir_substitute_requires_valid')) !== '0'; // default true

  const certs = await listCertificates();
  const hasValidIR = certs.some((c) => isIR(c.cert_type) && (!irReqValid || certStatus(c.expires_date) !== 'expired'));

  const items: CurrencyItem[] = [];

  // ── Passagerarcurrency per rating_class (90 dagar; FFS ingår; egna PF-händelser) ──
  const paxRows = await db.getAllAsync<any>(
    `SELECT COALESCE(NULLIF(ar.rating_class,''), f.aircraft_type) AS grp, f.date AS date,
            (f.takeoffs_day + f.takeoffs_night) AS tos,
            (f.landings_day + f.landings_night) AS ldgs,
            f.takeoffs_night AS to_n, f.landings_night AS ldg_n,
            f.takeoffs_faa_night AS to_fn, f.landings_fs_faa_night AS ldg_fs_fn
       FROM flights f
       LEFT JOIN (SELECT aircraft_type, MAX(rating_class) AS rating_class FROM aircraft_registry GROUP BY aircraft_type) ar
         ON ar.aircraft_type = f.aircraft_type
      WHERE f.date >= date('now','-90 days')
        AND (f.flight_type != 'sim' OR f.sim_category = 'FFS')
        AND (f.takeoffs_day + f.takeoffs_night + f.landings_day + f.landings_night) > 0
      ORDER BY f.date DESC`,
  );
  const byGrp = new Map<string, any[]>();
  for (const r of paxRows) {
    if (!r.grp) continue;
    if (!byGrp.has(r.grp)) byGrp.set(r.grp, []);
    byGrp.get(r.grp)!.push(r);
  }
  for (const [grp, rows] of byGrp) {
    // Dag: 3 starter + 3 landningar / 90 dagar.
    const to = reachDate(rows.map((r) => ({ date: r.date, n: r.tos })), 3);
    const ldg = reachDate(rows.map((r) => ({ date: r.date, n: r.ldgs })), 3);
    const dayCurrent = !!(to.reach && ldg.reach);
    const dayLeft = dayCurrent ? Math.min(leftFrom(to.reach!, 90), leftFrom(ldg.reach!, 90)) : undefined;
    items.push({
      key: `pax-day:${grp}`, label: `Passenger day · ${grp}`, group: grp,
      status: dayCurrent ? (dayLeft! <= 14 ? 'warning' : 'current') : 'expired',
      detail: dayCurrent ? `T/O ${to.total} · Ldg ${ldg.total} · ${dayLeft}d left`
                         : `Need ${Math.max(0, 3 - to.total)} T/O + ${Math.max(0, 3 - ldg.total)} ldg (90d)`,
      daysLeft: dayLeft,
    });

    // Natt.
    if (ruleset === 'FAA') {
      const nto = reachDate(rows.map((r) => ({ date: r.date, n: r.to_fn })), 3);
      const nldg = reachDate(rows.map((r) => ({ date: r.date, n: r.ldg_fs_fn })), 3);
      const cur = !!(nto.reach && nldg.reach);
      const dl = cur ? Math.min(leftFrom(nto.reach!, 90), leftFrom(nldg.reach!, 90)) : undefined;
      items.push({
        key: `pax-night:${grp}`, label: `Passenger night · ${grp}`, group: grp,
        status: cur ? (dl! <= 14 ? 'warning' : 'current') : 'expired',
        detail: cur ? `${nto.total} night T/O · ${nldg.total} full-stop night ldg · ${dl}d left`
                    : `FAA: need ${Math.max(0, 3 - nto.total)} T/O + ${Math.max(0, 3 - nldg.total)} full-stop ldg at night (90d)`,
        daysLeft: dl,
      });
    } else {
      // EASA/CAA: dag-currency + (≥1 nattstart + ≥1 nattlandning) ELLER giltig IR.
      const nTo = rows.reduce((s, r) => s + (r.to_n || 0), 0);
      const nLdg = rows.reduce((s, r) => s + (r.ldg_n || 0), 0);
      const nightEvents = nTo >= 1 && nLdg >= 1;
      const cur = dayCurrent && (nightEvents || hasValidIR);
      const viaIR = hasValidIR && !nightEvents;
      items.push({
        key: `pax-night:${grp}`, label: `Passenger night · ${grp}`, group: grp,
        status: cur ? (dayLeft != null && dayLeft <= 14 ? 'warning' : 'current') : 'expired',
        detail: viaIR ? 'Met via valid IR' : `${nTo} night T/O · ${nLdg} night ldg${dayCurrent ? '' : ' (day currency lapsed)'}`,
        daysLeft: cur ? dayLeft : undefined,
      });
    }
  }

  // ── Instrument ──
  if (ruleset === 'FAA') {
    const r = await db.getFirstAsync<{ apps: number; holds: number }>(
      `SELECT COALESCE(SUM(app_2d + app_3d),0) AS apps, COALESCE(SUM(holds),0) AS holds
         FROM flights
        WHERE date >= date('now','-6 months')
          AND (flight_type != 'sim' OR sim_category IN ('FFS','FTD','FNPT_II'))`,
    );
    const apps = r?.apps ?? 0, holds = r?.holds ?? 0;
    const cur = apps >= 6 && holds >= 1;
    items.push({
      key: 'ifr', label: 'Instrument (6 HITS)',
      status: cur ? 'current' : 'expired',
      detail: cur ? `${apps} approaches · ${holds} hold (last 6 mo)`
                  : `Need ${Math.max(0, 6 - apps)} approaches + ${holds >= 1 ? 0 : 1} hold (6 mo) · <12mo: safety pilot · >12mo: IPC`,
    });
  } else {
    const ir = certs.filter((c) => isIR(c.cert_type)).sort((a, b) => (a.expires_date || '9999').localeCompare(b.expires_date || '9999'))[0];
    if (!ir) items.push({ key: 'ifr', label: 'Instrument (IR)', status: 'na', detail: 'No IR/BIR on file' });
    else {
      const st = certToStatus(certStatus(ir.expires_date));
      const dl = /^\d{4}-\d{2}-\d{2}$/.test(ir.expires_date) ? daysUntil(ir.expires_date) : undefined;
      items.push({ key: 'ifr', label: 'Instrument (IR)', status: st, detail: ir.expires_date ? `Expires ${ir.expires_date}${dl != null ? ` · ${dl}d` : ''}` : 'No expiry set', daysLeft: dl });
    }
  }

  // ── Medical ──
  const meds = certs.filter((c) => isMedical(c.cert_type) && c.expires_date)
    .sort((a, b) => a.expires_date.localeCompare(b.expires_date));
  if (!meds.length) items.push({ key: 'medical', label: 'Medical', status: 'na', detail: 'No medical on file' });
  else {
    const m = meds[0];
    const dl = daysUntil(m.expires_date);
    items.push({ key: 'medical', label: `Medical (${m.cert_type})`, status: certToStatus(certStatus(m.expires_date)), detail: `Expires ${m.expires_date} · ${dl}d`, daysLeft: dl });
  }

  // ── Ratings (aircraft_registry.rating_expiry per rating_class) ──
  const ratings = await db.getAllAsync<{ rating_class: string; rating_expiry: string }>(
    `SELECT rating_class, MIN(rating_expiry) AS rating_expiry
       FROM aircraft_registry
      WHERE rating_expiry != '' AND rating_class != ''
      GROUP BY rating_class`,
  );
  for (const r of ratings) {
    const dl = /^\d{4}-\d{2}-\d{2}$/.test(r.rating_expiry) ? daysUntil(r.rating_expiry) : undefined;
    items.push({ key: `rating:${r.rating_class}`, label: `Rating · ${r.rating_class}`, group: r.rating_class, status: ratingToStatus(r.rating_expiry), detail: `Expires ${r.rating_expiry}${dl != null ? ` · ${dl}d` : ''}`, daysLeft: dl });
  }

  // Sämsta status → dashboard-kortet (expired > warning > current; minst daysLeft vinner).
  const ranked = items.filter((i) => i.status !== 'na').sort((a, b) => {
    if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
    return (a.daysLeft ?? 1e9) - (b.daysLeft ?? 1e9);
  });
  return { ruleset, irSubstituteRequiresValid: irReqValid, hasValidIR, items, worst: ranked[0] ?? null };
}
