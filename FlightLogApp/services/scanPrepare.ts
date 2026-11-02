// Förberedelsen av ett foto av ett loggboksuppslag, på enheten: Apple Vision letar upp boken, bilden vrids
// rättvänd, rätas upp och beskärs till boken. Används av granskningen (scan-review) och av "Scan your whole
// logbook" (scan-book), som förbereder alla foton direkt när de lagts till.
//
// Allt går via filer — ingen base64 i minnet. Vision läser filen direkt, och bara den färdiga bilden finns
// kvar efteråt (mellanstegen raderas).

import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { isAvailable as visionAvailable, recognize } from '../modules/apple-vision-ocr';
import { logbookBounds, wordsInCrop, textScore, orientationScore, bookAspect, estimateSkew, type VisionBox } from './scanAlign';

export const READ_WIDTH = 2000;   // bredden Claude läser (samma som kamerans och startsidans)
export const SOURCE_EDGE = 3000;  // bibliotekets foton: längsta sidan innan boken beskärs (sedan ≤ READ_WIDTH)

const JPEG = ImageManipulator.SaveFormat.JPEG;

export interface PrepInput {
  uri: string;          // file://
  width: number;
  height: number;
  cropped?: boolean;    // redan beskuren till boken (kameran/dokumentskannern)
  oriented?: boolean;   // rättvänd (Blades kamera vet hur telefonen hölls)
}

export interface Prepared {
  uri: string;          // den färdiga bilden (≤ READ_WIDTH bred); kan vara indatafilen om inget behövde göras
  width: number;
  height: number;
  words: VisionBox[];   // Visions ord i den färdiga bildens koordinater (0–1)
  found: boolean;       // boken hittades och bilden beskars (eller var redan beskuren)
}

const words = (uri: string): Promise<VisionBox[]> => recognize(uri).catch(() => [] as VisionBox[]);

/**
 * Letar upp boken i fotot och beskär till den. Bilden prövas också vriden 90°/270° (eller 180°), och den
 * vridning där orden ligger som i en loggbok vinner. Null om Vision inte finns i bygget eller något gick fel.
 * Filer som skapas på vägen läggs i `temp` (anroparen raderar dem som inte blev resultatet).
 */
async function findLogbook(page: PrepInput, temp: string[]): Promise<Prepared | null> {
  if (!visionAvailable()) return null;
  type Cand = { deg: number; uri: string; width: number; height: number; words: VisionBox[] };
  const make = async (uri: string, actions: ImageManipulator.Action[], compress: number) => {
    const r = await ImageManipulator.manipulateAsync(uri, actions, { compress, format: JPEG });
    temp.push(r.uri);
    return r;
  };
  try {
    const cands: Cand[] = [];
    const tryRotation = async (deg: number) => {
      if (deg === 0) {
        cands.push({ deg, uri: page.uri, width: page.width, height: page.height, words: await words(page.uri) });
        return;
      }
      const r = await make(page.uri, [{ rotate: deg }], 0.9);
      cands.push({ deg, uri: r.uri, width: r.width, height: r.height, words: await words(r.uri) });
    };
    await tryRotation(0);
    // Ett uppslag är liggande. Står boken på högkant (t.ex. iPhones dokumentskanner, som lämnar bilden
    // stående) prövas 90° och 270°; ligger den men ser upp och ner ut prövas 180°. Vilken som vinner avgörs av
    // orientationScore (ord på rad, rubriker ovanför summorna) — inte av textmängden, som Vision läser lika
    // bra på högkant. Blades kamera och "Frame the logbook" vet redan hur boken ligger (oriented).
    const landscape = (c: Cand) => bookAspect(c.words, c.width, c.height) >= 1;
    const score = (c: Cand) => orientationScore(c.words, c.width, c.height) + (landscape(c) ? 3 : 0) + textScore(c.words) / 1e5;
    if (!page.oriented) {
      const c0 = cands[0];
      if (!landscape(c0)) { await tryRotation(90); await tryRotation(270); }
      else if (orientationScore(c0.words, c0.width, c0.height) < 0) await tryRotation(180);
    }
    let best = cands.reduce((a, b) => (score(b) > score(a) ? b : a));
    console.log(`[SCAN] Vridning: ${cands.map((c) => `${c.deg}°=${score(c).toFixed(1)}`).join(' ')} → ${best.deg}°`);

    // Ett foto är sällan helt rakt: lutar raderna (redan 2° gör att en rad glider mer än en rad över
    // uppslaget) vrids bilden rak innan Claude läser, och Vision läser om den raka bilden.
    const skew = estimateSkew(best.words, best.width, best.height);
    if (Math.abs(skew) >= 0.6 && Math.abs(skew) <= 6) {
      const rot = await make(best.uri, [{ rotate: -skew }], 0.9);
      const w = await words(rot.uri);
      // Mät igen: bara om bilden blev klart rakare (och Vision läser lika mycket) används den vridna.
      const after = w.length ? estimateSkew(w, rot.width, rot.height) : skew;
      const better = w.length >= best.words.length * 0.7 && Math.abs(after) <= Math.abs(skew) * 0.5;
      if (better) best = { ...best, uri: rot.uri, width: rot.width, height: rot.height, words: w };
      console.log(`[SCAN] Lutning ${skew}° → ${better ? `rätad (kvar ${after}°)` : `inte rätad (efter vridning ${after}°)`}`);
    } else if (skew !== 0) {
      console.log(`[SCAN] Lutning ${skew}° → för liten eller osäker, rätas inte`);
    }

    let b = page.cropped ? null : logbookBounds(best.words);
    if (b && (b.w < 0.3 || b.h < 0.12)) b = null;                 // orimligt smal → behåll hela bilden
    // Foton från biblioteket kommer större än READ_WIDTH (så att den beskurna boken blir skarp); det Claude
    // läser krymps till READ_WIDTH. Visions ord är normaliserade (0–1) och påverkas inte.
    if (!b || (b.w > 0.92 && b.h > 0.92)) {
      const found = !!page.cropped || !!b;
      if (best.width <= READ_WIDTH) return { uri: best.uri, width: best.width, height: best.height, words: best.words, found };
      const small = await make(best.uri, [{ resize: { width: READ_WIDTH } }], 0.88);
      return { uri: small.uri, width: small.width, height: small.height, words: best.words, found };
    }
    const crop = {
      originX: Math.round(b.x * best.width), originY: Math.round(b.y * best.height),
      width: Math.round(b.w * best.width), height: Math.round(b.h * best.height),
    };
    const shrink = crop.width > READ_WIDTH ? [{ resize: { width: READ_WIDTH } }] : [];
    const out = await make(best.uri, [{ crop }, ...shrink], 0.88);
    return { uri: out.uri, width: out.width, height: out.height, words: wordsInCrop(best.words, b), found: true };
  } catch {
    return null;
  }
}

