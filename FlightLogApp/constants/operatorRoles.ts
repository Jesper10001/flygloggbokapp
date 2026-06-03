// Delad definition av operatörsroller och deras uppdragsfält. Används av
// loggningsformuläret (add-operator), flyglistan, detaljvyn, operatörsinsikter
// och export — så att etiketter, fält och sammanfattningar är konsekventa.

import type { Flight } from '../types/flight';

export type Lang = 'sv' | 'en';

export type FieldDef = {
  key: string;
  label_en: string;
  label_sv: string;
  type: 'counter' | 'text' | 'segment' | 'toggle' | 'chips' | 'number';
  options?: { key: string; label_en: string; label_sv: string }[];
  unit_en?: string;
  unit_sv?: string;
};

export const ROLE_FIELDS: Record<string, FieldDef[]> = {
  'crew-chief': [
    { key: 'seat_position', label_en: 'Seat position', label_sv: 'Sittplats', type: 'segment',
      options: [
        { key: 'left', label_en: 'Left', label_sv: 'Vänster' },
        { key: 'rear', label_en: 'Rear', label_sv: 'Bak' },
        { key: 'right', label_en: 'Right', label_sv: 'Höger' },
      ] },
    { key: 'mission_type', label_en: 'Mission type', label_sv: 'Uppdragstyp', type: 'chips',
      options: [
        { key: 'SAR', label_en: 'SAR', label_sv: 'SAR' },
        { key: 'CSAR', label_en: 'CSAR', label_sv: 'CSAR' },
        { key: 'CAS', label_en: 'CAS', label_sv: 'CAS' },
        { key: 'ISTAR', label_en: 'ISTAR', label_sv: 'ISTAR' },
        { key: 'Transport', label_en: 'Transport', label_sv: 'Transport' },
        { key: 'FFO', label_en: 'Fire fighting', label_sv: 'Brandbekämpning' },
        { key: 'MEDEVAC', label_en: 'MEDEVAC', label_sv: 'MEDEVAC' },
        { key: 'Escort', label_en: 'Escort', label_sv: 'Eskort' },
        { key: 'Training', label_en: 'Training', label_sv: 'Utbildning' },
      ] },
    { key: 'equipment', label_en: 'Equipment', label_sv: 'Utrustning', type: 'chips',
      options: [
        { key: 'FLIR', label_en: 'FLIR', label_sv: 'FLIR' },
        { key: 'NVG', label_en: 'NVG', label_sv: 'NVG' },
        { key: 'Searchlight', label_en: 'Searchlight', label_sv: 'Sökljus' },
        { key: 'Sensor', label_en: 'Sensor suite', label_sv: 'Sensorsystem' },
        { key: 'Datalink', label_en: 'Datalink', label_sv: 'Datalänk' },
        { key: 'Bambi', label_en: 'Bambi bucket', label_sv: 'Brandbaljé' },
        { key: 'Hoist', label_en: 'Hoist', label_sv: 'Vinsch' },
        { key: 'Comms', label_en: 'Comms relay', label_sv: 'Komrelä' },
      ] },
    { key: 'weapon_category', label_en: 'Weapon system', label_sv: 'Vapensystem', type: 'chips',
      options: [
        { key: 'mg', label_en: 'Machine gun', label_sv: 'Kulspruta' },
        { key: 'precision', label_en: 'Precision weapon', label_sv: 'Precisionsvapen' },
        { key: 'other', label_en: 'Other', label_sv: 'Övrigt' },
        { key: 'rocket', label_en: 'Rocket / missile', label_sv: 'Raket / robot' },
      ] },
    { key: 'rounds_fired', label_en: 'Rounds fired', label_sv: 'Skott avfyrade', type: 'number' },
    { key: 'fire_bucket_drops', label_en: 'Fire bucket drops', label_sv: 'Brandbaljefällningar', type: 'counter' },
  ],
  'swimmer': [
    { key: 'mission_type', label_en: 'Mission type', label_sv: 'Uppdragstyp', type: 'chips',
      options: [
        { key: 'SAR', label_en: 'SAR', label_sv: 'SAR' },
        { key: 'CSAR', label_en: 'CSAR', label_sv: 'CSAR' },
        { key: 'Training', label_en: 'Training', label_sv: 'Träning' },
        { key: 'Exercise', label_en: 'Exercise', label_sv: 'Övning' },
      ] },
    { key: 'equipment', label_en: 'Equipment', label_sv: 'Utrustning', type: 'chips',
      options: [
        { key: 'Wetsuit', label_en: 'Wetsuit', label_sv: 'Våtdräkt' },
        { key: 'Drysuit', label_en: 'Drysuit', label_sv: 'Torrdräkt' },
        { key: 'Fins', label_en: 'Fins', label_sv: 'Fenor' },
        { key: 'Mask', label_en: 'Mask & snorkel', label_sv: 'Mask & snorkel' },
        { key: 'Harness', label_en: 'Rescue harness', label_sv: 'Räddningssele' },
        { key: 'Radio', label_en: 'Waterproof radio', label_sv: 'Vattentät radio' },
      ] },
    { key: 'deployments', label_en: 'Deployments', label_sv: 'Insatser', type: 'counter' },
    { key: 'sea_state', label_en: 'Sea state', label_sv: 'Sjöhävning', type: 'segment',
      options: [
        { key: '1', label_en: '1', label_sv: '1' }, { key: '2', label_en: '2', label_sv: '2' },
        { key: '3', label_en: '3', label_sv: '3' }, { key: '4', label_en: '4', label_sv: '4' },
        { key: '5', label_en: '5', label_sv: '5' }, { key: '6', label_en: '6', label_sv: '6' },
      ] },
    { key: 'hoists_up', label_en: 'Hoists up', label_sv: 'Vinschningar upp', type: 'counter' },
    { key: 'hoists_down', label_en: 'Hoists down', label_sv: 'Vinschningar ner', type: 'counter' },
    { key: 'persons_rescued', label_en: 'Persons rescued', label_sv: 'Räddade personer', type: 'counter' },
    { key: 'night_ops', label_en: 'Night', label_sv: 'Natt', type: 'toggle' },
  ],
  'hoist': [
    { key: 'mission_type', label_en: 'Mission type', label_sv: 'Uppdragstyp', type: 'chips',
      options: [
        { key: 'SAR', label_en: 'SAR', label_sv: 'SAR' },
        { key: 'CSAR', label_en: 'CSAR', label_sv: 'CSAR' },
        { key: 'Cargo', label_en: 'Cargo', label_sv: 'Last' },
        { key: 'Training', label_en: 'Training', label_sv: 'Träning' },
        { key: 'Exercise', label_en: 'Exercise', label_sv: 'Övning' },
      ] },
    { key: 'hoists_up', label_en: 'Hoists up', label_sv: 'Vinschningar upp', type: 'counter' },
    { key: 'hoists_down', label_en: 'Hoists down', label_sv: 'Vinschningar ner', type: 'counter' },
    { key: 'load_type', label_en: 'Load type', label_sv: 'Lasttyp', type: 'chips',
      options: [
        { key: 'person', label_en: 'Person', label_sv: 'Person' },
        { key: 'stretcher', label_en: 'Stretcher', label_sv: 'Bår' },
        { key: 'equipment', label_en: 'Equipment', label_sv: 'Utrustning' },
        { key: 'cargo', label_en: 'Cargo', label_sv: 'Last' },
      ] },
    { key: 'weight_kg', label_en: 'Weight', label_sv: 'Vikt', type: 'text', unit_en: 'kg', unit_sv: 'kg' },
    { key: 'night_ops', label_en: 'Night', label_sv: 'Natt', type: 'toggle' },
  ],
  'hems': [
    { key: 'mission_type', label_en: 'Mission type', label_sv: 'Uppdragstyp', type: 'chips',
      options: [
        { key: 'primary', label_en: 'Primary', label_sv: 'Primär' },
        { key: 'secondary', label_en: 'Secondary', label_sv: 'Sekundär' },
        { key: 'iht', label_en: 'IHT', label_sv: 'IHT' },
        { key: 'sar', label_en: 'SAR', label_sv: 'SAR' },
      ] },
    { key: 'patients', label_en: 'Patients', label_sv: 'Patienter', type: 'counter' },
    { key: 'priority', label_en: 'Priority', label_sv: 'Prioritet', type: 'segment',
      options: [
        { key: 'P1', label_en: 'P1', label_sv: 'P1' },
        { key: 'P2', label_en: 'P2', label_sv: 'P2' },
        { key: 'P3', label_en: 'P3', label_sv: 'P3' },
      ] },
    { key: 'hoists', label_en: 'Hoists', label_sv: 'Vinschningar', type: 'counter' },
    { key: 'night_ops', label_en: 'Night', label_sv: 'Natt', type: 'toggle' },
  ],
  'loadmaster': [
    { key: 'mission_type', label_en: 'Mission type', label_sv: 'Uppdragstyp', type: 'chips',
      options: [
        { key: 'Cargo', label_en: 'Cargo', label_sv: 'Last' },
        { key: 'Sling', label_en: 'Sling load', label_sv: 'Hänglast' },
        { key: 'Airdrop', label_en: 'Air drop', label_sv: 'Fällning' },
        { key: 'Pax', label_en: 'Passengers', label_sv: 'Passagerare' },
        { key: 'MEDEVAC', label_en: 'MEDEVAC', label_sv: 'MEDEVAC' },
        { key: 'Training', label_en: 'Training', label_sv: 'Utbildning' },
      ] },
    { key: 'equipment', label_en: 'Equipment', label_sv: 'Utrustning', type: 'chips',
      options: [
        { key: 'Nets', label_en: 'Cargo nets', label_sv: 'Lastnät' },
        { key: 'Straps', label_en: 'Tie-down straps', label_sv: 'Surrningsband' },
        { key: 'Pallets', label_en: 'Pallets', label_sv: 'Pallar' },
        { key: 'Sling', label_en: 'Sling gear', label_sv: 'Hänglastutrustning' },
        { key: 'Chutes', label_en: 'Parachutes', label_sv: 'Fallskärmar' },
      ] },
    { key: 'cargo_weight', label_en: 'Cargo weight', label_sv: 'Lastvikt', type: 'text', unit_en: 'kg', unit_sv: 'kg' },
    { key: 'sling_ops', label_en: 'Sling operations', label_sv: 'Hänglastoperationer', type: 'counter' },
    { key: 'airdrops', label_en: 'Air drops', label_sv: 'Fällningar', type: 'counter' },
    { key: 'weapon_category', label_en: 'Weapon system', label_sv: 'Vapensystem', type: 'chips',
      options: [
        { key: 'mg', label_en: 'Machine gun', label_sv: 'Kulspruta' },
        { key: 'precision', label_en: 'Precision weapon', label_sv: 'Precisionsvapen' },
        { key: 'other', label_en: 'Other', label_sv: 'Övrigt' },
        { key: 'rocket', label_en: 'Rocket / missile', label_sv: 'Raket / robot' },
      ] },
    { key: 'rounds_fired', label_en: 'Rounds fired', label_sv: 'Skott avfyrade', type: 'number' },
    { key: 'night_ops', label_en: 'Night', label_sv: 'Natt', type: 'toggle' },
  ],
};

