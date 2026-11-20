// Förbandskortet: ersätter flygplatskortet på global map när Air Bases → Specific är på och flygplatsen är en av de
// militära baserna (Europa och Ryssland). Samma ram, översta rad och knappar som AirportInfoCard; remsan visar förband och kommando i stället
// för höjd och banor, och AIRCRAFT flygplanstyperna med rollsymbolen (typerna flyter fritt; symbolen hålls ihop med
// sin första typ så att den aldrig står ensam sist på en rad). Design 2026-11-19, artifact G3JjRFW2NmM3nEkNPsUkaT.
// Kortet hålls lågt: UNIT/COMMAND visar högst tre rader och AIRCRAFT högst tre rader, resten rullas fram (ScrollBox).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../constants/colors';
import { COUNTRY_NAMES } from '../constants/countryNames';
import { layerCode } from '../utils/airportCodes';
import { ROLES, baseGroups, operatorLabel, typeFamily, type MilBase } from '../utils/milAirbases';
import { RoleTag } from './RoleTag';

const MONO = 'JetBrainsMono';
const SERIF = 'Fraunces';
const SUB = '#A9C3DB';
const GOLD = '#FFB830';
const LINE = 16;                    // radhöjden för förband/kommando (s.value)
const TEXT_MAX = LINE * 3 + 3 * 2;  // tre rader text, sedan rullning
const ROW = 20;                     // en rad flygfarkoster (rollsymbolens höjd)
const CHIP_MAX = ROW * 3 + 5 * 2;   // tre rader flygfarkoster, sedan rullning

// Rullista med takhöjd: rullar bara när innehållet inte får plats, och tonar ut nederkanten tills man rullat till slutet
// (visar att det finns mer). Rullningslisten blinkar till en gång när rutan öppnas med mer innehåll.
function ScrollBox({ max, children, contentStyle }: { max: number; children: ReactNode; contentStyle?: StyleProp<ViewStyle> }) {
  const ref = useRef<ScrollView>(null);
  const [h, setH] = useState(0);
  const [atEnd, setAtEnd] = useState(false);
  const over = h > max + 1;
  useEffect(() => {
    if (!over) return;
    const t = setTimeout(() => ref.current?.flashScrollIndicators(), 350);
    return () => clearTimeout(t);
  }, [over]);
  return (
    <View>
      <ScrollView ref={ref} style={{ maxHeight: max }} contentContainerStyle={contentStyle} scrollEnabled={over} bounces={false}
        showsVerticalScrollIndicator={over} nestedScrollEnabled scrollEventThrottle={32}
        onContentSizeChange={(_, ch) => setH(ch)}
        onScroll={(e) => { const { contentOffset: o, layoutMeasurement: l, contentSize: c } = e.nativeEvent; setAtEnd(o.y + l.height >= c.height - 3); }}>
        {children}
      </ScrollView>
      {over && !atEnd && (
        <LinearGradient pointerEvents="none" colors={['rgba(15,30,58,0)', 'rgba(15,30,58,0.96)']}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 14 }} />
      )}
    </View>
  );
}

