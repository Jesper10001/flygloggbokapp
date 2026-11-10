// Medan en karta med Apple-kartan är öppen i helskärm eller i ett eget fönster (Global map, Visited airports,
// Best week och Longest XC med uppspelning) väntar appens popup-rutor: GlassDialog, "Update available" och
// systemrutorna (services/alertGuard.ts). Samma regel som för delningsrutan: ett fönster som öppnas ovanpå kartan
// kan låsa hela skärmen på iOS. Kartorna anmäler sig med useHoldPopups; flera kan vara öppna samtidigt (räknare).
import { useEffect } from 'react';
import { create } from 'zustand';

export const useMapScreenStore = create<{ open: boolean; count: number }>(() => ({ open: false, count: 0 }));

const hold = (d: 1 | -1) => useMapScreenStore.setState((s) => {
  const count = Math.max(0, s.count + d);
  return { count, open: count > 0 };
});
// Kartans fönster glider undan en stund efter att det stängts; en ruta som öppnas mitt i det kan också låsa.
const RELEASE_MS = 550;

/** Håll appens popup-rutor borta så länge `active` är sant (kartan syns), och en kort stund efter. */
export function useHoldPopups(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    hold(1);
    return () => { setTimeout(() => hold(-1), RELEASE_MS); };
  }, [active]);
}
