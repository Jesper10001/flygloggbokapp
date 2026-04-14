import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import type { OcrFlightResult } from '../types/flight';

const API_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '';

// Claude identifierar bara mappningen — appen tolkar alla rader lokalt
const MAPPING_PROMPT = `Du är expert på flygloggboksformat (ForeFlight, LogTen Pro, MyFlightbook, mccPILOTLOG, APDL, Logbook Pro, Eflightbook, generisk CSV).

Analysera headern OCH exempelraderna noggrant. Använd BÅDE kolumnnamnet OCH datamönstret i varje kolumn för att avgöra vad kolumnen innehåller. Returnera ENBART JSON:
{
  "detected_format": "ForeFlight",
  "delimiter": ",",
  "date_format": "MM/DD/YYYY",
  "time_format": "HH:MM",
  "column_mapping": {
    "ExaktKolumnNamnFrånCSV": "internt_fält"
  },
  "warnings": []
}

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
  single_pilot   — enpilottid. Rubriker: "Single Pilot", "SP", "Single Engine"
  ifr            — IFR-tid. Rubriker: "IFR", "Instrument", "Actual Instrument", "Simulated Instrument"
  night          — natttid. Rubriker: "Night", "Natt", "Nacht", "Night Time"
  flight_rules   — flygregler. Rubriker: "Flight Rules", "IFR/VFR", "Rule", "FPL Type". Värden normaliseras till "IFR" eller "VFR"
  landings_day   — daglandningar (heltal). Rubriker: "Day Ldg", "Day Land", "Dag ldg", "LDG Day", "TO/LDG Day", "Ldgs", "LDG", "Landings"
  landings_night — nattlandningar (heltal). Rubriker: "Night Ldg", "Natt ldg", "LDG Night", "Nldgs", "Night LDG", "Night Landings"
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
- date_format: "MM/DD/YYYY", "DD.MM.YYYY", "YYYY-MM-DD", eller "DD/MM/YYYY"
- time_format: "HH:MM" eller "decimal"
- delimiter: "," ";" eller "\\t"
- Utelämna kolumner som inte kan mappas till något internt fält
- Om en tidkolumn är i decimal men andra är HH:MM, notera det i warnings
- Kolumner med enbart (null)/null/tomma värden — ignorera dem
- Sep=, rader i början av filen är separatordeklarationer — ignorera dem`;

export interface ImportResult {
  detectedFormat: string;
  totalRows: number;
  mappedRows: number;
  warnings: string[];
  flights: OcrFlightResult[];
}

