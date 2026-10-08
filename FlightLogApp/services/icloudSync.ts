// iCloud-synk (Fas 1): säkerhetskopiera hela SQLite-databasen + refererade mediefiler till användarens
// iCloud, och återställ på en annan enhet. Skyddsräcken: VACUUM INTO-snapshot (aldrig råkopiera WAL),
// lokal säkerhetskopia FÖRE restore, gemensamma-kolumner-kopiering (robust mot schema-drift),
// URI-omskrivning till den nya enhetens sandbox, och validering av manifest-format. Kräver
// native-modulen (dev/EAS-build) — allt gate:as på isAvailable()/accountStatus().
import * as FileSystem from 'expo-file-system/legacy';
import { getDatabase } from '../db/database';
import { getSetting, setSetting } from '../db/flights';
import { seedIcaoAirports } from '../db/icao';
import { getDbKey, getBackupKey } from './dbKey';
import * as ICloud from '../modules/icloud-sync';
import {
  BACKUP_FORMAT_VERSION, buildManifest, collectCounts, parseManifest,
  type BackupFileEntry, type BackupManifest,
} from './backupManifest';

const REMOTE_DIR = 'backups/current';
const REMOTE_SNAPSHOT = `${REMOTE_DIR}/snapshot.db`;
const REMOTE_MANIFEST = `${REMOTE_DIR}/manifest.json`;
const REMOTE_FILES = `${REMOTE_DIR}/files`;

const TMP = FileSystem.documentDirectory + 'icloud-tmp/';
const SAFETY = FileSystem.documentDirectory + 'icloud-safety/';

// Användartabeller som ERSÄTTS vid restore (icao_airports hanteras separat → seeden rörs ej).
const REPLACE_TABLES = [
  'flights', 'drone_flights', 'aircraft_registry', 'drone_registry', 'drone_certificates',
  'logbook_books', 'custom_templates', 'favorite_airports', 'scan_summaries', 'ocr_learned', 'settings',
];

// Kolumner med absoluta fil-URI:er som skrivs om till den nya enhetens documentDirectory vid restore.
const URI_COLUMNS: [string, string][] = [
  ['flights', 'photo_uri'],
  ['aircraft_registry', 'image_url'],
  ['aircraft_registry', 'cutout_url'],
  ['drone_registry', 'image_url'],
  ['drone_registry', 'cutout_url'],
];

const ENABLED_KEY = 'icloud_sync_enabled';

export type SyncErrorCode = 'NO_MODULE' | 'NO_ICLOUD' | 'NOT_SIGNED_IN' | 'NEWER_FORMAT' | 'NO_BACKUP' | 'FAILED' | 'KEY_MISSING' | 'INTEGRITY';

// Settings-nycklar som är ENHETSLOKALA och INTE ska skrivas över av en annan enhets backup vid restore.
const DEVICE_LOCAL_SETTINGS = ['icloud_sync_enabled'];
export class SyncError extends Error {
  code: SyncErrorCode;
  constructor(code: SyncErrorCode, message: string) { super(message); this.code = code; this.name = 'SyncError'; }
}

const osPath = (uri: string) => uri.replace('file://', '');

async function ensureDir(uri: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) await FileSystem.makeDirectoryAsync(uri, { intermediates: true });
}

// ── Konto/inställning ────────────────────────────────────────────────────────
export async function getAccount(): Promise<{ hasModule: boolean; available: boolean; signedIn: boolean }> {
  if (!ICloud.isAvailable()) return { hasModule: false, available: false, signedIn: false };
  try {
    const a = await ICloud.accountStatus();
    return { hasModule: true, available: a.available, signedIn: a.signedIn };
  } catch {
    return { hasModule: true, available: false, signedIn: false };
  }
}

export async function isEnabled(): Promise<boolean> {
  return (await getSetting(ENABLED_KEY).catch(() => null)) === '1';
}

export async function setEnabled(v: boolean): Promise<void> {
  await setSetting(ENABLED_KEY, v ? '1' : '0');
}