/**
 * Förbereder ett foto för läsning: skalar ner stora foton (≤ SOURCE_EDGE), hittar boken (findLogbook) och ser
 * till att bilden Claude läser är högst READ_WIDTH bred. Utan Vision (eller om det misslyckas) blir det hela
 * fotot, nedskalat. Indatafilen rörs aldrig.
 */
export async function prepareSpread(src: PrepInput): Promise<Prepared> {
  const temp: string[] = [];
  let result: Prepared | null = null;
  try {
    let input = src;
    const long = Math.max(src.width, src.height);
    if (long > SOURCE_EDGE) {
      const r = await ImageManipulator.manipulateAsync(src.uri,
        [{ resize: src.width >= src.height ? { width: SOURCE_EDGE } : { height: SOURCE_EDGE } }], { compress: 0.88, format: JPEG });
      temp.push(r.uri);
      input = { ...src, uri: r.uri, width: r.width, height: r.height };
    }
    result = await findLogbook(input, temp);
    if (!result) {
      // Hittades inte (Vision saknas eller misslyckades): läs hela fotot, men aldrig större än READ_WIDTH.
      if (input.width > READ_WIDTH) {
        const small = await ImageManipulator.manipulateAsync(input.uri, [{ resize: { width: READ_WIDTH } }], { compress: 0.88, format: JPEG });
        temp.push(small.uri);
        result = { uri: small.uri, width: small.width, height: small.height, words: [], found: false };
      } else {
        result = { uri: input.uri, width: input.width, height: input.height, words: [], found: !!src.cropped };
      }
    }
    // Claude får alltid en JPEG: ett foto som inte behövde bearbetas kan vara HEIC eller PNG.
    if (!/\.jpe?g(\?|$)/i.test(result.uri)) {
      const jpg = await ImageManipulator.manipulateAsync(result.uri, [], { compress: 0.88, format: JPEG });
      temp.push(jpg.uri);
      result = { ...result, uri: jpg.uri, width: jpg.width, height: jpg.height };
    }
    return result;
  } finally {
    for (const f of temp) if (f !== result?.uri) FileSystem.deleteAsync(f, { idempotent: true }).catch(() => {});
  }
}

/** Bildtypen efter filändelsen (förberedda bilder är alltid JPEG). */
export const mediaTypeOf = (uri: string): 'image/jpeg' | 'image/png' => (/\.png(\?|$)/i.test(uri) ? 'image/png' : 'image/jpeg');
