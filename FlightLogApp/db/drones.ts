import { getDatabase } from './database';

// Fritt textfält i DB så vi klarar både civila (A1/A2/A3/Specific/Certified)
// och militära scheman (MRPAS/RPAS/NATO-C1-Mini etc.)
export type DroneCategory = string;
export type DroneType = 'multirotor' | 'fixedwing' | 'vtol' | 'helicopter' | '';

export interface DroneRegistryEntry {
  id: number;
  drone_type: DroneType;
  model: string;
  registration: string;
  mtow_g: number;
  category: DroneCategory;
  drone_class?: string; // 'military' | 'civil' | '' — anges själv i drönar-modalen
  notes: string;
  image_url?: string;   // Fleet-foto (valt ur bibliotek)
  cutout_url?: string;  // VisionKit-urklipp för pop-out-effekten
  manufacturer?: string;
  c_class?: string;        // EU-klass C0–C6
  max_flight_min?: number; // max flygtid (min)
  max_speed_kmh?: number;  // max hastighet (km/h)
  ceiling_m?: number;      // tjänstetak (m)
  range_km?: number;       // länkräckvidd (km)
}

// Fleet-vy grupperad per modell (= pilot getAllAircraftTypes): en post per modell med
// aggregerade specar (MAX över radernas värden), total flygtid och antal registreringar.
export interface DroneModelFleet {
  id: number;            // representativ rad-id (MIN) — stabil nyckel
  model: string;
  drone_type: DroneType;
  mtow_g: number;
  category: DroneCategory;
  drone_class: string;
  manufacturer: string;
  c_class: string;
  max_flight_min: number;
  max_speed_kmh: number;
  ceiling_m: number;
  range_km: number;
  image_url: string;
  cutout_url: string;
  total_hours: number;   // summa flygtid över modellens alla registreringar
  last_flown: string;
  reg_count: number;
  flight_count: number;  // antal flygningar på modellen (gate för "Remove model")
}

export async function listDrones(): Promise<DroneRegistryEntry[]> {
  const db = await getDatabase();
  return db.getAllAsync<DroneRegistryEntry>(
    `SELECT * FROM drone_registry ORDER BY model, registration`
  );
}

export interface DroneUsage { drone_id: number; total_time: number; flight_count: number; last_flown: string }

export async function getDroneUsage(): Promise<DroneUsage[]> {
  const db = await getDatabase();
  return db.getAllAsync<DroneUsage>(
    `SELECT drone_id,
            ROUND(SUM(total_time), 2) AS total_time,
            COUNT(*) AS flight_count,
            MAX(date) AS last_flown
       FROM drone_flights
      WHERE drone_id IS NOT NULL
      GROUP BY drone_id`
  );
}

// Fleet-foto per drönare (valt ur bibliotek) + cachat VisionKit-urklipp.
export async function updateDroneImage(id: number, fields: { image_url?: string; cutout_url?: string }): Promise<void> {
  const db = await getDatabase();
  const sets: string[] = []; const vals: any[] = [];
  if (fields.image_url !== undefined) { sets.push('image_url=?'); vals.push(fields.image_url); }
  if (fields.cutout_url !== undefined) { sets.push('cutout_url=?'); vals.push(fields.cutout_url); }
  if (!sets.length) return;
  vals.push(id);
  await db.runAsync(`UPDATE drone_registry SET ${sets.join(', ')} WHERE id=?`, vals);
}

// ── Fleet grupperad per modell (= pilot getAllAircraftTypes / getRegistrationHours) ──

