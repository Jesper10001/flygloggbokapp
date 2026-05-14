import { create } from 'zustand';
import { getSetting, setSetting } from '../db/flights';
import { useFlightStore } from './flightStore';

// ── Kvoter per tier ─────────────────────────────────────────────────────────
export const TIER_QUOTAS = {
  free:    { scan: 1,  flightImport: 0,   summarize: 0,  lookup: 10, import: 0 },
  premium: { scan: 10, flightImport: 30,  summarize: 10, lookup: 20, import: 5 },
  max:     { scan: 50, flightImport: 100, summarize: 20, lookup: 60, import: 5 },
} as const;

// Bakåtkompatibla alias (används av befintlig kod)
export const FREE_SCAN_QUOTA = TIER_QUOTAS.free.scan;
export const FREE_LOOKUP_QUOTA = TIER_QUOTAS.free.lookup;
export const MONTHLY_QUOTA = TIER_QUOTAS.premium.scan;
export const MONTHLY_FLIGHT_IMPORT_QUOTA = TIER_QUOTAS.premium.flightImport;
export const MONTHLY_SUMMARIZE_QUOTA = TIER_QUOTAS.premium.summarize;
export const MONTHLY_LOOKUP_QUOTA = TIER_QUOTAS.premium.lookup;
export const MONTHLY_IMPORT_QUOTA = TIER_QUOTAS.premium.import;

export const SCAN_PACKS = [
  { count: 10, price: 30, pricePerScan: '3 kr/skanning' },
  { count: 50, price: 150, pricePerScan: '3 kr/skanning — en hel loggbok' },
] as const;

export const MONTHLY_TOPUP_PRICE = 49;
export const MAX_TOPUP_PRICE = 149;

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

interface ScanQuotaState {
  monthKey: string;
  scansUsed: number;
  summarizeUsed: number;
  lookupUsed: number;
  importUsed: number;
  flightImportUsed: number;
  extraScans: number;
  loaded: boolean;
  load: () => Promise<void>;
  monthlyRemaining: () => number;
  totalRemaining: () => number;
  summarizeRemaining: () => number;
  lookupRemaining: () => number;
  importRemaining: () => number;
  flightImportRemaining: () => number;
  canScan: () => boolean;
  canSummarize: () => boolean;
  canLookup: () => boolean;
  canImport: () => boolean;
  canFlightImport: () => boolean;
  consumeScan: () => Promise<void>;
  consumeSummarize: () => Promise<void>;
  consumeLookup: () => Promise<void>;
  consumeImport: () => Promise<void>;
  consumeFlightImport: () => Promise<void>;
  addExtraScans: (n: number) => Promise<void>;
  topUpMonthly: () => Promise<void>;
}

