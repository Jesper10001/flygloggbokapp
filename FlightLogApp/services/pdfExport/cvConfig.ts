// Pilot CV (Export to PDF): allt användaren ställer in på CV-sidan — uppgifter, innehåll och utseende — i ETT
// sparat objekt (settings: cv_config). Uppgifterna hämtas från profilen första gången och är sedan CV:ts egna:
// att ändra dem här ändrar inte profilen. Totalerna och loggbokssidorna sparas aldrig här, de räknas och hämtas
// ur loggboken varje gång.

import { getSetting, setSetting, getAllAircraftTypes } from '../../db/flights';

export type TileKey = 'pic' | 'co_pilot' | 'dual' | 'instructor' | 'ifr' | 'night' | 'nvg' | 'me' | 'se' | 'mp' | 'sp'
  | 'picus' | 'sim' | 'last12' | 'last90' | 'landings' | 'flights';
export const TILES: { k: TileKey; label: string; count?: boolean }[] = [
  { k: 'pic', label: 'PIC' }, { k: 'co_pilot', label: 'Co-pilot' }, { k: 'dual', label: 'Dual' },
  { k: 'instructor', label: 'Instructor' }, { k: 'picus', label: 'PICUS' },
  { k: 'ifr', label: 'IFR' }, { k: 'night', label: 'Night' }, { k: 'nvg', label: 'NVG' },
  { k: 'me', label: 'Multi-engine' }, { k: 'se', label: 'Single-engine' },
  { k: 'mp', label: 'Multi-pilot' }, { k: 'sp', label: 'Single-pilot' },
  { k: 'sim', label: 'Simulator' }, { k: 'last12', label: 'Last 12 months' }, { k: 'last90', label: 'Last 90 days' },
  { k: 'landings', label: 'Landings', count: true }, { k: 'flights', label: 'Flights', count: true },
];
export const MAX_TILES = 8;

// Typsnitten finns i iOS, så de ser likadana ut i förhandsvisningen och i den färdiga PDF:en.
export type FontKey = 'classic' | 'modern' | 'editorial' | 'georgia' | 'times' | 'technical';
export const FONTS: { k: FontKey; label: string; head: string; body: string; mono?: boolean }[] = [
  { k: 'classic', label: 'Classic', head: "Baskerville,'Times New Roman',serif", body: "'Helvetica Neue',Helvetica,Arial,sans-serif" },
  { k: 'modern', label: 'Modern', head: "'Avenir Next',Avenir,'Helvetica Neue',sans-serif", body: "'Avenir Next',Avenir,'Helvetica Neue',sans-serif" },
  { k: 'editorial', label: 'Editorial', head: "Didot,'Bodoni 72',Georgia,serif", body: "'Avenir Next',Avenir,'Helvetica Neue',sans-serif" },
  { k: 'georgia', label: 'Georgia', head: 'Georgia,serif', body: "'Helvetica Neue',Helvetica,Arial,sans-serif" },
  { k: 'times', label: 'Times', head: "'Times New Roman',Times,serif", body: "'Times New Roman',Times,serif" },
  { k: 'technical', label: 'Technical', head: "'Helvetica Neue',Helvetica,Arial,sans-serif", body: "'Helvetica Neue',Helvetica,Arial,sans-serif", mono: true },
];
export const ACCENTS = ['#00A6C8', '#2563EB', '#0F9D8A', '#15803D', '#B8860B', '#C2410C', '#BE123C', '#6D28D9', '#374151'];
export const SIDES = ['#0A1628', '#111418', '#25324A', '#12332B', '#3A1220', '#2B1B3D', '#E9EEF4', '#F3EEE4'];

export interface CvLanguage { id: string; name: string; level: string }
export interface CvCert { id: string; name: string; valid: string }
export interface CvJob { id: string; period: string; role: string; detail: string }
export type SectionKey = 'monogram' | 'contact' | 'licence' | 'certs' | 'languages' | 'summary' | 'totals' | 'aircraft'
  | 'last12' | 'experience' | 'milestones' | 'footer';
export const SECTIONS: { k: SectionKey; label: string }[] = [
  { k: 'monogram', label: 'Initials' }, { k: 'contact', label: 'Contact details' }, { k: 'licence', label: 'Licence' },
  { k: 'certs', label: 'Ratings and certificates' }, { k: 'languages', label: 'Languages' },
  { k: 'summary', label: 'Profile text' }, { k: 'totals', label: 'Totals' }, { k: 'aircraft', label: 'Aircraft types' },
  { k: 'last12', label: 'Last 12 months' }, { k: 'experience', label: 'Experience' },
  { k: 'milestones', label: 'Milestones' }, { k: 'footer', label: 'Footnote about the totals' },
];

