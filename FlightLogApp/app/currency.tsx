// "Current today?" — pilot currency/recency-översikt (premium). Passagerare dag/natt per
// rating_class, instrument (EASA-datum / FAA 6HITS via ruleset), medical och ratings.
// Regelverk + IR-substitut-krav persistas i settings; dev-verktyg för dry-run/backfill.
import { useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { Colors } from '../constants/colors';
import { useFlightStore } from '../store/flightStore';
import { setSetting, dryRunStopParsing, backfillFullStopLandings } from '../db/flights';
import { getPilotCurrency, type CurrencyReport, type CurrencyItem, type CurrencyStatus, type Ruleset } from '../db/currency';

const RULESETS: Ruleset[] = ['EASA', 'FAA', 'UK CAA'];
const statusColor = (s: CurrencyStatus) =>
  s === 'current' ? Colors.success : s === 'warning' ? Colors.warning : s === 'expired' ? Colors.danger : Colors.textMuted;
const statusIcon = (s: CurrencyStatus) =>
  s === 'current' ? 'checkmark-circle' : s === 'warning' ? 'alert-circle' : s === 'expired' ? 'close-circle' : 'ellipse-outline';

function Row({ item }: { item: CurrencyItem }) {
  const color = statusColor(item.status);
  const pct = item.daysLeft != null ? Math.max(4, Math.min(100, (item.daysLeft / 90) * 100)) : null;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name={statusIcon(item.status) as any} size={16} color={color} />
        <Text style={{ flex: 1, color: Colors.textPrimary, fontSize: 13, fontWeight: '700' }} numberOfLines={1}>{item.label}</Text>
        <Text style={{ color, fontSize: 11, fontWeight: '700', fontFamily: 'Menlo' }}>
          {item.status === 'current' ? 'CURRENT' : item.status === 'warning' ? 'SOON' : item.status === 'expired' ? 'NOT CURRENT' : 'N/A'}
        </Text>
      </View>
      <Text style={{ color: Colors.textMuted, fontSize: 11.5, marginLeft: 24 }}>{item.detail}</Text>
      {pct != null && (
        <View style={{ height: 4, marginLeft: 24, backgroundColor: Colors.elevated, borderRadius: 3, overflow: 'hidden' }}>
          <View style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: 3 }} />
        </View>
      )}
    </View>
  );
}

function Section({ title, items }: { title: string; items: CurrencyItem[] }) {
  if (!items.length) return null;
  return (
    <View style={{ gap: 10 }}>
      <Text style={s.sectionTitle}>{title}</Text>
      <View style={s.card}>
        {items.map((it, i) => (
          <View key={it.key} style={{ gap: 10 }}>
            {i > 0 && <View style={{ height: 1, backgroundColor: Colors.border }} />}
            <Row item={it} />
          </View>
        ))}
      </View>
    </View>
  );
}

