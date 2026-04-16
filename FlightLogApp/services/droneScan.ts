import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { callAnthropicJson } from './anthropicClient';

export interface DroneScanResult {
  model: string;             // ex. "Mavic 3 Pro" eller "" om okänd
  manufacturer: string;      // ex. "DJI"
  drone_type: 'multirotor' | 'fixedwing' | 'vtol' | 'helicopter' | '';
  confidence: number;        // 0–1
  evidence: string;          // korta ord om vad som gav klassificeringen
  suggested_mtow_g: number;  // 0 om okänt
  suggested_category_civil: string;   // A1/A2/A3/Specific/Certified eller ''
  suggested_category_military: string; // MRPAS/RPAS eller ''
  notes: string;             // fri text (ev. osäkerhet, tillverkningsår, varning)
  needs_manual: boolean;     // true om AI är ≤ 0.5 säker
}

const SYSTEM_PROMPT = `Du är en expert på att identifiera drönare från foto.

UPPGIFT:
Titta på bilden och identifiera drönarmodellen. Var försiktig — gissa ALDRIG
om du är under 80% säker. Skriv då "unknown" och sätt needs_manual=true.

NÄR DU ÄR SÄKER:
- Ge tillverkare (t.ex. "DJI", "Autel", "Parrot", "Skydio", "AeroVironment")
- Ge modell så specifikt som möjligt (t.ex. "Mavic 3 Pro", "Mini 4 Pro", "Matrice 30T")
- Bedöm typ: multirotor / fixedwing / vtol / helicopter
- Föreslå MTOW i gram om du vet specarna
- Föreslå EASA Open-kategori (A1/A2/A3) baserat på MTOW och C-märkning om synlig
  * < 250 g → A1
  * 250–899 g → A1 om C1-märkt, annars A2 med C2-cert
  * 900–3999 g → A2 (med C2) eller A3
  * > 4 kg → A3 eller Specific
  * ≥ 25 kg → Certified
- Föreslå militär motsvarighet:
  * < 25 kg MTOW → MRPAS
  * ≥ 25 kg MTOW → RPAS
  * Om osäkert, lämna tomt

VANLIGA MODELLER (kan stämma bra):
- DJI Mavic 3 / 3 Pro / 3 Classic (895 g / 958 g / 895 g) — A2 med C2
- DJI Mavic 3 Enterprise (915 g) — A2/Specific
- DJI Mini 2/3/4 Pro (249 g) — A1
- DJI Air 2S / Air 3 (595 g / 720 g) — A2 med C2
- DJI Matrice 30/30T (3770 g) — Specific
- DJI Matrice 350 RTK (6470 g) — Specific
- DJI Phantom 4 Pro (1388 g) — A2
- Autel EVO II / Lite+ (~1100 g) — A2
- Skydio 2+ (800 g), Skydio X10 (2000 g)
- Parrot Anafi (320 g), Anafi USA (500 g)
- AeroVironment Puma 3 AE (6300 g) — militär MRPAS
- Teledyne Black Hornet 4 (33 g) — militär MRPAS
- AeroVironment Switchblade 300 (2500 g) — loitering munition

FÖRVÄXLA INTE:
- Mavic-klonar har ofta tunnare armar och enklare kamerapod
- Mini 3 vs Mini 4 Pro: Mini 4 Pro har dubbla frontsensorer (hinderavkänning)
- Matrice 30 vs Matrice 350: 350 har fyra motorer i X, 30 är kompaktare

OUTPUT-FORMAT (JSON, svara ENBART med JSON, inget annat):
{
  "model": "string",
  "manufacturer": "string",
  "drone_type": "multirotor" | "fixedwing" | "vtol" | "helicopter" | "",
  "confidence": 0.0-1.0,
  "evidence": "string",
  "suggested_mtow_g": number,
  "suggested_category_civil": "A1" | "A2" | "A3" | "Specific" | "Certified" | "",
  "suggested_category_military": "MRPAS" | "RPAS" | "",
  "notes": "string",
  "needs_manual": boolean
}`;

async function imageToBase64(uri: string): Promise<{ base64: string; mediaType: string }> {
  const prepared = await ImageManipulator.manipulateAsync(
    uri,
    [{ resize: { width: 1600 } }],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG },
  );
  const base64 = await FileSystem.readAsStringAsync(prepared.uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return { base64, mediaType: 'image/jpeg' };
}

export async function scanDroneImage(uri: string): Promise<DroneScanResult> {
  const { base64, mediaType } = await imageToBase64(uri);

  const parsed = await callAnthropicJson<any>({
    system: SYSTEM_PROMPT,
    maxTokens: 600,
    userContent: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
      { type: 'text', text: 'Identifiera drönaren i bilden. Svara ENBART med JSON-objektet.' },
    ],
  });
  const confidence = Number(parsed.confidence) || 0;
  return {
    model: String(parsed.model ?? ''),
    manufacturer: String(parsed.manufacturer ?? ''),
    drone_type: (['multirotor', 'fixedwing', 'vtol', 'helicopter'].includes(parsed.drone_type)
      ? parsed.drone_type : '') as DroneScanResult['drone_type'],
    confidence,
    evidence: String(parsed.evidence ?? ''),
    suggested_mtow_g: Number(parsed.suggested_mtow_g) || 0,
    suggested_category_civil: String(parsed.suggested_category_civil ?? ''),
    suggested_category_military: String(parsed.suggested_category_military ?? ''),
    notes: String(parsed.notes ?? ''),
    needs_manual: Boolean(parsed.needs_manual) || confidence < 0.5,
  };
}
