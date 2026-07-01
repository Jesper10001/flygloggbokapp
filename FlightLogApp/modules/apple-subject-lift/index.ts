import { requireNativeModule } from 'expo';
import { Platform } from 'react-native';

// On-device subject lift (VisionKit foreground instance mask) — iOS 17+ only.
// Klipper ut motivet (luftfartyget) ur bakgrunden till en transparent PNG, samma
// motor som Foton "Lyft motiv". Finns bara i dev/EAS-byggen (ej Expo Go).

let _native: any = null;
function native(): any {
  if (_native) return _native;
  _native = requireNativeModule('AppleSubjectLift');
  return _native;
}

/** True om native-modulen finns OCH enheten är iOS 17+. Annars → plan banner-fallback. */
export function isAvailable(): boolean {
  if (Platform.OS !== 'ios') return false;
  const major = parseInt(String(Platform.Version), 10);
  if (Number.isFinite(major) && major < 17) return false;
  try { native(); return true; } catch { return false; }
}

/**
 * Klipper ut motivet från `inputUri` och skriver en transparent PNG till `outputPath`.
 * @param inputUri  file://-URI/-sökväg eller rå base64.
 * @param outputPath  målfil (file://-URI eller absolut sökväg) för PNG:en.
 * @returns file://-URI till den skapade urklippsbilden.
 */
export function liftSubject(inputUri: string, outputPath: string): Promise<string> {
  return native().liftSubject(inputUri, outputPath);
}