function requireAccount(acct: { available: boolean; signedIn: boolean }): void {
  if (!acct.available) {
    throw new SyncError(acct.signedIn ? 'NO_ICLOUD' : 'NOT_SIGNED_IN',
      acct.signedIn ? 'iCloud Drive is turned off for this app.' : 'You are not signed in to iCloud.');
  }
}

// ── Backup ───────────────────────────────────────────────────────────────────
export async function backupNow(): Promise<BackupManifest> {
  if (!ICloud.isAvailable()) throw new SyncError('NO_MODULE', 'iCloud is unavailable in this build.');
  requireAccount(await ICloud.accountStatus());

  const db = await getDatabase();
  await ensureDir(TMP);

  // 0) Säkerställ att DB-nyckeln ligger i iCloud Keychain (add-if-absent) INNAN backup — annars kan en
  //    NY enhet inte dekryptera snapshoten (den är krypterad med den här enhetens nyckel).
  const dbKey = await getDbKey();
  await ICloud.setDbKey(dbKey).catch(() => {});

  // 0b) Fånga stabila iCloud-foton-id:n för bibliotekskopplade foton → följer med i snapshoten så en ny
  //     enhet kan återlänka dem (lokala PHAsset-id:n är per-enhet). Tyst om iCloud-foton av/behörighet saknas.
  await populatePhotoCloudIds(db).catch(() => {});

  // 1) Konsistent DB-snapshot (VACUUM INTO ger en ren enfilskopia trots WAL-läge).
  const snapUri = TMP + 'snapshot.db';
  await FileSystem.deleteAsync(snapUri, { idempotent: true });
  await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE);').catch(() => {});
  await db.execAsync(`VACUUM INTO '${osPath(snapUri)}'`);

  // 1b) Strippa icao-seeden ur snapshoten (restore reseed:ar ändå) → mycket mindre uppladdning.
  //     Snapshoten ärver DB:ns nyckel → ATTACH med samma nyckel; behåll custom-flygplatser.
  try {
    await db.execAsync(`ATTACH DATABASE '${osPath(snapUri)}' AS strip KEY '${dbKey}';`);
    await db.execAsync('DELETE FROM strip.icao_airports WHERE COALESCE(custom, 0) = 0;');
    await db.execAsync('VACUUM strip;');
  } catch { /* ej kritiskt: ladda hellre upp ostrippad snapshot än att faila */ }
  finally { await db.execAsync('DETACH DATABASE strip;').catch(() => {}); }

  const snapInfo = await FileSystem.getInfoAsync(snapUri);
  const snapshotSize = snapInfo.exists ? snapInfo.size : 0;
  const snapshotSha = await ICloud.sha256(snapUri).catch(() => undefined);

  // 2) Samla lokala mediefiler som DB:n refererar (bara under documentDirectory → stabila).
  const docDir = FileSystem.documentDirectory!;
  const files = await collectReferencedFiles(db, docDir);

  // 3) Ladda upp snapshot → BEKRÄFTA att den nått iCloud → filer → manifest (manifest sist = commit).
  //    Bekräftelsen är poängen: utan den säger appen "synced" innan bytes lämnat enheten.
  await ICloud.upload(snapUri, REMOTE_SNAPSHOT);
  const snapOk = await ICloud.confirmUploaded(REMOTE_SNAPSHOT, 120000).catch(() => false);
  if (!snapOk) throw new SyncError('FAILED', 'The backup did not finish uploading to iCloud. Check your connection and try again.');

  const uploaded: BackupFileEntry[] = [];
  for (const f of files) {
    try {
      await ICloud.upload(docDir + f.rel, `${REMOTE_FILES}/${f.rel}`);
      await ICloud.confirmUploaded(`${REMOTE_FILES}/${f.rel}`, 60000).catch(() => false);
      uploaded.push(f);
    } catch { /* hoppa över en fil som ej går att ladda upp; övriga fortsätter */ }
  }

  const device = await ICloud.deviceName().catch(() => 'iPhone');
  const counts = await collectCounts();
  const manifest = buildManifest({ counts, snapshotSize, snapshotSha, files: uploaded, device, sourceDocumentDirectory: docDir });

  const manifestUri = TMP + 'manifest.json';
  await FileSystem.writeAsStringAsync(manifestUri, JSON.stringify(manifest));
  await ICloud.upload(manifestUri, REMOTE_MANIFEST);
  const manOk = await ICloud.confirmUploaded(REMOTE_MANIFEST, 60000).catch(() => false);
  if (!manOk) throw new SyncError('FAILED', 'The backup did not finish uploading to iCloud. Check your connection and try again.');

  return manifest;
}

