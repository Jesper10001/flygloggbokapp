// Svar som lärs under en skanning. En pilot skriver samma sak på samma sätt, så Claude läser ofta fel på samma
// sätt på varje rad (ETHB som ETNB). Har användaren gett samma svar LEARN_AFTER gånger gäller det resten av
// boken: alla rader rättas och frågan ställs inte igen. "Looks right" lärs på samma sätt (from = to). Reglerna
// visas i rapporten, där de kan ångras. Ren logik utan I/O (scripts/test-scan-names.cjs).

export const LEARN_AFTER = 3;

export type RuleClass = 'place' | 'registration';
export interface ValueRule { cls: RuleClass; from: string; to: string }

const FIELDS: Record<RuleClass, string[]> = { place: ['dep_place', 'arr_place'], registration: ['registration'] };

export const ruleClassOf = (field: string): RuleClass | null =>
  (FIELDS.place.includes(field) ? 'place' : FIELDS.registration.includes(field) ? 'registration' : null);

export const upper = (v: unknown) => String(v ?? '').trim().toUpperCase();

export const ruleFor = (rules: ValueRule[], field: string, value: unknown): ValueRule | null => {
  const cls = ruleClassOf(field), v = upper(value);
  return (cls && v && rules.find((r) => r.cls === cls && r.from === v)) || null;
};

// Vad en regel ändrade på en rad, så att den kan ångras (fältets frågor läggs tillbaka).
export interface RuleStash { rule: ValueRule; issues: any[] }

type RowLike = { key: string; data: any };

/** Lägger reglerna på raderna: värdet rättas och fältets frågor tas bort. Nya rader, indatan ändras inte. */
export function applyValueRules<T extends RowLike>(rows: T[], rules: ValueRule[], stash: Map<string, RuleStash>): T[] {
  if (!rules.length) return rows;
  return rows.map((row) => {
    let data = row.data;
    for (const field of [...FIELDS.place, ...FIELDS.registration]) {
      const rule = ruleFor(rules, field, data[field]);
      if (!rule) continue;
      const issues = (data.field_issues ?? []).filter((i: any) => i.field === field);
      stash.set(`${row.key}:${field}`, { rule, issues });
      data = { ...data, [field]: rule.to, field_issues: (data.field_issues ?? []).filter((i: any) => i.field !== field) };
    }
    return data === row.data ? row : { ...row, data };
  });
}

/** Ångrar en regel på raderna den ändrade: läsningen och frågorna kommer tillbaka. */
export function undoValueRule<T extends RowLike>(rows: T[], rule: ValueRule, stash: Map<string, RuleStash>): T[] {
  return rows.map((row) => {
    let data = row.data;
    for (const field of [...FIELDS.place, ...FIELDS.registration]) {
      const id = `${row.key}:${field}`, s = stash.get(id);
      if (!s || s.rule.cls !== rule.cls || s.rule.from !== rule.from) continue;
      stash.delete(id);
      data = { ...data, [field]: rule.from, field_issues: [...(data.field_issues ?? []), ...s.issues] };
    }
    return data === row.data ? row : { ...row, data };
  });
}

/** Räknar ett svar (en gång per cell). Returnerar en ny regel när samma svar getts LEARN_AFTER gånger. */
export function noteAnswer(answers: Map<string, Set<string>>, rules: ValueRule[], field: string, rowKey: string, fromRaw: unknown, toRaw: unknown): ValueRule | null {
  const cls = ruleClassOf(field), from = upper(fromRaw), to = upper(toRaw);
  if (!cls || !from || !to || rules.some((r) => r.cls === cls && r.from === from)) return null;
  const key = `${cls}|${from}|${to}`;
  const cells = answers.get(key) ?? new Set<string>();
  cells.add(`${rowKey}:${field}`);
  answers.set(key, cells);
  return cells.size >= LEARN_AFTER ? { cls, from, to } : null;
}
