// Förslag på inramning av ett foto ur kamerarullen: åt vilket håll boken ska vridas och var den sitter.
// Apple Vision (på telefonen) läser texten i alla fyra vridningarna. Den som vinner är den där boken ligger
// (ett uppslag är liggande), orden står på rad och rubrikerna står ovanför summorna (orientationScore) —
// textmängden duger inte, eftersom Vision läser text på högkant nästan lika bra. Loggbokens område tas från
// var texten finns. Användaren justerar sedan själv i scan-crop.

import * as ImageManipulator from 'expo-image-manipulator';
import { isAvailable as visionAvailable, recognize } from '../modules/apple-vision-ocr';
import { logbookBounds, textScore, orientationScore, bookAspect, type VisionBox } from './scanAlign';
import type { Rect } from './scanGeometry';

export type Rotation = 0 | 90 | 180 | 270;

export async function suggestFraming(uri: string): Promise<{ rotation: Rotation; rect: Rect | null } | null> {
  if (!visionAvailable()) return null;
  try {
    // En mindre kopia räcker för att hitta texten och går snabbare.
    const small = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1600 } }], { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG });
    const cands: { deg: Rotation; words: VisionBox[]; w: number; h: number }[] = [];
    const read = async (deg: Rotation) => {
      const img = deg === 0 ? small : await ImageManipulator.manipulateAsync(small.uri, [{ rotate: deg }], { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG });
      cands.push({ deg, words: await recognize(img.uri).catch(() => []), w: img.width, h: img.height });
    };
    await read(0);
    await read(90);
    await read(180);
    await read(270);
    const score = (c: typeof cands[number]) => orientationScore(c.words, c.w, c.h) + (bookAspect(c.words, c.w, c.h) >= 1 ? 3 : 0) + textScore(c.words) / 1e5;
    const best = cands.reduce((a, b) => (score(b) > score(a) ? b : a));
    let rect = logbookBounds(best.words);
    if (rect && (rect.w < 0.3 || rect.h < 0.12)) rect = null;
    return { rotation: best.deg, rect };
  } catch {
    return null;
  }
}
