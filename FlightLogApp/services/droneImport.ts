// Drönar-CSV-import — speglar pilotens AI-pipeline (services/import.ts) men på drönar-fält.
// Claude identifierar ENBART kolumnmappningen; alla rader tolkas lokalt på enheten. Sparas med
// source='import' → syns som en batch under Imported data och räknas i drönar-stats. Efter import
// berikas unika drönar-modeller (specar + bild) via droneLookup (token-styrt), som pilotens flotta.
import { insertDroneFlight, persistDroneModelLookup, addDrone, listDrones, linkImportedDroneFlights, ftToDroneAltM, type DroneFlightMode } from '../db/drones';
import { parseDroneRole, parseDroneCrewText, droneRoleColumn, type DroneRole } from '../constants/droneRoles';
import { pickImportFile, readTextSmart, parseRow, normalize, convertDate, convertTime } from './import';
import { callAnthropicJson, callAnthropicRaw } from './anthropicClient';
import { enrichDroneFleet } from './droneLookup';
import { hasTokenQuota } from '../utils/tokenGate';
import { hasAiConsent } from './aiConsent';

// Claude identifierar bara mappningen — appen tolkar alla rader lokalt.
const DRONE_MAPPING_PROMPT = `Du är expert på DRÖNAR-/RPAS-loggboksformat (DJI, Autel, generisk drönarlogg, samt appens egna exporter "Blades": kolumner Date, Drone type, Registration, Location, Mission type, Category, Flight mode, Flight time, VLOS, EVLOS, BVLOS, Pilot function, PIC time, SIC / Co-pilot time, Dual time, Instructor time, RPIC time, Payload operator time, Mission commander time, Observer time, Safety pilot time, Examiner time, Max altitude (ft), Night, Crew, Remarks — eller samma tidskolumner med "(h)" i stället för "time", t.ex. "Total time (h)", "PIC (h)", "Observer (h)". Äldre Blades-exporter har "Max altitude (m)" och "Observer").

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
  flight_mode    — siktförhållande (TEXT). Värden: VLOS, EVLOS, BVLOS (eller kombinerat, t.ex. "VLOS + BVLOS"). Rubriker: "Flight mode", "Mode", "Operation"
  vlos_time      — tid i VLOS (VARAKTIGHET). Rubriker: "VLOS", "VLOS time", "VLOS (h)"
  evlos_time     — tid i EVLOS (VARAKTIGHET). Rubriker: "EVLOS", "EVLOS time", "EVLOS (h)"
  bvlos_time     — tid i BVLOS (VARAKTIGHET). Rubriker: "BVLOS", "BVLOS time", "BVLOS (h)"
                   OBS: en kolumn vars VÄRDEN är VLOS/EVLOS/BVLOS är flight_mode; kolumner som HETER VLOS/EVLOS/BVLOS och innehåller tider är *_time.
  total_time     — total flygtid (VARAKTIGHET, ej klockslag). Rubriker: "Flight time", "Total", "Duration", "Time"
  night_time     — natt-tid (timmar). En "Night"-kolumn med Yes/No eller 1/0 är en FLAGGA → mappa ändå hit (appen tolkar Yes/1 som natt).
  ifr            — IFR-tid. Rubriker: "IFR", "Instrument"
  co_pilot_fpv   — co-pilot/SIC/FPV-tid. Rubriker: "Co-Pilot", "Copilot", "FPV", "Second pilot time", "SIC / Co-pilot time", "SIC / Co-pilot (h)"
  dual           — elev-/dual-tid. Rubriker: "Dual", "Student", "Dual time", "Dual (h)"
  instructor     — instruktörstid. Rubriker: "Instructor", "Dual Given", "Instructor time", "Instructor (h)"
  landings_day   — daglandningar (heltal). Rubriker: "Day Ldg", "Landings", "LDG"
  landings_night — nattlandningar (heltal). Rubriker: "Night Ldg", "Night LDG"
  max_altitude_m — max höjd i METER. Rubriker: "Max altitude (m)", "Altitude (m)", "Max altitude", "Altitude", "AGL"
  max_altitude_ft — max höjd i FOT. Rubriker: "Max altitude (ft)", "Max alt (ft)", "Altitude (ft)", "Height (ft)". Anger rubriken fot (ft/feet) → max_altitude_ft, annars max_altitude_m.
  pilot_function — pilotens EGEN roll på flygningen (TEXT). Värden: PIC, SIC, Dual, Instructor, RPIC, Payload operator, Mission commander, Observer, Safety pilot, Examiner. Rubriker: "Pilot function", "Role", "Function", "Crew position"
  crew           — ANDRA personer i besättningen med roll (TEXT), t.ex. "SIC: J. Doe, Observer: A. Berg". Rubriker: "Crew", "Second pilot", "Crew members", "Other crew"
  latitude       — startplatsens latitud i decimalgrader (t.ex. 59.3293). Rubriker: "Latitude", "Lat", "Takeoff Lat", "Home Latitude"
  longitude      — startplatsens longitud i decimalgrader (t.ex. 18.0686). Rubriker: "Longitude", "Lon", "Lng", "Takeoff Lon", "Home Longitude"
  takeoff_time   — starttid (KLOCKSLAG HH:MM, ej varaktighet). Rubriker: "Takeoff", "Takeoff time", "Start time", "Launch time"
  observer       — observatörens NAMN, eller en Yes/No-flagga. Rubriker: "Observer", "Observer name", "VO", "Visual observer". OBS: en kolumn med TIDER ("Observer time", "Observer (h)") är rolltid, INTE detta.
  operation_type — kommersiell eller privat flygning. Värden: COM/Commercial, PRI/Private/Recreational. Rubriker: "Operation type", "COM/PRI", "Commercial". OBS: en kolumn med VLOS/EVLOS/BVLOS är flight_mode, inte detta.
  remarks        — anmärkningar/fritext. Rubriker: "Remarks", "Notes", "Comments"

── REGLER ────────────────────────────────────────────────────────────────────
- Nycklarna i column_mapping MÅSTE vara EXAKTA kolumnnamn från headern (tecken för tecken).
- Mappa ALLTID en varaktighetskolumn till total_time om en finns.
- Mappa ALDRIG två kolumner till samma interna fält.
- Tidskolumner per roll UTÖVER co-pilot/dual/instructor ("PIC time", "RPIC time", "Payload operator time", "Mission commander time", "Observer time", "Safety pilot time", "Examiner time" och motsvarande med "(h)") mappas INTE — rollen kommer från pilot_function. Skriv ingen varning om dem.
- Utelämna kolumner som inte kan mappas. Ignorera "sep=;"-rader och TOTAL-summeringsraden.
- delimiter: "," ";" "|" eller "\\t". date_format och time_format ("HH:MM"/"decimal"/"mixed") som filen använder.
- warnings skrivs PÅ ENGELSKA, korta meningar — de visas för användaren i appen.`;

