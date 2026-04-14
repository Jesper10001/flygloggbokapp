import type { OcrFlightResult } from '../types/flight';
import { getScanImage, clearScanImage } from '../store/scanStore';
import type { TimeFormat } from '../store/timeFormatStore';

const API_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY ?? '';

function timeFormatHint(fmt: TimeFormat): string {
  return fmt === 'hhmm'
    ? 'TIDSFORMAT: Loggboken använder HH:MM-format (t.ex. 1:30 = 1h30min). Returnera alltid tider som decimal i JSON (1:30 → 1.5).'
    : 'TIDSFORMAT: Loggboken använder decimalformat (t.ex. 1.5 = 1h30min). Max 1 decimal.';
}

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

DITO-SYMBOL "-::-" ELLER LIKNANDE:
Om ett fält innehåller symbolen "-::-", "---", ":--:", "〃" eller liknande dito-tecken,
betyder det "samma som ovan" — ärv värdet från närmaste föregående rad som har ett riktigt värde i det fältet.
Gäller alla fält: aircraft_type, registration, dep_place, arr_place m.fl.

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

const SUMMARIZE_PROMPT = `OUTPUT FORMAT: Respond with ONLY a raw JSON object. No markdown, no explanation, no text before or after. First character must be { and last character must be }.

Du är expert på EASA-flygloggböcker. Summera flygtider/landningar och läs av "Brought forward".

REGLER:
- total_this_page: addera BARA individuella flygningsrader. Ignorera befintliga "Total this page", "Brought forward", "Total to date"-rader.
- brought_forward: läs av "Brought forward"-raden (överst eller nedtill på sidan). Saknas den, sätt 0.
- Tider som HH:MM konverteras till decimal (1:30 → 1.5).
- row_count = antal flygningsrader.
- note = kort kommentar om oklarheter, annars "".

JSON-SCHEMA (följ exakt):
{"total_this_page":{"total_time":0.0,"pic":0.0,"co_pilot":0.0,"dual":0.0,"instructor":0.0,"ifr":0.0,"night":0.0,"landings_day":0,"landings_night":0},"brought_forward":{"total_time":0.0,"pic":0.0,"co_pilot":0.0,"dual":0.0,"instructor":0.0,"ifr":0.0,"night":0.0,"landings_day":0,"landings_night":0},"row_count":0,"note":""}

KRITISKT: Svara ENBART med JSON-objektet ovan ifyllt med rätt värden. Ingen annan text.`;

export interface PageTotals {
  total_time: number;
  pic: number;
  co_pilot: number;
  dual: number;
  instructor: number;
  ifr: number;
  night: number;
  landings_day: number;
  landings_night: number;
}

export interface PageSummary {
  total_this_page: PageTotals;
  brought_forward: PageTotals;
  total_to_date: PageTotals;
  row_count: number;
  note: string;
}

function parseTotals(obj: any): PageTotals {
  return {
    total_time:    Number(obj?.total_time)    || 0,
    pic:           Number(obj?.pic)           || 0,
    co_pilot:      Number(obj?.co_pilot)      || 0,
    dual:          Number(obj?.dual)          || 0,
    instructor:    Number(obj?.instructor)    || 0,
    ifr:           Number(obj?.ifr)           || 0,
    night:         Number(obj?.night)         || 0,
    landings_day:  Number(obj?.landings_day)  || 0,
    landings_night:Number(obj?.landings_night)|| 0,
  };
}

function addTotals(a: PageTotals, b: PageTotals): PageTotals {
  return {
    total_time:     a.total_time     + b.total_time,
    pic:            a.pic            + b.pic,
    co_pilot:       a.co_pilot       + b.co_pilot,
    dual:           a.dual           + b.dual,
    instructor:     a.instructor     + b.instructor,
    ifr:            a.ifr            + b.ifr,
    night:          a.night          + b.night,
    landings_day:   a.landings_day   + b.landings_day,
    landings_night: a.landings_night + b.landings_night,
  };
}

export async function ocrSummarizePage(base64: string, mediaType: string, timeFormat: TimeFormat = 'decimal'): Promise<PageSummary> {
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
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      temperature: 0,
      system: SUMMARIZE_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: `${timeFormatHint(timeFormat)} Summera alla flygtider och landningar på sidan. Svara ENBART med ett JSON-objekt — ingen text före eller efter.` },
        ],
      }],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`API-fel ${response.status}: ${err}`);
  }

  const data = await response.json();
  const rawText = data.content?.[0]?.text ?? '';
  console.log('[OCR summarize raw]', rawText.slice(0, 500));
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Kunde inte tolka svaret. Claude svarade: "${rawText.slice(0, 120)}"`);

  const parsed = JSON.parse(jsonMatch[0]);
  const total_this_page = parseTotals(parsed.total_this_page);
  const brought_forward = parseTotals(parsed.brought_forward);
  return {
    total_this_page,
    brought_forward,
    total_to_date: addTotals(total_this_page, brought_forward),
    row_count: Number(parsed.row_count) || 0,
    note: String(parsed.note ?? ''),
  };
}

export async function ocrScanLogbook(timeFormat: TimeFormat = 'decimal', _imageUri?: string): Promise<{
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
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: `${timeFormatHint(timeFormat)} Extrahera alla flygningar från denna loggbokssida. Svara ENBART med ett JSON-objekt — ingen text före eller efter.` },
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
  console.log('[OCR import raw]', content.slice(0, 500));

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Kunde inte tolka svaret från Claude. Svar: "${content.slice(0, 120)}"`);

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
