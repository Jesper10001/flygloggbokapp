// Batterikondition härledd ur LADDCYKLER — självuppdaterande (cykeln bumpas per
// flygning), till skillnad från det manuella health%-fältet som annars fastnar på
// 100. LiPo-batterier pensioneras typiskt runt ~200 cykler (DJI-konsument); efter
// det faller kapaciteten snabbt. Detta är den enda batteri-hälsokälla Fleet visar.
export const DEFAULT_RATED_CYCLES = 200;

export type BatteryConditionKey = 'good' | 'ageing' | 'retire_soon' | 'retire';

export interface BatteryCondition {
  key: BatteryConditionKey;
  label: string;
  usedPct: number;   // andel av livslängden förbrukad (0–100), för slitage-baren
  needsAttention: boolean;
}

// Trösklar som andel av rated cycles: <60 % good, 60–85 % ageing, 85–100 % retire soon, ≥100 % retire.
export function batteryCondition(cycles: number, rated: number = DEFAULT_RATED_CYCLES): BatteryCondition {
  const r = rated > 0 ? rated : DEFAULT_RATED_CYCLES;
  const usedPct = Math.max(0, Math.min(100, Math.round((cycles / r) * 100)));
  let key: BatteryConditionKey;
  let label: string;
  if (cycles >= r) { key = 'retire'; label = 'Retire'; }
  else if (usedPct >= 85) { key = 'retire_soon'; label = 'Retire soon'; }
  else if (usedPct >= 60) { key = 'ageing'; label = 'Ageing'; }
  else { key = 'good'; label = 'Good'; }
  return { key, label, usedPct, needsAttention: key === 'retire' || key === 'retire_soon' };
}

// Cykel-tröskel där "retire soon"-varningen slår in (för toast vid loggning).
export const RETIRE_SOON_CYCLES = Math.round(DEFAULT_RATED_CYCLES * 0.85); // 170