export default function CurrencyScreen() {
  const router = useRouter();
  const { isPremium, isMax } = useFlightStore();
  const premium = isPremium || isMax;
  const [report, setReport] = useState<CurrencyReport | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    getPilotCurrency().then((r) => { setReport(r); setLoading(false); }).catch(() => setLoading(false));
  }, []);
  useFocusEffect(useCallback(() => { if (premium) load(); }, [premium, load]));

  const chooseRuleset = async (r: Ruleset) => { await setSetting('ruleset', r); load(); };
  const toggleIrValid = async () => {
    await setSetting('ir_substitute_requires_valid', report?.irSubstituteRequiresValid ? '0' : '1');
    load();
  };

  if (!premium) {
    return (
      <View style={[s.container, { justifyContent: 'center', alignItems: 'center', padding: 32, gap: 14 }]}>
        <Ionicons name="lock-closed" size={40} color={Colors.textMuted} />
        <Text style={{ color: Colors.textPrimary, fontSize: 17, fontWeight: '700', textAlign: 'center' }}>Currency tracking is Premium</Text>
        <Text style={{ color: Colors.textMuted, fontSize: 13, textAlign: 'center' }}>Track passenger, night, instrument, medical and rating currency across your fleet.</Text>
        <TouchableOpacity style={s.upgradeBtn} onPress={() => router.push('/settings/premium')} activeOpacity={0.85}>
          <Text style={{ color: Colors.textInverse, fontSize: 14, fontWeight: '700' }}>Go Premium</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const pax = report?.items.filter((i) => i.key.startsWith('pax')) ?? [];
  const ifr = report?.items.filter((i) => i.key === 'ifr') ?? [];
  const medical = report?.items.filter((i) => i.key === 'medical') ?? [];
  const ratings = report?.items.filter((i) => i.key.startsWith('rating:')) ?? [];

  return (
    <ScrollView style={s.container} contentContainerStyle={{ padding: 16, gap: 18, paddingBottom: 40 }}>
      {/* Regelverk */}
      <View style={{ gap: 8 }}>
        <Text style={s.sectionTitle}>Regulatory ruleset</Text>
        <View style={s.segBar}>
          {RULESETS.map((r) => {
            const on = report?.ruleset === r;
            return (
              <TouchableOpacity key={r} style={[s.seg, on && s.segOn]} onPress={() => chooseRuleset(r)} activeOpacity={0.8}>
                <Text style={[s.segText, on && s.segTextOn]}>{r}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity style={s.toggleRow} onPress={toggleIrValid} activeOpacity={0.7}>
          <Ionicons name={report?.irSubstituteRequiresValid ? 'checkbox' : 'square-outline'} size={18} color={report?.irSubstituteRequiresValid ? Colors.primary : Colors.textMuted} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: Colors.textPrimary, fontSize: 13, fontWeight: '600' }}>IR substitutes night currency only if valid</Text>
            <Text style={{ color: Colors.textMuted, fontSize: 11 }}>EASA: a valid IR keeps you night-current{report?.hasValidIR ? ' — valid IR on file' : ''}.</Text>
          </View>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={Colors.primary} style={{ marginTop: 24 }} />
      ) : (
        <>
          <Section title="Passenger currency" items={pax} />
          <Section title="Instrument" items={ifr} />
          <Section title="Medical" items={medical} />
          <Section title="Ratings" items={ratings} />
          {!pax.length && !ratings.length && (
            <Text style={{ color: Colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: 8 }}>
              Log flights with take-offs/landings to see passenger currency here.
            </Text>
          )}
        </>
      )}

      {__DEV__ && (
        <View style={{ gap: 8, marginTop: 8 }}>
          <Text style={s.sectionTitle}>Dev tools</Text>
          <TouchableOpacity style={s.devBtn} onPress={async () => { const r = await dryRunStopParsing(); Alert.alert('Stop dry-run', `${r.length} flight(s) with uncertain full-stop classification. See console for the list.`); }}>
            <Text style={s.devText}>Run stop dry-run (read-only)</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.devBtn} onPress={async () => {
            const r = await backfillFullStopLandings();
            Alert.alert('Full-stop backfill', r.skipped ? 'Already run (guarded).' : `Updated ${r.updated} non-T&G flight(s).`);
            load();
          }}>
            <Text style={s.devText}>Run full-stop backfill (once)</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  sectionTitle: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  card: { backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, padding: 14, gap: 10 },
  segBar: { flexDirection: 'row', backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, padding: 3, gap: 3 },
  seg: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
  segOn: { backgroundColor: Colors.primary },
  segText: { color: Colors.textMuted, fontSize: 12, fontWeight: '700' },
  segTextOn: { color: Colors.textInverse },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 12 },
  upgradeBtn: { backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 28 },
  devBtn: { backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, paddingVertical: 11, alignItems: 'center' },
  devText: { color: Colors.textSecondary, fontSize: 12.5, fontWeight: '600' },
});
