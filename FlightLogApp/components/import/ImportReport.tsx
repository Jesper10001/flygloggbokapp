// Importrapporten efter CSV-import (pilot: app/import/index.tsx, drönare: app/drone-import/index.tsx), innan Save.
// Samma byggstenar och utseende i båda lägena (som skanningsrapporten): en sammanfattning överst med flygningar och
// flygtid, AI:ns korta "What we found", "Before you save" med det man kan rätta (en rad per sak, fälls ut) och
// "In this file" med tiderna som rutnät och listorna. Save ligger fast längst ner. Färgerna kommer från läget.
// Flygningar som behöver ses över (kapade tider, okända platser, noteringar med datum) blir egna rader under
// "Before you save" (ReviewGroup); AI:ns text länkar dit med [[id|text]], och ett tryck skrollar dit och fäller ut.
// Jämförelsen med loggboken (services/logbookMatch) ger två grupper till: flygningar som redan finns (lämnas utanför)
// och flygningar som krockar i tid med en i loggboken, där man väljer vilken som ska vara kvar (ClashRow).

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, type ScrollView, type LayoutChangeEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { FONT_SERIF, FONT_MONO } from '../logbook-page/tokens';
import type { LogbookMatch } from '../../services/logbookMatch';

export interface ReportTheme {
  bg: string; card: string; elevated: string; border: string; separator: string;
  text: string; text2: string; muted: string;
  accent: string; success: string; warning: string; danger: string; onAccent: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ── Flygningar att se över ────────────────────────────────────────────────────
export interface ReviewFlight { idx: number; date: string; route: string; sub: string; detail: string }
export interface ReviewGroup { id: string; title: string; about: string; todo: boolean; flights: ReviewFlight[] }

// Datum (YYYY-MM-DD) som nämns i en text, t.ex. en notering från läsningen.
export function datesIn(text: string): string[] {
  return [...new Set(text.match(/\b\d{4}-\d{2}-\d{2}\b/g) ?? [])];
}
export const dayMonth = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}` : d);

// Grupperna från jämförelsen med loggboken, först under "Before you save": krockar (välj vilken som ska vara kvar)
// och flygningar som redan finns (lämnas utanför från början). base = flygningens rad som i övriga grupper.
export function logbookReview(m: LogbookMatch, base: (i: number) => ReviewFlight, fmt: (h: number) => string, drone = false): ReviewGroup[] {
  const groups: ReviewGroup[] = [];
  const timed = (i: number) => { const f = base(i), t = m.times.get(i); return t ? { ...f, sub: `${t} · ${f.sub}` } : f; };
  const clash = [...m.clashes.entries()].sort((a, b) => a[0] - b[0]);
  if (clash.length) {
    const one = clash.length === 1;
    groups.push({
      id: 'clash', todo: true, title: 'Overlaps with your logbook',
      about: `${one ? 'This flight overlaps' : 'These flights overlap'} in time with ${one ? 'a flight' : 'flights'} already in your logbook. Choose which one to keep, or keep both.`,
      flights: clash.map(([i, hits]) => ({ ...timed(i), detail: `Overlaps by ${Math.max(...hits.map((h) => h.minutes))} min` })),
    });
  }
  const dups = [...m.dups.entries()].sort((a, b) => a[0] - b[0]);
  if (dups.length) {
    const one = dups.length === 1;
    const same = drone ? 'date, take-off time and length' : 'date, route and times';
    groups.push({
      id: 'dups', todo: false, title: 'Already in your logbook',
      about: `Same ${same} as ${one ? 'a flight' : 'flights'} you already have, so ${one ? "it's" : "they're"} left out and nothing is counted twice. Tap Include if ${one ? 'it is' : 'one is'} a different flight.`,
      flights: dups.map(([i, d]) => ({
        ...timed(i),
        detail: d.logged
          ? `In your logbook: ${[d.logged.times, fmt(d.logged.total), d.logged.source].filter(Boolean).join(' · ')}${d.zone ? ` · ${Math.abs(d.zone)} h apart (local time and UTC)` : ''}`
          : 'Listed twice in this file',
      })),
    });
  }
  return groups;
}

// Det AI:n får veta om grupperna, så att den kan länka till dem.
export const reviewForAi = (gs: ReviewGroup[]) => gs.map((g) => ({
  id: g.id, title: g.title, flights: g.flights.length, about: g.about,
  examples: g.flights.slice(0, 2).map((f) => `${f.date} ${f.route}: ${f.detail}`),
}));

// Skrollar till en rad under "Before you save", fäller ut den och lyser upp den en stund (länkarna i AI:ns text).
export function useCheckNav() {
  const scrollRef = useRef<ScrollView>(null);
  const groupY = useRef(0);
  const itemY = useRef<Record<string, number>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const go = (key: string) => {
    setOpen((o) => ({ ...o, [key]: true }));
    setFlash(key);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setFlash(null), 1800);
    setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, groupY.current + (itemY.current[key] ?? 0) - 12), animated: true }), 60);
  };
  return {
    scrollRef, open, flash, go,
    toggle: (key: string) => setOpen((o) => ({ ...o, [key]: !o[key] })),
    reset: () => { setOpen({}); setFlash(null); },
    onGroupLayout: (e: LayoutChangeEvent) => { groupY.current = e.nativeEvent.layout.y; },
    onItemLayout: (key: string) => (e: LayoutChangeEvent) => { itemY.current[key] = e.nativeEvent.layout.y; },
  };
}

// Första och sista datumet som "Mar 2018 – Oct 2026" (samma månad → en gång).
export function periodOf(dates: string[]): string {
  const ds = dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '')).sort();
  if (!ds.length) return '';
  const fmt = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
  const a = fmt(ds[0]), b = fmt(ds[ds.length - 1]);
  return a === b ? a : `${a} – ${b}`;
}

// ── Sammanfattningen ──────────────────────────────────────────────────────────
// sim: simulatortid för sig (pilot), till höger om flygtiden och lite mindre; flygtiden räknar aldrig in den.
export function ReportHero({ T, flights, time, sim, period, fileName, format, coins, totalRows, mappedRows, toCheck }: {
  T: ReportTheme; flights: number; time: string; sim?: string; period: string; fileName: string; format: string;
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
        {sim ? (
          <View style={{ gap: 3 }}>
            <Text style={[st.heroSim, { color: T.text2 }]}>{sim}</Text>
            <Text style={[st.heroLabel, { color: T.muted }]}>SIM</Text>
          </View>
        ) : null}
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

// **fet** = det viktigaste; [[id|text]] = en länk till en grupp under "Before you save" (understruken, med pil).
// En länk till en grupp som inte finns visas som fet text.
function Bold({ text, color, strong, link, linkIds, onLink }: {
  text: string; color: string; strong: string; link: string; linkIds?: Set<string>; onLink?: (id: string) => void;
}) {
  return (
    <Text style={{ color, fontSize: 13.5, lineHeight: 19 }}>
      {text.split(/(\[\[[^\]|]+\|[^\]]+\]\]|\*\*[^*]+\*\*)/g).filter(Boolean).map((p, i) => {
        const m = p.match(/^\[\[([^\]|]+)\|([^\]]+)\]\]$/);
        if (m) {
          const id = m[1].trim(), label = m[2].replace(/\*\*/g, '');
          if (onLink && linkIds?.has(id)) {
            return (
              <Text key={i} onPress={() => onLink(id)} accessibilityRole="link" suppressHighlighting={false}
                style={{ fontWeight: '800', color: link, textDecorationLine: 'underline', textDecorationColor: link + '99' }}>
                {label}<Text style={{ textDecorationLine: 'none' }}>{' ›'}</Text>
              </Text>
            );
          }
          return <Text key={i} style={{ fontWeight: '800', color: strong }}>{label}</Text>;
        }
        return p.startsWith('**') && p.endsWith('**')
          ? <Text key={i} style={{ fontWeight: '800', color: strong }}>{p.slice(2, -2)}</Text>
          : <Text key={i}>{p}</Text>;
      })}
    </Text>
  );
}

export function AnalysisCard({ T, loading, text, fallback, failed = false, linkIds, onLink }: {
  T: ReportTheme; loading: boolean; text: string | null; fallback: string; failed?: boolean;
  linkIds?: Set<string>; onLink?: (id: string) => void;
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
          {!!parsed.headline && <Text style={{ color: T.text, fontSize: 15, fontWeight: '700', lineHeight: 21 }}>{parsed.headline.replace(/\[\[[^\]|]+\|([^\]]+)\]\]/g, '$1').replace(/\*\*/g, '')}</Text>}
          {parsed.lines.map((l, i) => {
            const ic = icon(l.kind);
            return (
              <View key={i} style={{ flexDirection: 'row', gap: 9, alignItems: 'flex-start' }}>
                <Ionicons name={ic.name} size={l.kind === 'note' ? 6 : 15} color={ic.color} style={{ marginTop: l.kind === 'note' ? 7 : 2 }} />
                <View style={{ flex: 1 }}>
                  <Bold text={l.text} color={T.text2} strong={T.text} link={l.kind === 'check' ? T.warning : T.accent} linkIds={linkIds} onLink={onLink} />
                </View>
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

// open/onToggle = styrd utifrån (useCheckNav); annars håller raden själv reda på om den är utfälld.
export function CheckItem({ T, icon, title, summary, status, statusText, first, defaultOpen = false, open: openProp, onToggle, highlight, children }: {
  T: ReportTheme; icon: keyof typeof Ionicons.glyphMap; title: string; summary: string; status: CheckStatus;
  statusText: string; first?: boolean; defaultOpen?: boolean; open?: boolean; onToggle?: () => void; highlight?: boolean; children?: ReactNode;
}) {
  const [own, setOwn] = useState(defaultOpen);
  const open = openProp ?? own;
  const color = status === 'todo' ? T.warning : status === 'done' ? T.success : status === 'ai' ? T.accent : T.text2;
  return (
    <View style={[!first && { borderTopWidth: 1, borderTopColor: T.separator }, highlight && { backgroundColor: color + '14' }]}>
      <TouchableOpacity style={st.checkHead} onPress={() => (onToggle ? onToggle() : setOwn((o) => !o))} activeOpacity={0.75} disabled={!children}
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

// En flygning att se över: datum, rutt, typ och tid, och på egen rad vad som är speciellt. "Leave out" = sparas inte.
export function ReviewFlightRow({ T, f, left, onToggleLeave }: { T: ReportTheme; f: ReviewFlight; left: boolean; onToggleLeave: () => void }) {
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(f.date);
  return (
    <View style={[st.revRow, { backgroundColor: T.bg, borderColor: T.border }, left && { opacity: 0.45 }]}>
      <View style={st.revDate}>
        <Text style={[st.revDay, { color: T.text }]}>{valid ? Number(f.date.slice(8, 10)) : '?'}</Text>
        <Text style={[st.revMon, { color: T.muted }]}>{valid ? `${MONTHS[Number(f.date.slice(5, 7)) - 1]} ${f.date.slice(2, 4)}` : ''}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={[st.revRoute, { color: T.text }]} numberOfLines={1}>{f.route}</Text>
        <Text style={[st.revSub, { color: T.text2 }]} numberOfLines={1}>{f.sub}</Text>
        {!!f.detail && <Text style={[st.revDetail, { color: T.warning }]}>{f.detail}</Text>}
      </View>
      <TouchableOpacity onPress={onToggleLeave} hitSlop={10} accessibilityRole="button"
        accessibilityLabel={left ? `Include the flight on ${f.date} again` : `Leave out the flight on ${f.date}`}>
        <Text style={[st.revLeave, { color: left ? T.accent : T.text2 }]}>{left ? 'Include' : 'Leave out'}</Text>
      </TouchableOpacity>
    </View>
  );
}

// Loggbokens flygningar i en krock, som rader i ClashRow.
export const clashOthers = (m: LogbookMatch, i: number, fmt: (h: number) => string): ClashOther[] =>
  (m.clashes.get(i) ?? []).map((h) => ({ route: h.logged.route, sub: [h.logged.times, h.logged.what, fmt(h.logged.total), h.logged.source].filter(Boolean).join(' · ') }));

// En flygning som krockar i tid med en eller flera i loggboken: båda visas, och man väljer vilken som ska vara kvar.
// "Keep new" tar bort loggbokens flygning när man sparar, "Keep logbook" lämnar den nya utanför.
export type ClashChoice = 'both' | 'new' | 'logbook';
export interface ClashOther { route: string; sub: string }
const CLASH_CHOICES: { key: ClashChoice; label: string }[] = [
  { key: 'both', label: 'Keep both' }, { key: 'new', label: 'Keep new' }, { key: 'logbook', label: 'Keep logbook' },
];
export function ClashRow({ T, f, others, choice, onChoose }: {
  T: ReportTheme; f: ReviewFlight; others: ClashOther[]; choice: ClashChoice; onChoose: (c: ClashChoice) => void;
}) {
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(f.date);
  const many = others.length > 1;
  const Tag = ({ text, color }: { text: string; color: string }) => (
    <View style={[st.clashTag, { backgroundColor: color + '1F', borderColor: color + '55' }]}>
      <Text style={[st.pillText, { color }]}>{text}</Text>
    </View>
  );
  return (
    <View style={[st.clashRow, { backgroundColor: T.bg, borderColor: T.border }]}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={st.revDate}>
          <Text style={[st.revDay, { color: T.text }]}>{valid ? Number(f.date.slice(8, 10)) : '?'}</Text>
          <Text style={[st.revMon, { color: T.muted }]}>{valid ? `${MONTHS[Number(f.date.slice(5, 7)) - 1]} ${f.date.slice(2, 4)}` : ''}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
          <View style={[st.clashLine, choice === 'logbook' && { opacity: 0.4 }]}>
            <Tag text="NEW" color={T.accent} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={[st.revRoute, { color: T.text }]} numberOfLines={1}>{f.route}</Text>
              <Text style={[st.revSub, { color: T.text2 }]} numberOfLines={1}>{f.sub}</Text>
            </View>
          </View>
          {others.map((o, k) => (
            <View key={k} style={[st.clashLine, choice === 'new' && { opacity: 0.4 }]}>
              <Tag text="LOGBOOK" color={T.text2} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={[st.revRoute, { color: T.text }, choice === 'new' && { textDecorationLine: 'line-through' }]} numberOfLines={1}>{o.route}</Text>
                <Text style={[st.revSub, { color: T.text2 }]} numberOfLines={1}>{o.sub}</Text>
              </View>
            </View>
          ))}
          {!!f.detail && <Text style={[st.revDetail, { color: T.warning, marginTop: 0 }]}>{f.detail}</Text>}
        </View>
      </View>
      <View style={[st.seg, { borderColor: T.border, backgroundColor: T.card }]} accessibilityRole="radiogroup">
        {CLASH_CHOICES.map((c) => {
          const on = choice === c.key;
          return (
            <TouchableOpacity key={c.key} style={[st.segBtn, on && { backgroundColor: T.accent }]} onPress={() => onChoose(c.key)} activeOpacity={0.8}
              accessibilityRole="radio" accessibilityState={{ selected: on }}>
              <Text style={[st.segText, { color: on ? T.onAccent : T.text2 }]} numberOfLines={1}>{c.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {choice !== 'both' && (
        <Text style={[st.clashNote, { color: choice === 'new' ? T.danger : T.text2 }]}>
          {choice === 'new'
            ? `${many ? `The ${others.length} logbook flights are` : 'The logbook flight is'} deleted when you save.`
            : 'This flight is left out of the import.'}
        </Text>
      )}
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
  heroTop: { flexDirection: 'row', alignItems: 'flex-end', gap: 22, marginTop: 2 },
  heroValue: { fontFamily: FONT_SERIF, fontSize: 34, fontWeight: '600', fontVariant: ['tabular-nums'], lineHeight: 38 },
  heroSim: { fontFamily: FONT_SERIF, fontSize: 22, fontWeight: '600', fontVariant: ['tabular-nums'], lineHeight: 26 },
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

  revRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  revDate: { width: 34, alignItems: 'center' },
  revDay: { fontFamily: FONT_SERIF, fontSize: 19, fontWeight: '600', lineHeight: 22 },
  revMon: { fontFamily: FONT_MONO, fontSize: 8, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 1 },
  revRoute: { fontFamily: FONT_MONO, fontSize: 13.5, fontWeight: '700', letterSpacing: 0.3 },
  revSub: { fontFamily: FONT_MONO, fontSize: 10.5 },
  revDetail: { fontSize: 12.5, lineHeight: 17, marginTop: 2 },
  revLeave: { fontSize: 12.5, fontWeight: '700' },
  clashRow: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 10, gap: 10 },
  clashLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  clashTag: { width: 62, alignItems: 'center', paddingVertical: 2, borderRadius: 999, borderWidth: 1, marginTop: 1 },
  clashNote: { fontSize: 12, fontWeight: '600', marginTop: -2 },
  seg: { flexDirection: 'row', borderWidth: 1, borderRadius: 10, padding: 3, gap: 3 },
  segBtn: { flex: 1, height: 30, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  segText: { fontSize: 12.5, fontWeight: '700' },
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
