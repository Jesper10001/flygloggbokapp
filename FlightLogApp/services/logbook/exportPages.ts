// PDF-export av loggbokssidor: senaste siduppslaget överst, i fallande ordning,
// ett uppslag per A4-liggande sida. Perfekt vid jobbansökan.
// Exporterar den AKTIVA digitala boken (eller en angiven bok via bookId).

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import { getFlights, getSetting } from '../../db/flights';
import { listDigitalBooks, type BookKind } from '../../db/digitalBooks';
import { getDroneFlights } from '../../db/drones';
import { droneToFlightRow, loadDroneMetaById } from './droneSpread';
import type { Flight } from '../../types/flight';
import {
  getTemplate, ASSIGNABLE_TIME_FIELDS,
  type LogbookTemplate, type LogbookColumn,
} from '../../constants/logbookTemplates';
import { buildBookSpreads, type LogbookSpread } from './paginate';
import { assignFlightsToBooks, resolveOpeningBalance } from './books';
import { renderSpreadsPDF } from './renderSpread';
import { useTimeFormatStore } from '../../store/timeFormatStore';

function applyCustomCols(template: LogbookTemplate, customCols: Record<string, string>): LogbookTemplate {
  if (!customCols || Object.keys(customCols).length === 0) return template;
  const apply = (c: LogbookColumn): LogbookColumn => {
    const fk = customCols[c.id];
    if (!fk) return c;
    const f = ASSIGNABLE_TIME_FIELDS.find((a) => a.key === fk);
    if (!f) return c;
    return { ...c, flightKey: f.key, format: f.format, label: f.label };
  };
  return {
    ...template,
    left_columns: template.left_columns.map(apply),
    right_columns: template.right_columns.map(apply),
  };
}

interface LoadedLogbook {
  template: LogbookTemplate;
  spreads: LogbookSpread[];
  pilotName: string;
  timeFormat: 'decimal' | 'hhmm';
  signature: { paths: string[]; w: number; h: number; x?: number; y?: number } | null;
}

// Laddar en digital bok (aktiv eller angiven) med samma konfiguration som vyn använder.
async function loadLogbook(bookId?: number, kind: BookKind = 'digital'): Promise<LoadedLogbook> {
  const [sg, fn, ln] = await Promise.all([
    getSetting('pilot_signature'),
    getSetting('profile_first_name'),
    getSetting('profile_last_name'),
  ]);
  const pilotName = [fn, ln].filter(Boolean).join(' ');
  const timeFormat = useTimeFormatStore.getState().timeFormat;
  let signature: LoadedLogbook['signature'] = null;
  try { signature = sg ? JSON.parse(sg) : null; } catch { signature = null; }

  const books = await listDigitalBooks(kind);
  const active = bookId != null
    ? books.find((b) => b.id === bookId)
    : (books.find((b) => b.is_active === 1) ?? books[books.length - 1]);

  if (!active) {
    return { template: getTemplate(''), spreads: [], pilotName, timeFormat, signature };
  }

  const base = getTemplate(active.template_id);
  let customCols: Record<string, string> = {};
  try { customCols = JSON.parse(active.custom_cols || '{}'); } catch { customCols = {}; }
  const template = applyCustomCols(base, customCols);

  // Pilot: riktiga flighter. Drönare: drone_flights → mall-rader (samma adapter som drönar-loggboken).
  let flightRows: Flight[];
  if (kind === 'drone') {
    const [df, meta] = await Promise.all([getDroneFlights(10000), loadDroneMetaById()]);
    flightRows = df.map((d) => droneToFlightRow(d, d.drone_id != null ? meta.get(d.drone_id) : undefined));
  } else {
    flightRows = await getFlights(10000);
  }
  const slices = assignFlightsToBooks(books, flightRows);
  const slice = slices.find((s) => s.book.id === active.id);

  const spreads = buildBookSpreads(slice?.flights ?? [], template, {
    startingPage: active.starting_page,
    rowsPerSpread: active.rows_per_spread,
    openingBalance: resolveOpeningBalance(active, books, flightRows, template),
    leadingEmptyRows: slice?.leadingEmptyRows ?? 0,
  });

  return { template, spreads, pilotName, timeFormat, signature };
}

/** Antal siduppslag i boken (för custom-väljaren). */
export async function getLogbookSpreadCount(bookId?: number, kind: BookKind = 'digital'): Promise<number> {
  const { spreads } = await loadLogbook(bookId, kind);
  return spreads.length;
}

/**
 * Exporterar de senaste `count` siduppslagen som en PDF (liggande, senaste överst).
 * Returnerar antalet uppslag som faktiskt exporterades.
 */
export async function exportLogbookPages(count: number, bookId?: number, kind: BookKind = 'digital'): Promise<number> {
  const { template, spreads, pilotName, timeFormat, signature } = await loadLogbook(bookId, kind);
  if (spreads.length === 0) return 0;
  const n = Math.max(1, Math.min(Math.round(count), spreads.length));
  // Senaste N uppslagen, senaste först (fallande).
  const selected = spreads.slice(spreads.length - n).reverse();

  const { html, width, height } = renderSpreadsPDF({ template, spreads: selected, pilotName, timeFormat, signature });
  const { uri } = await Print.printToFileAsync({ html, width, height, base64: false });
  // Döp om till ett tydligt filnamn (samma konvention som CSV-exporten).
  const dateStamp = new Date().toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
  const dest = FileSystem.documentDirectory + `Blades ${kind === 'drone' ? 'drone ' : ''}logbook pages export ${dateStamp}.pdf`;
  await FileSystem.deleteAsync(dest, { idempotent: true });
  await FileSystem.copyAsync({ from: uri, to: dest });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(dest, {
      mimeType: 'application/pdf',
      dialogTitle: 'Logbook pages',
      UTI: 'com.adobe.pdf',
    });
  }
  return n;
}
