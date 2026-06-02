// Totaler-sektion för Insikter: total flygtid + YTD överst, tre fönster
// (3/6/12 mån) och ett eget intervall (från valt datum till nu). Fönstren
// beräknas ur flyglistan (exkl. sim) för att matcha total_time-semantiken.

import { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Colors } from '../constants/colors';
import { useTranslation } from '../hooks/useTranslation';
import { useTimeFormat } from '../hooks/useTimeFormat';
import { useFlightStore } from '../store/flightStore';
import type { Flight } from '../types/flight';

function sumSince(flights: Flight[], cutoffISO: string): number {
  let s = 0;
  for (const f of flights) {
    if ((f as any).flight_type === 'sim') continue;
    if (f.date && f.date >= cutoffISO) s += Number(f.total_time) || 0;
  }
  return s;
}

function monthsAgoISO(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

export function FlightTimeTotals() {
  const { t } = useTranslation();
  const { formatTime } = useTimeFormat();
  const flights = useFlightStore((s) => s.flights);
  const [customDate, setCustomDate] = useState<Date | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  const total = useMemo(() => sumSince(flights, '0000-01-01'), [flights]);
  const ytd = useMemo(() => sumSince(flights, `${new Date().getFullYear()}-01-01`), [flights]);
  const m3 = useMemo(() => sumSince(flights, monthsAgoISO(3)), [flights]);
  const m6 = useMemo(() => sumSince(flights, monthsAgoISO(6)), [flights]);
  const m12 = useMemo(() => sumSince(flights, monthsAgoISO(12)), [flights]);
  const customTotal = useMemo(
    () => (customDate ? sumSince(flights, customDate.toISOString().slice(0, 10)) : null),
    [flights, customDate],
  );

  const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

  return (
    <View style={{ gap: 10 }}>
      {/* Total + YTD */}
      <View style={st.bigBox}>
        <View style={st.bigHalf}>
          <Text style={st.bigLabel}>{t('total_flight_time')}</Text>
          <Text style={st.bigValue}>{formatTime(total)}</Text>
        </View>
        <View style={st.bigDivider} />
        <View style={st.bigHalf}>
          <Text style={st.bigLabel}>{t('flight_time_ytd')}</Text>
          <Text style={st.bigValue}>{formatTime(ytd)}</Text>
        </View>
      </View>

      {/* 3 / 6 / 12 mån */}
      <View style={st.row3}>
        {[{ l: t('ft_last_3m'), v: m3 }, { l: t('ft_last_6m'), v: m6 }, { l: t('ft_last_12m'), v: m12 }].map((c) => (
          <View key={c.l} style={st.smallBox}>
            <Text style={st.smallValue}>{formatTime(c.v)}</Text>
            <Text style={st.smallLabel}>{c.l}</Text>
          </View>
        ))}
      </View>

      {/* Eget intervall */}
      <TouchableOpacity style={st.customBox} onPress={() => setShowPicker(true)} activeOpacity={0.8}>
        <Ionicons name="calendar-outline" size={20} color={Colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={st.customLabel}>{t('ft_custom')}</Text>
          <Text style={st.customSub}>{customDate ? `${t('ft_from_date')} ${fmtDate(customDate)}` : t('ft_pick_date')}</Text>
        </View>
        <Text style={st.customValue}>{customTotal != null ? formatTime(customTotal) : '—'}</Text>
      </TouchableOpacity>

      {showPicker && (
        <DateTimePicker
          value={customDate ?? new Date()}
          mode="date"
          maximumDate={new Date()}
          onChange={(_e, d) => { setShowPicker(false); if (d) setCustomDate(d); }}
        />
      )}
    </View>
  );
}

const SERIF = Platform.OS === 'ios' ? 'Georgia' : 'serif';
const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

const st = StyleSheet.create({
  bigBox: {
    flexDirection: 'row', backgroundColor: Colors.card, borderRadius: 16,
    borderWidth: 1, borderColor: Colors.primary + '55', paddingVertical: 16,
  },
  bigHalf: { flex: 1, alignItems: 'center', gap: 4 },
  bigDivider: { width: 1, backgroundColor: Colors.separator, marginVertical: 4 },
  bigLabel: { color: Colors.textSecondary, fontSize: 12, fontFamily: SERIF, letterSpacing: 0.3 },
  bigValue: { color: Colors.textPrimary, fontSize: 24, fontWeight: '800', fontFamily: MONO },

  row3: { flexDirection: 'row', gap: 10 },
  smallBox: {
    flex: 1, alignItems: 'center', gap: 3, backgroundColor: Colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.cardBorder, paddingVertical: 14,
  },
  smallValue: { color: Colors.textPrimary, fontSize: 17, fontWeight: '700', fontFamily: MONO },
  smallLabel: { color: Colors.textMuted, fontSize: 12, fontFamily: SERIF },

  customBox: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.cardBorder, paddingVertical: 14, paddingHorizontal: 16,
  },
  customLabel: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700', fontFamily: SERIF },
  customSub: { color: Colors.textMuted, fontSize: 12, marginTop: 1 },
  customValue: { color: Colors.primary, fontSize: 18, fontWeight: '800', fontFamily: MONO },
});