const DRONE_INT_FIELDS = new Set([
  'date', 'drone_type', 'registration', 'location', 'mission_type', 'category', 'flight_mode',
  'total_time', 'night_time', 'ifr', 'co_pilot_fpv', 'dual', 'instructor',
  'landings_day', 'landings_night', 'max_altitude_m', 'remarks',
  'latitude', 'longitude', 'takeoff_time', 'observer', 'operation_type',
  'vlos_time', 'evlos_time', 'bvlos_time', 'max_altitude_ft', 'pilot_function', 'crew',
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
  max_altitude_m: number;    // meter (2 decimaler) — även ur en fot-kolumn
  is_night: boolean;
  lat: number;               // startplats (0 = saknas) → drönar-globen och kartorna
  lon: number;
  takeoff_time: string;      // HH:MM ('' = saknas)
  has_observer: boolean;
  observer_name: string;
  operation_type: string;    // 'COM' | 'PRI' | ''
  h_vlos: number;            // delad tid per siktläge (0 = rent läge → flight_mode × total)
  h_evlos: number;
  h_bvlos: number;
  pilot_role: string;        // egen roll (constants/droneRoles.ts), '' = härleds ur rolltiderna
  second_pilot: string;      // besättning (Crew-kolumnen + observatörer) — som Log flights Second pilot
  second_pilot_role: string;
  extra_pilots: string;      // JSON [{ role, name }]
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
  // Även kombinerad etikett ur vår export ("VLOS + BVLOS") → första läget; tiden per läge kommer ur *_time.
  const first = v.trim().toUpperCase().split(/[^A-Z]+/).find((x) => x === 'VLOS' || x === 'EVLOS' || x === 'BVLOS');
  return (first as DroneFlightMode) ?? 'VLOS';
}
function isTruthy(v: string): boolean {
  return /^(y|yes|1|true|night|ja)/i.test(v.trim());
}
function convertTimeNum(v: string): number { return parseFloat(convertTime(v, 'mixed')) || 0; }
// CSV-poster: en radbrytning INNE i ett citerat fält (t.ex. flerradiga Remarks ur appens egen export —
// besättningsraden ligger på egen rad) avslutar inte posten. Citat räknas bara i början av ett fält
// (RFC 4180), så lösa tum-tecken (5") påverkar inte. Oavslutat citat → vanlig raddelning som förut.
function splitCsvRecords(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '""'; i++; continue; }
        inQ = false;
      }
      cur += c;
      continue;
    }
    if (c === '\n') { out.push(cur); cur = ''; continue; }
    if (c === '"') {
      const prev = cur.length ? cur[cur.length - 1] : '';
      if (prev === '' || prev === ',' || prev === ';' || prev === '\t' || prev === '|') inQ = true;
    }
    cur += c;
  }
  out.push(cur);
  return inQ ? text.split('\n') : out;
}
// Tal med decimal- eller tusentalskomma ("121,9" → 121.9, "1,200" → 1200, "24 000" → 24000).
function parseNum(v: string): number {
  const s = v.trim().replace(/\s/g, '');
  const n = parseFloat(/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}
// Decimalgrader (komma eller punkt); utanför ±max eller otolkbart → 0 (= ingen position).
function parseCoord(v: string, max: number): number {
  const n = parseFloat(v.trim().replace(',', '.'));
  return Number.isFinite(n) && Math.abs(n) <= max ? n : 0;
}
// Klockslag → "HH:MM". Tål "13:30", "13.30", "1330" och datum+tid ("2026-10-11 13:30").
function normClock(v: string): string {
  const s = v.trim();
  const m = s.match(/(\d{1,2})[:.](\d{2})/) ?? s.match(/^(\d{1,2})(\d{2})$/);
  if (!m) return '';
  const h = +m[1], mi = +m[2];
  return h < 24 && mi < 60 ? `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}` : '';
}
function normOperation(v: string): string {
  const s = v.trim().toLowerCase();
  if (/^(com|commercial|kommersiell)/.test(s)) return 'COM';
  if (/^(pri|private|privat|recreational|hobby|non-commercial)/.test(s)) return 'PRI';
  return '';
}

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
  const allLines = splitCsvRecords(normalized); // poster, inte rader — flerradiga citerade fält hålls ihop

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
    // Observer: ett namn, eller en Yes/No-flagga (tomt/No = ingen observatör).
    const obsRaw = cell(row, 'observer');
    const obsFlag = /^(y|yes|1|true|ja)$/i.test(obsRaw);
    const obsNone = /^(n|no|0|false|nej|none|-)?$/i.test(obsRaw);
    // Besättning (Crew-kolumnen) + observatörens namn → samma modell som Log flights Second pilot: observatörer
    // är besättning med rollen Observer. "Observer: Yes" (Blades-export av en Yes-flagga) är en flagga, inget namn.
    let crewObsFlag = false;
    const crew = parseDroneCrewText(cell(row, 'crew')).filter((p) => {
      if (p.role === 'observer' && /^(y|yes|1|true|ja)$/i.test(p.name)) { crewObsFlag = true; return false; }
      return true;
    });
    if (!obsFlag && !obsNone) {
      for (const name of obsRaw.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean)) {
        if (!crew.some((p) => p.name.toLowerCase() === name.toLowerCase())) crew.push({ role: 'observer', name });
      }
    }
    const observers = crew.filter((p) => p.role === 'observer').map((p) => p.name);
    const [second, ...extraCrew] = crew;
    // Höjd: meter, eller fot (Blades-exporten skriver "Max altitude (ft)") → meter med 2 decimaler.
    const altM = parseNum(cell(row, 'max_altitude_m'));
    const altFt = parseNum(cell(row, 'max_altitude_ft'));

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
      max_altitude_m: altM > 0 ? Math.round(altM * 100) / 100 : altFt > 0 ? ftToDroneAltM(altFt) : 0,
      is_night: nightH > 0 || nightFlag,
      lat: parseCoord(cell(row, 'latitude'), 90),
      lon: parseCoord(cell(row, 'longitude'), 180),
      takeoff_time: normClock(cell(row, 'takeoff_time')),
      has_observer: observers.length > 0 || obsFlag || crewObsFlag,
      observer_name: observers.join(', '),
      operation_type: normOperation(cell(row, 'operation_type')),
      h_vlos: 0, h_evlos: 0, h_bvlos: 0,
      pilot_role: parseDroneRole(cell(row, 'pilot_function')),
      second_pilot: second?.name ?? '',
      second_pilot_role: second?.role ?? '',
      extra_pilots: extraCrew.length ? JSON.stringify(extraCrew) : '',
      remarks: cell(row, 'remarks'),
    };
    // Roll utan rolltider i filen (t.ex. bara en "Role"-kolumn) → rollens loggbokskolumn får hela flygtiden.
    if (r.pilot_role && r.total_time > 0 && r.co_pilot_fpv + r.dual + r.instructor === 0) {
      const col = droneRoleColumn(r.pilot_role as DroneRole);
      if (col === 'co_pilot_fpv' || col === 'dual' || col === 'instructor') r[col] = r.total_time;
    }
    // Tid per siktläge: två eller fler lägen = delad tid (sparas), ett läge = rent läge (avgör flight_mode).
    const split: Record<DroneFlightMode, number> = { VLOS: convertTimeNum(cell(row, 'vlos_time')), EVLOS: convertTimeNum(cell(row, 'evlos_time')), BVLOS: convertTimeNum(cell(row, 'bvlos_time')) };
    const withTime = (Object.keys(split) as DroneFlightMode[]).filter((m) => split[m] > 0);
    if (withTime.length === 1) r.flight_mode = withTime[0];
    else if (withTime.length > 1) {
      const sum = split.VLOS + split.EVLOS + split.BVLOS;
      const k = r.total_time > 0 && sum > r.total_time + 0.02 ? r.total_time / sum : 1; // aldrig mer än totalen
      r.h_vlos = split.VLOS * k; r.h_evlos = split.EVLOS * k; r.h_bvlos = split.BVLOS * k;
      r.flight_mode = withTime.reduce((a, b) => (split[b] > split[a] ? b : a));
    }
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
  // == null (inte !): kolumnindex 0 är giltigt — Date ligger oftast först.
  if (fieldIdx['total_time'] == null) warnings.push('No flight-time column was found — times are 0.');
  if (fieldIdx['date'] == null) warnings.push('No date column was found — rows use today’s date.');
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
      lat: r.lat,
      lon: r.lon,
      takeoff_time: r.takeoff_time,
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
      has_observer: r.has_observer,
      observer_name: r.observer_name,
      operation_type: r.operation_type,
      h_vlos: String(r.h_vlos), h_evlos: String(r.h_evlos), h_bvlos: String(r.h_bvlos),
      pilot_role: r.pilot_role,
      second_pilot: r.second_pilot,
      second_pilot_role: r.second_pilot_role,
      extra_pilots: r.extra_pilots,
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
/** Skapar registry-rad per unik model+registrering (snabbt, ingen AI). Kör FÖRE navigering till fleet. */
export async function registerImportedDrones(
  rows: ParsedDroneRow[],
  infoByModel: Record<string, { airframe?: string; mtow_g?: number; category?: string }> = {},
): Promise<void> {
  const existing = await listDrones();
  const findId = (model: string, reg: string) =>
    existing.find((d) => (d.model || '').toLowerCase() === model.toLowerCase() && (d.registration || '').toUpperCase() === reg.toUpperCase())?.id;
  const seen = new Set<string>();
  for (const r of rows) {
    const model = (r.drone_type || '').trim();
    if (!model) continue;
    const reg = (r.registration || '').trim().toUpperCase();
    const key = `${model.toLowerCase()}|${reg}`;
    if (seen.has(key)) continue;
    seen.add(key);
    let id = findId(model, reg);
    if (!id) {
      const info = infoByModel[model] || {};
      try {
        id = await addDrone({ drone_type: (info.airframe || '') as any, model, registration: reg, mtow_g: info.mtow_g || 0, category: info.category || r.category || '', drone_class: '', notes: '' });
      } catch { /* hoppa över dubblett/fel */ }
    }
    // Koppla importerade flygningar (drone_id null) → registry-raden så flygtiden räknas i Fleet.
    if (id) {
      try { await linkImportedDroneFlights(id, model, reg); } catch { /* ignorera */ }
    }
  }
}

