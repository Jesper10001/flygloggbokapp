// Nya Scan report (utan handpåläggning): efter skanningen kommer man direkt hit. Överst totalerna (LED, som
// Hours bank) med ögat som öppnar uppslagen i helskärm, sedan två rullistor (Second pilots, Models &
// registrations) och flygningarna som flight cards, äldst överst, med datum och var i boken de står. Kortets
// kant visar hur säker Claude är: grön = säker, gul = ett värde att kolla, röd = troligen fel. Det osäkra står i
// kortet bara som färg (kant + celler); ögat (gult/rött) öppnar uppslagen i helskärm på flygningens första osäkra
// cell, pennan öppnar flygningen direkt i redigeringsläget (FlightEditor) med det osäkra i rött. Design: artifact
// EEZZQZTdmsVaBrtpZAPqzB. Den gamla granskningen (frågepanelen) och rapporten (ScanReport) finns kvar i koden.

import { Fragment, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, TextInput, useWindowDimensions } from 'react-native';
import { GlassFill } from '../GlassFill';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../../constants/colors';
import type { TimeFormat } from '../../store/timeFormatStore';
import type { ScanRow } from '../../services/scanImport';
import { label as fieldLabel } from '../../services/scanFields';
import { formatTimeValue } from '../../hooks/useTimeFormat';
import { FONT_SERIF, FONT_MONO } from '../logbook-page/tokens';
import { FONT_LED7 } from '../logflight/tokens';
import { getAirportByIcao } from '../../db/icao';
import type { ClashChoice } from '../import/ImportReport';

