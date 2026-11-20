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
  fees?: { landing: string; parking?: string; note?: string; year?: string; url?: string };
  contacts?: { l: string; ph: string }[];
  gtk?: string[];
  web?: string;
  email?: string;
  src?: { t: string; url: string }[];
  v?: string; // senast verifierad (datum)
};

const PROXY_URL = (process.env.EXPO_PUBLIC_PROXY_URL ?? '').replace(/\/+$/, '');
// -2: datan med avgifter fick samma ETag som den utan (byggdatum utan tid) → ny fil = hämtas om en gång
const FILE = `${FileSystem.documentDirectory ?? ''}airport-info-2.json`;
// Kort som användaren själv hämtat om (↻, 3 coins) sparas bara i telefonen och vinner över serverns
// version så länge de är minst lika nya (fältet v).
const LOCAL_FILE = `${FileSystem.documentDirectory ?? ''}airport-info-local.json`;
const REFRESH_MS = 60 * 60 * 1000;
let checkedAt = 0;
let fromDisk = false;

interface Store {
  version: string;
  airports: Record<string, InfoRec>;
  local: Record<string, InfoRec>;
  load: () => Promise<void>;
  saveLocal: (key: string, rec: InfoRec) => void;
}

export const useAirportInfoStore = create<Store>((set, get) => ({
  version: '',
  airports: {},
  local: {},
  saveLocal: (key, rec) => {
    const local = { ...get().local, [key]: rec };
    set({ local });
    FileSystem.writeAsStringAsync(LOCAL_FILE, JSON.stringify(local)).catch(() => {});
  },
  load: async () => {
    if (get().version && Date.now() - checkedAt < REFRESH_MS) return;
    if (!fromDisk) {
      fromDisk = true;
      try {
        const info = await FileSystem.getInfoAsync(FILE);
        if (info.exists) { const d = JSON.parse(await FileSystem.readAsStringAsync(FILE)); set({ version: d.v ?? '', airports: d.airports ?? {} }); }
      } catch { /* trasig fil → hämtas på nytt */ }
      try {
        const li = await FileSystem.getInfoAsync(LOCAL_FILE);
        if (li.exists) set({ local: JSON.parse(await FileSystem.readAsStringAsync(LOCAL_FILE)) ?? {} });
      } catch { /* ignoreras */ }
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
  return useAirportInfoStore((s) => {
    if (!key) return null;
    const srv = s.airports[key], loc = s.local[key];
    if (loc && (!srv || (loc.v ?? '') >= (srv.v ?? ''))) return loc;
    return srv ?? null;
  });
}