export const OPERATOR_SUBROLES = ['crew-chief', 'swimmer', 'hoist', 'hems', 'loadmaster'] as const;

export const ROLE_META: Record<string, { emoji: string; en: string; sv: string }> = {
  'crew-chief': { emoji: '🎖️', en: 'Crew Chief', sv: 'Uppdragsspecialist' },
  'swimmer': { emoji: '🏊', en: 'Rescue Swimmer', sv: 'Ytbärgare' },
  'hoist': { emoji: '⚓', en: 'Hoist Operator', sv: 'Vinschoperatör' },
  'hems': { emoji: '🏥', en: 'HEMS Operator', sv: 'HEMS-operatör' },
  'loadmaster': { emoji: '📦', en: 'Loadmaster', sv: 'Lastmästare' },
};

export function roleLabel(role: string, lang: Lang): string {
  const m = ROLE_META[role];
  return m ? (lang === 'sv' ? m.sv : m.en) : role;
}

export function getRoleFields(role: string): FieldDef[] {
  return ROLE_FIELDS[role] ?? [];
}

// ── Fältgruppering (för ett ryddigare loggningsformulär) ─────────────────────
export type FieldGroup = 'mission' | 'counts' | 'equipment' | 'weapons' | 'conditions';

const KEY_GROUP: Record<string, FieldGroup> = {
  mission_type: 'mission', seat_position: 'mission', sea_state: 'mission', priority: 'mission', load_type: 'mission',
  equipment: 'equipment',
  weapon_category: 'weapons', rounds_fired: 'weapons',
  night_ops: 'conditions', weight_kg: 'conditions', cargo_weight: 'conditions',
};

