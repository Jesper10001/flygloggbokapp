import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { aggregateCV } from './aggregateCV';
import { renderEASA } from './templates/easa';
import { renderModern } from './templates/modernBlades';
import { renderEditorial } from './templates/editorial';

export type PdfTemplate = 'easa' | 'modern' | 'editorial';

const RENDERERS: Record<PdfTemplate, (cv: any) => string> = {
  easa: renderEASA,
  modern: renderModern,
  editorial: renderEditorial,
};

export async function exportPilotPDF(template: PdfTemplate): Promise<string> {
  const cv = await aggregateCV();
  const html = RENDERERS[template](cv);
  const { uri } = await Print.printToFileAsync({
    html,
    width: 595,
    height: 842,
    base64: false,
  });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Pilot Statement of Experience',
      UTI: 'com.adobe.pdf',
    });
  }
  return uri;
}
