// Importrapporten efter CSV-import (pilot: app/import/index.tsx, drönare: app/drone-import/index.tsx), innan Save.
// Samma byggstenar och utseende i båda lägena (som skanningsrapporten): en sammanfattning överst med flygningar och
// flygtid, AI:ns korta "What we found", "Before you save" med det man kan rätta (en rad per sak, fälls ut) och
// "In this file" med tiderna som rutnät och listorna. Save ligger fast längst ner. Färgerna kommer från läget.

import { useState, type ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { FONT_SERIF, FONT_MONO } from '../logbook-page/tokens';

export interface ReportTheme {
  bg: string; card: string; elevated: string; border: string; separator: string;
  text: string; text2: string; muted: string;
  accent: string; success: string; warning: string; danger: string; onAccent: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Första och sista datumet som "Mar 2018 – Oct 2026" (samma månad → en gång).
export function periodOf(dates: string[]): string {
  const ds = dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '')).sort();
  if (!ds.length) return '';
  const fmt = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
  const a = fmt(ds[0]), b = fmt(ds[ds.length - 1]);
  return a === b ? a : `${a} – ${b}`;
}

// ── Sammanfattningen ──────────────────────────────────────────────────────────
export function ReportHero({ T, flights, time, period, fileName, format, coins, totalRows, mappedRows, toCheck }: {
  T: ReportTheme; flights: number; time: string; period: string; fileName: string; format: string;
  coins: number; totalRows: number; mappedRows: number; toCheck: number;
}) {
  const allRead = mappedRows >= totalRows;
  return (
    <LinearGradient colors={[T.accent + '24', 'rgba(15,30,58,0.55)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={[st.hero, { borderColor: T.accent + '33' }]}>
      <Text style={[st.eyebrow, { color: T.accent }]}>READY TO IMPORT</Text>
      <View style={st.heroTop}>
        <View style={{ gap: 3 }}>
          <Text style={[st.heroValue, { color: T.text }]}>{flights.toLocaleString('en-US')}</Text>
          <Text style={[st.heroLabel, { color: T.muted }]}>{flights === 1 ? 'FLIGHT' : 'FLIGHTS'}</Text>
        </View>
        <View style={{ gap: 3 }}>
          <Text style={[st.heroValue, { color: T.text }]}>{time}</Text>
          <Text style={[st.heroLabel, { color: T.muted }]}>FLIGHT TIME</Text>
        </View>
      </View>
      {!!period && <Text style={[st.heroPeriod, { color: T.text }]}>{period}</Text>}
      <View style={st.heroStatus}>
        <Text style={{ color: allRead ? T.success : T.warning, fontSize: 12.5, fontWeight: '700' }}>
          {allRead ? `All ${totalRows.toLocaleString('en-US')} rows read` : `${mappedRows.toLocaleString('en-US')} of ${totalRows.toLocaleString('en-US')} rows read`}
        </Text>
        {toCheck > 0 && (
          <Text style={{ color: T.warning, fontSize: 12.5, fontWeight: '700' }}>{'   ·   '}{toCheck} to check</Text>
        )}
      </View>
      <View style={[st.heroFile, { borderTopColor: 'rgba(255,255,255,0.12)' }]}>
        <Ionicons name="document-text-outline" size={14} color={T.text2} />
        <Text style={[st.heroFileText, { color: T.text2 }]} numberOfLines={1}>{fileName}</Text>
        {coins > 0 && <Text style={[st.heroCoins, { color: T.muted }]}>{coins.toLocaleString('en-US')} coins</Text>}
      </View>
      {!!format && <Text style={[st.heroFormat, { color: T.muted }]} numberOfLines={2}>{format}</Text>}
    </LinearGradient>
  );
}

// ── AI:ns sammanfattning ──────────────────────────────────────────────────────
// Svaret: en inledande mening, sedan rader med "CHECK: ", "OK: " eller "FIX: " (services/import.ts SUMMARY_PROMPT).
// Äldre svar ("- " och "Fix: ") visas också. **fet** = det viktigaste på raden.
type Line = { kind: 'check' | 'ok' | 'fix' | 'note'; text: string };
export function parseAnalysis(text: string): { headline: string; lines: Line[] } {
  const raw = text.split('\n').map((l) => l.trim()).filter(Boolean);
  let headline = '';
  const lines: Line[] = [];
  for (const l0 of raw) {
    const l = l0.replace(/^[-•]\s+/, '');
    const m = l.match(/^(CHECK|OK|FIX)\s*:\s*(.*)$/i);
    if (m) lines.push({ kind: m[1].toLowerCase() as Line['kind'], text: m[2].replace(/^(\*\*)?([a-z])/, (_, b, c) => (b ?? '') + c.toUpperCase()) });
    else if (!headline && !/^[-•]\s+/.test(l0)) headline = l;
    else lines.push({ kind: 'note', text: l });
  }
  // CHECK först, sedan OK, noteringar och sist FIX.
  const order = { check: 0, ok: 1, note: 2, fix: 3 } as const;
  lines.sort((a, b) => order[a.kind] - order[b.kind]);
  return { headline, lines };
}

function Bold({ text, color, strong }: { text: string; color: string; strong: string }) {
  return (
    <Text style={{ color, fontSize: 13.5, lineHeight: 19 }}>
      {text.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith('**') && p.endsWith('**')
        ? <Text key={i} style={{ fontWeight: '800', color: strong }}>{p.slice(2, -2)}</Text>
        : <Text key={i}>{p}</Text>))}
    </Text>
  );
}

