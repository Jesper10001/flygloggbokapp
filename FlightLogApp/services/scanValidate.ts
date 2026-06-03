// Deterministisk validering efter OCR (ingen AI). Snappar tvetydiga läsningar
// mot användarens kända flotta/flygplatser/typer och rimlighetskollar tider.
// Lägger BARA till field_issues med suggested_value — ändrar aldrig värden tyst,
// så review-skärmen kan visa förslaget och användaren bekräfta.

import type { OcrFlightResult } from '../types/flight';
import type { ScanVocab } from './scanVocab';

const norm = (s: string) => (s || '').toUpperCase().replace(/[\s-]/g, '');

/** Sant om strängarna skiljer sig med högst en infogning/borttagning/ersättning. */
function withinEdit1(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la > lb) return withinEdit1(b, a);   // gör a kortast
  let i = 0, j = 0, edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; }
    else {
      if (++edits > 1) return false;
      if (la === lb) { i++; j++; }          // ersättning
      else { j++; }                          // infogning i b
    }
  }
  return edits + (lb - j) <= 1;
}

/**
 * Närmaste UNIKA vokabulärmedlem inom redigeringsavstånd 1. Returnerar null om
 * värdet redan är känt (exakt match) eller om kandidaterna är 0 eller flera —
 * då finns ingen entydig korrigering och vi gissar inte.
 */
function nearestUnique(value: string, vocab: string[]): string | null {
  const nv = norm(value);
  if (!nv || vocab.length === 0) return null;
  if (vocab.some((v) => norm(v) === nv)) return null;
  const cands = vocab.filter((v) => withinEdit1(norm(v), nv));
  const uniqueNorms = new Set(cands.map(norm));
  if (uniqueNorms.size !== 1) return null;
  return cands[0];
}

export function validateAgainstVocab(flights: OcrFlightResult[], vocab: ScanVocab): OcrFlightResult[] {
  return flights.map((f) => {
    const baseCount = f.field_issues?.length ?? 0;
    const issues = [...(f.field_issues ?? [])];
    const flagged = (field: string) => issues.some((i) => i.field === field);

    const suggest = (field: string, vlist: string[], reason: string) => {
      if (flagged(field)) return;                       // rör inte fält AI redan flaggat
      const cur = String((f as any)[field] ?? '');
      const sug = nearestUnique(cur, vlist);
      if (sug && norm(sug) !== norm(cur)) {
        issues.push({ field, reason, confidence: 0.6, suggested_value: sug });
      }
    };

    suggest('registration', vocab.fleet, 'Liknar en känd registrering i din flotta — bekräfta');
    suggest('aircraft_type', vocab.aircraftTypes, 'Liknar en känd flygplanstyp — bekräfta');
    suggest('dep_place', vocab.frequentIcaos, 'Liknar en flygplats du ofta använder — bekräfta');
    suggest('arr_place', vocab.frequentIcaos, 'Liknar en flygplats du ofta använder — bekräfta');

    const checkRange = (field: string, max: number) => {
      if (flagged(field)) return;
      const n = parseFloat(String((f as any)[field] ?? '').replace(',', '.'));
      if (!isNaN(n) && (n < 0 || n > max)) {
        issues.push({ field, reason: `Osannolik tid (${n}h) — kontrollera`, confidence: 0.4 });
      }
    };
    checkRange('total_time', 24);
    ['pic', 'co_pilot', 'dual', 'ifr', 'night', 'instructor'].forEach((k) => checkRange(k, 24));

    if (issues.length === baseCount) return f;
    return { ...f, field_issues: issues, needs_review: true };
  });
}
