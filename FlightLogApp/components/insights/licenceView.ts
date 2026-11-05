// Det Next licence-kortet och dess helskärm (LicenceFull) delar: vilken licens som är vald, och licenskraven för
// pilotens kategori. Kategorin (H/A) kommer från FLOTTAN, inte profilens subRole: bara rotary → H, bara fixed → A,
// båda → kategorin på den senast flugna farkosten. Faller tillbaka på subRole om ingen farkostkategori är känd.

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { licenceSetFor } from '../EASAProgressChart';
import { useProfileStore } from '../../store/profileStore';
import { useRegulationStandardStore } from '../../store/regulationStandardStore';
import { useFlightStore } from '../../store/flightStore';
import { getAircraftCategory } from '../../db/flights';

export type LicId = 'ppl' | 'cpl' | 'atpl';
export const LIC_IDS: LicId[] = ['ppl', 'cpl', 'atpl'];

// null = nästa licens.
export const useLicenceView = create<{ sel: LicId | null }>(() => ({ sel: null }));

export function useLicenceSet() {
  const subRole = useProfileStore((s) => s.profile?.subRole);
  const standard = useRegulationStandardStore((s) => s.standard);
  const flights = useFlightStore((s) => s.flights);
  const [fleetCat, setFleetCat] = useState<'rotary' | 'fixed' | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const real = flights.filter((f) => f.flight_type !== 'sim' && f.aircraft_type?.trim());
      if (!real.length) { if (alive) setFleetCat(null); return; }
      const types = [...new Set(real.map((f) => f.aircraft_type.trim().toUpperCase()))];
      const cat = new Map<string, string>();
      await Promise.all(types.map(async (t) => cat.set(t, await getAircraftCategory(t))));
      let hasRotary = false, hasFixed = false;
      for (const t of types) {
        const c = cat.get(t);
        if (c === 'helicopter') hasRotary = true;
        else if (c === 'airplane') hasFixed = true;
      }
      let result: 'rotary' | 'fixed' | null = null;
      if (hasRotary && !hasFixed) result = 'rotary';
      else if (hasFixed && !hasRotary) result = 'fixed';
      else if (hasRotary && hasFixed) {
        const latest = [...real].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
        const lc = cat.get(latest.aircraft_type.trim().toUpperCase());
        result = lc === 'helicopter' ? 'rotary' : lc === 'airplane' ? 'fixed' : null;
      }
      if (alive) setFleetCat(result);
    })();
    return () => { alive = false; };
  }, [flights]);
  return { standard, flights, set: standard === 'other' ? null : licenceSetFor(fleetCat ?? subRole, standard) };
}
