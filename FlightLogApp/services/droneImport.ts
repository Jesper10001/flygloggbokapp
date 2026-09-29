// Drönar-CSV-import — speglar pilotens AI-pipeline (services/import.ts) men på drönar-fält.
// Claude identifierar ENBART kolumnmappningen; alla rader tolkas lokalt på enheten. Sparas med
// source='import' → syns som en batch under Imported data och räknas i drönar-stats. Efter import
// berikas unika drönar-modeller (specar + bild) via droneLookup (token-styrt), som pilotens flotta.
import { insertDroneFlight, persistDroneModelLookup, addDrone, listDrones, type DroneFlightMode } from '../db/drones';
import { pickImportFile, readTextSmart, parseRow, normalize, convertDate, convertTime } from './import';
import { callAnthropicJson, callAnthropicRaw } from './anthropicClient';
import { enrichDroneFleet } from './droneLookup';
import { hasTokenQuota } from '../utils/tokenGate';

// Claude identifierar bara mappningen — appen tolkar alla rader lokalt.
const DRONE_MAPPING_PROMPT = `Du är expert på DRÖNAR-/RPAS-loggboksformat (DJI, Autel, generisk drönarlogg, samt appens egen export "Blades": kolumner Date, Drone type, Registration, Location, Mission type, Category, Flight mode, Flight time, Max altitude (m), Night, Observer, Remarks).

Analysera headern OCH exempelraderna. Använd BÅDE kolumnnamnet OCH datamönstret. Returnera ENBART JSON:
{
  "detected_format": "Blades drone export",
  "delimiter": ";",
  "header_row": 0,
  "date_format": "YYYY-MM-DD",
  "time_format": "HH:MM",
  "column_mapping": { "ExaktKolumnNamn": "internt_fält" },
  "warnings": []
}

── HEADER-RAD ────────────────────────────────────────────────────────────────
header_row = 0-baserat radindex för raden med KOLUMNRUBRIKERNA. Hoppa förbi preamble ("sep=;",
titelrader, tomma rader). En avslutande "TOTAL"-summeringsrad är INTE data.

── INTERNA FÄLT ──────────────────────────────────────────────────────────────
  date           — flygdatum (YYYY-MM-DD, DD/MM/YYYY, DD.MM.YYYY …)
  drone_type     — drönarens modell/typ. Rubriker: "Drone type", "Drone", "Model", "Make-Mod", "UAS", "Aircraft"
  registration   — registrering/serienummer/operator-ID. Rubriker: "Registration", "Reg", "Reg or S/N", "Serial", "S/N"
  location       — plats (FRITEXT, ej ICAO). Rubriker: "Location", "Site", "Area"
  mission_type   — uppdragstyp. Rubriker: "Mission type", "Mission", "Job", "Purpose"
  category       — EU-kategori. Värden: A1, A2, A3, Specific, Certified. Rubriker: "Category", "Cat", "Type/Cat"
  flight_mode    — siktförhållande. Värden: VLOS, EVLOS, BVLOS. Rubriker: "Flight mode", "Mode", "Operation"
  total_time     — total flygtid (VARAKTIGHET, ej klockslag). Rubriker: "Flight time", "Total", "Duration", "Time"
  night_time     — natt-tid (timmar). En "Night"-kolumn med Yes/No eller 1/0 är en FLAGGA → mappa ändå hit (appen tolkar Yes/1 som natt).
  ifr            — IFR-tid. Rubriker: "IFR", "Instrument"
  co_pilot_fpv   — co-pilot/FPV-tid. Rubriker: "Co-Pilot", "Copilot", "FPV", "Second pilot time"
  dual           — elev-/dual-tid. Rubriker: "Dual", "Student"
  instructor     — instruktörstid. Rubriker: "Instructor", "Dual Given"
  landings_day   — daglandningar (heltal). Rubriker: "Day Ldg", "Landings", "LDG"
  landings_night — nattlandningar (heltal). Rubriker: "Night Ldg", "Night LDG"
  max_altitude_m — max höjd i meter (heltal). Rubriker: "Max altitude (m)", "Max altitude", "Altitude", "AGL"
  remarks        — anmärkningar/fritext. Rubriker: "Remarks", "Notes", "Comments"

── REGLER ────────────────────────────────────────────────────────────────────
- Nycklarna i column_mapping MÅSTE vara EXAKTA kolumnnamn från headern (tecken för tecken).
- Mappa ALLTID en varaktighetskolumn till total_time om en finns.
- Mappa ALDRIG två kolumner till samma interna fält.
- Utelämna kolumner som inte kan mappas. Ignorera "sep=;"-rader och TOTAL-summeringsraden.
- delimiter: "," ";" "|" eller "\\t". date_format och time_format ("HH:MM"/"decimal"/"mixed") som filen använder.`;

