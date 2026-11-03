import { useEffect, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Platform, TextInput } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../../constants/colors';
import type { TimeFormat } from '../../store/timeFormatStore';
import type { ScanRow } from '../../services/scanImport';
import { label, COUNT } from '../../services/scanFields';
import { formatTimeValue } from '../../hooks/useTimeFormat';
import { NewAircraftSection, type AircraftInput } from './NewAircraftCard';
import type { ColumnCheck } from '../../services/scanImport';
import { viaText, type TypeVia } from '../../services/scanTypes';
import type { ValueRule } from '../../services/scanValueRules';
import { FONT_SERIF, FONT_MONO, NIGHT_BADGE, NVG_BADGE, SIM_BADGE } from '../logbook-page/tokens';
import { dayOfMonth, weekdayShort } from '../logbook-page/flightDisplay';

// Skanningsrapporten (stående), likadan för ett uppslag som för många (upp till tio):
//  - överst en sammanfattning: flygningar och flygtid, ögat (uppslagen som loggbok) och second pilots
//  - ett avsnitt för hela skanningen: bokens sidor ("p. 78–86"), sidans summor kolumn för kolumn mot
//    "Total this page" (flera uppslag: summan, och det som inte stämmer uppslag för uppslag) och flygningarna
//    som i Logbook-listan (kort per flygning, år och månad, det senaste överst)
//  - flygplanstyper (matchade mot flottan, nya som vid CSV-import), och Save längst ner
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
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Den andra pilotens roll (samma nycklar som Log Flight; COP visas som SIC). Ett tryck byter till nästa.
const CREW_ROLES = ['PIC', 'COP', 'FI', 'SPIC', 'PICUS'];
const CREW_ROLE_NAME: Record<string, string> = { PIC: 'PIC', COP: 'SIC', FI: 'Instructor', SPIC: 'SPIC', PICUS: 'PICUS' };
const roleName = (k?: string) => CREW_ROLE_NAME[k ?? ''] ?? 'Role';
const nextRole = (k?: string) => CREW_ROLES[(CREW_ROLES.indexOf(k ?? '') + 1) % CREW_ROLES.length];

// Namnet på den andra piloten, rättas direkt (sparas när fältet lämnas).
function CrewName({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);
  const commit = () => { const v = text.trim(); if (v && v !== value) onCommit(v); else setText(value); };
  return (
    <TextInput value={text} onChangeText={setText} onEndEditing={commit} onSubmitEditing={commit} returnKeyType="done"
      autoCorrect={false} autoCapitalize="characters" style={s.crewInput} placeholder="Name" placeholderTextColor={Colors.textMuted}
      accessibilityLabel="Second pilot's name" />
  );
}

// Liten märkning som i loggbokens rader (FlightCardRow): IFR, natt, NVG, SIM.
function Badge({ color, label: text, ion, mci }: { color: string; label?: string; ion?: keyof typeof Ionicons.glyphMap; mci?: keyof typeof MaterialCommunityIcons.glyphMap }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: color + '1F', borderColor: color + '55', borderWidth: 1, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 }}>
      {ion ? <Ionicons name={ion} size={9} color={color} /> : null}
      {mci ? <MaterialCommunityIcons name={mci} size={10} color={color} /> : null}
      {text ? <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 0.7, color }}>{text}</Text> : null}
    </View>
  );
}

export type CellState = 'open' | 'changed' | null;

