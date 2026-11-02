import type { OcrFlightResult } from '../types/flight';
import { getScanImage, clearScanImage } from '../store/scanStore';
import type { TimeFormat } from '../store/timeFormatStore';

import { callAnthropicJson, callAnthropicTool, callAnthropicToolStream } from './anthropicClient';
import { getActiveDigitalBook } from '../db/digitalBooks';
import { getAnyTemplate } from '../db/customTemplates';
import { layoutFromTemplate, buildLayoutContext, buildSideLayoutContext, type LogbookLayout } from './logbookLayout';
import { buildScanVocab } from './scanVocab';
import { validateAgainstVocab } from './scanValidate';
import { mergeSpreadParsed } from './spreadMerge';
import { buildPageGrid, remapRawGridX, remapBoxX, type PageGrid, type RawGrid } from './scanGeometry';
import { reconcileBlockTime } from '../utils/flightTime';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';

// Slå på streaming efter att CF Worker-proxyn patchats att vidarebefordra SSE.
// Tills dess används icke-streamande tool-use (kräver ingen proxy-ändring).
const OCR_USE_STREAM = process.env.EXPO_PUBLIC_OCR_STREAM === '1';

// M4 rygg-delning: PÅ som standard (Fas 0). Läser en sida per anrop → lägre
// glyf-densitet och högre upplösning per glyf. Guards i splitSpread() skyddar mot
// skeva/lågupplösta foton, och merge-osäkerhet faller tillbaka på hela uppslaget.
// Stäng av med EXPO_PUBLIC_OCR_SPLIT=0. (Full nytta + säkerhet kommer med Fas 1: dewarp-capture.)
const OCR_SPLIT_SPREAD = process.env.EXPO_PUBLIC_OCR_SPLIT !== '0';

// OCR-läsare: Sonnet 5.5 (2026-11-01). Samma kvalitet som användaren testat i dev-builden, ungefär dubbelt så
// snabb och halva kostnaden mot Opus 5.5 (tiden domineras av svarets längd). Appens egna kontroller (summor
// per kolumn, Vision, regler) fångar det som läses fel. EXPO_PUBLIC_OCR_MODEL sätter en annan modell.
// ("Haiku först" testades 2026-11-01 och valdes bort: 88,5 % lika celler mot Sonnet, och felaktiga klockslag
// som sidans summor inte kan avslöja.)
export const OCR_MODEL = process.env.EXPO_PUBLIC_OCR_MODEL || 'claude-sonnet-5-5';

// JSON-schema för OCR-verktyget. Alla fält valfria → modellen utelämnar tomma.
// Fältnamnen matchar det parseOcrResponse() redan läser, så inget annat behöver ändras.
const OCR_TOOL_SCHEMA: Record<string, any> = {
  type: 'object',
  properties: {
    flights: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          row_index: { type: 'integer' },
          date: { type: 'string' },
          aircraft_type: { type: 'string' },
          registration: { type: 'string' },
          dep_place: { type: 'string' },
          dep_utc: { type: 'string' },
          arr_place: { type: 'string' },
          arr_utc: { type: 'string' },
          stop_place: { type: 'string' },
          total_time: { type: 'number' },
          ifr: { type: 'number' },
          night: { type: 'number' },
          pic: { type: 'number' },
          co_pilot: { type: 'number' },
          dual: { type: 'number' },
          instructor: { type: 'number' },
          multi_pilot: { type: 'number' },
          single_pilot: { type: 'number' },
          picus: { type: 'number' },
          spic: { type: 'number' },
          nvg: { type: 'number' },
          sim: { type: 'number' },
          sim_category: { type: 'string' },
          flight_type: { type: 'string', enum: ['normal', 'sim', 'touch_and_go'] },
          tng_count: { type: 'integer' },
          landings_day: { type: 'integer' },
          landings_night: { type: 'integer' },
          second_pilot: { type: 'string' },
          remarks: { type: 'string' },
          other_times: { type: 'object', additionalProperties: { type: 'number' } },
          other_time_labels: { type: 'object', additionalProperties: { type: 'string' } },
          // needs_review, review_reason och remarks_suggestion räknar appen ut själv (scanImport.prepareFlight):
          // de stod för ungefär en tredjedel av svaret och därmed av tiden och kostnaden.
          field_issues: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                field: { type: 'string' },
                reason: { type: 'string' },
                confidence: { type: 'number' },
                suggested_value: { type: 'string' },
                box: {
                  type: 'object',
                  properties: {
                    left: { type: 'number' }, top: { type: 'number' },
                    right: { type: 'number' }, bottom: { type: 'number' },
                  },
                },
              },
              required: ['field'],
            },
          },
        },
        required: [],
      },
    },
    aircraft_detections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          as_written: { type: 'string' },
          resolved: { type: 'string' },
          registration: { type: 'string' },
          first_row: { type: 'integer' },
          confidence: { type: 'number' },
        },
      },
    },
    page_totals: {
      type: 'object',
      properties: {
        brought_forward: { type: ['number', 'null'] },
        total_this_page: { type: ['number', 'null'] },
        total_to_date: { type: ['number', 'null'] },
        this_page_by_field: { type: 'object', additionalProperties: { type: 'number' } },
      },
    },
    page_numbers: {
      type: 'object',
      properties: {
        left: { type: ['integer', 'null'] },
        right: { type: ['integer', 'null'] },
      },
    },
    remarks_pilot_names: { type: 'boolean' },
    grid: {
      type: 'object',
      properties: {
        table_top: { type: 'number' },
        table_bottom: { type: 'number' },
        rows_printed: { type: 'integer' },
        columns: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              index: { type: 'integer' },
              field: { type: 'string' },
              left: { type: 'number' },
              right: { type: 'number' },
            },
          },
        },
      },
      required: ['table_top', 'table_bottom', 'columns'],
    },
  },
  required: ['flights', 'grid'],
};
import { buildContextHint } from '../db/ocrLearned';
import { scanQuotaWeight } from '../utils/tokenGate';

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