const DRONE_INT_FIELDS = new Set([
  'date', 'drone_type', 'registration', 'location', 'mission_type', 'category', 'flight_mode',
  'total_time', 'night_time', 'ifr', 'co_pilot_fpv', 'dual', 'instructor',
  'landings_day', 'landings_night', 'max_altitude_m', 'remarks',
]);

export interface ParsedDroneRow {
  date: string;
  drone_type: string;
  registration: string;
  location: string;
  mission_type: string;
  category: string;
  flight_mode: DroneFlightMode;
  total_time: number;
  night_time: number;
  ifr: number;
  co_pilot_fpv: number;
  dual: number;
  instructor: number;
  landings_day: number;
  landings_night: number;
  max_altitude_m: number;
  is_night: boolean;
  remarks: string;
}

export interface DroneImportResult {
  detectedFormat: string;
  totalRows: number;
  mappedRows: number;
  warnings: string[];
  rows: ParsedDroneRow[];
  tokensUsed: number;
}

function normCategory(v: string): string {
  const s = v.trim();
  const u = s.toUpperCase();
  if (u === 'A1' || u === 'A2' || u === 'A3') return u;
  if (/^spec/i.test(s)) return 'Specific';
  if (/^cert/i.test(s)) return 'Certified';
  return s;
}
function normMode(v: string): DroneFlightMode {
  const u = v.trim().toUpperCase();
  return (u === 'EVLOS' || u === 'BVLOS') ? u : 'VLOS';
}
function isTruthy(v: string): boolean {
  return /^(y|yes|1|true|night|ja)/i.test(v.trim());
}
function convertTimeNum(v: string): number { return parseFloat(convertTime(v, 'mixed')) || 0; }

