import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, KeyboardAvoidingView, Platform, TextInput, Modal, Pressable,
  InputAccessoryView, Keyboard,
} from 'react-native';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Location from 'expo-location';
import { useTranslation } from '../../hooks/useTranslation';
import {
  listDrones, listBatteries, insertDroneFlight, getDroneFlights,
  getDroneFlightById, updateDroneFlight,
  type DroneRegistryEntry, type DroneBattery, type DroneFlightFormData, type DroneFlightMode,
} from '../../db/drones';
import { useDroneFlightStore } from '../../store/droneFlightStore';
import { decimalToMMSS, mmssToDecimal } from '../../hooks/useTimeFormat';
import { DroneDurationInput } from '../../components/DroneDurationInput';
import { DroneCategoryPicker } from '../../components/DroneCategoryPicker';
import { usePilotTypeStore } from '../../store/pilotTypeStore';
import { useToastStore } from '../../components/Toast';
import { DR } from '../../constants/droneTheme';
import { useDroneAccentStore } from '../../store/droneAccentStore';
import { useLanguageStore } from '../../store/languageStore';

const today = new Date().toISOString().split('T')[0];

const MISSION_TYPES = ['Inspection', 'Mapping', 'Photo / Video', 'SAR', 'Training', 'Testing', 'Recreation', 'Other'];
const FLIGHT_MODES: DroneFlightMode[] = ['VLOS', 'EVLOS', 'BVLOS'];