RADER OCH KOLUMNER (MYCKET VIKTIGT — de vanligaste felen):
- Varje TRYCKT rad är en flygning eller tom. Räkna de tryckta raderna uppifrån på BÅDA sidorna (tomma rader
  räknas) innan du läser värdena. Rad N på vänstersidan fortsätter på rad N på högersidan.
- Läs varje rad längs SAMMA linje över hela uppslaget: datum, tider, total, funktionstid, landningar och
  anmärkning på rad N hör ihop. Ett värde får aldrig hamna på en annan rad än den där det står.
- En tom cell är tom. Flytta ALDRIG upp ett värde från raden under för att fylla den. (Vanligt fel: när
  översta cellen i en kolumn är tom förskjuts hela kolumnen en rad uppåt.) Exempel: Landings Day är tom på
  rad 1 och har 7 på rad 2 → rad 1 får inga landningar och rad 2 får 7 — inte 7 på rad 1. Jämför med en
  kolumn som har värden på varje rad (t.ex. Dual eller Total) för att se vilken rad ett tal står på.
- Antalet flygningar kan aldrig vara fler än grid.rows_printed. Har du fått en rad för mycket har du läst
  samma rad två gånger — hitta den och ta bort den.
- Kontroll per flygning: total_time = PIC + Co-pilot + Dual. Stämmer det inte på flera rader i följd har
  en kolumn glidit en rad — räkna raderna igen.
- Datum ökar nedåt; flera flygningar samma datum står i tidsordning. Läs datum och klockslag på samma rad.
- ÖVERSTRUKET: ett värde med ett streck över eller genom sig är ogiltigt — använd ersättningsvärdet
  (bredvid eller ovanför). Står ett överstruket tal och ett nytt tal i samma cell (t.ex. "14" överstruket
  och "2" bredvid) är värdet bara det nya talet (2) — skriv ALDRIG ihop siffrorna (142). Är ett tal
  överstruket i en kolumn och omskrivet i grannkolumnen (t.ex. Day → Night eller Day → AR landings) gäller
  det bara där det INTE är överstruket.

LÄSORDNING INOM EN RAD (VIKTIGT):
Läs fälten i denna ordning per rad:
  1. total_time  ← läs FÖRST. Detta är det VIKTIGASTE fältet och den
     absoluta sanningskällan för flygtiden. Spara som "anchor".
     ÄNDRA ALDRIG total_time för att passa dep/arr-tider.
  2. dep_utc / arr_utc — validera mot anchor:
     - Räkna (arr − dep) → jämför mot total_time
     - Om avvikelse > 5 min: dep eller arr är troligen fel-OCR'ad
       (vanligt i handskrift: 3↔8, 0↔6, 5↔6, 1↔7, 7↔9)
     - Behåll ALLTID total_time som det står. Returnera dep/arr som du läser dem.
     - Appen räknar själv ut avvikelsen och frågar användaren — skriv INTE time_mismatch, och flagga dep/arr
       i field_issues bara om själva siffran är svårläst.
  3. Övriga kolumner — VIKTIGT: om en COLUMN MAPPING finns i scan-profilen,
     använd ALLTID kolumnpositionen för att avgöra om ett värde är PIC, Dual,
     Co-pilot eller Instructor. Gissa ALDRIG baserat på värdet — samma tid
     (t.ex. 1.5) kan stå i PIC-kolumnen ELLER Dual-kolumnen. Positionen avgör.
     En elev loggar all tid som DUAL, inte PIC. En instruktör loggar som
     Instructor. Läs kolumnhuvudet eller scan-profilens mapping.

Om total_time saknas eller är oläslig, fall tillbaka på (arr − dep).

KOLUMNSTRUKTUR I EASA-LOGGBOK (vanlig ordning vänster→höger):
1. Datum
2. Avgångsplats (ICAO) + tid
3. Ankomstplats (ICAO) + tid
4. Luftfartyg — TYP + MODELL (i samma kolumn, t.ex. "Bell 206 B3", "C172SP")
   Returnera aircraft_type = ICAO-koden (B206), aircraft_model = modellvarianten (B3)
5. Luftfartyg — REGISTRATION (t.ex. SE-KXY, OY-ABC, G-ABCD, LN-XYZ, OH-ABC)
6. Pilotuppgift: PIC / Co-pilot / Dual / Instructor (separata kolumner — läs POSITION, inte värde)
7. Flygtider: Total / Natt / IFR
8. Landningar: Dag / Natt
9. Synthetic training session (simulator) — se nedan
10. Anmärkningar + andrepilot (delar ALLTID samma kolumn — se regler nedan)

SIMULATOR (Synthetic training session / STD / FSTD / FFS / Sim) — VIKTIGT:
Kolumnen kan heta "Synthetic training session", "STD", "FSTD", "FFS",
"Sim" eller liknande. Om en rad har tid i sim-kolumnen:
- Sätt flight_type = "sim"
- Läs VARJE kolumns värde strikt från sin position — sim-tid stannar i sim-fältet
- total_time: läs kolumnen för total_time (INTE sim-kolumnen). Om total_time
  kolumnen är tom eller 0 för en sim-rad → returnera 0
- Kopiera ALDRIG sim-tiden till total_time, dual, pic eller andra kolumner
- PIC/co-pilot/dual: läs bara vad som faktiskt står i respektive kolumn
- Landningar: vanligtvis 0 för sim
- Sim-tid räknas INTE som flygtid — de är separata

