// Bakgrundsberikning av Fleet-data (spec + bild) så korten är kompletta när man öppnar Fleet-sidan,
// utan att man manuellt trycker "hämta" på varje kort. Körs TYST (inga alerts) och token-gated
// (stannar när engångs-/månadspotten är slut → resten kan hämtas manuellt via kortets knapp).
import { enrichAircraftFleet, fetchAircraftImage, type AircraftLookupResult } from './aircraftLookup';
import { persistAircraftFleetLookup, updateAircraftFleetFields, getAllAircraftTypes } from '../db/flights';
import { hasTokenQuota } from '../utils/tokenGate';

let running = false;

/** Full berikning (AI-spec + Wikipedia-bild) för typer som saknar Fleet-data. Ges `types` berikas de;
 *  utan argument sveper den alla oberikade typer (t.ex. efter CSV-import). Sekventiellt + token-gated. */
export async function enrichFleetInBackground(types?: string[]): Promise<number> {
  if (running) { console.log('[fleetEnrich] already running → skip'); return 0; } // en körning i taget
  running = true;
  let enriched = 0; // antal typer som faktiskt berikades (för "klart"-notisen)
  try {
    let list = types?.map((t) => t.trim().toUpperCase()).filter(Boolean);
    if (!list) {
      const all = await getAllAircraftTypes();
      // Oberikad = varken bild eller kärn-Fleet-spec (maker/VNE) satt.
      list = all.filter((a) => !a.image_url && !a.maker && !a.vne).map((a) => a.aircraft_type);
      console.log(`[fleetEnrich] registry=${all.length} types; un-enriched candidates=${list.length}:`, list);
      console.log('[fleetEnrich] detail:', all.map((a) => `${a.aircraft_type}[img:${a.image_url ? 'Y' : 'n'} maker:${a.maker ? 'Y' : 'n'} vne:${a.vne || 0}]`).join('  '));
    }
    console.log(`[fleetEnrich] start: hasTokenQuota=${hasTokenQuota()} · toEnrich=${list.length}`);
    for (const t of list) {
      if (!hasTokenQuota()) { console.log('[fleetEnrich] token quota exhausted → stop'); break; }
      if (!t) continue;
      try {
        console.log(`[fleetEnrich] enriching ${t}…`);
        const r = await enrichAircraftFleet(t);
        await persistAircraftFleetLookup(t, r);
        enriched++;
        console.log(`[fleetEnrich] ✓ ${t} (image=${r.image_url ? 'yes' : 'NO'}, maker="${r.manufacturer}")`);
      } catch (e: any) { console.log(`[fleetEnrich] ✗ ${t}: ${e?.message ?? e}`); }
    }
  } catch (e: any) {
    console.log('[fleetEnrich] FATAL:', e?.message ?? e);
  } finally {
    running = false;
  }
  console.log(`[fleetEnrich] DONE. enriched=${enriched}`);
  return enriched;
}

/** Berika från ett REDAN gjort smart-search-resultat → ingen extra AI-kostnad: spara hela specen och
 *  hämta bilden (Wikipedia) i bakgrunden. Används när användaren la till en typ via smart search. */
export async function enrichFromLookup(type: string, r: AircraftLookupResult): Promise<void> {
  const t = type.trim().toUpperCase();
  if (!t) return;
  try {
    await persistAircraftFleetLookup(t, r);
    const img = await fetchAircraftImage([r.wiki_title, `${r.manufacturer} ${r.model}`.trim(), r.model, t]);
    if (img) await updateAircraftFleetFields(t, { image_url: img });
  } catch { /* tyst */ }
}
