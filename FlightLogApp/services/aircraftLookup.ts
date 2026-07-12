import { callAnthropicJson } from './anthropicClient';

export interface AircraftLookupResult {
  aircraft_type: string;     // ICAO-typkod (C172, A320, EC35)
  manufacturer: string;      // "Robinson Helicopter Company"
  model: string;             // "R44 Raven II"
  category: 'airplane' | 'helicopter' | '';
  engine_type: 'se' | 'me' | '';
  crew_type: string;         // 'sp', 'mp' eller 'sp,mp'
  cruise_speed_kts: number;
  endurance_h: number;
  vne_kt: number;            // VNE (never exceed speed) i knop — endast för Fleet-kort
  mtow_kg: number;           // MTOW (max takeoff weight) i kg — endast för Fleet-kort
  consumption: number;       // bränsleförbrukning — endast för Fleet-kort
  consumption_unit: string;  // 'l/h' (kolv/turboprop) eller 'kg/h' (jet)
  horsepower_hp: number;     // motoreffekt i hp/shp; 0 för jets
  ceiling_ft: number;        // tjänstetak (service ceiling) i fot
  wingspan_m: number;        // spännvidd i meter (helikopter: rotordiameter)
  empty_weight_kg: number;   // tomvikt (OEW) i kg — endast för Fleet-kort
  fuel_capacity_l: number;   // bränslekapacitet i liter — endast för Fleet-kort
  range_nm: number;          // räckvidd i nautiska mil — endast för Fleet-kort
  wiki_title: string;        // bästa engelska Wikipedia-titeln — för bildhämtning
  confidence: number;        // 0–1
  evidence: string;          // kort anteckning
  needs_manual: boolean;
}