LUFTFARTYGSTYP — viktigt:
- Står ofta i en smal kolumn, kan vara förkortat: "C172", "PA-28", "B737", "A320", "TB20", "DA40"
- Samma typ upprepas ofta på flera rader — om en rad saknar typ, ärv från närmaste föregående rad
- Skriv alltid utan bindestreck om det är oklart: "C172" inte "C-172"
- Om typen är helt oläslig, returnera "" och flagga den i field_issues

REGISTRATION — viktigt:
- Format: 2 bokstäver (landkod) + bindestreck + 3 bokstäver, t.ex. SE-KXY, OY-ABC, G-ABCD
- Ibland skrivs bara de sista 3 bokstäverna (t.ex. "KXY") — behåll då som det är
- Samma registration upprepas ofta på flera rader — om en rad saknar reg, ärv från föregående
- Förväxla inte O (bokstav) med 0 (nolla) i registration
- Om registration är oläslig, returnera "" och flagga den i field_issues

SEKVENTIELL RAD-FÖR-RAD-LÄSNING (VIKTIGT):
Läs raderna i ordning uppifrån och ned. Håll ett "rolling state" för varje kolumn
(senast sett riktigt värde). När du analyserar en ny rad — innan du returnerar
ett värde — uppdatera kolumnens state om raden innehåller ett nytt verkligt
värde. Kolumnstate används sedan för att lösa ditto-symboler och tomma fält på
efterföljande rader.

ARVSREGEL FÖR TOMMA FÄLT:
Om aircraft_type, registration, dep_place eller arr_place är tom på en rad men
föregående rad har värden, ärv dessa värden. UNDANTAG: ett simulatorpass med tom registreringscell har
ingen registrering — ärv aldrig flygplanets registrering till en sim-rad (bara om ett ditto-tecken står i
just den cellen).

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

Om en ditto-symbol står på sidans första rad utan föregående värde, lämna fältet
tomt och flagga det i field_issues med reason "Ditto with no value above".

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
- Appen räknar själv ut om avgång → ankomst går ihop med total_time och frågar användaren. Flagga INTE
  sådana avvikelser i field_issues — flagga bara siffror som är svårlästa.
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

HANDSKRIVEN ADDITION I TIDSFÄLT (VIKTIGT):
Piloter skriver ibland en addition direkt i ett tidsfält, t.ex. "1.2 + 0.2"
eller "0.8+0.4" istället för totalen. Beräkna summan och returnera resultatet
som ett enda decimalvärde (1.2 + 0.2 → 1.4, 0.8 + 0.4 → 1.2). Detta gäller
alla tidsfält: total_time, pic, co_pilot, dual, ifr, night, instructor, etc.
Flagga det INTE — det är ett vanligt skrivsätt och summan är entydig. "+ 0.2" sträcker sig ofta in i
nästa kolumn: det hör till tiden till vänster och är ALDRIG ett värde i nästa kolumn. Exempel: i Dual står
"1.3 + 0.2" och "+ 0.2" når in i kolumnen AR landings → dual = 1.5, och AR landings är tom på den raden.

ANMÄRKNINGAR OCH ANDREPILOT:
Remarks-kolumnen innehåller ofta andrepilotens/instruktörens initialer eller namn följt av anmärkningar
(t.ex. "SZ, NDB" eller "PUA, IFR RNAV"). Returnera remarks EXAKT som det står — inklusive initialer och
namn. Flytta dem inte och skicka inget förslag: appen känner själv igen initialer, namn, PICUS/SPIC/NVG och
frågar användaren en gång för hela boken. Sätt bara second_pilot om boken har en egen kolumn för det.
Säger remarks-kolumnens TRYCKTA rubrik att befälhavarens eller den andra pilotens namn skrivs där (t.ex.
"name of PIC", "name of PIC or if another"), sätt remarks_pilot_names = true. Är du osäker på hur ett namn
eller initialer i remarks ska läsas, flagga det i field_issues med field "remarks".

SIMULATOR (VIKTIGT): En kolumn med rubriken (tryckt eller handskriven) "Simulator", "Simulator time", "Sim",
"FSTD", "FFS", "FNPT" eller "Synthetic training" innehåller simulatortid. Lägg sådana värden i "sim" och sätt
flight_type="sim" — ALDRIG i dual, pic eller någon annan funktionstid. En rad som saknar total flygtid men har
simulatortid är ett simulatorpass: utelämna total_time (landningar som står skrivna på raden läses som vanligt
— simulatorlandningar räknas för recency). Ett tal i
simulatorkolumnen hör ALDRIG hemma i "Total time of flight" — kontrollera vilken kolumn talet faktiskt står i.
Funktionstid (PIC, Co-pilot, Dual, Instructor) kan aldrig vara längre än radens totala flygtid.

OTHER TYPE OF FLIGHT TIME (VIKTIGT):
Om scan-profilen anger other_flight_time-kolumner, läs värdena i dessa kolumner
för varje rad. Returnera dem som:
  "other_times": { "other_flight_time": 0.7, "other_flight_time_2": 0.0 }
  "other_time_labels": { "other_flight_time": "AR landings", "other_flight_time_2": "NVD" }

other_time_labels: läs kolumnhuvudet (kan vara handskrivet, t.ex. "AR landings",
"NVD", "NVG") och returnera det BARA på den första raden där kolumnen har ett värde — appen använder samma
rubrik för resten av sidan.
other_times: värdet i kolumnen för den raden. Utelämna tomma.

UNDANTAG: en kolumn vars rubrik betyder simulator ("Simulator time", "Sim", "FSTD" …) är INTE other_times —
värdet går till "sim" och raden får flight_type="sim" (se SIMULATOR). Kolumner som räknar något annat än tid
(t.ex. "AR landings" = antal autorotationslandningar) returneras som other_times med sin rubrik.