export function AnalysisCard({ T, loading, text, fallback, failed = false }: {
  T: ReportTheme; loading: boolean; text: string | null; fallback: string; failed?: boolean;
}) {
  const tone = failed ? T.danger : T.accent;
  const parsed = text ? parseAnalysis(text) : null;
  const icon = (k: Line['kind']) => (k === 'check' ? { name: 'alert-circle' as const, color: T.warning }
    : k === 'ok' ? { name: 'checkmark-circle' as const, color: T.success }
    : k === 'fix' ? { name: 'construct' as const, color: T.accent }
    : { name: 'ellipse' as const, color: T.muted });
  return (
    <View style={[st.card, { backgroundColor: T.card, borderColor: tone + '33', padding: 14, gap: 10 }]}>
      {/* Rubrik bara vid fel; annars börjar kortet direkt med AI:ns mening. */}
      {failed && (
        <View style={st.cardHead}>
          <Ionicons name="alert-circle" size={14} color={tone} />
          <Text style={[st.eyebrow, { color: tone }]}>IMPORT FAILED</Text>
        </View>
      )}
      {loading || text === null ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 2 }}>
          <ActivityIndicator size="small" color={tone} />
          <Text style={{ color: T.muted, fontSize: 13, fontStyle: 'italic' }}>Looking through your file…</Text>
        </View>
      ) : !parsed || (!parsed.headline && parsed.lines.length === 0) ? (
        <Text style={{ color: T.text2, fontSize: 13.5, lineHeight: 19 }}>{fallback}</Text>
      ) : (
        <>
          {!!parsed.headline && <Text style={{ color: T.text, fontSize: 15, fontWeight: '700', lineHeight: 21 }}>{parsed.headline.replace(/\*\*/g, '')}</Text>}
          {parsed.lines.map((l, i) => {
            const ic = icon(l.kind);
            return (
              <View key={i} style={{ flexDirection: 'row', gap: 9, alignItems: 'flex-start' }}>
                <Ionicons name={ic.name} size={l.kind === 'note' ? 6 : 15} color={ic.color} style={{ marginTop: l.kind === 'note' ? 7 : 2 }} />
                <View style={{ flex: 1 }}><Bold text={l.text} color={T.text2} strong={T.text} /></View>
              </View>
            );
          })}
        </>
      )}
    </View>
  );
}

// ── Before you save ───────────────────────────────────────────────────────────
// status: todo = behöver ses över (gul), ai = AI letar just nu (accent), done = klart (grön), info = valfritt.
// statusText tom = ingen märkning (t.ex. när allt redan är ifyllt).
export type CheckStatus = 'todo' | 'ai' | 'done' | 'info';

export function SectionLabel({ T, children }: { T: ReportTheme; children: string }) {
  return <Text style={[st.section, { color: T.text2 }]}>{children}</Text>;
}

