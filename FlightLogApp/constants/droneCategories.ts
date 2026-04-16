// Drönarkategorier — olika scheman beroende på pilottyp (civil eller militär).
// Fältet lagras som fri text i drone_registry.category och drone_flights.category.

export type PilotType = 'commercial' | 'military';

export const CIVIL_CATEGORIES = ['A1', 'A2', 'A3', 'Specific', 'Certified'] as const;

// Militär — direktvalsbara top-level
export const MILITARY_TOP_LEVEL = ['MRPAS', 'RPAS'] as const;

// NATO-klasser (STANAG 4670 / AJP-3.3.8)
export interface NatoOption {
  value: string;     // lagras i DB
  label: string;     // visas i UI
  note?: string;     // ex. viktintervall
}
export const NATO_CLASSES: { group: string; options: NatoOption[] }[] = [
  {
    group: 'NATO Class I (< 150 kg)',
    options: [
      { value: 'NATO-CI-Micro', label: 'Class I · Micro', note: '< 2 kg' },
      { value: 'NATO-CI-Mini',  label: 'Class I · Mini',  note: '2–20 kg' },
      { value: 'NATO-CI-Small', label: 'Class I · Small', note: '20–150 kg' },
    ],
  },
  {
    group: 'NATO Class II',
    options: [
      { value: 'NATO-CII', label: 'Class II', note: '150–600 kg, taktisk' },
    ],
  },
  {
    group: 'NATO Class III (> 600 kg)',
    options: [
      { value: 'NATO-CIII-MALE',   label: 'Class III · MALE',   note: 'Medium Altitude Long Endurance' },
      { value: 'NATO-CIII-HALE',   label: 'Class III · HALE',   note: 'High Altitude Long Endurance' },
      { value: 'NATO-CIII-Strike', label: 'Class III · Strike', note: 'Beväpnad strategisk plattform' },
    ],
  },
];

// Kort etikett för visning i listor och chips
export function categoryLabel(value: string): string {
  if (!value) return '';
  if (value === 'MRPAS') return 'MRPAS';
  if (value === 'RPAS')  return 'RPAS';
  for (const group of NATO_CLASSES) {
    const hit = group.options.find((o) => o.value === value);
    if (hit) return hit.label;
  }
  return value; // civil (A1/A2/…) eller okänt
}