Flagga bara other_times i field_issues när rubriken saknas eller är oläslig — en tydlig rubrik behöver ingen
fråga. Användaren bekräftar annars vad tiden avser (NVG, NVD, etc.).

SIDVALIDERING:
- Om sidan har radsummor: kontrollera att radsumman matchar "Total this page"
- Kontrollera att "Brought forward" + "Total this page" = "Total to date"
- Returnera page_totals med fälten: brought_forward, total_this_page, total_to_date (alla som decimal, null om ej synliga)
- page_totals.this_page_by_field = ENDAST raden "Total this page" (inte "Brought forward" eller "Total to date",
  som står strax under/över och är mycket större) för VARJE kolumn som har en tryckt/skriven summa,
  med samma fältnamn som i flights: { "total_time": 14.6, "dual": 13.4, "sim": 4.2, "landings_day": 45, … }.
  Appen jämför radernas summa med dessa och flaggar kolumner som inte går ihop.
- Returnera page_numbers: de tryckta sidnumren på uppslaget ({left, right}, heltal eller null om ej synliga)

GEOMETRI (KRÄVS — appen ritar rutor direkt på bilden där användaren ska granska):
- Alla positioner i PROCENT (0–100) av HELA bilden du ser: x från vänsterkanten, y från överkanten. En decimal.
- grid.table_top = y för överkanten av första TRYCKTA flygningsraden (direkt under kolumnrubrikerna).
- grid.table_bottom = y för underkanten av sista TRYCKTA flygningsraden (direkt ovanför summeringsraderna
  "Total this page"/"Brought forward"). Räkna med tomma tryckta rader — tabellens hela höjd.
- grid.rows_printed = antal tryckta flygningsrader på sidan (ifyllda + tomma).
- grid.columns = en post per kolumn på BÅDA sidorna av uppslaget (även högersidans PIC, Co-pilot, Dual,
  Instructor, "Other type of flight time", Synthetic training, Landings day, Landings night och Remarks):
  { index, field, left, right }. index = kolumnens nummer i kolumnlistan (om en lista finns), field =
  fältnamnet (samma namn som i flights), left/right = kolumnens tryckta vänster- och högerlinje.
  field = det fält du lägger kolumnens VÄRDEN i. Har piloten skrivit en tid i en handskriven kolumn (t.ex.
  "Simulator time" under "Other type of flight time") och du returnerar den som sim, får DEN kolumnen field
  "sim" — inte en tryckt kolumn (t.ex. "Synthetic training session") där inget står. En tom tryckt kolumn
  utan värden får field null.
- Varje flygning: row_index = den TRYCKTA radpositionen (1 = översta raden), även om rader ovanför är tomma.
- field_issues-post: box { left, top, right, bottom } tätt runt det osäkra värdet — BARA när fältet saknar kolumn
  i grid.columns (annars räknar appen fram cellen själv).

ICAO-VALIDERING:
- ICAO-koder är alltid exakt 4 bokstäver
- Om koden verkar felaktig eller bara 3 bokstäver, flagga för granskning
- Det är fullt normalt att dep_place och arr_place är samma (övningsflyg, trafik­mönster, lokala rundflygningar) — flagga INTE detta
- En plats som inte matchar ett känt 4-bokstavs ICAO-mönster kan vara en
  off-airport-plats / ZZZZ (t.ex. ett fältnamn, en militärbas med lokal kod).
  Returnera den text du ser och flagga med field_issues om du är osäker.

LANDNINGAR: läs ALLTID kolumnen Landings (Day/Night) för varje rad och returnera landings_day och
landings_night med det tal som står där. Talen kan vara stora (t.ex. 7, 12, 20 vid skol- eller
landningsträning) — anta aldrig 1. Står kolumnen tom, utelämna fältet.

TOMMA FÄLT: Om en tidkolumn (pic, dual, ifr, night etc.) är tom → utelämna fältet (appen tolkar det som 0).
Varje flygning (ej sim) bör ha minst 1 landning — flagga om 0.

SPRÅK FÖR FÖRKLARINGAR: field_issues[].reason visas för piloten i appen — skriv den på ENGELSKA och kort
(högst 6 ord), t.ex. "Could be 3 or 8". suggested_value bara om det skiljer sig från värdet du returnerade.

KONFIDENS:
- field_issues: array med osäkra fält (confidence <0.85). Format:
  { "field": "...", "reason": "...", "confidence": 0.5, "suggested_value": "..." }
- Varje osäkerhet är en field_issues-post för just det fältet. Skriv aldrig om fotot (vinkel, skärpa,
  förskjutning, skuggor); appen hanterar det själv.

KOMPAKT SVAR (svarets längd styr tiden och kostnaden): ta bara med fält som har innehåll. Utelämna tomma
strängar, 0, null, false, tomma listor/objekt och flight_type "normal". Skriv inte needs_review,
review_reason eller remarks_suggestion — appen räknar ut dem. confidence med en decimal.

AIRCRAFT-DETEKTERING (KRITISKT):
Innan du returnerar flights-listan, gruppera de unika luftfartyg du sett på
sidan. Returnera fältet aircraft_detections[] på toppnivå. Varje entry:

{
  "as_written": "A109LUH",       // exakt det piloten skrev (inkl. stil/förkortning)
  "resolved": "A109",             // din bedömning av ICAO-typkoden
  "registration": "SE-JVC",       // första registrering du såg för denna typ
  "first_row": 1,                 // vilken rad på sidan den först dyker upp
  "confidence": 0.88              // hur säker du är på tolkningen
}

Om samma "as_written"-sträng återkommer på flera rader, behandla dem som samma
luftfartyg. Om piloten skrivit typen på två olika sätt (t.ex. "A109" och
"AW109"), kan det ändå vara samma maskin — gruppera då efter registrering när
den finns, annars separat.

