// Fleet-kortets "pop-out": tar en bild-URL (Wikipedia eller lokalt foto) och
// producerar dels ett lokalt original, dels ett VisionKit-urklipp (transparent
// bakgrund) för 3D-effekten. Allt cachas persistent (documentDirectory) och
// nycklas deterministiskt på bild-URL:en → körs bara en gång per bild.
//
// Fallback: < iOS 17 / Android / inget motiv hittas → cutout = null (plan banner).
import * as FileSystem from 'expo-file-system/legacy';
import { isAvailable as subjectLiftAvailable, liftSubject } from '../modules/apple-subject-lift';

const DIR = FileSystem.documentDirectory + 'fleet-cutouts/';

// Liten, beroendefri sträng-hash → stabilt filnamn per bild-URL.
function hashKey(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return Math.abs(h).toString(36);
}

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(DIR);
  if (!info.exists) await FileSystem.makeDirectoryAsync(DIR, { intermediates: true });
}

export interface AircraftCutoutResult {
  original: string;        // lokal/remote URI för banner-lagret (Layer A)
  cutout: string | null;   // lokal URI för urklippslagret (Layer B), null = ingen pop-out
}

/**
 * Säkerställer banner + urklipp för en bild-URL. Idempotent och billig vid cache-träff
 * (bara filkontroller). Returnerar original-URI + cutout-URI (eller null).
 */
export async function ensureAircraftCutout(imageUrl: string): Promise<AircraftCutoutResult> {
  if (!imageUrl) return { original: '', cutout: null };
  try {
    await ensureDir();
    const h = hashKey(imageUrl);
    const ext = imageUrl.toLowerCase().includes('.png') ? 'png' : 'jpg';
    const originalPath = `${DIR}orig-${h}.${ext}`;
    const cutoutPath = `${DIR}cut-${h}.png`;

    // 1. Original: ladda ner om remote, annars använd lokal fil direkt.
    let original = imageUrl;
    if (/^https?:/i.test(imageUrl)) {
      const oi = await FileSystem.getInfoAsync(originalPath);
      if (!oi.exists) {
        try { await FileSystem.downloadAsync(imageUrl, originalPath); }
        catch { return { original: imageUrl, cutout: null }; } // visa remote banner ändå
      }
      original = originalPath;
    }

    // 2. Urklipp: cache-träff?
    const ci = await FileSystem.getInfoAsync(cutoutPath);
    if (ci.exists) return { original, cutout: cutoutPath };

    // 3. Generera (iOS 17+). Annars plan banner.
    if (!subjectLiftAvailable()) return { original, cutout: null };
    try {
      const out = await liftSubject(original, cutoutPath);
      return { original, cutout: out || cutoutPath };
    } catch {
      return { original, cutout: null }; // inget motiv / fel → plan banner
    }
  } catch {
    return { original: imageUrl, cutout: null };
  }
}
