// Total radering av all användardata: databas (via wipeAllUserData), lokala mediafiler och iCloud-backup.
// Promo-koder ligger kvar på Cloudflare (device-bundna) och återställs vid nästa entitlement-check.
import * as FileSystem from 'expo-file-system/legacy';
import { wipeAllUserData } from '../db/appData';
import { deleteBackup, setEnabled as setICloudEnabled } from './icloudSync';

const MEDIA_DIRS = ['flight_photos', 'flight_videos', 'fleet-cutouts'];

export async function wipeEverything(): Promise<void> {
  // 1) Ta bort iCloud-backupen (om den finns) + stäng av synk, så raderingen även gäller molnet.
  try { await deleteBackup(); } catch { /* ingen backup / ingen modul */ }
  try { await setICloudEnabled(false); } catch { /* ignore */ }
  // 2) Radera all lokal databasdata.
  await wipeAllUserData();
  // 3) Radera användarens mediafiler (foton/videor/urklippta flygplansbilder).
  for (const d of MEDIA_DIRS) {
    try { await FileSystem.deleteAsync((FileSystem.documentDirectory ?? '') + d + '/', { idempotent: true }); } catch { /* ignore */ }
  }
}
