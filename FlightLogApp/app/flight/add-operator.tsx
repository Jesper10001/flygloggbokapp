import { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { useFlightStore } from '../../store/flightStore';
import { useProfileStore, type SubRole } from '../../store/profileStore';
import { insertFlight, getRecentAircraftTypes, getRecentRegistrations } from '../../db/flights';
import { FormField } from '../../components/FormField';
import { SmartTimeInput } from '../../components/SmartTimeInput';
import * as Haptics from 'expo-haptics';

// ── Role configs ────────────────────────────────────────────────────────────

type FieldDef = {
  key: string;
  label_en: string;
  label_sv: string;
  type: 'counter' | 'text' | 'segment' | 'toggle' | 'chips' | 'number';
  options?: { key: string; label_en: string; label_sv: string }[];
  unit_en?: string;
  unit_sv?: string;
};

const ROLE_FIELDS: Record<string, FieldDef[]> = {
  'crew-chief': [
    { key: 'seat_position', label_en: 'Seat position', label_sv: 'Sittplats', type: 'segment',
      options: [
        { key: 'left', label_en: 'Left', label_sv: 'Vänster' },
        { key: 'rear', label_en: 'Rear', label_sv: 'Bak' },
        { key: 'right', label_en: 'Right', label_sv: 'Höger' },
      ]},
    { key: 'mission_type', label_en: 'Mission type', label_sv: 'Uppdragstyp', type: 'chips',
      options: [
        { key: 'SAR', label_en: 'SAR', label_sv: 'SAR' },
        { key: 'CSAR', label_en: 'CSAR', label_sv: 'CSAR' },
        { key: 'CAS', label_en: 'CAS', label_sv: 'CAS' },
        { key: 'ISTAR', label_en: 'ISTAR', label_sv: 'ISTAR' },
        { key: 'Transport', label_en: 'Transport', label_sv: 'Transport' },
        { key: 'FFO', label_en: 'Fire fighting', label_sv: 'Brandbekämpning' },
        { key: 'MEDEVAC', label_en: 'MEDEVAC', label_sv: 'MEDEVAC' },
        { key: 'Escort', label_en: 'Escort', label_sv: 'Eskort' },
        { key: 'Training', label_en: 'Training', label_sv: 'Utbildning' },
      ]},
    { key: 'equipment', label_en: 'Equipment', label_sv: 'Utrustning', type: 'chips',
      options: [
        { key: 'FLIR', label_en: 'FLIR', label_sv: 'FLIR' },
        { key: 'NVG', label_en: 'NVG', label_sv: 'NVG' },
        { key: 'Searchlight', label_en: 'Searchlight', label_sv: 'Sökljus' },
        { key: 'Sensor', label_en: 'Sensor suite', label_sv: 'Sensorsystem' },
        { key: 'Datalink', label_en: 'Datalink', label_sv: 'Datalänk' },
        { key: 'Bambi', label_en: 'Bambi bucket', label_sv: 'Brandbaljé' },
        { key: 'Hoist', label_en: 'Hoist', label_sv: 'Vinsch' },
        { key: 'Comms', label_en: 'Comms relay', label_sv: 'Komrelä' },
      ]},
    { key: 'weapon_category', label_en: 'Weapon system', label_sv: 'Vapensystem', type: 'chips',
      options: [
        { key: 'mg', label_en: 'Machine gun', label_sv: 'Kulspruta' },
        { key: 'precision', label_en: 'Precision weapon', label_sv: 'Precisionsvapen' },
        { key: 'other', label_en: 'Other', label_sv: 'Övrigt' },
        { key: 'rocket', label_en: 'Rocket / missile', label_sv: 'Raket / robot' },
      ]},
    { key: 'rounds_fired', label_en: 'Rounds fired', label_sv: 'Skott avfyrade', type: 'number' },
    { key: 'fire_bucket_drops', label_en: 'Fire bucket drops', label_sv: 'Brandbaljefällningar', type: 'counter' },
  ],
  'swimmer': [
    { key: 'mission_type', label_en: 'Mission type', label_sv: 'Uppdragstyp', type: 'chips',
      options: [
        { key: 'SAR', label_en: 'SAR', label_sv: 'SAR' },
        { key: 'CSAR', label_en: 'CSAR', label_sv: 'CSAR' },
        { key: 'Training', label_en: 'Training', label_sv: 'Träning' },
        { key: 'Exercise', label_en: 'Exercise', label_sv: 'Övning' },
      ]},
    { key: 'equipment', label_en: 'Equipment', label_sv: 'Utrustning', type: 'chips',
      options: [
        { key: 'Wetsuit', label_en: 'Wetsuit', label_sv: 'Våtdräkt' },
        { key: 'Drysuit', label_en: 'Drysuit', label_sv: 'Torrdräkt' },
        { key: 'Fins', label_en: 'Fins', label_sv: 'Fenor' },
        { key: 'Mask', label_en: 'Mask & snorkel', label_sv: 'Mask & snorkel' },
        { key: 'Harness', label_en: 'Rescue harness', label_sv: 'Räddningssele' },
        { key: 'Radio', label_en: 'Waterproof radio', label_sv: 'Vattentät radio' },
      ]},
    { key: 'deployments', label_en: 'Deployments', label_sv: 'Insatser', type: 'counter' },
    { key: 'sea_state', label_en: 'Sea state', label_sv: 'Sjöhävning', type: 'segment',
      options: [
        { key: '1', label_en: '1', label_sv: '1' },
        { key: '2', label_en: '2', label_sv: '2' },
        { key: '3', label_en: '3', label_sv: '3' },
        { key: '4', label_en: '4', label_sv: '4' },
        { key: '5', label_en: '5', label_sv: '5' },
        { key: '6', label_en: '6', label_sv: '6' },
      ]},
    { key: 'hoists_up', label_en: 'Hoists up', label_sv: 'Vinschningar upp', type: 'counter' },
    { key: 'hoists_down', label_en: 'Hoists down', label_sv: 'Vinschningar ner', type: 'counter' },
    { key: 'persons_rescued', label_en: 'Persons rescued', label_sv: 'Räddade personer', type: 'counter' },
    { key: 'night_ops', label_en: 'Night', label_sv: 'Natt', type: 'toggle' },
  ],
  'hoist': [
    { key: 'mission_type', label_en: 'Mission type', label_sv: 'Uppdragstyp', type: 'chips',
      options: [
        { key: 'SAR', label_en: 'SAR', label_sv: 'SAR' },
        { key: 'CSAR', label_en: 'CSAR', label_sv: 'CSAR' },
        { key: 'Cargo', label_en: 'Cargo', label_sv: 'Last' },
        { key: 'Training', label_en: 'Training', label_sv: 'Träning' },
        { key: 'Exercise', label_en: 'Exercise', label_sv: 'Övning' },
      ]},
    { key: 'hoists_up', label_en: 'Hoists up', label_sv: 'Vinschningar upp', type: 'counter' },
    { key: 'hoists_down', label_en: 'Hoists down', label_sv: 'Vinschningar ner', type: 'counter' },
    { key: 'load_type', label_en: 'Load type', label_sv: 'Lasttyp', type: 'chips',
      options: [
        { key: 'person', label_en: 'Person', label_sv: 'Person' },
        { key: 'stretcher', label_en: 'Stretcher', label_sv: 'Bår' },
        { key: 'equipment', label_en: 'Equipment', label_sv: 'Utrustning' },
        { key: 'cargo', label_en: 'Cargo', label_sv: 'Last' },
      ]},
    { key: 'weight_kg', label_en: 'Weight', label_sv: 'Vikt', type: 'text', unit_en: 'kg', unit_sv: 'kg' },
    { key: 'night_ops', label_en: 'Night', label_sv: 'Natt', type: 'toggle' },
  ],
  'hems': [
    { key: 'mission_type', label_en: 'Mission type', label_sv: 'Uppdragstyp', type: 'chips',
      options: [
        { key: 'primary', label_en: 'Primary', label_sv: 'Primär' },
        { key: 'secondary', label_en: 'Secondary', label_sv: 'Sekundär' },
        { key: 'iht', label_en: 'IHT', label_sv: 'IHT' },
        { key: 'sar', label_en: 'SAR', label_sv: 'SAR' },
      ]},
    { key: 'patients', label_en: 'Patients', label_sv: 'Patienter', type: 'counter' },
    { key: 'priority', label_en: 'Priority', label_sv: 'Prioritet', type: 'segment',
      options: [
        { key: 'P1', label_en: 'P1', label_sv: 'P1' },
        { key: 'P2', label_en: 'P2', label_sv: 'P2' },
        { key: 'P3', label_en: 'P3', label_sv: 'P3' },
      ]},
    { key: 'hoists', label_en: 'Hoists', label_sv: 'Vinschningar', type: 'counter' },
    { key: 'night_ops', label_en: 'Night', label_sv: 'Natt', type: 'toggle' },
  ],
  'loadmaster': [
    { key: 'mission_type', label_en: 'Mission type', label_sv: 'Uppdragstyp', type: 'chips',
      options: [
        { key: 'Cargo', label_en: 'Cargo', label_sv: 'Last' },
        { key: 'Sling', label_en: 'Sling load', label_sv: 'Hänglast' },
        { key: 'Airdrop', label_en: 'Air drop', label_sv: 'Fällning' },
        { key: 'Pax', label_en: 'Passengers', label_sv: 'Passagerare' },
        { key: 'MEDEVAC', label_en: 'MEDEVAC', label_sv: 'MEDEVAC' },
        { key: 'Training', label_en: 'Training', label_sv: 'Utbildning' },
      ]},
    { key: 'equipment', label_en: 'Equipment', label_sv: 'Utrustning', type: 'chips',
      options: [
        { key: 'Nets', label_en: 'Cargo nets', label_sv: 'Lastnät' },
        { key: 'Straps', label_en: 'Tie-down straps', label_sv: 'Surrningsband' },
        { key: 'Pallets', label_en: 'Pallets', label_sv: 'Pallar' },
        { key: 'Sling', label_en: 'Sling gear', label_sv: 'Hänglastutrustning' },
        { key: 'Chutes', label_en: 'Parachutes', label_sv: 'Fallskärmar' },
      ]},
    { key: 'cargo_weight', label_en: 'Cargo weight', label_sv: 'Lastvikt', type: 'text', unit_en: 'kg', unit_sv: 'kg' },
    { key: 'sling_ops', label_en: 'Sling operations', label_sv: 'Hänglastoperationer', type: 'counter' },
    { key: 'airdrops', label_en: 'Air drops', label_sv: 'Fällningar', type: 'counter' },
    { key: 'weapon_category', label_en: 'Weapon system', label_sv: 'Vapensystem', type: 'chips',
      options: [
        { key: 'mg', label_en: 'Machine gun', label_sv: 'Kulspruta' },
        { key: 'precision', label_en: 'Precision weapon', label_sv: 'Precisionsvapen' },
        { key: 'other', label_en: 'Other', label_sv: 'Övrigt' },
        { key: 'rocket', label_en: 'Rocket / missile', label_sv: 'Raket / robot' },
      ]},
    { key: 'rounds_fired', label_en: 'Rounds fired', label_sv: 'Skott avfyrade', type: 'number' },
    { key: 'night_ops', label_en: 'Night', label_sv: 'Natt', type: 'toggle' },
  ],
};

const ROLE_EMOJI: Record<string, string> = {
  'crew-chief': '🎖️', swimmer: '🏊', hoist: '⚓', hems: '🏥', loadmaster: '📦',
};
const ROLE_COLOR: Record<string, string> = {
  'crew-chief': Colors.gold, swimmer: Colors.info, hoist: Colors.primary, hems: Colors.danger, loadmaster: Colors.success,
};

// ── Counter widget ──────────────────────────────────────────────────────────

function Counter({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <TouchableOpacity
        style={[st.counterBtn, value <= 0 && { opacity: 0.3 }]}
        onPress={() => { if (value > 0) { Haptics.selectionAsync(); onChange(value - 1); } }}
        disabled={value <= 0}
      >
        <Ionicons name="remove" size={16} color={Colors.textPrimary} />
      </TouchableOpacity>
      <Text style={st.counterValue}>{value}</Text>
      <TouchableOpacity style={st.counterBtn} onPress={() => { Haptics.selectionAsync(); onChange(value + 1); }}>
        <Ionicons name="add" size={16} color={Colors.textPrimary} />
      </TouchableOpacity>
    </View>
  );
}

// ── Main screen ─────────────────────────────────────────────────────────────

export default function AddOperatorFlightScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { loadFlights, loadStats } = useFlightStore();
  const profile = useProfileStore(s => s.profile);
  const role = profile?.subRole ?? 'crew-chief';
  const fields = ROLE_FIELDS[role] ?? [];
  const accentColor = ROLE_COLOR[role] ?? Colors.primary;
  const emoji = ROLE_EMOJI[role] ?? '🎖️';

  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [aircraftType, setAircraftType] = useState('');
  const [flightTime, setFlightTime] = useState('');
  const [remarks, setRemarks] = useState('');
  const [data, setData] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [recentTypes, setRecentTypes] = useState<string[]>([]);

  const sv = (useTranslation() as any).i18n?.language === 'sv';

  useEffect(() => {
    getRecentAircraftTypes().then(types => {
      setRecentTypes(types);
      if (types.length > 0 && !aircraftType) setAircraftType(types[0]);
    });
  }, []);

  const setField = (key: string, value: any) => setData(prev => ({ ...prev, [key]: value }));
  const getField = (key: string, fallback: any = '') => data[key] ?? fallback;

  const handleSave = async () => {
    if (!aircraftType.trim()) { Alert.alert(t('error'), t('val_aircraft_type_required')); return; }
    if (!flightTime.trim()) { Alert.alert(t('error'), 'Flight time required'); return; }

    setSaving(true);
    try {
      const timeDecimal = flightTime.includes(':')
        ? (() => { const [h, m] = flightTime.split(':').map(Number); return h + (m || 0) / 60; })()
        : parseFloat(flightTime) || 0;

      await insertFlight({
        date,
        aircraft_type: aircraftType.trim().toUpperCase(),
        registration: '',
        dep_place: '', arr_place: '', dep_utc: '', arr_utc: '',
        total_time: String(timeDecimal),
        pic: '0', co_pilot: '0', dual: '0', ifr: '0', night: data.night_ops ? String(timeDecimal) : '0',
        landings_day: '0', landings_night: '0',
        remarks: remarks,
        flight_rules: 'VFR',
        second_pilot: '',
        nvg: '0', tng_count: '0',
        flight_type: 'normal',
        operator_data: JSON.stringify({ role, ...data }),
      } as any, { source: 'manual' });

      await Promise.all([loadFlights(), loadStats()]);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (e: any) {
      Alert.alert(t('error'), e.message);
    } finally {
      setSaving(false);
    }
  };

  const label = (f: FieldDef) => sv ? f.label_sv : f.label_en;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={{ flex: 1, backgroundColor: Colors.background }}
        contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 10 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        {/* Close button */}
        <TouchableOpacity onPress={() => router.back()} style={{ alignSelf: 'flex-start', marginBottom: 4 }} hitSlop={12}>
          <Ionicons name="close" size={24} color={Colors.textSecondary} />
        </TouchableOpacity>

        {/* Header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <Text style={{ fontSize: 28 }}>{emoji}</Text>
          <View>
            <Text style={{ color: Colors.textPrimary, fontSize: 20, fontWeight: '800', letterSpacing: -0.3 }}>
              {t(`profile_${role}` as any)}
            </Text>
            <Text style={{ color: Colors.textMuted, fontSize: 11 }}>
              {sv ? 'Ny loggning' : 'New log entry'}
            </Text>
          </View>
        </View>

        {/* Base fields */}
        <View style={st.card}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <FormField label={sv ? 'Datum' : 'Date'} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
            </View>
            <View style={{ flex: 1 }}>
              <SmartTimeInput label={sv ? 'Flygtid ombord' : 'Flight time onboard'} value={flightTime} onChangeText={setFlightTime} />
            </View>
          </View>
          <FormField label={t('aircraft_type')} value={aircraftType} onChangeText={v => setAircraftType(v.toUpperCase())} placeholder="EC135" autoCapitalize="characters" />
          {recentTypes.length > 1 && (
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {recentTypes.slice(0, 4).map(type => (
                <TouchableOpacity
                  key={type}
                  style={{
                    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6,
                    backgroundColor: aircraftType === type ? Colors.primary + '22' : Colors.elevated,
                    borderWidth: 1, borderColor: aircraftType === type ? Colors.primary : Colors.border,
                  }}
                  onPress={() => setAircraftType(type)}
                  activeOpacity={0.75}
                >
                  <Text style={{ color: aircraftType === type ? Colors.primary : Colors.textSecondary, fontSize: 12, fontWeight: '700' }}>{type}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Role-specific fields */}
        <View style={[st.card, { borderColor: accentColor + '44' }]}>
          <Text style={[st.sectionLabel, { color: accentColor }]}>
            {sv ? 'Uppdragsdata' : 'Mission data'}
          </Text>
          {fields.map(f => {
            const isGrouped = f.type === 'chips' || f.type === 'segment';
            return (
            <View key={f.key} style={isGrouped ? st.fieldGrouped : st.fieldRow}>
              <Text style={isGrouped ? st.fieldGroupLabel : st.fieldLabel}>{label(f)}</Text>

              {f.type === 'counter' && (
                <Counter value={getField(f.key, 0)} onChange={v => setField(f.key, v)} />
              )}

              {f.type === 'text' && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <TextInput
                    style={st.fieldInput}
                    value={String(getField(f.key))}
                    onChangeText={v => setField(f.key, v)}
                    placeholder="—"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType={f.unit_en ? 'number-pad' : 'default'}
                  />
                  {f.unit_en && <Text style={{ color: Colors.textMuted, fontSize: 12 }}>{sv ? f.unit_sv : f.unit_en}</Text>}
                </View>
              )}

              {f.type === 'segment' && f.options && (
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  {f.options.map(opt => {
                    const active = getField(f.key) === opt.key;
                    return (
                      <TouchableOpacity
                        key={opt.key}
                        style={[st.segBtn, active && { backgroundColor: accentColor, borderColor: accentColor }]}
                        onPress={() => { Haptics.selectionAsync(); setField(f.key, opt.key); }}
                        activeOpacity={0.75}
                      >
                        <Text style={[st.segText, active && { color: Colors.textInverse }]}>
                          {sv ? opt.label_sv : opt.label_en}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {f.type === 'chips' && f.options && (() => {
                const selected: string[] = getField(f.key, []);
                const hasCustom = selected.includes('__custom');
                return (
                  <View style={{ gap: 6 }}>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {f.options.map(opt => {
                        const active = selected.includes(opt.key);
                        return (
                          <TouchableOpacity
                            key={opt.key}
                            style={[st.chip, active && { backgroundColor: accentColor + '22', borderColor: accentColor }]}
                            onPress={() => {
                              Haptics.selectionAsync();
                              setField(f.key, active ? selected.filter(k => k !== opt.key) : [...selected, opt.key]);
                            }}
                            activeOpacity={0.75}
                          >
                            <Text style={[st.chipText, active && { color: accentColor }]}>
                              {sv ? opt.label_sv : opt.label_en}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                      <TouchableOpacity
                        style={[st.chip, hasCustom && { backgroundColor: accentColor + '22', borderColor: accentColor }]}
                        onPress={() => {
                          Haptics.selectionAsync();
                          setField(f.key, hasCustom ? selected.filter(k => k !== '__custom') : [...selected, '__custom']);
                        }}
                        activeOpacity={0.75}
                      >
                        <Text style={[st.chipText, hasCustom && { color: accentColor }]}>
                          {sv ? 'Annat...' : 'Other...'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                    {hasCustom && (
                      <TextInput
                        style={[st.fieldInput, { minWidth: 0, width: '100%', textAlign: 'left' }]}
                        value={getField(f.key + '_custom', '')}
                        onChangeText={v => setField(f.key + '_custom', v)}
                        placeholder={sv ? 'Ange...' : 'Specify...'}
                        placeholderTextColor={Colors.textMuted}
                      />
                    )}
                  </View>
                );
              })()}

              {f.type === 'toggle' && (
                <TouchableOpacity
                  style={[st.toggleBtn, getField(f.key) && { backgroundColor: accentColor, borderColor: accentColor }]}
                  onPress={() => { Haptics.selectionAsync(); setField(f.key, !getField(f.key)); }}
                  activeOpacity={0.75}
                >
                  <Text style={[st.toggleText, getField(f.key) && { color: Colors.textInverse }]}>
                    {getField(f.key) ? (sv ? 'Ja' : 'Yes') : (sv ? 'Nej' : 'No')}
                  </Text>
                </TouchableOpacity>
              )}

              {f.type === 'number' && (
                <TextInput
                  style={[st.fieldInput, { minWidth: 90 }]}
                  value={String(getField(f.key, ''))}
                  onChangeText={v => setField(f.key, v.replace(/\D/g, ''))}
                  placeholder="0"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="number-pad"
                />
              )}
            </View>
          ); })}
        </View>

        {/* Remarks */}
        <FormField
          label={t('remarks')}
          value={remarks}
          onChangeText={setRemarks}
          placeholder={sv ? 'Valfri fritext...' : 'Optional free text...'}
          multiline
          numberOfLines={2}
          style={{ minHeight: 50, textAlignVertical: 'top' }}
        />

        {/* Save */}
        <TouchableOpacity
          style={[st.saveBtn, saving && { opacity: 0.5 }]}
          onPress={handleSave}
          disabled={saving}
          activeOpacity={0.85}
        >
          <Ionicons name="checkmark-circle" size={20} color={Colors.textInverse} />
          <Text style={st.saveBtnText}>{sv ? 'Spara' : 'Save'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const st = StyleSheet.create({
  card: {
    backgroundColor: Colors.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.cardBorder, gap: 8,
  },
  sectionLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', fontFamily: 'Menlo',
  },
  fieldRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: Colors.separator,
  },
  fieldGrouped: {
    paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: Colors.separator, gap: 6,
  },
  fieldGroupLabel: {
    color: Colors.textSecondary, fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5,
  },
  fieldLabel: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600', flex: 1 },
  fieldInput: {
    backgroundColor: Colors.elevated, borderRadius: 8, borderWidth: 0.5, borderColor: Colors.border,
    color: Colors.textPrimary, fontSize: 14, fontWeight: '600', textAlign: 'center',
    paddingHorizontal: 12, paddingVertical: 8, minWidth: 80,
  },
  counterBtn: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  counterValue: {
    fontSize: 18, fontWeight: '800', color: Colors.textPrimary,
    fontFamily: 'Menlo', fontVariant: ['tabular-nums'], minWidth: 28, textAlign: 'center',
  },
  segBtn: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6,
    backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
  },
  segText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700' },
  chip: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8,
    backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
  },
  chipText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
  toggleBtn: {
    paddingHorizontal: 16, paddingVertical: 6, borderRadius: 6,
    backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
  },
  toggleText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700' },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 15, marginTop: 4,
  },
  saveBtnText: { color: Colors.textInverse, fontSize: 16, fontWeight: '700' },
});