export interface SimpleIssue {
  id: string;
  rowKey: string;            // kortet frågan står på
  rowKeys?: string[];        // alla flygningar frågan gäller (samma fråga på flera kort)
  fields: string[];          // cellerna frågan gäller (markeras på kortet)
  text: string;              // vad Claude är osäker på
  severity: 'check' | 'wrong';
  chips: string[];           // snabbsvaren (Claudes förslag), i ordning
  also: number;              // fler flygningar med samma fråga (svaret gäller alla)
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const ROLE_NAME: Record<string, string> = { PIC: 'PIC', COP: 'SIC', FI: 'Instructor', SPIC: 'SPIC', PICUS: 'PICUS' };
const ROLE_ORDER = ['PIC', 'COP', 'FI', 'SPIC', 'PICUS'];
const num = (v: unknown) => parseFloat(String(v ?? '').replace(',', '.')) || 0;
type Tone = { border: string; tint: string; fg?: string; box?: string };
const STATUS: Record<'ok' | 'check' | 'wrong', Tone> = {
  ok: { border: 'rgba(0,232,160,0.32)', tint: '' },
  check: { border: 'rgba(255,184,48,0.55)', tint: 'rgba(255,184,48,0.16)', fg: Colors.warning, box: 'rgba(255,184,48,0.10)' },
  wrong: { border: 'rgba(255,77,106,0.6)', tint: 'rgba(255,77,106,0.16)', fg: Colors.danger, box: 'rgba(255,77,106,0.10)' },
};
// Kortets celler och vilka fält som markerar dem.
const CARD_CELLS: { label: string; fields: string[] }[] = [
  { label: 'ROLE', fields: ['pic', 'co_pilot', 'dual', 'instructor', 'picus', 'spic'] },
  { label: 'AIRCRAFT', fields: ['registration', 'aircraft_type'] },
  { label: 'RULES', fields: ['ifr'] },
  { label: 'DEP', fields: ['dep_utc', 'dep_place'] },
  { label: 'ARR', fields: ['arr_utc', 'arr_place'] },
];

const fmtDate = (iso?: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1].slice(2)}` : (iso || 'No date');
};
const roleOf = (d: ScanRow['data']) => (d.flight_type === 'sim' ? 'SIM'
  : num(d.pic) > 0 ? 'PIC' : num(d.co_pilot) > 0 ? 'Co-pilot' : num(d.dual) > 0 ? 'Dual' : num(d.instructor) > 0 ? 'Instr.' : '—');
const rulesOf = (d: ScanRow['data']) => {
  const t = num(d.total_time), ifr = num(d.ifr);
  return ifr <= 0 ? 'VFR' : ifr >= t - 0.001 ? 'IFR' : 'Mixed';
};

function Led({ children, size, color = '#FFFFFF' }: { children: string; size: number; color?: string }) {
  return <Text style={{ fontFamily: FONT_LED7, fontWeight: '800', fontSize: size, color, letterSpacing: 1 }} numberOfLines={1}>{children}</Text>;
}

export function ScanReportSimple(p: {
  rows: ScanRow[];
  pageNumbers: { left: number | null; right: number | null }[];
  timeFormat: TimeFormat;
  insets: { top: number; bottom: number };
  issues: SimpleIssue[];
  duplicates: Set<string>;
  clashes: Record<string, number>;
  clashChoice: (rowKey: string) => ClashChoice;
  onClash: (rowKey: string, c: ClashChoice) => void;
  newRegs: Set<string>;
  newTypes: Set<string>;                 // modeller (versaler) som inte finns i flottan
  onRenameType: (from: string, to: string) => void;   // byt modellens namn på alla dess flygningar
  saving: boolean;
  onInspect: (rowKey: string) => void;   // ögat: helskärm på flygningens första osäkra cell
  onEdit: (rowKey: string) => void;
  onToggleSkip: (rowKey: string) => void;
  onPresentLogbook: () => void;
  onCrewRole: (rowKeys: string[], role: string) => void;
  onCrewName: (rowKeys: string[], name: string) => void;
  onRemoveCrew: (rowKey: string) => void;
  onRestoreCrew: (rowKey: string) => void;
  onBack: () => void;
  onSave: () => void;
  // Handstilsprofilen: förväxlade siffror som lärts av rättningarna, vad de ändrat, och Undo.
  handwriting?: { pair: string; fixed: number; suggested: number }[];
  onUndoHandwriting?: (pair: string) => void;
}) {
  const fmt = (h: number) => formatTimeValue(h, p.timeFormat);
  const [crewOpen, setCrewOpen] = useState(false);
  const [modelsOpen, setModelsOpen] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});

  // Äldst överst: datum, sedan var i boken.
  const ordered = useMemo(() => p.rows.slice().sort((a, b) => (a.data.date || '').localeCompare(b.data.date || '') || a.page - b.page || a.rowIndex - b.rowIndex), [p.rows]);
  const saved = ordered.filter((r) => !r.skip && !p.duplicates.has(r.key));

  // Flygplatsernas namn under rutten.
  useEffect(() => {
    const codes = [...new Set(p.rows.flatMap((r) => [r.data.dep_place, r.data.arr_place]).map((c) => String(c ?? '').toUpperCase()).filter((c) => c && !names[c]))];
    if (!codes.length) return;
    let alive = true;
    Promise.all(codes.map(async (c) => [c, (await getAirportByIcao(c).catch(() => null))?.name ?? ''] as const)).then((list) => {
      if (alive) setNames((n) => ({ ...n, ...Object.fromEntries(list) }));
    });
    return () => { alive = false; };
  }, [p.rows]); // eslint-disable-line react-hooks/exhaustive-deps

  // Totalerna för det som sparas.
  const sum = (f: string) => saved.reduce((t, r) => t + num((r.data as any)[f]), 0);
  const totals: { label: string; value: string }[] = [
    { label: 'PIC', value: fmt(sum('pic')) }, { label: 'CO-PILOT', value: fmt(sum('co_pilot')) },
    { label: 'MULTI', value: fmt(sum('multi_pilot')) }, { label: 'IFR', value: fmt(sum('ifr')) },
    { label: 'NIGHT', value: fmt(sum('night')) }, { label: 'DUAL', value: fmt(sum('dual')) },
    { label: 'LDG DAY', value: String(Math.round(sum('landings_day'))) }, { label: 'LDG NIGHT', value: String(Math.round(sum('landings_night'))) },
  ];

  // Second pilots: ett namn, alla dess flygningar och den vanligaste rollen.
  const crew = useMemo(() => {
    const by = new Map<string, { name: string; keys: string[]; roles: string[] }>();
    for (const r of p.rows) {
      const n = String(r.data.second_pilot ?? '').trim();
      if (r.skip || !n) continue;
      const k = n.toUpperCase();
      const e = by.get(k) ?? { name: n, keys: [], roles: [] };
      e.keys.push(r.key); e.roles.push(String(r.data.second_pilot_role || 'PIC'));
      by.set(k, e);
    }
    return [...by.values()].map((e) => {
      const top = ROLE_ORDER.map((ro) => [ro, e.roles.filter((x) => x === ro).length] as const).sort((a, b) => b[1] - a[1])[0];
      return { ...e, role: top && top[1] > 0 ? top[0] : 'PIC', mixed: new Set(e.roles).size > 1 };
    }).sort((a, b) => b.keys.length - a.keys.length || a.name.localeCompare(b.name));
  }, [p.rows]);
  const movedCrew = p.rows.filter((r) => r.crewRemoved);

  // Models & registrations: typer med sina registreringar.
  const models = useMemo(() => {
    const by = new Map<string, Map<string, number>>();
    for (const r of p.rows) {
      if (r.skip || r.data.flight_type === 'sim') continue;
      const t = String(r.data.aircraft_type || '—').toUpperCase(), reg = String(r.data.registration || '').toUpperCase();
      const m = by.get(t) ?? new Map<string, number>();
      if (reg) m.set(reg, (m.get(reg) ?? 0) + 1);
      by.set(t, m);
    }
    return [...by.entries()].map(([type, regs]) => ({ type, regs: [...regs.entries()].sort((a, b) => b[1] - a[1]) }));
  }, [p.rows]);
  const regCount = models.reduce((t, m) => t + m.regs.length, 0);

  const issuesOf = (rowKey: string) => p.issues.filter((i) => i.rowKey === rowKey || !!i.rowKeys?.includes(rowKey));
  const pageOf = (r: ScanRow) => {
    const pg = p.pageNumbers[r.page];
    return pg?.left ? `p. ${pg.left}` : `spread ${r.page + 1}`;
  };
  const open = p.issues.length;
  const byMonth = p.pageNumbers.length > 1;
  // Från tre uppslag: två kort i bredd (mindre), så att en stor skanning går att överblicka.
  const { width: winW } = useWindowDimensions();
  const compact = new Set(p.rows.map((r) => r.page)).size >= 3;
  const cardW = Math.floor((winW - 32 - GRID_GAP) / 2);
  const S = compact ? CS : s;
  const groups = useMemo(() => {
    const out: { mk: string | null; rows: ScanRow[] }[] = [];
    for (const r of ordered) {
      const mk = byMonth ? monthKey(r.data.date) : null;
      const last = out[out.length - 1];
      if (last && last.mk === mk) last.rows.push(r); else out.push({ mk, rows: [r] });
    }
    return out;
  }, [ordered, byMonth]);

  return (
    <View style={s.root}>
      <ScrollView contentContainerStyle={{ paddingTop: p.insets.top + 8, paddingBottom: p.insets.bottom + 96, paddingHorizontal: 16, gap: 14 }}>
        {/* Rubrik */}
        <View style={s.header}>
          <TouchableOpacity onPress={p.onBack} style={s.back} accessibilityRole="button" accessibilityLabel="Close the scan">
            <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Scan report</Text>
            <Text style={s.sub} numberOfLines={1}>
              {[`${p.pageNumbers.length} ${p.pageNumbers.length === 1 ? 'spread' : 'spreads'}`, pagesText(p.pageNumbers), `${p.rows.length} ${p.rows.length === 1 ? 'flight' : 'flights'}`].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </View>

        {/* Totaler: bara siffrorna. Ögat = uppslagen i helskärm. */}
        <View style={s.totals}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={s.monoLabel}>TOTALS</Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <Led size={28} color={Colors.primary}>{fmt(sum('total_time'))}</Led>
                <Text style={s.muted}>{saved.length} {saved.length === 1 ? 'flight' : 'flights'}</Text>
              </View>
            </View>
            <TouchableOpacity onPress={p.onPresentLogbook} style={s.eye} accessibilityRole="button" accessibilityLabel="View the spreads in full screen">
              <Ionicons name="eye-outline" size={20} color={Colors.primary} />
            </TouchableOpacity>
          </View>
          <View style={s.totGrid}>
            {totals.map((t) => (
              <View key={t.label} style={s.totCell}>
                <Text style={s.monoSmall}>{t.label}</Text>
                <Led size={14}>{t.value}</Led>
              </View>
            ))}
          </View>
        </View>

        {/* Handstilen: siffror som förväxlas, lärda av rättningarna. Rättat bara där summor eller blocktid bekräftar. */}
        {(p.handwriting?.length ?? 0) > 0 && (
          <View style={s.drop}>
            {p.handwriting!.map((h, k) => {
              const [read, actual] = h.pair.split('>');
              const what = [h.fixed ? `${h.fixed} fixed where your totals or times confirm` : '', h.suggested ? `${h.suggested} marked to check` : ''].filter(Boolean).join(' · ');
              return (
                <View key={h.pair} style={[s.dropHead, k > 0 && { borderTopWidth: 1, borderTopColor: Colors.cardBorder }]}>
                  <Ionicons name="sparkles-outline" size={19} color={Colors.primary} />
                  <View style={{ flex: 1, paddingVertical: 10 }}>
                    <Text style={s.dropTitle}>Your {actual}s can look like {read}s</Text>
                    {what ? <Text style={s.small}>{what}</Text> : null}
                  </View>
                  {p.onUndoHandwriting && (
                    <TouchableOpacity onPress={() => p.onUndoHandwriting!(h.pair)} hitSlop={8} accessibilityRole="button">
                      <Text style={s.link}>Undo</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {/* Second pilots */}
        {(crew.length > 0 || movedCrew.length > 0) && (
          <View style={s.drop}>
            <TouchableOpacity onPress={() => setCrewOpen((o) => !o)} style={s.dropHead} accessibilityRole="button" accessibilityState={{ expanded: crewOpen }}>
              <Ionicons name="people-outline" size={19} color={Colors.primary} />
              <Text style={s.dropTitle}>Second pilots</Text>
              <Text style={s.muted}>{crew.length} {crew.length === 1 ? 'person' : 'people'}</Text>
              <Ionicons name={crewOpen ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textSecondary} />
            </TouchableOpacity>
            {crewOpen && (
              <View style={s.dropBody}>
                <Text style={s.note}>Only names, initials and callsigns are kept. Tap a role to change it, or a name to correct it.</Text>
                {crew.map((c) => (
                  <View key={c.name} style={s.crewRow}>
                    <View style={s.initials}><Text style={s.initialsText}>{initialsOf(c.name)}</Text></View>
                    <View style={{ flex: 1 }}>
                      <TextInput defaultValue={c.name} style={s.crewName} onEndEditing={(e) => { const v = e.nativeEvent.text.trim(); if (v && v !== c.name) p.onCrewName(c.keys, v); }}
                        autoCorrect={false} returnKeyType="done" accessibilityLabel={`Name ${c.name}`} />
                      <Text style={s.small}>{c.keys.length} {c.keys.length === 1 ? 'flight' : 'flights'}</Text>
                    </View>
                    <TouchableOpacity style={s.rolePill} onPress={() => p.onCrewRole(c.keys, ROLE_ORDER[(ROLE_ORDER.indexOf(c.role) + 1) % ROLE_ORDER.length])}
                      accessibilityRole="button" accessibilityLabel={`Role ${ROLE_NAME[c.role] ?? c.role}. Tap to change.`}>
                      <Text style={s.rolePillText}>{c.mixed ? 'Mixed' : ROLE_NAME[c.role] ?? c.role}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => c.keys.forEach(p.onRemoveCrew)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`${c.name} is not a person. Move it to the remarks.`}>
                      <Ionicons name="close" size={18} color={Colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                ))}
                {movedCrew.map((r) => (
                  <View key={r.key} style={s.crewRow}>
                    <Text style={[s.small, { flex: 1 }]} numberOfLines={1}>{r.crewRemoved!.name} · {r.crewRemoved!.auto ? 'not a name, in remarks' : 'in remarks'}</Text>
                    <TouchableOpacity onPress={() => p.onRestoreCrew(r.key)} hitSlop={8} accessibilityRole="button"><Text style={s.link}>Undo</Text></TouchableOpacity>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Models & registrations */}
        {models.length > 0 && (
          <View style={s.drop}>
            <TouchableOpacity onPress={() => setModelsOpen((o) => !o)} style={s.dropHead} accessibilityRole="button" accessibilityState={{ expanded: modelsOpen }}>
              <MaterialCommunityIcons name="airplane" size={19} color={Colors.primary} />
              <Text style={s.dropTitle}>Models & registrations</Text>
              <Text style={s.muted}>{models.length} {models.length === 1 ? 'model' : 'models'} · {regCount} reg.</Text>
              <Ionicons name={modelsOpen ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textSecondary} />
            </TouchableOpacity>
            {modelsOpen && (
              <View style={s.dropBody}>
                {models.map((m) => (
                  <View key={m.type} style={{ gap: 6 }}>
                    <View style={s.modelHead}>
                      <TextInput key={m.type} defaultValue={m.type} style={[s.modelName, s.modelInput]} autoCapitalize="characters" autoCorrect={false} returnKeyType="done"
                        onEndEditing={(e) => { const v = e.nativeEvent.text.trim().toUpperCase(); if (v && v !== m.type) p.onRenameType(m.type, v); }}
                        accessibilityLabel={`Model ${m.type}. Tap to rename it on all its flights.`} />
                      <Ionicons name="pencil" size={13} color={Colors.textSecondary} />
                      <View style={{ flex: 1 }} />
                      <Text style={[s.tag, { color: p.newTypes.has(m.type) ? Colors.warning : Colors.success }]}>{p.newTypes.has(m.type) ? 'NEW MODEL' : 'IN FLEET'}</Text>
                    </View>
                    {m.regs.map(([reg, n]) => {
                      const isNew = p.newRegs.has(reg);
                      return (
                        <View key={reg} style={[s.regRow, isNew && { borderColor: 'rgba(255,184,48,0.5)' }]}>
                          <Text style={s.reg}>{reg}</Text>
                          <Text style={[s.small, { flex: 1 }]}>{n} {n === 1 ? 'flight' : 'flights'}</Text>
                          <Text style={[s.tag, { color: isNew ? Colors.warning : Colors.success }]}>{isNew ? 'NEW' : 'IN FLEET'}</Text>
                        </View>
                      );
                    })}
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Flight cards, äldst överst. Från tre uppslag: två kort i bredd, samma kort i mindre storlek. */}
        {groups.map((g) => (
          <Fragment key={g.mk ?? 'all'}>
            {g.mk != null && (() => {
              const inMonth = g.rows.filter((x) => !x.skip && !p.duplicates.has(x.key));
              const hrs = inMonth.reduce((t, x) => t + num(x.data.total_time), 0);
              const toCheck = g.rows.filter((x) => issuesOf(x.key).length > 0 && !x.skip).length;
              return (
                <View style={s.monthHead} accessibilityRole="header">
                  <Text style={s.monthTitle}>{monthTitle(g.mk)}</Text>
                  <Text style={s.monthMeta}>{inMonth.length} {inMonth.length === 1 ? 'flight' : 'flights'} · {fmt(hrs)} h{toCheck ? ` · ${toCheck} to check` : ''}</Text>
                </View>
              );
            })()}
            <View style={compact ? s.grid : s.list}>
        {g.rows.map((r) => {
          const d = r.data;
          const its = issuesOf(r.key);
          const sev = its.some((i) => i.severity === 'wrong') ? 'wrong' : its.length ? 'check' : 'ok';
          const st = STATUS[sev];
          const hot = new Set(its.flatMap((i) => i.fields));
          const dup = p.duplicates.has(r.key);
          const clash = (p.clashes[r.key] ?? 0) > 0;
          const out = r.skip || dup;
          const dep = String(d.dep_place ?? '').toUpperCase(), arr = String(d.arr_place ?? '').toUpperCase();
          const hotColor = (fields: string[]) => (fields.some((f) => hot.has(f)) ? st : null);
          const timeHot = hot.has('total_time') || hot.has('night') || hot.has('sim');
          // Som dashboardens Latest flight: tonad gradient, ljus kant överst och skugga under (levande, lite 3D).
          return (
            <View key={r.key} style={[S.cardShadow, { opacity: out ? 0.5 : 1 }, compact && { width: cardW }]}>
            <View style={[S.card, { borderColor: out ? Colors.cardBorder : st.border }]}>
              <LinearGradient colors={[(out ? Colors.textMuted : sev === 'ok' ? Colors.primary : st.fg!) + '14', Colors.surface]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
              <LinearGradient colors={['rgba(255,255,255,0.05)', 'rgba(255,255,255,0)']} style={S.sheen} pointerEvents="none" />
              <View style={S.cardTop}>
                {/* Bocka i/ur: ibockad = sparas. Urbockat kort dimmas. */}
                <TouchableOpacity onPress={() => p.onToggleSkip(r.key)} hitSlop={10} style={[S.check, !out && S.checkOn]}
                  accessibilityRole="checkbox" accessibilityState={{ checked: !out }} accessibilityLabel={out ? 'Not imported. Tap to import this flight.' : 'Imported. Tap to leave this flight out.'}>
                  {!out && <Ionicons name="checkmark" size={compact ? 11 : 15} color="#0A1628" />}
                </TouchableOpacity>
                <Text style={S.cardDate}>{fmtDate(d.date)}</Text>
                {!compact && <Text style={S.cardWhere}>{pageOf(r)} · row {r.rowIndex}</Text>}
                <View style={{ flex: 1 }} />
                {!out && its.length > 0 && (
                  <TouchableOpacity onPress={() => p.onInspect(r.key)} style={[S.pencil, { borderColor: st.border, backgroundColor: st.box }]}
                    accessibilityRole="button" accessibilityLabel={sev === 'wrong' ? 'Probably misread. Check it in your spread.' : 'Something to check. See it in your spread.'}>
                    <Ionicons name="eye-outline" size={compact ? 12 : 16} color={st.fg} />
                  </TouchableOpacity>
                )}
                <TouchableOpacity onPress={() => p.onEdit(r.key)} style={S.pencil} accessibilityRole="button" accessibilityLabel="Edit flight">
                  <Ionicons name="pencil" size={compact ? 11 : 15} color={Colors.primary} />
                </TouchableOpacity>
              </View>
              <View style={S.cardMid}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={S.route} numberOfLines={1}>{dep || '—'} <Text style={S.arrow}>→</Text> {arr || '—'}</Text>
                  <Text style={S.small} numberOfLines={1}>{compact ? `${pageOf(r)} · row ${r.rowIndex}` : [names[dep] || dep, names[arr] || arr].filter(Boolean).join(' → ')}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={[S.time, timeHot && !!st.fg && { color: st.fg }]}>{d.flight_type === 'sim' ? fmt(num(d.sim) || num(d.total_time)) : fmt(num(d.total_time))}</Text>
                  <Text style={S.monoSmall}>{d.flight_type === 'sim' ? 'SIMULATOR' : 'FLIGHT TIME'}</Text>
                </View>
              </View>
              <View style={[S.cells, { borderTopColor: sev === 'ok' ? Colors.cardBorder : st.border.replace(/[\d.]+\)$/, '0.3)') }]}>
                {CARD_CELLS.map((c, i) => {
                  const h = hotColor(c.fields);
                  const v = c.label === 'ROLE' ? roleOf(d) : c.label === 'AIRCRAFT' ? (d.registration || d.aircraft_type || '—')
                    : c.label === 'RULES' ? rulesOf(d) : c.label === 'DEP' ? (d.dep_utc ? `${d.dep_utc}z` : '—') : (d.arr_utc ? `${d.arr_utc}z` : '—');
                  return (
                    <View key={c.label} style={[S.cell, i > 0 && { borderLeftWidth: 1, borderLeftColor: Colors.cardBorder }, h && { backgroundColor: h.tint }]}>
                      <Text style={S.monoSmall} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{c.label}</Text>
                      <Text style={[S.cellValue, !!h?.fg && { color: h.fg }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{String(v)}</Text>
                    </View>
                  );
                })}
              </View>

              {dup && (
                <View style={S.outBox}>
                  <Text style={[S.small, { flex: 1 }]}>{compact ? 'Already in your logbook' : 'Already in your logbook · tick it to save it again'}</Text>
                </View>
              )}
              {!dup && clash && (
                <View style={[S.issue, { backgroundColor: STATUS.check.box }]}>
                  <Text style={S.issueText}>Overlaps a flight already in your logbook. Which do you keep?</Text>
                  <View style={S.chips}>
                    {(['both', 'new', 'logbook'] as ClashChoice[]).map((c) => (
                      <TouchableOpacity key={c} onPress={() => p.onClash(r.key, c)} style={[S.chip, p.clashChoice(r.key) === c && S.chipOn]}>
                        <Text style={S.chipText}>{c === 'both' ? 'Keep both' : c === 'new' ? 'Keep scanned' : 'Keep logbook'}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

            </View>
            </View>
          );
        })}
            </View>
          </Fragment>
        ))}

        {/* Spara: knappen flyter längst ner (glas, som Log flight på dashboarden). */}
        <Text style={s.saveNote}>
          {open > 0 ? 'Nothing is saved until you tap Save. Values you haven’t checked are saved as Claude read them.' : 'Nothing is saved until you tap Save.'}
        </Text>
      </ScrollView>
      <View pointerEvents="box-none" style={[s.saveDock, { bottom: p.insets.bottom + 10 }]}>
        <TouchableOpacity style={[s.save, (p.saving || saved.length === 0) && { opacity: 0.6 }]} onPress={p.onSave} disabled={p.saving || saved.length === 0}
          activeOpacity={0.9} accessibilityRole="button">
          <GlassFill radius={27} />
          {p.saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={s.saveText}>Save {saved.length} {saved.length === 1 ? 'flight' : 'flights'}</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthKey = (iso?: string) => (/^\d{4}-\d{2}/.test(iso ?? '') ? iso!.slice(0, 7) : 'none');
const monthTitle = (k: string) => (k === 'none' ? 'No date' : `${MONTH_NAMES[Number(k.slice(5, 7)) - 1] ?? k.slice(5, 7)} ${k.slice(0, 4)}`);

function pagesText(pages: { left: number | null; right: number | null }[]): string {
  const nums = pages.flatMap((pg) => [pg.left, pg.right]).filter((n): n is number => typeof n === 'number' && n > 0);
  if (!nums.length) return '';
  const lo = Math.min(...nums), hi = Math.max(...nums);
  return lo === hi ? `p. ${lo}` : `p. ${lo}–${hi}`;
}
const initialsOf = (name: string) => {
  const parts = name.replace(/[.]/g, ' ').split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const GRID_GAP = 8;

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { width: 42, height: 42, borderRadius: 21, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: Colors.cardBorder, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#FFFFFF', fontSize: 24, fontWeight: '700', letterSpacing: -0.3 },
  sub: { color: Colors.textSecondary, fontSize: 13, marginTop: 1 },
  muted: { color: Colors.textSecondary, fontSize: 13 },
  small: { color: Colors.textSecondary, fontSize: 12.5 },
  note: { color: Colors.textSecondary, fontSize: 12, lineHeight: 17 },
  link: { color: Colors.primary, fontSize: 13.5, fontWeight: '700' },
  monoLabel: { fontFamily: FONT_MONO, fontSize: 10, fontWeight: '700', letterSpacing: 2, color: Colors.textSecondary },
  monoSmall: { fontFamily: FONT_MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1, color: Colors.textSecondary },
  totals: { borderRadius: 18, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder, padding: 14, paddingHorizontal: 16, gap: 12 },
  eye: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: Colors.cardBorder, backgroundColor: 'rgba(255,255,255,0.04)', alignItems: 'center', justifyContent: 'center' },
  totGrid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10, borderTopWidth: 1, borderTopColor: Colors.cardBorder, paddingTop: 12 },
  totCell: { width: '25%', gap: 4 },
  drop: { borderRadius: 16, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden' },
  dropHead: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16 },
  dropTitle: { flex: 1, color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  dropBody: { borderTopWidth: 1, borderTopColor: Colors.cardBorder, padding: 14, gap: 10 },
  crewRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  initials: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,200,232,0.12)', alignItems: 'center', justifyContent: 'center' },
  initialsText: { color: Colors.primary, fontSize: 12, fontWeight: '800' },
  crewName: { color: '#FFFFFF', fontSize: 15, fontWeight: '600', padding: 0 },
  rolePill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder },
  rolePillText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  modelHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  modelInput: { padding: 0, minWidth: 60 },
  modelName: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  regRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder },
  reg: { fontFamily: FONT_MONO, color: '#FFFFFF', fontSize: 13, fontWeight: '700', minWidth: 74 },
  tag: { fontFamily: FONT_MONO, fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  monthHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, paddingTop: 10, paddingHorizontal: 4 },
  monthTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '700', letterSpacing: -0.2 },
  monthMeta: { fontFamily: FONT_MONO, fontSize: 11, color: Colors.textSecondary, letterSpacing: 0.4 },
  check: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: Colors.textSecondary, alignItems: 'center', justifyContent: 'center', marginRight: 2 },
  checkOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  cardShadow: { borderRadius: 18, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  card: { borderRadius: 18, backgroundColor: Colors.surface, borderWidth: 1, overflow: 'hidden' },
  sheen: { position: 'absolute', left: 0, right: 0, top: 0, height: 28 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10, paddingLeft: 14, paddingRight: 10 },
  cardDate: { fontFamily: FONT_MONO, fontSize: 11.5, fontWeight: '600', letterSpacing: 0.6, color: '#FFFFFF' },
  cardWhere: { fontFamily: FONT_MONO, fontSize: 11.5, color: Colors.textSecondary },
  pencil: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: Colors.cardBorder, backgroundColor: 'rgba(255,255,255,0.04)', alignItems: 'center', justifyContent: 'center' },
  cardMid: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 14, paddingTop: 2, paddingBottom: 10 },
  route: { fontFamily: FONT_SERIF, fontSize: 24, fontWeight: '600', color: '#FFFFFF' },
  arrow: { color: Colors.primary, fontSize: 18 },
  time: { fontFamily: FONT_MONO, fontSize: 19, fontWeight: '600', color: '#FFFFFF' },
  cells: { flexDirection: 'row', borderTopWidth: 1 },
  cell: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 8, paddingHorizontal: 2 },
  cellValue: { fontFamily: FONT_MONO, fontSize: 12.5, fontWeight: '600', color: '#FFFFFF' },
  issue: { marginHorizontal: 10, marginBottom: 10, padding: 12, borderRadius: 14, gap: 10 },
  issueField: { fontFamily: FONT_MONO, fontSize: 9.5, fontWeight: '800', letterSpacing: 1 },
  issueText: { color: '#FFFFFF', fontSize: 13.5, lineHeight: 19 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  chip: { minHeight: 36, paddingHorizontal: 13, borderRadius: 18, borderWidth: 1, borderColor: Colors.cardBorder, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center' },
  chipOn: { borderColor: Colors.primary, backgroundColor: 'rgba(0,200,232,0.14)' },
  chipText: { color: '#FFFFFF', fontSize: 13.5, fontWeight: '600' },
  chipLink: { minHeight: 36, paddingHorizontal: 6, justifyContent: 'center' },
  outBox: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 10, marginBottom: 10, padding: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.04)' },
  list: { gap: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: GRID_GAP },
  // Flytande glasknapp som Log flight på dashboarden (GlassFill, ingen egen bakgrund).
  saveDock: { position: 'absolute', left: 16, right: 16 },
  save: {
    minHeight: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 },
  },
  saveText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  saveNote: { textAlign: 'center', color: Colors.textSecondary, fontSize: 12.5, paddingTop: 6 },
});

// Samma kort i mindre storlek (två i bredd): bara mått och textstorlekar ändras.
const CS = {
  ...s,
  ...StyleSheet.create({
    cardShadow: { borderRadius: 14, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
    card: { borderRadius: 14, backgroundColor: Colors.surface, borderWidth: 1, overflow: 'hidden' },
    sheen: { position: 'absolute', left: 0, right: 0, top: 0, height: 18 },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingTop: 7, paddingLeft: 8, paddingRight: 6 },
    check: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: Colors.textSecondary, alignItems: 'center', justifyContent: 'center' },
    cardDate: { fontFamily: FONT_MONO, fontSize: 9, fontWeight: '600', letterSpacing: 0.3, color: '#FFFFFF' },
    cardWhere: { fontFamily: FONT_MONO, fontSize: 9, color: Colors.textSecondary },
    pencil: { width: 26, height: 26, borderRadius: 13, borderWidth: 1, borderColor: Colors.cardBorder, backgroundColor: 'rgba(255,255,255,0.04)', alignItems: 'center', justifyContent: 'center' },
    cardMid: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingHorizontal: 9, paddingTop: 2, paddingBottom: 7 },
    route: { fontFamily: FONT_SERIF, fontSize: 15, fontWeight: '600', color: '#FFFFFF' },
    arrow: { color: Colors.primary, fontSize: 11.5 },
    time: { fontFamily: FONT_MONO, fontSize: 12.5, fontWeight: '600', color: '#FFFFFF' },
    small: { color: Colors.textSecondary, fontSize: 9.5 },
    monoSmall: { fontFamily: FONT_MONO, fontSize: 6.5, fontWeight: '700', letterSpacing: 0.4, color: Colors.textSecondary },
    cell: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 5, paddingHorizontal: 1 },
    cellValue: { fontFamily: FONT_MONO, fontSize: 8.5, fontWeight: '600', color: '#FFFFFF' },
    outBox: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 6, marginBottom: 6, padding: 7, borderRadius: 9, backgroundColor: 'rgba(255,255,255,0.04)' },
    issue: { marginHorizontal: 6, marginBottom: 6, padding: 8, borderRadius: 10, gap: 6 },
    issueText: { color: '#FFFFFF', fontSize: 10.5, lineHeight: 14 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, alignItems: 'center' },
    chip: { minHeight: 28, paddingHorizontal: 8, borderRadius: 14, borderWidth: 1, borderColor: Colors.cardBorder, backgroundColor: 'rgba(255,255,255,0.05)', justifyContent: 'center' },
    chipText: { color: '#FFFFFF', fontSize: 10.5, fontWeight: '600' },
  }),
};
