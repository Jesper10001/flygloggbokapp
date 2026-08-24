// Bakgrundsberikning av Fleet-data (spec + bild) så korten är kompletta när man öppnar Fleet-sidan,
// utan att man manuellt trycker "hämta" på varje kort. Körs TYST (inga alerts) och token-gated
// (stannar när engångs-/månadspotten är slut → resten kan hämtas manuellt via kortets knapp).
import { enrichAircraftFleet, fetchAircraftImage, type AircraftLookupResult } from './aircraftLookup';
import { persistAircraftFleetLookup, updateAircraftFleetFields, getAllAircraftTypes } from '../db/flights';
import { hasTokenQuota } from '../utils/tokenGate';

let running = false;

/** Full berikning (AI-spec + Wikipedia-bild) för typer som saknar Fleet-data. Ges `types` berikas de;
 *  utan argument sveper den alla oberikade typer (t.ex. efter CSV-import). Sekventiellt + token-gated. */
export async function enrichFleetInBackground(types?: string[]): Promise<void> {
  if (running) return; // en körning i taget → hamra inte API:t
  running = true;
  try {
    let list = types?.map((t) => t.trim().toUpperCase()).filter(Boolean);
    if (!list) {
      const all = await getAllAircraftTypes();
      // Oberikad = varken bild eller kärn-Fleet-spec (maker/VNE) satt.
      list = all.filter((a) => !a.image_url && !a.maker && !a.vne).map((a) => a.aircraft_type);
    }
    for (const t of list) {
      if (!hasTokenQuota()) break; // potten slut → låt resten hämtas manuellt senare
      if (!t) continue;
      try {
        const r = await enrichAircraftFleet(t);
        await persistAircraftFleetLookup(t, r);
      } catch { /* tyst — kortets hämta-knapp finns kvar som reserv */ }
    }
  } finally {
    running = false;
  }
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
