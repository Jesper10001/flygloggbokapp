import { requireNativeModule } from 'expo';

// On-device OCR via Apple Vision-ramverket (samma motor som iOS "Live Text").
// Körs lokalt på telefonen — inget skickas någonstans. iOS-only.

export type VisionWord = {
  text: string;
  confidence: number; // 0..1 (Apple Vision per-rad-confidence)
  x: number;          // normaliserat 0..1, top-left origin
  y: number;
  w: number;
  h: number;
};

// Laddas lazy: native-modulen finns bara i dev/EAS-byggen (ej Expo Go).
let _native: any = null;
function native(): any {
  if (_native) return _native;
  _native = requireNativeModule('AppleVisionOcr');
  return _native;
}

/** True om native-modulen finns i det aktuella bygget. */
export function isAvailable(): boolean {
  try { native(); return true; } catch { return false; }
}

/**
 * Känner igen text i en bild med Apple Vision.
 * @param input  file://-URI ELLER rå base64-sträng.
 * @param languages  igenkänningsspråk i prioritetsordning.
 * @returns rader med text + box (normaliserat, top-left) + confidence.
 */
export function recognize(
  input: string,
  languages: string[] = ['sv-SE', 'en-US'],
): Promise<VisionWord[]> {
  return native().recognize(input, languages);
}
