// Den andra titten (steg 4 i scanLandings.ts): de landningsceller där Claude och Apple Vision läser olika, och
// där varken sidans summor, nattiden eller läget avgör, skickas som små utsnitt till Claude i ett enda anrop.
// Ett utsnitt av kolumnrubrikerna (Day / Night) och ett per rad. Claude får inte veta vad som lästs tidigare, så
// att svaret blir en oberoende tredje läsning. Kostar några coins per uppslag; misslyckas anropet frågas
// användaren som förut.
import * as ImageManipulator from 'expo-image-manipulator';
import { callAnthropicJson } from './anthropicClient';
import { columnFor, rowBand, type PageGrid } from './scanGeometry';
import { OCR_MODEL } from './ocr';

export interface SecondLookAnswer { day: number | null; night: number | null; sure: boolean }

const MAX_ROWS = 12;          // fler omtvistade rader än så på ett uppslag → rutnätet ligger fel, fråga i stället
const MIN_WIDTH = 360;        // utsnitten förstoras till minst så här bred (px) så att handskriften syns

const SYSTEM = 'You read single cells of a handwritten pilot logbook. Reply with JSON only.';

/** Läser landningarna (dag och natt) på de givna raderna. Null när något går fel. */
export async function secondLookLandings(
  image: { uri: string },
  grid: PageGrid,
  rowIndexes: number[],
): Promise<Map<number, SecondLookAnswer> | null> {
  const day = columnFor(grid, 'landings_day'), night = columnFor(grid, 'landings_night');
  if (!day || !night || rowIndexes.length === 0 || rowIndexes.length > MAX_ROWS) return null;
  try {
    const probe = await ImageManipulator.manipulateAsync(image.uri, []);
    const W = probe.width, H = probe.height;
    const left = Math.min(day.left, night.left), right = Math.max(day.right, night.right);
    const pad = (right - left) * 0.35;
    const x0 = Math.max(0, left - pad), x1 = Math.min(1, right + pad);
    const cx = (left + right) / 2;
    const crop = async (y0: number, y1: number) => {
      const top = Math.max(0, y0), bottom = Math.min(1, y1);
      const rect = {
        originX: Math.round(x0 * W), originY: Math.round(top * H),
        width: Math.max(8, Math.round((x1 - x0) * W)), height: Math.max(8, Math.round((bottom - top) * H)),
      };
      const actions: ImageManipulator.Action[] = [{ crop: rect }];
      if (rect.width < MIN_WIDTH) actions.push({ resize: { width: MIN_WIDTH } });
      const out = await ImageManipulator.manipulateAsync(image.uri, actions, { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      return out.base64 ?? '';
    };
    const header = await crop(grid.tableTop - 0.1, grid.tableTop + 0.005);
    const ids = rowIndexes.map((_, k) => String.fromCharCode(65 + k));   // A, B, C …
    const rowsB64 = await Promise.all(rowIndexes.map((ri) => {
      const b = rowBand(grid, ri, cx);
      return crop(b.y - b.h * 0.35, b.y + b.h * 1.35);
    }));
    if (!header || rowsB64.some((b) => !b)) return null;

    const img = (data: string) => ({ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/jpeg', data } });
    const content = [
      { type: 'text' as const, text: 'Column headings above the landings columns (Day and Night):' },
      img(header),
      ...rowsB64.flatMap((b, k) => [{ type: 'text' as const, text: `Row ${ids[k]} (read the row in the middle of the image):` }, img(b)]),
      {
        type: 'text' as const,
        text: 'For each row, give the number of landings written under Day and under Night. Use null for an empty cell. '
          + 'Set "sure": false if you cannot tell which number it is or which column it stands in. '
          + `Reply exactly as {"rows":[{"id":"A","day":2,"night":null,"sure":true}]} with one entry for each of ${ids.join(', ')}.`,
      },
    ];
    const res = await callAnthropicJson<{ rows?: { id?: string; day?: unknown; night?: unknown; sure?: unknown }[] }>({
      model: OCR_MODEL, system: SYSTEM, userContent: content, maxTokens: 400, timeoutMs: 20000, consentPrompt: false,
    });
    const asNum = (v: unknown) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Math.round(Number(v)) : null);
    const out = new Map<number, SecondLookAnswer>();
    for (const r of res?.rows ?? []) {
      const k = ids.indexOf(String(r.id ?? '').toUpperCase());
      if (k < 0) continue;
      out.set(rowIndexes[k], { day: asNum(r.day), night: asNum(r.night), sure: r.sure === true });
    }
    return out;
  } catch (e: any) {
    console.log('[SCAN] Andra titten på landningarna misslyckades:', e?.message);
    return null;
  }
}
