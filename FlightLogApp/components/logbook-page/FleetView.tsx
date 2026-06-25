// Fleet-vy: flygna modeller, sorterade senast-flugen (nuvarande först). Responsiv grid.
import { useCallback, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Colors } from '../../constants/colors';
import { getAllAircraftTypes, addAircraftTypeToRegistry, type AircraftRegistryEntry } from '../../db/flights';
import { AircraftModal } from '../AircraftModal';
import { FONT_SERIF, FONT_MONO } from './tokens';
import { FleetCard } from './FleetCard';

export function FleetView({ accent, headerRight }: { accent: string; headerRight?: React.ReactNode }) {
  const [fleet, setFleet] = useState<AircraftRegistryEntry[]>([]);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => { getAllAircraftTypes().then(setFleet); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const sorted = [...fleet].sort((a, b) => (b.last_flown || '').localeCompare(a.last_flown || ''));
  const totalRegs = fleet.reduce((s, a) => s + (a.reg_count || 0), 0);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 14, paddingTop: 8, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: Colors.separator }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Text style={{ fontFamily: FONT_SERIF, fontSize: 26, fontWeight: '600', color: Colors.textPrimary, flex: 1 }}>Fleet</Text>
          {headerRight}
        </View>
        <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, color: Colors.textMuted, letterSpacing: 0.4, marginTop: 2 }}>
          {fleet.length} types · {totalRegs} registrations · by last flown
        </Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, paddingBottom: 28 }}>
        {sorted.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 50 }}>
            <Ionicons name="airplane-outline" size={44} color={Colors.textMuted} />
            <Text style={{ fontFamily: FONT_MONO, fontSize: 12, color: Colors.textMuted, marginTop: 10 }}>No aircraft yet</Text>
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            {sorted.map((ac, i) => (
              <FleetCard key={ac.aircraft_type} ac={ac} accent={accent} current={i === 0 && !!ac.last_flown} big onSaved={load} />
            ))}
          </View>
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
          load();
        }}
        onClose={() => setAdding(false)}
      />
    </View>
  );
}
