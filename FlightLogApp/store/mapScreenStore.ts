// Medan en helskärmskarta med Apple-kartan är öppen (Best week och Longest XC med uppspelning) väntar appens egna
// popup-rutor (GlassDialog), samma regel som för delningsrutan: en native Modal ovanpå kartan kan låsa skärmen på iOS.
import { create } from 'zustand';

export const useMapScreenStore = create<{ open: boolean }>(() => ({ open: false }));
