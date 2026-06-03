// Persistens för användarskapade loggboksmallar (custom-böcker).
//
// En custom-mall är en vanlig LogbookTemplate (samma artefakt som inbyggda
// mallar) serialiserad som JSON. Den driver BÅDE den digitala bokens rendering
// OCH OCR-layouten (via services/logbookLayout). getAllTemplates() slår ihop
// inbyggda + custom så galleriet och scan-väljaren ser allt på ett ställe.

import { getDatabase } from './database';
import { LOGBOOK_TEMPLATES, type LogbookTemplate } from '../constants/logbookTemplates';

interface CustomTemplateRow {
  id: string;
  name: string;
  json: string;
  created_at: string;
}

/** Alla användarskapade mallar (senast skapad först). Trasig JSON hoppas över. */
export async function getCustomTemplates(): Promise<LogbookTemplate[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<CustomTemplateRow>(
    'SELECT * FROM custom_templates ORDER BY created_at DESC',
  );
  const out: LogbookTemplate[] = [];
  for (const r of rows) {
    try {
      out.push(JSON.parse(r.json) as LogbookTemplate);
    } catch {
      // Ignorera en mall vars JSON inte går att tolka — hellre dölj än krascha.
    }
  }
  return out;
}

/** Inbyggda + custom-mallar i en lista (custom sist). */
export async function getAllTemplates(): Promise<LogbookTemplate[]> {
  return [...LOGBOOK_TEMPLATES, ...(await getCustomTemplates())];
}

/** Slår upp en mall via id i både inbyggda och custom. */
export async function getAnyTemplate(id: string): Promise<LogbookTemplate | null> {
  const builtIn = LOGBOOK_TEMPLATES.find((t) => t.id === id);
  if (builtIn) return builtIn;
  const custom = await getCustomTemplates();
  return custom.find((t) => t.id === id) ?? null;
}

/** Skapar eller uppdaterar en custom-mall (upsert på id). */
export async function saveCustomTemplate(tpl: LogbookTemplate): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    `INSERT INTO custom_templates (id, name, json) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, json = excluded.json`,
    [tpl.id, tpl.name, JSON.stringify(tpl)],
  );
}

export async function deleteCustomTemplate(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM custom_templates WHERE id = ?', [id]);
}

/**
 * Bygger ett unikt, stabilt custom-mall-id från ett namn. Lägger till ett
 * suffix om id:t redan finns, så två böcker med samma namn inte krockar.
 */
export async function makeUniqueCustomTemplateId(name: string): Promise<string> {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'book';
  const base = `custom-${slug}`;
  const existing = new Set((await getCustomTemplates()).map((t) => t.id));
  if (!existing.has(base)) return base;
  let n = 2;
  while (existing.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