export async function pickImportFile(): Promise<{ uri: string; name: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['text/csv', 'text/plain', 'application/vnd.ms-excel', '*/*'],
    copyToCacheDirectory: true,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  return { uri: result.assets[0].uri, name: result.assets[0].name ?? 'import' };
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
  try {
    if (format === 'MM/DD/YYYY') {
      const [m, d, y] = v.split('/');
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    if (format === 'DD/MM/YYYY') {
      const [d, m, y] = v.split('/');
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    if (format === 'DD.MM.YYYY') {
      const [d, m, y] = v.split('.');
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
  } catch {
    return v;
  }
  return v; // YYYY-MM-DD — behålls som det är
}

function convertTime(value: string, _format: string): string {
  const v = value.trim();
  if (!v || v === '0' || v === '0.0' || v === '0:00' || v === '0,0') return '0';
  // Säkerhetsnät: om värdet ser ut som ett namn (bokstäver utan siffror) → 0
  if (/[a-zA-ZåäöÅÄÖ]/.test(v) && !/\d/.test(v)) return '0';
  // Auto-detektera HH:MM oavsett vad Claude angav som format
  if (v.includes(':')) {
    const [h, m] = v.split(':').map(Number);
    if (!isNaN(h)) return String(Math.round((h + (m || 0) / 60) * 100) / 100);
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
const TIME_FIELDS = new Set(['total_time','ifr','night','pic','co_pilot','dual','instructor','multi_pilot','single_pilot']);
const INT_FIELDS  = new Set(['landings_day','landings_night']);

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
  timeFormat: string
): OcrFlightResult | null {
  // Bygg normaliserat index: normalize(header) → värde
  const normIndex: Record<string, string> = {};
  headers.forEach((h, i) => {
    normIndex[normalize(h)] = fields[i] ?? '';
  });

  const out: any = {
    date: '', aircraft_type: '', registration: '',
    dep_place: '', dep_utc: '', arr_place: '', arr_utc: '',
    total_time: '0', ifr: '0', night: '0',
    pic: '0', co_pilot: '0', dual: '0',
    instructor: '0', multi_pilot: '0', single_pilot: '0',
    landings_day: '0', landings_night: '0', remarks: '',
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

  // ── Omappade kolumner → räddningsförsök + remarks ───────────────────────
  // Kolumner Claude missade mappas ändå om namn matchar kända tidsfält.
  const RESCUE_MAP: Record<string, string> = {
    ifr: 'ifr', ifrtime: 'ifr', instrument: 'ifr',
    night: 'night', nighttime: 'night', natt: 'night',
    nvg: 'nvg',
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

  // ── Booleska flaggfält: 1 = hela passet i denna roll, 0 = inte alls ────────
  // Gäller fält som Claude mappade som boolean (0 eller 1, ej HH:MM-konverterat).
  // IFR behandlas separat eftersom eFlightbook har faktiska tider (ej boolean).
  if (out.pic === '1') out.pic = out.total_time;
  if (out.co_pilot === '1') out.co_pilot = out.total_time;
  if (out.dual === '1') out.dual = out.total_time;
  if (out.night === '1') out.night = out.total_time;
  // IFR boolean: värde '1' = hela passet flögs IFR → ifr = total_time.
  // (eFlightbook och liknande exporterar IFR som 0/1-flagga, inte timmar)
  if (out.ifr === '1') {
    out.ifr = out.total_time;
    out.flight_rules = 'IFR';
  }

  // ── Härledd IFR-tid från flight_rules ─────────────────────────────────────
  // Om Claude mappade IFR-kolumnen till flight_rules istället för ifr,
  // eller om formatet bara har en flight_rules-kolumn utan separat IFR-tid.
  if ((parseFloat(out.ifr) || 0) === 0 && out.flight_rules === 'IFR' && totalParsed > 0) {
    out.ifr = out.total_time;
  }

  // ── Natttid från nattlandningar ───────────────────────────────────────────
  // eFlightbook: Ldgs = daglandningar, Nldgs = nattlandningar.
  // Om natttid inte är direkt angett men nattlandningar finns → hela flygtiden = natt.
  const nightLandings = parseInt(out.landings_night) || 0;
  if ((parseFloat(out.night) || 0) === 0 && nightLandings > 0 && totalParsed > 0) {
    out.night = out.total_time;
  }

  // ── Standard-roll: co-pilot om PIC inte är angett ────────────────────────
  const picVal = parseFloat(out.pic) || 0;
  const copVal = parseFloat(out.co_pilot) || 0;
  if (picVal === 0 && copVal === 0 && totalParsed > 0) {
    out.co_pilot = out.total_time;
  }

  // Hoppa bara över rader som saknar datum, flygtid OCH flygplatser
  if (!out.date && !out.dep_place && !out.arr_place && (isNaN(totalParsed) || totalParsed === 0)) return null;

  return out as OcrFlightResult;
}

// ── Huvud-export ─────────────────────────────────────────────────────────────

export async function importFromFile(
  fileUri: string,
  onProgress?: (current: number, total: number) => void
): Promise<ImportResult> {
  if (!API_KEY || API_KEY === 'your_api_key_here') {
    throw new Error('Anthropic API-nyckel saknas. Ange den i .env-filen.');
  }

  onProgress?.(0, 3);

  const content = await FileSystem.readAsStringAsync(fileUri, {
    encoding: 'utf8' as any,
  });

  if (!content?.trim()) {
    throw new Error('Filen verkar vara tom. Kontrollera att det är en text/CSV-fil.');
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
  const sample = lines.slice(0, 16).join('\n');

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: MAPPING_PROMPT,
      messages: [{
        role: 'user',
        content: `Identifiera format och kolumnmappning:\n\n${sample}`,
      }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API-fel ${response.status}: ${err}`);
  }

  const apiData = await response.json();
  const text = apiData.content?.[0]?.text ?? '';

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Claude kunde inte identifiera filformatet. Kontrollera att filen är en text/CSV-fil.');
  }

  let mapping: any;
  try {
    mapping = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error('Kunde inte tolka formatsvar från Claude. Försök igen.');
  }

  const delimiter: string = mapping.delimiter ?? ',';
  const dateFormat: string = mapping.date_format ?? 'YYYY-MM-DD';
  const timeFormat: string = mapping.time_format ?? 'decimal';
  const colMap: Record<string, string> = mapping.column_mapping ?? {};
  const detectedFormat: string = mapping.detected_format ?? 'Okänt';
  const warnings: string[] = mapping.warnings ?? [];

  if (Object.keys(colMap).length === 0) {
    throw new Error(`Kunde inte mappa kolumner för format "${detectedFormat}". Kontrollera att filen exporterades korrekt.`);
  }

  onProgress?.(2, 3);

  // Tolka alla rader lokalt — inga fler API-anrop
  const headers = parseRow(lines[0], delimiter);
  const dataLines = lines.slice(1);
  const flights: OcrFlightResult[] = [];

  for (const line of dataLines) {
    const fields = parseRow(line, delimiter);
    const flight = mapRow(fields, headers, colMap, dateFormat, timeFormat);
    if (flight) flights.push(flight);
  }

  onProgress?.(3, 3);

  return {
    detectedFormat,
    totalRows: dataLines.length,
    mappedRows: flights.length,
    warnings,
    flights,
  };
}