const SYSTEM_PROMPT = `Du är en expert på flygplan och helikoptrar. Användaren skriver fri text
(t.ex. "R44", "A320", "C172SP", "Bell 407", "Piper Warrior") och du ska identifiera
luftfartyget och returnera EASA-typ-relevant data som JSON.

REGLER:
- Tolka skrivsättet generöst: "A320", "airbus 320", "A-320" = samma sak
- Vanliga förkortningar: C172 = Cessna 172, PA28 = Piper Cherokee, R44 = Robinson R44,
  EC35 = Eurocopter EC135, B206 = Bell 206, AS350 = Airbus AS350 (H125)
- Om användaren bara skriver "Cessna" (för vagt) → needs_manual=true
- aircraft_type: använd ICAO-typkod (t.ex. "C172", "A320", "R44", "EC35", "B407")
- category: airplane eller helicopter
- engine_type: "se" (single engine) eller "me" (multi engine)
- crew_type: "sp" (single pilot), "mp" (multi-pilot) eller "sp,mp" om typen är
  certad för BÅDA. Viktigt: många typer har dual-cert där både SP- och MP-piloter
  lagligt flyger samma typ — returnera då ALLTID "sp,mp", inte bara "sp".

  REGLER:
  * Airliners (A320/A330/A350/B737/B747/B777/B787/E190 etc.) = "mp" (bara MP-cert)
  * Små privatplan utan MP-cert (C152/C172/PA28/DA40/SR22/TB20 etc.) = "sp"
  * Små enmotoriga helikoptrar utan MP-cert (R22/R44/R66/B206/B407/AS350/H130/EC120) = "sp"
  * Kommuter/turboprop med dual-cert (PC-12, TBM, King Air 350, Caravan, DHC-6) = "sp,mp"
  * Medium twins med dual-cert (BE58 Baron, Cessna 414/421, DA42) = "sp,mp"
  * Helikoptrar med dual-cert (EC135/H135, EC145/H145, AW109, AW169, Bell 412, Bell 429,
    Bo105, MD902, Mi-8/Mi-17, AS355) = "sp,mp"
  * Tunga/offshore-helikoptrar där MP normalt krävs men SP-varianter finns (S76, S92,
    AW139) = "sp,mp"
  * Rent MP-only helikoptrar (NH90, CH-47, CH-53, AS332 Super Puma, EC225) = "mp"

  Principen: om piloter LAGLIGT flyger typen som single-pilot i någon operation
  (t.ex. VFR-privat, HEMS, offshore-SP-konfig), inkludera "sp" även om typen ofta
  flygs MP kommersiellt.
- cruise_speed_kts: typisk TAS i knop (heltal)
- endurance_h: typisk endurance i timmar (decimal, max 1 decimal)
- vne_kt: VNE i knop (heltal). För jets utan publicerad VNE: ange VMO i knop. ANVÄND värdet
  ur referenstabellen nedan när typen finns där. För övriga typer: använd publicerade
  POH/typcertifikat-värden (TCDS), aldrig påhittade runda tal. Sänk confidence om du är osäker.
- mtow_kg: MTOW (max takeoff weight) i kg (heltal). Samma princip — referenstabellen i första
  hand, annars POH/TCDS. Konvertera lb→kg (×0.4536) vid behov.
- consumption + consumption_unit: typisk bränsleförbrukning. Kolv/turboprop → liter/timme
  ('l/h'); jets → kg/timme ('kg/h'). Referenstabellen i första hand. Gissa inte runda tal.
- horsepower_hp: motoreffekt i hp/shp (heltal, per motor). Jets saknar hp → returnera 0.
- ceiling_ft: tjänstetak (service ceiling) i fot (heltal).
- wingspan_m: spännvidd i meter (1 decimal). För helikoptrar: huvudrotorns diameter i meter.
- empty_weight_kg: tomvikt / OEW i kg (heltal). Referenstabellen i första hand, annars POH/TCDS.
- fuel_capacity_l: användbar bränslekapacitet i liter (heltal). Referenstabellen i första hand.
- range_nm: typisk maxräckvidd i nautiska mil (heltal). Referenstabellen i första hand.
- wiki_title: den mest sannolika engelska Wikipedia-artikeltiteln för typen (t.ex. "Cessna 172",
  "Airbus A320", "Robinson R44", "Eurocopter EC135", "Bell 407"). Används för att hämta en bild.

KÄNDA REFERENSER — kurerade POH/TCDS-värden
(cruise kt, endurance h · VNE kt, MTOW kg · consumption, power hp, ceiling ft, wingspan/rotor m):
- C172 Skyhawk: airplane, se, sp · 120, 4.5 · VNE 163, MTOW 1157 · 38 l/h, 180 hp, 14000 ft, 11.0 m
- C152: airplane, se, sp · 95, 3.5 · VNE 149, MTOW 757 · 23 l/h, 110 hp, 14700 ft, 10.0 m
- C182: airplane, se, sp · 140, 5.0 · VNE 175, MTOW 1406 · 55 l/h, 230 hp, 18100 ft, 11.0 m
- PA28 Cherokee/Warrior: airplane, se, sp · 115, 4.0 · VNE 160, MTOW 1055 · 32 l/h, 160 hp, 14000 ft, 10.7 m
- DA40 Diamond Star: airplane, se, sp · 140, 5.0 · VNE 178, MTOW 1200 · 30 l/h, 180 hp, 16400 ft, 11.9 m
- DA42 Twin Star: airplane, me, sp,mp · 170, 6.0 · VNE 188, MTOW 1785 · 38 l/h, 168 hp, 18000 ft, 13.4 m
- SR22 Cirrus: airplane, se, sp · 175, 6.0 · VNE 204, MTOW 1633 · 64 l/h, 310 hp, 17500 ft, 11.7 m
- PC12 Pilatus: airplane, se, sp,mp · 280, 8.0 · VNE 240, MTOW 4740 · 280 l/h, 1200 hp, 30000 ft, 16.2 m
- TBM 900/930/940: airplane, se, sp,mp · 310, 6.0 · VNE 266, MTOW 3354 · 220 l/h, 850 hp, 31000 ft, 12.8 m
- TB20 Trinidad: airplane, se, sp · 155, 6.0 · VNE 187, MTOW 1400 · 45 l/h, 250 hp, 20000 ft, 9.8 m
- C208 Caravan: airplane, se, sp,mp · 185, 6.0 · VNE 175, MTOW 3629 · 210 l/h, 675 hp, 25000 ft, 15.9 m
- BE58 Baron: airplane, me, sp,mp · 200, 5.0 · VNE 223, MTOW 2495 · 100 l/h, 300 hp, 20700 ft, 11.5 m
- King Air C90/200/250/350: airplane, me, sp,mp · 270, 6.0 · VNE 259, MTOW 5670 · 400 l/h, 850 hp, 35000 ft, 16.6 m
- Cessna Citation Mustang / CJ1-4: airplane, me, sp,mp · 380, 4.5 · VNE 263, MTOW 5670 · 600 kg/h, 0 hp, 41000 ft, 13.2 m
- Cessna 414 / 421: airplane, me, sp,mp · 225, 5.5 · VNE 213, MTOW 3379 · 150 l/h, 375 hp, 30000 ft, 12.5 m
- A320 / A321 / A319: airplane, me, mp · 447, 5.5 · VNE 350, MTOW 78000 · 2500 kg/h, 0 hp, 39000 ft, 35.8 m
- B737-800 / NG: airplane, me, mp · 453, 6.0 · VNE 340, MTOW 79000 · 2500 kg/h, 0 hp, 41000 ft, 35.8 m
- B737 MAX: airplane, me, mp · 453, 7.0 · VNE 340, MTOW 82200 · 2400 kg/h, 0 hp, 41000 ft, 35.9 m
- A220: airplane, me, mp · 470, 6.0 · VNE 340, MTOW 70900 · 2000 kg/h, 0 hp, 41000 ft, 35.1 m
- ATR72: airplane, me, mp · 275, 5.0 · VNE 250, MTOW 22800 · 650 kg/h, 2475 hp, 25000 ft, 27.1 m
- DHC-8 Q400: airplane, me, mp · 360, 4.5 · VNE 286, MTOW 29257 · 1100 kg/h, 5071 hp, 27000 ft, 28.4 m
- Saab 340: airplane, me, mp · 285, 4.0 · VNE 250, MTOW 13155 · 500 kg/h, 1750 hp, 25000 ft, 21.4 m
- E190: airplane, me, mp · 450, 4.5 · VNE 320, MTOW 51800 · 1800 kg/h, 0 hp, 41000 ft, 28.7 m
- B747/777/787/A330/A340/A350/A380: airplane, me, mp · 490, 14.0 · VNE 350, MTOW varierar (B777 ~351000, A380 ~575000) · konsumtion varierar 6000–11000 kg/h, 0 hp, 43000 ft, wingspan varierar 60–80 m
- R22 Robinson: helicopter, se, sp · 96, 2.3 · VNE 102, MTOW 622 · 30 l/h, 124 hp, 14000 ft, 7.7 m
- R44 Robinson: helicopter, se, sp · 110, 3.0 · VNE 130, MTOW 1089 · 58 l/h, 245 hp, 14000 ft, 10.1 m
- R66 Turbine: helicopter, se, sp · 125, 3.5 · VNE 140, MTOW 1225 · 95 l/h, 270 hp, 14000 ft, 10.1 m
- B206 JetRanger: helicopter, se, sp · 117, 3.4 · VNE 130, MTOW 1520 · 110 l/h, 420 hp, 13500 ft, 10.2 m
- B407 Bell 407: helicopter, se, sp · 133, 2.8 · VNE 140, MTOW 2495 · 160 l/h, 813 hp, 18700 ft, 10.7 m
- B412 Bell 412: helicopter, me, sp,mp · 125, 3.5 · VNE 140, MTOW 5398 · 400 l/h, 900 hp, 20000 ft, 14.0 m
- B429 Bell 429: helicopter, me, sp,mp · 135, 3.2 · VNE 155, MTOW 3175 · 230 l/h, 625 hp, 20000 ft, 11.0 m
- AS350 / H125 Écureuil: helicopter, se, sp · 140, 3.5 · VNE 155, MTOW 2250 · 180 l/h, 847 hp, 23000 ft, 10.7 m
- AS355 Twin Squirrel: helicopter, me, sp,mp · 120, 3.5 · VNE 150, MTOW 2600 · 230 l/h, 420 hp, 11150 ft, 10.7 m
- H145 / EC145 / BK117: helicopter, me, sp,mp · 135, 3.5 · VNE 150, MTOW 3700 · 320 l/h, 894 hp, 17000 ft, 11.0 m
- EC120 Colibri: helicopter, se, sp · 125, 3.5 · VNE 150, MTOW 1715 · 120 l/h, 504 hp, 17000 ft, 10.0 m
- EC130 / H130: helicopter, se, sp · 140, 3.5 · VNE 155, MTOW 2500 · 180 l/h, 847 hp, 23000 ft, 10.7 m
- EC135 / H135: helicopter, me, sp,mp · 135, 3.3 · VNE 155, MTOW 2980 · 280 l/h, 633 hp, 20000 ft, 10.2 m
- EC155: helicopter, me, sp,mp · 145, 4.2 · VNE 175, MTOW 4920 · 450 l/h, 935 hp, 15000 ft, 12.6 m
- AW109: helicopter, me, sp,mp · 154, 3.0 · VNE 168, MTOW 3175 · 300 l/h, 735 hp, 19600 ft, 11.0 m
- AW139: helicopter, me, sp,mp · 165, 5.0 · VNE 167, MTOW 6800 · 500 l/h, 1679 hp, 20000 ft, 13.8 m
- AW169: helicopter, me, sp,mp · 155, 4.5 · VNE 165, MTOW 4800 · 400 l/h, 1000 hp, 15000 ft, 12.0 m
- S76 Sikorsky: helicopter, me, sp,mp · 145, 3.5 · VNE 155, MTOW 5307 · 450 l/h, 1050 hp, 15000 ft, 13.4 m
- S92: helicopter, me, sp,mp · 151, 4.5 · VNE 165, MTOW 12568 · 900 l/h, 2520 hp, 15000 ft, 17.2 m
- MD500 / MD520N: helicopter, se, sp · 135, 2.5 · VNE 152, MTOW 1610 · 130 l/h, 450 hp, 16000 ft, 8.3 m
- MD902 Explorer: helicopter, me, sp,mp · 140, 3.5 · VNE 150, MTOW 2835 · 280 l/h, 700 hp, 18000 ft, 10.3 m
- Bo105: helicopter, me, sp,mp · 131, 3.5 · VNE 145, MTOW 2500 · 230 l/h, 420 hp, 17000 ft, 9.8 m
- MI-8 / MI-17: helicopter, me, sp,mp · 135, 4.5 · VNE 135, MTOW 13000 · 800 l/h, 2070 hp, 19700 ft, 21.3 m
- NH90: helicopter, me, mp · 150, 4.0 · VNE 162, MTOW 10600 · 600 l/h, 2480 hp, 20000 ft, 16.3 m
- CH-47 Chinook: helicopter, me, mp · 160, 5.0 · VNE 170, MTOW 22680 · 1500 l/h, 4733 hp, 20000 ft, 18.3 m
- AS332 Super Puma / EC225: helicopter, me, mp · 150, 4.5 · VNE 150, MTOW 11200 · 700 l/h, 2270 hp, 15000 ft, 16.2 m

OUTPUT (svara ENBART med JSON):
{
  "aircraft_type": "string",
  "manufacturer": "string",
  "model": "string",
  "category": "airplane" | "helicopter" | "",
  "engine_type": "se" | "me" | "",
  "crew_type": "sp" | "mp" | "sp,mp" | "",
  "cruise_speed_kts": number,
  "endurance_h": number,
  "vne_kt": number,
  "mtow_kg": number,
  "consumption": number,
  "consumption_unit": "l/h" | "kg/h",
  "horsepower_hp": number,
  "ceiling_ft": number,
  "wingspan_m": number,
  "empty_weight_kg": number,
  "fuel_capacity_l": number,
  "range_nm": number,
  "wiki_title": "string",
  "confidence": 0.0-1.0,
  "evidence": "string",
  "needs_manual": boolean
}`;