export async function getDroneFleetByModel(): Promise<DroneModelFleet[]> {
  const db = await getDatabase();
  return db.getAllAsync<DroneModelFleet>(
    `SELECT MIN(dr.id) AS id,
            dr.model AS model,
            MAX(dr.drone_type) AS drone_type,
            MAX(dr.mtow_g) AS mtow_g,
            MAX(dr.category) AS category,
            MAX(dr.drone_class) AS drone_class,
            MAX(dr.manufacturer) AS manufacturer,
            MAX(dr.c_class) AS c_class,
            MAX(dr.max_flight_min) AS max_flight_min,
            MAX(dr.max_speed_kmh) AS max_speed_kmh,
            MAX(dr.ceiling_m) AS ceiling_m,
            MAX(dr.range_km) AS range_km,
            MAX(dr.image_url) AS image_url,
            MAX(dr.cutout_url) AS cutout_url,
            COALESCE(ROUND(SUM(f.total_time), 2), 0) AS total_hours,
            COALESCE(MAX(f.date), '') AS last_flown,
            COUNT(DISTINCT CASE WHEN dr.registration != '' THEN dr.id END) AS reg_count,
            COUNT(f.id) AS flight_count
       FROM drone_registry dr
       LEFT JOIN drone_flights f ON f.drone_id = dr.id
      GROUP BY dr.model
      ORDER BY last_flown DESC, total_hours DESC`
  );
}

export async function getDroneModelRegistrations(model: string): Promise<{ registration: string; drone_id: number; hours: number; last_flown: string; flightCount: number }[]> {
  const db = await getDatabase();
  return db.getAllAsync(
    `SELECT dr.registration AS registration,
            dr.id AS drone_id,
            COALESCE(ROUND(SUM(f.total_time), 2), 0) AS hours,
            COALESCE(MAX(f.date), '') AS last_flown,
            COUNT(f.id) AS flightCount
       FROM drone_registry dr
       LEFT JOIN drone_flights f ON f.drone_id = dr.id
      WHERE dr.model = ? AND dr.registration != ''
      GROUP BY dr.id
      ORDER BY hours DESC, last_flown DESC`,
    [model]
  );
}

// Manuell redigering av modellens specar (sätter EXAKTA värden på alla modellens rader,
// till skillnad från persistDroneModelLookup som bara fyller tomma). Speglar pilot updateAircraftFleetFields.
export async function updateDroneModelFields(model: string, fields: {
  drone_type?: string; manufacturer?: string; mtow_g?: number;
  max_flight_min?: number; max_speed_kmh?: number; ceiling_m?: number; range_km?: number;
}): Promise<void> {
  const db = await getDatabase();
  const sets: string[] = []; const vals: any[] = [];
  const put = (col: string, v: any) => { if (v !== undefined) { sets.push(`${col}=?`); vals.push(v); } };
  put('drone_type', fields.drone_type);
  put('manufacturer', fields.manufacturer);
  put('mtow_g', fields.mtow_g);
  put('max_flight_min', fields.max_flight_min);
  put('max_speed_kmh', fields.max_speed_kmh);
  put('ceiling_m', fields.ceiling_m);
  put('range_km', fields.range_km);
  if (!sets.length) return;
  vals.push(model);
  await db.runAsync(`UPDATE drone_registry SET ${sets.join(', ')} WHERE model=?`, vals);
}

// Byt modellnamn → uppdaterar alla registret-rader för modellen (flygningar följer via drone_id).
export async function renameDroneModel(oldModel: string, newModel: string): Promise<void> {
  const from = oldModel.trim(); const to = newModel.trim();
  if (!from || !to || from === to) return;
  const db = await getDatabase();
  await db.runAsync(`UPDATE drone_registry SET model=? WHERE model=?`, [to, from]);
}

// Byt namn på EN registrering (per drone_id) → uppdaterar registret + denormaliserad reg på flygningarna.
export async function renameDroneRegistration(droneId: number, newReg: string): Promise<void> {
  const to = newReg.trim().toUpperCase();
  if (!to) return;
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`UPDATE drone_registry SET registration=? WHERE id=?`, [to, droneId]);
    await db.runAsync(`UPDATE drone_flights SET registration=? WHERE drone_id=?`, [to, droneId]);
  });
}

