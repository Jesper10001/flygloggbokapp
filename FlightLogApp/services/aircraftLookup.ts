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

KÄNDA REFERENSER (hämtas inte från nät):
- C172 Skyhawk: airplane, se, sp, 120 kt, 4.5 h
- C152: airplane, se, sp, 95 kt, 3.5 h
- C182: airplane, se, sp, 140 kt, 5.0 h
- PA28 Cherokee/Warrior: airplane, se, sp, 115 kt, 4.0 h
- DA40 Diamond Star: airplane, se, sp, 140 kt, 5.0 h
- DA42 Twin Star: airplane, me, sp,mp, 170 kt, 6.0 h
- SR22 Cirrus: airplane, se, sp, 175 kt, 6.0 h
- PC12 Pilatus: airplane, se, sp,mp, 280 kt, 8.0 h
- TBM 900/930/940: airplane, se, sp,mp, 310 kt, 6.0 h
- TB20 Trinidad: airplane, se, sp, 155 kt, 6.0 h
- C208 Caravan: airplane, se, sp,mp, 185 kt, 6.0 h
- BE58 Baron: airplane, me, sp,mp, 200 kt, 5.0 h
- King Air C90/200/250/350: airplane, me, sp,mp, 270 kt, 6.0 h
- Cessna Citation Mustang / CJ1-4: airplane, me, sp,mp, 380 kt, 4.5 h
- Cessna 414 / 421: airplane, me, sp,mp, 225 kt, 5.5 h
- A320 / A321 / A319: airplane, me, mp, 447 kt, 5.5 h
- B737-800 / NG: airplane, me, mp, 453 kt, 6.0 h
- B737 MAX: airplane, me, mp, 453 kt, 7.0 h
- A220: airplane, me, mp, 470 kt, 6.0 h
- ATR72: airplane, me, mp, 275 kt, 5.0 h
- DHC-8 Q400: airplane, me, mp, 360 kt, 4.5 h
- Saab 340: airplane, me, mp, 285 kt, 4.0 h
- E190: airplane, me, mp, 450 kt, 4.5 h
- B747 / B777 / B787 / A330 / A340 / A350 / A380: airplane, me, mp, 490 kt, 14.0 h
- R22 Robinson: helicopter, se, sp, 96 kt, 2.3 h
- R44 Robinson: helicopter, se, sp, 110 kt, 3.0 h
- R66 Turbine: helicopter, se, sp, 125 kt, 3.5 h
- B206 JetRanger: helicopter, se, sp, 117 kt, 3.4 h
- B407 Bell 407: helicopter, se, sp, 133 kt, 2.8 h
- B412 Bell 412: helicopter, me, sp,mp, 125 kt, 3.5 h
- B429 Bell 429: helicopter, me, sp,mp, 135 kt, 3.2 h
- AS350 / H125 Écureuil: helicopter, se, sp, 140 kt, 3.5 h
- AS355 Twin Squirrel: helicopter, me, sp,mp, 120 kt, 3.5 h
- H145 / EC145 / BK117: helicopter, me, sp,mp, 135 kt, 3.5 h
- EC120 Colibri: helicopter, se, sp, 125 kt, 3.5 h
- EC130 / H130: helicopter, se, sp, 140 kt, 3.5 h
- EC135 / H135: helicopter, me, sp,mp, 135 kt, 3.3 h
- EC155: helicopter, me, sp,mp, 145 kt, 4.2 h
- AW109: helicopter, me, sp,mp, 154 kt, 3.0 h
- AW139: helicopter, me, sp,mp, 165 kt, 5.0 h
- AW169: helicopter, me, sp,mp, 155 kt, 4.5 h
- S76 Sikorsky: helicopter, me, sp,mp, 145 kt, 3.5 h
- S92: helicopter, me, sp,mp, 151 kt, 4.5 h
- MD500 / MD520N: helicopter, se, sp, 135 kt, 2.5 h
- MD902 Explorer: helicopter, me, sp,mp, 140 kt, 3.5 h
- Bo105: helicopter, me, sp,mp, 131 kt, 3.5 h
- MI-8 / MI-17: helicopter, me, sp,mp, 135 kt, 4.5 h
- NH90: helicopter, me, mp, 150 kt, 4.0 h
- CH-47 Chinook: helicopter, me, mp, 160 kt, 5.0 h
- AS332 Super Puma / EC225: helicopter, me, mp, 150 kt, 4.5 h

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
  "confidence": 0.0-1.0,
  "evidence": "string",
  "needs_manual": boolean
}`;

export async function lookupAircraft(query: string): Promise<AircraftLookupResult> {
  const q = query.trim();
  if (!q) throw new Error('Tomt sökord.');

  const parsed = await callAnthropicJson<any>({
    system: SYSTEM_PROMPT,
    maxTokens: 500,
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
    confidence,
    evidence: String(parsed.evidence ?? ''),
    needs_manual: Boolean(parsed.needs_manual) || confidence < 0.5,
  };
}
