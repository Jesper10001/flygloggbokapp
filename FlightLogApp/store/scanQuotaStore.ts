import { create } from 'zustand';
import { getSetting, setSetting } from '../db/flights';

export const MONTHLY_QUOTA = 20;
export const MONTHLY_SUMMARIZE_QUOTA = 40;

export const SCAN_PACKS = [
  { count: 10, price: 30, pricePerScan: '3 kr/skanning' },
  { count: 50, price: 150, pricePerScan: '3 kr/skanning — en hel loggbok' },
] as const;

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

interface ScanQuotaState {
  monthKey: string;
  scansUsed: number;
  summarizeUsed: number;
  extraScans: number;
  loaded: boolean;
  load: () => Promise<void>;
  monthlyRemaining: () => number;
  totalRemaining: () => number;
  summarizeRemaining: () => number;
  canScan: () => boolean;
  canSummarize: () => boolean;
  consumeScan: () => Promise<void>;
  consumeSummarize: () => Promise<void>;
  addExtraScans: (n: number) => Promise<void>;
}

export const useScanQuotaStore = create<ScanQuotaState>((set, get) => ({
  monthKey: currentMonthKey(),
  scansUsed: 0,
  summarizeUsed: 0,
  extraScans: 0,
  loaded: false,

  load: async () => {
    const mk = currentMonthKey();
    const storedMonth = await getSetting('scan_month');
    let scansUsed = 0;
    let summarizeUsed = 0;
    if (storedMonth === mk) {
      scansUsed = parseInt((await getSetting('scans_used')) ?? '0', 10) || 0;
      summarizeUsed = parseInt((await getSetting('summarize_used')) ?? '0', 10) || 0;
    } else {
      await setSetting('scan_month', mk);
      await setSetting('scans_used', '0');
      await setSetting('summarize_used', '0');
    }
    const extraScans = parseInt((await getSetting('extra_scans')) ?? '0', 10) || 0;
    set({ monthKey: mk, scansUsed, summarizeUsed, extraScans, loaded: true });
  },

  monthlyRemaining: () => Math.max(0, MONTHLY_QUOTA - get().scansUsed),
  summarizeRemaining: () => Math.max(0, MONTHLY_SUMMARIZE_QUOTA - get().summarizeUsed),

  totalRemaining: () => {
    const { scansUsed, extraScans } = get();
    return Math.max(0, MONTHLY_QUOTA - scansUsed) + extraScans;
  },

  canScan: () => get().totalRemaining() > 0,
  canSummarize: () => get().summarizeRemaining() > 0,

  consumeScan: async () => {
    const { scansUsed, extraScans } = get();
    if (MONTHLY_QUOTA - scansUsed > 0) {
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
    if (MONTHLY_SUMMARIZE_QUOTA - summarizeUsed <= 0) throw new Error('NO_SUMMARIZE_LEFT');
    const newUsed = summarizeUsed + 1;
    await setSetting('summarize_used', String(newUsed));
    set({ summarizeUsed: newUsed });
  },

  addExtraScans: async (n: number) => {
    const newExtra = get().extraScans + n;
    await setSetting('extra_scans', String(newExtra));
    set({ extraScans: newExtra });
  },
}));
