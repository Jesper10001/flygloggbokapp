// Backfill missing hours — lump sum per fält (oberoende av total flygtid).
//
// Lagras som DOLDA "justerings-flygningar" (remarks = BF_MARKER, source='manual') så att
// värdena flödar automatiskt in i getFlightStats (app-övergripande totaler) OCH
// computeBroughtForward (bokens Current). Två poster:
//   • summary-post (flight_type='summary', total_time=0): alla icke-sim-fält.
//   • sim-post (flight_type='sim', total_time=FSTD-timmar): FSTD/simulator → total_sim.
// Bägge exkluderas från bokrader (assignFlightsToBooks) och import-batchlistan (source='manual').
import { getDatabase } from './database';
import type { Flight } from '../types/flight';

export const BF_MARKER = '[BACKFILL]';

export type BackfillValues = {
  pic: number; co_pilot: number; dual: number; picus: number; instructor: number;
  ifr: number; night: number; cross_country: number; multi_pilot: number;
  landings_day: number; landings_night: number; sim: number;
};
export const ZERO_BACKFILL: BackfillValues = {
  pic: 0, co_pilot: 0, dual: 0, picus: 0, instructor: 0, ifr: 0, night: 0,
  cross_country: 0, multi_pilot: 0, landings_day: 0, landings_night: 0, sim: 0,
};

async function getRecord(db: any, flightType: string): Promise<Flight | null> {
  return (await db.getFirstAsync(
    `SELECT * FROM flights WHERE flight_type=? AND source='manual' AND remarks=? LIMIT 1`,
    [flightType, BF_MARKER],
  )) as Flight | null;
}

// Full-kolumns-INSERT (speglar insertFlight) med nolldefaults + våra backfill-värden.
async function insertRecord(db: any, flightType: string, totalTime: number, v: BackfillValues): Promise<void> {
  await db.runAsync(
    `INSERT INTO flights (
      date, aircraft_type, registration, dep_place, dep_utc, arr_place, arr_utc,
      total_time, ifr, night, pic, co_pilot, dual, landings_day, landings_night, remarks,
      status, source, original_data, flight_rules, second_pilot, second_pilot_role, extra_pilots,
      nvg, tng_count, flight_type, multi_pilot, single_pilot, instructor, picus, spic, examiner,
      safety_pilot, observer, ferry_pic, relief_crew, sim_category, vfr, se_time, me_time,
      stop_place, photo_uri, media_type, max_fl, takeoffs_day, takeoffs_night, app_2d, app_3d, pilot_flying,
      landings_fs_day, landings_fs_night, takeoffs_faa_night, landings_faa_night, landings_fs_faa_night, holds,
      cross_country
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      '2000-01-01', '', '', '', '', '', '',
      totalTime, v.ifr, v.night, v.pic, v.co_pilot, v.dual, Math.round(v.landings_day), Math.round(v.landings_night), BF_MARKER,
      'verified', 'manual', null, 'VFR', '', '', '',
      0, 0, flightType, v.multi_pilot, 0, v.instructor, v.picus, 0, 0,
      0, 0, 0, 0, '', 0, 0, 0,
      '', '', 'image', 0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
      v.cross_country,
    ],
  );
}

/** Läser aktuella backfill-värden (0 om ingen post finns). */
export async function getBackfill(): Promise<BackfillValues> {
  const db = await getDatabase();
  const s = await getRecord(db, 'summary');
  const sim = await getRecord(db, 'sim');
  return {
    pic: s?.pic ?? 0, co_pilot: s?.co_pilot ?? 0, dual: s?.dual ?? 0, picus: s?.picus ?? 0,
    instructor: s?.instructor ?? 0, ifr: s?.ifr ?? 0, night: s?.night ?? 0,
    cross_country: (s as any)?.cross_country ?? 0, multi_pilot: s?.multi_pilot ?? 0,
    landings_day: s?.landings_day ?? 0, landings_night: s?.landings_night ?? 0,
    sim: sim?.total_time ?? 0,
  };
}

/** Sätter (upsert) backfill-värdena. Poster med enbart nollor tas bort. */
export async function setBackfill(v: BackfillValues): Promise<void> {
  const db = await getDatabase();

  // Summary-posten (icke-sim-fält, total_time=0).
  const summaryHasValue = v.pic || v.co_pilot || v.dual || v.picus || v.instructor || v.ifr
    || v.night || v.cross_country || v.multi_pilot || v.landings_day || v.landings_night;
  const summary = await getRecord(db, 'summary');
  if (summaryHasValue) {
    if (summary) {
      await db.runAsync(
        `UPDATE flights SET pic=?, co_pilot=?, dual=?, picus=?, instructor=?, ifr=?, night=?,
          cross_country=?, multi_pilot=?, landings_day=?, landings_night=? WHERE id=?`,
        [v.pic, v.co_pilot, v.dual, v.picus, v.instructor, v.ifr, v.night,
         v.cross_country, v.multi_pilot, Math.round(v.landings_day), Math.round(v.landings_night), summary.id],
      );
    } else {
      await insertRecord(db, 'summary', 0, v);
    }
  } else if (summary) {
    await db.runAsync('DELETE FROM flights WHERE id=?', [summary.id]);
  }

  // Sim-posten (FSTD → total_sim).
  const sim = await getRecord(db, 'sim');
  if (v.sim > 0) {
    if (sim) await db.runAsync('UPDATE flights SET total_time=? WHERE id=?', [v.sim, sim.id]);
    else await insertRecord(db, 'sim', v.sim, ZERO_BACKFILL);
  } else if (sim) {
    await db.runAsync('DELETE FROM flights WHERE id=?', [sim.id]);
  }
}