export default function AddDroneFlightScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ id?: string }>();
  const editId = params.id ? parseInt(params.id, 10) : null;
  const isEdit = !!editId;
  const { t } = useTranslation();
  const { loadFlights, loadStats } = useDroneFlightStore();
  const pilotType = usePilotTypeStore((s) => s.pilotType);
  const accent = useDroneAccentStore((s) => s.color);
  const loadAccent = useDroneAccentStore((s) => s.load);
  const lang = useLanguageStore((s) => s.language);
  const styles = makeStyles(accent);

  const [form, setForm] = useState<DroneFlightFormData>({
    date: today,
    drone_id: null,
    location: '',
    mission_type: 'Inspection',
    category: '',
    flight_mode: 'VLOS',
    total_time: '0',
    max_altitude_m: '',
    is_night: false,
    has_observer: false,
    observer_name: '',
    battery_id: null,
    battery_start_cycles: '0',
    remarks: '',
  });

  const [drones, setDrones] = useState<DroneRegistryEntry[]>([]);
  const [batteries, setBatteries] = useState<DroneBattery[]>([]);
  const [saving, setSaving] = useState(false);
  const [showDate, setShowDate] = useState(false);
  const [showDronePicker, setShowDronePicker] = useState(false);
  const [showBatteryPicker, setShowBatteryPicker] = useState(false);
  const [passes, setPasses] = useState<string[]>(['']); // MM:SS per pass, max 5

  const passesToDecimal = (list: string[]) =>
    list.reduce((sum, p) => sum + (p && p.includes(':') ? mmssToDecimal(p) : 0), 0);

  const totalDecimal = passesToDecimal(passes);
  const totalDisplay = decimalToMMSS(totalDecimal);

  useEffect(() => {
    setForm((p) => ({ ...p, total_time: String(totalDecimal) }));
  }, [totalDecimal]);

  useEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [isEdit]);

  useEffect(() => { loadAccent(); }, [loadAccent]);

  useEffect(() => {
    (async () => {
      const ds = await listDrones();
      setDrones(ds);

      if (isEdit && editId) {
        const f = await getDroneFlightById(editId);
        if (!f) return;
        const drone = ds.find((d) => d.id === f.drone_id);
        if (drone) {
          const bats = await listBatteries(drone.id);
          setBatteries(bats);
        }
        setForm({
          date: f.date,
          drone_id: f.drone_id,
          drone_type: f.drone_type,
          registration: f.registration,
          location: f.location,
          lat: f.lat,
          lon: f.lon,
          mission_type: f.mission_type,
          category: f.category,
          flight_mode: f.flight_mode,
          total_time: String(f.total_time),
          max_altitude_m: String(f.max_altitude_m),
          is_night: !!f.is_night,
          has_observer: !!f.has_observer,
          observer_name: f.observer_name,
          battery_id: f.battery_id,
          battery_start_cycles: String(f.battery_start_cycles),
          remarks: f.remarks,
        });
        if (f.total_time > 0) setPasses([decimalToMMSS(f.total_time)]);
        return;
      }

      const last = (await getDroneFlights(1))[0];
      if (last) {
        const lastDrone = ds.find((d) => d.id === last.drone_id);
        if (lastDrone) {
          await setDrone(lastDrone);
          setForm((p) => ({
            ...p,
            location: last.location ?? '',
            mission_type: last.mission_type || p.mission_type,
            category: last.category || p.category,
            flight_mode: (last.flight_mode as DroneFlightMode) ?? p.flight_mode,
          }));
        }
      } else if (ds.length === 1) {
        await setDrone(ds[0]);
      }
    })();
  }, [isEdit, editId]);

  const setDrone = async (d: DroneRegistryEntry) => {
    setForm((p) => ({
      ...p,
      drone_id: d.id,
      drone_type: d.drone_type,
      registration: d.registration,
      category: d.category || p.category,
    }));
    const bats = await listBatteries(d.id);
    setBatteries(bats);
    if (bats.length > 0) {
      setForm((p) => ({
        ...p,
        battery_id: bats[0].id,
        battery_start_cycles: String(bats[0].cycle_count),
      }));
    }
  };

  const pickBattery = (b: DroneBattery) => {
    setForm((p) => ({ ...p, battery_id: b.id, battery_start_cycles: String(b.cycle_count) }));
    setShowBatteryPicker(false);
  };

  const useHere = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('permission_required'), 'Location permission required');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude: lat, longitude: lon } = pos.coords;
      let locName = '';
      try {
        const [geo] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
        locName = geo?.city || geo?.district || geo?.region || '';
      } catch {}
      setForm((p) => ({ ...p, lat, lon, location: locName || `${lat.toFixed(4)}, ${lon.toFixed(4)}` }));
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  const save = async () => {
    if (!form.drone_id) { Alert.alert(t('error'), t('drone_pick_required')); return; }
    if ((parseFloat(form.total_time) || 0) <= 0) { Alert.alert(t('error'), t('time_required')); return; }
    setSaving(true);
    try {
      if (isEdit && editId) {
        await updateDroneFlight(editId, form);
      } else {
        await insertDroneFlight(form);
        const bat = batteries.find((b) => b.id === form.battery_id);
        if (bat) {
          const newCycles = bat.cycle_count + 1;
          if (newCycles >= 170 && bat.cycle_count < 170) {
            useToastStore.getState().show(`⚠️ ${bat.label}: ${newCycles} ${t('cycles_high_warning')}`);
          }
        }
      }
      await Promise.all([loadFlights(), loadStats()]);
      router.back();
    } catch (e: any) {
      Alert.alert(t('error'), e.message);
    } finally {
      setSaving(false);
    }
  };

  const selectedDrone = drones.find((d) => d.id === form.drone_id);
  const selectedBattery = batteries.find((b) => b.id === form.battery_id);

  return (
    <>
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'android' ? 'height' : undefined}>
      {/* Custom serif-datum-header (speglar manned add-flight) */}
      <TouchableOpacity style={styles.droneHeader} onPress={() => setShowDate(true)} activeOpacity={0.85}>
        <TouchableOpacity style={styles.droneHeaderClose} onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="close" size={22} color={DR.text2} />
        </TouchableOpacity>
        <Text style={styles.droneHeaderDate}>
          {(() => {
            const d = form.date ? new Date(form.date + 'T12:00:00') : new Date();
            return d.toLocaleDateString(lang === 'sv' ? 'sv-SE' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' });
          })()}
        </Text>
        <Text style={styles.droneHeaderHint}>
          {lang === 'sv' ? 'TRYCK FÖR ATT ÄNDRA' : 'TAP TO CHANGE'}
        </Text>
      </TouchableOpacity>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        <Text style={styles.section}>{t('basic_info')}</Text>

        <Text style={styles.label}>{t('drone')}</Text>
        <TouchableOpacity style={styles.field} onPress={() => setShowDronePicker(true)} activeOpacity={0.7}>
          <Text style={[styles.fieldText, !selectedDrone && { color: DR.muted }]}>
            {selectedDrone
              ? `${selectedDrone.model || selectedDrone.drone_type} ${selectedDrone.registration ? '· ' + selectedDrone.registration : ''}`
              : t('select_drone')}
          </Text>
          <Ionicons name="chevron-down" size={14} color={DR.text2} />
        </TouchableOpacity>

        <Text style={styles.label}>{t('location')}</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={form.location}
            onChangeText={(v) => setForm((p) => ({ ...p, location: v }))}
            placeholder={t('location_ph')}
            placeholderTextColor={DR.muted}
          />
          <TouchableOpacity style={styles.iconBtn} onPress={useHere} activeOpacity={0.7}>
            <Ionicons name="location" size={16} color={accent} />
            <Text style={styles.iconBtnText}>{t('here')}</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.section}>{t('operation')}</Text>
        <Text style={styles.label}>{t('mission_type')}</Text>
        <View style={styles.segRow}>
          {MISSION_TYPES.map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.chip, form.mission_type === m && styles.chipActive]}
              onPress={() => setForm((p) => ({ ...p, mission_type: m }))}
            >
              <Text style={[styles.chipText, form.mission_type === m && styles.chipTextActive]}>{m}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>{t('drone_category')}</Text>
        <DroneCategoryPicker
          pilotType={pilotType}
          value={form.category}
          onChange={(v) => setForm((p) => ({ ...p, category: v as any }))}
        />

        <Text style={styles.label}>{t('flight_mode_label')}</Text>
        <View style={styles.segRow}>
          {FLIGHT_MODES.map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.chip, form.flight_mode === m && styles.chipActive]}
              onPress={() => setForm((p) => ({ ...p, flight_mode: m }))}
            >
              <Text style={[styles.chipText, form.flight_mode === m && styles.chipTextActive]}>{m}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.section}>{t('flight_time_section')}</Text>
        <View style={{ gap: 10 }}>
          {passes.map((p, idx) => (
            <View key={idx} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
              <DroneDurationInput
                label={`${t('pass')} ${idx + 1}`}
                value={p}
                onChangeText={(mmss) => setPasses((prev) => prev.map((v, i) => i === idx ? mmss : v))}
                inputAccessoryViewID="drone-add-done"
              />
              {passes.length > 1 && (
                <TouchableOpacity
                  onPress={() => setPasses((prev) => prev.filter((_, i) => i !== idx))}
                  style={{
                    width: 44, height: 44, borderRadius: 10,
                    backgroundColor: DR.danger + '14', borderWidth: 0.5, borderColor: DR.danger + '55',
                    alignItems: 'center', justifyContent: 'center', marginBottom: 0,
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="close" size={18} color={DR.danger} />
                </TouchableOpacity>
              )}
              {idx === 0 && passes.length === 1 && (
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>{t('max_altitude')}</Text>
                  <TextInput
                    style={styles.input}
                    value={form.max_altitude_m}
                    onChangeText={(v) => setForm((pp) => ({ ...pp, max_altitude_m: v.replace(/\D/g, '') }))}
                    placeholder="120"
                    keyboardType="number-pad"
                    placeholderTextColor={DR.muted}
                    inputAccessoryViewID="drone-add-done"
                  />
                </View>
              )}
            </View>
          ))}

          {/* Fet totalbar under sista passet — färgsatt efter valt tema */}
          <View style={{
            marginTop: 4,
            borderRadius: 14,
            backgroundColor: accent + '1F',
            borderWidth: 1.5,
            borderColor: accent,
            paddingHorizontal: 16,
            paddingVertical: 14,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            shadowColor: accent,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.35,
            shadowRadius: 10,
            elevation: 4,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{
                width: 28, height: 28, borderRadius: 14,
                backgroundColor: accent + '33',
                alignItems: 'center', justifyContent: 'center',
                borderWidth: 1, borderColor: accent + '88',
              }}>
                <Ionicons name="stopwatch" size={15} color={accent} />
              </View>
              <Text style={{
                color: accent,
                fontSize: 11,
                fontWeight: '900',
                letterSpacing: 2,
                textTransform: 'uppercase',
              }}>
                {t('flight_time_section')}
              </Text>
            </View>
            <Text style={{
              color: accent,
              fontSize: 26,
              fontWeight: '900',
              fontFamily: 'Menlo',
              letterSpacing: 2,
              fontVariant: ['tabular-nums'],
              textShadowColor: accent + '55',
              textShadowOffset: { width: 0, height: 0 },
              textShadowRadius: 6,
            }}>
              {totalDisplay}
            </Text>
          </View>

          {passes.length < 5 && (
            <TouchableOpacity
              onPress={() => setPasses((prev) => [...prev, ''])}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                gap: 6, paddingVertical: 10, borderRadius: 10,
                borderWidth: 1, borderColor: accent + '66', borderStyle: 'dashed',
                backgroundColor: accent + '0E',
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="add" size={16} color={accent} />
              <Text style={{ color: accent, fontSize: 13, fontWeight: '700' }}>{t('add_pass')}</Text>
            </TouchableOpacity>
          )}

          {passes.length > 1 && (
            <View>
              <Text style={styles.label}>{t('max_altitude')}</Text>
              <TextInput
                style={styles.input}
                value={form.max_altitude_m}
                onChangeText={(v) => setForm((pp) => ({ ...pp, max_altitude_m: v.replace(/\D/g, '') }))}
                placeholder="120"
                keyboardType="number-pad"
                placeholderTextColor={DR.muted}
              />
            </View>
          )}
        </View>

        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <TouchableOpacity
            style={[styles.toggle, form.is_night && styles.toggleActive]}
            onPress={() => setForm((p) => ({ ...p, is_night: !p.is_night }))}
            activeOpacity={0.7}
          >
            <Ionicons name={form.is_night ? 'moon' : 'moon-outline'} size={14} color={form.is_night ? DR.inkOnAccent : DR.text2} />
            <Text style={[styles.toggleText, form.is_night && styles.toggleTextActive]}>{t('night_flight')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.toggle, form.has_observer && styles.toggleActive]}
            onPress={() => setForm((p) => ({ ...p, has_observer: !p.has_observer }))}
            activeOpacity={0.7}
          >
            <Ionicons name={form.has_observer ? 'eye' : 'eye-outline'} size={14} color={form.has_observer ? DR.inkOnAccent : DR.text2} />
            <Text style={[styles.toggleText, form.has_observer && styles.toggleTextActive]}>{t('observer')}</Text>
          </TouchableOpacity>
        </View>

        {form.has_observer && (
          <>
            <Text style={styles.label}>{t('observer_name')}</Text>
            <TextInput
              style={styles.input}
              value={form.observer_name}
              onChangeText={(v) => setForm((p) => ({ ...p, observer_name: v }))}
              placeholder={t('name_ph')}
              placeholderTextColor={DR.muted}
            />
          </>
        )}

        {selectedDrone && batteries.length > 0 && (
          <>
            <Text style={styles.section}>{t('battery')}</Text>
            <TouchableOpacity style={styles.field} onPress={() => setShowBatteryPicker(true)} activeOpacity={0.7}>
              <Text style={styles.fieldText}>
                {selectedBattery
                  ? `${selectedBattery.label} · ${selectedBattery.cycle_count} cycles`
                  : t('select_battery')}
              </Text>
              <Ionicons name="chevron-down" size={14} color={DR.text2} />
            </TouchableOpacity>
            <Text style={styles.label}>{t('start_cycles')}</Text>
            <TextInput
              style={styles.input}
              value={form.battery_start_cycles}
              onChangeText={(v) => setForm((p) => ({ ...p, battery_start_cycles: v.replace(/\D/g, '') }))}
              keyboardType="number-pad"
              placeholderTextColor={DR.muted}
              inputAccessoryViewID="drone-add-done"
            />
          </>
        )}

        <Text style={styles.section}>{t('remarks')}</Text>
        <TextInput
          style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
          value={form.remarks}
          onChangeText={(v) => setForm((p) => ({ ...p, remarks: v }))}
          placeholder={t('notes_ph')}
          placeholderTextColor={DR.muted}
          multiline
        />
        {(() => {
          const suggestions: string[] = [];
          // Uppdragsspecifika
          if (form.mission_type === 'Inspection') suggestions.push('Object: ', 'Client: ');
          if (form.mission_type === 'Mapping') suggestions.push('Area: ', 'GSD: ');
          if (form.mission_type === 'Photo / Video') suggestions.push('Client: ');
          if (form.mission_type === 'SAR') suggestions.push('Mission: ', 'Target: ');
          if (form.mission_type === 'Training') suggestions.push('Exercise: ');
          if (form.mission_type === 'Testing') suggestions.push('Test: ');
          // Flyglägen / kategori
          if (form.flight_mode === 'BVLOS' || form.flight_mode === 'EVLOS') suggestions.push('Weather: ');
          if (form.category === 'Specific' || form.category === 'Certified') suggestions.push('OA: ');
          if (form.is_night) suggestions.push('Light: ');
          if (form.has_observer) suggestions.push('Observer role: ');
          suggestions.push('Incident: ');

          const unique = [...new Set(suggestions)].slice(0, 3);
          if (unique.length === 0) return null;
          return (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }} keyboardShouldPersistTaps="always">
              {unique.map((s) => (
                <TouchableOpacity
                  key={s}
                  style={[styles.chip, { marginRight: 6 }]}
                  onPress={() => setForm((p) => ({ ...p, remarks: p.remarks ? `${p.remarks.trimEnd()} · ${s}` : s }))}
                  activeOpacity={0.7}
                >
                  <Ionicons name="add" size={10} color={accent} style={{ marginRight: 4 }} />
                  <Text style={[styles.chipText]}>{s.trim()}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          );
        })()}

        <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving} activeOpacity={0.85}>
          <Ionicons name="checkmark-circle" size={18} color={DR.inkOnAccent} />
          <Text style={styles.saveBtnText}>{saving ? t('saving') : t('save')}</Text>
        </TouchableOpacity>
      </ScrollView>

      {showDate && Platform.OS === 'android' && (
        <DateTimePicker
          value={new Date(form.date)}
          mode="date"
          display="calendar"
          maximumDate={new Date()}
          onChange={(e, d) => {
            setShowDate(false);
            if (e.type === 'set' && d) setForm((p) => ({ ...p, date: d.toISOString().split('T')[0] }));
          }}
        />
      )}
      {Platform.OS === 'ios' && (
        <Modal visible={showDate} transparent animationType="slide">
          <Pressable style={styles.modalBackdrop} onPress={() => setShowDate(false)}>
            <Pressable style={styles.datePickerSheet} onPress={(e) => e.stopPropagation()}>
              <TouchableOpacity style={{ alignSelf: 'flex-end', padding: 12 }} onPress={() => setShowDate(false)}>
                <Text style={{ color: accent, fontWeight: '700' }}>{t('done')}</Text>
              </TouchableOpacity>
              <DateTimePicker
                value={new Date(form.date)}
                mode="date"
                display="inline"
                maximumDate={new Date()}
                themeVariant="dark"
                onChange={(_, d) => d && setForm((p) => ({ ...p, date: d.toISOString().split('T')[0] }))}
              />
            </Pressable>
          </Pressable>
        </Modal>
      )}

      <Modal visible={showDronePicker} transparent animationType="slide">
        <Pressable style={styles.modalBackdrop} onPress={() => setShowDronePicker(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.handle} />
            <Text style={styles.modalTitle}>{t('select_drone')}</Text>
            <ScrollView>
              {drones.length === 0 ? (
                <Text style={styles.emptyText}>{t('no_drones_added')}</Text>
              ) : drones.map((d) => (
                <TouchableOpacity
                  key={d.id}
                  style={styles.modalRow}
                  onPress={async () => { await setDrone(d); setShowDronePicker(false); }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="hardware-chip-outline" size={18} color={accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalRowTitle}>{d.model || d.drone_type}</Text>
                    <Text style={styles.modalRowMeta}>{d.registration} · {d.mtow_g}g · {d.category}</Text>
                  </View>
                  {form.drone_id === d.id && <Ionicons name="checkmark" size={16} color={accent} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={showBatteryPicker} transparent animationType="slide">
        <Pressable style={styles.modalBackdrop} onPress={() => setShowBatteryPicker(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.handle} />
            <Text style={styles.modalTitle}>{t('select_battery')}</Text>
            <ScrollView>
              {batteries.map((b) => (
                <TouchableOpacity
                  key={b.id}
                  style={styles.modalRow}
                  onPress={() => pickBattery(b)}
                  activeOpacity={0.7}
                >
                  <Ionicons name="battery-half-outline" size={18} color={accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalRowTitle}>{b.label}</Text>
                    <Text style={styles.modalRowMeta}>{b.serial ? b.serial + ' · ' : ''}{b.cycle_count} cycles</Text>
                  </View>
                  {form.battery_id === b.id && <Ionicons name="checkmark" size={16} color={accent} />}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </KeyboardAvoidingView>
    {Platform.OS === 'ios' && (
      <InputAccessoryView nativeID="drone-add-done">
        <View style={{
          flexDirection: 'row', justifyContent: 'flex-end',
          backgroundColor: DR.elevated,
          borderTopWidth: 0.5, borderTopColor: DR.border,
          paddingHorizontal: 14, paddingVertical: 8,
        }}>
          <TouchableOpacity onPress={() => Keyboard.dismiss()} activeOpacity={0.7}>
            <Text style={{ color: accent, fontSize: 15, fontWeight: '700' }}>{t('done')}</Text>
          </TouchableOpacity>
        </View>
      </InputAccessoryView>
    )}
    </>
  );
}

function makeStyles(accent: string) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: DR.background },
    content: { padding: 16, paddingBottom: 60, gap: 6 },
    droneHeader: {
      paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 30 : 8, paddingBottom: 10,
      backgroundColor: DR.surface, borderBottomWidth: 0.5, borderBottomColor: DR.separator,
      alignItems: 'center', justifyContent: 'flex-end', position: 'relative',
    },
    droneHeaderClose: { position: 'absolute', left: 16, bottom: 10 },
    droneHeaderDate: { fontFamily: 'Fraunces', fontSize: 22, fontWeight: '700', color: DR.text, letterSpacing: -0.5, textTransform: 'capitalize' },
    droneHeaderHint: { fontFamily: 'JetBrainsMono', fontSize: 9, fontWeight: '700', letterSpacing: 1.4, color: DR.muted, marginTop: 3 },
    section: {
      color: DR.text2, fontSize: 11, fontWeight: '700',
      textTransform: 'uppercase', letterSpacing: 1, marginTop: 12,
    },
    label: {
      color: DR.text2, fontSize: 11, fontWeight: '600',
      textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8, marginBottom: 4,
    },
    field: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: DR.surface, borderRadius: 10,
      borderWidth: 1, borderColor: DR.border,
      paddingHorizontal: 12, paddingVertical: 12,
    },
    fieldText: { color: DR.text, fontSize: 14, fontWeight: '600' },
    input: {
      backgroundColor: DR.surface, borderRadius: 10,
      borderWidth: 1, borderColor: DR.border,
      color: DR.text, fontSize: 14,
      paddingHorizontal: 12, paddingVertical: 10,
    },
    iconBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: accent + '18',
      borderRadius: 10, paddingHorizontal: 10,
      borderWidth: 1, borderColor: accent + '44',
    },
    iconBtnText: { color: accent, fontSize: 12, fontWeight: '700' },
    segRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: {
      paddingHorizontal: 10, paddingVertical: 7, borderRadius: 7,
      backgroundColor: DR.elevated, borderWidth: 1, borderColor: DR.border,
    },
    chipActive: { backgroundColor: accent, borderColor: accent },
    chipText: { color: DR.muted, fontSize: 11, fontWeight: '700' },
    chipTextActive: { color: DR.inkOnAccent },
    toggle: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      paddingVertical: 10, borderRadius: 8,
      backgroundColor: DR.elevated, borderWidth: 1, borderColor: DR.border,
    },
    toggleActive: { backgroundColor: accent, borderColor: accent },
    toggleText: { color: DR.text2, fontSize: 12, fontWeight: '600' },
    toggleTextActive: { color: DR.inkOnAccent },
    saveBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: accent, borderRadius: 12,
      paddingVertical: 15, marginTop: 20,
    },
    saveBtnText: { color: DR.inkOnAccent, fontSize: 16, fontWeight: '700' },
    modalBackdrop: { flex: 1, backgroundColor: '#000A', justifyContent: 'flex-end' },
    modalSheet: {
      backgroundColor: DR.surface, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 28,
      borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '70%',
    },
    datePickerSheet: {
      backgroundColor: DR.surface, paddingBottom: 24, paddingTop: 8,
      borderTopLeftRadius: 16, borderTopRightRadius: 16,
    },
    handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: DR.border, alignSelf: 'center', marginBottom: 10 },
    modalTitle: { color: DR.text, fontSize: 16, fontWeight: '700', marginBottom: 10 },
    modalRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingVertical: 12, paddingHorizontal: 4,
      borderTopWidth: 0.5, borderTopColor: DR.separator,
    },
    modalRowTitle: { color: DR.text, fontSize: 14, fontWeight: '700' },
    modalRowMeta: { color: DR.text2, fontSize: 12, marginTop: 2 },
    emptyText: { color: DR.muted, fontSize: 13, paddingVertical: 20, textAlign: 'center' },
  });
}
