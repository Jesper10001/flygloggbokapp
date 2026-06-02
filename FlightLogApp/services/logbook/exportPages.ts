// PDF-export av loggbokssidor: senaste siduppslaget överst, i fallande ordning,
// ett uppslag per A4-liggande sida. Perfekt vid jobbansökan.

import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { getFlights, getSetting } from '../../db/flights';
import {
  getTemplate, ASSIGNABLE_TIME_FIELDS,
  type LogbookTemplate, type LogbookColumn,
} from '../../constants/logbookTemplates';
import { buildSpreads, type LogbookConfig, type ColumnTotals, type LogbookSpread } from './paginate';
import { renderSpreadsPDF } from './renderSpread';
import { useAppModeStore } from '../../store/appModeStore';
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

// Laddar den aktiva digitala loggboken med samma konfiguration som vyn använder.
async function loadLogbook(): Promise<LoadedLogbook> {
  const mode = useAppModeStore.getState().mode;
  const defTpl = mode === 'drone' ? 'sv-drone-logbook' : 'sv-easa-standard';
  const [tplId, sp, ob, cc, sg, fn, ln] = await Promise.all([
    getSetting('dlb_template_id'),
    getSetting('dlb_start_page'),
    getSetting('dlb_opening_balance'),
    getSetting('dlb_custom_cols'),
    getSetting('pilot_signature'),
    getSetting('profile_first_name'),
    getSetting('profile_last_name'),
  ]);

  const base = getTemplate(tplId || defTpl);
  let customCols: Record<string, string> = {};
  try { const all = cc ? JSON.parse(cc) : {}; customCols = all[base.id] ?? {}; } catch { customCols = {}; }
  const template = applyCustomCols(base, customCols);

  let openingBalance: ColumnTotals = {};
  try { openingBalance = ob ? JSON.parse(ob) : {}; } catch { openingBalance = {}; }
  let signature: LoadedLogbook['signature'] = null;
  try { signature = sg ? JSON.parse(sg) : null; } catch { signature = null; }

  const startPage = Math.max(1, parseInt(sp || '1', 10) || 1);
  const flights = await getFlights(10000);
  const config: LogbookConfig = { startingPage: startPage, rowsPerSpread: template.rows_per_spread, openingBalance };
  const spreads = buildSpreads(flights, template, config);

  return {
    template,
    spreads,
    pilotName: [fn, ln].filter(Boolean).join(' '),
    timeFormat: useTimeFormatStore.getState().timeFormat,
    signature,
  };
}

/** Antal siduppslag i den aktiva loggboken (för custom-väljaren). */
export async function getLogbookSpreadCount(): Promise<number> {
  const { spreads } = await loadLogbook();
  return spreads.length;
}

/**
 * Exporterar de senaste `count` siduppslagen som en PDF (liggande, senaste överst).
 * Returnerar antalet uppslag som faktiskt exporterades.
 */
export async function exportLogbookPages(count: number): Promise<number> {
  const { template, spreads, pilotName, timeFormat, signature } = await loadLogbook();
  if (spreads.length === 0) return 0;
  const n = Math.max(1, Math.min(Math.round(count), spreads.length));
  // Senaste N uppslagen, senaste först (fallande).
  const selected = spreads.slice(spreads.length - n).reverse();

  const { html, width, height } = renderSpreadsPDF({ template, spreads: selected, pilotName, timeFormat, signature });
  const { uri } = await Print.printToFileAsync({ html, width, height, base64: false });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      dialogTitle: 'Logbook pages',
      UTI: 'com.adobe.pdf',
    });
  }
  return n;
}