Användaren får bekräfta aircraft_detections innan resten av reviewen visas.

Returnera ENBART ett JSON-objekt. Exempel (bara fält med innehåll; tomma tidkolumner, tomma listor och
standardvärden utelämnas):
{
  "aircraft_detections": [
    { "as_written": "C172", "resolved": "C172", "registration": "SE-ABC", "first_row": 1, "confidence": 0.95 }
  ],
  "flights": [
    { "row_index": 1, "date": "2024-05-12", "aircraft_type": "C172", "registration": "SE-ABC",
      "dep_place": "ESSB", "dep_utc": "09:10", "arr_place": "ESSB", "arr_utc": "10:40",
      "total_time": 1.5, "dual": 1.5, "landings_day": 4, "remarks": "Circuits" },
    { "row_index": 2, "date": "2024-05-14", "aircraft_type": "C172", "registration": "SE-ABC",
      "dep_place": "ESSB", "dep_utc": "13:05", "arr_place": "ESKN", "arr_utc": "14:00",
      "total_time": 0.9, "pic": 0.9, "landings_day": 1,
      "field_issues": [{ "field": "arr_utc", "reason": "Could be 0 or 6", "confidence": 0.6, "suggested_value": "14:06" }] }
  ],
  "page_totals": { "brought_forward": 120.4, "total_this_page": 2.4, "total_to_date": 122.8,
    "this_page_by_field": { "total_time": 2.4, "dual": 1.5, "pic": 0.9, "landings_day": 5 } },
  "page_numbers": { "left": 12, "right": 13 },
  "grid": { "table_top": 31.5, "table_bottom": 84.0, "rows_printed": 14,
    "columns": [{ "index": 1, "field": "date", "left": 2.1, "right": 7.8 }] }
}

