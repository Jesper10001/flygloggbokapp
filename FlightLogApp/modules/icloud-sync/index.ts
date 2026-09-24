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