// Sätt foto/urklipp på ALLA rader för en modell → modell-kortet blir konsekvent.
export async function updateDroneModelImage(model: string, fields: { image_url?: string; cutout_url?: string }): Promise<void> {
  const db = await getDatabase();
  const sets: string[] = []; const vals: any[] = [];
  if (fields.image_url !== undefined) { sets.push('image_url=?'); vals.push(fields.image_url); }
  if (fields.cutout_url !== undefined) { sets.push('cutout_url=?'); vals.push(fields.cutout_url); }
  if (!sets.length) return;
  vals.push(model);
  await db.runAsync(`UPDATE drone_registry SET ${sets.join(', ')} WHERE model=?`, vals);
}

// Persist AI-uppslag på modellnivå: sätt bara icke-tomma värden (skriv inte över med blanka).
export async function persistDroneModelLookup(model: string, fields: {
  manufacturer?: string; drone_type?: string; mtow_g?: number; c_class?: string;
  max_flight_min?: number; max_speed_kmh?: number; ceiling_m?: number; range_km?: number; image_url?: string; cutout_url?: string;
}): Promise<void> {
  const db = await getDatabase();
  const sets: string[] = []; const vals: any[] = [];
  const nonEmptyStr = (x: any) => typeof x === 'string' && x.trim().length > 0;
  const positive = (x: any) => typeof x === 'number' && x > 0;
  const put = (col: string, v: any, keep: (x: any) => boolean) => { if (v !== undefined && keep(v)) { sets.push(`${col}=?`); vals.push(v); } };
  put('manufacturer', fields.manufacturer, nonEmptyStr);
  put('drone_type', fields.drone_type, nonEmptyStr);
  put('mtow_g', fields.mtow_g, positive);
  put('c_class', fields.c_class, nonEmptyStr);
  put('max_flight_min', fields.max_flight_min, positive);
  put('max_speed_kmh', fields.max_speed_kmh, positive);
  put('ceiling_m', fields.ceiling_m, positive);
  put('range_km', fields.range_km, positive);
  if (fields.image_url !== undefined) { sets.push('image_url=?'); vals.push(fields.image_url); }
  if (fields.cutout_url !== undefined) { sets.push('cutout_url=?'); vals.push(fields.cutout_url); }
  if (!sets.length) return;
  vals.push(model);
  await db.runAsync(`UPDATE drone_registry SET ${sets.join(', ')} WHERE model=?`, vals);
}

// Ta bort en enskild registrering, resp. hela modellen (alla dess registreringar).
export async function deleteDroneRegistration(id: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM drone_registry WHERE id=?`, [id]);
}

export async function deleteDroneModel(model: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM drone_registry WHERE model=?`, [model]);
}

export async function getDrone(id: number): Promise<DroneRegistryEntry | null> {
  const db = await getDatabase();
  return db.getFirstAsync<DroneRegistryEntry>(
    `SELECT * FROM drone_registry WHERE id=?`,
    [id]
  );
}

export async function addDrone(data: Omit<DroneRegistryEntry, 'id'>): Promise<number> {
  const db = await getDatabase();
  const res = await db.runAsync(
    `INSERT INTO drone_registry (drone_type, model, registration, mtow_g, category, drone_class, notes)
     VALUES (?,?,?,?,?,?,?)`,
    [data.drone_type, data.model, data.registration.toUpperCase(), data.mtow_g, data.category, data.drone_class ?? '', data.notes]
  );
  return res.lastInsertRowId as number;
}

export async function updateDrone(id: number, data: Omit<DroneRegistryEntry, 'id'>): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE drone_registry
     SET drone_type=?, model=?, registration=?, mtow_g=?, category=?, drone_class=?, notes=?
     WHERE id=?`,
    [data.drone_type, data.model, data.registration.toUpperCase(), data.mtow_g, data.category, data.drone_class ?? '', data.notes, id]
  );
}

// Tömmer bara kategori-fältet på alla drönare i registret så användaren måste
// klassa om dem till den nya pilot-typen. Drönarna själva,
// flygtid och historiska flight.category behålls orörda.
export async function getDroneFlightCount(): Promise<number> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ c: number }>(`SELECT COUNT(*) as c FROM drone_flights`);
  return row?.c ?? 0;
}

export async function clearDroneRegistryCategories(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`UPDATE drone_registry SET category=''`);
}

export async function deleteDrone(id: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM drone_registry WHERE id=?`, [id]);
}

