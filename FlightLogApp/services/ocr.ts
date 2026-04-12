import type { OcrFlightResult } from '../types/flight';
import { getScanImage, clearScanImage } from '../store/scanStore';

const API_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '';

const SYSTEM_PROMPT = `Du är en expert på att läsa EASA-flygloggböcker. Analysera bilden noggrant och extrahera varje flygningsrad.

KOLUMNSTRUKTUR I EASA-LOGGBOK (vanlig ordning vänster→höger):
1. Datum
2. Avgångsplats (ICAO) + tid
3. Ankomstplats (ICAO) + tid
4. Luftfartyg — TYP (t.ex. C172, PA28, B737, A320)
5. Luftfartyg — REGISTRATION (t.ex. SE-KXY, OY-ABC, G-ABCD, LN-XYZ, OH-ABC)
6. Pilotuppgift: PIC / Co-pilot / Dual / Instructor
7. Flygtider: Total / Natt / IFR
8. Landningar: Dag / Natt
9. Anmärkningar / Simulator

LUFTFARTYGSTYP — viktigt:
- Står ofta i en smal kolumn, kan vara förkortat: "C172", "PA-28", "B737", "A320", "TB20", "DA40"
- Samma typ upprepas ofta på flera rader — om en rad saknar typ, ärv från närmaste föregående rad
- Skriv alltid utan bindestreck om det är oklart: "C172" inte "C-172"
- Om typen är helt oläslig, returnera "" och sätt needs_review=true

REGISTRATION — viktigt:
- Format: 2 bokstäver (landkod) + bindestreck + 3 bokstäver, t.ex. SE-KXY, OY-ABC, G-ABCD
- Ibland skrivs bara de sista 3 bokstäverna (t.ex. "KXY") — behåll då som det är
- Samma registration upprepas ofta på flera rader — om en rad saknar reg, ärv från föregående
- Förväxla inte O (bokstav) med 0 (nolla) i registration
- Om registration är oläslig, returnera "" och sätt needs_review=true

ARVSREGEL FÖR TOMMA FÄLT:
Om aircraft_type eller registration är tom på en rad men föregående rad har värden,
ärv dessa värden och sätt needs_review=false (det är normalt att upprepade rader utelämnar dessa).

SIFFERVALIDERING — dessa förväxlas ofta i handskrift:
- 1 och 7 (särskilt i flygtider och tider)
- 7 och 9
- 3 och 8
- 0 och 6
- 5 och 6
Validera alltid siffror mot kontext: en flygtid på 9.1h är osannolik för kortdistansflyg, medan 1.9h eller 1.7h är troligare.

TIDSVALIDERING:
- Beräkna alltid flygtid från avg/landningstid och jämför med angiven flygtid
- Om avvikelsen är >0.1h, flagga raden för manuell granskning med reason
- Flygtider anges i decimalform (1.5) eller hh:mm (1:30) — hantera båda, returnera alltid decimal

SIDVALIDERING:
- Om sidan har radsummor: kontrollera att radsumman matchar "Total this page"
- Kontrollera att "Brought forward" + "Total this page" = "Total to date"
- Returnera page_totals med fälten: brought_forward, total_this_page, total_to_date (alla som decimal, null om ej synliga)

ICAO-VALIDERING:
- ICAO-koder är alltid exakt 4 bokstäver
- Om koden verkar felaktig eller bara 3 bokstäver, flagga för granskning
- Det är fullt normalt att dep_place och arr_place är samma (övningsflyg, trafik­mönster, lokala rundflygningar) — flagga INTE detta

BILDORIENTERING:
- Bilden kan vara roterad 90° (loggboken fotograferad stående eller liggande)
- Läs texten oavsett orientering — rotera mentalt om nödvändigt
- Om bilden är 90° roterad är kolumnerna horisontella istället för vertikala — anpassa läsningen

Returnera ENBART ett JSON-objekt:
{
  "flights": [
    {
      "date": "YYYY-MM-DD",
      "aircraft_type": "",
      "registration": "",
      "dep_place": "",
      "dep_utc": "HH:MM",
      "arr_place": "",
      "arr_utc": "HH:MM",
      "total_time": 0.0,
      "ifr": 0.0,
      "night": 0.0,
      "pic": 0.0,
      "co_pilot": 0.0,
      "dual": 0.0,
      "landings_day": 0,
      "landings_night": 0,
      "remarks": "",
      "needs_review": false,
      "review_reason": null
    }
  ],
  "page_totals": {
    "brought_forward": null,
    "total_this_page": null,
    "total_to_date": null
  }
}

Returnera BARA JSON, inga förklaringar.`;

// ── Summera sida ─────────────────────────────────────────────────────────────