async function collectReferencedFiles(db: Awaited<ReturnType<typeof getDatabase>>, docDir: string): Promise<BackupFileEntry[]> {
  const q = async (sql: string): Promise<{ u: string }[]> =>
    (await db.getAllAsync<{ u: string }>(sql).catch(() => [])) as { u: string }[];
  const sets = [
    await q("SELECT photo_uri AS u FROM flights WHERE photo_uri IS NOT NULL AND photo_uri != ''"),
    await q("SELECT image_url AS u FROM aircraft_registry WHERE image_url IS NOT NULL AND image_url != ''"),
    await q("SELECT cutout_url AS u FROM aircraft_registry WHERE cutout_url IS NOT NULL AND cutout_url != ''"),
    await q("SELECT image_url AS u FROM drone_registry WHERE image_url IS NOT NULL AND image_url != ''"),
    await q("SELECT cutout_url AS u FROM drone_registry WHERE cutout_url IS NOT NULL AND cutout_url != ''"),
  ];
  const seen = new Set<string>();
  const out: BackupFileEntry[] = [];
  for (const set of sets) {
    for (const r of set) {
      const uri = r.u;
      if (!uri || !uri.startsWith(docDir)) continue; // bara stabila sandbox-filer (ej http/ph:///cache)
      const rel = uri.slice(docDir.length);
      if (seen.has(rel)) continue;
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists) continue;
      seen.add(rel);
      out.push({ rel, size: info.size });
    }
  }
  return out;
}

// Finns en återställbar iCloud-backup? (för restore-prompten vid nyinstallation/enhetsbyte)
export async function hasRestorableBackup(): Promise<BackupManifest | null> {
  try {
    if (!ICloud.isAvailable()) return null;
    const acct = await ICloud.accountStatus().catch(() => ({ available: false, signedIn: false }));
    if (!acct.available) return null;
    return await readRemoteManifest();
  } catch { return null; }
}

// ── Läs fjärr-manifest (för storage-vyn) ─────────────────────────────────────
export async function readRemoteManifest(): Promise<BackupManifest | null> {
  if (!ICloud.isAvailable()) return null;
  const acct = await ICloud.accountStatus().catch(() => ({ available: false, signedIn: false }));
  if (!acct.available) return null;
  const st = await ICloud.stat(REMOTE_MANIFEST).catch(() => ({ exists: false }));
  if (!st.exists) return null;
  await ensureDir(TMP);
  const local = TMP + 'remote-manifest.json';
  await ICloud.download(REMOTE_MANIFEST, local);
  const json = await FileSystem.readAsStringAsync(local).catch(() => '');
  return parseManifest(json);
}