export async function importDroneFromFile(
  fileUri: string,
  onProgress?: (current: number, total: number) => void,
): Promise<DroneImportResult> {
  onProgress?.(0, 3);
  const isExcel = fileUri.toLowerCase().endsWith('.xlsx') || fileUri.toLowerCase().endsWith('.xls');
  if (isExcel) throw new Error('Excel is not supported yet — please export as CSV.');

  const content = await readTextSmart(fileUri);
  if (!content?.trim()) throw new Error('The file appears to be empty. Check that it is a valid CSV file.');

  const normalized = content.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const allLines = normalized.split('\n');

  // Hoppa förbi sep=/kommentarer/tomrader → hitta första riktiga raden.
  let headerIndex = 0;
  for (let i = 0; i < Math.min(allLines.length, 5); i++) {
    const l = allLines[i].trim();
    if (!l || /^sep=/i.test(l) || /^#/.test(l)) continue;
    headerIndex = i; break;
  }
  const lines = [allLines[headerIndex], ...allLines.slice(headerIndex + 1).filter((l) => l.trim().length > 0)];
  if (lines.length < 2) throw new Error('The file has no data rows (only a header was found).');

  onProgress?.(1, 3);

  const sample = lines.slice(0, 16).join('\n');
  let tokensUsed = 0;
  const mapping = await callAnthropicJson<any>({
    system: DRONE_MAPPING_PROMPT,
    maxTokens: 1536,
    timeoutMs: 90000,
    onUsage: (u) => { tokensUsed = u.inputTokens + u.outputTokens; },
    userContent: `Identifiera format och kolumnmappning:\n\n${sample}`,
  });

  const delimiter: string = mapping.delimiter ?? ',';
  const dateFormat: string = mapping.date_format ?? 'YYYY-MM-DD';
  const timeFormat: string = mapping.time_format ?? 'mixed';
  const rawMap: Record<string, string> = mapping.column_mapping ?? {};
  const detectedFormat: string = mapping.detected_format ?? 'Unknown';
  const warnings: string[] = Array.isArray(mapping.warnings) ? mapping.warnings : [];

  // Behåll bara giltiga interna fält; ta bort dubbletter (första vinner).
  const colMap: Record<string, string> = {};
  const usedFields = new Set<string>();
  for (const [csvCol, field] of Object.entries(rawMap)) {
    if (!DRONE_INT_FIELDS.has(field) || usedFields.has(field)) continue;
    colMap[csvCol] = field; usedFields.add(field);
  }
  if (Object.keys(colMap).length === 0) {
    throw new Error(`Could not map columns for format "${detectedFormat}". Check that the file exported correctly.`);
  }

  onProgress?.(2, 3);

  // Hitta headerraden (flest mappade kolumnnamn) — AI:ns hint vinner vid minst lika bra poäng.
  const colKeys = Object.keys(colMap).map(normalize);
  const score = (line: string) => { const cells = parseRow(line, delimiter).map(normalize); return colKeys.filter((k) => cells.includes(k)).length; };
  let headerRowIdx = 0, best = 0;
  for (let i = 0; i < Math.min(lines.length - 1, 20); i++) { const s = score(lines[i]); if (s > best) { headerRowIdx = i; best = s; } }
  const hinted = Number.isInteger(mapping.header_row) ? mapping.header_row as number : -1;
  if (hinted >= 0 && hinted < lines.length - 1 && best > 0 && score(lines[hinted]) >= best) headerRowIdx = hinted;

  const headers = parseRow(lines[headerRowIdx], delimiter);
  const idxOf = (csvCol: string) => headers.findIndex((h) => normalize(h) === normalize(csvCol));
  const fieldIdx: Partial<Record<string, number>> = {};
  for (const [csvCol, field] of Object.entries(colMap)) { const i = idxOf(csvCol); if (i >= 0) fieldIdx[field] = i; }

  const dataRows = lines.slice(headerRowIdx + 1).map((l) => parseRow(l, delimiter));
  const cell = (row: string[], field: string) => { const i = fieldIdx[field]; return i == null ? '' : (row[i] ?? '').trim(); };

  const rows: ParsedDroneRow[] = [];
  let clamped = 0;
  for (const row of dataRows) {
    if (normalize(row[0] ?? '') === 'total') continue; // TOTAL-summeringsrad
    if (!row.some((c) => (c ?? '').trim() !== '')) continue;

    const nightRaw = cell(row, 'night_time');
    // Night kan vara timmar ELLER en Yes/No/1/0-flagga.
    const nightH = convertTimeNum(nightRaw);
    const nightFlag = nightRaw !== '' && nightH === 0 && isTruthy(nightRaw);

    const r: ParsedDroneRow = {
      date: convertDate(cell(row, 'date'), dateFormat),
      drone_type: cell(row, 'drone_type'),
      registration: cell(row, 'registration').toUpperCase(),
      location: cell(row, 'location'),
      mission_type: cell(row, 'mission_type'),
      category: normCategory(cell(row, 'category')),
      flight_mode: normMode(cell(row, 'flight_mode')),
      total_time: convertTimeNum(cell(row, 'total_time')),
      night_time: nightH,
      ifr: convertTimeNum(cell(row, 'ifr')),
      co_pilot_fpv: convertTimeNum(cell(row, 'co_pilot_fpv')),
      dual: convertTimeNum(cell(row, 'dual')),
      instructor: convertTimeNum(cell(row, 'instructor')),
      landings_day: parseInt(cell(row, 'landings_day'), 10) || 0,
      landings_night: parseInt(cell(row, 'landings_night'), 10) || 0,
      max_altitude_m: parseInt(cell(row, 'max_altitude_m'), 10) || 0,
      is_night: nightH > 0 || nightFlag,
      remarks: cell(row, 'remarks'),
    };
    if (!r.date) r.date = new Date().toISOString().slice(0, 10);

    // Rolltid/natt/IFR får inte överstiga totaltiden.
    if (r.total_time > 0) {
      let didClamp = false;
      for (const f of ['night_time', 'ifr', 'co_pilot_fpv', 'dual', 'instructor'] as const) {
        if (r[f] > r.total_time + 0.02) { r[f] = r.total_time; didClamp = true; }
      }
      if (didClamp) clamped++;
    }
    rows.push(r);
  }

  if (rows.length === 0 && dataRows.length > 0) {
    throw new Error(`No flights could be read (${dataRows.length} rows scanned). Try exporting as standard CSV.`);
  }
  if (!fieldIdx['total_time']) warnings.push('No flight-time column was found — times are 0.');
  if (!fieldIdx['date']) warnings.push('No date column was found — rows use today’s date.');
  if (clamped > 0) warnings.push(`${clamped} row(s) had night/role time exceeding total time — capped to total.`);

  onProgress?.(3, 3);
  return { detectedFormat, totalRows: dataRows.length, mappedRows: rows.length, warnings, rows, tokensUsed };
}

// ── AI-sammanfattning (engelska, punktlista) — speglar pilotens. ───────────────
const DRONE_SUMMARY_PROMPT = `Du är importassistenten i en DRÖNAR-loggboksapp. Användaren har just importerat (eller försökt importera) en drönarloggfil, och appens AI har analyserat den. Skriv analysen PÅ ENGELSKA som en PUNKTLISTA riktad direkt till användaren.

FORMAT (följ exakt):
- Endast punkter. Varje punkt på egen rad, inledd med "- ". Ingen rubrik, ingen hälsning, ingen text före eller efter.
- 3–6 punkter, varje punkt EN kort mening.
- Omslut det som AVVIKER eller kräver UPPMÄRKSAMHET med **fetstil**: antaganden, uppskattade/klampade värden, saknad data, konstigheter, fel. Fetmarkera INTE trivial info.

INNEHÅLL: vilket format filen ser ut komma från, vad som mappades (datum, modell, kategori, mode, flygtid, natt, landningar), gjorda antaganden, och sådant som ser konstigt ut. Vid importfel: förklara sakligt vad som troligen är fel och hur man exporterar en korrekt CSV.

ÅTGÄRDER: om något kan korrigeras i appen, avsluta med en "Fix: "-punkt med EXAKT väg i **fetstil**:
- Saknade kategoritimmar → "Fix: top up missing totals in **Settings → Imported data → Backfill missing hours**"
- Granska/justera importerad data → "Fix: review it in **Settings → Imported data**"

Var konkret och lugn. Hitta inte på siffror eller andra vägar; använd bara det som skickas in.`;

export interface DroneImportSummaryInput {
  fileName: string;
  detectedFormat?: string;
  totalRows?: number;
  parsedFlights?: number;
  totalHours?: number;
  dateRange?: string;
  drones?: string[];
  categories?: string[];
  warnings?: string[];
  error?: string;
}

export async function generateDroneImportSummary(input: DroneImportSummaryInput): Promise<string> {
  const res = await callAnthropicRaw({
    system: DRONE_SUMMARY_PROMPT,
    maxTokens: 350,
    timeoutMs: 60000,
    userContent: `Analysresultat (JSON):\n${JSON.stringify(input)}`,
  });
  return res.text.trim();
}

/** Väljer + parsar en CSV-fil (återanvänder pilotens filväljare). */
export async function pickAndImportDroneCsv(
  onProgress?: (current: number, total: number) => void,
): Promise<{ fileName: string; result: DroneImportResult } | null> {
  const file = await pickImportFile();
  if (!file) return null;
  const result = await importDroneFromFile(file.uri, onProgress);
  return { fileName: file.name, result };
}

/** Sparar parsade rader som drönar-flygningar (source='import'). Returnerar antal sparade. */
export async function saveDroneImport(rows: ParsedDroneRow[]): Promise<number> {
  let n = 0;
  for (const r of rows) {
    await insertDroneFlight({
      date: r.date,
      drone_id: null,
      drone_type: r.drone_type,
      registration: r.registration,
      location: r.location,
      mission_type: r.mission_type,
      category: r.category,
      flight_mode: r.flight_mode,
      total_time: String(r.total_time),
      max_altitude_m: String(r.max_altitude_m || ''),
      is_night: r.is_night,
      night_time: String(r.night_time),
      ifr: String(r.ifr),
      co_pilot_fpv: String(r.co_pilot_fpv),
      dual: String(r.dual),
      instructor: String(r.instructor),
      landings_day: String(r.landings_day),
      landings_night: String(r.landings_night),
      has_observer: false,
      observer_name: '',
      remarks: r.remarks,
      source: 'import',
    });
    n++;
  }
  return n;
}

/**
 * Registrerar importerade drönare i flottan (skapar registry-rad per unik model+registrering om den
 * saknas) och berikar sedan varje unik modell (specar + bild via droneLookup, token-styrt) — så de
 * importerade drönarna dyker upp i flottan direkt och kan redigeras (= pilotens aircraft-import).
 */
export async function registerAndEnrichImportedDrones(
  rows: ParsedDroneRow[],
  infoByModel: Record<string, { airframe?: string; mtow_g?: number; category?: string }> = {},
): Promise<void> {
  const existing = await listDrones();
  const has = (model: string, reg: string) =>
    existing.some((d) => (d.model || '').toLowerCase() === model.toLowerCase() && (d.registration || '').toUpperCase() === reg.toUpperCase());

  const seen = new Set<string>();
  const models = new Set<string>();
  for (const r of rows) {
    const model = (r.drone_type || '').trim();
    if (!model) continue;
    models.add(model);
    const reg = (r.registration || '').trim().toUpperCase();
    const key = `${model.toLowerCase()}|${reg}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!has(model, reg)) {
      const info = infoByModel[model] || {};
      try {
        await addDrone({ drone_type: (info.airframe || '') as any, model, registration: reg, mtow_g: info.mtow_g || 0, category: info.category || r.category || '', drone_class: '', notes: '' });
      } catch { /* hoppa över dubblett/fel */ }
    }
  }

  for (const model of models) {
    if (!hasTokenQuota()) break; // slut på tokens → resten kan berikas senare
    try {
      const r = await enrichDroneFleet(model);
      await persistDroneModelLookup(model, {
        manufacturer: r.manufacturer, drone_type: r.drone_type, mtow_g: r.mtow_g, c_class: r.c_class,
        max_flight_min: r.max_flight_min, max_speed_kmh: r.max_speed_kmh, ceiling_m: r.ceiling_m, range_km: r.range_km,
        ...(r.image_url ? { image_url: r.image_url, cutout_url: '' } : {}),
      });
    } catch { /* hoppa över modeller som inte kan berikas */ }
  }
}