/** Vilken sektion ett fält hör till; counters/övrigt → 'counts'. */
export function fieldGroup(key: string): FieldGroup {
  return KEY_GROUP[key] ?? 'counts';
}

export const FIELD_GROUP_ORDER: FieldGroup[] = ['mission', 'counts', 'equipment', 'weapons', 'conditions'];

export function groupLabel(g: FieldGroup, lang: Lang): string {
  const m: Record<FieldGroup, { sv: string; en: string }> = {
    mission: { sv: 'Uppdrag', en: 'Mission' },
    counts: { sv: 'Antal', en: 'Counts' },
    equipment: { sv: 'Utrustning', en: 'Equipment' },
    weapons: { sv: 'Vapen', en: 'Weapons' },
    conditions: { sv: 'Förhållanden', en: 'Conditions' },
  };
  return lang === 'sv' ? m[g].sv : m[g].en;
}

export function fieldLabel(def: FieldDef, lang: Lang): string {
  return lang === 'sv' ? def.label_sv : def.label_en;
}

export function optionLabel(def: FieldDef, key: string, lang: Lang): string {
  const o = def.options?.find((x) => x.key === key);
  return o ? (lang === 'sv' ? o.label_sv : o.label_en) : key;
}

export interface OperatorData {
  role: string;
  [key: string]: any;
}

