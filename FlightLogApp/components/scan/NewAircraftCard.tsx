import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';

// Nya flygplanstyper i skanningsrapporten — samma utseende och fält som CSV-importens "Aircraft data"
// (app/import/index.tsx): marschfart, uthållighet, SP/MP, SE/ME och flygplan/helikopter. AI-förifyllda
// värden visas i cyan tills användaren ändrar dem.

export interface AircraftInput {
  speed: string;
  endurance: string;
  crew: string[];                              // 'sp' | 'mp'
  engine: 'se' | 'me' | '';
  category: 'airplane' | 'helicopter' | '';
  ai: string[];                                // fält som AI fyllt i
}

export const emptyAircraftInput = (): AircraftInput => ({ speed: '', endurance: '', crew: [], engine: '', category: '', ai: [] });

export function NewAircraftSection({ types, values, loading, failed, onChange }: {
  types: { type: string; registrations: string[]; rows: number }[];
  values: Record<string, AircraftInput>;
  loading: Set<string>;
  failed: Set<string>;
  onChange: (type: string, v: AircraftInput) => void;
}) {
  const { t } = useTranslation();
  if (types.length === 0) return null;
  const aiStyle = { borderColor: Colors.primary, color: Colors.primary, backgroundColor: Colors.primary + '14' } as const;
  const aiBtn = { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' } as const;

  return (
    <View style={s.speedSection}>
      <View style={s.speedHeader}>
        <Ionicons name="speedometer-outline" size={14} color={Colors.gold} />
        <Text style={s.speedTitle}>{t('aircraft_data')}</Text>
      </View>
      <Text style={s.speedSubtitle}>{t('aircraft_data_sub')} {t('aircraft_data_edit_later')}</Text>
      <View style={s.speedColHeader}>
        <Text style={[s.speedType, { color: Colors.textMuted, fontSize: 10 }]}>TYPE</Text>
        <Text style={[s.speedUnit, { color: Colors.textMuted, fontSize: 10, width: 80, textAlign: 'center' }]}>SPEED (kts)</Text>
        <Text style={[s.speedUnit, { color: Colors.textMuted, fontSize: 10, width: 80, textAlign: 'center' }]}>ENDUR. (h)</Text>
      </View>
      {types.map(({ type }) => {
        const v = values[type] ?? emptyAircraftInput();
        const ai = new Set(v.ai);
        const set = (patch: Partial<AircraftInput>, field: string) => onChange(type, { ...v, ...patch, ai: v.ai.filter((f) => f !== field) });
        return (
          <View key={type} style={s.typeBlock}>
            <View style={s.speedRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 }}>
                <Text style={s.speedType}>{type}</Text>
                {loading.has(type) && <ActivityIndicator size="small" color={Colors.primary} />}
                {failed.has(type) && <Ionicons name="alert-circle" size={14} color={Colors.textMuted} />}
              </View>
              <TextInput
                style={[s.speedInput, ai.has('speed') && aiStyle]}
                placeholder="110"
                placeholderTextColor={Colors.textMuted}
                keyboardType="number-pad"
                value={v.speed}
                onChangeText={(x) => set({ speed: x.replace(/\D/g, '') }, 'speed')}
                maxLength={4}
              />
              <TextInput
                style={[s.speedInput, ai.has('endurance') && aiStyle]}
                placeholder="3.0"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
                value={v.endurance}
                onChangeText={(x) => set({ endurance: x.replace(',', '.') }, 'endurance')}
                maxLength={4}
              />
            </View>
            <View style={s.crewRow}>
              {(['sp', 'mp'] as const).map((key) => {
                const active = v.crew.includes(key);
                return (
                  <TouchableOpacity key={key} style={[s.crewBtn, active && s.crewBtnActive, ai.has('crew') && active && aiBtn]} activeOpacity={0.7}
                    onPress={() => set({ crew: active ? v.crew.filter((c) => c !== key) : [...v.crew, key] }, 'crew')}>
                    <Text style={[s.crewBtnLabel, active && s.crewBtnLabelActive]}>{key === 'sp' ? 'SP' : 'MP'}</Text>
                    <Text style={s.crewBtnSub}>{key === 'sp' ? 'Single pilot' : 'Multi-pilot'}</Text>
                  </TouchableOpacity>
                );
              })}
              {(['se', 'me'] as const).map((key) => {
                const active = v.engine === key;
                return (
                  <TouchableOpacity key={key} style={[s.crewBtn, active && s.crewBtnActive, ai.has('engine') && active && aiBtn]} activeOpacity={0.7}
                    onPress={() => set({ engine: active ? '' : key }, 'engine')}>
                    <Text style={[s.crewBtnLabel, active && s.crewBtnLabelActive]}>{key === 'se' ? 'SE' : 'ME'}</Text>
                    <Text style={s.crewBtnSub}>{key === 'se' ? 'Single engine' : 'Multi engine'}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={s.crewRow}>
              {(['airplane', 'helicopter'] as const).map((cat) => {
                const active = v.category === cat;
                return (
                  <TouchableOpacity key={cat} style={[s.crewBtn, { flex: 1 }, active && s.crewBtnActive, ai.has('category') && active && aiBtn]} activeOpacity={0.7}
                    onPress={() => set({ category: active ? '' : cat }, 'category')}>
                    <Text style={[s.crewBtnLabel, active && s.crewBtnLabelActive]}>{cat === 'airplane' ? t('airplane') : t('helicopter')}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        );
      })}
    </View>
  );
}

// Samma stilar som CSV-importens "Aircraft data" (app/import/index.tsx).
const s = StyleSheet.create({
  speedSection: {
    backgroundColor: Colors.gold + '14',
    borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: Colors.gold + '55', gap: 8,
  },
  speedHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  speedTitle: { color: Colors.gold, fontSize: 12, fontWeight: '700' },
  speedSubtitle: { color: Colors.textSecondary, fontSize: 11, lineHeight: 16 },
  speedRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.card, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: Colors.border,
  },
  speedColHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 },
  speedType: { flex: 1, color: Colors.textPrimary, fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },
  speedInput: {
    width: 72, color: Colors.textPrimary, fontSize: 15, fontWeight: '700',
    fontFamily: 'Menlo', textAlign: 'center',
    backgroundColor: Colors.elevated, borderRadius: 6,
    paddingHorizontal: 6, paddingVertical: 6,
    borderWidth: 1, borderColor: Colors.border,
  },
  speedUnit: { color: Colors.textMuted, fontSize: 12, fontWeight: '600', width: 24 },
  typeBlock: { gap: 6 },
  crewRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 2 },
  crewBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.elevated,
  },
  crewBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' },
  crewBtnLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700' },
  crewBtnLabelActive: { color: Colors.primary },
  crewBtnSub: { color: Colors.textMuted, fontSize: 9, marginTop: 1 },
});