// ── Restore ──────────────────────────────────────────────────────────────────
export async function restoreNow(): Promise<BackupManifest> {
  if (!ICloud.isAvailable()) throw new SyncError('NO_MODULE', 'iCloud is unavailable in this build.');
  requireAccount(await ICloud.accountStatus());

  const manifest = await readRemoteManifest();
  if (!manifest) throw new SyncError('NO_BACKUP', 'No iCloud backup was found.');
  if (manifest.formatVersion > BACKUP_FORMAT_VERSION) {
    throw new SyncError('NEWER_FORMAT', 'This backup was made by a newer version of the app. Please update the app first.');
  }

  const db = await getDatabase();
  await ensureDir(TMP);

  // Skyddsräcke: lokal säkerhetskopia INNAN vi rör någon data.
  await ensureDir(SAFETY);
  await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE);').catch(() => {});
  await db.execAsync(`VACUUM INTO '${osPath(SAFETY + `pre-restore-${Date.now()}.db`)}'`).catch(() => {});

  // Hämta snapshoten lokalt.
  const snapUri = TMP + 'restore-snapshot.db';
  await FileSystem.deleteAsync(snapUri, { idempotent: true });
  await ICloud.download(REMOTE_SNAPSHOT, snapUri);

  // Integritet: verifiera att nedladdad snapshot matchar manifestets hash INNAN vi rör lokal data.
  // Skyddar mot att en ny enhet läser ett nytt manifest + en halv-uppladdad/äldre snapshot.
  if (manifest.snapshot?.sha256) {
    const got = await ICloud.sha256(snapUri).catch(() => '');
    if (got && got !== manifest.snapshot.sha256) {
      throw new SyncError('INTEGRITY', 'The iCloud backup is still finishing uploading or is incomplete. Please try again in a minute.');
    }
  }

  // Bevara enhetslokala settings så en annan enhets backup inte skriver över dem.
  const preserved: Record<string, string | null> = {};
  for (const k of DEVICE_LOCAL_SETTINGS) preserved[k] = await getSetting(k).catch(() => null);

  // Applicera: kopiera användartabeller snapshot → live (gemensamma kolumner) i EN transaktion.
  await db.execAsync('PRAGMA foreign_keys=OFF;').catch(() => {});
  try {
    // Snapshoten är krypterad med den SÄKERHETSKOPIERANDE enhetens nyckel → ATTACH med den iCloud-synkade
    // nyckeln (på samma enhet identisk med den lokala). Validera att den FAKTISKT dekrypterar innan
    // vi raderar något lokalt → annars lämnas den lokala datan orörd.
    const backupKey = await getBackupKey();
    try {
      await db.execAsync(`ATTACH DATABASE '${osPath(snapUri)}' AS bk KEY '${backupKey}';`);
      await db.getFirstAsync('SELECT count(*) AS c FROM bk.sqlite_master');
    } catch {
      throw new SyncError('KEY_MISSING', 'This backup is encrypted with a key that has not reached this device yet. Make sure iCloud Keychain is turned on, then try again in a minute.');
    }
    await db.withTransactionAsync(async () => {
      for (const t of REPLACE_TABLES) await copyTable(db, t, false);
      await copyTable(db, 'icao_airports', true, 'custom = 1'); // custom-flygplatser (rör ej seeden)
    });
  } finally {
    await db.execAsync('DETACH DATABASE bk;').catch(() => {});
    await db.execAsync('PRAGMA foreign_keys=ON;').catch(() => {});
  }

  // Återställ bevarade enhetslokala settings (copyTable('settings') kan ha skrivit över dem).
  for (const k of DEVICE_LOCAL_SETTINGS) {
    if (preserved[k] != null) await setSetting(k, preserved[k]!).catch(() => {});
  }

  // Återställ mediefiler + skriv om absoluta URI:er till DENNA enhets sandbox.
  const docDir = FileSystem.documentDirectory!;
  for (const f of manifest.files) {
    try { await ICloud.download(`${REMOTE_FILES}/${f.rel}`, docDir + f.rel); } catch { /* enstaka fil kan saknas */ }
  }
  if (manifest.sourceDocumentDirectory && manifest.sourceDocumentDirectory !== docDir) {
    await rewriteUriPrefixes(db, manifest.sourceDocumentDirectory, docDir);
  }

  // Översätt sparade iCloud-foton-id:n → DENNA enhets lokala PHAsset-id:n (bibliotekskopplade foton).
  await resolvePhotoLocalIds(db).catch(() => {});

  await seedIcaoAirports().catch(() => {});     // säkerställ seeden om snapshot saknade den
  await setSetting(ENABLED_KEY, '1').catch(() => {}); // håll toggeln på efter restore
  return manifest;
}