// ─── CERTIFIKAT ──────────────────────────────────────────────────────────────

export interface DroneCertificate {
  id: number;
  cert_type: string;
  label: string;
  issued_date: string;
  expires_date: string;
  notes: string;
}

export async function listCertificates(): Promise<DroneCertificate[]> {
  const db = await getDatabase();
  return db.getAllAsync<DroneCertificate>(
    `SELECT * FROM drone_certificates ORDER BY expires_date ASC`
  );
}

export async function addCertificate(data: Omit<DroneCertificate, 'id'>): Promise<number> {
  const db = await getDatabase();
  const res = await db.runAsync(
    `INSERT INTO drone_certificates (cert_type, label, issued_date, expires_date, notes)
     VALUES (?,?,?,?,?)`,
    [data.cert_type, data.label, data.issued_date, data.expires_date, data.notes]
  );
  return res.lastInsertRowId as number;
}

export async function updateCertificate(id: number, data: Omit<DroneCertificate, 'id'>): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE drone_certificates
     SET cert_type=?, label=?, issued_date=?, expires_date=?, notes=?
     WHERE id=?`,
    [data.cert_type, data.label, data.issued_date, data.expires_date, data.notes, id]
  );
}

export async function deleteCertificate(id: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(`DELETE FROM drone_certificates WHERE id=?`, [id]);
}

export function certStatus(expiresDate: string): 'valid' | 'warning' | 'critical' | 'expired' | 'no_date' {
  if (!expiresDate) return 'no_date';
  const exp = new Date(expiresDate);
  const now = new Date();
  const days = Math.floor((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) return 'expired';
  if (days < 30) return 'critical';
  if (days < 60) return 'warning';
  return 'valid';
}

export async function getExpiringCertificates(daysAhead = 60): Promise<DroneCertificate[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<DroneCertificate>(
    `SELECT * FROM drone_certificates WHERE expires_date != '' ORDER BY expires_date ASC`
  );
  const now = new Date();
  return rows.filter((c) => {
    const exp = new Date(c.expires_date);
    const days = Math.floor((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return days <= daysAhead;
  });
}

export interface CategoryRecency {
  category: string;
  daysAgo: number;
  lastFlightDate: string;
  isStale: boolean; // > 90 dagar sedan senaste flygning i kategorin
}

// Recency per operativ kategori: dagar sedan senaste flygning (EASA 90-dagars
// riktmärke). Endast kategorier som faktiskt flugits returneras.
export async function getCategoryRecency(): Promise<CategoryRecency[]> {
  const flights = await getDroneFlights(1000);
  const latest: Record<string, string> = {};
  for (const f of flights) {
    if (!f.category) continue;
    if (!latest[f.category] || f.date > latest[f.category]) latest[f.category] = f.date;
  }
  const order = ['A1', 'A2', 'A3', 'Specific', 'Certified'];
  const now = Date.now();
  return Object.keys(latest)
    .sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    })
    .map((cat) => {
      const daysAgo = Math.floor((now - new Date(latest[cat] + 'T00:00:00').getTime()) / 86400000);
      return { category: cat, daysAgo, lastFlightDate: latest[cat], isStale: daysAgo > 90 };
    });
}

// ─── FLYGNINGAR ──────────────────────────────────────────────────────────────

export type DroneFlightMode = 'VLOS' | 'EVLOS' | 'BVLOS';

export interface DroneFlight {
  id: number;
  date: string;
  drone_id: number | null;
  drone_type: string;
  registration: string;
  location: string;
  lat: number;
  lon: number;
  takeoff_time: string;       // "HH:MM" lokal — driver natt-auto (tom = okänt)
  landing_location: string;   // separat landningspunkt (BVLOS/korridor); tom = samma som start
  landing_lat: number;
  landing_lon: number;
  mission_type: string;
  category: string;
  flight_mode: DroneFlightMode;
  total_time: number;
  max_altitude_m: number;
  is_night: number;
  night_time: number;     // nattandel i timmar (kondition-bar)
  vfr: number;            // VFR-tid i timmar
  flight_rules: string;   // 'VFR' | 'Y' | 'Z' | 'IFR'
  has_observer: number;
  observer_name: string;
  wind_ms: number;
  co_pilot_fpv: number;   // FPV/andrepilot-tid
  dual: number;           // elevtid (student)
  instructor: number;     // instruktörstid
  ifr: number;
  landings_day: number;
  landings_night: number;
  operation_type: string; // 'PRI' | 'COM' — privat vs kommersiell (Type of mission)
  remarks: string;
  created_at: string;
}

export interface DroneFlightFormData {
  date: string;
  drone_id: number | null;
  drone_type?: string;
  registration?: string;
  location: string;
  lat?: number;
  lon?: number;
  takeoff_time?: string;
  landing_location?: string;
  landing_lat?: number;
  landing_lon?: number;
  mission_type: string;
  category: string;
  flight_mode: DroneFlightMode;
  total_time: string;
  max_altitude_m: string;
  is_night: boolean;
  night_time?: string;    // nattandel i timmar (kondition-bar)
  vfr?: string;
  flight_rules?: string;  // 'VFR' | 'Y' | 'Z' | 'IFR'
  has_observer: boolean;
  observer_name: string;
  wind_ms?: string;
  co_pilot_fpv?: string;
  dual?: string;
  instructor?: string;
  ifr?: string;
  landings_day?: string;
  landings_night?: string;
  operation_type?: string; // 'PRI' | 'COM'
  remarks: string;
}

export async function insertDroneFlight(data: DroneFlightFormData): Promise<number> {
  const db = await getDatabase();
  const res = await db.runAsync(
    `INSERT INTO drone_flights (
      date, drone_id, drone_type, registration, location, lat, lon,
      takeoff_time, landing_location, landing_lat, landing_lon,
      mission_type, category, flight_mode, total_time, max_altitude_m,
      is_night, night_time, vfr, flight_rules, has_observer, observer_name, wind_ms,
      co_pilot_fpv, dual, instructor, ifr, landings_day, landings_night, operation_type, remarks
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      data.date,
      data.drone_id,
      data.drone_type ?? '',
      (data.registration ?? '').toUpperCase(),
      data.location,
      data.lat ?? 0,
      data.lon ?? 0,
      data.takeoff_time ?? '',
      data.landing_location ?? '',
      data.landing_lat ?? 0,
      data.landing_lon ?? 0,
      data.mission_type,
      data.category,
      data.flight_mode,
      parseFloat(data.total_time) || 0,
      parseInt(data.max_altitude_m, 10) || 0,
      data.is_night ? 1 : 0,
      parseFloat(data.night_time ?? '') || 0,
      parseFloat(data.vfr ?? '') || 0,
      data.flight_rules ?? 'VFR',
      data.has_observer ? 1 : 0,
      data.observer_name,
      parseFloat(data.wind_ms ?? '') || 0,
      parseFloat(data.co_pilot_fpv ?? '') || 0,
      parseFloat(data.dual ?? '') || 0,
      parseFloat(data.instructor ?? '') || 0,
      parseFloat(data.ifr ?? '') || 0,
      parseInt(data.landings_day ?? '', 10) || 0,
      parseInt(data.landings_night ?? '', 10) || 0,
      data.operation_type ?? '',
      data.remarks,
    ]
  );
  return res.lastInsertRowId as number;
}

