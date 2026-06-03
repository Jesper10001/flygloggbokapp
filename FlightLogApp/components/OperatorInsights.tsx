// Insikter för operatörsläget: tjänst/natt-tid, 3/6/12-mån-fönster, rollmått
// (vinschningar/patienter/skott…), uppdragsmix och en heuristisk aktivitets-/
// currency-överblick. All data härleds ur flyglistan + operator_data.

import { useMemo } from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Colors } from '../constants/colors';
import { useTranslation } from '../hooks/useTranslation';
import { useTimeFormat } from '../hooks/useTimeFormat';
import { useFlightStore } from '../store/flightStore';
import { useProfileStore } from '../store/profileStore';
import {
  parseOperatorData, numericFields, getRoleFields, fieldLabel, optionLabel,
  roleLabel, ROLE_META, type Lang,
} from '../constants/operatorRoles';

const monthsAgoISO = (n: number) => { const d = new Date(); d.setMonth(d.getMonth() - n); return d.toISOString().slice(0, 10); };
const daysAgoISO = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
const SERIF = Platform.OS === 'ios' ? 'Georgia' : 'serif';
const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

export function OperatorInsights() {
  const { language } = useTranslation();
  const lang: Lang = language === 'sv' ? 'sv' : 'en';
  const sv = lang === 'sv';
  const { formatTime } = useTimeFormat();
  const flights = useFlightStore((s) => s.flights);
  const role = useProfileStore((s) => s.profile?.subRole) ?? '';

  const opFlights = useMemo(
    () => flights.map((f) => ({ f, op: parseOperatorData(f) })).filter((x) => x.op && x.op.role === role) as { f: any; op: any }[],
    [flights, role],
  );

  const cut90 = daysAgoISO(90);
  const dutySince = (cut: string) => opFlights.reduce((s, x) => s + (x.f.date >= cut ? Number(x.f.total_time) || 0 : 0), 0);
  const totalDuty = opFlights.reduce((s, x) => s + (Number(x.f.total_time) || 0), 0);
  const nightDuty = opFlights.reduce((s, x) => s + (Number(x.f.night) || 0), 0);
  const m3 = dutySince(monthsAgoISO(3)), m6 = dutySince(monthsAgoISO(6)), m12 = dutySince(monthsAgoISO(12));

  const metricSum = (key: string, cut?: string) =>
    opFlights.reduce((s, x) => (cut && !(x.f.date >= cut) ? s : s + (Number(x.op[key]) || 0)), 0);
  const numFields = numericFields(role);

  const sorted = useMemo(() => [...opFlights].sort((a, b) => (a.f.date < b.f.date ? 1 : -1)), [opFlights]);
  const lastDate: string | null = sorted[0]?.f.date ?? null;
  const daysSince = lastDate ? Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400000) : null;
  const count90 = opFlights.filter((x) => x.f.date >= cut90).length;
  const night90 = opFlights.filter((x) => x.f.date >= cut90 && (Number(x.f.night) || 0) > 0).length;

  const missionDef = getRoleFields(role).find((d) => d.key === 'mission_type');
  const missions = useMemo(() => {
    const c: Record<string, number> = {};
    for (const x of opFlights) {
      const mt = x.op.mission_type; const arr = Array.isArray(mt) ? mt : (mt ? [mt] : []);
      for (const k of arr) c[String(k)] = (c[String(k)] || 0) + 1;
    }
    return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [opFlights]);
  const missionMax = Math.max(1, ...missions.map(([, n]) => n));

  if (opFlights.length === 0) {
    return (
      <View style={s.empty}>
        <Text style={s.emptyTitle}>{ROLE_META[role]?.emoji ?? '🎖️'} {roleLabel(role, lang)}</Text>
        <Text style={s.emptyBody}>{sv ? 'Inga uppdrag loggade än för den här rollen.' : 'No missions logged yet for this role.'}</Text>
      </View>
    );
  }

  return (
    <View style={{ gap: 14 }}>
      {/* Tjänst + natt */}
      <View style={s.bigBox}>
        <View style={s.bigHalf}>
          <Text style={s.bigLabel}>{sv ? 'Total tjänsttid' : 'Total duty time'}</Text>
          <Text style={s.bigValue}>{formatTime(totalDuty)}</Text>
        </View>
        <View style={s.bigDivider} />
        <View style={s.bigHalf}>
          <Text style={s.bigLabel}>{sv ? 'Varav natt' : 'Of which night'}</Text>
          <Text style={s.bigValue}>{formatTime(nightDuty)}</Text>
        </View>
      </View>

      {/* 3/6/12 mån */}
      <View style={s.row3}>
        {[{ l: sv ? 'Senaste 3 mån' : 'Last 3 mo', v: m3 }, { l: sv ? 'Senaste 6 mån' : 'Last 6 mo', v: m6 }, { l: sv ? 'Senaste 12 mån' : 'Last 12 mo', v: m12 }].map((c) => (
          <View key={c.l} style={s.smallBox}>
            <Text style={s.smallValue}>{formatTime(c.v)}</Text>
            <Text style={s.smallLabel}>{c.l}</Text>
          </View>
        ))}
      </View>

      {/* Aktivitet / currency (heuristisk) */}
      <View style={s.card}>
        <Text style={s.cardHeader}>{sv ? 'Aktivitet (senaste 90 dagar)' : 'Activity (last 90 days)'}</Text>
        <View style={s.statRow}>
          <Stat label={sv ? 'Uppdrag' : 'Missions'} value={String(count90)} />
          <Stat label={sv ? 'Nattuppdrag' : 'Night ops'} value={String(night90)} />
          <Stat label={sv ? 'Sedan senaste' : 'Since last'} value={daysSince == null ? '—' : `${daysSince}${sv ? ' d' : 'd'}`} />
        </View>
        <Text style={s.note}>{sv ? 'Heuristisk överblick — inte myndighetscurrency.' : 'Heuristic overview — not regulatory currency.'}</Text>
      </View>

      {/* Rollmått */}
      {numFields.length > 0 && (
        <View style={s.card}>
          <Text style={s.cardHeader}>{sv ? 'Rollmått' : 'Role metrics'}</Text>
          {numFields.map((def) => {
            const total = metricSum(def.key);
            const last90 = metricSum(def.key, cut90);
            if (total === 0) return null;
            return (
              <View key={def.key} style={s.metricRow}>
                <Text style={s.metricLabel}>{fieldLabel(def, lang)}</Text>
                <Text style={s.metricValue}>{total}<Text style={s.metric90}>  ·  90d {last90}</Text></Text>
              </View>
            );
          })}
        </View>
      )}

      {/* Uppdragsmix */}
      {missions.length > 0 && (
        <View style={s.card}>
          <Text style={s.cardHeader}>{sv ? 'Uppdragstyper' : 'Mission types'}</Text>
          {missions.map(([k, n]) => (
            <View key={k} style={s.barRow}>
              <Text style={s.barLabel} numberOfLines={1}>{missionDef ? optionLabel(missionDef, k, lang) : k}</Text>
              <View style={s.barTrack}><View style={[s.barFill, { width: `${(n / missionMax) * 100}%` }]} /></View>
              <Text style={s.barValue}>{n}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 48 },
  emptyTitle: { color: Colors.textPrimary, fontSize: 18, fontWeight: '800' },
  emptyBody: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center' },

  bigBox: { flexDirection: 'row', backgroundColor: Colors.card, borderRadius: 16, borderWidth: 1, borderColor: Colors.primary + '55', paddingVertical: 16 },
  bigHalf: { flex: 1, alignItems: 'center', gap: 4 },
  bigDivider: { width: 1, backgroundColor: Colors.separator, marginVertical: 4 },
  bigLabel: { color: Colors.textSecondary, fontSize: 12, fontFamily: SERIF },
  bigValue: { color: Colors.textPrimary, fontSize: 24, fontWeight: '800', fontFamily: MONO },

  row3: { flexDirection: 'row', gap: 10 },
  smallBox: { flex: 1, alignItems: 'center', gap: 3, backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.cardBorder, paddingVertical: 14 },
  smallValue: { color: Colors.textPrimary, fontSize: 17, fontWeight: '700', fontFamily: MONO },
  smallLabel: { color: Colors.textMuted, fontSize: 12, fontFamily: SERIF },

  card: { backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.cardBorder, padding: 16, gap: 10 },
  cardHeader: { color: Colors.textPrimary, fontSize: 15, fontWeight: '800', fontFamily: SERIF },
  note: { color: Colors.textMuted, fontSize: 11, fontStyle: 'italic' },

  statRow: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { color: Colors.primary, fontSize: 20, fontWeight: '800', fontFamily: MONO },
  statLabel: { color: Colors.textMuted, fontSize: 11, textAlign: 'center' },

  metricRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  metricLabel: { color: Colors.textSecondary, fontSize: 14, fontFamily: SERIF },
  metricValue: { color: Colors.textPrimary, fontSize: 16, fontWeight: '700', fontFamily: MONO },
  metric90: { color: Colors.textMuted, fontSize: 12, fontWeight: '400' },

  barRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  barLabel: { width: 92, color: Colors.textSecondary, fontSize: 13 },
  barTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: Colors.elevated, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4, backgroundColor: Colors.primary },
  barValue: { width: 28, textAlign: 'right', color: Colors.textPrimary, fontSize: 13, fontWeight: '700', fontFamily: MONO },
});
