// Guiden för felräknade sidsummor i pappersboken. Läser den sparade listan över skanningar och rättelser
// (services/paperLedger.ts) och har två lägen:
//  - Vänta: boken är inte skannad hela vägen (början saknas, uppslag fattas, eller det är oklart om sista
//    uppslaget är det man skriver på nu). Visar vad som hittats och vad som saknas — ändra ingenting än, för en
//    ändring mitt i boken ändrar varje summa efter den.
//  - Rätta: hela boken skannad fram till sidan man skriver på. Alla handändringar uppslag för uppslag
//    (services/scanPaperFixes.ts), att bocka av. "All fixed" tömmer listan.
// Öppnas efter Save i skanningen och från skanningens startsida.

import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView, StyleSheet, Share, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Colors } from '../../constants/colors';
import { formatTimeValue } from '../../hooks/useTimeFormat';
import type { TimeFormat } from '../../store/timeFormatStore';
import { label, COUNT } from '../../services/scanFields';
import { ledgerStatus, ledgerSteps, pagesLabel, emptyLedger, type PaperLedger, type PaperFixStep, type PaperFixLine } from '../../services/scanPaperFixes';
import { loadLedger, saveLedger } from '../../services/paperLedger';

export function PaperFixGuide(p: { visible: boolean; timeFormat: TimeFormat; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [ledger, setLedger] = useState<PaperLedger | null>(null);
  useEffect(() => { if (p.visible) loadLedger().then(setLedger); }, [p.visible]);
  const update = (fn: (l: PaperLedger) => PaperLedger) => setLedger((l) => {
    if (!l) return l;
    const n = fn(l);
    saveLedger(n).catch(() => {});
    return n;
  });

  const fmt = (field: string, v: number) => (COUNT.has(field) ? String(Math.round(v)) : formatTimeValue(Math.abs(v), p.timeFormat));
  const signed = (field: string, d: number) => `${d > 0 ? '+' : '−'}${fmt(field, d)}${COUNT.has(field) ? '' : ' h'}`;
  const lineKey = (step: PaperFixStep, l: PaperFixLine) => `${step.key}|${l.row}|${l.field}`;
  const value = (l: PaperFixLine) => (l.from != null && l.to != null ? `${fmt(l.field, l.from)} → ${fmt(l.field, l.to)}` : signed(l.field, l.delta));

  const st = ledger ? ledgerStatus(ledger) : null;
  const { steps } = ledger ? ledgerSteps(ledger) : { steps: [] as PaperFixStep[] };
  const ticked = new Set(ledger?.ticked ?? []);
  const total = steps.reduce((n, s) => n + s.lines.length, 0);
  const doneCount = steps.reduce((n, s) => n + s.lines.filter((l) => ticked.has(lineKey(s, l))).length, 0);
  const spreadLabel = (left: number) => pagesLabel(left, ledger?.spreads.find((x) => x.left === left)?.right ?? null);

  const toggle = (k: string) => {
    Haptics.selectionAsync().catch(() => {});
    update((l) => ({ ...l, ticked: l.ticked.includes(k) ? l.ticked.filter((x) => x !== k) : [...l.ticked, k] }));
  };
  const allFixed = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    update((l) => ({ ...l, fixes: [], ticked: [] }));
    p.onClose();
  };
  const clearAll = () => Alert.alert(
    'Clear the list?',
    'Blades forgets the scanned pages and the totals to fix. Do this when you start on another logbook.',
    [{ text: 'Cancel', style: 'cancel' }, { text: 'Clear', style: 'destructive', onPress: () => { update(() => emptyLedger()); p.onClose(); } }],
  );

  const asText = () => {
    const out = ['Paper logbook corrections (Blades scan)', ''];
    for (const s of steps) {
      out.push(s.label);
      for (const l of s.lines) out.push(`  ${l.row} · ${label(l.field)}: ${value(l)}`);
      out.push('');
    }
    return out.join('\n');
  };

  // Det som hittats hittills (vänteläget): bara själva sidsummorna.
  const found = (ledger?.fixes ?? []).slice().sort((a, b) => a.left - b.left);

  return (
    <Modal visible={p.visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={p.onClose}>
      <View style={s.root}>
        <View style={s.grabber} />
        {!ledger || !st ? (
          <View style={s.center}><ActivityIndicator color={Colors.primary} /></View>
        ) : st.open === 0 ? (
          <View style={s.center}>
            <Ionicons name="checkmark-circle-outline" size={40} color={Colors.success} />
            <Text style={[s.title, { textAlign: 'center', marginTop: 8 }]}>Nothing to fix</Text>
            <Text style={[s.body, { textAlign: 'center' }]}>No miscounted totals in your paper logbook.</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 130, gap: 14 }} showsVerticalScrollIndicator={false}>
            <View style={[s.iconWrap, !st.ready && { backgroundColor: Colors.warning + '1A' }]}>
              <Ionicons name={st.ready ? 'create-outline' : 'hourglass-outline'} size={26} color={st.ready ? Colors.primary : Colors.warning} />
            </View>
            <Text style={[s.eyebrow, !st.ready && { color: Colors.warning }]}>PAPER LOGBOOK</Text>
            {st.ready ? (
              <>
                <Text style={s.title}>Fix your page totals</Text>
                <Text style={s.body}>
                  Your whole logbook is scanned, up to the page you're writing on. These totals were miscounted, and the error carries
                  on to every total after them. Here is every change, page by page — tick them off as you go.
                </Text>
                {steps.map((step) => {
                  const all = step.lines.every((l) => ticked.has(lineKey(step, l)));
                  return (
                    <View key={step.key} style={[s.card, all && s.cardDone]}>
                      <View style={s.cardHead}>
                        <Ionicons name="book-outline" size={16} color={all ? Colors.success : Colors.textSecondary} />
                        <Text style={s.cardTitle}>{step.label}</Text>
                        {all && <Text style={s.cardDoneText}>Done</Text>}
                      </View>
                      {step.lines.map((l) => {
                        const k = lineKey(step, l);
                        const on = ticked.has(k);
                        return (
                          <TouchableOpacity key={k} style={s.line} onPress={() => toggle(k)} activeOpacity={0.75}
                            accessibilityRole="checkbox" accessibilityState={{ checked: on }}>
                            <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={on ? Colors.success : Colors.textMuted} />
                            <View style={{ flex: 1 }}>
                              <Text style={[s.lineRow, on && s.dim]}>{l.row}</Text>
                              <Text style={[s.lineField, on && s.dim]}>{label(l.field)}</Text>
                            </View>
                            {l.from != null && l.to != null ? (
                              <View style={s.values}>
                                <Text style={[s.from, on && s.dim]}>{fmt(l.field, l.from)}</Text>
                                <Ionicons name="arrow-forward" size={13} color={Colors.textMuted} />
                                <Text style={[s.to, on && s.dim]}>{fmt(l.field, l.to)}</Text>
                              </View>
                            ) : (
                              <Text style={[s.to, on && s.dim]}>{signed(l.field, l.delta)}</Text>
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  );
                })}
              </>
            ) : (
              <>
                <Text style={s.title}>Wait with your paper logbook</Text>
                <Text style={s.body}>
                  Blades found {st.open === 1 ? 'a miscounted page total' : `${st.open} miscounted page totals`}. A change in your paper
                  logbook changes every total after it, so make all the changes at once — when your whole logbook is scanned, up to the
                  page you're writing on now. Blades keeps this list until then.
                </Text>

                <View style={s.card}>
                  <Text style={s.cardLabel}>FOUND SO FAR</Text>
                  {found.map((f) => (
                    <View key={`${f.left}|${f.field}`} style={s.line}>
                      <Ionicons name="alert-circle-outline" size={20} color={Colors.warning} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.lineRow}>{spreadLabel(f.left)}</Text>
                        <Text style={s.lineField}>Total this page · {label(f.field)}</Text>
                      </View>
                      <View style={s.values}>
                        <Text style={s.from}>{fmt(f.field, f.from)}</Text>
                        <Ionicons name="arrow-forward" size={13} color={Colors.textMuted} />
                        <Text style={s.to}>{fmt(f.field, f.to)}</Text>
                      </View>
                    </View>
                  ))}
                </View>

                <View style={s.card}>
                  <Text style={s.cardLabel}>STILL TO SCAN</Text>
                  {st.start == null && st.first && (
                    <View style={s.missing}>
                      <Text style={s.lineRow}>The pages before {spreadLabel(st.first.left)}</Text>
                      <TouchableOpacity style={s.answer} onPress={() => update((l) => ({ ...l, start: st.first!.left }))} activeOpacity={0.8}>
                        <Text style={s.answerText}>{spreadLabel(st.first.left)} is the first page of my logbook</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                  {st.gaps.map((g) => (
                    <View key={g.from} style={s.missing}><Text style={s.lineRow}>{g.label}</Text></View>
                  ))}
                  {st.latest == null && st.last && (
                    <View style={s.missing}>
                      <Text style={s.lineRow}>Every page after {spreadLabel(st.last.left)}, up to the one you're writing on</Text>
                      <TouchableOpacity style={s.answer} onPress={() => update((l) => ({ ...l, latest: st.last!.left }))} activeOpacity={0.8}>
                        <Text style={s.answerText}>I'm writing on {spreadLabel(st.last.left)} now</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
                <Text style={s.note}>Scan the missing pages — the guide with every change opens here when your logbook is complete.</Text>
              </>
            )}
          </ScrollView>
        )}

        <View style={[s.footer, { paddingBottom: insets.bottom + 12 }]}>
          {st?.ready && total > 0 && doneCount === total ? (
            <TouchableOpacity style={s.primary} onPress={allFixed} activeOpacity={0.85}>
              <Text style={s.primaryText}>All fixed</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={s.primary} onPress={p.onClose} activeOpacity={0.85}>
              <Text style={s.primaryText}>{st?.ready ? `Done for now · ${doneCount} of ${total}` : 'OK'}</Text>
            </TouchableOpacity>
          )}
          <View style={s.links}>
            {st?.ready && <TouchableOpacity onPress={() => Share.share({ message: asText() }).catch(() => {})} hitSlop={8}><Text style={s.secondaryText}>Share the list</Text></TouchableOpacity>}
            {(st?.open ?? 0) > 0 && <TouchableOpacity onPress={clearAll} hitSlop={8}><Text style={s.secondaryText}>Clear the list</Text></TouchableOpacity>}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 6 },
  grabber: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: Colors.border, marginTop: 8 },
  iconWrap: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary + '1A', marginTop: 8 },
  eyebrow: { color: Colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: Colors.textPrimary, fontSize: 26, fontWeight: '800', marginTop: -6 },
  body: { color: Colors.textSecondary, fontSize: 15, lineHeight: 21 },
  note: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18, textAlign: 'center', paddingHorizontal: 8 },
  card: { borderRadius: 18, borderWidth: 1, borderColor: Colors.cardBorder, backgroundColor: Colors.surface, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 },
  cardDone: { borderColor: Colors.success + '55' },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  cardTitle: { flex: 1, color: Colors.textPrimary, fontSize: 16, fontWeight: '800' },
  cardDoneText: { color: Colors.success, fontSize: 13, fontWeight: '700' },
  cardLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginBottom: 4 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  lineRow: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
  lineField: { color: Colors.textSecondary, fontSize: 13, marginTop: 1 },
  missing: { gap: 8, paddingVertical: 11, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  answer: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 10, borderWidth: 1, borderColor: Colors.primary + '66', backgroundColor: Colors.primary + '12' },
  answerText: { color: Colors.primary, fontSize: 13, fontWeight: '700' },
  values: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  from: { color: Colors.textMuted, fontSize: 16, fontWeight: '600', textDecorationLine: 'line-through', fontVariant: ['tabular-nums'] },
  to: { color: Colors.primary, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
  dim: { opacity: 0.45 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 20, paddingTop: 12, gap: 12, alignItems: 'center', backgroundColor: Colors.background, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border },
  primary: { alignSelf: 'stretch', height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.primary },
  primaryText: { color: Colors.background, fontSize: 17, fontWeight: '800' },
  links: { flexDirection: 'row', gap: 28 },
  secondaryText: { color: Colors.textSecondary, fontSize: 15, fontWeight: '600' },
});
