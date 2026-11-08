// Flygalbumets bilder (tabellen flight_photos, se db/database.ts): referenser till fotobiblioteket per flygning.
import { getDatabase } from './database';

export interface FlightPhotoRow {
  id: number;
  flight_id: number;
  local_id: string;
  taken_at: number | null;
  is_video: number;
  duration: number;
  removed: number;
}

export interface NewFlightPhoto { flightId: number; localId: string; takenAt: number; isVideo: boolean; duration: number }

/** Albumets bilder (ej borttagna) för flygningar som finns kvar. */
export async function getAlbumPhotoRows(): Promise<FlightPhotoRow[]> {
  const db = await getDatabase();
  return db.getAllAsync<FlightPhotoRow>(
    `SELECT p.* FROM flight_photos p JOIN flights f ON f.id = p.flight_id WHERE p.removed = 0`,
  );
}

/** Alla bibliotekets id:n som redan hör till en flygning (även borttagna) → läggs aldrig till igen. */
export async function getKnownLocalIds(): Promise<Set<string>> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ local_id: string }>('SELECT local_id FROM flight_photos');
  return new Set(rows.map((r) => r.local_id));
}

/** Flygningar som har minst en bild i albumet. */
export async function getFlightIdsWithAlbumPhotos(): Promise<Set<number>> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ flight_id: number }>('SELECT DISTINCT flight_id FROM flight_photos WHERE removed = 0');
  return new Set(rows.map((r) => r.flight_id));
}

/** Foton som kopplats som flygningens bild före albumet (photo_local_id) blir rader, utan tid (läses sen). */
export async function seedCoverPhotos(): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT OR IGNORE INTO flight_photos (flight_id, local_id, is_video)
     SELECT id, photo_local_id, CASE WHEN media_type = 'video' THEN 1 ELSE 0 END FROM flights
     WHERE photo_local_id IS NOT NULL AND photo_local_id != ''`,
  );
}

export async function insertFlightPhotos(rows: NewFlightPhoto[]): Promise<void> {
  if (!rows.length) return;
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    for (const r of rows) {
      await db.runAsync(
        'INSERT OR IGNORE INTO flight_photos (flight_id, local_id, taken_at, is_video, duration) VALUES (?, ?, ?, ?, ?)',
        [r.flightId, r.localId, Math.round(r.takenAt), r.isVideo ? 1 : 0, r.duration || 0],
      );
    }
  });
}

export async function setFlightPhotoTakenAt(id: number, takenAt: number): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE flight_photos SET taken_at = ? WHERE id = ?', [Math.round(takenAt), id]);
}

/** Ta bort ur albumet (eller ångra). Bilden ligger kvar i fotobiblioteket. */
export async function setFlightPhotosRemoved(ids: number[], removed: boolean): Promise<void> {
  if (!ids.length) return;
  const db = await getDatabase();
  await db.runAsync(
    `UPDATE flight_photos SET removed = ? WHERE id IN (${ids.map(() => '?').join(',')})`,
    [removed ? 1 : 0, ...ids],
  );
}

/** Bilden som lagts till för hand (photo_uri) tas bort ur flygningen, eller läggs tillbaka (ångra). */
export async function setFlightManualPhoto(flightId: number, uri: string, mediaType: 'image' | 'video'): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('UPDATE flights SET photo_uri = ?, media_type = ? WHERE id = ?', [uri, mediaType, flightId]);
}