Svara ENBART med ett anrop av verktyget emit_flights — ingen text före eller efter, inga förklaringar.`;

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

export async function ocrScanLogbook(timeFormat: TimeFormat = 'decimal', _imageUri?: string): Promise<OcrPageResult> {
  const scanImage = getScanImage();
  if (!scanImage) {
    throw new Error('No image found. Go back and choose an image again.');
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
  pageTotals: { brought_forward: number | null; total_this_page: number | null; total_to_date: number | null; by_field?: Record<string, number> };
  aircraftDetections: AircraftDetection[];
  pageNumbers: { left: number | null; right: number | null };
  remarksPilotNames?: boolean;   // remarks-rubriken säger att pilotens namn står där ("name of PIC")
  imageLayout: ImageLayout;
  grid: PageGrid | null;     // var rader och kolumner sitter i bilden (granskningsvyn)
};

// Hämtar den aktiva digitala bokens layout (eller null). Layouten är auktoritativ
// kolumnkarta för OCR och avgör om uppslaget kan delas vid ryggen (M4).
export async function getActiveBookLayout(): Promise<LogbookLayout | null> {
  try {
    const book = await getActiveDigitalBook();
    if (!book) return null;
    const tpl = await getAnyTemplate(book.template_id);
    if (!tpl) return null;
    let customCols: Record<string, string> = {};
    try { customCols = JSON.parse(book.custom_cols || '{}'); } catch { /* ignorera trasig JSON */ }
    return layoutFromTemplate(tpl, customCols);
  } catch {
    return null;
  }
}

// M4: delar ett uppslagsfoto i vänster/höger halva vid ryggen (leftWidthFraction).
// Returnerar null vid fel → anroparen faller tillbaka på ett hela-uppslag-anrop.
async function splitSpread(base64: string, leftFraction: number): Promise<{ left: string; right: string } | null> {
  const tmp = `${FileSystem.cacheDirectory}ocr_spread_tmp.jpg`;
  try {
    await FileSystem.writeAsStringAsync(tmp, base64, { encoding: FileSystem.EncodingType.Base64 });
    const info = await ImageManipulator.manipulateAsync(tmp, [], {});
    const W = info.width, H = info.height;
    if (!W || !H) return null;
    // Dela bara ett tydligt LIGGANDE uppslag. Är bilden ~kvadratisk/stående är den
    // troligen roterad/fel beskuren → delning vid bredd-% blir meningslös.
    if (W < H * 1.3) return null;
    // Härdning: kräv tillräcklig upplösning så varje halva blir användbar (>~800px).
    if (W < 1600) return null;
    const cut = Math.max(1, Math.min(W - 1, Math.round(W * leftFraction)));
    const opts = { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true };
    const left = await ImageManipulator.manipulateAsync(tmp, [{ crop: { originX: 0, originY: 0, width: cut, height: H } }], opts);
    const right = await ImageManipulator.manipulateAsync(tmp, [{ crop: { originX: cut, originY: 0, width: W - cut, height: H } }], opts);
    if (!left.base64 || !right.base64) return null;
    return { left: left.base64, right: right.base64 };
  } catch {
    return null;
  } finally {
    FileSystem.deleteAsync(tmp, { idempotent: true }).catch(() => {});
  }
}

// Kör ETT tool-use-anrop för en bild + given prompt-text.
async function runOcrCall(base64: string, mediaType: string, userText: string, model = OCR_MODEL): Promise<any> {
  const toolOpts = {
    model,
    system: SYSTEM_PROMPT,
    maxTokens: 16000,
    toolName: 'emit_flights',
    quotaWeight: scanQuotaWeight(),   // premium: en coin räcker till dubbelt så många tokens vid skanning (som proxyn)
    toolDescription: 'Returnera alla extraherade flygningsrader från loggbokssidan',
    inputSchema: OCR_TOOL_SCHEMA,
    userContent: [
      { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType, data: base64 } },
      { type: 'text' as const, text: userText },
    ],
  };
  return OCR_USE_STREAM
    ? callAnthropicToolStream<any>(toolOpts)
    : callAnthropicTool<any>(toolOpts);
}

// Gemensam efterbehandling: vokabulär-validering (M3). Best-effort.
async function finalizeResult(result: OcrPageResult, timeAddition = 0): Promise<OcrPageResult> {
  try {
    const vocab = await buildScanVocab();
    result.flights = validateAgainstVocab(result.flights, vocab);
  } catch { /* ignorera valideringsfel */ }

  // Deterministisk tids-avstämning (KOD, inte modellen): total_time är ankaret.
  // Om (ankomst − avgång) avviker > 6 min flaggas raden och time_mismatch-kandidater
  // räknas exakt här. Hoppar sim (ingen blocktid) och rader utan giltig dep/arr.
  result.flights = result.flights.map((f) => {
    if (f.flight_type === 'sim') return f;
    const anchor = parseFloat(String(f.total_time ?? '').replace(',', '.'));
    const rec = reconcileBlockTime(f.dep_utc, f.arr_utc, anchor);
    if (!rec) return f;                                            // dep/arr saknas/ogiltig
    // Bokens bekräftade tillägg (t.ex. +0.2 h för helikopter) räknas bort före jämförelsen.
    const recAdd = timeAddition > 0 && anchor - timeAddition > 0 ? reconcileBlockTime(f.dep_utc, f.arr_utc, anchor - timeAddition) : null;
    if (!rec.mismatch || (recAdd && !recAdd.mismatch)) {
      const ours = !!f.review_reason?.startsWith('Time:');
      if (!f.time_mismatch && !ours) return f;
      return { ...f, time_mismatch: undefined, ...(ours ? { needs_review: false, review_reason: undefined } : {}) }; // rensa falskt larm
    }
    return {
      ...f,
      needs_review: true,
      review_reason: f.review_reason || 'Time: (arrival − departure) ≠ total — confirm which is correct',
      time_mismatch: {
        anchor_total_h: anchor,
        read_dep: f.dep_utc,
        read_arr: f.arr_utc,
        computed_dep_if_arr_correct: rec.computedDepIfArrCorrect,
        computed_arr_if_dep_correct: rec.computedArrIfDepCorrect,
      },
    };
  });
  return result;
}

// Skanna EN sida direkt från base64 — för batch-import.
// Accepterar kontext från föregående sida för ditto-upplösning.
export async function ocrScanPage(
  base64: string,
  mediaType: string,
  timeFormat: TimeFormat = 'decimal',
  prevContext?: PageContext,
  // layout: bokens format läst i "Scan your whole logbook" (scanFormat) — används i stället för den digitala bokens.
  opts: { useBookLayout?: boolean; layout?: LogbookLayout | null; timeAddition?: number; focus?: 'exact' | 'balanced' | 'totals'; model?: string; wholeSpread?: boolean } = {},
): Promise<OcrPageResult> {
  const model = opts.model ?? OCR_MODEL;
  let baseContext = '';
  const add = opts.timeAddition && opts.timeAddition > 0 ? opts.timeAddition : 0;
  // Användarens fokus: färre frågor (field_issues) om sådant som inte är viktigt för hen → kortare svar.
  if (opts.focus === 'balanced') {
    baseContext += `\n\nANVÄNDARENS FOKUS: flygningarna ska stämma i huvudsak och summorna exakt. Läs tidskolumner, landningar och sidans summor (this_page_by_field) noggrant. Flagga (field_issues) bara osäkerhet i datum, typ, registrering, platser, tidskolumner och landningar — inte i klockslag, namn eller anmärkningar.`;
  } else if (opts.focus === 'totals') {
    baseContext += `\n\nANVÄNDARENS FOKUS: bara summorna. Läs tidskolumnerna, landningarna och sidans summor (Brought forward, Total this page per kolumn i this_page_by_field, Total to date) exakt — det är det viktigaste i svaret. Flagga (field_issues) bara osäkra siffror i tidskolumner och landningar. Flagga inte datum, platser, klockslag, typ, registrering, namn eller anmärkningar.`;
  }
  if (add) {
    baseContext += `\n\nTILLÄGG PÅ FLYGTIDEN (pilotens bekräftade regel för den här loggboken): total flygtid = (ankomst − avgång) + ${add} h. Avgång och ankomst är lyft och landning; uppstart, taxi och avstängning läggs till. En rad där total = (ankomst − avgång) + ${add} h är RÄTT: sätt inte time_mismatch, needs_review eller field_issues för det, och ändra inga tider. Står tillägget skrivet i en cell ("1.2 + ${add}") är värdet summan (${(1.2 + add).toFixed(1)}) — i ALLA tidskolumner (total, Dual, PIC …), aldrig bara första talet.`;
  }
  if (prevContext) {
    // += (inte =): annars försvann fokus och tillägget ovan på varje sida efter den första.
    baseContext += `\n\nKONTEXT FRÅN FÖREGÅENDE SIDA (sida ${prevContext.page_number ?? '?'}):\nSista radens värden: date="${prevContext.last_date}", aircraft_type="${prevContext.last_aircraft_type}", registration="${prevContext.last_registration}", dep_place="${prevContext.last_dep_place}", arr_place="${prevContext.last_arr_place}"\nAnvänd dessa som rolling state för ditto-symboler på denna sidas FÖRSTA rad.`;
  }
  // Bifoga inlärda mappningar från tidigare skanningar
  const learnedHint = await buildContextHint();
  if (learnedHint) baseContext += `\n\n${learnedHint}`;

  const omitNote = ' Utelämna alla fält som är 0, tomma eller saknas — de tolkas automatiskt som 0/tom. Returnera bara fält och rader med verkligt innehåll. Schemat ovan är illustrativt, inte ett krav att fylla varje fält. Anropa emit_flights direkt, utan någon text.';

  // Robusthet för verkliga foton: marginaler, rotation, kant-beskurna/svaga rader.
  const captureNote = ' OM FOTOT: Boken fyller kanske inte hela bilden — ignorera mörk bakgrund/yta runt omkring. Bilden kan vara roterad (vänd) — läs den oavsett orientering. Läs VARJE rad i flygnings-tabellen, även svaga, ljusa eller delvis skymda kant-rader; hoppa ALDRIG över en rad bara för att en kant är beskuren — returnera raden ändå och flagga det som är osäkert i field_issues. Returnera lika många rader som tabellen faktiskt har ifyllda — aldrig fler än det finns tryckta rader.';

  const t0 = Date.now();
  const secs = () => ((Date.now() - t0) / 1000).toFixed(1);
  // Användaren kan ha sagt att den fotade boken inte har samma upplägg som boken i appen.
  const layout = opts.layout !== undefined ? opts.layout : opts.useBookLayout === false ? null : await getActiveBookLayout();
  console.log(`[OCR] ▶ Skanning startar (${model}). ${opts.layout ? 'Bokens skannade format' : 'Aktiv bok-layout'}: ${layout ? `JA (${layout.pageMode}, ${layout.columns.length} kol)` : 'NEJ'}`);

  // ── M4: dela uppslaget vid ryggen och läs en sida per anrop (parallellt) ──
  // wholeSpread (skanningsgranskningen): aldrig delat. Ryggens läge i mallen stämmer inte med ett foto som
  // beskurits automatiskt (det varierar från foto till foto), och kolumnerna kopplades då fel.
  if (OCR_SPLIT_SPREAD && !opts.wholeSpread && layout && layout.pageMode === 'spread') {
    const halves = await splitSpread(base64, layout.leftWidthFraction);
    if (halves) {
      console.log(`[OCR] ✂️  Uppslag delat vid ${Math.round(layout.leftWidthFraction * 100)}% — läser vänster+höger parallellt...`);
      try {
        const sideText = (side: 'left' | 'right') =>
          `${timeFormatHint(timeFormat)} Extrahera alla flygningar från denna loggbokssida.${omitNote}${captureNote}${buildSideLayoutContext(layout, side)}${baseContext}`;
        const [lp, rp] = await Promise.all([
          runOcrCall(halves.left, mediaType, sideText('left'), model),
          runOcrCall(halves.right, mediaType, sideText('right'), model),
        ]);
        const lf = layout.leftWidthFraction;
        const lpFull = remapHalf(lp, 0, lf, layout.columns.filter((c) => c.page === 'left'));
        const rpFull = remapHalf(rp, lf * 100, 1 - lf, layout.columns.filter((c) => c.page === 'right'));
        const merged = mergeSpreadParsed(lpFull, rpFull);
        if (merged) {
          console.log(`[OCR] ✅ SPLIT-VÄG AKTIV — vänster+höger ihopslaget, ${merged.flights.length} rader, ${secs()}s`);
          const result = parseOcrResponse(merged);
          result.grid = buildPageGrid(combineHalfGrids(lpFull?.grid, rpFull?.grid), layout, null);
          return finalizeResult(result, add);
        }
        console.log(`[OCR] ⚠️  Split lästes men merge blev osäker (vänster ${lp?.flights?.length ?? 0} / höger ${rp?.flights?.length ?? 0} rader) — faller tillbaka.`);
      } catch (e) {
        console.log('[OCR] ⚠️  Split-anrop misslyckades, faller tillbaka:', e);
      }
    } else {
      console.log('[OCR] ⚠️  Bilddelning misslyckades — faller tillbaka på hela uppslaget.');
    }
  }

  // ── Fallback / enkelsida: läs hela bilden i ett anrop ──
  let contextHint = baseContext;
  if (layout) {
    contextHint += buildLayoutContext(layout);
  }
  const parsed = await runOcrCall(
    base64,
    mediaType,
    `${timeFormatHint(timeFormat)} Extrahera alla flygningar från denna loggbokssida.${omitNote}${captureNote}${contextHint}`,
    model,
  );
  const result = parseOcrResponse(parsed);
  // Kolumnerna kopplas till fält via mallens nummer — utom i skanningsgranskningen, där Claude anger fältet
  // direkt (numren i en mall från en tidigare skanning stämmer inte alltid med kolumnerna Claude ser).
  result.grid = buildPageGrid(parsed?.grid, layout, layout && !opts.wholeSpread ? layout.columns.map((c) => ({ field: c.field, label: c.label })) : null, !!opts.wholeSpread);
  console.log(`[OCR] 📄 HELA-UPPSLAG-VÄG (ett anrop) — ${result.flights.length} rader, ${secs()}s`);
  return finalizeResult(result, add);
}

// Halvsidans geometri (procent av halvan) → hela uppslaget: x = offset + x·scale. Kolumnernas index i
// sidans egen lista byts mot fält och rubrik, så att vänster och höger kan läggas i samma rutnät.
function remapHalf(parsed: any, offsetPct: number, scale: number, sideCols: { field: string | null; label: string }[]): any {
  if (!parsed || typeof parsed !== 'object') return parsed;
  const grid: RawGrid | undefined = parsed.grid && typeof parsed.grid === 'object'
    ? {
        ...parsed.grid,
        columns: (Array.isArray(parsed.grid.columns) ? parsed.grid.columns : []).map((c: any) => {
          const idx = Number(c?.index);
          const col = Number.isFinite(idx) && idx >= 1 && idx <= sideCols.length ? sideCols[idx - 1] : null;
          return { left: c?.left, right: c?.right, field: col?.field ?? c?.field, label: col?.label ?? c?.field };
        }),
      }
    : undefined;
  const flights = Array.isArray(parsed.flights)
    ? parsed.flights.map((fl: any) => ({
        ...fl,
        field_issues: Array.isArray(fl?.field_issues)
          ? fl.field_issues.map((i: any) => ({
              ...i,
              box: remapBoxX(i?.box, offsetPct, scale),
              x_pct: typeof i?.x_pct === 'number' ? offsetPct + i.x_pct * scale : i?.x_pct,
            }))
          : fl?.field_issues,
      }))
    : parsed.flights;
  return { ...parsed, flights, grid: remapRawGridX(grid, offsetPct, scale) };
}

function combineHalfGrids(a: RawGrid | undefined, b: RawGrid | undefined): RawGrid | undefined {
  if (!a && !b) return undefined;
  const avg = (x?: number, y?: number) => {
    const xs = [x, y].map(Number).filter(Number.isFinite);
    return xs.length ? xs.reduce((s, n) => s + n, 0) / xs.length : undefined;
  };
  return {
    table_top: avg(a?.table_top, b?.table_top),
    table_bottom: avg(a?.table_bottom, b?.table_bottom),
    columns: [...(a?.columns ?? []), ...(b?.columns ?? [])],
  };
}

// Gemensam parser — används av både ocrScanLogbook och ocrScanPage
function parseOcrResponse(parsed: any): OcrPageResult {
  // Rubriken för "Other type of flight time" skrivs bara på första raden med värde (kortare svar) → ärvs nedåt.
  let lastLabels: Record<string, string> | undefined;
  const flights: OcrFlightResult[] = (parsed.flights ?? []).map((f: any) => {
    if (f.other_time_labels && typeof f.other_time_labels === 'object' && Object.keys(f.other_time_labels).length) lastLabels = { ...lastLabels, ...f.other_time_labels };
    else if (f.other_times && typeof f.other_times === 'object' && lastLabels) f = { ...f, other_time_labels: lastLabels };
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
            box: i.box && typeof i.box === 'object' ? {
              left: Number(i.box.left), top: Number(i.box.top), right: Number(i.box.right), bottom: Number(i.box.bottom),
            } : undefined,
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
      total_time: f.flight_type === 'sim' && (f.sim > 0 || f.total_time === 0 || f.total_time === '0')
        ? String(f.sim ?? f.total_time ?? '0')
        : String(f.total_time ?? '0'),
      ifr: String(f.ifr ?? '0'),
      night: String(f.night ?? '0'),
      pic: String(f.pic ?? '0'),
      co_pilot: String(f.co_pilot ?? '0'),
      dual: String(f.dual ?? '0'),
      landings_day: String(f.landings_day ?? '0'),   // utelämnat = tom cell (simulatorpass, eller inget skrivet)
      landings_night: String(f.landings_night ?? '0'),
      remarks: f.remarks ?? '',
      flight_type: f.flight_type === 'sim' ? 'sim' : f.flight_type === 'touch_and_go' ? 'touch_and_go' : 'normal',
      // Simulatortiden: utan den fick ett simulatorpass rätt total men tom simulatortid (rapporten visade
      // "Simulator 0 vs 4.2"). Står bara total på en sim-rad är total = simulatortiden.
      sim: Number(f.sim) > 0 ? String(f.sim) : f.flight_type === 'sim' && Number(f.total_time) > 0 ? String(f.total_time) : undefined,
      sim_category: f.sim_category !== undefined ? String(f.sim_category) : undefined,
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
      other_times: f.other_times && typeof f.other_times === 'object'
        ? Object.fromEntries(Object.entries(f.other_times).map(([k, v]) => [k, Number(v) || 0]))
        : undefined,
      other_time_labels: f.other_time_labels && typeof f.other_time_labels === 'object'
        ? Object.fromEntries(Object.entries(f.other_time_labels).map(([k, v]) => [k, String(v ?? '')]))
        : undefined,
      // Claude skriver inte needs_review längre: en rad behöver granskas när den har en osäker cell.
      needs_review: Boolean(f.needs_review) || fieldIssues.length > 0,
      review_reason: f.review_reason ?? undefined,
      remarks_suggestion: validSuggestion,
      time_mismatch: validMismatch,
      overall_confidence: overallConfidence,
      row_y_pct: typeof f.row_y_pct === 'number' ? f.row_y_pct : undefined,
      row_index: Number.isFinite(Number(f.row_index)) && Number(f.row_index) > 0 ? Number(f.row_index) : undefined,
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
      by_field: numberMap(pt.this_page_by_field),
    },
    aircraftDetections: detections,
    pageNumbers: {
      left: typeof pn.left === 'number' ? pn.left : null,
      right: typeof pn.right === 'number' ? pn.right : null,
    },
    remarksPilotNames: parsed.remarks_pilot_names === true,
    imageLayout: {
      orientation: parsed.image_layout?.orientation === 'portrait' ? 'portrait' : 'landscape',
      logbook_bounds: {
        x_pct: Number(parsed.image_layout?.logbook_bounds?.x_pct ?? 0),
        y_pct: Number(parsed.image_layout?.logbook_bounds?.y_pct ?? 0),
        w_pct: Number(parsed.image_layout?.logbook_bounds?.w_pct ?? 100),
        h_pct: Number(parsed.image_layout?.logbook_bounds?.h_pct ?? 100),
      },
    },
    grid: null,   // sätts i ocrScanPage, som vet vilken kolumnlista skannern fick
  };
}

// { fält: tal } ur Claudes svar; annat än tal filtreras bort.
function numberMap(x: any): Record<string, number> | undefined {
  if (!x || typeof x !== 'object') return undefined;
  return Object.fromEntries(Object.entries(x).filter(([, v]) => Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)]));
}

export interface AircraftDetection {
  as_written: string;
  resolved: string;
  registration: string;
  first_row: number;
  rows: number[];
  confidence: number;
}