export interface CvConfig {
  v: 1;
  seeded: boolean;   // profilens uppgifter är hämtade en gång
  details: {
    firstName: string; lastName: string; title: string; email: string; phone: string; base: string;
    licence: string; licenceNo: string; nationality: string; dob: string; summary: string;
  };
  languages: CvLanguage[];
  certs: CvCert[];
  experience: CvJob[];
  sections: Record<SectionKey, boolean>;
  tiles: TileKey[];
  aircraftRows: number;                       // 4, 6 eller 99 (alla)
  look: { accent: string; side: string; font: FontKey; size: 'compact' | 'regular' | 'large'; sideRight: boolean };
  spreads: number;                            // antal uppslag ur den digitala boken som bifogas (0 = inga)
  bookId: number | null;                      // null = den aktiva boken
}

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function defaultCv(): CvConfig {
  return {
    v: 1, seeded: false,
    details: { firstName: '', lastName: '', title: '', email: '', phone: '', base: '', licence: '', licenceNo: '', nationality: '', dob: '', summary: '' },
    languages: [], certs: [], experience: [],
    sections: { monogram: true, contact: true, licence: true, certs: true, languages: true, summary: true, totals: true, aircraft: true, last12: true, experience: true, milestones: false, footer: true },
    tiles: ['pic', 'co_pilot', 'dual', 'me', 'ifr', 'night', 'nvg', 'last12'],
    aircraftRows: 6,
    look: { accent: ACCENTS[0], side: SIDES[0], font: 'classic', size: 'regular', sideRight: false },
    spreads: 3, bookId: null,
  };
}

/** Profilens uppgifter (och behörigheter med slutdatum ur Fleet) som CV:ts startvärden. */
export async function profileDetails(): Promise<Pick<CvConfig, 'details' | 'languages' | 'certs'>> {
  const g = async (k: string) => ((await getSetting(k).catch(() => '')) ?? '').trim();
  const [firstName, lastName, title, email, phone, base, licence, dob, langs] = await Promise.all([
    g('profile_first_name'), g('profile_last_name'), g('profile_title'), g('profile_email'), g('profile_phone'),
    g('profile_base'), g('profile_license'), g('profile_dob'), g('profile_languages'),
  ]);
  const languages: CvLanguage[] = langs
    ? langs.split(',').map((l) => { const [name, level] = l.split(':'); return { id: newId(), name: (name ?? '').trim(), level: (level ?? '').trim() }; }).filter((l) => l.name)
    : [];
  let certs: CvCert[] = [];
  try {
    const types = await getAllAircraftTypes();
    certs = types.filter((t) => t.rating_expiry).map((t) => ({ id: newId(), name: `${t.aircraft_type}${t.rating_class ? ` · ${t.rating_class}` : ''}`, valid: t.rating_expiry }));
  } catch { /* ingen flotta */ }
  return { details: { firstName, lastName, title, email, phone, base, licence, licenceNo: '', nationality: '', dob, summary: '' }, languages, certs };
}

export async function loadCv(): Promise<CvConfig> {
  const base = defaultCv();
  let saved: Partial<CvConfig> = {};
  try { saved = JSON.parse((await getSetting('cv_config')) || '{}') || {}; } catch { saved = {}; }
  const cfg: CvConfig = {
    ...base, ...saved,
    details: { ...base.details, ...(saved.details ?? {}) },
    sections: { ...base.sections, ...(saved.sections ?? {}) },
    look: { ...base.look, ...(saved.look ?? {}) },
    languages: Array.isArray(saved.languages) ? saved.languages : [],
    certs: Array.isArray(saved.certs) ? saved.certs : [],
    experience: Array.isArray(saved.experience) ? saved.experience : [],
    tiles: Array.isArray(saved.tiles) ? saved.tiles.filter((k) => TILES.some((t) => t.k === k)).slice(0, MAX_TILES) : base.tiles,
  };
  if (!FONTS.some((f) => f.k === cfg.look.font)) cfg.look.font = base.look.font;
  if (!cfg.seeded) {
    const p = await profileDetails();
    cfg.details = { ...cfg.details, ...p.details };
    cfg.languages = p.languages;
    cfg.certs = p.certs;
    cfg.seeded = true;
  }
  return cfg;
}

export async function saveCv(cfg: CvConfig): Promise<void> {
  await setSetting('cv_config', JSON.stringify(cfg)).catch(() => {});
}
