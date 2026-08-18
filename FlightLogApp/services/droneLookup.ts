import { callAnthropicJson } from './anthropicClient';
import { fetchDroneImage } from './aircraftLookup';

// Text-baserad drönar-uppslagning (speglar services/aircraftLookup.ts men för UAS).
// Användaren skriver fri text ("Mavic 3", "Matrice 350", "Autel EVO II") → AI returnerar
// modell, tillverkare, airframe (multirotor/single-rotor/fixed-wing) och MTOW i gram.
export interface DroneLookupResult {
  model: string;             // "Mavic 3 Pro"
  manufacturer: string;      // "DJI"
  drone_type: 'multirotor' | 'helicopter' | 'fixedwing' | 'vtol' | '';
  mtow_g: number;            // max startvikt i gram (0 om okänt)
  c_class: string;           // EU-klassmärkning "C0"–"C6" ('' om okänt/omärkt)
  max_flight_min: number;    // max flygtid/uthållighet i minuter (0 om okänt)
  max_speed_kmh: number;     // max hastighet i km/h (0 om okänt)
  ceiling_m: number;         // max tjänstetak/höjd över havet i meter (0 om okänt)
  range_km: number;          // max länk-/sändningsräckvidd i km (0 om okänt)
  confidence: number;        // 0–1
  evidence: string;
  needs_manual: boolean;
}

const SYSTEM_PROMPT = `Du är en expert på drönare/UAS. Användaren skriver fri text (t.ex. "Mavic 3",
"Mini 4 Pro", "Matrice 350 RTK", "Autel EVO II", "senseFly eBee X", "Wingtra One") och du ska
identifiera drönaren och returnera data som JSON.

REGLER:
- Tolka skrivsättet generöst: "mavic3", "DJI Mavic 3", "mavic 3 pro" = tolkas rimligt
- Om texten är för vag (t.ex. bara "DJI" eller "drone") → needs_manual=true
- model: så specifikt som möjligt (t.ex. "Mavic 3 Pro", "Mini 4 Pro", "Matrice 350 RTK")
- manufacturer: t.ex. "DJI", "Autel Robotics", "Parrot", "senseFly", "Wingtra"
- drone_type: en av
  * "multirotor"  = quadcopter/hexa/octo (de flesta konsument-/inspektionsdrönare)
  * "helicopter"  = single-rotor helikopterdrönare
  * "fixedwing"   = fast vinge (kartläggning, t.ex. eBee)
  * "vtol"        = fast vinge med vertikal start/landning (t.ex. WingtraOne)
- mtow_g: max startvikt (MTOW) i GRAM (heltal). Använd publicerade specifikationer.
  Ex: Mini 4 Pro ~249, Air 3 ~720, Mavic 3 ~958, Matrice 350 RTK ~9200. Gissa inte runda tal;
  sänk confidence om osäker.
- c_class: EU:s klassmärkning "C0","C1","C2","C3","C4","C5","C6" om drönaren är klassmärkt.
  Ex: Mini 4 Pro = "C0", Air 3 = "C1", Mavic 3 Enterprise = "C2". Tom sträng om omärkt/okänt.
- max_flight_min: max flygtid (uthållighet) i MINUTER (heltal). 0 om okänt.
- max_speed_kmh: max hastighet i KM/H (heltal). 0 om okänt.
- ceiling_m: max tjänstetak/höjd i METER (heltal). 0 om okänt.
- range_km: max länk-/sändningsräckvidd i KM (decimal ok). 0 om okänt.
- Fyll bara i värden du är rimligt säker på; annars 0/"" och sänk confidence.

OUTPUT (svara ENBART med JSON):
{
  "model": "string",
  "manufacturer": "string",
  "drone_type": "multirotor" | "helicopter" | "fixedwing" | "vtol" | "",
  "mtow_g": number,
  "c_class": "string",
  "max_flight_min": number,
  "max_speed_kmh": number,
  "ceiling_m": number,
  "range_km": number,
  "confidence": 0.0-1.0,
  "evidence": "string",
  "needs_manual": boolean
}`;

export async function lookupDrone(query: string): Promise<DroneLookupResult> {
  const q = query.trim();
  if (!q) throw new Error('Tomt sökord.');

  const parsed = await callAnthropicJson<any>({
    system: SYSTEM_PROMPT,
    maxTokens: 500,
    userContent: `Identifiera drönaren: "${q}". Svara ENBART med JSON-objektet.`,
  });
  const confidence = Number(parsed.confidence) || 0;
  const drone_type: DroneLookupResult['drone_type'] =
    ['multirotor', 'helicopter', 'fixedwing', 'vtol'].includes(parsed.drone_type) ? parsed.drone_type : '';
  const cRaw = String(parsed.c_class ?? '').toUpperCase().trim();
  const c_class = /^C[0-6]$/.test(cRaw) ? cRaw : '';

  return {
    model: String(parsed.model ?? ''),
    manufacturer: String(parsed.manufacturer ?? ''),
    drone_type,
    mtow_g: Math.round(Number(parsed.mtow_g) || 0),
    c_class,
    max_flight_min: Math.round(Number(parsed.max_flight_min) || 0),
    max_speed_kmh: Math.round(Number(parsed.max_speed_kmh) || 0),
    ceiling_m: Math.round(Number(parsed.ceiling_m) || 0),
    range_km: Math.round((Number(parsed.range_km) || 0) * 10) / 10,
    confidence,
    evidence: String(parsed.evidence ?? ''),
    needs_manual: Boolean(parsed.needs_manual) || confidence < 0.5,
  };
}

// Full Fleet-uppslagning + bild (= aircraftLookup.enrichAircraftFleet, för drönare).
// Anropas av drönar-Fleet-kortets hämta-knapp: AI identifierar modell/tillverkare, sedan
// hämtas en Wikipedia-bild via den delade fetchAircraftImage (gratis, ingen extra token).
export interface DroneFleetEnrichment {
  manufacturer: string;
  drone_type: DroneLookupResult['drone_type'];
  mtow_g: number;
  c_class: string;
  max_flight_min: number;
  max_speed_kmh: number;
  ceiling_m: number;
  range_km: number;
  image_url: string;
  needs_manual: boolean;
}

export async function enrichDroneFleet(query: string): Promise<DroneFleetEnrichment> {
  const r = await lookupDrone(query);
  // Rika kandidater (tillverkare + modell först) → bredare bildsök (Wikipedia + Commons).
  const candidates = [
    `${r.manufacturer} ${r.model}`.trim(),
    r.model,
    `${r.manufacturer} ${r.model} drone`.trim(),
    query,
  ].filter(Boolean);
  const image_url = await fetchDroneImage(candidates);
  return {
    manufacturer: r.manufacturer,
    drone_type: r.drone_type,
    mtow_g: r.mtow_g,
    c_class: r.c_class,
    max_flight_min: r.max_flight_min,
    max_speed_kmh: r.max_speed_kmh,
    ceiling_m: r.ceiling_m,
    range_km: r.range_km,
    image_url,
    needs_manual: r.needs_manual,
  };
}