export function UnitCard({ icao, base, country, accent = Colors.primary, onClose, isFavorite, onToggleFavorite, onSource, highlight }: {
  icao: string;
  base: MilBase;
  country?: string | null;
  accent?: string;
  onClose: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  onSource?: () => void;        // Source-knappen nere till höger → var datan kommer från
  highlight?: Set<string>;      // Specific → Types: valda modellfamiljer → de typerna i cyan
}) {
  const countryName = country ? (COUNTRY_NAMES[country.toUpperCase()] ?? country.toUpperCase()) : '';
  const meta = ['Air base', base.r || null, countryName || null].filter(Boolean).join(' · ');
  const line = accent + '33';
  const groups = baseGroups(base);
  const items: { start: boolean; role: (typeof groups)[number][0]; type: string }[] = [];
  for (const [role, types] of groups) types.forEach((t, i) => items.push({ start: i === 0, role, type: t }));
  // Förbandets flagga framför när förbandet är utländskt (t.ex. USAF på Lakenheath) eller när flera länder delar basen.
  const flagged = base.ops.length > 1 || base.ops.some((op) => op.o !== (country || '').toUpperCase());
  const units = base.ops.flatMap((op) => op.u.map((u) => (flagged ? `${operatorLabel(op.o)} ${u}` : u)));
  const commands = [...new Set(base.ops.map((op) => (op.c ? (flagged && base.ops.length > 1 ? `${operatorLabel(op.o)} ${op.c}` : op.c) : '')).filter(Boolean))];

  return (
    <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: accent + '55' }}>
      <LinearGradient colors={['rgba(18,48,74,0.97)', 'rgba(15,30,58,0.97)']} locations={[0, 0.55]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />

      {/* Rad 1: kod · namn (upp till två rader) · stjärna · stäng */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingLeft: 14, paddingRight: 10, paddingTop: 10, paddingBottom: 2 }}>
        <Text style={{ fontFamily: MONO, fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: 1, color: accent }}>{layerCode(icao)}</Text>
        <Text style={{ flex: 1, fontFamily: SERIF, fontSize: 16, lineHeight: 20, paddingTop: 3, fontWeight: '600', color: '#FFFFFF' }} numberOfLines={2}>{base.n}</Text>
        {onToggleFavorite && (
          <TouchableOpacity onPress={onToggleFavorite} hitSlop={6} accessibilityRole="button" accessibilityLabel={isFavorite ? 'Remove from favourites' : 'Add to favourites'}
            style={[s.btn, isFavorite && { backgroundColor: Colors.gold + '2e', borderColor: Colors.gold }]}>
            <Ionicons name={isFavorite ? 'star' : 'star-outline'} size={16} color={isFavorite ? Colors.gold : '#fff'} />
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={onClose} hitSlop={6} accessibilityRole="button" accessibilityLabel="Close" style={s.btn}>
          <Ionicons name="close" size={18} color="#fff" />
        </TouchableOpacity>
      </View>
      <Text style={{ fontFamily: MONO, fontSize: 11, color: SUB, paddingHorizontal: 14, paddingBottom: 10 }} numberOfLines={1}>{meta}</Text>

      {/* Remsan: förband · kommando */}
      <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: line }}>
        <View style={{ flex: 1.6, minWidth: 0, gap: 3, paddingVertical: 8, paddingLeft: 14, paddingRight: 10 }}>
          <Text style={s.label}>UNIT</Text>
          <ScrollBox max={TEXT_MAX} contentStyle={{ gap: 3 }}>
            {units.map((u) => <Text key={u} style={s.value}>{u}</Text>)}
          </ScrollBox>
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 3, paddingVertical: 8, paddingLeft: 10, paddingRight: 12, borderLeftWidth: 1, borderLeftColor: line }}>
          <Text style={s.label}>COMMAND</Text>
          <ScrollBox max={TEXT_MAX} contentStyle={{ gap: 3 }}>
            {commands.length ? commands.map((c) => <Text key={c} style={s.value}>{c}</Text>) : <Text style={s.value}>—</Text>}
          </ScrollBox>
        </View>
      </View>

      {/* Flygfarkosterna + Source nere till höger */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingTop: 8, paddingBottom: 12, paddingHorizontal: 14, borderTopWidth: 1, borderTopColor: line }}>
      <View style={{ flex: 1, minWidth: 0, gap: 7 }}>
        <Text style={s.label}>AIRCRAFT</Text>
        {items.length ? (
          <ScrollBox max={CHIP_MAX} contentStyle={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 5 }}>
            {items.map((it, i) => (
              <View key={`${it.type}-${i}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                accessibilityLabel={it.start ? `${ROLES[it.role].label}: ${it.type}` : it.type}>
                {it.start && <RoleTag role={it.role} />}
                {highlight?.has(typeFamily(it.type) ?? '')
                  ? <View style={[s.chip, { backgroundColor: accent }]}><Text style={[s.chipTxt, { color: '#050B16', fontWeight: '800' }]}>{it.type}</Text></View>
                  : <View style={s.chip}><Text style={s.chipTxt}>{it.type}</Text></View>}
              </View>
            ))}
          </ScrollBox>
        ) : (
          <Text style={{ fontSize: 12.5, color: SUB }}>No aircraft listed in the sources.</Text>
        )}
      </View>
      {onSource && (
        <TouchableOpacity onPress={onSource} hitSlop={10} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Where this data comes from"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 3 }}>
          <Ionicons name="information-circle-outline" size={14} color={accent} />
          <Text style={{ fontSize: 12, fontWeight: '700', color: accent }}>Source</Text>
        </TouchableOpacity>
      )}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  btn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  label: { fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1.2, color: GOLD },
  value: { fontSize: 12.5, lineHeight: LINE, fontWeight: '700', color: '#FFFFFF' },
  chip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, backgroundColor: 'rgba(255,255,255,0.08)' },
  chipTxt: { fontFamily: MONO, fontSize: 11, fontWeight: '700', color: '#FFFFFF' },
});