/** Säker parse av flight.operator_data → objekt med roll, eller null. */
export function parseOperatorData(f: Pick<Flight, 'operator_data'>): OperatorData | null {
  if (!f.operator_data) return null;
  try {
    const d = JSON.parse(f.operator_data);
    if (d && typeof d === 'object' && d.role) return d as OperatorData;
    return null;
  } catch { return null; }
}

/** Numeriska fält (counter/number) för en roll — används för summor/insikter. */
export function numericFields(role: string): FieldDef[] {
  return getRoleFields(role).filter((d) => d.type === 'counter' || d.type === 'number');
}

// Kort sammanfattning per roll till lista/detalj: nyckeltal som visas inline.
const SUMMARY_COUNTERS: Record<string, { key: string; abbr: string }[]> = {
  'crew-chief': [{ key: 'rounds_fired', abbr: 'rds' }, { key: 'fire_bucket_drops', abbr: 'drops' }],
  'swimmer': [{ key: 'persons_rescued', abbr: '⛑' }, { key: 'hoists_up', abbr: '↑' }],
  'hoist': [{ key: 'hoists_up', abbr: '↑' }, { key: 'hoists_down', abbr: '↓' }],
  'hems': [{ key: 'patients', abbr: 'pat' }],
  'loadmaster': [{ key: 'sling_ops', abbr: 'sling' }, { key: 'airdrops', abbr: 'drops' }],
};

export interface OperatorSummary {
  role: string;
  emoji: string;
  mission: string;
  metrics: string[];
}

/** Rollanpassad sammanfattning av en operatörsflygning för lista/detalj. */
export function summarizeOperatorFlight(f: Pick<Flight, 'operator_data'>, lang: Lang): OperatorSummary | null {
  const d = parseOperatorData(f);
  if (!d) return null;
  const def = getRoleFields(d.role);
  const missionDef = def.find((x) => x.key === 'mission_type');
  let mission = '';
  const mt = d.mission_type;
  if (Array.isArray(mt) && mt.length) {
    mission = mt.slice(0, 2).map((k) => (missionDef ? optionLabel(missionDef, String(k), lang) : String(k))).join(' / ');
  } else if (typeof mt === 'string' && mt) {
    mission = missionDef ? optionLabel(missionDef, mt, lang) : mt;
  }

  const metrics: string[] = [];
  for (const c of SUMMARY_COUNTERS[d.role] ?? []) {
    const n = Number(d[c.key]) || 0;
    if (n > 0) metrics.push(`${n} ${c.abbr}`);
  }
  if (d.role === 'hems' && d.priority) metrics.push(String(d.priority));
  if (d.night_ops === true || d.night_ops === 'true') metrics.push('🌙');

  return { role: d.role, emoji: ROLE_META[d.role]?.emoji ?? '🎖️', mission, metrics };
}
