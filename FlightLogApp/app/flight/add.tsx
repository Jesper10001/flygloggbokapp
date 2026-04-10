import { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, KeyboardAvoidingView, Platform, ActivityIndicator,
  TextInput,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { FormField } from '../../components/FormField';
import { IcaoInput } from '../../components/IcaoInput';
import { insertFlight, getRecentAircraftTypes, getRecentRegistrations, getRecentPlaces, getFlights } from '../../db/flights';
import { useFlightStore } from '../../store/flightStore';
import { Colors } from '../../constants/colors';
import { FREE_TIER_LIMIT } from '../../constants/easa';
import { calcFlightTime, isValidTime } from '../../utils/format';
import { validateFlightForm } from '../../utils/validation';
import type { Flight, FlightFormData, ValidationIssue } from '../../types/flight';

const today = new Date().toISOString().split('T')[0];

const EMPTY: FlightFormData = {
  date: today,
  aircraft_type: '',
  registration: '',
  dep_place: '',
  dep_utc: '',
  arr_place: '',
  arr_utc: '',
  total_time: '',
  ifr: '0',
  night: '0',
  pic: '',
  co_pilot: '0',
  dual: '0',
  landings_day: '1',
  landings_night: '0',
  remarks: '',
  flight_rules: 'VFR',
  second_pilot: '',
  nvg: '0',
  tng_count: '0',
};

// ── Hjälpkomponenter ────────────────────────────────────────────────────────

function ValidationWarnings({ issues }: { issues: ValidationIssue[] }) {
  const warnings = issues.filter((i) => i.severity === 'warning');
  if (!warnings.length) return null;
  return (
    <View style={styles.warningBox}>
      <Ionicons name="warning" size={16} color={Colors.warning} />
      <View style={{ flex: 1 }}>
        {warnings.map((w, i) => (
          <Text key={i} style={styles.warningText}>{w.message}</Text>
        ))}
      </View>
    </View>
  );
}

function Counter({ label, value, onChange, min = 0 }: {
  label: string; value: string; onChange: (v: string) => void; min?: number;
}) {
  const n = parseInt(value) || 0;
  return (
    <View style={styles.counterWrap}>
      <Text style={styles.counterLabel}>{label}</Text>
      <View style={styles.counterRow}>
        <TouchableOpacity
          style={[styles.counterBtn, n <= min && styles.counterBtnDisabled]}
          onPress={() => onChange(String(Math.max(min, n - 1)))}
          disabled={n <= min}
        >
          <Ionicons name="remove" size={18} color={n <= min ? Colors.textMuted : Colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.counterValue}>{n}</Text>
        <TouchableOpacity style={styles.counterBtn} onPress={() => onChange(String(n + 1))}>
          <Ionicons name="add" size={18} color={Colors.textPrimary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function SegmentControl({ options, value, onChange }: {
  options: { label: string; value: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <View style={styles.segmentRow}>
      {options.map((opt) => (
        <TouchableOpacity
          key={opt.value}
          style={[styles.segmentBtn, value === opt.value && styles.segmentBtnActive]}
          onPress={() => onChange(opt.value)}
          activeOpacity={0.7}
        >
          <Text style={[styles.segmentText, value === opt.value && styles.segmentTextActive]}>
            {opt.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ── Huvudskärm ──────────────────────────────────────────────────────────────

export default function AddFlightScreen() {
  const router = useRouter();
  const { canAddFlight, loadFlights, loadStats, flightCount, isPremium } = useFlightStore();

  const [form, setForm] = useState<FlightFormData>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof FlightFormData, string>>>({});
  const [warnings, setWarnings] = useState<ValidationIssue[]>([]);
  const [saving, setSaving] = useState(false);

  const [role, setRole] = useState<'pic' | 'co_pilot'>('pic');
  const [depCustom, setDepCustom] = useState(false);
  const [arrCustom, setArrCustom] = useState(false);
  const [showTng, setShowTng] = useState(false);
  const [showExtras, setShowExtras] = useState(false);

  const [lastFlight, setLastFlight] = useState<Flight | null>(null);
  const [recentTypes, setRecentTypes] = useState<string[]>([]);
  const [recentRegs, setRecentRegs] = useState<string[]>([]);
  const [recentPlaces, setRecentPlaces] = useState<string[]>([]);

  useEffect(() => {
    Promise.all([
      getRecentAircraftTypes(),
      getRecentRegistrations(),
      getRecentPlaces(),
      getFlights(1),
    ]).then(([types, regs, places, flights]) => {
      setRecentTypes(types);
      setRecentRegs(regs);
      setRecentPlaces(places);
      if (flights[0]) setLastFlight(flights[0]);
    });
  }, []);

  const fillLastAircraft = () => {
    if (!lastFlight) return;
    setForm((prev) => ({
      ...prev,
      aircraft_type: lastFlight.aircraft_type,
      registration: lastFlight.registration,
    }));
    getRecentRegistrations(lastFlight.aircraft_type).then(setRecentRegs);
  };

  const onTypeSelect = useCallback(async (type: string) => {
    set('aircraft_type', type);
    const regs = await getRecentRegistrations(type);
    setRecentRegs(regs);
  }, []);

  const set = (key: keyof FlightFormData, val: string) => {
    setForm((prev) => {
      const next = { ...prev, [key]: val };
      if (key === 'dep_utc' || key === 'arr_utc') {
        const dep = key === 'dep_utc' ? val : prev.dep_utc;
        const arr = key === 'arr_utc' ? val : prev.arr_utc;
        if (isValidTime(dep) && isValidTime(arr)) {
          const t = calcFlightTime(dep, arr);
          if (t > 0) {
            next.total_time = String(t);
            if (role === 'pic') next.pic = String(t);
            else next.co_pilot = String(t);
          }
        }
      }
      if (key === 'total_time') {
        if (role === 'pic') next.pic = val;
        else next.co_pilot = val;
      }
      return next;
    });
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const handleRoleChange = (newRole: 'pic' | 'co_pilot') => {
    setRole(newRole);
    const t = form.total_time;
    setForm((prev) => ({
      ...prev,
      pic: newRole === 'pic' ? t : '0',
      co_pilot: newRole === 'co_pilot' ? t : '0',
    }));
  };

  const swapPlaces = () => {
    setForm((prev) => ({
      ...prev,
      dep_place: prev.arr_place,
      arr_place: prev.dep_place,
      dep_utc: prev.arr_utc,
      arr_utc: prev.dep_utc,
    }));
  };

  const save = async () => {
    if (!canAddFlight()) {
      Alert.alert(
        'Gränsen nådd',
        `Gratis-versionen stödjer max ${FREE_TIER_LIMIT} flygningar.`,
        [
          { text: 'Stäng', style: 'cancel' },
          { text: 'Uppgradera', onPress: () => router.push('/(tabs)/settings') },
        ]
      );
      return;
    }
    const issues = validateFlightForm(form);
    const hardErrors = issues.filter((i) => i.severity === 'error');
    if (hardErrors.length > 0) {
      const newErrors: Partial<Record<keyof FlightFormData, string>> = {};
      for (const e of hardErrors) newErrors[e.field as keyof FlightFormData] = e.message;
      setErrors(newErrors);
      return;
    }
    setWarnings(issues.filter((i) => i.severity === 'warning'));
    setSaving(true);
    try {
      await insertFlight(form, { source: 'manual' });
      await Promise.all([loadFlights(), loadStats()]);
      router.back();
    } catch {
      Alert.alert('Fel', 'Kunde inte spara flygningen. Försök igen.');
    } finally {
      setSaving(false);
    }
  };

  // Bara de 2 senaste platserna som chips
  const top2places = recentPlaces.slice(0, 2);

  // Senaste typen/reg som chips (max 3)
  const filteredTypes = form.aircraft_type
    ? recentTypes.filter((t) => t.startsWith(form.aircraft_type.toUpperCase())).slice(0, 3)
    : recentTypes.slice(0, 3);
  // Senaste typ (index 0 i recentTypes = senast flugna)
  const mostRecentType = recentTypes[0] ?? null;

  // recentRegs är redan sorterade senast-flugna först (MAX(date) DESC från DB)
  const recentTop3 = new Set(recentRegs.slice(0, 3));
  const base = form.registration
    ? recentRegs.filter((r) => r.startsWith(form.registration.toUpperCase()))
    : recentRegs;
  const pinnedRegs = base.filter((r) => recentTop3.has(r)); // de 3 senaste, i ordning
  const restRegs   = base.filter((r) => !recentTop3.has(r))
                         .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const filteredRegs = [...pinnedRegs, ...restRegs];

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {!isPremium && (
          <View style={styles.freeNotice}>
            <Ionicons name="information-circle-outline" size={14} color={Colors.gold} />
            <Text style={styles.freeNoticeText}>{flightCount}/{FREE_TIER_LIMIT} flygningar</Text>
          </View>
        )}

        <ValidationWarnings issues={warnings} />

        {/* ── Snabbfyll från senaste flygning ── */}
        {lastFlight && (
          <TouchableOpacity style={styles.lastFlightBar} onPress={fillLastAircraft} activeOpacity={0.7}>
            <Ionicons name="flash" size={14} color={Colors.primary} />
            <Text style={styles.lastFlightText}>
              Samma flygplan: <Text style={styles.lastFlightBold}>{lastFlight.aircraft_type} · {lastFlight.registration}</Text>
            </Text>
            <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
          </TouchableOpacity>
        )}

        {/* ── Grundinformation ── */}
        <Text style={styles.section}>Grundinformation</Text>

        <View style={styles.row2}>
          <View style={{ flex: 1 }}>
            <FormField
              label="Datum"
              value={form.date}
              onChangeText={(v) => set('date', v)}
              error={errors.date}
              placeholder="YYYY-MM-DD"
              keyboardType="numbers-and-punctuation"
            />
          </View>
          <View style={{ flex: 1.4 }}>
            <FormField
              label="Luftfartygstyp"
              value={form.aircraft_type}
              onChangeText={(v) => set('aircraft_type', v.toUpperCase())}
              error={errors.aircraft_type}
              placeholder="C172"
              autoCapitalize="characters"
            />
            {filteredTypes.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow} keyboardShouldPersistTaps="always">
                {filteredTypes.map((t) => {
                  const isRecent = t === mostRecentType;
                  return (
                    <TouchableOpacity key={t} style={[styles.chip, isRecent && styles.chipRecent]} onPress={() => onTypeSelect(t)}>
                      {isRecent && <Ionicons name="star" size={9} color={Colors.gold} style={{ marginRight: 3 }} />}
                      <Text style={[styles.chipText, isRecent && styles.chipRecentText]}>{t}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>

        <FormField
          label="Registration"
          value={form.registration}
          onChangeText={(v) => set('registration', v.toUpperCase())}
          error={errors.registration}
          placeholder="SE-KXY"
          autoCapitalize="characters"
        />
        {filteredRegs.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipsRow} keyboardShouldPersistTaps="always">
            {filteredRegs.map((r) => {
              const isRecent = recentTop3.has(r);
              return (
                <TouchableOpacity
                  key={r}
                  style={[styles.chip, isRecent && styles.chipRecent]}
                  onPress={() => set('registration', r)}
                >
                  {isRecent && <Ionicons name="star" size={9} color={Colors.gold} style={{ marginRight: 3 }} />}
                  <Text style={[styles.chipText, isRecent && styles.chipRecentText]}>{r}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {/* ── Rutt ── */}
        <Text style={styles.section}>Rutt (UTC)</Text>

        {/* Avgång */}
        <View style={styles.placeBlock}>
          <View style={styles.placeHeader}>
            <Text style={styles.placeLabel}>Avgång</Text>
            <TouchableOpacity style={styles.customToggle} onPress={() => { setDepCustom(!depCustom); set('dep_place', ''); }}>
              <Ionicons name={depCustom ? 'location' : 'location-outline'} size={13} color={depCustom ? Colors.primary : Colors.textMuted} />
              <Text style={[styles.customToggleText, depCustom && { color: Colors.primary }]}>
                {depCustom ? 'Tillfällig' : 'ICAO'}
              </Text>
            </TouchableOpacity>
          </View>
          <View style={styles.row2}>
            <View style={{ flex: 2 }}>
              {depCustom ? (
                <FormField label="" value={form.dep_place} onChangeText={(v) => set('dep_place', v)} placeholder="Fält/helipad-namn" />
              ) : (
                <IcaoInput label="" value={form.dep_place} onChangeText={(v) => set('dep_place', v)} error={errors.dep_place} recentPlaces={top2places} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <FormField label="Tid" value={form.dep_utc} onChangeText={(v) => set('dep_utc', v)} error={errors.dep_utc} placeholder="08:30" keyboardType="numbers-and-punctuation" maxLength={5} />
            </View>
          </View>
        </View>

        {/* Byt-knapp */}
        <TouchableOpacity style={styles.swapBtn} onPress={swapPlaces} activeOpacity={0.7}>
          <Ionicons name="swap-vertical" size={16} color={Colors.primary} />
          <Text style={styles.swapText}>Byt avgång / ankomst</Text>
        </TouchableOpacity>

        {/* Ankomst */}
        <View style={styles.placeBlock}>
          <View style={styles.placeHeader}>
            <Text style={styles.placeLabel}>Ankomst</Text>
            <TouchableOpacity style={styles.customToggle} onPress={() => { setArrCustom(!arrCustom); set('arr_place', ''); }}>
              <Ionicons name={arrCustom ? 'location' : 'location-outline'} size={13} color={arrCustom ? Colors.primary : Colors.textMuted} />
              <Text style={[styles.customToggleText, arrCustom && { color: Colors.primary }]}>
                {arrCustom ? 'Tillfällig' : 'ICAO'}
              </Text>
            </TouchableOpacity>
          </View>
          <View style={styles.row2}>
            <View style={{ flex: 2 }}>
              {arrCustom ? (
                <FormField label="" value={form.arr_place} onChangeText={(v) => set('arr_place', v)} placeholder="Fält/helipad-namn" />
              ) : (
                <IcaoInput label="" value={form.arr_place} onChangeText={(v) => set('arr_place', v)} error={errors.arr_place} recentPlaces={top2places} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <FormField label="Tid" value={form.arr_utc} onChangeText={(v) => set('arr_utc', v)} error={errors.arr_utc} placeholder="10:00" keyboardType="numbers-and-punctuation" maxLength={5} />
            </View>
          </View>
        </View>

        {/* ── Flygtid ── */}
        <Text style={styles.section}>Flygtid</Text>

        <View style={styles.card}>
          <View style={styles.row2}>
            <View style={{ flex: 1 }}>
              <FormField label="Total flygtid" value={form.total_time} onChangeText={(v) => set('total_time', v)} error={errors.total_time} placeholder="1.5 eller 1:30" keyboardType="decimal-pad" hint="Auto från tider" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardFieldLabel}>Din roll</Text>
              <SegmentControl
                options={[{ label: 'PIC', value: 'pic' }, { label: 'Co-pilot', value: 'co_pilot' }]}
                value={role}
                onChange={(v) => handleRoleChange(v as 'pic' | 'co_pilot')}
              />
            </View>
          </View>

          <Text style={styles.cardFieldLabel}>Flygregler</Text>
          <SegmentControl
            options={[{ label: 'VFR', value: 'VFR' }, { label: 'IFR', value: 'IFR' }, { label: 'Blandat', value: 'Mixed' }]}
            value={form.flight_rules ?? 'VFR'}
            onChange={(v) => set('flight_rules', v)}
          />
        </View>

        {/* ── Landningar ── */}
        <Text style={styles.section}>Landningar</Text>
        <View style={styles.card}>
          <View style={styles.counterGrid}>
            <Counter label="Dag" value={form.landings_day} onChange={(v) => set('landings_day', v)} />
            <View style={styles.counterDivider} />
            <Counter label="Natt" value={form.landings_night} onChange={(v) => set('landings_night', v)} />
          </View>
        </View>

        {/* ── Mer detaljer (expanderbart) ── */}
        <TouchableOpacity style={styles.extrasToggle} onPress={() => setShowExtras(!showExtras)} activeOpacity={0.7}>
          <Ionicons name={showExtras ? 'chevron-up' : 'chevron-down'} size={15} color={Colors.textMuted} />
          <Text style={styles.extrasToggleText}>{showExtras ? 'Dölj detaljer' : 'Fler detaljer (IFR, natt, NVG, T&G…)'}</Text>
        </TouchableOpacity>

        {showExtras && (
          <>
            <View style={styles.card}>
              <View style={styles.row3}>
                <View style={{ flex: 1 }}>
                  <FormField label="Dual" value={form.dual} onChangeText={(v) => set('dual', v)} placeholder="0" keyboardType="decimal-pad" />
                </View>
                <View style={{ flex: 1 }}>
                  <FormField label="Natt" value={form.night} onChangeText={(v) => set('night', v)} placeholder="0" keyboardType="decimal-pad" />
                </View>
                <View style={{ flex: 1 }}>
                  <FormField label="IFR-tid" value={form.ifr} onChangeText={(v) => set('ifr', v)} placeholder="0" keyboardType="decimal-pad" />
                </View>
              </View>

              <Text style={styles.cardFieldLabel}>NVG (%)</Text>
              <View style={styles.row2}>
                <TextInput style={[styles.nvgInput, { flex: 1 }]} value={form.nvg ?? '0'} onChangeText={(v) => set('nvg', v)} placeholder="0" keyboardType="decimal-pad" placeholderTextColor={Colors.textMuted} />
                <TouchableOpacity style={styles.nvgPreset} onPress={() => set('nvg', '50')}><Text style={styles.nvgPresetText}>50%</Text></TouchableOpacity>
                <TouchableOpacity style={styles.nvgPreset} onPress={() => set('nvg', '100')}><Text style={styles.nvgPresetText}>100%</Text></TouchableOpacity>
              </View>
            </View>

            {/* Touch & Go */}
            <TouchableOpacity style={styles.tngToggle} onPress={() => { setShowTng(!showTng); if (showTng) set('tng_count', '0'); }} activeOpacity={0.7}>
              <Ionicons name={showTng ? 'checkmark-circle' : 'add-circle-outline'} size={16} color={showTng ? Colors.primary : Colors.textMuted} />
              <Text style={[styles.tngToggleText, showTng && { color: Colors.primary }]}>Touch & Go / Mellanlandningar</Text>
            </TouchableOpacity>
            {showTng && (
              <View style={styles.card}>
                <Counter label="Antal Touch & Go" value={form.tng_count ?? '0'} onChange={(v) => set('tng_count', v)} />
              </View>
            )}

            <FormField label="Andrepilot / instruktör" value={form.second_pilot ?? ''} onChangeText={(v) => set('second_pilot', v)} placeholder="Namn" />
          </>
        )}

        {/* ── Anmärkningar ── */}
        <FormField
          label="Anmärkningar"
          value={form.remarks}
          onChangeText={(v) => set('remarks', v)}
          placeholder="Valfri fritext…"
          multiline
          numberOfLines={2}
          style={{ minHeight: 60, textAlignVertical: 'top' }}
        />

        {/* ── Spara ── */}
        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          onPress={save}
          disabled={saving}
          activeOpacity={0.8}
        >
          {saving ? (
            <ActivityIndicator color={Colors.textInverse} />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={20} color={Colors.textInverse} />
              <Text style={styles.saveBtnText}>Spara flygning</Text>
            </>
          )}
        </TouchableOpacity>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 40, gap: 8 },

  freeNotice: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: Colors.card, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: Colors.gold + '44',
  },
  freeNoticeText: { color: Colors.textSecondary, fontSize: 12 },

  warningBox: {
    flexDirection: 'row', gap: 8,
    backgroundColor: Colors.warning + '18',
    borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: Colors.warning + '55',
  },
  warningText: { color: Colors.warning, fontSize: 12, lineHeight: 18 },

  lastFlightBar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.primary + '14',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: Colors.primary + '33',
  },
  lastFlightText: { flex: 1, color: Colors.textSecondary, fontSize: 13 },
  lastFlightBold: { color: Colors.textPrimary, fontWeight: '700' },

  section: {
    color: Colors.textSecondary, fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1,
    marginTop: 10, marginBottom: 2,
  },

  chipsRow: { marginTop: 4, marginBottom: 2 },
  chip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.elevated, borderRadius: 20,
    paddingHorizontal: 12, paddingVertical: 5,
    marginRight: 6, borderWidth: 1, borderColor: Colors.border,
  },
  chipRecent: {
    backgroundColor: Colors.gold + '22',
    borderColor: Colors.gold + '88',
  },
  chipText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600' },
  chipRecentText: { color: Colors.gold, fontWeight: '700' },

  row2: { flexDirection: 'row', gap: 10 },
  row3: { flexDirection: 'row', gap: 10 },

  card: {
    backgroundColor: Colors.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.cardBorder, gap: 10,
  },
  cardFieldLabel: {
    color: Colors.textSecondary, fontSize: 11, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2,
  },

  placeBlock: {
    backgroundColor: Colors.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.cardBorder, gap: 8,
  },
  placeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  placeLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  customToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.elevated, borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 4,
    borderWidth: 1, borderColor: Colors.border,
  },
  customToggleText: { color: Colors.textMuted, fontSize: 11, fontWeight: '600' },

  swapBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 6,
  },
  swapText: { color: Colors.primary, fontSize: 13, fontWeight: '600' },

  segmentRow: {
    flexDirection: 'row', backgroundColor: Colors.elevated,
    borderRadius: 8, padding: 3,
    borderWidth: 1, borderColor: Colors.border,
  },
  segmentBtn: { flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 6 },
  segmentBtnActive: { backgroundColor: Colors.primary },
  segmentText: { color: Colors.textMuted, fontSize: 12, fontWeight: '600' },
  segmentTextActive: { color: Colors.textInverse },

  counterGrid: { flexDirection: 'row', alignItems: 'center' },
  counterDivider: { width: 1, height: 50, backgroundColor: Colors.separator, marginHorizontal: 8 },
  counterWrap: { flex: 1, alignItems: 'center', gap: 8 },
  counterLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600', textTransform: 'uppercase' },
  counterRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  counterBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.elevated,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  counterBtnDisabled: { opacity: 0.4 },
  counterValue: { color: Colors.textPrimary, fontSize: 24, fontWeight: '700', minWidth: 30, textAlign: 'center' },

  extrasToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 6, paddingHorizontal: 2,
  },
  extrasToggleText: { color: Colors.textMuted, fontSize: 13 },

  tngToggle: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  tngToggleText: { color: Colors.textMuted, fontSize: 13, fontWeight: '500' },

  nvgInput: {
    backgroundColor: Colors.elevated, borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: Colors.border,
    color: Colors.textPrimary, fontSize: 14, textAlign: 'center',
  },
  nvgPreset: {
    backgroundColor: Colors.elevated, borderRadius: 8,
    paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  nvgPresetText: { color: Colors.primary, fontSize: 13, fontWeight: '700' },

  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary, borderRadius: 12,
    paddingVertical: 15, marginTop: 12, gap: 8,
  },
  saveBtnText: { color: Colors.textInverse, fontSize: 17, fontWeight: '700' },
});
