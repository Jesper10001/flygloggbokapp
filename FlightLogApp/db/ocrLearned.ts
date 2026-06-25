import { getDatabase } from './database';

export interface OcrLearnedEntry {
  id: number;
  category: string;  // 'aircraft_type' | 'second_pilot' | 'icao'
  raw_text: string;   // vad AI/piloten skrev
  resolved_value: string; // vad det faktiskt var
  confidence: number;
}

function isDittoLike(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 8) return false;
  // Classic ditto symbols
  if (/^[-–—:″〃"',.|~\\/ ]{1,6}$/.test(t)) return true;
  // -::- and do./do
  if (/^-?::-?$/.test(t) || /^do\.?$/i.test(t)) return true;
  // -11-, ~11~, -11-, —11— etc. — handwritten ditto that looks like digits
  // Pattern: delimiter + 1-2 chars + delimiter, where delimiters are -~—:
  if (/^[-–—~:]{1,2}\d{1,2}[-–—~:]{1,2}$/.test(t)) return true;
  // Quoted versions: "-11-", '~11~'
  if (/^["']["']$/.test(t)) return true;
  return false;
}

export async function saveLearnedMapping(category: string, rawText: string, resolvedValue: string): Promise<void> {
  const raw = rawText.trim();
  const resolved = resolvedValue.trim();
  if (!raw || !resolved || raw === resolved) return;
  if (isDittoLike(raw)) return;
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO ocr_learned (category, raw_text, resolved_value)
     VALUES (?, ?, ?)
     ON CONFLICT(category, raw_text) DO UPDATE SET resolved_value=?, confidence=MIN(confidence+0.1, 1.0)`,
    [category, raw, resolved, resolved],
  );
}

export async function cleanupDittoEntries(): Promise<void> {
  const db = await getDatabase();
  const entries = await db.getAllAsync<{ id: number; raw_text: string }>(`SELECT id, raw_text FROM ocr_learned`);
  const badIds = entries.filter(e => isDittoLike(e.raw_text)).map(e => e.id);
  if (badIds.length > 0) {
    await db.runAsync(`DELETE FROM ocr_learned WHERE id IN (${badIds.join(',')})`);
  }
}

export async function getLearnedMappings(category?: string): Promise<OcrLearnedEntry[]> {
  const db = await getDatabase();
  if (category) {
    return db.getAllAsync<OcrLearnedEntry>(
      `SELECT * FROM ocr_learned WHERE category=? ORDER BY confidence DESC`,
      [category],
    );
  }
  return db.getAllAsync<OcrLearnedEntry>(`SELECT * FROM ocr_learned ORDER BY category, confidence DESC`);
}

export async function buildContextHint(): Promise<string> {
  const entries = await getLearnedMappings();
  if (entries.length === 0) return '';
  const lines: string[] = [];
  const clean = entries.filter(e => !isDittoLike(e.raw_text));
  const acTypes = clean.filter((e) => e.category === 'aircraft_type');
  const pilots = clean.filter((e) => e.category === 'second_pilot');
  if (acTypes.length > 0) {
    lines.push('INLÄRDA FLYGPLANSTYPER (pilotens handstil → rätt typ):');
    acTypes.forEach((e) => lines.push(`  "${e.raw_text}" → ${e.resolved_value}`));
  }
  if (pilots.length > 0) {
    lines.push('KÄNDA ANDREPILOTER (3-bokstavskod → namn):');
    pilots.forEach((e) => lines.push(`  "${e.raw_text}" → ${e.resolved_value}`));
  }
  const icaos = clean.filter((e) => e.category === 'icao');
  if (icaos.length > 0) {
    lines.push('KÄNDA ICAO-KODER OCH OFF-AIRPORT-PLATSER (pilotens skrivsätt → rätt kod):');
    icaos.forEach((e) => lines.push(`  "${e.raw_text}" → ${e.resolved_value}`));
  }
  return lines.join('\n');
}