export function CheckGroup({ T, children }: { T: ReportTheme; children: ReactNode }) {
  return <View style={[st.card, { backgroundColor: T.card, borderColor: T.border }]}>{children}</View>;
}

export function CheckItem({ T, icon, title, summary, status, statusText, first, defaultOpen = false, children }: {
  T: ReportTheme; icon: keyof typeof Ionicons.glyphMap; title: string; summary: string; status: CheckStatus;
  statusText: string; first?: boolean; defaultOpen?: boolean; children?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const color = status === 'todo' ? T.warning : status === 'done' ? T.success : status === 'ai' ? T.accent : T.text2;
  return (
    <View style={!first && { borderTopWidth: 1, borderTopColor: T.separator }}>
      <TouchableOpacity style={st.checkHead} onPress={() => setOpen((o) => !o)} activeOpacity={0.75} disabled={!children}
        accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${title}. ${statusText}. ${summary}`}>
        <View style={[st.checkIcon, { backgroundColor: color + '1A', borderColor: color + '44' }]}>
          <Ionicons name={icon} size={16} color={color} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={[st.checkTitle, { color: T.text }]} numberOfLines={1}>{title}</Text>
            {!!statusText && (
              <View style={[st.pill, { backgroundColor: color + '1F', borderColor: color + '55' }]}>
                <Text style={[st.pillText, { color }]}>{statusText}</Text>
              </View>
            )}
          </View>
          <Text style={[st.checkSummary, { color: T.text2 }]} numberOfLines={open ? undefined : 2}>{summary}</Text>
        </View>
        {children ? <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={T.muted} /> : null}
      </TouchableOpacity>
      {open && children ? <View style={st.checkBody}>{children}</View> : null}
    </View>
  );
}

// En rad i en utfälld sak, t.ex. en flygplanstyp: namn, kort sammanfattning, märkning och ett tryck för att ändra.
export function EditRow({ T, title, summary, tag, tagColor, loading, open, onPress, children }: {
  T: ReportTheme; title: string; summary: string; tag?: string; tagColor?: string; loading?: boolean;
  open: boolean; onPress: () => void; children?: ReactNode;
}) {
  return (
    <View style={[st.editRow, { backgroundColor: T.bg, borderColor: open ? T.accent + '66' : T.border }]}>
      <TouchableOpacity style={st.editHead} onPress={onPress} activeOpacity={0.75} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={[st.editTitle, { color: T.text }]} numberOfLines={1}>{title}</Text>
          <Text style={[st.editSummary, { color: T.text2 }]} numberOfLines={1}>{summary}</Text>
        </View>
        {loading ? <ActivityIndicator size="small" color={T.accent} /> : tag ? (
          <View style={[st.pill, { backgroundColor: (tagColor ?? T.accent) + '1F', borderColor: (tagColor ?? T.accent) + '55' }]}>
            <Text style={[st.pillText, { color: tagColor ?? T.accent }]}>{tag}</Text>
          </View>
        ) : null}
        <Text style={[st.editLink, { color: T.accent }]}>{open ? 'Done' : 'Edit'}</Text>
      </TouchableOpacity>
      {open && children ? <View style={st.editBody}>{children}</View> : null}
    </View>
  );
}

// ── In this file ──────────────────────────────────────────────────────────────
export function TotalsGrid({ T, items }: { T: ReportTheme; items: { label: string; value: string }[] }) {
  return (
    <View style={st.grid}>
      {items.map((it) => (
        <View key={it.label} style={st.cell}>
          <Text style={[st.cellLabel, { color: T.muted }]} numberOfLines={1}>{it.label.toUpperCase()}</Text>
          <Text style={[st.cellValue, { color: T.text }]}>{it.value}</Text>
        </View>
      ))}
    </View>
  );
}

export function ListRow({ T, icon, label, count, onOpen, children }: {
  T: ReportTheme; icon: keyof typeof Ionicons.glyphMap; label: string; count: number; onOpen?: () => void; children: () => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const toggle = () => { if (!open) onOpen?.(); setOpen(!open); };
  return (
    <>
      <TouchableOpacity onPress={toggle} activeOpacity={0.7} disabled={count === 0}
        style={[st.listRow, { borderTopColor: T.separator }]} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Ionicons name={icon} size={16} color={T.accent} />
        <Text style={[st.listLabel, { color: T.text }]}>{label}</Text>
        <Text style={[st.listCount, { color: T.text2 }]}>{count}</Text>
        {count > 0 && <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={15} color={T.muted} />}
      </TouchableOpacity>
      {open && <View style={st.listBody}>{children()}</View>}
    </>
  );
}

// ── Save ──────────────────────────────────────────────────────────────────────
export function SaveFooter({ T, label, saving, disabled, onPress, bottom }: {
  T: ReportTheme; label: string; saving: boolean; disabled?: boolean; onPress: () => void; bottom: number;
}) {
  return (
    <View style={[st.footer, { backgroundColor: T.bg, borderTopColor: T.border, paddingBottom: bottom + 10 }]}>
      <TouchableOpacity style={[st.save, { backgroundColor: T.accent }, (saving || disabled) && { opacity: 0.5 }]} onPress={onPress}
        disabled={saving || disabled} activeOpacity={0.85} accessibilityRole="button">
        {saving ? <ActivityIndicator color={T.onAccent} /> : (
          <>
            <Ionicons name="checkmark-circle" size={19} color={T.onAccent} />
            <Text style={[st.saveText, { color: T.onAccent }]}>{label}</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}
export const FOOTER_SPACE = 96;

const st = StyleSheet.create({
  hero: { borderRadius: 18, borderWidth: 1, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 12, overflow: 'hidden', gap: 8 },
  eyebrow: { fontFamily: FONT_MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.6 },
  heroTop: { flexDirection: 'row', alignItems: 'flex-end', gap: 26, marginTop: 2 },
  heroValue: { fontFamily: FONT_SERIF, fontSize: 34, fontWeight: '600', fontVariant: ['tabular-nums'], lineHeight: 38 },
  heroLabel: { fontFamily: FONT_MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.4 },
  heroPeriod: { fontFamily: FONT_MONO, fontSize: 12, fontWeight: '600', opacity: 0.9 },
  heroStatus: { flexDirection: 'row', flexWrap: 'wrap' },
  heroFile: { flexDirection: 'row', alignItems: 'center', gap: 7, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, marginTop: 2 },
  heroFileText: { flex: 1, fontSize: 12.5, fontWeight: '600' },
  heroCoins: { fontFamily: FONT_MONO, fontSize: 11 },
  heroFormat: { fontSize: 11.5, lineHeight: 15, marginTop: -4 },

  card: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  section: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginTop: 6, marginBottom: -2, paddingHorizontal: 2 },

  checkHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  checkIcon: { width: 34, height: 34, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  checkTitle: { flexShrink: 1, fontSize: 15, fontWeight: '700' },
  checkSummary: { fontSize: 12.5, lineHeight: 17 },
  checkBody: { paddingHorizontal: 14, paddingBottom: 14, gap: 10 },
  pill: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, borderWidth: 1 },
  pillText: { fontFamily: FONT_MONO, fontSize: 9, fontWeight: '800', letterSpacing: 0.6 },

  editRow: { borderRadius: 10, borderWidth: 1, overflow: 'hidden' },
  editHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  editTitle: { fontFamily: FONT_MONO, fontSize: 14, fontWeight: '700', letterSpacing: 0.3 },
  editSummary: { fontSize: 12 },
  editLink: { fontSize: 13, fontWeight: '700', marginLeft: 2 },
  editBody: { paddingHorizontal: 10, paddingBottom: 10, gap: 8 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12, paddingHorizontal: 14, paddingVertical: 14 },
  cell: { width: '33.33%', gap: 3 },
  cellLabel: { fontFamily: FONT_MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  cellValue: { fontFamily: FONT_MONO, fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: 1 },
  listLabel: { flex: 1, fontSize: 14, fontWeight: '600' },
  listCount: { fontFamily: FONT_MONO, fontSize: 13, fontWeight: '700' },
  listBody: { paddingHorizontal: 14, paddingBottom: 12, gap: 8 },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  save: { height: 52, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  saveText: { fontSize: 16.5, fontWeight: '800' },
});
