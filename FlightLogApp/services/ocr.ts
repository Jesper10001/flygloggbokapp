import type { OcrFlightResult } from '../types/flight';
import { getScanImage, clearScanImage } from '../store/scanStore';
import type { TimeFormat } from '../store/timeFormatStore';

import { callAnthropicJson } from './anthropicClient';
import { buildContextHint } from '../db/ocrLearned';

function timeFormatHint(fmt: TimeFormat): string {
  return fmt === 'hhmm'
    ? 'TIDSFORMAT: Loggboken använder HH:MM-format (t.ex. 1:30 = 1h30min). Returnera alltid tider som decimal i JSON (1:30 → 1.5).'
    : 'TIDSFORMAT: Loggboken använder decimalformat (t.ex. 1.5 = 1h30min). Max 1 decimal.';
}

const SYSTEM_PROMPT = `Du är en expert på att läsa EASA-flygloggböcker. Analysera bilden noggrant och extrahera varje flygningsrad.

ARBETSORDNING (SKA FÖLJAS):
1. Läs raderna strikt uppifrån och ned, en åt gången
2. För varje rad: lös ditto-symboler och tomma fält mot senast kända värde per kolumn
3. Uppdatera rolling state för varje kolumn innan du går till nästa rad
4. Returnera slutliga JSON:en först när ALLA rader är bearbetade sekventiellt

LÄSORDNING INOM EN RAD (VIKTIGT):
Läs fälten i denna ordning per rad, så att tidigare fält kan agera "anchor"
för senare:
  1. total_time  ← läs FÖRST. Decimalformat är oftast lättare att avkoda och
                    ger en trovärdig absolut flygtid. Spara detta som "anchor".
  2. dep_utc / arr_utc — validera mot anchor:
     - Räkna (arr − dep) → jämför mot total_time
     - Om avvikelse > 5 min: EN av tiderna är troligen fel-OCR'ad
       (vanligt i handskrift: 3↔8, 0↔6, 5↔6, 1↔7, 7↔9)
     - Sätt needs_review=true och inkludera time_mismatch i JSON:
       "time_mismatch": {
         "anchor_total_h": 1.5,
         "read_dep": "13:00",
         "read_arr": "16:30",
         "computed_dep_if_arr_correct": "15:00",
         "computed_arr_if_dep_correct": "14:30"
       }
     Användaren får en Ja/Nej-knapp bredvid dep och arr och kan välja vilken
     som är rätt; den andra justeras automatiskt.
  3. Övriga kolumner (pic, co_pilot, ifr, night, landings, remarks)

Om total_time saknas eller är oläslig, fall tillbaka på (arr − dep).

KOLUMNSTRUKTUR I EASA-LOGGBOK (vanlig ordning vänster→höger):
1. Datum
2. Avgångsplats (ICAO) + tid
3. Ankomstplats (ICAO) + tid
4. Luftfartyg — TYP (t.ex. C172, PA28, B737, A320)
5. Luftfartyg — REGISTRATION (t.ex. SE-KXY, OY-ABC, G-ABCD, LN-XYZ, OH-ABC)
6. Pilotuppgift: PIC / Co-pilot / Dual / Instructor
7. Flygtider: Total / Natt / IFR
8. Landningar: Dag / Natt
9. Synthetic training session (simulator) — se nedan
10. Anmärkningar

SIMULATOR (Synthetic training session) — VIKTIGT:
Om en rad har tid i kolumnen "Synthetic training session" (STD):
- Raden är en SIMULATORSESSION, inte en flygning
- Sätt flight_type = "sim"
- Sätt total_time = STD-tiden (INTE från "Total time of flight" — den är 0 för sim)
- Dep/arr-platser kan vara tomma eller angivna som sim-center
- Returnera STD-tiden i fältet "total_time" så det loggas korrekt
- PIC/co-pilot/dual gäller fortfarande — piloter loggar rolltid i sim också
- Landningar: vanligtvis 0 för sim (ignorera om de ser konstiga ut)
- AI ska INTE blanda ihop sim-tid med flygtid — de är separata

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

SEKVENTIELL RAD-FÖR-RAD-LÄSNING (VIKTIGT):
Läs raderna i ordning uppifrån och ned. Håll ett "rolling state" för varje kolumn
(senast sett riktigt värde). När du analyserar en ny rad — innan du returnerar
ett värde — uppdatera kolumnens state om raden innehåller ett nytt verkligt
värde. Kolumnstate används sedan för att lösa ditto-symboler och tomma fält på
efterföljande rader.

ARVSREGEL FÖR TOMMA FÄLT:
Om aircraft_type, registration, dep_place eller arr_place är tom på en rad men
föregående rad har värden, ärv dessa värden och sätt needs_review=false.

DITO-SYMBOL (MYCKET VIKTIGT — LÄS NOGA):
Om ett fält innehåller någon av följande symboler — eller liknande "same as
above"-markeringar — kopiera det EXAKT oförändrade värdet från den NÄRMAST
FÖREGÅENDE raden som har ett verkligt värde (alfanumeriskt, icke-ditto,
icke-tomt) för samma kolumn:
  -::-   "   "   ---   :--:   〃   〃〃   ''   ,,   ″   ″″   do.   do

VANLIG FÖRVÄXLING — MYCKET VIKTIGT:
Ditto-symbolen "-::-" ser EXTREMT lik ut som "-11-" i handskrift. Om du ser
"-11-" eller "~11~" eller liknande i en kolumn där det INTE är rimligt med
siffror (t.ex. aircraft_type, registration, dep_place, arr_place, date) — anta
att det är en ditto-symbol (-::-) och lös den mot föregående rads värde.
Generellt: om SAMMA markering upprepas på flera rader i följd och bara
siffror/tider varierar, är det troligen ditto-symboler på de statiska fälten.

REGLER:
A. Kopiera HELA föregående värdet ordagrant — bokstav för bokstav. Blanda
   ALDRIG ihop bokstäver från olika rader, uppfinn inte nya koder.
B. "Föregående rad" = raden direkt ovanför i samma kolumn. Om den raden också
   har ditto, gå en rad till uppåt tills du hittar ett riktigt värde.
C. Det är ALDRIG ett genomsnitt, en hybrid eller en gissning. Det är samma
   tecken som föregående faktiska värde.

EXEMPEL (följ detta mönster exakt):
  Rad 1: arr_place = "ESCF"    ← faktiskt värde, sparas som rolling state
  Rad 2: arr_place = "ESCF"    ← faktiskt värde, uppdaterar rolling state
  Rad 3: arr_place = "ZZZZ"    ← faktiskt värde, uppdaterar rolling state
  Rad 4: arr_place = "-::-"    ← returnera EXAKT "ZZZZ" (senaste riktiga)
  Rad 5: arr_place = "-::-"    ← returnera EXAKT "ZZZZ"

FÖRBJUDET:
  ✗ Returnera "ESZZ" (hybrid av ESCF+ZZZZ) — helt fel, aldrig tillåtet
  ✗ Ge en "kompromiss" mellan flera tidigare värden
  ✗ Räkna ut medelvärde eller "säkraste" tolkning
  ✗ Ändra på det föregående värdet på något sätt

Ditto-regeln gäller ALLA kolumner utan undantag: date, aircraft_type,
registration, dep_place, dep_utc, arr_place, arr_utc. Returnera ALDRIG
ditto-symbolen som värde — alltid det lösta värdet.

Om en ditto-symbol står på sidans första rad utan föregående värde, markera
needs_review=true med reason="ditto utan föregående värde" och lämna fältet
tomt.

BOKSTAVSFÖRVÄXLINGAR I HANDSKRIFT — MYCKET VANLIGT:
- A ↔ H (t.ex. ETAB ↔ ETHB, A109 ↔ H109)
- A ↔ N (t.ex. ETHA ↔ ETHN, EDNA ↔ EDNA)
- N ↔ H (t.ex. ETNB ↔ ETHB)
- U ↔ V (t.ex. UH60 ↔ VH60)
Om du läser en ICAO-kod och den inte finns som känd flygplats — försök byta
A↔H, A↔N, N↔H och kontrollera om NÅGON variant är en känd flygplats. Om ja,
använd den kända varianten som primärvärde och den ursprungligt lästa som
suggested_value i field_issues. Flagga alltid för granskning.

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

DECIMAL-AVRUNDNING (VIKTIGT):
När en HH:MM-tid måste konverteras till decimal med 1 decimal, använd
**generös avrundning uppåt** som standard. 1:09 = exakt 1.15h — båda 1.1 och
1.2 är rimliga avrundningar; välj 1.2. Motivering: EASA tillåter bara loggning
av tid man faktiskt flugit, så 1.2 är säkrare än att underrepresentera.

MEN: om piloten har skrivit ett specifikt decimalvärde i loggboken, acceptera
det värdet ORÄNDRAT även om det är nedre spannet (ex. pilot skrev 1.1 istället
för 1.2 för 1:09) — det går inte att ändra i den fysiska loggboken i efterhand.
Returnera alltid det värde piloten faktiskt skrev om det är läsbart.

Generös avrundning används BARA när du själv konverterar från dep/arr-tider
eller när värdet är suddigt/oläsligt och du måste gissa.

REMARKS-KLASSIFICERING:
Om innehållet i remarks-fältet matchar ett specifikt mönster kan det egentligen
höra hemma i ett annat fält. Föreslå detta via "remarks_suggestion"-objektet.

Mönster att känna igen:
- 3-bokstavs kod (A-Z), t.ex. "ABC", "DEF" → föreslå second_pilot (vanligt
  svenskt mönster för andrepilotens signaturinitialer)
- "PIC/us", "PICUS", "P/us" → föreslå att värdet flyttas till picus-fältet
- "SPIC", "SP/c" → föreslå spic-fältet
- "NVG" följt av tid → föreslå nvg-fältet
- "IR ren.", "IR renewal", "PC" → ingen åtgärd (låt stå i remarks)
- "check ride", "OPC", "LPC" → ingen åtgärd
- "touch and go" → överväg flight_type = 'touch_and_go'
- Instruktörs-signatur (fullt namn) → ingen åtgärd (bör stå i remarks)

Skicka ENDAST remarks_suggestion om confidence >= 0.6. Format:
{
  "field": "second_pilot",
  "value": "ABC",
  "original_text": "ABC",
  "confidence": 0.75,
  "reason": "3-bokstavskod — vanligen andrepilotens signatur"
}

Användaren får en Ja/Nej-prompt och kan välja att acceptera eller behålla
värdet i remarks.

SIDNUMMER-DETEKTION (VIKTIGT):
Läs sidnumren som står längst ned (vanligen i mitten eller hörnen) på vänster
och höger sida. Svenska EASA-loggböcker har tryckt sidnumrering, t.ex. "92" på
vänster och "93" på höger. Returnera som page_numbers i JSON:
  "page_numbers": { "left": 92, "right": 93 }
Om bara ett sidnummer syns, returnera det du ser och null för det andra.
Om inga sidnummer syns, returnera null för båda.

SIDVALIDERING:
- Om sidan har radsummor: kontrollera att radsumman matchar "Total this page"
- Kontrollera att "Brought forward" + "Total this page" = "Total to date"
- Returnera page_totals med fälten: brought_forward, total_this_page, total_to_date (alla som decimal, null om ej synliga)

ICAO-VALIDERING:
- ICAO-koder är alltid exakt 4 bokstäver
- Om koden verkar felaktig eller bara 3 bokstäver, flagga för granskning
- Det är fullt normalt att dep_place och arr_place är samma (övningsflyg, trafik­mönster, lokala rundflygningar) — flagga INTE detta

KONFIDENS PER RAD OCH FÄLT (VIKTIGT):
För varje rad, ange hur säker du är på totalt och på enskilda fält.

1. overall_confidence (0.0–1.0): sammanvägd säkerhet för HELA raden
   - 0.95+ = du är säker på alla fält (handstil tydlig, ICAO standard, tider
     stämmer med total) → raden "fast-trackas" i UI:t, auto-godkänns, visas
     komprimerat. Använd SPARSAMT — bara när du verkligen är säker.
   - 0.80–0.95 = merparten säker, någon liten osäkerhet
   - < 0.80 = viktig osäkerhet — sätt needs_review=true

2. field_issues: array med bara de fält som har hög osäkerhet. Format per fält:
   { "field": "aircraft_type", "reason": "suddig handstil, kan vara C172 eller G172",
     "confidence": 0.55, "suggested_value": "C172" }

   suggested_value: ditt alternativa förslag om du har en rimlig gissning.
   Exempel: primärvärdet är "ETAB" men "ETHB" är en giltig ICAO-kod → suggested_value = "ETHB".
   Exempel: tidsformat oklart, 08:20 primärt men kan vara 08:30 → suggested_value = "08:30".
   Lämna tomt ("") om du inte har en alternativ tolkning.

   Inkludera ENDAST fält med confidence < 0.85. Hoppa över alla säkra fält.
   UI:t visar bara dessa fält vid review → användaren slipper leta efter vad
   som är fel. Om field_issues är tom array → hela raden är säker eller
   flaggad av andra skäl (tidsmismatch etc.)

Exempel:
  - Tydlig handstil, allt läsbart, tider kontrollerade → overall_confidence=0.96,
    field_issues=[], needs_review=false
  - "ESCF" tydligt men siffran "1" kan vara "7" i total_time →
    overall_confidence=0.70, field_issues=[{field:"total_time", reason:"...", confidence:0.5}],
    needs_review=true

BILDORIENTERING:
- Bilden kan vara roterad 90° (loggboken fotograferad stående eller liggande)
- Läs texten oavsett orientering — rotera mentalt om nödvändigt
- Om bilden är 90° roterad är kolumnerna horisontella istället för vertikala — anpassa läsningen

BILD-METADATA (VIKTIGT — returnera alltid):
Returnera fältet image_layout på toppnivå:
{
  "image_layout": {
    "orientation": "landscape" | "portrait",
    "logbook_bounds": {
      "x_pct": 5,     // vänsterkant av loggboken i % av bildens bredd (0-100)
      "y_pct": 10,    // överkant av loggboken i % av bildens höjd (0-100)
      "w_pct": 90,    // loggbokens bredd i %
      "h_pct": 80     // loggbokens höjd i %
    }
  }
}
Uppskatta var den fysiska loggboken börjar och slutar i bilden. Om bilden
redan är croppat tight: {x_pct:0, y_pct:0, w_pct:100, h_pct:100}.

För VARJE flygningsrad, returnera ungefärlig position i bilden:
  "row_y_pct": 35    // radans vertikala mitt i % av bildhöjden (0=överst, 100=underst)

För varje field_issue, returnera ungefärlig horisontell position:
  "x_pct": 65        // fältets horisontella position i % av bildbredden

AIRCRAFT-DETEKTERING (KRITISKT):
Innan du returnerar flights-listan, gruppera de unika luftfartyg du sett på
sidan. Returnera fältet aircraft_detections[] på toppnivå. Varje entry:

{
  "as_written": "A109LUH",       // exakt det piloten skrev (inkl. stil/förkortning)
  "resolved": "A109",             // din bedömning av ICAO-typkoden
  "registration": "SE-JVC",       // första registrering du såg för denna typ
  "first_row": 1,                 // vilken rad på sidan den först dyker upp
  "rows": [1, 2, 3, 4],           // alla rader som har denna as_written
  "confidence": 0.88              // hur säker du är på tolkningen
}

Om samma "as_written"-sträng återkommer på flera rader, behandla dem som samma
luftfartyg. Om piloten skrivit typen på två olika sätt (t.ex. "A109" och
"AW109"), kan det ändå vara samma maskin — gruppera då efter registrering när
den finns, annars separat.

Användaren får bekräfta aircraft_detections innan resten av reviewen visas.

Returnera ENBART ett JSON-objekt:
{
  "aircraft_detections": [
    {
      "as_written": "",
      "resolved": "",
      "registration": "",
      "first_row": 1,
      "rows": [],
      "confidence": 0.0
    }
  ],
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
      "review_reason": null,
      "remarks_suggestion": null,
      "time_mismatch": null,
      "overall_confidence": 0.0,
      "row_y_pct": 0,
      "field_issues": []
    }
  ],
  "page_totals": {
    "brought_forward": null,
    "total_this_page": null,
    "total_to_date": null
  },
  "page_numbers": {
    "left": null,
    "right": null
  },
  "image_layout": {
    "orientation": "landscape",
    "logbook_bounds": { "x_pct": 0, "y_pct": 0, "w_pct": 100, "h_pct": 100 }
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
  const parsed = await callAnthropicJson<any>({
    system: SUMMARIZE_PROMPT,
    maxTokens: 1024,
    userContent: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
      { type: 'text', text: `${timeFormatHint(timeFormat)} Summera alla flygtider och landningar på sidan. Svara ENBART med ett JSON-objekt — ingen text före eller efter.` },
    ],
  });
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
  aircraftDetections: AircraftDetection[];
}> {
  const scanImage = getScanImage();
  if (!scanImage) {
    throw new Error('Ingen bild hittades. Gå tillbaka och välj bild igen.');
  }
  const { base64, mediaType } = scanImage;
  clearScanImage();

  // Använd gemensam ocrScanPage + parseOcrResponse
  return ocrScanPage(base64, mediaType, timeFormat);
}

// Kontext från föregående sida — används vid batch-skanning för ditto-upplösning
export interface PageContext {
  last_date?: string;
  last_aircraft_type?: string;
  last_registration?: string;
  last_dep_place?: string;
  last_arr_place?: string;
  page_number?: number;
}

export type ImageLayout = {
  orientation: 'landscape' | 'portrait';
  logbook_bounds: { x_pct: number; y_pct: number; w_pct: number; h_pct: number };
};

export type OcrPageResult = {
  flights: OcrFlightResult[];
  pageTotals: { brought_forward: number | null; total_this_page: number | null; total_to_date: number | null };
  aircraftDetections: AircraftDetection[];
  pageNumbers: { left: number | null; right: number | null };
  imageLayout: ImageLayout;
};

// Skanna EN sida direkt från base64 — för batch-import.
// Accepterar kontext från föregående sida för ditto-upplösning.
export async function ocrScanPage(
  base64: string,
  mediaType: string,
  timeFormat: TimeFormat = 'decimal',
  prevContext?: PageContext,
): Promise<OcrPageResult> {
  let contextHint = '';
  if (prevContext) {
    contextHint = `\n\nKONTEXT FRÅN FÖREGÅENDE SIDA (sida ${prevContext.page_number ?? '?'}):\nSista radens värden: date="${prevContext.last_date}", aircraft_type="${prevContext.last_aircraft_type}", registration="${prevContext.last_registration}", dep_place="${prevContext.last_dep_place}", arr_place="${prevContext.last_arr_place}"\nAnvänd dessa som rolling state för ditto-symboler på denna sidas FÖRSTA rad.`;
  }
  // Bifoga inlärda mappningar från tidigare skanningar
  const learnedHint = await buildContextHint();
  if (learnedHint) contextHint += `\n\n${learnedHint}`;

  const parsed = await callAnthropicJson<any>({
    system: SYSTEM_PROMPT,
    maxTokens: 16000,
    userContent: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
      { type: 'text', text: `${timeFormatHint(timeFormat)} Extrahera alla flygningar från denna loggbokssida. Svara ENBART med ett JSON-objekt — ingen text före eller efter.${contextHint}` },
    ],
  });

  return parseOcrResponse(parsed);
}

// Gemensam parser — används av både ocrScanLogbook och ocrScanPage
function parseOcrResponse(parsed: any): OcrPageResult {
  const flights: OcrFlightResult[] = (parsed.flights ?? []).map((f: any) => {
    const rs = f.remarks_suggestion;
    const validSuggestion = rs && typeof rs === 'object' && rs.field && rs.value && Number(rs.confidence ?? 0) >= 0.6
      ? {
          field: String(rs.field),
          value: String(rs.value),
          original_text: String(rs.original_text ?? rs.value),
          confidence: Number(rs.confidence),
          reason: String(rs.reason ?? ''),
        }
      : undefined;
    const tm = f.time_mismatch;
    const validMismatch = tm && typeof tm === 'object' && tm.anchor_total_h && tm.read_dep && tm.read_arr
      ? {
          anchor_total_h: Number(tm.anchor_total_h),
          read_dep: String(tm.read_dep),
          read_arr: String(tm.read_arr),
          computed_dep_if_arr_correct: String(tm.computed_dep_if_arr_correct ?? ''),
          computed_arr_if_dep_correct: String(tm.computed_arr_if_dep_correct ?? ''),
        }
      : undefined;
    const overallConfidence = Math.max(0, Math.min(1, Number(f.overall_confidence) || 0));
    const fieldIssues = Array.isArray(f.field_issues)
      ? f.field_issues
          .filter((i: any) => i && typeof i === 'object' && i.field)
          .map((i: any) => ({
            field: String(i.field),
            reason: String(i.reason ?? ''),
            confidence: Number(i.confidence ?? 0),
            x_pct: typeof i.x_pct === 'number' ? i.x_pct : undefined,
            suggested_value: i.suggested_value ? String(i.suggested_value) : undefined,
          }))
      : [];
    return {
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
      multi_pilot: f.multi_pilot !== undefined ? String(f.multi_pilot) : undefined,
      single_pilot: f.single_pilot !== undefined ? String(f.single_pilot) : undefined,
      instructor: f.instructor !== undefined ? String(f.instructor) : undefined,
      picus: f.picus !== undefined ? String(f.picus) : undefined,
      spic: f.spic !== undefined ? String(f.spic) : undefined,
      examiner: f.examiner !== undefined ? String(f.examiner) : undefined,
      safety_pilot: f.safety_pilot !== undefined ? String(f.safety_pilot) : undefined,
      nvg: f.nvg !== undefined ? String(f.nvg) : undefined,
      tng_count: f.tng_count !== undefined ? String(f.tng_count) : undefined,
      second_pilot: f.second_pilot !== undefined ? String(f.second_pilot) : undefined,
      stop_place: f.stop_place !== undefined ? String(f.stop_place).toUpperCase() : undefined,
      needs_review: Boolean(f.needs_review),
      review_reason: f.review_reason ?? undefined,
      remarks_suggestion: validSuggestion,
      time_mismatch: validMismatch,
      overall_confidence: overallConfidence,
      row_y_pct: typeof f.row_y_pct === 'number' ? f.row_y_pct : undefined,
      field_issues: fieldIssues,
    } as OcrFlightResult;
  });

  const pt = parsed.page_totals ?? {};
  const detections: AircraftDetection[] = Array.isArray(parsed.aircraft_detections)
    ? parsed.aircraft_detections
        .filter((d: any) => d && typeof d === 'object' && (d.as_written || d.resolved))
        .map((d: any) => ({
          as_written: String(d.as_written ?? d.resolved ?? ''),
          resolved: String(d.resolved ?? d.as_written ?? '').toUpperCase(),
          registration: String(d.registration ?? '').toUpperCase(),
          first_row: Number(d.first_row) || 1,
          rows: Array.isArray(d.rows) ? d.rows.map((n: any) => Number(n)).filter((n: number) => !isNaN(n)) : [],
          confidence: Math.max(0, Math.min(1, Number(d.confidence) || 0)),
        }))
    : [];

  const pn = parsed.page_numbers ?? {};
  return {
    flights,
    pageTotals: {
      brought_forward: pt.brought_forward ?? null,
      total_this_page: pt.total_this_page ?? null,
      total_to_date: pt.total_to_date ?? null,
    },
    aircraftDetections: detections,
    pageNumbers: {
      left: typeof pn.left === 'number' ? pn.left : null,
      right: typeof pn.right === 'number' ? pn.right : null,
    },
    imageLayout: {
      orientation: parsed.image_layout?.orientation === 'portrait' ? 'portrait' : 'landscape',
      logbook_bounds: {
        x_pct: Number(parsed.image_layout?.logbook_bounds?.x_pct ?? 0),
        y_pct: Number(parsed.image_layout?.logbook_bounds?.y_pct ?? 0),
        w_pct: Number(parsed.image_layout?.logbook_bounds?.w_pct ?? 100),
        h_pct: Number(parsed.image_layout?.logbook_bounds?.h_pct ?? 100),
      },
    },
  };
}

export interface AircraftDetection {
  as_written: string;
  resolved: string;
  registration: string;
  first_row: number;
  rows: number[];
  confidence: number;
}