export const useScanQuotaStore = create<ScanQuotaState>((set, get) => ({
  monthKey: currentMonthKey(),
  scansUsed: 0,
  summarizeUsed: 0,
  lookupUsed: 0,
  importUsed: 0,
  flightImportUsed: 0,
  extraScans: 0,
  loaded: false,

  load: async () => {
    const mk = currentMonthKey();
    const storedMonth = await getSetting('scan_month');
    let scansUsed = 0;
    let summarizeUsed = 0;
    let lookupUsed = 0;
    let importUsed = 0;
    let flightImportUsed = 0;
    if (storedMonth === mk) {
      scansUsed = parseInt((await getSetting('scans_used')) ?? '0', 10) || 0;
      summarizeUsed = parseInt((await getSetting('summarize_used')) ?? '0', 10) || 0;
      lookupUsed = parseInt((await getSetting('lookup_used')) ?? '0', 10) || 0;
      importUsed = parseInt((await getSetting('import_used')) ?? '0', 10) || 0;
      flightImportUsed = parseInt((await getSetting('flight_import_used')) ?? '0', 10) || 0;
    } else {
      await setSetting('scan_month', mk);
      await setSetting('scans_used', '0');
      await setSetting('summarize_used', '0');
      await setSetting('lookup_used', '0');
      await setSetting('import_used', '0');
      await setSetting('flight_import_used', '0');
    }
    const extraScans = parseInt((await getSetting('extra_scans')) ?? '0', 10) || 0;
    set({ monthKey: mk, scansUsed, summarizeUsed, lookupUsed, importUsed, flightImportUsed, extraScans, loaded: true });
  },

  monthlyRemaining: () => {
    const tier = useFlightStore.getState().tier ?? (useFlightStore.getState().isPremium ? 'premium' : 'free');
    return Math.max(0, TIER_QUOTAS[tier].scan - get().scansUsed);
  },
  summarizeRemaining: () => {
    const tier = useFlightStore.getState().tier ?? (useFlightStore.getState().isPremium ? 'premium' : 'free');
    return Math.max(0, TIER_QUOTAS[tier].summarize - get().summarizeUsed);
  },
  lookupRemaining: () => {
    const tier = useFlightStore.getState().tier ?? (useFlightStore.getState().isPremium ? 'premium' : 'free');
    return Math.max(0, TIER_QUOTAS[tier].lookup - get().lookupUsed);
  },
  importRemaining: () => {
    const tier = useFlightStore.getState().tier ?? (useFlightStore.getState().isPremium ? 'premium' : 'free');
    return Math.max(0, TIER_QUOTAS[tier].import - get().importUsed);
  },
  flightImportRemaining: () => {
    const tier = useFlightStore.getState().tier ?? (useFlightStore.getState().isPremium ? 'premium' : 'free');
    return Math.max(0, TIER_QUOTAS[tier].flightImport - get().flightImportUsed);
  },

  totalRemaining: () => {
    const { scansUsed, extraScans } = get();
    const tier = useFlightStore.getState().tier ?? (useFlightStore.getState().isPremium ? 'premium' : 'free');
    const quota = TIER_QUOTAS[tier].scan;
    return Math.max(0, quota - scansUsed) + extraScans;
  },

  canScan: () => get().totalRemaining() > 0,
  canLookup: () => get().lookupRemaining() > 0,
  canSummarize: () => get().summarizeRemaining() > 0,
  canImport: () => get().importRemaining() > 0,
  canFlightImport: () => get().flightImportRemaining() > 0,

  consumeScan: async () => {
    const { scansUsed, extraScans } = get();
    const tier = useFlightStore.getState().tier ?? (useFlightStore.getState().isPremium ? 'premium' : 'free');
    const quota = TIER_QUOTAS[tier].scan;
    if (quota - scansUsed > 0) {
      const newUsed = scansUsed + 1;
      await setSetting('scans_used', String(newUsed));
      set({ scansUsed: newUsed });
    } else if (extraScans > 0) {
      const newExtra = extraScans - 1;
      await setSetting('extra_scans', String(newExtra));
      set({ extraScans: newExtra });
    } else {
      throw new Error('NO_SCANS_LEFT');
    }
  },

  consumeSummarize: async () => {
    const { summarizeUsed } = get();
    if (get().summarizeRemaining() <= 0) throw new Error('NO_SUMMARIZE_LEFT');
    const newUsed = summarizeUsed + 1;
    await setSetting('summarize_used', String(newUsed));
    set({ summarizeUsed: newUsed });
  },

  consumeLookup: async () => {
    const { lookupUsed } = get();
    if (get().lookupRemaining() <= 0) throw new Error('NO_LOOKUPS_LEFT');
    const newUsed = lookupUsed + 1;
    await setSetting('lookup_used', String(newUsed));
    set({ lookupUsed: newUsed });
  },

  consumeImport: async () => {
    const { importUsed } = get();
    if (get().importRemaining() <= 0) throw new Error('NO_IMPORTS_LEFT');
    const newUsed = importUsed + 1;
    await setSetting('import_used', String(newUsed));
    set({ importUsed: newUsed });
  },

  consumeFlightImport: async () => {
    const { flightImportUsed } = get();
    if (get().flightImportRemaining() <= 0) throw new Error('NO_FLIGHT_IMPORTS_LEFT');
    const newUsed = flightImportUsed + 1;
    await setSetting('flight_import_used', String(newUsed));
    set({ flightImportUsed: newUsed });
  },

  addExtraScans: async (n: number) => {
    const newExtra = get().extraScans + n;
    await setSetting('extra_scans', String(newExtra));
    set({ extraScans: newExtra });
  },

  topUpMonthly: async () => {
    const s = get();
    const tier = useFlightStore.getState().tier ?? (useFlightStore.getState().isPremium ? 'premium' : 'free');
    const q = TIER_QUOTAS[tier];
    const newScans = s.scansUsed - q.scan;
    const newSummarize = s.summarizeUsed - q.summarize;
    const newLookup = s.lookupUsed - q.lookup;
    const newImport = s.importUsed - q.import;
    const newFlightImport = s.flightImportUsed - q.flightImport;
    await setSetting('scans_used', String(newScans));
    await setSetting('summarize_used', String(newSummarize));
    await setSetting('lookup_used', String(newLookup));
    await setSetting('import_used', String(newImport));
    await setSetting('flight_import_used', String(newFlightImport));
    set({ scansUsed: newScans, summarizeUsed: newSummarize, lookupUsed: newLookup, importUsed: newImport, flightImportUsed: newFlightImport });
  },
}));
