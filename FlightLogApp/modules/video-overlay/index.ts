import { requireNativeModule } from 'expo';

// Bränner in en transparent overlay-PNG (samma aspekt som videon) på en video och exporterar en ny
// MP4 (AVFoundation Core Animation). iOS-only; native-modulen finns bara i dev/EAS-byggen (ej Expo Go).
let _native: any = null;
function native(): any {
  if (_native) return _native;
  _native = requireNativeModule('VideoOverlay');
  return _native;
}

/** True om native-modulen finns i det aktuella bygget (annars → dölj video-med-filter). */
export function isAvailable(): boolean {
  try { native(); return true; } catch { return false; }
}

/** Videons VISADE (orienterade) pixelstorlek → så JS kan rendera overlayn i samma aspekt. */
export function videoSize(videoUri: string): Promise<{ width: number; height: number }> {
  return native().videoSize(videoUri);
}

/** Lägg overlay-PNG:en ovanpå videon och exportera till outputPath (file://-URI eller absolut väg).
 *  overlayUri måste vara en transparent PNG i SAMMA aspekt som videoSize(). Returnerar output-URI. */
export function burnOverlay(videoUri: string, overlayUri: string, outputPath: string): Promise<string> {
  return native().burnOverlay(videoUri, overlayUri, outputPath);
}
