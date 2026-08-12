import { callAnthropicJson } from './anthropicClient';

// Text-baserad drönar-uppslagning (speglar services/aircraftLookup.ts men för UAS).
// Användaren skriver fri text ("Mavic 3", "Matrice 350", "Autel EVO II") → AI returnerar
// modell, tillverkare, airframe (multirotor/single-rotor/fixed-wing) och MTOW i gram.
export interface DroneLookupResult {
  model: string;             // "Mavic 3 Pro"
  manufacturer: string;      // "DJI"
  drone_type: 'multirotor' | 'helicopter' | 'fixedwing' | 'vtol' | '';
  mtow_g: number;            // max startvikt i gram (0 om okänt)
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

OUTPUT (svara ENBART med JSON):
{
  "model": "string",
  "manufacturer": "string",
  "drone_type": "multirotor" | "helicopter" | "fixedwing" | "vtol" | "",
  "mtow_g": number,
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

  return {
    model: String(parsed.model ?? ''),
    manufacturer: String(parsed.manufacturer ?? ''),
    drone_type,
    mtow_g: Math.round(Number(parsed.mtow_g) || 0),
    confidence,
    evidence: String(parsed.evidence ?? ''),
    needs_manual: Boolean(parsed.needs_manual) || confidence < 0.5,
  };
}
