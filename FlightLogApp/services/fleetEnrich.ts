// Bakgrundsberikning av Fleet-data (spec + bild) så korten är kompletta när man öppnar Fleet-sidan,
// utan att man manuellt trycker "hämta" på varje kort. Körs TYST (inga alerts) och token-gated
// (stannar när engångs-/månadspotten är slut → resten kan hämtas manuellt via kortets knapp).
import { enrichAircraftFleet, fetchAircraftImage, type AircraftLookupResult } from './aircraftLookup';
import { persistAircraftFleetLookup, updateAircraftFleetFields, getAllAircraftTypes } from '../db/flights';
import { hasTokenQuota, isTokenQuotaError } from '../utils/tokenGate';

let running = false;

export interface FleetEnrichResult {
  enriched: number;        // antal typer som faktiskt berikades
  total: number;           // antal kandidater som skulle berikas
  remaining: number;       // ej hämtade (pausade när Blade-coins tog slut)
  stoppedForQuota: boolean; // true = pausade pga slut på coins (resten kräver uppgradering)
}

/** Full berikning (AI-spec + Wikipedia-bild) för typer som saknar Fleet-data. Ges `types` berikas de;
 *  utan argument sveper den alla oberikade typer (t.ex. efter CSV-import). Sekventiellt + coin-gated:
 *  hämtar SÅ MÅNGA potten räcker till och PAUSAR sen (faller inte) — resten kräver fler Blade-coins. */
export async function enrichFleetInBackground(types?: string[]): Promise<FleetEnrichResult> {
  if (running) { console.log('[fleetEnrich] already running → skip'); return { enriched: 0, total: 0, remaining: 0, stoppedForQuota: false }; }
  running = true;
  let enriched = 0, processed = 0, total = 0, stoppedForQuota = false;
  try {
    let list = types?.map((t) => t.trim().toUpperCase()).filter(Boolean);
    if (!list) {
      const all = await getAllAircraftTypes();
      // Oberikad = varken bild eller kärn-Fleet-spec (maker/VNE) satt.
      list = all.filter((a) => !a.image_url && !a.maker && !a.vne).map((a) => a.aircraft_type);
      console.log(`[fleetEnrich] registry=${all.length} types; un-enriched candidates=${list.length}:`, list);
      console.log('[fleetEnrich] detail:', all.map((a) => `${a.aircraft_type}[img:${a.image_url ? 'Y' : 'n'} maker:${a.maker ? 'Y' : 'n'} vne:${a.vne || 0}]`).join('  '));
    }
    total = list.length;
    console.log(`[fleetEnrich] start: hasTokenQuota=${hasTokenQuota()} · toEnrich=${total}`);
    for (const t of list) {
      // Slut på Blade-coins → pausa här; resten står kvar och kan hämtas efter uppgradering.
      if (!hasTokenQuota()) { stoppedForQuota = true; console.log('[fleetEnrich] out of Blade-coins → pause'); break; }
      if (!t) { processed++; continue; }
      try {
        console.log(`[fleetEnrich] enriching ${t}…`);
        const r = await enrichAircraftFleet(t);
        await persistAircraftFleetLookup(t, r);
        enriched++;
        console.log(`[fleetEnrich] ✓ ${t} (image=${r.image_url ? 'yes' : 'NO'}, maker="${r.manufacturer}")`);
      } catch (e: any) {
        // Race: potten tog slut mitt i ett anrop (proxyns 429) → pausa i stället för att fortsätta.
        if (isTokenQuotaError(e)) { stoppedForQuota = true; console.log('[fleetEnrich] proxy 429 → pause'); break; }
        console.log(`[fleetEnrich] ✗ ${t}: ${e?.message ?? e}`);
      }
      processed++;
    }
  } catch (e: any) {
    console.log('[fleetEnrich] FATAL:', e?.message ?? e);
  } finally {
    running = false;
  }
  const remaining = Math.max(0, total - processed);
  console.log(`[fleetEnrich] DONE. enriched=${enriched}/${total} · stoppedForQuota=${stoppedForQuota} · remaining=${remaining}`);
  return { enriched, total, remaining, stoppedForQuota };
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
