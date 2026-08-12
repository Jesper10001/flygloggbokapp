import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import type { OcrFlightResult } from '../types/flight';
import * as XLSX from 'xlsx';

import { callAnthropicJson, callAnthropicRaw } from './anthropicClient';

// Claude identifierar bara mappningen — appen tolkar alla rader lokalt
const MAPPING_PROMPT = `Du är expert på flygloggboksformat (ForeFlight, LogTen Pro, MyFlightbook, mccPILOTLOG, APDL, Logbook Pro, Eflightbook, generisk CSV och Excel).

Analysera headern OCH exempelraderna noggrant. Använd BÅDE kolumnnamnet OCH datamönstret i varje kolumn för att avgöra vad kolumnen innehåller. Returnera ENBART JSON:
{
  "detected_format": "ForeFlight",
  "delimiter": ",",
  "header_row": 0,
  "date_format": "MM/DD/YYYY",
  "time_format": "HH:MM",
  "column_mapping": {
    "ExaktKolumnNamnFrånCSV": "internt_fält"
  },
  "time_candidates": [
    { "column": "ExaktKolumnNamn", "label": "Block time" }
  ],
  "warnings": []
}

── HEADER-RAD (header_row) ──────────────────────────────────────────────────
header_row = 0-baserat radindex (i exemplet du ser) för raden som innehåller KOLUMNRUBRIKERNA.
Många exporter har preamble-rader före headern ("Pilot Log Export", "Generated automatically",
tomma rader) — peka då förbi dem. ForeFlight-exporter innehåller TVÅ tabeller: först "Aircraft
Table" med sina egna rubriker, sedan "Flights Table" — header_row ska peka på FLIGHTS-tabellens
rubrikrad (den med Date, AircraftID, From, To …), och column_mapping ska använda kolumnnamnen
därifrån. Raderna före header_row ignoreras av appen.

── TIDSKOLUMNER (time_candidates) ────────────────────────────────────────────
Lista ALLA kolumner som ser ut som flygtidens VARAKTIGHET (inte klockslag) i "time_candidates",
var och en med exakt kolumnnamn + en kort etikett: "Block time" (motor på→av, inkl. taxi),
"Air time"/"Flight time" (tid i luften), eller "Total". Mappa den mest kompletta/troliga till
total_time i column_mapping. Finns det flera varaktighetskolumner låter appen användaren välja
vilken som blir loggbokens totaltid — så ta med dem alla här.
KRITISKT: Mappa ALLTID exakt EN varaktighetskolumn till total_time i column_mapping (även om
samma kolumn också står i time_candidates). Utelämna aldrig total_time ur column_mapping när
en varaktighetskolumn finns.
KRITISKT: Välj ALDRIG en kolumn som är tom/0 i exempelraderna som total_time — välj den som
faktiskt innehåller värden. Vid val mellan blocktid (Block/TIME_TOTAL) och lufttid (Air/TIME_AIR):
BLOCKTIDEN är loggbokens totaltid.

KRITISKT: Nycklarna i column_mapping MÅSTE vara de EXAKTA kolumnnamnen från CSV-headern — kopiera dem tecken för tecken inklusive mellanslag, bindestreck och versaler.

── DATAMÖNSTER ATT KÄNNA IGEN ──────────────────────────────────────────────
Använd dessa mönster för att identifiera kolumner även när rubriknamnet är ovanligt eller på annat språk:

  DATUM-kolumn: värden som "2024-03-15", "15.03.2024", "03/15/2024"
  TID-kolumn (flygtid): värden som "1:30", "2.5", "0.8", "1,5" — decimaler eller HH:MM. Aldrig tomma strängar eller namn.
  BOOLESK FLAGGA (1/0): kolumner med ENBART värdena 0 och 1 där kolumnnamnet matchar ett tidsfält (t.ex. PIC, IFR, Night, Dual).
    → Mappa dem ÄNDÅ till rätt internt fält. Appen konverterar 1 → total_time och 0 → 0 automatiskt.
    → Skippa dem INTE bara för att värdena är 0/1 istället för decimaltimmar.
  ICAO-kolumn: 4-bokstavskoder med versaler, t.ex. "ESSA", "EKCH", "ENGM", "EDDF". Ibland blandat med tomma värden.
  REGISTRERING: mönster som "SE-XYZ", "LN-ABC", "OY-123", "D-ABCD"
  LANDNINGAR: heltal, oftast 0 eller 1 per rad
  ANMÄRKNINGAR: fri text, längre strängar

── INTERNA FÄLT ─────────────────────────────────────────────────────────────
  date           — datum (se datummönster ovan)
  aircraft_type  — flygplans-/helikoptertyp. Vanliga rubriker: "Aircraft Model", "A/C Type", "Type", "Typ", "Modell", "Luftfahrzeugmuster"
  registration   — registreringsnummer. Rubriker: "Reg", "Registration", "Tail", "Kennzeichen", "Reg.nr"
  dep_place      — avgångsplats ICAO-kod. Rubriker: "From", "Dep", "Departure", "ADEP", "Från", "Abflug", "Afgang"
  dep_utc        — avgångstid UTC. Rubriker: "Off Blocks", "Dep Time", "Out", "STD", "ATD", "Block Out"
  arr_place      — ankomstplats ICAO-kod. Rubriker: "To", "Arr", "Arrival", "ADES", "Till", "Ankunft", "Ankomst"
  arr_utc        — ankomsttid UTC. Rubriker: "On Blocks", "Arr Time", "In", "STA", "ATA", "Block In"
  total_time     — total flygtid. Rubriker: "Total", "Duration", "Block Time", "Flight Time", "Totaltid", "Gesamtzeit", "Bloktid"
  pic            — PIC-tid (timvärde, ej namn). Rubriker: "PIC", "P1", "Pilot in Command", "PIC Time", "Befälhavare", "Kommandant"
                   OBS: Om det finns BÅDE "PIC" (timmar) och "PIC Name"/"Pilot Name" (text) — mappa BARA tidkolumnen till pic
  co_pilot       — co-pilot/SIC-tid (timvärde, ej namn). Rubriker: "SIC", "P2", "Co-Pilot", "Copilot Time"
                   OBS: Om det finns BÅDE tidkolumn och namnkolumn för andrepilot — mappa BARA tidkolumnen till co_pilot
  second_pilot   — andrepilotens namn/beteckning (fritext). Rubriker: "2ndPilot", "SIC Name", "Co-Pilot Name", "P2 Name", "Andrepilot", "Second Pilot", "Crew"
  dual           — elevtid/dual received. Rubriker: "Dual", "Dual Received", "Student", "Elev", "Schüler"
  instructor     — instruktörstid (given dual instruction). Rubriker: "Instructor", "Dual Given", "Instr", "INST", "Dual Instr", "Instructor Time"
  multi_pilot    — flerpilottid (multi-crew operations). Rubriker: "Multi Pilot", "Multi-Pilot", "MP", "Multi Crew", "MCC"
  single_pilot   — enpilottid. Rubriker: "Single Pilot", "SP"
  ifr            — IFR-tid. Rubriker: "IFR", "Instrument", "Actual Instrument", "Simulated Instrument"
  se_time        — enmotortid. Rubriker: "SE", "SEP", "Single Engine", "SE Time", "TIME_SE"
  me_time        — flermotortid. Rubriker: "ME", "MEP", "Multi Engine", "ME Time", "TIME_ME"
  solo           — solotid. Rubriker: "Solo", "Solo Time", "TIME_SOLO"
  cross_country  — distansflygningstid (XC, timmar — inte sträcka). Rubriker: "XC", "Cross Country",
                   "CrossCountry", "X-Country", "TIME_XC". OBS: en kolumn med distans (NM/km) mappas INTE hit.
  picus          — PICUS-tid (PIC under supervision). Rubriker: "PICUS", "PIC U/S", "P1 U/S", "TIME_PICUS"
  spic           — SPIC-tid (student PIC). Rubriker: "SPIC", "TIME_SPIC"
  relief_crew    — avlösningsbesättningstid. Rubriker: "Relief", "Relief Crew", "TIME_RELIEF", "Augmented"
  sim            — simulator/FSTD-tid (timvärde eller 0/1-flagga). Rubriker: "Sim", "Simulator", "FSTD",
                   "FFS", "FTD", "FNPT", "Sim Time", "Simulated", "Synthetic", "Simulatortid".
                   OBS: en rad med sim-tid > 0 är ett SIMULATORPASS — inte en riktig flygning. Då ska
                   uthållighet aldrig kontrolleras. Blanda inte ihop med "Simulated Instrument" (= ifr).
  night          — natttid. Rubriker: "Night", "Natt", "Nacht", "Night Time"
  flight_rules   — flygregler. Rubriker: "Flight Rules", "IFR/VFR", "Rule", "FPL Type". Värden normaliseras till "IFR" eller "VFR"
  landings_day   — daglandningar (heltal). Rubriker: "Day Ldg", "Day Land", "Dag ldg", "LDG Day", "TO/LDG Day", "Ldgs", "LDG", "Landings"
  landings_night — nattlandningar (heltal). Rubriker: "Night Ldg", "Natt ldg", "LDG Night", "Nldgs", "Night LDG", "Night Landings"
  takeoffs_day   — dagstarter (heltal). Rubriker: "Day Takeoffs", "TO Day", "TO_DAY", "TKO Day", "DayTakeoffs"
  takeoffs_night — nattstarter (heltal). Rubriker: "Night Takeoffs", "TO Night", "TO_NIGHT", "NightTakeoffs"
  landings_fs_day   — full stop-daglandningar (heltal). Rubriker: "DayLandingsFullStop", "FS Day Landings", "Full Stop Day"
  landings_fs_night — full stop-nattlandningar (heltal). Rubriker: "NightLandingsFullStop", "FS Night Landings", "Full Stop Night"
  app_2d         — icke-precisionsinflygningar/2D (heltal). Rubriker: "2D", "NPA", "Non-Precision".
                   En generisk "Approaches"-kolumn utan typangivelse → mappa hit och notera antagandet i warnings.
  app_3d         — precisionsinflygningar/3D (heltal). Rubriker: "3D", "ILS", "Precision", "PA"
  holds          — väntlägen (heltal). Rubriker: "Holds", "Holding", "Hold"
  remarks        — anmärkningar/fri text. Rubriker: "Remarks", "Comments", "Notes", "Anmärkningar", "Bemerkungen"

── STRATEGI ────────────────────────────────────────────────────────────────
1. Analysera VARJE kolumns faktiska datavärden i exempelraderna
2. Om rubriknamnet är oklart — låt datamönstret avgöra (t.ex. om värden ser ut som flygtider → mappa till rätt tidsfält)
3. Om samma datatyp verkar finnas i flera kolumner (t.ex. två tidkolumner) — välj den som innehåller mer data / är mer fullständig
4. En namnkolumn (med text som "Svensson, Lars") ska ALDRIG mappas till ett tidsfält

── EFLIGHTBOOK-SPECIFIKT ────────────────────────────────────────────────────
Om du identifierar formatet som eFlightbook (kolumner: FlightDate, Depart, STime, Dest, DTime, FlTime, AcReg, AcType, Ldgs, NLdgs, IFR, MaxFL, PIC, 2ndPilot, Client, Remarks):
  "PIC" med värden 0/1           → mappa till pic          (boolesk: 1 = PIC hela flygningen, 0 = copilot)
  "IFR" med värden 0/1 ELLER HH:MM → mappa till ifr       (0/1: boolesk flagga. HH:MM: faktisk tid. Mappa alltid oavsett format.)
  "Ldgs"                         → mappa till landings_day
  "NLdgs"                        → mappa till landings_night
  "FlTime" med decimaltimmar     → mappa till total_time
  "2ndPilot"                     → mappa till second_pilot
  KRITISKT: Mappa ALLTID IFR-kolumnen till ifr — aldrig till remarks eller flight_rules.

── REGLER ──────────────────────────────────────────────────────────────────
- date_format: "MM/DD/YYYY", "DD.MM.YYYY", "YYYY-MM-DD", "DD/MM/YYYY", "DD-MM-YYYY", "YYYYMMDD" (kompakt, t.ex. 20260101), "D/M/YY" eller "DD-MMM-YYYY" (01-Jan-2026)
  VIKTIGT: om någon rad har första komponenten >12 (t.ex. 25/01/2026) är formatet dag-först (DD/MM...)
- time_format: "HH:MM", "decimal" eller "mixed" — tidsvärden kan variera PER RAD ("1:35", "1.58",
  "PT1H35M", "95 min", "2h 0m"). Appen tolkar varje värde robust; ange den vanligaste stilen och
  lista ÄNDÅ alla varaktighetskolumner i time_candidates oavsett värdeformat.
- delimiter: "," ";" "|" eller "\\t"
- Utelämna kolumner som inte kan mappas till något internt fält
- Mappa ALDRIG två kolumner till samma interna fält. Finns både en 0/1-flagga och en
  varaktighetskolumn för samma sak (t.ex. AC_ISSIM och TIME_TOTALSIM) — mappa ENDAST varaktighetskolumnen.
- Om en tidkolumn är i decimal men andra är HH:MM, notera det i warnings
- Kolumner med enbart (null)/null/tomma värden — ignorera dem
- Sep=, rader i början av filen är separatordeklarationer — ignorera dem`;