// Fyll photo_cloud_id för rader med ett lokalt foto-id men inget cloud-id ännu (backup-sida).
async function populatePhotoCloudIds(db: Awaited<ReturnType<typeof getDatabase>>): Promise<void> {
  for (const table of ['flights', 'drone_flights']) {
    const rows = (await db.getAllAsync<{ id: number; lid: string }>(
      `SELECT id, photo_local_id AS lid FROM ${table}
       WHERE photo_local_id IS NOT NULL AND photo_local_id != ''
         AND (photo_cloud_id IS NULL OR photo_cloud_id = '')`,
    ).catch(() => [])) as { id: number; lid: string }[];
    if (!rows.length) continue;
    const map = await ICloud.photoCloudIds(Array.from(new Set(rows.map((r) => r.lid)))).catch(() => ({} as Record<string, string>));
    for (const r of rows) {
      const cid = map[r.lid];
      if (cid) await db.runAsync(`UPDATE ${table} SET photo_cloud_id = ? WHERE id = ?`, [cid, r.id]).catch(() => {});
    }
  }
}

// Översätt photo_cloud_id → denna enhets photo_local_id efter restore (restore-sida, ny enhet).
async function resolvePhotoLocalIds(db: Awaited<ReturnType<typeof getDatabase>>): Promise<void> {
  for (const table of ['flights', 'drone_flights']) {
    const rows = (await db.getAllAsync<{ id: number; cid: string }>(
      `SELECT id, photo_cloud_id AS cid FROM ${table}
       WHERE photo_cloud_id IS NOT NULL AND photo_cloud_id != ''`,
    ).catch(() => [])) as { id: number; cid: string }[];
    if (!rows.length) continue;
    const map = await ICloud.photoLocalIds(Array.from(new Set(rows.map((r) => r.cid)))).catch(() => ({} as Record<string, string>));
    for (const r of rows) {
      const lid = map[r.cid];
      if (lid) await db.runAsync(`UPDATE ${table} SET photo_local_id = ? WHERE id = ?`, [lid, r.id]).catch(() => {});
    }
  }
}

// Kopiera en tabell snapshot(bk) → live med endast gemensamma kolumner (robust mot schema-drift).
async function copyTable(
  db: Awaited<ReturnType<typeof getDatabase>>, table: string, orIgnore: boolean, where?: string,
): Promise<void> {
  const mainCols = (await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`).catch(() => [])).map(r => r.name);
  const bkCols = (await db.getAllAsync<{ name: string }>(`PRAGMA bk.table_info(${table})`).catch(() => [])).map(r => r.name);
  const common = mainCols.filter(c => bkCols.includes(c));
  if (common.length === 0) return; // tabellen saknas i snapshot → hoppa
  const cols = common.map(c => `"${c}"`).join(', ');
  if (!orIgnore) await db.execAsync(`DELETE FROM "${table}"`);
  const whereClause = where ? ` WHERE ${where}` : '';
  await db.execAsync(`INSERT ${orIgnore ? 'OR IGNORE ' : ''}INTO "${table}" (${cols}) SELECT ${cols} FROM bk."${table}"${whereClause}`);
}

async function rewriteUriPrefixes(
  db: Awaited<ReturnType<typeof getDatabase>>, oldDir: string, newDir: string,
): Promise<void> {
  for (const [t, c] of URI_COLUMNS) {
    await db.runAsync(
      `UPDATE "${t}" SET "${c}" = ? || SUBSTR("${c}", ?) WHERE "${c}" LIKE ?`,
      [newDir, oldDir.length + 1, oldDir + '%'],
    ).catch(() => {});
  }
}

// ── Radera molnbackupen ──────────────────────────────────────────────────────
export async function deleteBackup(): Promise<void> {
  if (!ICloud.isAvailable()) return;
  await ICloud.remove(REMOTE_DIR).catch(() => {});
}