/** Berikar unika modeller (bild + fulla specar) i bakgrunden efter Save. Returnerar berikningsresultat
 * (samma form som pilotens FleetDone) → driver popup:en. Token-styrt: slut på coins → stoppedForQuota. */
export async function enrichImportedDroneModels(
  rows: ParsedDroneRow[],
): Promise<{ enriched: number; total: number; remaining: number; stoppedForQuota: boolean }> {
  const models = [...new Set(rows.map((r) => (r.drone_type || '').trim()).filter(Boolean))];
  // Bakgrundsjobb frågar aldrig om AI-samtycke — utan samtycke berikas inget (kortets knapp frågar).
  if (!(await hasAiConsent())) return { enriched: 0, total: 0, remaining: 0, stoppedForQuota: false };
  let enriched = 0;
  let stopped = false;
  for (const model of models) {
    if (!hasTokenQuota()) { stopped = true; break; }
    try {
      const r = await enrichDroneFleet(model, { background: true });
      await persistDroneModelLookup(model, {
        manufacturer: r.manufacturer, drone_type: r.drone_type, mtow_g: r.mtow_g, c_class: r.c_class,
        max_flight_min: r.max_flight_min, max_speed_kmh: r.max_speed_kmh, ceiling_m: r.ceiling_m, range_km: r.range_km,
        ...(r.image_url ? { image_url: r.image_url, image_credit: r.image_credit, cutout_url: '' } : {}),
      });
      enriched++;
    } catch { /* hoppa över modeller som inte kan berikas */ }
  }
  return { enriched, total: models.length, remaining: Math.max(0, models.length - enriched), stoppedForQuota: stopped };
}