export function ScanReport(p: {
  rows: ScanRow[];
  columnChecks: ColumnCheck[];
  spreads: number;
  pageLabels?: (string | null)[];     // bokens sidnummer per uppslag, t.ex. "p. 40–41"
  pageNumbers?: { left: number | null; right: number | null }[];   // samma som tal (rubrikens "p. 78–86")
  timeFormat: TimeFormat;
  cellState: (rowKey: string, field: string) => CellState;
  duplicates: Set<string>;
  openCount: number;
  newTypes: { type: string; registrations: string[]; rows: number; aka?: string[]; groupId?: string }[];
  // Skrivsätt som fått en typ som redan finns i flottan (services/scanTypes.ts), och varför.
  fleetMatches?: { id: string; to: string; from: string[]; rows: number; via: TypeVia }[];
  onKeepSeparate?: (groupId: string) => void;
  // Namn som blivit ett (WOFF → WOLFF), och svar som lärts under skanningen (ETNB → ETHB).
  nameMatches?: { id: string; to: string; from: string[]; rows: number; similar: boolean }[];
  onKeepNamesSeparate?: (id: string) => void;
  onRemoveCrew?: (rowKey: string) => void;      // second pilot som inte var en person → tillbaka till anmärkningen
  onRestoreCrew?: (rowKey: string) => void;
  learned?: { rule: ValueRule; rows: number }[];
  onUndoRule?: (rule: ValueRule) => void;
  onNameType?: (groupId: string, name: string) => void;
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
  onEditField?: (rowKey: string, field: string, value: string) => void;   // rättelser direkt i rapporten (second pilot)
  onPresentLogbook?: (page: number) => void;   // uppslaget som loggbok, för att jämföra med pappersboken
  paperFixes?: { page: number; field: string }[];   // summor som är felräknade i pappersboken (rättas efter Save)
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

  // Med många uppslag är bara de som behöver ses över utfällda.
  const [listOpen, setListOpen] = useState(true);
  const [fixOpen, setFixOpen] = useState(false);
  // Bokens sidor i skanningen, lägsta till högsta ("p. 78–86").
  const pageNums = (p.pageNumbers ?? []).flatMap((n) => [n.left, n.right]).filter((n): n is number => typeof n === 'number' && n > 0);
  const pageRange = pageNums.length
    ? (Math.min(...pageNums) === Math.max(...pageNums) ? `p. ${pageNums[0]}` : `p. ${Math.min(...pageNums)}–${Math.max(...pageNums)}`)
    : pages.length === 1 ? p.pageLabels?.[0] ?? null : null;
  // Second pilots ur anmärkningen (hela skanningen, i bokens ordning) och om listan är utfälld.
  const crew = pages.flatMap((pg) => pageRowsOf(pg).filter((r) => r.fromRemarks));
  const [crewOpen, setCrewOpen] = useState(false);
  // Ögat ("View as logbook") öppnar första uppslaget med flygningar.
  const firstWithRows = pages.find((pg) => pageRowsOf(pg).length > 0) ?? 0;

  const adjustedCount = rows.filter((r) => (r.adjusted?.length ?? 0) > 0 && isIn(r)).length;
  const simCount = included.filter(isSim).length;
  const paperFix = (pg: number, field: string) => !!p.paperFixes?.some((f) => f.page === pg && f.field === field);
  const paperCount = p.paperFixes?.length ?? 0;
  const status = [
    ...(p.openCount > 0 ? [{ text: `${p.openCount} unchecked`, warn: true }] : []),
    ...(adjustedCount > 0 ? [{ text: `${adjustedCount} adjusted to the page total`, warn: true }] : []),
    ...(paperCount > 0 ? [{ text: `${paperCount} ${paperCount === 1 ? 'total' : 'totals'} to fix on paper`, warn: false }] : []),
    ...(p.duplicates.size > 0 ? [{ text: `${p.duplicates.size} already in your logbook`, warn: false }] : []),
  ];


  const period = (rs: ScanRow[]) => {
    const ds = rs.map((r) => r.data.date).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '')).sort();
    if (!ds.length) return '';
    const fmt = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
    const a = fmt(ds[0]), b = fmt(ds[ds.length - 1]);
    return a === b ? a : a.slice(-4) === b.slice(-4) ? `${a.slice(0, 3)}–${b}` : `${a} – ${b}`;
  };

  // Rollen som i loggboken (roleLabel): PIC, PICUS, SPIC, SIC, DUAL, INSTR; simulatorpass utan roll → SIM.
  const roleOf = (r: ScanRow) => (num(r, 'pic') > 0 ? 'PIC' : num(r, 'picus') > 0 ? 'PICUS' : num(r, 'spic') > 0 ? 'SPIC'
    : num(r, 'co_pilot') > 0 ? 'SIC' : num(r, 'dual') > 0 ? 'DUAL' : num(r, 'instructor') > 0 ? 'INSTR' : isSim(r) ? 'SIM' : '—');
  // Gul botten = inte granskat, blå text = ändrat (som tidigare i tabellen).
  const hl = (r: ScanRow, field: string) => {
    const st = p.cellState(r.key, field);
    return st === 'open' ? s.vOpen : st === 'changed' ? s.vChanged : null;
  };
  // Som loggboken: senaste datum (och klockslag) överst; samma dag i bokens ordning baklänges.
  const newestFirst = (a: ScanRow, b: ScanRow) => (b.data.date || '').localeCompare(a.data.date || '')
    || (b.data.dep_utc || '').localeCompare(a.data.dep_utc || '') || b.page - a.page || b.rowIndex - a.rowIndex;
  const yearOf = (r: ScanRow) => (/^\d{4}-\d{2}-/.test(r.data.date || '') ? Number(r.data.date.slice(0, 4)) : null);
  // År → månad i bokens ordning (raderna på uppslaget), som Logbook-listans rubriker.
  const groupByMonth = (rs: ScanRow[]) => {
    const out: { key: string; year: number | null; month: number | null; yearStart: boolean; rows: ScanRow[] }[] = [];
    for (const r of rs) {
      const y = yearOf(r);
      const m = y != null ? Number(r.data.date.slice(5, 7)) - 1 : null;
      const last = out[out.length - 1];
      if (last && last.year === y && last.month === m) { last.rows.push(r); continue; }
      out.push({ key: `${y}-${m}-${r.key}`, year: y, month: m, yearStart: !last || last.year !== y, rows: [r] });
    }
    return out;
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
        {/* Sammanfattning: flygningar och flygtid, ögat (uppslagen som loggbok) och second pilots ur anmärkningen. */}
        <LinearGradient colors={[Colors.primary + '24', 'rgba(15,30,58,0.55)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
          <View style={s.heroTop}>
            <View style={s.heroStat}>
              <Text style={s.heroValue}>{included.length}</Text>
              <Text style={s.heroLabel}>{included.length === 1 ? 'FLIGHT' : 'FLIGHTS'}</Text>
            </View>
            <View style={s.heroStat}>
              <Text style={s.heroValue}>
                {fmtH(sumOf(included, 'total_time'))}{timeFormat === 'decimal' ? <Text style={s.heroUnit}> h</Text> : null}
              </Text>
              <Text style={s.heroLabel}>FLIGHT TIME</Text>
            </View>
            {p.onPresentLogbook && rows.length > 0 && (
              <TouchableOpacity style={s.eyeBtn} onPress={() => p.onPresentLogbook!(firstWithRows)} activeOpacity={0.8}
                accessibilityRole="button" accessibilityLabel={pages.length > 1 ? `View the ${pages.length} spreads as a logbook` : 'View as logbook'}>
                <Ionicons name="eye-outline" size={22} color={Colors.primary} />
              </TouchableOpacity>
            )}
          </View>
          {status.length > 0 && (
            <Text style={s.heroStatus}>
              {status.map((x, i) => (
                <Text key={x.text} style={x.warn ? { color: Colors.warning } : null}>{i > 0 ? '   ·   ' : ''}{x.text}</Text>
              ))}
            </Text>
          )}
          {/* Second pilot ur anmärkningen (rubriken säger "name of PIC"): fäll ut för att se och rätta namn och roll. */}
          {crew.length > 0 && (
            <>
              <TouchableOpacity style={s.heroRow} onPress={() => setCrewOpen((o) => !o)} activeOpacity={0.75}
                accessibilityRole="button" accessibilityState={{ expanded: crewOpen }} accessibilityLabel={`${crew.filter((r) => !r.crewRemoved).length} second pilots from the remarks`}>
                <Ionicons name="people-outline" size={17} color={Colors.textSecondary} />
                <Text style={s.heroRowTitle}>Second pilots</Text>
                <Text style={s.heroRowCount}>{crew.filter((r) => !r.crewRemoved).length}</Text>
                <Ionicons name={crewOpen ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textSecondary} />
              </TouchableOpacity>
              {crewOpen && (
                <View style={{ paddingBottom: 4 }}>
                  <Text style={s.crewNote}>From the remarks. Tap a role to change it, or a name to correct it. Not a person? Tap ✕ and the text goes back to the remarks.</Text>
                  {crew.map((r, k) => (
                    <View key={r.key}>
                      {pages.length > 1 && (k === 0 || crew[k - 1].page !== r.page) && (
                        <Text style={s.crewSpread}>{p.pageLabels?.[r.page] ?? `Spread ${r.page + 1}`}</Text>
                      )}
                      {r.crewRemoved ? (
                      <View style={s.crewRow}>
                        <Text style={s.crewDate}>{/^\d{4}-\d{2}-\d{2}$/.test(r.data.date || '') ? `${Number(r.data.date.slice(8, 10))} ${MONTHS[Number(r.data.date.slice(5, 7)) - 1]}` : `Row ${r.rowIndex}`}</Text>
                        <Text style={s.crewGone} numberOfLines={1}>{r.crewRemoved.name} · in remarks</Text>
                        <TouchableOpacity onPress={() => p.onRestoreCrew?.(r.key)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Undo, make ${r.crewRemoved.name} the second pilot again`}>
                          <Text style={s.crewUndo}>Undo</Text>
                        </TouchableOpacity>
                      </View>
                      ) : (
                      <View style={s.crewRow}>
                        <Text style={s.crewDate}>{/^\d{4}-\d{2}-\d{2}$/.test(r.data.date || '') ? `${Number(r.data.date.slice(8, 10))} ${MONTHS[Number(r.data.date.slice(5, 7)) - 1]}` : `Row ${r.rowIndex}`}</Text>
                        <CrewName value={r.data.second_pilot ?? ''} onCommit={(v) => p.onEditField?.(r.key, 'second_pilot', v)} />
                        <TouchableOpacity style={s.crewRole} onPress={() => p.onEditField?.(r.key, 'second_pilot_role', nextRole(r.data.second_pilot_role))}
                          activeOpacity={0.75} accessibilityRole="button" accessibilityLabel={`Role ${roleName(r.data.second_pilot_role)}. Tap to change.`}>
                          <Text style={s.crewRoleText}>{roleName(r.data.second_pilot_role)}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => p.onRemoveCrew?.(r.key)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${r.data.second_pilot} is not a person. Move it back to the remarks.`}>
                          <Ionicons name="close" size={18} color={Colors.textSecondary} />
                        </TouchableOpacity>
                      </View>
                      )}
                    </View>
                  ))}
                </View>
              )}
            </>
          )}
        </LinearGradient>

        {/* Hela skanningen i ett avsnitt, som i loggboken: bokens sidor i rubriken ("p. 78–86"), sidans summor och
            flygningarna per år och månad med det senaste överst. */}
        {(() => {
          const allChecks = pages.flatMap((pg) => checksFor(pg).map((c) => ({ ...c, pg })));
          const off = allChecks.filter((c) => !c.ok);
          const multi = pages.length > 1;
          // En kolumn per fält (i ordningen de först förekommer); flera uppslag → summan av uppslagens rader.
          const cols = [...new Set(allChecks.map((c) => c.field))].map((field) => {
            const cs = allChecks.filter((c) => c.field === field);
            const bad = cs.filter((c) => !c.ok);
            return { field, sum: cs.reduce((t, c) => t + c.sum, 0), printed: cs.reduce((t, c) => t + c.printed, 0), bad, fix: bad.length > 0 && bad.every((c) => paperFix(c.pg, c.field)) };
          });
          const unread = multi ? pages.filter((pg) => pageRowsOf(pg).length > 0 && checksFor(pg).length === 0) : [];
          const sorted = [...rows].sort(newestFirst);
          const inAll = sorted.filter(isIn);
          const status = off.length ? 'warn' : allChecks.length ? 'ok' : 'none';
          const spreadName = (pg: number) => p.pageLabels?.[pg] ?? `spread ${pg + 1}`;
          return (
            <View style={s.spread}>
              <TouchableOpacity style={s.spreadHead} onPress={() => setListOpen((o) => !o)} activeOpacity={0.75}
                accessibilityRole="button" accessibilityState={{ expanded: listOpen }}>
                <Ionicons
                  name={status === 'warn' ? 'alert-circle' : status === 'ok' ? 'checkmark-circle' : 'remove-circle-outline'}
                  size={20} color={status === 'warn' ? Colors.warning : status === 'ok' ? Colors.success : Colors.textMuted}
                />
                <View style={{ flex: 1 }}>
                  <Text style={s.spreadTitle} numberOfLines={1}>{multi ? 'Spreads' : 'Spread'}{pageRange ? ` · ${pageRange}` : ''}</Text>
                  <Text style={s.spreadSub} numberOfLines={1}>
                    {inAll.length === 1 ? '1 flight' : `${inAll.length} flights`} · {fmtH(sumOf(inAll, 'total_time'))} h
                    {period(rows) ? ` · ${period(rows)}` : ''}
                  </Text>
                </View>
                <Ionicons name={listOpen ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.textSecondary} />
              </TouchableOpacity>

              {listOpen && (
                <>
                  {/* Sidans summor: radernas summa per kolumn, mot det som står i boken. Bara det som inte stämmer märks. */}
                  <View style={s.ledger}>
                    <View style={s.ledgerHead}>
                      <Text style={s.ledgerTitle}>PAGE TOTALS</Text>
                      {allChecks.length > 0 && off.length === 0 && (
                        <Text style={s.ledgerState}>{multi ? `All ${pages.length - unread.length} spreads match the book` : 'Match the book'}</Text>
                      )}
                    </View>
                    {cols.length ? (
                      <View style={s.ledgerGrid}>
                        {cols.map((c) => (
                          <View key={c.field} style={s.lcell}>
                            <Text style={s.lcellLabel} numberOfLines={1}>{(SHORT[c.field] ?? label(c.field)).toUpperCase()}</Text>
                            <Text style={s.lcellValue}>{fmtV(c.field, c.sum)}</Text>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <Text style={s.ledgerNoneIn}>No page totals were read{multi ? '' : ' on this spread'}.</Text>
                    )}
                    {/* Det som inte stämmer med boken: fälls ut, uppslag för uppslag. */}
                    {off.length > 0 && (
                      <TouchableOpacity style={s.fixHead} onPress={() => setFixOpen((o) => !o)} activeOpacity={0.75}
                        accessibilityRole="button" accessibilityState={{ expanded: fixOpen }}>
                        <Ionicons name="alert-circle" size={16} color={Colors.warning} />
                        <Text style={s.fixTitle}>Needs manual correction</Text>
                        <Text style={s.fixCount}>{off.length}</Text>
                        <Ionicons name={fixOpen ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textSecondary} />
                      </TouchableOpacity>
                    )}
                    {fixOpen && off.map((c) => {
                      const fix = paperFix(c.pg, c.field);
                      return (
                        <View key={`${c.pg}:${c.field}`} style={s.fixRow}>
                          <Text style={s.fixName}>{label(c.field)}{p.pageLabels?.[c.pg] ? ` · ${p.pageLabels[c.pg]}` : multi ? ` · spread ${c.pg + 1}` : ''}</Text>
                          <Text style={s.fixText}>
                            {fix
                              ? `Change the total in your paper logbook from ${fmtV(c.field, c.printed)} to ${fmtV(c.field, c.sum)}.`
                              : `The flights add up to ${fmtV(c.field, c.sum)}, but the page total in the book is ${fmtV(c.field, c.printed)}.`}
                          </Text>
                        </View>
                      );
                    })}
                    {unread.length > 0 && <Text style={s.ledgerLine}>No page totals read on {unread.map(spreadName).join(', ')}.</Text>}
                  </View>
                  {/* Flygningarna som i loggboken (Logbook-listan): år och månad, det senaste överst. */}
                  {rows.length === 0 && <Text style={s.ledgerNone}>No flights were read.</Text>}
                  {groupByMonth(sorted).map((g) => {
                    const inG = g.rows.filter(isIn);
                    const hours = sumOf(inG, 'total_time');
                    const inYear = inAll.filter((r) => yearOf(r) === g.year);
                    return (
                      <View key={g.key}>
                        {g.yearStart && (
                          <View style={s.yearHead}>
                            <Text style={s.yearTitle}>{g.year ?? 'Unknown date'}</Text>
                            {g.year != null && (
                              <Text style={s.yearMeta}>
                                <Text style={{ color: Colors.primary }}>{fmtH(sumOf(inYear, 'total_time'))}h</Text>
                                {'  '}{inYear.length} flights
                              </Text>
                            )}
                          </View>
                        )}
                        {g.month != null && (
                          <View style={s.monthHead}>
                            <Text style={s.monthTitle}>{MONTH_FULL[g.month]}</Text>
                            <Text style={s.monthMeta}><Text style={{ color: Colors.primary }}>{fmtH(hours)}h</Text>  ·  {inG.length} flt</Text>
                          </View>
                        )}
                        {g.rows.map((r, idx) => {
                          const dup = p.duplicates.has(r.key);
                          const off = r.skip || dup;
                          const openN = rowOpen(r);
                          const tags: { text: string; color: string }[] = [];
                          if (isSim(r) && r.data.sim_category) tags.push({ text: String(r.data.sim_category).replace(/_/g, ' ').toUpperCase(), color: SIM_BADGE });
                          for (const a of r.adjusted ?? []) tags.push({ text: `ADJUSTED ${(SHORT[a.field] ?? label(a.field)).toUpperCase()} ${a.from}→${a.to}`, color: Colors.warning });
                          if (openN > 0) tags.push({ text: `${openN} UNCHECKED`, color: Colors.warning });
                          if (dup) tags.push({ text: 'ALREADY IN YOUR LOGBOOK', color: Colors.textMuted });
                          else if (r.skip) tags.push({ text: 'LEFT OUT', color: Colors.textMuted });
                          const role = roleOf(r);
                          const picRole = role === 'PIC' || role === 'PICUS' || role === 'SPIC';
                          const date = r.data.date || '';
                          const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
                          return (
                            <View key={r.key} style={[s.card, idx === 0 && { borderTopWidth: 0 }, off && { opacity: 0.45 }]}>
                              <TouchableOpacity onPress={() => p.onToggleSkip(r.key)} hitSlop={8} disabled={dup} style={{ width: 20 }}
                                accessibilityRole="checkbox" accessibilityState={{ checked: !off }} accessibilityLabel={`Include row ${r.rowIndex}`}>
                                <Ionicons name={off ? 'square-outline' : 'checkbox'} size={18} color={off ? Colors.textMuted : Colors.primary} />
                              </TouchableOpacity>
                              <TouchableOpacity style={s.cardBody} onPress={() => p.onOpenFlight(r.key)} activeOpacity={0.7}
                                accessibilityLabel={`Flight on row ${r.rowIndex}. Tap to see and edit all values.`}>
                                {/* Datumchip: dag + veckodag (år och månad står i rubrikerna) */}
                                <View style={s.dateChip}>
                                  <Text style={[s.day, hl(r, 'date')]}>{validDate ? dayOfMonth(date) : '?'}</Text>
                                  <Text style={s.weekday}>{validDate ? weekdayShort(date) : ''}</Text>
                                </View>
                                <View style={{ flex: 1, minWidth: 0 }}>
                                  <View style={s.routeRow}>
                                    <Text style={s.routeText} numberOfLines={1}>
                                      <Text style={hl(r, 'dep_place')}>{r.data.dep_place || '—'}</Text>
                                      {' → '}
                                      <Text style={hl(r, 'arr_place')}>{r.data.arr_place || '—'}</Text>
                                    </Text>
                                    {num(r, 'ifr') > 0 ? <Badge color={Colors.primary} label="IFR" /> : null}
                                    {num(r, 'night') > 0 ? <Badge color={NIGHT_BADGE} ion="moon" /> : null}
                                    {num(r, 'nvg') > 0 ? <Badge color={NVG_BADGE} mci="binoculars" /> : null}
                                    {isSim(r) ? <Badge color={SIM_BADGE} mci="desktop-classic" label="SIM" /> : null}
                                  </View>
                                  <Text numberOfLines={1} style={s.subLine}>
                                    <Text style={{ color: picRole ? Colors.primary : Colors.textSecondary, fontWeight: '700' }}>{role}</Text>
                                    {' · '}<Text style={hl(r, 'aircraft_type')}>{r.data.aircraft_type || '—'}</Text>
                                    {r.data.registration ? <Text>{' '}<Text style={hl(r, 'registration')}>{r.data.registration}</Text></Text> : null}
                                  </Text>
                                  {tags.length > 0 && (
                                    <Text style={s.tags} numberOfLines={1}>
                                      {tags.map((t, i) => (
                                        <Text key={i} style={{ color: t.color }}>{i > 0 ? '  ·  ' : ''}{t.text}</Text>
                                      ))}
                                    </Text>
                                  )}
                                </View>
                                <View style={{ alignItems: 'flex-end' }}>
                                  <Text style={[s.cardTime, hl(r, isSim(r) ? 'sim' : 'total_time')]}>{fmtH(num(r, 'total_time'))}</Text>
                                  <Text style={s.cardUtc}>
                                    <Text style={hl(r, 'dep_utc')}>{r.data.dep_utc || '—'}</Text> · <Text style={hl(r, 'arr_utc')}>{r.data.arr_utc || '—'}</Text>z
                                  </Text>
                                </View>
                              </TouchableOpacity>
                              <Ionicons name="chevron-forward" size={15} color={Colors.textMuted} />
                            </View>
                          );
                        })}
                      </View>
                    );
                  })}
                </>
              )}
            </View>
          );
        })()}

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

        {/* Skrivsätt i boken som är typer man redan har: flottans namn används, så att Fleet och typvalet i Log
            Flight inte får dubbletter. Fel matchning → "Keep separate". */}
        {(p.fleetMatches?.length ?? 0) > 0 && (
          <View style={{ gap: 8, marginTop: 4 }}>
            <Text style={s.section}>MATCHED TO YOUR FLEET</Text>
            <View style={s.matchCard}>
              {p.fleetMatches!.map((m, k) => (
                <View key={m.id} style={[s.matchRow, k > 0 && s.matchRowBorder]}>
                  <Ionicons name="git-merge-outline" size={16} color={Colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.matchTitle} numberOfLines={2}>{m.from.join(', ')} → {m.to}</Text>
                    <Text style={s.matchSub}>{m.rows === 1 ? '1 flight' : `${m.rows} flights`} · {viaText(m.via)} as {m.to} in your fleet</Text>
                  </View>
                  {p.onKeepSeparate && (
                    <TouchableOpacity onPress={() => p.onKeepSeparate!(m.id)} hitSlop={8} accessibilityRole="button">
                      <Text style={s.matchLink}>Keep separate</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          </View>
        )}
        {/* Samma person skriven på flera sätt blir ett namn; fel matchning → "Keep separate". */}
        {(p.nameMatches?.length ?? 0) > 0 && (
          <View style={{ gap: 8, marginTop: 4 }}>
            <Text style={s.section}>SAME PERSON</Text>
            <View style={s.matchCard}>
              {p.nameMatches!.map((m, k) => (
                <View key={m.id} style={[s.matchRow, k > 0 && s.matchRowBorder]}>
                  <Ionicons name="person-outline" size={16} color={Colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.matchTitle} numberOfLines={2}>{m.from.join(', ')} → {m.to}</Text>
                    <Text style={s.matchSub}>{m.rows === 1 ? '1 flight' : `${m.rows} flights`} · {m.similar ? 'similar name' : 'same name'}</Text>
                  </View>
                  {m.similar && p.onKeepNamesSeparate && (
                    <TouchableOpacity onPress={() => p.onKeepNamesSeparate!(m.id)} hitSlop={8} accessibilityRole="button">
                      <Text style={s.matchLink}>Keep separate</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          </View>
        )}
        {/* Samma svar tre gånger gäller resten av boken. */}
        {(p.learned?.length ?? 0) > 0 && (
          <View style={{ gap: 8, marginTop: 4 }}>
            <Text style={s.section}>LEARNED FROM YOUR ANSWERS</Text>
            <View style={s.matchCard}>
              {p.learned!.map(({ rule, rows: n }, k) => (
                <View key={`${rule.cls}:${rule.from}`} style={[s.matchRow, k > 0 && s.matchRowBorder]}>
                  <Ionicons name="sparkles-outline" size={16} color={Colors.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.matchTitle} numberOfLines={1}>{rule.from === rule.to ? `${rule.from} is right` : `${rule.from} → ${rule.to}`}</Text>
                    <Text style={s.matchSub}>{n === 1 ? '1 value' : `${n} values`} {rule.from === rule.to ? 'not asked about' : 'changed'}</Text>
                  </View>
                  {p.onUndoRule && (
                    <TouchableOpacity onPress={() => p.onUndoRule!(rule)} hitSlop={8} accessibilityRole="button">
                      <Text style={s.matchLink}>Undo</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </View>
          </View>
        )}
        {p.newTypes.length > 0 && (
          <View style={{ gap: 8, marginTop: 4 }}>
            <Text style={s.section}>NEW AIRCRAFT</Text>
            <NewAircraftSection types={p.newTypes} values={p.aircraft} loading={p.aircraftLoading} failed={p.aircraftFailed}
              onChange={p.onAircraftChange} onName={p.onNameType} onSeparate={p.onKeepSeparate} />
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

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.cardBorder },
  back: { flexDirection: 'row', alignItems: 'center', width: 60, paddingVertical: 6 },
  backText: { color: Colors.primary, fontSize: 16, fontWeight: '600' },
  title: { color: '#fff', fontSize: 17, fontWeight: '800' },
  subtitle: { color: Colors.textSecondary, fontSize: 12, marginTop: 1 },



  hero: { borderRadius: 18, borderWidth: 1, borderColor: Colors.primary + '33', paddingHorizontal: 18, paddingTop: 16, paddingBottom: 6, overflow: 'hidden' },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 22, paddingBottom: 12 },
  heroStat: { gap: 3 },
  heroValue: { fontFamily: FONT_SERIF, fontSize: 34, fontWeight: '600', color: '#fff', fontVariant: ['tabular-nums'], lineHeight: 38 },
  heroUnit: { fontFamily: FONT_SERIF, fontSize: 18, color: Colors.textSecondary },
  heroLabel: { fontFamily: FONT_MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.4, color: Colors.textMuted },
  eyeBtn: {
    marginLeft: 'auto', width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.primary + '55', backgroundColor: Colors.primary + '14',
  },
  heroStatus: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, paddingBottom: 10 },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)' },
  heroRowTitle: { flex: 1, color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
  heroRowCount: { color: Colors.textSecondary, fontSize: 13, fontFamily: FONT_MONO, fontWeight: '700' },

  spread: { borderRadius: 14, backgroundColor: 'rgba(15,30,58,0.75)', borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden' },
  spreadHead: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 12 },
  spreadTitle: { color: '#fff', fontSize: 15, fontWeight: '800' },
  spreadSub: { color: Colors.textSecondary, fontSize: 12, marginTop: 1, fontVariant: ['tabular-nums'] },

  crewNote: { color: Colors.textMuted, fontSize: 12, lineHeight: 16, paddingBottom: 6 },
  crewRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)' },
  crewSpread: { color: Colors.textMuted, fontSize: 10.5, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginTop: 8, marginBottom: 2 },
  crewGone: { flex: 1, color: Colors.textMuted, fontSize: 13, fontFamily: FONT_MONO, paddingVertical: 6 },
  crewUndo: { color: Colors.primary, fontSize: 13, fontWeight: '700' },
  crewDate: { width: 48, color: Colors.textSecondary, fontSize: 12, fontFamily: FONT_MONO },
  crewInput: { flex: 1, color: Colors.textPrimary, fontSize: 13.5, fontFamily: FONT_MONO, fontWeight: '700', paddingVertical: 5, paddingHorizontal: 8, borderRadius: 7, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.background },
  crewRole: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 7, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', minWidth: 62, alignItems: 'center' },
  crewRoleText: { color: Colors.textPrimary, fontSize: 12, fontWeight: '700' },
  // Sidans summor som en enkel tabell: etikett ovanför värdet, inga ramar eller färger utom det som inte stämmer.
  ledger: { marginHorizontal: 14, marginBottom: 6, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.1)' },
  ledgerHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 },
  ledgerTitle: { fontFamily: FONT_MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.4, color: Colors.textMuted },
  ledgerState: { fontSize: 11.5, color: Colors.textMuted },
  ledgerGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10 },
  lcell: { width: '25%', gap: 2 },
  lcellLabel: { fontFamily: FONT_MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1, color: Colors.textMuted },
  lcellValue: { fontFamily: FONT_MONO, fontSize: 15, fontWeight: '600', color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  ledgerLine: { fontSize: 12, color: Colors.textMuted, lineHeight: 17, marginTop: 8 },
  fixHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 11, paddingBottom: 3, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.1)' },
  fixTitle: { flex: 1, color: Colors.textPrimary, fontSize: 13.5, fontWeight: '700' },
  fixCount: { color: Colors.textSecondary, fontSize: 13, fontFamily: FONT_MONO, fontWeight: '700' },
  fixRow: { paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.08)', marginTop: 6 },
  fixName: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700' },
  fixText: { color: Colors.textSecondary, fontSize: 12.5, lineHeight: 17, marginTop: 2 },
  ledgerNoneIn: { color: Colors.textMuted, fontSize: 12, lineHeight: 17, paddingBottom: 8 },
  ledgerNone: { color: Colors.textMuted, fontSize: 12, lineHeight: 17, paddingHorizontal: 12, paddingBottom: 8 },
  matchCard: { backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.cardBorder, paddingHorizontal: 12 },
  matchRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11 },
  matchRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  matchTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700', letterSpacing: 0.3 },
  matchSub: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
  matchLink: { color: Colors.primary, fontSize: 12.5, fontWeight: '700' },

  v: { color: '#fff', fontSize: 12.5, fontFamily: MONO, borderRadius: 4, overflow: 'hidden' },
  vEmpty: { color: Colors.textMuted },
  vOpen: { backgroundColor: 'rgba(255,184,48,0.28)' },
  vChanged: { color: Colors.primary, fontWeight: '700' },
  tags: { fontSize: 9.5, fontWeight: '800', letterSpacing: 0.5, marginTop: 3 },
  // Loggbokens rader (FlightCardRow) och rubriker (YearMonthAccordion)
  yearHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 10, paddingBottom: 2 },
  yearTitle: { fontFamily: FONT_SERIF, fontSize: 22, fontWeight: '600', color: Colors.textPrimary },
  yearMeta: { fontFamily: FONT_MONO, fontSize: 11, color: Colors.textSecondary },
  monthHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', paddingHorizontal: 14, paddingTop: 8, paddingBottom: 6 },
  monthTitle: { fontFamily: FONT_SERIF, fontSize: 16, fontWeight: '600', color: Colors.textPrimary },
  monthMeta: { fontFamily: FONT_MONO, fontSize: 10.5, color: Colors.textSecondary },
  card: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingLeft: 12, paddingRight: 10, borderTopWidth: 1, borderTopColor: Colors.separator },
  cardBody: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  dateChip: { width: 30, alignItems: 'center' },
  day: { fontFamily: FONT_SERIF, fontSize: 20, fontWeight: '600', color: Colors.textPrimary, lineHeight: 22, borderRadius: 4, overflow: 'hidden' },
  weekday: { fontFamily: FONT_MONO, fontSize: 8, fontWeight: '700', letterSpacing: 0.7, color: Colors.textMuted, textTransform: 'uppercase', marginTop: 2 },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  routeText: { flexShrink: 1, fontFamily: FONT_MONO, fontSize: 14, fontWeight: '700', color: Colors.textPrimary, letterSpacing: 0.3 },
  subLine: { fontFamily: FONT_MONO, fontSize: 10, color: Colors.textMuted, marginTop: 3 },
  cardTime: { fontFamily: FONT_MONO, fontSize: 14, fontWeight: '700', color: Colors.textPrimary, borderRadius: 4, overflow: 'hidden' },
  cardUtc: { fontFamily: FONT_MONO, fontSize: 9, color: Colors.textMuted, marginTop: 2 },


  basisRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, backgroundColor: 'rgba(15,30,58,0.75)', borderWidth: 1, borderColor: Colors.cardBorder },
  basisLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
  basisHint: { color: Colors.textMuted, fontSize: 12, marginTop: 2 },
  segment: { flexDirection: 'row', height: 36, borderRadius: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', padding: 3, gap: 3 },
  segBtn: { paddingHorizontal: 14, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  segBtnOn: { backgroundColor: Colors.primary + '26' },
  segText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '600' },
  segTextOn: { color: Colors.primary, fontWeight: '800' },
  section: { color: Colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },

  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, paddingTop: 10, backgroundColor: Colors.background, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.cardBorder },
  save: { height: 52, borderRadius: 14, backgroundColor: Colors.primary, justifyContent: 'center', alignItems: 'center' },
  saveText: { color: Colors.textInverse, fontSize: 17, fontWeight: '700' },
});