export interface ImportResult {
  detectedFormat: string;
  totalRows: number;
  mappedRows: number;
  warnings: string[];
  flights: OcrFlightResult[];
  timeCandidates: { column: string; label: string }[]; // varaktighetskolumner (Block/Air/Flight) → väljare
  totalTimeColumn: string;                               // kolumn som just nu används som total_time
  columnMapping: Record<string, string>;                 // AI:ns kolumn→fält-mappning (felsökning/transparens)
  tokensUsed: number;                                    // faktisk tokenförbrukning (input+output) för AI-mappningen
}

export async function pickImportFile(): Promise<{ uri: string; name: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['text/csv', 'text/plain', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '*/*'],
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  return { uri: result.assets[0].uri, name: result.assets[0].name ?? 'import' };
}

// ── Excel-stöd ───────────────────────────────────────────────────────────────

async function readExcelAsCSV(fileUri: string): Promise<string> {
  // Läs filen som binary data (base64)
  const fileContent = await FileSystem.readAsStringAsync(fileUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  // Decode base64 till binary
  const binaryString = atob(fileContent);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Parsa Excel-filen
  const workbook = XLSX.read(bytes, { type: 'array' });

  if (!workbook.SheetNames.length) {
    throw new Error('Excel-filen innehåller inga ark.');
  }

  // Läs alla ark och kombinera data (hoppa över sammanfattningsark)
  const csvParts: string[] = [];
  let headerLine: string | null = null;

  for (const worksheetName of workbook.SheetNames) {
    // Hoppa över sammanfattningsark
    if (worksheetName.toLowerCase().includes('sammanställning') ||
        worksheetName.toLowerCase().includes('summary') ||
        worksheetName.toLowerCase().includes('totalt')) {
      continue;
    }

    const worksheet = workbook.Sheets[worksheetName];
    if (!worksheet) continue;

    // Konvertera till CSV-format
    const csv = XLSX.utils.sheet_to_csv(worksheet, {
      blankrows: false,
    });

    if (!csv.trim()) continue;

    const lines = csv.split('\n').filter(l => l.trim());
    if (lines.length < 2) continue; // Behöver minst header + 1 datarad

    // Hitta header-raden (vanligen rad 1-4 i varje sheet)
    // Nyckelord är språkberoende (Date/Datum/Fecha/Data/…) — så matcha först på
    // kända ord, annars ta första raden som ser ut som en header: flera celler
    // med text (inte tal), följd av rader med data.
    let headerIdx = -1;
    for (let i = 0; i < Math.min(lines.length, 10); i++) {
      const line = lines[i];
      if (/datum|aircraft|total|date|fecha|data\b|dato|päivä|dags|flug|vol\b|volo|voo/i.test(line)) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) {
      // Språkoberoende fallback: första raden där ≥2 celler är icke-numerisk text
      for (let i = 0; i < Math.min(lines.length, 10); i++) {
        const cells = lines[i].split(',').map((c) => c.trim()).filter(Boolean);
        const texty = cells.filter((c) => /[^\d\s.,:\-]/.test(c) && isNaN(parseFloat(c)));
        if (cells.length >= 2 && texty.length >= 2) { headerIdx = i; break; }
      }
    }

    if (headerIdx < 0) continue; // Ingen header hittad

    // Extrahera header från första sheetet
    if (!headerLine) {
      headerLine = lines[headerIdx];
      csvParts.push(headerLine);
    }

    // Lägg till datarader från detta ark (hoppa över summary- och header-raderna)
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (line && !line.match(/^\d{4}\s*,/) && !line.match(/^,*$/)) { // Hoppa över summaryrad (börjar med år)
        csvParts.push(lines[i]);
      }
    }
  }

  if (!csvParts.length) {
    throw new Error('Excel-filen innehåller ingen flygdata.');
  }

  const combinedCsv = csvParts.join('\n');
  return combinedCsv;
}

