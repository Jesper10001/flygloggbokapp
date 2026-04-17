import { getDatabase } from './database';

export interface OcrLearnedEntry {
  id: number;
  category: string;  // 'aircraft_type' | 'second_pilot' | 'icao'
  raw_text: string;   // vad AI/piloten skrev
  resolved_value: string; // vad det faktiskt var
  confidence: number;
}

export async function saveLearnedMapping(category: string, rawText: string, resolvedValue: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO ocr_learned (category, raw_text, resolved_value)
     VALUES (?, ?, ?)
     ON CONFLICT(category, raw_text) DO UPDATE SET resolved_value=?, confidence=MIN(confidence+0.1, 1.0)`,
    [category, rawText.trim(), resolvedValue.trim(), resolvedValue.trim()],
  );
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
  const acTypes = entries.filter((e) => e.category === 'aircraft_type');
  const pilots = entries.filter((e) => e.category === 'second_pilot');
  if (acTypes.length > 0) {
    lines.push('INLÄRDA FLYGPLANSTYPER (pilotens handstil → rätt typ):');
    acTypes.forEach((e) => lines.push(`  "${e.raw_text}" → ${e.resolved_value}`));
  }
  if (pilots.length > 0) {
    lines.push('KÄNDA ANDREPILOTER (3-bokstavskod → namn):');
    pilots.forEach((e) => lines.push(`  "${e.raw_text}" → ${e.resolved_value}`));
  }
  return lines.join('\n');
}
