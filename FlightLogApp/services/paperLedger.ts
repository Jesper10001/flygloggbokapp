// Sparar listan över skannade uppslag och felräknade summor i pappersboken mellan skanningar
// (services/scanPaperFixes.ts: PaperLedger). Ligger i inställningarna som JSON.

import { getSetting, setSetting } from '../db/flights';
import { emptyLedger, type PaperLedger } from './scanPaperFixes';

const KEY = 'scan_paper_ledger';

export async function loadLedger(): Promise<PaperLedger> {
  try {
    const raw = await getSetting(KEY);
    if (!raw) return emptyLedger();
    const l = JSON.parse(raw);
    return { ...emptyLedger(), ...l, spreads: Array.isArray(l.spreads) ? l.spreads : [], fixes: Array.isArray(l.fixes) ? l.fixes : [], ticked: Array.isArray(l.ticked) ? l.ticked : [] };
  } catch {
    return emptyLedger();
  }
}

export async function saveLedger(l: PaperLedger): Promise<void> {
  await setSetting(KEY, JSON.stringify(l));
}
