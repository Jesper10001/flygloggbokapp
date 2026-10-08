import { requireNativeModule } from 'expo';

// JS-yta mot iCloud Documents-containern (se ios/ICloudSyncModule.swift). Native-modulen finns bara i
// dev/EAS-byggen (ej Expo Go) → isAvailable() gate:ar anropen. Alla sökvägar är RELATIVA under
// containerns Documents-mapp (t.ex. "backups/current/snapshot.db").
let _native: any = null;
function native(): any {
  if (_native) return _native;
  _native = requireNativeModule('ICloudSync');
  return _native;
}

export type ICloudFileStat = { exists: boolean; size?: number; mtime?: number; downloaded?: boolean };
export type ICloudAccount = { available: boolean; signedIn: boolean };

/** True om native-modulen finns i bygget (annars: dölj iCloud-UI). */
export function isAvailable(): boolean {
  try { native(); return true; } catch { return false; }
}

/** Är användaren inloggad i iCloud och containern nåbar? */
export function accountStatus(): Promise<ICloudAccount> {
  return native().accountStatus();
}

/** Enhetsnamn (för "senast säkerhetskopierad från …"). */
export function deviceName(): Promise<string> {
  return native().deviceName();
}

/** Absolut sökväg till containerns Documents-mapp (debug). */
export function containerURL(): Promise<string> {
  return native().containerURL();
}

/** Kopiera en lokal fil → containern (relativePath). iCloud laddar upp automatiskt. */
export function upload(localPath: string, relativePath: string): Promise<string> {
  return native().upload(localPath, relativePath);
}

/** Ladda ned (om placeholder) och kopiera containern-filen → localPath. */
export function download(relativePath: string, localPath: string): Promise<string> {
  return native().download(relativePath, localPath);
}

/** Metadata om en fil i containern. */
export function stat(relativePath: string): Promise<ICloudFileStat> {
  return native().stat(relativePath);
}

/** Filnamn i en mapp i containern (normaliserade, utan ".icloud"-placeholders). */
export function list(relativeDir: string): Promise<string[]> {
  return native().list(relativeDir);
}

/** Radera en fil/mapp i containern. */
export function remove(relativePath: string): Promise<boolean> {
  return native().remove(relativePath);
}

/** Lagra SQLCipher-nyckeln i iCloud Keychain (synchronizable) → följer med till ny enhet. */
export function setDbKey(key: string): Promise<boolean> {
  return native().setDbKey(key);
}

/** Hämta den iCloud-synkade DB-nyckeln (null om den inte finns/synkats hit än). */
export function getDbKey(): Promise<string | null> {
  return native().getDbKey();
}

/** Blockera tills filen FAKTISKT laddats upp till iCloud (eller timeout). Returnerar om den är uppe. */
export function confirmUploaded(relativePath: string, timeoutMs: number): Promise<boolean> {
  return native().confirmUploaded(relativePath, timeoutMs);
}

/** SHA-256 (hex) av en lokal fil — för manifest↔snapshot-integritet. */
export function sha256(localPath: string): Promise<string> {
  return native().sha256(localPath);
}

/** Översätt lokala PHAsset-id:n → stabila iCloud-foton-id:n (tomt om iCloud-foton av/behörighet saknas). */
export function photoCloudIds(localIds: string[]): Promise<Record<string, string>> {
  return native().photoCloudIds(localIds);
}

/** Översätt iCloud-foton-id:n → denna enhets lokala PHAsset-id:n (vid restore på ny enhet). */
export function photoLocalIds(cloudIds: string[]): Promise<Record<string, string>> {
  return native().photoLocalIds(cloudIds);
}
