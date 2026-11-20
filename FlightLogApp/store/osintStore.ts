// OSINT-lagret (Global map → Air Bases → Specific): hämtas från proxyns GET /osint/airbases, som filtrerar enligt
// användarens regler och svarar 451 i spärrade länder. Sparas i telefonen (osint-airbases.json) så att lagret finns
// utan nät; vid nästa öppning frågas proxyn med ETag (304 = oförändrat). 451 → lagret och filen tas bort.
import { create } from 'zustand';
import * as FileSystem from 'expo-file-system/legacy';
import { setLayer, type OsintLayer } from '../utils/milAirbases';

const PROXY_URL = (process.env.EXPO_PUBLIC_PROXY_URL ?? '').replace(/\/+$/, '');
const FILE = `${FileSystem.documentDirectory ?? ''}osint-airbases.json`;
const REFRESH_MS = 60 * 60 * 1000;

type Status = 'idle' | 'loading' | 'ready' | 'unavailable' | 'error';

interface OsintStore {
  status: Status;
  version: string;   // lagrets version ('' = inget) → kartan räknar om sina filter när den ändras
  load: (force?: boolean) => Promise<void>;
}

let checkedAt = 0;
let fromDisk = false;

export const useOsintStore = create<OsintStore>((set, get) => ({
  status: 'idle',
  version: '',
  load: async (force = false) => {
    if (get().status === 'loading') return;
    if (!force && get().status === 'ready' && Date.now() - checkedAt < REFRESH_MS) return;
    const apply = (layer: OsintLayer | null, status: Status) => { setLayer(layer); set({ status, version: layer?.v ?? '' }); };
    // 1) Sparat lager först (direkt, utan nät)
    if (!fromDisk) {
      fromDisk = true;
      try {
        const info = await FileSystem.getInfoAsync(FILE);
        if (info.exists) apply(JSON.parse(await FileSystem.readAsStringAsync(FILE)) as OsintLayer, 'ready');
      } catch { /* trasig fil → hämtas på nytt */ }
    }
    if (!PROXY_URL) { if (!get().version) set({ status: 'error' }); return; }
    if (!get().version) set({ status: 'loading' });
    // 2) Proxyn (ETag → 304 om oförändrat)
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      // no-cache: aldrig iOS egen HTTP-cache (den gav ett gammalt lager utan modellerna efter en uppdatering)
      const headers: Record<string, string> = { 'Cache-Control': 'no-cache', Pragma: 'no-cache' };
      if (get().version) headers['If-None-Match'] = `"${get().version}"`;
      const res = await fetch(`${PROXY_URL}/osint/airbases`, { headers, signal: ctrl.signal });
      checkedAt = Date.now();
      if (res.status === 304) { set({ status: 'ready' }); return; }
      if (res.status === 451) {
        apply(null, 'unavailable');
        FileSystem.deleteAsync(FILE, { idempotent: true }).catch(() => {});
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const text = await res.text();
      const layer = JSON.parse(text) as OsintLayer;
      apply(layer, 'ready');
      FileSystem.writeAsStringAsync(FILE, text).catch(() => {});
    } catch {
      set({ status: get().version ? 'ready' : 'error' });
    } finally {
      clearTimeout(timer);
    }
  },
}));