export async function lookupAircraft(query: string): Promise<AircraftLookupResult> {
  const q = query.trim();
  if (!q) throw new Error('Tomt sökord.');

  const parsed = await callAnthropicJson<any>({
    system: SYSTEM_PROMPT,
    maxTokens: 800,
    userContent: `Identifiera luftfartyget: "${q}". Svara ENBART med JSON-objektet.`,
  });
  const confidence = Number(parsed.confidence) || 0;
  const category: AircraftLookupResult['category'] =
    parsed.category === 'airplane' || parsed.category === 'helicopter' ? parsed.category : '';
  const engine_type: AircraftLookupResult['engine_type'] =
    parsed.engine_type === 'se' || parsed.engine_type === 'me' ? parsed.engine_type : '';
  const crew_type = ['sp', 'mp', 'sp,mp'].includes(parsed.crew_type) ? parsed.crew_type : '';

  return {
    aircraft_type: String(parsed.aircraft_type ?? '').toUpperCase(),
    manufacturer: String(parsed.manufacturer ?? ''),
    model: String(parsed.model ?? ''),
    category,
    engine_type,
    crew_type,
    cruise_speed_kts: Math.round(Number(parsed.cruise_speed_kts) || 0),
    endurance_h: Math.round((Number(parsed.endurance_h) || 0) * 10) / 10,
    vne_kt: Math.round(Number(parsed.vne_kt) || 0),
    mtow_kg: Math.round(Number(parsed.mtow_kg) || 0),
    consumption: Math.round(Number(parsed.consumption) || 0),
    consumption_unit: parsed.consumption_unit === 'kg/h' ? 'kg/h' : 'l/h',
    horsepower_hp: Math.round(Number(parsed.horsepower_hp) || 0),
    ceiling_ft: Math.round(Number(parsed.ceiling_ft) || 0),
    wingspan_m: Math.round((Number(parsed.wingspan_m) || 0) * 10) / 10,
    empty_weight_kg: Math.round(Number(parsed.empty_weight_kg) || 0),
    fuel_capacity_l: Math.round(Number(parsed.fuel_capacity_l) || 0),
    range_nm: Math.round(Number(parsed.range_nm) || 0),
    wiki_title: String(parsed.wiki_title ?? ''),
    confidence,
    evidence: String(parsed.evidence ?? ''),
    needs_manual: Boolean(parsed.needs_manual) || confidence < 0.5,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fleet-berikning (steg 2): hämtas på begäran via "hämta"-knappen på Fleet-korten.
// Slår upp full spec + en öppet licensierad bild från Wikipedia/Wikimedia Commons.
// ─────────────────────────────────────────────────────────────────────────────

export interface AircraftFleetEnrichment {
  manufacturer: string;
  vne_kt: number;
  mtow_kg: number;
  consumption: number;
  consumption_unit: string;
  horsepower_hp: number;
  ceiling_ft: number;
  wingspan_m: number;
  empty_weight_kg: number;
  fuel_capacity_l: number;
  range_nm: number;
  image_url: string;
  needs_manual: boolean;
  // Grunddata — så Fleet-hämtningen kan override:a felaktig manuell inmatning.
  cruise_speed_kts: number;
  endurance_h: number;
  category: 'airplane' | 'helicopter' | '';
  engine_type: 'se' | 'me' | '';
  crew_type: string;
}

/** Hämtar en bild-URL (öppen källa) för en titel via Wikipedias pageimages-API. */
async function wikiImage(title: string): Promise<string> {
  const t = title.trim();
  if (!t) return '';
  const url = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=pageimages&piprop=thumbnail&pithumbsize=900&redirects=1&titles=${encodeURIComponent(t)}`;
  try {
    const res = await fetch(url, { headers: { 'Api-User-Agent': 'FlightLogApp/1.0 (logbook app)' } });
    if (!res.ok) return '';
    const data = await res.json();
    const pages = data?.query?.pages;
    if (!pages) return '';
    for (const k of Object.keys(pages)) {
      const src = pages[k]?.thumbnail?.source;
      if (typeof src === 'string' && src) return src;
    }
    return '';
  } catch {
    return '';
  }
}

/** Provar flera kandidattitlar i tur och ordning; returnerar första bild som hittas. */
export async function fetchAircraftImage(candidates: string[]): Promise<string> {
  const seen = new Set<string>();
  for (const c of candidates) {
    const key = c.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const img = await wikiImage(c);
    if (img) return img;
  }
  return '';
}

/** Full Fleet-uppslagning + bild. Anropas av Fleet-kortets hämta-knapp. */
export async function enrichAircraftFleet(query: string): Promise<AircraftFleetEnrichment> {
  const r = await lookupAircraft(query);
  const candidates = [r.wiki_title, `${r.manufacturer} ${r.model}`.trim(), r.model, query];
  const image_url = await fetchAircraftImage(candidates);
  return {
    manufacturer: r.manufacturer,
    vne_kt: r.vne_kt,
    mtow_kg: r.mtow_kg,
    consumption: r.consumption,
    consumption_unit: r.consumption_unit,
    horsepower_hp: r.horsepower_hp,
    ceiling_ft: r.ceiling_ft,
    wingspan_m: r.wingspan_m,
    empty_weight_kg: r.empty_weight_kg,
    fuel_capacity_l: r.fuel_capacity_l,
    range_nm: r.range_nm,
    image_url,
    needs_manual: r.needs_manual,
    cruise_speed_kts: r.cruise_speed_kts,
    endurance_h: r.endurance_h,
    category: r.category,
    engine_type: r.engine_type,
    crew_type: r.crew_type,
  };
}
