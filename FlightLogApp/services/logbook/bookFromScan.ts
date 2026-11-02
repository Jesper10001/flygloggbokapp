// Den skannade loggbokens format som mall. När en skanning sparas blir det skannade uppslagets layout
// (bookTemplateFromScan: samma kolumner, ordning, bredder och sidor, bokregeln längst ner) en egen mall,
// "Scanned logbook". Den förväljs när man skapar sin digitala loggbok (BookSetupSheet), med alla fält klara,
// och kolumnerna kan ändras i samma editor som andra egna mallar.

import type { PageGrid } from '../scanGeometry';
import type { ScanRow } from '../scanImport';
import { bookTemplateFromScan } from './scanSpread';
import { saveCustomTemplate, makeUniqueCustomTemplateId, getAnyTemplate } from '../../db/customTemplates';
import { listDigitalBooks } from '../../db/digitalBooks';
import { getSetting, setSetting } from '../../db/flights';

export const SCANNED_TEMPLATE_NAME = 'Scanned logbook';
const KEY = 'scan_book_template';   // id:t på den senast sparade skannade mallen

/** Mallen som skapas av senaste skanningen (förvald när en loggbok skapas), eller null. */
export async function getScannedTemplateId(): Promise<string | null> {
  const id = await getSetting(KEY).catch(() => null);
  return id && (await getAnyTemplate(id).catch(() => null)) ? id : null;
}

/**
 * Sparar skanningens format som mallen "Scanned logbook". Mallen från förra skanningen uppdateras, utom när en
 * loggbok redan använder den (då ändras inte bokens kolumner — en ny mall skapas). Null om rutnätet är för tunt.
 */
export async function saveScannedTemplate(opts: { rows: ScanRow[]; grid: PageGrid | null; rowsPerPage: number }): Promise<string | null> {
  const prev = await getScannedTemplateId();
  const inUse = prev ? (await listDigitalBooks()).some((b) => b.template_id === prev) : false;
  const id = prev && !inUse ? prev : await makeUniqueCustomTemplateId(SCANNED_TEMPLATE_NAME);
  const template = bookTemplateFromScan(opts.rows, opts.grid, opts.rowsPerPage, id, SCANNED_TEMPLATE_NAME);
  if (!template) return null;
  await saveCustomTemplate(template);
  await setSetting(KEY, id);
  return id;
}
