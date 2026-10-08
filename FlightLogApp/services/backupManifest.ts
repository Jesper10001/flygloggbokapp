// Backup-manifest: en JSON-fil som ligger bredvid DB-snapshoten i iCloud och beskriver EXAKT vad som
// är säkerhetskopierat (antal per kategori, filstorlekar, tidpunkt, enhet). Storage-vyn läser den →
// visar sanning, inte gissningar. Restore validerar formatVersion + använder sourceDocumentDirectory
// för att skriva om absoluta fil-URI:er till den nya enhetens sandbox.
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { getDatabase } from '../db/database';

// Höj vid inkompatibel ändring av backup-formatet (restore vägrar nyare format än appen förstår).
export const BACKUP_FORMAT_VERSION = 1;

export interface BackupFileEntry { rel: string; size: number }
export interface BackupManifest {
  formatVersion: number;
  appVersion: string;
  createdAt: string;                 // ISO-8601
  device: string;                    // "iPhone" / "iPad" / enhetsnamn
  platform: string;                  // 'ios'
  sourceDocumentDirectory: string;   // för URI-omskrivning vid restore till annan enhet
  counts: Record<string, number>;    // per kategori (för storage-vyn)
  snapshot: BackupFileEntry & { sha256?: string }; // DB-snapshot (rel = 'snapshot.db') + integritets-hash
  files: BackupFileEntry[];          // bifogade mediefiler (foton/cutouts) relativt documentDirectory
  totalBytes: number;
}

// Radantal per användarkategori (icao_airports räknas BARA custom=1 — seeden backas ej upp).
export async function collectCounts(): Promise<Record<string, number>> {
  const db = await getDatabase();
  const one = async (sql: string): Promise<number> => {
    const r = await db.getFirstAsync<{ c: number }>(sql).catch(() => null);
    return r?.c ?? 0;
  };
  const [flights, droneFlights, aircraft, drones, books, templates, favorites, customAirports] = await Promise.all([
    one('SELECT COUNT(*) c FROM flights'),
    one('SELECT COUNT(*) c FROM drone_flights'),
    one('SELECT COUNT(*) c FROM aircraft_registry'),
    one('SELECT COUNT(*) c FROM drone_registry'),
    one('SELECT COUNT(*) c FROM logbook_books'),
    one('SELECT COUNT(*) c FROM custom_templates'),
    one('SELECT COUNT(*) c FROM favorite_airports'),
    one('SELECT COUNT(*) c FROM icao_airports WHERE custom = 1'),
  ]);
  return { flights, droneFlights, aircraft, drones, books, templates, favorites, customAirports };
}

export function buildManifest(args: {
  counts: Record<string, number>;
  snapshotSize: number;
  snapshotSha?: string;
  files: BackupFileEntry[];
  device: string;
  sourceDocumentDirectory: string;
}): BackupManifest {
  const filesBytes = args.files.reduce((s, f) => s + (f.size || 0), 0);
  return {
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion: Application.nativeApplicationVersion ?? '0.0.0',
    createdAt: new Date().toISOString(),
    device: args.device || Platform.OS,
    platform: Platform.OS,
    sourceDocumentDirectory: args.sourceDocumentDirectory,
    counts: args.counts,
    snapshot: { rel: 'snapshot.db', size: args.snapshotSize, sha256: args.snapshotSha },
    files: args.files,
    totalBytes: args.snapshotSize + filesBytes,
  };
}

// Robust parse (returnerar null vid trasig/ogiltig JSON i stället för att kasta).
export function parseManifest(json: string): BackupManifest | null {
  try {
    const m = JSON.parse(json);
    if (!m || typeof m.formatVersion !== 'number' || !m.snapshot) return null;
    return m as BackupManifest;
  } catch {
    return null;
  }
}
