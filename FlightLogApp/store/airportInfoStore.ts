// Airport Info (Info-kortet): PPR, bränsle, öppettider, kontakt, Good to know per flygplats. Hämtas från proxyns
// GET /airport-info (grunddata ur AIP + flygplatsernas egna hemsidor, ändringar via Blades Ops), sparas i telefonen
// och frågas om med ETag (304 = oförändrat). Bara flygplatser med uppgifter finns med (Sverige först).
import { create } from 'zustand';
import * as FileSystem from 'expo-file-system/legacy';

export type InfoRec = {
  kind: 'aip' | 'web' | 'ops';
  ppr?: { s: 'required' | 'not_required' | 'partial' | 'unknown'; n?: string; ph?: string; url?: string };
  fuel?: { t?: string[]; n?: string; h?: string };
  hours?: { ad?: string; n?: string };
  contacts?: { l: string; ph: string }[];
  gtk?: string[];
  web?: string;
  email?: string;
  src?: { t: string; url: string }[];
  v?: string; // senast verifierad (datum)
};

const PROXY_URL = (process.env.EXPO_PUBLIC_PROXY_URL ?? '').replace(/\/+$/, '');
const FILE = `${FileSystem.documentDirectory ?? ''}airport-info.json`;
const REFRESH_MS = 60 * 60 * 1000;
let checkedAt = 0;
let fromDisk = false;

interface Store {
  version: string;
  airports: Record<string, InfoRec>;
  load: () => Promise<void>;
}

export const useAirportInfoStore = create<Store>((set, get) => ({
  version: '',
  airports: {},
  load: async () => {
    if (get().version && Date.now() - checkedAt < REFRESH_MS) return;
    if (!fromDisk) {
      fromDisk = true;
      try {
        const info = await FileSystem.getInfoAsync(FILE);
        if (info.exists) { const d = JSON.parse(await FileSystem.readAsStringAsync(FILE)); set({ version: d.v ?? '', airports: d.airports ?? {} }); }
      } catch { /* trasig fil → hämtas på nytt */ }
    }
    if (!PROXY_URL) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const headers: Record<string, string> = { 'Cache-Control': 'no-cache', Pragma: 'no-cache' };
      if (get().version) headers['If-None-Match'] = `"${get().version}"`;
      const res = await fetch(`${PROXY_URL}/airport-info`, { headers, signal: ctrl.signal });
      checkedAt = Date.now();
      if (res.status === 304 || !res.ok) return;
      const text = await res.text();
      const d = JSON.parse(text);
      set({ version: d.v ?? '', airports: d.airports ?? {} });
      FileSystem.writeAsStringAsync(FILE, text).catch(() => {});
    } catch { /* utan nät: det sparade gäller */ } finally { clearTimeout(timer); }
  },
}));

/** Uppgifterna för en flygplats (nyckel = flygplatsens nyckel i appen), annars null. */
export function useAirportInfo(key?: string | null): InfoRec | null {
  return useAirportInfoStore((s) => (key ? s.airports[key] ?? null : null));
}
