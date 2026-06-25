// Fas 2 — andra-läsare via Apple Vision (on-device). Kör Visions OCR på sidan och
// KORROBORERAR Claudes kritiska fält: finns värdet (ICAO/registrering) faktiskt i
// bildens text? Saknas det → flagga för granskning (fångar hallucinationer).
// Degraderar tyst om Vision-modulen saknas (t.ex. Expo Go) → returnerar oförändrat.
//
// OBS (Fas 2 v1): detta är en COARSE textkorroboration utan cell-geometri. Exakt
// per-cell-enighet kommer i Fas 3 (geometrisk segmentering). Tröskt/logik tunas
// mot riktig Vision-output när dev-clienten är igång.

import type { OcrFlightResult } from '../types/flight';
import { isAvailable, recognize, type VisionWord } from '../modules/apple-vision-ocr';

const norm = (s: string) => (s || '').toUpperCase().replace(/[\s.\-]/g, '');

/** Sant om strängarna skiljer sig med högst en infogning/borttagning/ersättning. */
function withinEdit1(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la > lb) return withinEdit1(b, a);
  let i = 0, j = 0, edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; }
    else { if (++edits > 1) return false; if (la === lb) { i++; j++; } else { j++; } }
  }
  return edits + (lb - j) <= 1;
}

/** Normaliserade tokens (≥2 tecken) ur Visions sidoläsning. */
function visionTokens(words: VisionWord[]): Set<string> {
  const set = new Set<string>();
  for (const w of words) {
    for (const part of w.text.split(/[\s/,;|]+/)) {
      const n = norm(part);
      if (n.length >= 2) set.add(n);
    }
  }
  return set;
}

/** Styrker Vision värdet? (exakt eller inom edit-1 mot någon token). */
function corroborated(value: string, tokens: Set<string>): boolean {
  const n = norm(value);
  if (!n) return true;            // tomt fält → inget att styrka
  if (tokens.has(n)) return true;
  for (const t of tokens) if (withinEdit1(t, n)) return true;
  return false;
}

export async function corroborateWithVision(
  pageInput: string,                 // file://-URI eller base64 för hela sidan
  flights: OcrFlightResult[],
): Promise<OcrFlightResult[]> {
  if (!isAvailable() || flights.length === 0 || !pageInput) return flights;

  let words: VisionWord[] = [];
  try { words = await recognize(pageInput); } catch { return flights; }
  if (words.length === 0) return flights;

  const tokens = visionTokens(words);

  return flights.map((f) => {
    const before = f.field_issues?.length ?? 0;
    const issues = [...(f.field_issues ?? [])];
    const flagged = (field: string) => issues.some((i) => i.field === field);

    const check = (field: 'dep_place' | 'arr_place' | 'registration') => {
      const v = String((f as any)[field] ?? '');
      if (!v || flagged(field)) return;            // rör inte redan-flaggade fält
      if (!corroborated(v, tokens)) {
        issues.push({ field, reason: `Vision did not find "${v}" on the page — check`, confidence: 0.4 });
      }
    };
    check('dep_place');
    check('arr_place');
    check('registration');

    if (issues.length === before) return f;
    return { ...f, field_issues: issues, needs_review: true };
  });
}
