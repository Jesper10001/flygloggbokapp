// Fotokredit för Fleet-bilder som hämtades från Wikimedia INNAN krediten fanns (före 2026-10-27).
// Körs i bakgrunden efter start: varje Wikimedia-bild utan kredit slås upp (gratis Wikimedia-API, ingen AI).
//  • fri licens       → krediten sparas och visas på Fleet-kortet
//  • ej fri / raderad → bilden tas bort (kortets hämta-knapp hittar en ny, som nu filtreras på licens)
//  • nätfel           → avbryt; resten tas vid nästa start
import { getDatabase } from '../db/database';
import { updateAircraftFleetFields } from '../db/flights';
import { updateDroneModelImage } from '../db/drones';
import { creditForWikiUrl, WIKI_IMAGE_URL_PREFIXES } from './wikiPhoto';
import { serializeCredit } from '../utils/photoCredit';

const [UPLOAD_LIKE, THUMB_LIKE] = WIKI_IMAGE_URL_PREFIXES.map((p) => p + '%');
const MAX_PER_RUN = 40; // ett par sekunder nät per start räcker gott (fleeten har sällan fler bilder)
let running = false;

export async function backfillPhotoCredits(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const db = await getDatabase();
    const aircraft = await db.getAllAsync<{ key: string; url: string }>(
      `SELECT aircraft_type AS key, MAX(image_url) AS url FROM aircraft_registry
        WHERE (image_url LIKE ? OR image_url LIKE ?) AND image_credit = '' GROUP BY aircraft_type`, [UPLOAD_LIKE, THUMB_LIKE],
    );
    const drones = await db.getAllAsync<{ key: string; url: string }>(
      `SELECT model AS key, MAX(image_url) AS url FROM drone_registry
        WHERE (image_url LIKE ? OR image_url LIKE ?) AND image_credit = '' GROUP BY model`, [UPLOAD_LIKE, THUMB_LIKE],
    );
    const jobs = [
      ...aircraft.map((r) => ({ ...r, kind: 'ac' as const })),
      ...drones.map((r) => ({ ...r, kind: 'drone' as const })),
    ].slice(0, MAX_PER_RUN);

    for (const j of jobs) {
      const res = await creditForWikiUrl(j.url);
      if (res.status === 'error') break; // nätfel → nästa start
      const fields = res.status === 'ok'
        ? { image_credit: serializeCredit(res.credit) }
        : { image_url: '', cutout_url: '', image_credit: '' };
      if (j.kind === 'ac') await updateAircraftFleetFields(j.key, fields);
      else await updateDroneModelImage(j.key, fields);
    }
  } catch {
    /* tyst — körs igen vid nästa start */
  } finally {
    running = false;
  }
}
