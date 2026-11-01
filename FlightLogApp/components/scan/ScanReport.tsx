import { useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import type { TimeFormat } from '../../store/timeFormatStore';
import type { ScanRow } from '../../services/scanImport';
import { display, label, COUNT } from '../../services/scanFields';
import { formatTimeValue } from '../../hooks/useTimeFormat';
import { NewAircraftSection, type AircraftInput } from './NewAircraftCard';
import type { ColumnCheck } from '../../services/scanImport';

// Skanningsrapporten (stående), byggd för att överblicka många uppslag (upp till ~10):
//  - överst en sammanfattning: flygningar, flygtid och hur många sidor som stämmer med bokens summor
//  - ett hopfällbart avsnitt per uppslag med bokens sidnummer, kontroll kolumn för kolumn mot sidans
//    "Total this page" (Blades / boken) och en kompakt rad per flygning
//  - nya flygplanstyper som vid CSV-import, och Save längst ner
// Ett tryck på en flygning öppnar alla värden (FlightEditor). Simulatorpass räknas aldrig som flygtid.
// Inget sparas förrän "Save".

const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

// Fält som kan vara ogranskade (gul markering på raden).
const ALL_FIELDS = ['date', 'aircraft_type', 'registration', 'dep_place', 'dep_utc', 'arr_place', 'arr_utc', 'total_time', 'sim', 'sim_category',
  'pic', 'co_pilot', 'dual', 'instructor', 'multi_pilot', 'ifr', 'night', 'landings_day', 'landings_night', 'second_pilot', 'remarks'];
const SHORT: Record<string, string> = {
  total_time: 'Total', sim: 'Sim', pic: 'PIC', co_pilot: 'Co-pilot', dual: 'Dual', instructor: 'Instr.', multi_pilot: 'MP', single_pilot: 'SP',
  ifr: 'IFR', night: 'Night', landings_day: 'Ldg D', landings_night: 'Ldg N', nvg: 'NVG',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type CellState = 'open' | 'changed' | null;

export function ScanReport(p: {
  rows: ScanRow[];
  columnChecks: ColumnCheck[];
  spreads: number;
  pageLabels?: (string | null)[];     // bokens sidnummer per uppslag, t.ex. "p. 40–41"
  timeFormat: TimeFormat;
  cellState: (rowKey: string, field: string) => CellState;
  duplicates: Set<string>;
  openCount: number;
  newTypes: { type: string; registrations: string[]; rows: number }[];
  aircraft: Record<string, AircraftInput>;
  aircraftLoading: Set<string>;
  aircraftFailed: Set<string>;
  saving: boolean;
  timeBasis: 'utc' | 'local';
  onTimeBasis: (b: 'utc' | 'local') => void;
  insets: { top: number; left: number; right: number; bottom: number };
  onAircraftChange: (type: string, v: AircraftInput) => void;
  onOpenFlight: (rowKey: string) => void;
  onToggleSkip: (rowKey: string) => void;
  onBack: () => void;
  onSave: () => void;
}) {
  const { rows, timeFormat } = p;
  const pages = Array.from({ length: Math.max(p.spreads, 1, ...rows.map((r) => r.page + 1)) }, (_, i) => i);
  const isIn = (r: ScanRow) => !r.skip && !p.duplicates.has(r.key);
  const included = rows.filter(isIn);
  const num = (r: ScanRow, f: string) => parseFloat(String((r.data as any)[f] ?? '0')) || 0;
  const isSim = (r: ScanRow) => r.data.flight_type === 'sim';
  // Flygtid utan simulatorpass; simulatortiden för sig.
  const sumOf = (rs: ScanRow[], f: string) => rs.reduce((s, r) => s + (isSim(r) && f !== 'sim' ? 0 : f === 'sim' ? (isSim(r) ? num(r, 'total_time') : 0) : num(r, f)), 0);
  const fmtH = (h: number) => formatTimeValue(h, timeFormat);
  const fmtV = (f: string, v: number) => (COUNT.has(f) ? String(Math.round(v)) : fmtH(v));
  const rowOpen = (r: ScanRow) => ALL_FIELDS.filter((f) => p.cellState(r.key, f) === 'open').length;
  const checksFor = (pg: number) => p.columnChecks.filter((c) => c.page === pg);
  const pageRowsOf = (pg: number) => rows.filter((r) => r.page === pg).sort((a, b) => a.rowIndex - b.rowIndex);
  const needsLook = (pg: number) => checksFor(pg).some((c) => !c.ok) || pageRowsOf(pg).some((r) => rowOpen(r) > 0 || (r.adjusted?.length ?? 0) > 0);

  // Med många uppslag är bara de som behöver ses över utfällda.
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set(pages.filter((pg) => pages.length <= 2 || needsLook(pg))));
  const toggle = (pg: number) => setExpanded((e) => { const n = new Set(e); if (n.has(pg)) n.delete(pg); else n.add(pg); return n; });

  const checkedPages = pages.filter((pg) => checksFor(pg).length > 0);
  const matching = checkedPages.filter((pg) => checksFor(pg).every((c) => c.ok)).length;
  const adjustedCount = rows.filter((r) => (r.adjusted?.length ?? 0) > 0 && isIn(r)).length;
  const simCount = included.filter(isSim).length;

  // Ett värde på flygningsraden: gul botten = inte granskat, blå text = ändrat.
  const V = ({ r, field, text, style }: { r: ScanRow; field: string; text?: string; style?: any }) => {
    const st = p.cellState(r.key, field);
    const v = text ?? display(r.data, field, timeFormat);
    return (
      <Text numberOfLines={1} style={[s.v, style, !v && s.vEmpty, st === 'open' && s.vOpen, st === 'changed' && s.vChanged]}>
        {v || '—'}
      </Text>
    );
  };

  const shortDate = (d: string) => { const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(d || ''); return m ? `${m[2]}.${m[1]}` : d || ''; };
  const period = (rs: ScanRow[]) => {
    const ds = rs.map((r) => r.data.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '')).sort();
    if (!ds.length) return '';
    const fmt = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
    const a = fmt(ds[0]), b = fmt(ds[ds.length - 1]);
    return a === b ? a : a.slice(-4) === b.slice(-4) ? `${a.slice(0, 3)}–${b}` : `${a} – ${b}`;
  };

  return (
    <View style={[s.root, { paddingTop: p.insets.top + 6 }]}>
      <View style={s.header}>
        <TouchableOpacity style={s.back} onPress={p.onBack} hitSlop={8} accessibilityLabel="Back to the page">
          <Ionicons name="chevron-back" size={20} color={Colors.primary} />
          <Text style={s.backText}>Page</Text>
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={s.title}>Scan report</Text>
          <Text style={s.subtitle}>{pages.length === 1 ? '1 spread' : `${pages.length} spreads`}</Text>
        </View>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: p.insets.bottom + 110 }} showsVerticalScrollIndicator={false}>
        {/* Sammanfattning */}
        <View style={s.summary}>
          <Stat value={String(included.length)} label={included.length === 1 ? 'flight' : 'flights'} />
          <View style={s.sumDivider} />
          <Stat value={fmtH(sumOf(included, 'total_time'))} label="flight time" />
          <View style={s.sumDivider} />
          <Stat
            value={checkedPages.length ? `${matching}/${checkedPages.length}` : '–'}
            label={checkedPages.length === 1 ? 'page total matches' : 'page totals match'}
            tone={!checkedPages.length ? undefined : matching === checkedPages.length ? 'ok' : 'warn'}
          />
        </View>
        {(p.openCount > 0 || adjustedCount > 0 || p.duplicates.size > 0 || simCount > 0) && (
          <View style={s.chips}>
            {p.openCount > 0 && <Chip tone="warn" icon="ellipse" text={`${p.openCount} unchecked`} />}
            {adjustedCount > 0 && <Chip tone="warn" icon="git-compare-outline" text={`${adjustedCount} adjusted to the page total`} />}
            {simCount > 0 && <Chip tone="info" icon="desktop-outline" text={`${simCount} simulator · ${fmtH(sumOf(included, 'sim'))}`} />}
            {p.duplicates.size > 0 && <Chip icon="copy-outline" text={`${p.duplicates.size} already in your logbook`} />}
          </View>
        )}

        {/* Ett avsnitt per uppslag */}
        {pages.map((pg) => {
          const pr = pageRowsOf(pg);
          const inPage = pr.filter(isIn);
          const checks = checksFor(pg);
          const bad = checks.filter((c) => !c.ok).length;
          const open = expanded.has(pg);
          const lbl = p.pageLabels?.[pg];
          const status = bad > 0 ? 'warn' : checks.length ? 'ok' : 'none';
          return (
            <View key={pg} style={s.spread}>
              <TouchableOpacity style={s.spreadHead} onPress={() => toggle(pg)} activeOpacity={0.75}
                accessibilityRole="button" accessibilityState={{ expanded: open }}>
                <Ionicons
                  name={status === 'warn' ? 'alert-circle' : status === 'ok' ? 'checkmark-circle' : 'remove-circle-outline'}
                  size={20} color={status === 'warn' ? Colors.warning : status === 'ok' ? Colors.success : Colors.textMuted}
                />
                <View style={{ flex: 1 }}>
                  <Text style={s.spreadTitle} numberOfLines={1}>
                    {pages.length > 1 ? `Spread ${pg + 1}` : 'Spread'}{lbl ? ` · ${lbl}` : ''}
                  </Text>
                  <Text style={s.spreadSub} numberOfLines={1}>
                    {inPage.length === 1 ? '1 flight' : `${inPage.length} flights`} · {fmtH(sumOf(inPage, 'total_time'))} h
                    {period(pr) ? ` · ${period(pr)}` : ''}
                    {bad > 0 ? ` · ${bad} total${bad === 1 ? '' : 's'} off` : ''}
                  </Text>
                </View>
                <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.textSecondary} />
              </TouchableOpacity>

              {open && (
                <>
                  {/* Sidans summor: Blades mot boken, kolumn för kolumn */}
                  <View style={s.ledger}>
                    <Text style={s.ledgerTitle}>PAGE TOTALS · BLADES / BOOK</Text>
                    {checks.length ? (
                      <View style={s.ledgerChips}>
                        {checks.map((c) => (
                          <View key={c.field} style={[s.lchip, c.ok ? s.lchipOk : s.lchipBad]}>
                            <Text style={s.lchipLabel}>{SHORT[c.field] ?? label(c.field)}</Text>
                            <Text style={[s.lchipValue, { color: c.ok ? Colors.success : Colors.warning }]}>
                              {c.ok ? fmtV(c.field, c.printed) : `${fmtV(c.field, c.sum)} / ${fmtV(c.field, c.printed)}`}
                            </Text>
                            <Ionicons name={c.ok ? 'checkmark' : 'close'} size={13} color={c.ok ? Colors.success : Colors.warning} />
                          </View>
                        ))}
                      </View>
                    ) : (
                      <Text style={s.ledgerNone}>No page totals were read on this spread, so there's nothing to compare with.</Text>
                    )}
                  </View>

                  {/* Flygningarna, en rad var */}
                  <View style={s.tableHead}>
                    <Text style={[s.th, { width: 22 }]} />
                    <Text style={[s.th, { width: 42 }]}>DATE</Text>
                    <Text style={[s.th, { width: 50 }]}>TYPE</Text>
                    <Text style={[s.th, { width: 58 }]}>REG</Text>
                    <Text style={[s.th, { flex: 1 }]}>ROUTE</Text>
                    <Text style={[s.th, { width: 38, textAlign: 'right' }]}>TOTAL</Text>
                    <View style={{ width: 14 }} />
                  </View>
                  {pr.length === 0 && <Text style={s.ledgerNone}>No flights were read on this spread.</Text>}
                  {pr.map((r) => {
                    const dup = p.duplicates.has(r.key);
                    const off = r.skip || dup;
                    const openN = rowOpen(r);
                    const tags: { text: string; color: string }[] = [];
                    if (isSim(r)) tags.push({ text: `SIM ${fmtH(num(r, 'total_time'))}${r.data.sim_category ? ` · ${String(r.data.sim_category).replace(/_/g, ' ').toUpperCase()}` : ''}`, color: Colors.primary });
                    for (const a of r.adjusted ?? []) tags.push({ text: `ADJUSTED ${(SHORT[a.field] ?? label(a.field)).toUpperCase()} ${a.from}→${a.to}`, color: Colors.warning });
                    if (openN > 0) tags.push({ text: `${openN} UNCHECKED`, color: Colors.warning });
                    if (dup) tags.push({ text: 'ALREADY IN YOUR LOGBOOK', color: Colors.textMuted });
                    else if (r.skip) tags.push({ text: 'LEFT OUT', color: Colors.textMuted });
                    return (
                      <View key={r.key} style={[s.fl, off && { opacity: 0.45 }]}>
                        <TouchableOpacity onPress={() => p.onToggleSkip(r.key)} hitSlop={8} disabled={dup} style={{ width: 22 }}
                          accessibilityRole="checkbox" accessibilityState={{ checked: !off }} accessibilityLabel={`Include row ${r.rowIndex}`}>
                          <Ionicons name={off ? 'square-outline' : 'checkbox'} size={18} color={off ? Colors.textMuted : Colors.primary} />
                        </TouchableOpacity>
                        <TouchableOpacity style={s.flBody} onPress={() => p.onOpenFlight(r.key)} activeOpacity={0.7}
                          accessibilityLabel={`Flight on row ${r.rowIndex}. Tap to see and edit all values.`}>
                          <View style={s.flMain}>
                            <V r={r} field="date" text={shortDate(r.data.date)} style={{ width: 42 }} />
                            <V r={r} field="aircraft_type" style={{ width: 50 }} />
                            <V r={r} field="registration" style={{ width: 58 }} />
                            <View style={s.route}>
                              <V r={r} field="dep_place" style={s.vPlace} />
                              <Text style={s.arrow}>→</Text>
                              <V r={r} field="arr_place" style={s.vPlace} />
                            </View>
                            <V r={r} field="total_time" text={isSim(r) ? '–' : undefined} style={s.vTotal} />
                          </View>
                          {tags.length > 0 && (
                            <Text style={s.tags} numberOfLines={1}>
                              {tags.map((t, i) => (
                                <Text key={i} style={{ color: t.color }}>{i > 0 ? '  ·  ' : ''}{t.text}</Text>
                              ))}
                            </Text>
                          )}
                        </TouchableOpacity>
                        <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
                      </View>
                    );
                  })}
                </>
              )}
            </View>
          );
        })}

        {/* Alla uppslag tillsammans (det som sparas). Simulatortid för sig, aldrig i flygtiden. */}
        {pages.length > 1 && (
          <View style={s.totals}>
            <Text style={s.totalsLabel}>ALL SPREADS · WHAT WILL BE SAVED</Text>
            <Text style={s.totalsText}>
              {[
                `Total ${fmtH(sumOf(included, 'total_time'))}`,
                ...['pic', 'co_pilot', 'dual', 'instructor', 'ifr', 'night'].filter((f) => sumOf(included, f) > 0).map((f) => `${SHORT[f]} ${fmtH(sumOf(included, f))}`),
                ...(sumOf(included, 'landings_day') + sumOf(included, 'landings_night') > 0 ? [`Landings ${Math.round(sumOf(included, 'landings_day') + sumOf(included, 'landings_night'))}`] : []),
                ...(simCount ? [`Sim ${fmtH(sumOf(included, 'sim'))}`] : []),
              ].join('  ·  ')}
            </Text>
          </View>
        )}

        <View style={s.basisRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.basisLabel}>TIMES IN THE BOOK</Text>
            <Text style={s.basisHint}>{p.timeBasis === 'local' ? 'Converted to UTC for each airport when you save.' : 'Saved as written.'}</Text>
          </View>
          <View style={s.segment}>
            {(['utc', 'local'] as const).map((b) => (
              <TouchableOpacity key={b} style={[s.segBtn, p.timeBasis === b && s.segBtnOn]} onPress={() => p.onTimeBasis(b)}
                accessibilityRole="radio" accessibilityState={{ selected: p.timeBasis === b }}>
                <Text style={[s.segText, p.timeBasis === b && s.segTextOn]}>{b === 'utc' ? 'UTC' : 'Local'}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <Text style={s.hint}>Tap a flight to see and edit all its values, including whether it was a simulator session. Untick a flight to leave it out. Yellow = not checked, blue = changed.</Text>

        {p.newTypes.length > 0 && (
          <View style={{ gap: 8, marginTop: 4 }}>
            <Text style={s.section}>NEW AIRCRAFT</Text>
            <NewAircraftSection types={p.newTypes} values={p.aircraft} loading={p.aircraftLoading} failed={p.aircraftFailed}
              onChange={p.onAircraftChange} />
          </View>
        )}
      </ScrollView>

      <View style={[s.footer, { paddingBottom: p.insets.bottom + 10 }]}>
        <TouchableOpacity style={[s.save, (p.saving || included.length === 0) && { opacity: 0.5 }]} onPress={p.onSave} disabled={p.saving || included.length === 0}>
          {p.saving ? <ActivityIndicator color={Colors.textInverse} /> : (
            <Text style={s.saveText}>Save {included.length === 1 ? '1 flight' : `${included.length} flights`}</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Stat({ value, label: text, tone }: { value: string; label: string; tone?: 'ok' | 'warn' }) {
  return (
    <View style={s.stat}>
      <Text style={[s.statValue, tone === 'ok' && { color: Colors.success }, tone === 'warn' && { color: Colors.warning }]} numberOfLines={1}>{value}</Text>
      <Text style={s.statLabel} numberOfLines={1}>{text}</Text>
    </View>
  );
}

function Chip({ text, icon, tone }: { text: string; icon: keyof typeof Ionicons.glyphMap; tone?: 'warn' | 'info' }) {
  const color = tone === 'warn' ? Colors.warning : tone === 'info' ? Colors.primary : Colors.textSecondary;
  return (
    <View style={[s.chip, { borderColor: color + '66', backgroundColor: color + '14' }]}>
      <Ionicons name={icon} size={11} color={color} />
      <Text style={[s.chipText, { color }]}>{text}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.cardBorder },
  back: { flexDirection: 'row', alignItems: 'center', width: 60, paddingVertical: 6 },
  backText: { color: Colors.primary, fontSize: 16, fontWeight: '600' },
  title: { color: '#fff', fontSize: 17, fontWeight: '800' },
  subtitle: { color: Colors.textSecondary, fontSize: 12, marginTop: 1 },

  summary: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 8, borderRadius: 14,
    backgroundColor: 'rgba(15,30,58,0.75)', borderWidth: 1, borderColor: Colors.cardBorder,
  },
  sumDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: Colors.cardBorder },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { color: '#fff', fontSize: 22, fontWeight: '800', fontFamily: MONO, fontVariant: ['tabular-nums'] },
  statLabel: { color: Colors.textMuted, fontSize: 11, fontWeight: '700' },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 9, borderWidth: 1 },
  chipText: { fontSize: 12, fontWeight: '700' },

  spread: { borderRadius: 14, backgroundColor: 'rgba(15,30,58,0.75)', borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden' },
  spreadHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 12 },
  spreadTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
  spreadSub: { color: Colors.textSecondary, fontSize: 12, marginTop: 1, fontVariant: ['tabular-nums'] },

  ledger: { marginHorizontal: 12, marginBottom: 8, padding: 10, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.22)', gap: 7 },
  ledgerTitle: { color: Colors.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 0.7 },
  ledgerChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  ledgerNone: { color: Colors.textMuted, fontSize: 12, lineHeight: 17, paddingHorizontal: 12, paddingBottom: 8 },
  lchip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  lchipOk: { borderColor: Colors.success + '55', backgroundColor: Colors.success + '10' },
  lchipBad: { borderColor: Colors.warning + '77', backgroundColor: Colors.warning + '16' },
  lchipLabel: { color: Colors.textSecondary, fontSize: 11.5, fontWeight: '700' },
  lchipValue: { fontSize: 12.5, fontWeight: '800', fontFamily: MONO, fontVariant: ['tabular-nums'] },

  tableHead: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingTop: 4, paddingBottom: 4 },
  th: { color: Colors.textMuted, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.6 },
  fl: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.cardBorder,
  },
  flBody: { flex: 1, gap: 3 },
  flMain: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  route: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 3, minWidth: 0 },
  arrow: { color: Colors.textMuted, fontSize: 11 },
  v: { color: '#fff', fontSize: 12.5, fontFamily: MONO, borderRadius: 4, overflow: 'hidden' },
  vPlace: { flexShrink: 1 },
  vTotal: { width: 38, textAlign: 'right', fontSize: 14, fontWeight: '700' },
  vEmpty: { color: Colors.textMuted },
  vOpen: { backgroundColor: 'rgba(255,184,48,0.28)' },
  vChanged: { color: Colors.primary, fontWeight: '700' },
  tags: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.5 },

  totals: { padding: 12, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.25)', gap: 4 },
  totalsLabel: { color: Colors.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 0.6 },
  totalsText: { color: '#fff', fontSize: 13, fontFamily: MONO, lineHeight: 19 },

  basisRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, backgroundColor: 'rgba(15,30,58,0.75)', borderWidth: 1, borderColor: Colors.cardBorder },
  basisLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  basisHint: { color: Colors.textMuted, fontSize: 12, marginTop: 2 },
  segment: { flexDirection: 'row', height: 36, borderRadius: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', padding: 3, gap: 3 },
  segBtn: { paddingHorizontal: 14, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  segBtnOn: { backgroundColor: Colors.primary + '26' },
  segText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '600' },
  segTextOn: { color: Colors.primary, fontWeight: '800' },
  section: { color: Colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  hint: { color: Colors.textMuted, fontSize: 12, lineHeight: 17 },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10, backgroundColor: Colors.background, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.cardBorder },
  save: { height: 52, borderRadius: 14, backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center' },
  saveText: { color: Colors.textInverse, fontSize: 17, fontWeight: '700' },
});
