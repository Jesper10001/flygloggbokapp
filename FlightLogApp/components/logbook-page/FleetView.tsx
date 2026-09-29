// Fleet-vy: flygna modeller, sorterade senast-flugen (nuvarande först). Swipebar karusell (en farkost i taget).
import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { Colors } from '../../constants/colors';
import { getAllAircraftTypes, addAircraftTypeToRegistry, persistAircraftFleetLookup, type AircraftRegistryEntry } from '../../db/flights';
import { enrichAircraftFleet } from '../../services/aircraftLookup';
import { hasTokenQuota } from '../../utils/tokenGate';
import { AircraftModal } from '../AircraftModal';
import { FONT_SERIF, FONT_MONO } from './tokens';
import { FleetCard } from './FleetCard';

const PAGE_W = Dimensions.get('window').width - 28; // karusell-sidbredd (matchar tidigare fullbreddskort)

export function FleetView({ accent, headerRight }: { accent: string; headerRight?: React.ReactNode }) {
  const [fleet, setFleet] = useState<AircraftRegistryEntry[]>([]);
  const [adding, setAdding] = useState(false);
  const [pageIdx, setPageIdx] = useState(0);
  const carouselRef = useRef<ScrollView>(null);
  const scrollToKey = useRef<string | null>(null); // sätts efter add → karusellen scrollar till den nya farkosten

  const load = useCallback(() => { getAllAircraftTypes().then(setFleet); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const sorted = [...fleet].sort((a, b) => (b.last_flown || '').localeCompare(a.last_flown || ''));

  // Efter att en ny farkost lagts till (och listan laddats om): scrolla karusellen till den.
  useEffect(() => {
    const key = scrollToKey.current;
    if (!key || sorted.length < 2) return;
    const idx = sorted.findIndex((a) => a.aircraft_type === key);
    if (idx < 0) return;
    scrollToKey.current = null;
    setPageIdx(idx);
    setTimeout(() => carouselRef.current?.scrollTo({ x: idx * PAGE_W, animated: true }), 80);
  }, [sorted]);
  const totalRegs = fleet.reduce((s, a) => s + (a.reg_count || 0), 0);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 14, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: Colors.separator }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ fontFamily: FONT_SERIF, fontSize: 26, fontWeight: '600', color: Colors.textPrimary, flex: 1 }}>Fleet</Text>
          {headerRight}
        </View>
        <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, color: Colors.textMuted, letterSpacing: 0.4, marginTop: 2 }}>
          {fleet.length} types · {totalRegs} registrations
        </Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, paddingBottom: 28 }}>
        {sorted.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 50 }}>
            <Ionicons name="airplane-outline" size={44} color={Colors.textMuted} />
            <Text style={{ fontFamily: FONT_MONO, fontSize: 12, color: Colors.textMuted, marginTop: 10 }}>No aircraft yet</Text>
          </View>
        ) : sorted.length === 1 ? (
          // En enda farkost → fyll hela bredden (som förr).
          <FleetCard key={sorted[0].aircraft_type} ac={sorted[0]} accent={accent} big onSaved={load} />
        ) : (
          // Flera → swipebar karusell (en farkost i taget, senast flugen först).
          <>
            <ScrollView ref={carouselRef} horizontal pagingEnabled showsHorizontalScrollIndicator={false} decelerationRate="fast"
              onMomentumScrollEnd={(e) => setPageIdx(Math.round(e.nativeEvent.contentOffset.x / PAGE_W))}>
              {sorted.map((ac) => (
                <View key={ac.aircraft_type} style={{ width: PAGE_W }}>
                  <FleetCard ac={ac} accent={accent} onSaved={load} />
                </View>
              ))}
            </ScrollView>
            {/* Sid-indikator (aktiv = accent, längre) */}
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 12 }}>
              {sorted.map((ac, i) => (
                <View key={ac.aircraft_type} style={{ width: i === pageIdx ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: i === pageIdx ? accent : Colors.border }} />
              ))}
            </View>
          </>
        )}

        <TouchableOpacity onPress={() => setAdding(true)} activeOpacity={0.8}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14, paddingVertical: 13, borderRadius: 13, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface }}>
          <Ionicons name="add" size={18} color={accent} />
          <Text style={{ fontSize: 14, fontWeight: '700', color: accent }}>Add aircraft</Text>
        </TouchableOpacity>
      </ScrollView>

      <AircraftModal
        visible={adding}
        editMode={false}
        initialType=""
        initialSpeedKts={0}
        initialEnduranceH={0}
        initialCrewType=""
        initialCategory=""
        initialEngineType=""
        onSave={async (type, speedKts, endH, crewType, category, engineType) => {
          await addAircraftTypeToRegistry(type, speedKts, endH, crewType, category, engineType);
          setAdding(false);
          scrollToKey.current = type.trim().toUpperCase(); // navigera karusellen till den nya farkosten
          load();
          // Auto-hämta spec + bild DIREKT för manuellt tillagd farkost (token-styrt). CSV-import har sin
          // egen sekventiella hämtning efter import och påverkas inte av detta.
          const key = type.trim().toUpperCase();
          if (key && hasTokenQuota()) {
            enrichAircraftFleet(key).then((r) => persistAircraftFleetLookup(key, r)).then(load).catch(() => {});
          }
        }}
        onClose={() => setAdding(false)}
      />
    </View>
  );
}
