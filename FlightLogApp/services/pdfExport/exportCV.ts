// Pilot CV → PDF. CV-sidan skrivs ut stående (A4) och de valda loggboksuppslagen liggande, i var sin PDF, eftersom
// en utskrift bara kan ha en sidstorlek; sedan sätts de ihop till en fil (pdf-lib). Går sammanfogningen inte delas
// CV:t ensamt och anroparen får veta det.

import * as Print from 'expo-print';
import * as FileSystem from 'expo-file-system/legacy';
import { PDFDocument } from 'pdf-lib';
import { shareFileAsync } from '../shareFile';
import { useTimeFormatStore } from '../../store/timeFormatStore';
import { buildSpreadsPdf } from '../logbook/exportPages';
import { loadCvData, type CvData } from './cvData';
import { renderCV } from './cvTemplate';
import type { CvConfig } from './cvConfig';

export type Spreads = NonNullable<Awaited<ReturnType<typeof buildSpreadsPdf>>>;

/** Uppslagen som ska bifogas, eller null (inga valda, ingen bok, tom bok). */
export async function loadCvSpreads(cfg: CvConfig): Promise<Spreads | null> {
  if (cfg.spreads <= 0) return null;
  try { return await buildSpreadsPdf(cfg.spreads, cfg.bookId ?? undefined); } catch { return null; }
}

export function cvHtml(cfg: CvConfig, data: CvData, spreads: Spreads | null, preview: boolean): string {
  return renderCV(cfg, data, {
    timeFormat: useTimeFormatStore.getState().timeFormat,
    attached: spreads ? { from: spreads.pageFrom, to: spreads.pageTo } : null,
    preview,
  });
}

/** Skapar PDF:en och öppnar delningsrutan. attached = antal bifogade uppslag; merged=false om de inte gick att sätta ihop. */
export async function exportCvPdf(cfg: CvConfig): Promise<{ attached: number; merged: boolean }> {
  const [data, spreads] = await Promise.all([loadCvData(), loadCvSpreads(cfg)]);
  const cv = await Print.printToFileAsync({ html: cvHtml(cfg, data, spreads, false), width: 595, height: 842, base64: false });
  let out = cv.uri;
  let merged = true;
  if (spreads) {
    try {
      const pages = await Print.printToFileAsync({ html: spreads.html, width: spreads.width, height: spreads.height, base64: false });
      const [a, b] = await Promise.all([
        FileSystem.readAsStringAsync(cv.uri, { encoding: FileSystem.EncodingType.Base64 }),
        FileSystem.readAsStringAsync(pages.uri, { encoding: FileSystem.EncodingType.Base64 }),
      ]);
      const doc = await PDFDocument.load(a);
      const extra = await PDFDocument.load(b);
      (await doc.copyPages(extra, extra.getPageIndices())).forEach((p) => doc.addPage(p));
      const joined = FileSystem.cacheDirectory + 'cv-joined.pdf';
      await FileSystem.writeAsStringAsync(joined, await doc.saveAsBase64(), { encoding: FileSystem.EncodingType.Base64 });
      out = joined;
    } catch { merged = false; }
  }
  const who = `${cfg.details.firstName} ${cfg.details.lastName}`.trim().replace(/[^\p{L}\p{N} .'-]/gu, '').trim();
  const dest = FileSystem.documentDirectory + `Pilot CV${who ? ` ${who}` : ''}.pdf`;
  await FileSystem.deleteAsync(dest, { idempotent: true });
  await FileSystem.copyAsync({ from: out, to: dest });
  await shareFileAsync(dest, { mimeType: 'application/pdf', dialogTitle: 'Pilot CV', UTI: 'com.adobe.pdf' });
  return { attached: spreads && merged ? spreads.n : 0, merged };
}
