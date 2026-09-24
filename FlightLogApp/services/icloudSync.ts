// iCloud-synk (Fas 1): säkerhetskopiera hela SQLite-databasen + refererade mediefiler till användarens
// iCloud, och återställ på en annan enhet. Skyddsräcken: VACUUM INTO-snapshot (aldrig råkopiera WAL),
// lokal säkerhetskopia FÖRE restore, gemensamma-kolumner-kopiering (robust mot schema-drift),
// URI-omskrivning till den nya enhetens sandbox, och validering av manifest-format. Kräver
// native-modulen (dev/EAS-build) — allt gate:as på isAvailable()/accountStatus().
import * as FileSystem from 'expo-file-system/legacy';
import { getDatabase } from '../db/database';
import { getSetting, setSetting } from '../db/flights';
import { seedIcaoAirports } from '../db/icao';
import { getDbKey } from './dbKey';
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

export type SyncErrorCode = 'NO_MODULE' | 'NO_ICLOUD' | 'NOT_SIGNED_IN' | 'NEWER_FORMAT' | 'NO_BACKUP' | 'FAILED';
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

  // 1) Konsistent DB-snapshot (VACUUM INTO ger en ren enfilskopia trots WAL-läge).
  const snapUri = TMP + 'snapshot.db';
  await FileSystem.deleteAsync(snapUri, { idempotent: true });
  await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE);').catch(() => {});
  await db.execAsync(`VACUUM INTO '${osPath(snapUri)}'`);
  const snapInfo = await FileSystem.getInfoAsync(snapUri);
  const snapshotSize = snapInfo.exists ? snapInfo.size : 0;

  // 2) Samla lokala mediefiler som DB:n refererar (bara under documentDirectory → stabila).
  const docDir = FileSystem.documentDirectory!;
  const files = await collectReferencedFiles(db, docDir);

  // 3) Ladda upp snapshot → filer → manifest (manifest sist = "commit-punkt" för vyn).
  await ICloud.upload(snapUri, REMOTE_SNAPSHOT);
  const uploaded: BackupFileEntry[] = [];
  for (const f of files) {
    try { await ICloud.upload(docDir + f.rel, `${REMOTE_FILES}/${f.rel}`); uploaded.push(f); }
    catch { /* hoppa över en fil som ej går att ladda upp; övriga fortsätter */ }
  }

  const device = await ICloud.deviceName().catch(() => 'iPhone');
  const counts = await collectCounts();
  const manifest = buildManifest({ counts, snapshotSize, files: uploaded, device, sourceDocumentDirectory: docDir });

  const manifestUri = TMP + 'manifest.json';
  await FileSystem.writeAsStringAsync(manifestUri, JSON.stringify(manifest));
  await ICloud.upload(manifestUri, REMOTE_MANIFEST);

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

  // Applicera: kopiera användartabeller snapshot → live (gemensamma kolumner) i EN transaktion.
  await db.execAsync('PRAGMA foreign_keys=OFF;').catch(() => {});
  try {
    // Snapshoten är SQLCipher-krypterad (VACUUM INTO ärver DB:ns nyckel) → ATTACH måste ange nyckeln.
    const dbKey = await getDbKey();
    await db.execAsync(`ATTACH DATABASE '${osPath(snapUri)}' AS bk KEY '${dbKey}';`);
    await db.withTransactionAsync(async () => {
      for (const t of REPLACE_TABLES) await copyTable(db, t, false);
      await copyTable(db, 'icao_airports', true, 'custom = 1'); // custom-flygplatser (rör ej seeden)
    });
  } finally {
    await db.execAsync('DETACH DATABASE bk;').catch(() => {});
    await db.execAsync('PRAGMA foreign_keys=ON;').catch(() => {});
  }

  // Återställ mediefiler + skriv om absoluta URI:er till DENNA enhets sandbox.
  const docDir = FileSystem.documentDirectory!;
  for (const f of manifest.files) {
    try { await ICloud.download(`${REMOTE_FILES}/${f.rel}`, docDir + f.rel); } catch { /* enstaka fil kan saknas */ }
  }
  if (manifest.sourceDocumentDirectory && manifest.sourceDocumentDirectory !== docDir) {
    await rewriteUriPrefixes(db, manifest.sourceDocumentDirectory, docDir);
  }

  await seedIcaoAirports().catch(() => {});     // säkerställ seeden om snapshot saknade den
  await setSetting(ENABLED_KEY, '1').catch(() => {}); // håll toggeln på efter restore
  return manifest;
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
