// "LATEST FLIGHT"-hero: NightRoute + block-tid + natt-caption + flygplatsnamn + 5-cellsremsa.
import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../../constants/colors';
import type { Flight } from '../../types/flight';
import { useTimeFormat } from '../../hooks/useTimeFormat';
import { getAirportByIcao } from '../../db/icao';
import { FONT_MONO, NIGHT_FILL } from './tokens';
import { roleLabel, isPicFlight, arrUtc, parseDate } from './flightDisplay';
import { NightRoute } from './NightRoute';
import { useNightFraction } from './useNightFraction';

export function LatestFlightCard({ flight: f, accent, placeNames, onPress }: {
  flight: Flight; accent: string; placeNames: Record<string, string>; onPress: () => void;
}) {
  const { formatTime, timeFormat } = useTimeFormat();
  const { nightFrac, darkOnsetUtc } = useNightFraction(f);
  const d = parseDate(f.date);
  const dateLabel = `${String(d.getDate()).padStart(2, '0')} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
  const city = (icao: string) => placeNames[icao] || icao;
  const nightPct = Math.round(nightFrac * 100);

  // Riktiga flygplatsnamn (icao_airports.name) för raden under ICAO→ICAO; fallback till ICAO.
  const [names, setNames] = useState<{ dep: string; arr: string }>({ dep: city(f.dep_place), arr: city(f.arr_place) });
  useEffect(() => {
    let alive = true;
    Promise.all([getAirportByIcao(f.dep_place), getAirportByIcao(f.arr_place)]).then(([dep, arr]) => {
      if (!alive) return;
      setNames({
        dep: dep?.name && dep.name !== f.dep_place ? dep.name : city(f.dep_place),
        arr: arr?.name && arr.name !== f.arr_place ? arr.name : city(f.arr_place),
      });
    }).catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.dep_place, f.arr_place, placeNames]);

  const strip: [string, string, boolean][] = [
    ['Role', roleLabel(f), isPicFlight(f)],
    ['Aircraft', `${f.aircraft_type}${f.registration ? ` ${f.registration}` : ''}`, false],
    ['Dep', (f.dep_utc || '—') + 'z', false],
    ['Rules', f.ifr > 0 ? 'IFR' : 'VFR', false],
    ['Arr', (arrUtc(f) || '—') + 'z', false],
  ];

  return (
    <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 }}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: accent + '55' }}>
        <LinearGradient colors={[accent + '22', Colors.surface]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: '100%', height: '100%', position: 'absolute' }} />
        {/* header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 }}>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.8, textTransform: 'uppercase', color: accent }}>Latest flight</Text>
          <View style={{ flex: 1, height: 1, backgroundColor: accent + '33' }} />
          <Text style={{ fontFamily: FONT_MONO, fontSize: 10, color: Colors.textSecondary }}>{dateLabel}</Text>
        </View>
        {/* route + block */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingBottom: 6 }}>
          {/* ICAO→ICAO alltid vit (ingen silver-tint efter night-andel); natt visas i captionen nedan */}
          <NightRoute dep={f.dep_place} arr={f.arr_place} nightFrac={0} size={30} accent={accent} dayColor={Colors.textPrimary} />
          <View style={{ flex: 1 }} />
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 17, fontWeight: '700', color: Colors.textPrimary }}>{timeFormat === 'decimal' ? `${formatTime(f.total_time)}h` : formatTime(f.total_time)}</Text>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 9, color: Colors.textMuted }}>FLIGHT TIME</Text>
          </View>
        </View>
        {/* natt-caption */}
        {f.night > 0 && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingBottom: 8 }}>
            <Ionicons name="moon" size={11} color={NIGHT_FILL} />
            <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 0.4, color: NIGHT_FILL }}>{nightPct}% night</Text>
            {darkOnsetUtc ? <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, fontWeight: '700', color: NIGHT_FILL }}>· dark {darkOnsetUtc}z</Text> : null}
          </View>
        )}
        <Text numberOfLines={1} style={{ fontSize: 11.5, color: Colors.textSecondary, paddingHorizontal: 14, paddingBottom: 10 }}>{names.dep} → {names.arr}</Text>
        {/* 5-cellsremsa */}
        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: accent + '33' }}>
          {strip.map(([k, v, hot], i) => (
            <View key={k} style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 6, borderLeftWidth: i ? 1 : 0, borderLeftColor: accent + '22', alignItems: 'center' }}>
              <Text style={{ fontFamily: FONT_MONO, fontSize: 7.5, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: Colors.gold }}>{k}</Text>
              <Text numberOfLines={1} style={{ fontFamily: FONT_MONO, fontSize: 10.5, fontWeight: '700', color: hot ? accent : Colors.textPrimary, marginTop: 3 }}>{v}</Text>
            </View>
          ))}
        </View>
      </TouchableOpacity>
    </View>
  );
}