// ── CSV-parsning ─────────────────────────────────────────────────────────────

function cleanCell(v: string): string {
  const t = v.trim().replace(/^"|"$/g, '');
  // Behandla (null), NULL, null som tomma värden
  if (t === '(null)' || t.toLowerCase() === 'null') return '';
  return t;
}

function parseRow(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === delimiter && !inQuotes) {
      fields.push(cleanCell(current));
      current = '';
    } else {
      current += c;
    }
  }
  fields.push(cleanCell(current));
  return fields;
}

function convertDate(value: string, format: string): string {
  const v = value.trim();
  if (!v) return '';

  // Om det redan är i YYYY-MM-DD format, behåll det
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return v;
  }

  // Hantera YYYY/MM/DD format (från Excel)
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(v)) {
    const [y, m, d] = v.split('/');
    return `${y}-${String(parseInt(m)).padStart(2, '0')}-${String(parseInt(d)).padStart(2, '0')}`;
  }

  // Hantera Excel serial dates (numeriska värden från sheet_to_csv)
  // Excel serial dates är små heltal (typ 45000 för 2023)
  const numVal = parseFloat(v);
  if (!isNaN(numVal) && Number.isInteger(numVal) && numVal > 30000 && numVal < 100000) {
    // Excel serial date: dagar sedan 1899-12-30
    // Notering: Excel har en fel (tror 1900 är skottår) — justera för det
    const excelEpoch = new Date(1900, 0, -1); // Jan 0, 1900 = Dec 30, 1899
    const date = new Date(excelEpoch.getTime() + numVal * 24 * 60 * 60 * 1000);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // Kompakt YYYYMMDD (t.ex. "20260101" — DOF-fält utan avgränsare)
  if (/^(19|20)\d{6}$/.test(v)) {
    return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  }

  // Månadsnamn: "01-Jan-2026", "1 Jan 26", "Jan 01, 2026"
  const MONTHS: Record<string, string> = { jan:'01', feb:'02', mar:'03', apr:'04', may:'05', maj:'05', jun:'06', jul:'07', aug:'08', sep:'09', oct:'10', okt:'10', nov:'11', dec:'12' };
  const mn = v.match(/^(\d{1,2})[\s\-\/.]*([a-zA-Z]{3,})[\s\-\/.,]*(\d{2,4})$/) || v.match(/^([a-zA-Z]{3,})[\s\-\/.]*(\d{1,2})[\s\-\/.,]*(\d{2,4})$/);
  if (mn) {
    const dayFirst = /^\d/.test(v);
    const d = dayFirst ? mn[1] : mn[2];
    const monName = (dayFirst ? mn[2] : mn[1]).slice(0, 3).toLowerCase();
    const mm = MONTHS[monName];
    if (mm) return `${expandYear(mn[3])}-${mm}-${d.padStart(2, '0')}`;
  }

  // Generisk tredelad tolkning — avgränsare / . eller -
  const parts = v.split(/[\/.\-]/).map((p) => p.trim());
  if (parts.length === 3 && parts.every((p) => /^\d{1,4}$/.test(p))) {
    let [a, b, c] = parts;
    // År först (YYYY-MM-DD-varianter fångas ovan; detta tar YYYY.MM.DD m.fl.)
    if (a.length === 4) return `${a}-${b.padStart(2, '0')}-${c.padStart(2, '0')}`;
    let d: string, m: string;
    if (format === 'MM/DD/YYYY') { m = a; d = b; } else { d = a; m = b; } // DD/MM, DD.MM, DD-MM
    // Säkerhetsnät: om "månaden" är >12 men "dagen" ≤12 har AI:n gissat fel ordning — byt
    if (parseInt(m) > 12 && parseInt(d) <= 12) { const t = m; m = d; d = t; }
    return `${expandYear(c)}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  return v; // otolkbart — behåll rådata så sanity-kontrollen kan flagga
}

// 2-siffrigt år → 20xx (>=70 → 19xx, för gamla loggböcker)
function expandYear(y: string): string {
  if (y.length === 4) return y;
  const n = parseInt(y);
  return String(n >= 70 ? 1900 + n : 2000 + n);
}

function convertTime(value: string, _format: string): string {
  const v = value.trim();
  if (!v || v === '0' || v === '0.0' || v === '0:00' || v === '0,0') return '0';
  // Säkerhetsnät: om värdet ser ut som ett namn (bokstäver utan siffror) → 0
  if (/[a-zA-ZåäöÅÄÖ]/.test(v) && !/\d/.test(v)) return '0';

  const round2 = (h: number) => String(Math.round(h * 100) / 100);

  // ISO 8601-duration: "PT1H35M", "PT45M", "PT2H" (export från vissa system)
  const iso = v.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i);
  if (iso) return round2((parseInt(iso[1] ?? '0')) + (parseInt(iso[2] ?? '0')) / 60 + (parseInt(iso[3] ?? '0')) / 3600);

  // "95 min", "95min", "95 m" → minuter
  const mins = v.match(/^(\d+(?:[.,]\d+)?)\s*m(?:in(?:utes|s)?)?\.?$/i);
  if (mins) return round2(parseFloat(mins[1].replace(',', '.')) / 60);

  // "2h 0m", "1 h 35 min", "2h" → timmar + minuter
  const hm = v.match(/^(\d+(?:[.,]\d+)?)\s*h(?:rs?|ours?)?\.?(?:\s*(\d+)\s*m(?:in(?:utes|s)?)?\.?)?$/i);
  if (hm) return round2(parseFloat(hm[1].replace(',', '.')) + (parseInt(hm[2] ?? '0')) / 60);

  // HH:MM eller HH:MM:SS — oavsett vad Claude angav som format
  if (v.includes(':')) {
    const [h, m, s] = v.split(':').map(Number);
    if (!isNaN(h)) return round2(h + (m || 0) / 60 + (s || 0) / 3600);
  }
  // Rent heltal 25–1440 → minuter (t.ex. mccPILOTLOG "95" — ett pass är aldrig 95 timmar)
  if (/^\d+$/.test(v)) {
    const n = parseInt(v);
    if (n > 24 && n <= 1440) return round2(n / 60);
  }
  // Hantera komma som decimalseparator (t.ex. "1,5" → 1.5)
  if (v.includes(',') && !v.includes('.')) return v.replace(',', '.');
  return v;
}

function convertInt(value: string): string {
  const v = value.trim();
  if (!v) return '0';
  const n = parseFloat(v);
  return isNaN(n) ? '0' : String(Math.round(n));
}

// Fält som ska konverteras som flygtid (decimal/HH:MM)
const TIME_FIELDS = new Set(['total_time','ifr','night','pic','co_pilot','dual','instructor','multi_pilot','single_pilot','sim','se_time','me_time','solo','cross_country','picus','spic','relief_crew']);
const INT_FIELDS  = new Set(['landings_day','landings_night','takeoffs_day','takeoffs_night','landings_fs_day','landings_fs_night','app_2d','app_3d','holds']);

function normalize(s: string): string {
  return s.trim().toLowerCase().replace(/[\s_\-\.]/g, '');
}

function findValue(normIndex: Record<string, string>, csvCol: string): string {
  const key = normalize(csvCol);
  // Exakt match (normaliserat)
  if (key in normIndex) return normIndex[key];
  // Partiell match — CSV-header innehåller sökt nyckel eller tvärtom
  for (const [k, v] of Object.entries(normIndex)) {
    if (k.includes(key) || key.includes(k)) return v;
  }
  return '';
}

// Kolumner som alltid ignoreras (metadata/systeminformation utan flygvärde)
const SKIP_COLUMNS = new Set([
  'id', 'uuid', 'guid', 'rowid', 'created', 'modified', 'updated',
  'createdat', 'updatedat', 'modifiedat', 'timestamp', 'version',
  'sep', 'separator',
]);

function mapRow(
  fields: string[],
  headers: string[],
  colMap: Record<string, string>,
  dateFormat: string,
  timeFormat: string,
  booleanFields: Set<string>,  // tidsfält vars källkolumn enbart har 0/1 → booleska flaggor
  timeCandidateCols: string[]  // varaktighetskolumner (rubriker) → timmar per rad i timeOptions
): OcrFlightResult | null {
  // Bygg normaliserat index: normalize(header) → värde
  const normIndex: Record<string, string> = {};
  headers.forEach((h, i) => {
    normIndex[normalize(h)] = fields[i] ?? '';
  });

  const out: any = {
    date: '', aircraft_type: '', registration: '',
    dep_place: '', dep_utc: '', arr_place: '', arr_utc: '',
    total_time: '0', ifr: '0', night: '0', sim: '0',
    pic: '0', co_pilot: '0', dual: '0',
    instructor: '0', multi_pilot: '0', single_pilot: '0',
    se_time: '0', me_time: '0', solo: '0', cross_country: '0',
    picus: '0', spic: '0', relief_crew: '0',
    landings_day: '0', landings_night: '0',
    takeoffs_day: '0', takeoffs_night: '0',
    landings_fs_day: '0', landings_fs_night: '0',
    app_2d: '0', app_3d: '0', holds: '0', remarks: '',
    second_pilot: '', flight_rules: 'VFR',
    needs_review: false, review_reason: undefined,
  };

  // Spåra vilka CSV-kolumner och interna fält som mappas
  const mappedCsvCols = new Set<string>();
  const mappedInternalFields = new Set<string>();

  for (const [csvCol, internalField] of Object.entries(colMap)) {
    mappedCsvCols.add(normalize(csvCol));
    mappedInternalFields.add(internalField);
    const val = findValue(normIndex, csvCol);
    if (internalField === 'date') {
      out.date = convertDate(val, dateFormat);
    } else if (TIME_FIELDS.has(internalField)) {
      out[internalField] = convertTime(val, timeFormat);
    } else if (INT_FIELDS.has(internalField)) {
      out[internalField] = convertInt(val);
    } else if (internalField === 'dep_place' || internalField === 'arr_place') {
      out[internalField] = val.toUpperCase().trim();
    } else if (internalField === 'flight_rules') {
      const fr = val.trim().toUpperCase();
      // Stöd för booleska flaggor: '1' = IFR, '0' = VFR
      if (fr === '1') out.flight_rules = 'IFR';
      else if (fr === '0') out.flight_rules = 'VFR';
      else out.flight_rules = fr.includes('IFR') ? 'IFR' : 'VFR';
    } else {
      out[internalField] = val;
    }
  }

  // ── Varaktighet per tids-kandidatkolumn (för total_time-väljaren på import-sidan) ──────────
  if (timeCandidateCols.length > 0) {
    out.timeOptions = {};
    for (const col of timeCandidateCols) {
      out.timeOptions[col] = convertTime(findValue(normIndex, col), timeFormat);
    }
  }

  // ── Omappade kolumner → räddningsförsök + remarks ───────────────────────
  // Kolumner Claude missade mappas ändå om namn matchar kända tidsfält.
  const RESCUE_MAP: Record<string, string> = {
    ifr: 'ifr', ifrtime: 'ifr', instrument: 'ifr',
    night: 'night', nighttime: 'night', natt: 'night',
    nvg: 'nvg',
    sim: 'sim', simulator: 'sim', fstd: 'sim', ffs: 'sim', ftd: 'sim', fnpt: 'sim', simtime: 'sim',
    pic: 'pic', p1: 'pic',
    copilot: 'co_pilot', sic: 'co_pilot', p2: 'co_pilot',
    dual: 'dual', dualreceived: 'dual',
    instructor: 'instructor', dualgiven: 'instructor',
    multipilot: 'multi_pilot', mp: 'multi_pilot',
    singlepilot: 'single_pilot', sp: 'single_pilot',
  };

  // Räddning för textfält som Claude kan missa
  const TEXT_RESCUE_MAP: Record<string, string> = {
    secondpilot: 'second_pilot', '2ndpilot': 'second_pilot',
    copilotname: 'second_pilot', sicname: 'second_pilot',
    p2name: 'second_pilot', p2pilot: 'second_pilot',
    andrepilot: 'second_pilot', crew: 'second_pilot',
    secondpilotname: 'second_pilot', crewname: 'second_pilot',
  };

  const extraParts: string[] = [];
  headers.forEach((header, i) => {
    const normHeader = normalize(header);
    if (mappedCsvCols.has(normHeader)) return;
    if (SKIP_COLUMNS.has(normHeader)) return;
    const val = (fields[i] ?? '').trim();
    if (!val || val === '(null)' || val.toLowerCase() === 'null' || val === '0' || val === '0.0') return;

    // Försök rädda känt tidsfält som Claude missade
    const rescued = RESCUE_MAP[normHeader];
    if (rescued && TIME_FIELDS.has(rescued)) {
      out[rescued] = convertTime(val, 'decimal');
      return;
    }

    // Försök rädda textfält (t.ex. second_pilot) som Claude missade
    const rescuedText = TEXT_RESCUE_MAP[normHeader];
    if (rescuedText) {
      if (!out[rescuedText]) out[rescuedText] = val; // behåll befintligt värde om redan satt
      return;
    }

    extraParts.push(`${header}: ${val}`);
  });

  if (extraParts.length > 0) {
    const extra = extraParts.join(' | ');
    out.remarks = out.remarks ? `${out.remarks} | ${extra}` : extra;
  }

  const totalParsed = parseFloat(out.total_time);

  // ── Simulator/FSTD: sim-tid > 0 → hela raden är ett simulatorpass ──────────────────────────
  // Explicit sim-fält är auktoritativt → flight_type='sim' sätts här (ingen endurance-koll behövs).
  if (booleanFields.has('sim') && (parseFloat(out.sim) || 0) >= 1) out.sim = out.total_time; // boolesk sim-flagga
  const simParsed = parseFloat(out.sim) || 0;
  const isSim = simParsed > 0;
  if (isSim) {
    out.flight_type = 'sim';
    if (!(totalParsed > 0)) out.total_time = out.sim; // sim-tid som total_time → FSTD-kolumnen fylls
  }

  // ── Booleska flaggKOLUMNER: hela kolumnen är 0/1 → 1 betyder hela passet i den rollen ────────
  // Kolumn-baserat (bestämt över ALLA rader): en kolumn med decimaltimmar behandlas ALDRIG som
  // boolean, även om en enskild cell råkar vara "1". Så en äkta 1.0h blåses inte upp till total_time.
  for (const field of booleanFields) {
    if (field === 'sim') continue; // hanteras ovan
    const v = parseFloat(out[field]) || 0;
    out[field] = v >= 1 ? out.total_time : '0';
    if (field === 'ifr' && v >= 1) out.flight_rules = 'IFR';
  }

  // ── Härledd IFR-tid från flight_rules ─────────────────────────────────────
  // Om Claude mappade IFR-kolumnen till flight_rules istället för ifr,
  // eller om formatet bara har en flight_rules-kolumn utan separat IFR-tid.
  if ((parseFloat(out.ifr) || 0) === 0 && out.flight_rules === 'IFR' && totalParsed > 0) {
    out.ifr = out.total_time;
  }

  // (Natttid härleds INTE längre från nattlandningar — natt kommer ENBART från filens night-fält.)

  // ── Standard-roll: co-pilot om PIC inte är angett (ej för simulatorpass) ──────────────────
  const picVal = parseFloat(out.pic) || 0;
  const copVal = parseFloat(out.co_pilot) || 0;
  if (picVal === 0 && copVal === 0 && totalParsed > 0 && !isSim) {
    out.co_pilot = out.total_time;
  }

  // Hoppa bara över rader som saknar datum, flygtid OCH flygplatser (behåll simulatorpass)
  // Ett otolkbart "datum" (t.ex. typ-radens "Boolean"/"Text") räknas som saknat.
  const hasValidDate = !!out.date && /^\d{4}-\d{2}-\d{2}$/.test(out.date);
  if (!hasValidDate && !out.dep_place && !out.arr_place && (isNaN(totalParsed) || totalParsed === 0) && !isSim) return null;

  return out as OcrFlightResult;
}

// ── Teckenkodning ─────────────────────────────────────────────────────────────
// Läs textfil robust: prova UTF-8, fall annars tillbaka på Windows-1252/Latin-1 (vanligt i
// eFlightbook/Excel-exporter) så svenska å/ä/ö i remarks/namn inte blir mojibake ("LÃ¥g…").
const WIN1252_HIGH: Record<number, number> = {
  0x80: 0x20AC, 0x82: 0x201A, 0x83: 0x0192, 0x84: 0x201E, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
  0x88: 0x02C6, 0x89: 0x2030, 0x8A: 0x0160, 0x8B: 0x2039, 0x8C: 0x0152, 0x8E: 0x017D,
  0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201C, 0x94: 0x201D, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014,
  0x98: 0x02DC, 0x99: 0x2122, 0x9A: 0x0161, 0x9B: 0x203A, 0x9C: 0x0153, 0x9E: 0x017E, 0x9F: 0x0178,
};

function tryDecodeUtf8(bytes: Uint8Array): string | null {
  let s = '', i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b < 0x80) { s += String.fromCharCode(b); i++; continue; }
    let cp: number, n: number;
    if ((b & 0xE0) === 0xC0) { cp = b & 0x1F; n = 1; }
    else if ((b & 0xF0) === 0xE0) { cp = b & 0x0F; n = 2; }
    else if ((b & 0xF8) === 0xF0) { cp = b & 0x07; n = 3; }
    else return null;
    if (i + n >= bytes.length) return null;
    for (let k = 1; k <= n; k++) { const c = bytes[i + k]; if ((c & 0xC0) !== 0x80) return null; cp = (cp << 6) | (c & 0x3F); }
    if (cp > 0xFFFF) { cp -= 0x10000; s += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF)); }
    else s += String.fromCharCode(cp);
    i += n + 1;
  }
  return s;
}

async function readTextSmart(fileUri: string): Promise<string> {
  const b64 = await FileSystem.readAsStringAsync(fileUri, { encoding: FileSystem.EncodingType.Base64 });
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const utf8 = tryDecodeUtf8(bytes);
  if (utf8 !== null) return utf8;                 // giltig UTF-8
  // Fallback: Windows-1252/Latin-1 (svenska tecken korrekta, plus vanliga symboler)
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b >= 0x80 && b <= 0x9F ? (WIN1252_HIGH[b] ?? b) : b);
  return s;
}

// ── Huvud-export ─────────────────────────────────────────────────────────────

export async function importFromFile(
  fileUri: string,
  onProgress?: (current: number, total: number) => void
): Promise<ImportResult> {
  onProgress?.(0, 3);

  // Detektera filtyp
  const isExcel = fileUri.toLowerCase().endsWith('.xlsx') || fileUri.toLowerCase().endsWith('.xls');

  let content: string;
  try {
    if (isExcel) {
      content = await readExcelAsCSV(fileUri);
    } else {
      content = await readTextSmart(fileUri); // UTF-8 med Windows-1252/Latin-1-fallback (svenska tecken)
    }
  } catch (e: any) {
    throw new Error(`Kunde inte läsa filen: ${e.message}`);
  }

  if (!content?.trim()) {
    throw new Error('Filen verkar vara tom. Kontrollera att det är en giltig CSV- eller Excel-fil.');
  }

  // Normalisera radslut och rensa BOM
  const normalized = content
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

  const allLines = normalized.split('\n');

  // Hitta första riktiga headerraden — hoppa över Sep=, tomma rader, etc.
  let headerIndex = 0;
  for (let i = 0; i < Math.min(allLines.length, 5); i++) {
    const l = allLines[i].trim();
    if (!l || /^sep=/i.test(l) || /^#/.test(l)) continue;
    headerIndex = i;
    break;
  }

  // Filtrera bort tomma datarader (men behåll headern)
  const lines = [
    allLines[headerIndex],
    ...allLines.slice(headerIndex + 1).filter(l => l.trim().length > 0),
  ];

  if (lines.length < 2) {
    throw new Error('Filen saknar datarader (endast header hittades).');
  }

  onProgress?.(1, 3);

  // Skicka header + 15 exempelrader till Claude för mappning (fler rader = bättre datamönsterigenkänning)
  // ForeFlight-stil: "Flights Table" kan ligga långt ner (efter Aircraft Table) —
  // förläng samplet så AI:n ser flygtabellens header + några datarader.
  const tableIdx = lines.findIndex((l) => /flights table/i.test(l));
  const sampleLen = tableIdx >= 0 ? Math.min(Math.max(16, tableIdx + 12), 48) : 16;
  const sample = lines.slice(0, sampleLen).join('\n');

  // Faktisk tokenförbrukning för mappningsanropet — visas i förhandsvisningen
  let tokensUsed = 0;
  const mapping = await callAnthropicJson<any>({
    system: MAPPING_PROMPT,
    maxTokens: 2048,
    timeoutMs: 90000, // mappningen genererar mycket JSON — ge gott om tid på långsamma nät
    onUsage: (u) => { tokensUsed = u.inputTokens + u.outputTokens; },
    userContent: `Identifiera format och kolumnmappning:\n\n${sample}`,
  });

  const delimiter: string = mapping.delimiter ?? ',';
  const dateFormat: string = mapping.date_format ?? 'YYYY-MM-DD';
  const timeFormat: string = mapping.time_format ?? 'decimal';
  const colMap: Record<string, string> = mapping.column_mapping ?? {};
  const detectedFormat: string = mapping.detected_format ?? 'Unknown';
  const warnings: string[] = mapping.warnings ?? [];

  if (Object.keys(colMap).length === 0) {
    throw new Error(`Kunde inte mappa kolumner för format "${detectedFormat}". Kontrollera att filen exporterades korrekt.`);
  }

  onProgress?.(2, 3);

  // ── Hitta riktiga header-raden ────────────────────────────────────────────
  // Preamble-rader ("Pilot Log Export") och två-tabellformat (ForeFlight: Aircraft
  // Table + Flights Table) gör att rad 0 inte alltid är kolumnheadern. AI:ns
  // header_row-hint verifieras mot column_mapping-nycklarna; annars skannas raderna
  // efter den som innehåller flest av de mappade kolumnnamnen.
  const colKeys = Object.keys(colMap).map(normalize);
  const rowMatchScore = (line: string) => {
    const cells = parseRow(line, delimiter).map(normalize);
    return colKeys.filter((k) => cells.includes(k)).length;
  };
  // Välj raden med FLEST träffar — ForeFlight har en typ-rad ("Date, Text, HH:MM…")
  // före riktiga headern som annars kan vinna på en enda träff. AI:ns hint vinner
  // bara vid minst lika bra poäng som skanningens bästa.
  let headerRowIdx = 0;
  let bestScore = 0;
  for (let i = 0; i < Math.min(lines.length - 1, 48); i++) {
    const s = rowMatchScore(lines[i]);
    if (s > bestScore) { headerRowIdx = i; bestScore = s; }
  }
  const hinted = Number.isInteger(mapping.header_row) ? (mapping.header_row as number) : -1;
  if (hinted >= 0 && hinted < lines.length - 1 && bestScore > 0 && rowMatchScore(lines[hinted]) >= bestScore) {
    headerRowIdx = hinted;
  }

  // Tolka alla rader lokalt — inga fler API-anrop
  const headers = parseRow(lines[headerRowIdx], delimiter);
  const dataRows = lines.slice(headerRowIdx + 1).map((line) => parseRow(line, delimiter));

  // ── Tids-kandidatkolumner (Block/Air/Flight) → total_time-väljare ───────────────────────────
  // Bara kandidater som faktiskt finns i headern behålls. Nuvarande total_time-kolumn = den som
  // Claude mappade till total_time (annars första kandidaten).
  const headerNorms = new Set(headers.map(normalize));
  const rawCandidates: { column: string; label: string }[] = Array.isArray(mapping.time_candidates) ? mapping.time_candidates : [];
  const seenCand = new Set<string>();
  const timeCandidates = rawCandidates
    .filter((c) => c && typeof c.column === 'string' && headerNorms.has(normalize(c.column)) && !seenCand.has(normalize(c.column)) && seenCand.add(normalize(c.column)))
    .map((c) => ({ column: c.column, label: String(c.label ?? c.column) }));
  let totalTimeColumn = Object.entries(colMap).find(([, f]) => f === 'total_time')?.[0] ?? timeCandidates[0]?.column ?? '';
  const timeCandidateCols = timeCandidates.map((c) => c.column);

  // ── Kolumn-baserad boolean-detektering ──────────────────────────────────────
  // Ett tidsfält vars källkolumn ENBART innehåller 0/1 (över alla rader) är en boolesk flagga
  // (1 = hela passet i den rollen). En kolumn med minst ett decimalvärde är faktiska timmar.
  const colIndexOf = (csvCol: string) => headers.findIndex((h) => normalize(h) === normalize(csvCol));

  // ── Dubblettmappningar: flera kolumner → samma interna fält ────────────────
  // (t.ex. AC_ISSIM 0/1-flagga + TIME_TOTALSIM varaktighet → båda "sim"). Behåll
  // kolumnen med informativa värden — annars förgiftar flaggkolumnen boolean-
  // detekteringen nedan och nollar riktiga tider.
  {
    const byField = new Map<string, string[]>();
    for (const [csvCol, field] of Object.entries(colMap)) {
      if (!byField.has(field)) byField.set(field, []);
      byField.get(field)!.push(csvCol);
    }
    for (const cols of byField.values()) {
      if (cols.length < 2) continue;
      // Rikedom = antal rader med annat än ''/0/1 (riktiga tider/texter)
      const richness = (csvCol: string) => {
        const idx = colIndexOf(csvCol);
        if (idx < 0) return -1;
        let n = 0;
        for (const row of dataRows) {
          const v = (row[idx] ?? '').trim();
          if (v && v !== '0' && v !== '1') n++;
        }
        return n;
      };
      let keep = cols[cols.length - 1];
      let best = -1;
      for (const c of cols) { const s = richness(c); if (s >= best) { keep = c; best = s; } }
      for (const c of cols) if (c !== keep) delete colMap[c];
    }
  }

  const booleanFields = new Set<string>();
  for (const [csvCol, field] of Object.entries(colMap)) {
    if (!TIME_FIELDS.has(field) || field === 'total_time') continue;
    const idx = colIndexOf(csvCol);
    if (idx < 0) continue;
    let sawAny = false, allBool = true;
    for (const row of dataRows) {
      const raw = (row[idx] ?? '').trim();
      if (!raw || raw === '(null)' || raw.toLowerCase() === 'null') continue;
      sawAny = true;
      if (raw !== '0' && raw !== '1') { allBool = false; break; }
    }
    if (sawAny && allBool) booleanFields.add(field);
  }

  const flights: OcrFlightResult[] = [];
  for (const fields of dataRows) {
    const flight = mapRow(fields, headers, colMap, dateFormat, timeFormat, booleanFields, timeCandidateCols);
    if (flight) flights.push(flight);
  }

  if (flights.length === 0 && dataRows.length > 0) {
    throw new Error(`No flights could be read (${dataRows.length} rows scanned). The file may use an unsupported layout — try exporting as standard CSV.`);
  }

  // ── Deterministiskt kolumnval: byt bort en (mest) tom totaltidskolumn ──────
  // AI:n väljer ibland en varaktighetskolumn som är tom i filen (t.ex. lufttid när
  // bara blocktid är ifylld). Välj kandidaten med FLEST ifyllda värden i stället.
  if (timeCandidates.length > 1) {
    const nonZeroCount = (col: string) =>
      flights.filter((f) => (parseFloat(f.timeOptions?.[col] ?? '0') || 0) > 0).length;
    let best = totalTimeColumn;
    let bestCount = totalTimeColumn ? nonZeroCount(totalTimeColumn) : 0;
    for (const c of timeCandidates) {
      const n = nonZeroCount(c.column);
      if (n > bestCount) { best = c.column; bestCount = n; }
    }
    if (best && best !== totalTimeColumn) {
      warnings.push(`Column "${totalTimeColumn}" is mostly empty — using "${best}" as total time instead.`);
      totalTimeColumn = best;
      for (const flight of flights) {
        const v = flight.timeOptions?.[best];
        if (v && (parseFloat(v) || 0) > 0) flight.total_time = v;
      }
    }
  }

  // ── Säkerhetsnät: total_time = 0 men vald varaktighetskolumn har värde ─────
  // AI:n listar ibland kolumnen bara i time_candidates utan att mappa den till
  // total_time i column_mapping (t.ex. CrewLounge TIME_TOTAL) — applicera den då.
  for (const flight of flights) {
    if ((parseFloat(flight.total_time ?? '0') || 0) > 0) continue;
    const v = totalTimeColumn ? flight.timeOptions?.[totalTimeColumn] : undefined;
    if (v && (parseFloat(v) || 0) > 0) { flight.total_time = v; continue; }
    // Simulatorpass utan blocktid (t.ex. CrewLounge TIME_TOTALSIM): sim-tiden ÄR passets tid
    const simH = parseFloat(flight.sim ?? '0') || 0;
    if (simH > 0) flight.total_time = String(simH);
  }

  // ── Rolltid får inte överstiga totaltiden ──────────────────────────────────
  // Smutsig exportdata (t.ex. PIC 1:00 på en 0:45-flygning) klampas till totalen
  // så loggbokens summeringar aldrig blåses upp. Flaggas i warnings.
  let clampedRows = 0;
  for (const flight of flights) {
    const tt = parseFloat(flight.total_time ?? '0') || 0;
    if (tt <= 0) continue;
    let clamped = false;
    for (const f of ['pic', 'co_pilot', 'dual', 'night', 'ifr', 'instructor', 'solo', 'cross_country', 'picus', 'se_time', 'me_time'] as const) {
      const v = parseFloat(flight[f] ?? '0') || 0;
      if (v > tt + 0.02) { flight[f] = String(tt); clamped = true; }
    }
    if (clamped) clampedRows++;
  }
  if (clampedRows > 0) {
    warnings.push(`${clampedRows} row(s) had role time (PIC/night/IFR…) exceeding total time — capped to total.`);
  }

  // Auto-calculate multi_pilot if not provided in CSV
  for (const flight of flights) {
    if (!flight.multi_pilot || parseFloat(flight.multi_pilot ?? '0') === 0) {
      const totalTime = parseFloat(flight.total_time ?? '0') || 0;
      const picTime = parseFloat(flight.pic ?? '0') || 0;
      const copilotTime = parseFloat(flight.co_pilot ?? '0') || 0;
      const dualTime = parseFloat(flight.dual ?? '0') || 0;
      const instrTime = parseFloat(flight.instructor ?? '0') || 0;
      const hasSecondPilot = !!(flight.second_pilot);

      if (dualTime > 0) {
        flight.multi_pilot = '0';
      } else if (copilotTime > 0) {
        // Co-pilot time = multi-pilot flight
        flight.multi_pilot = String(totalTime);
      } else if (picTime > 0 && hasSecondPilot) {
        // PIC with another pilot = multi-pilot flight
        flight.multi_pilot = String(totalTime);
      } else if (instrTime > 0) {
        // Instruction flight = multi-pilot
        flight.multi_pilot = String(totalTime);
      }
    }
  }

  onProgress?.(3, 3);

  // ── Debug-loggar ────────────────────────────────────────────────────────────
  console.log('');
  console.log('═'.repeat(80));
  console.log('📊 IMPORT DEBUG INFO');
  console.log('═'.repeat(80));
  console.log('');
  console.log(`📋 Detected Format: ${detectedFormat}`);
  console.log(`📄 File Type: ${isExcel ? 'Excel (.xlsx/.xls)' : 'CSV/TXT'}`);
  console.log('');
  console.log('🔍 Headers Detected:');
  headers.forEach((h, i) => {
    console.log(`  [${i}] ${h}`);
  });
  console.log('');
  console.log('🔗 Column Mapping:');
  Object.entries(colMap).forEach(([csvCol, internalField]) => {
    const headerIdx = headers.indexOf(csvCol);
    console.log(`  "${csvCol}" → ${internalField}${headerIdx >= 0 ? ` (column ${headerIdx})` : ''}`);
  });
  console.log('');
  console.log(`📈 Data Summary:`);
  console.log(`  Total Rows: ${dataRows.length}`);
  console.log(`  Mapped Rows: ${flights.length}`);
  console.log(`  Success Rate: ${dataRows.length > 0 ? ((flights.length / dataRows.length) * 100).toFixed(1) : 0}%`);
  if (warnings.length > 0) {
    console.log(`  Warnings: ${warnings.length}`);
    warnings.forEach((w) => {
      console.log(`    ⚠️  ${w}`);
    });
  }
  console.log('');
  console.log('📋 Sample flights (first 3):');
  flights.slice(0, 3).forEach((f, i) => {
    console.log(`  Flight ${i + 1}:`);
    console.log(`    Date: ${f.date} | Aircraft: ${f.aircraft_type} | Total: ${f.total_time}h`);
    console.log(`    Route: ${f.dep_place || '(empty)'} → ${f.arr_place || '(empty)'}`);
    console.log(`    Status: ${f.flight_type || 'normal'} | Rules: ${f.flight_rules || 'VFR'}`);
  });
  console.log('');
  console.log('═'.repeat(80));
  console.log('');

  return {
    detectedFormat,
    totalRows: dataRows.length,
    mappedRows: flights.length,
    warnings,
    flights,
    timeCandidates,
    totalTimeColumn,
    columnMapping: colMap,
    tokensUsed,
  };
}

// ── AI-sammanfattning av importen ────────────────────────────────────────────
// Kort fritext (engelska) till användaren om vad AI:n kom fram till: format,
// mappning, antaganden, konstigheter. Körs EFTER lokal tolkning (eller efter
// ett importfel) så statistiken kan skickas med. Litet, billigt anrop.
const SUMMARY_PROMPT = `Du är importassistenten i en pilotloggboksapp. Användaren har just importerat (eller försökt importera) en loggboksfil, och appens AI har analyserat den. Skriv en kort sammanfattning PÅ ENGELSKA (3–6 meningar, ett stycke, ingen markdown, ingen hälsningsfras) direkt till användaren om vad analysen kom fram till.

Ta med det som är relevant av: vilket format/vilken app filen ser ut att komma från, vad som mappades och tolkades, antaganden som gjorts (t.ex. valt tidskolumn, tolkade booleska flaggor, klampade tider), och sådant som ser konstigt ut eller kräver användarens uppmärksamhet. Om importen misslyckades: förklara sakligt vad som troligen är fel med filen och hur användaren kan åtgärda det (t.ex. exportera som standard-CSV).

Var konkret och lugn — syftet är att användaren ska förstå och lita på vad som hänt. Hitta inte på siffror; använd bara det som skickas in.`;

export interface ImportSummaryInput {
  fileName: string;
  detectedFormat?: string;
  totalRows?: number;
  parsedFlights?: number;
  totalHours?: number;
  dateRange?: string;
  aircraft?: string[];
  airports?: string[];
  pilots?: string[];
  timeCandidates?: { column: string; label: string }[];
  totalTimeColumn?: string;
  warnings?: string[];
  error?: string; // satt när importen kastade fel — då beskrivs problemet i stället
}

export async function generateImportSummary(input: ImportSummaryInput): Promise<string> {
  const res = await callAnthropicRaw({
    system: SUMMARY_PROMPT,
    maxTokens: 350,
    timeoutMs: 60000,
    userContent: `Analysresultat (JSON):\n${JSON.stringify(input)}`,
  });
  return res.text.trim();
}
