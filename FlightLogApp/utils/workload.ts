// Workload-index (Flight load) på dashboarden: senaste 14 dagarnas timmar mot ditt eget normala 14-dagarssnitt,
// i procent (100 % = som vanligt). Delas av pilot- och drönardashboarden.
//
// Nya användare har inget eget snitt de första 14 dagarna (snittet bygger på flygningar äldre än 14 dagar) →
// 100 % i stället för max. När historiken växer tar det verkliga förhållandet över gradvis och gäller fullt efter
// BASELINE_FULL_DAYS dagar. Importerad historik (CSV) räknas direkt: lång historik → fullt genomslag från start.
export const BASELINE_FULL_DAYS = 60;

export function workloadIndex(recent14: number, yearAvg14: number, historyDays: number): number {
  if (yearAvg14 <= 0) return recent14 > 0 ? 100 : 0;
  const raw = (recent14 / yearAvg14) * 100;
  const confidence = Math.max(0, Math.min(1, (historyDays - 14) / (BASELINE_FULL_DAYS - 14)));
  return Math.round(100 + (raw - 100) * confidence);
}