const SUMMARIZE_PROMPT = `Du är expert på att läsa EASA-flygloggböcker. Din uppgift är att summera ALLA flygtider och landningar på sidan.

Läs varje rad och addera kolumnerna. Returnera ENBART ett JSON-objekt med summorna för sidan:

{
  "total_time": 0.0,
  "pic": 0.0,
  "co_pilot": 0.0,
  "dual": 0.0,
  "instructor": 0.0,
  "ifr": 0.0,
  "night": 0.0,
  "landings_day": 0,
  "landings_night": 0,
  "row_count": 0,
  "note": ""
}

REGLER:
- Summera BARA individuella flygningsrader — ta INTE med eventuella befintliga "Total this page"- eller "Brought forward"-rader längst ner, de ska räknas om.
- Tider kan stå som decimal (1.5) eller HH:MM (1:30) — konvertera alltid till decimal.
- row_count = antal flygningsrader du hittade.
- note = kort kommentar om något är oklart eller svårläst (annars "").
- Returnera BARA JSON, inga förklaringar.`;

export interface PageSummary {
  total_time: number;
  pic: number;
  co_pilot: number;
  dual: number;
  instructor: number;
  ifr: number;
  night: number;
  landings_day: number;
  landings_night: number;
  row_count: number;
  note: string;
}

export async function ocrSummarizePage(base64: string, mediaType: string): Promise<PageSummary> {
  if (!API_KEY || API_KEY === 'your_api_key_here') {
    throw new Error('Anthropic API-nyckel saknas. Ange den i .env-filen.');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      system: SUMMARIZE_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: 'Summera alla flygtider och landningar på sidan.' },
        ],
      }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API-fel ${response.status}: ${err}`);
  }

  const data = await response.json();
  const text = data.content?.[0]?.text ?? '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Kunde inte tolka svaret. Försök med en tydligare bild.');

  const parsed = JSON.parse(jsonMatch[0]);
  return {
    total_time:   Number(parsed.total_time)   || 0,
    pic:          Number(parsed.pic)           || 0,
    co_pilot:     Number(parsed.co_pilot)      || 0,
    dual:         Number(parsed.dual)          || 0,
    instructor:   Number(parsed.instructor)    || 0,
    ifr:          Number(parsed.ifr)           || 0,
    night:        Number(parsed.night)         || 0,
    landings_day: Number(parsed.landings_day)  || 0,
    landings_night: Number(parsed.landings_night) || 0,
    row_count:    Number(parsed.row_count)     || 0,
    note:         String(parsed.note ?? ''),
  };
}

export async function ocrScanLogbook(_imageUri?: string): Promise<{
  flights: OcrFlightResult[];
  pageTotals: { brought_forward: number | null; total_this_page: number | null; total_to_date: number | null };
}> {
  if (!API_KEY || API_KEY === 'your_api_key_here') {
    throw new Error('Anthropic API-nyckel saknas. Ange den i .env-filen.');
  }

  const scanImage = getScanImage();
  if (!scanImage) {
    throw new Error('Ingen bild hittades. Gå tillbaka och välj bild igen.');
  }
  const { base64, mediaType } = scanImage;
  clearScanImage();

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: mediaType, data: base64 },
          },
          { type: 'text', text: 'Extrahera alla flygningar från denna loggbokssida.' },
        ],
      }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API-fel ${response.status}: ${err}`);
  }

  const data = await response.json();
  const content = data.content?.[0]?.text ?? '';

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Kunde inte tolka svaret från Claude. Försök med en tydligare bild.');

  const parsed = JSON.parse(jsonMatch[0]);

  const flights: OcrFlightResult[] = (parsed.flights ?? []).map((f: any) => ({
    date: f.date ?? '',
    aircraft_type: f.aircraft_type ?? '',
    registration: f.registration ?? '',
    dep_place: (f.dep_place ?? '').toUpperCase(),
    dep_utc: f.dep_utc ?? '',
    arr_place: (f.arr_place ?? '').toUpperCase(),
    arr_utc: f.arr_utc ?? '',
    total_time: String(f.total_time ?? '0'),
    ifr: String(f.ifr ?? '0'),
    night: String(f.night ?? '0'),
    pic: String(f.pic ?? '0'),
    co_pilot: String(f.co_pilot ?? '0'),
    dual: String(f.dual ?? '0'),
    landings_day: String(f.landings_day ?? '1'),
    landings_night: String(f.landings_night ?? '0'),
    remarks: f.remarks ?? '',
    needs_review: Boolean(f.needs_review),
    review_reason: f.review_reason ?? undefined,
  }));

  const pt = parsed.page_totals ?? {};

  return {
    flights,
    pageTotals: {
      brought_forward: pt.brought_forward ?? null,
      total_this_page: pt.total_this_page ?? null,
      total_to_date: pt.total_to_date ?? null,
    },
  };
}