export async function getDroneFlights(limit = 200): Promise<DroneFlight[]> {
  const db = await getDatabase();
  return db.getAllAsync<DroneFlight>(
    `SELECT * FROM drone_flights ORDER BY date DESC, id DESC LIMIT ?`,
    [limit]
  );
}

export async function getDroneFlightById(id: number): Promise<DroneFlight | null> {
  const db = await getDatabase();
  return db.getFirstAsync<DroneFlight>('SELECT * FROM drone_flights WHERE id=?', [id]);
}

export async function updateDroneFlight(id: number, data: DroneFlightFormData): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE drone_flights SET
      date=?, drone_id=?, drone_type=?, registration=?, location=?, lat=?, lon=?,
      takeoff_time=?, landing_location=?, landing_lat=?, landing_lon=?,
      mission_type=?, category=?, flight_mode=?, total_time=?, max_altitude_m=?,
      is_night=?, night_time=?, vfr=?, flight_rules=?, has_observer=?, observer_name=?, wind_ms=?,
      co_pilot_fpv=?, dual=?, instructor=?, ifr=?, landings_day=?, landings_night=?, operation_type=?, remarks=?
     WHERE id=?`,
    [
      data.date,
      data.drone_id,
      data.drone_type ?? '',
      (data.registration ?? '').toUpperCase(),
      data.location,
      data.lat ?? 0,
      data.lon ?? 0,
      data.takeoff_time ?? '',
      data.landing_location ?? '',
      data.landing_lat ?? 0,
      data.landing_lon ?? 0,
      data.mission_type,
      data.category,
      data.flight_mode,
      parseFloat(data.total_time) || 0,
      parseInt(data.max_altitude_m, 10) || 0,
      data.is_night ? 1 : 0,
      parseFloat(data.night_time ?? '') || 0,
      parseFloat(data.vfr ?? '') || 0,
      data.flight_rules ?? 'VFR',
      data.has_observer ? 1 : 0,
      data.observer_name,
      parseFloat(data.wind_ms ?? '') || 0,
      parseFloat(data.co_pilot_fpv ?? '') || 0,
      parseFloat(data.dual ?? '') || 0,
      parseFloat(data.instructor ?? '') || 0,
      parseFloat(data.ifr ?? '') || 0,
      parseInt(data.landings_day ?? '', 10) || 0,
      parseInt(data.landings_night ?? '', 10) || 0,
      data.operation_type ?? '',
      data.remarks,
      id,
    ]
  );
}

export async function deleteDroneFlight(id: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM drone_flights WHERE id=?', [id]);
}

export interface DroneStats {
  total_flights: number;
  total_time: number;
  year_to_date: number;
  vlos: number;
  evlos: number;
  bvlos: number;
  night: number;
  cat_a1: number;
  cat_a2: number;
  cat_a3: number;
  cat_specific: number;
  cat_certified: number;
}

export async function getDroneStats(): Promise<DroneStats> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<any>(`
    SELECT
      COUNT(*) as total_flights,
      ROUND(SUM(total_time), 2) as total_time,
      ROUND(SUM(CASE WHEN strftime('%Y', date) = strftime('%Y', 'now') THEN total_time ELSE 0 END), 2) as year_to_date,
      ROUND(SUM(CASE WHEN flight_mode='VLOS' THEN total_time ELSE 0 END), 2) as vlos,
      ROUND(SUM(CASE WHEN flight_mode='EVLOS' THEN total_time ELSE 0 END), 2) as evlos,
      ROUND(SUM(CASE WHEN flight_mode='BVLOS' THEN total_time ELSE 0 END), 2) as bvlos,
      ROUND(SUM(CASE WHEN is_night=1 THEN total_time ELSE 0 END), 2) as night,
      ROUND(SUM(CASE WHEN category='A1' THEN total_time ELSE 0 END), 2) as cat_a1,
      ROUND(SUM(CASE WHEN category='A2' THEN total_time ELSE 0 END), 2) as cat_a2,
      ROUND(SUM(CASE WHEN category='A3' THEN total_time ELSE 0 END), 2) as cat_a3,
      ROUND(SUM(CASE WHEN category='Specific' THEN total_time ELSE 0 END), 2) as cat_specific,
      ROUND(SUM(CASE WHEN category='Certified' THEN total_time ELSE 0 END), 2) as cat_certified
    FROM drone_flights
  `);
  return {
    total_flights: row?.total_flights ?? 0,
    total_time: row?.total_time ?? 0,
    year_to_date: row?.year_to_date ?? 0,
    vlos: row?.vlos ?? 0,
    evlos: row?.evlos ?? 0,
    bvlos: row?.bvlos ?? 0,
    night: row?.night ?? 0,
    cat_a1: row?.cat_a1 ?? 0,
    cat_a2: row?.cat_a2 ?? 0,
    cat_a3: row?.cat_a3 ?? 0,
    cat_specific: row?.cat_specific ?? 0,
    cat_certified: row?.cat_certified ?? 0,
  };
}


// Drönar-arbetsbelastning (14d vs baslinje) — speglar getStressHours (db/flights.ts)
// men på drone_flights. Driver stressindikatorn på drönar-dashboarden.
export async function getDroneStressHours(): Promise<{ recent14: number; yearAvg14: number }> {
  const db = await getDatabase();
  const r14 = await db.getFirstAsync<{ h: number }>(
    `SELECT ROUND(SUM(total_time), 2) as h FROM drone_flights WHERE date >= date('now', '-14 days')`
  );
  const monthRows = await db.getAllAsync<{ m: string; h: number }>(
    `SELECT strftime('%m', date) as m, ROUND(SUM(total_time), 2) as h FROM drone_flights
     WHERE date >= date('now', '-379 days') AND date < date('now', '-14 days')
     GROUP BY strftime('%m', date)`
  );
  if (monthRows.length === 0) return { recent14: r14?.h ?? 0, yearAvg14: 0 };

  const avgMonthly = monthRows.reduce((s, r) => s + r.h, 0) / monthRows.length;
  const inactiveMonths = new Set(monthRows.filter(r => r.h < avgMonthly * 0.3).map(r => r.m));
  for (let m = 1; m <= 12; m++) {
    const key = String(m).padStart(2, '0');
    if (!monthRows.find(r => r.m === key)) inactiveMonths.add(key);
  }
  const weekdayRows = await db.getAllAsync<{ wd: number; cnt: number }>(
    `SELECT CAST(strftime('%w', date) AS INTEGER) as wd, COUNT(*) as cnt FROM drone_flights
     WHERE date >= date('now', '-379 days') AND date < date('now', '-14 days')
     GROUP BY strftime('%w', date)`
  );
  const weekdayCounts = [0, 0, 0, 0, 0, 0, 0];
  for (const r of weekdayRows) weekdayCounts[r.wd] = r.cnt;
  const maxWeekday = Math.max(...weekdayCounts);
  const activeWeekdays = weekdayCounts.filter(c => c >= maxWeekday * 0.2).length;
  const activeDaysPerWeek = Math.max(activeWeekdays, 1);
  const activeHours = monthRows.filter(r => !inactiveMonths.has(r.m)).reduce((s, r) => s + r.h, 0);
  const activeMonths = 12 - inactiveMonths.size;
  const activeDays = activeMonths * 30.4 * (activeDaysPerWeek / 7);
  const avg14 = activeDays > 0 ? Math.round((activeHours / activeDays * 14) * 100) / 100 : 0;
  return { recent14: r14?.h ?? 0, yearAvg14: avg14 };
}

/** Distinkta senaste startplatser (för snabbvals-chips i Log Flight), senast använda först. */
export async function getRecentDroneLocations(limit = 6): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ location: string }>(
    `SELECT location FROM drone_flights
     WHERE TRIM(COALESCE(location, '')) != ''
     GROUP BY location
     ORDER BY MAX(date) DESC, MAX(id) DESC
     LIMIT ?`,
    [limit],
  );
  return rows.map((r) => r.location);
}
