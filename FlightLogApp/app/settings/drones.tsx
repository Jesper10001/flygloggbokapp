import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, TextInput, Modal, KeyboardAvoidingView, Platform, Pressable,
  InputAccessoryView, Keyboard, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import {
  listDrones, addDrone, updateDrone, deleteDrone, getDroneUsage,
  listBatteries, addBattery, updateBattery, deleteBattery,
  type DroneRegistryEntry, type DroneBattery, type DroneCategory, type DroneType,
} from '../../db/drones';
import { decimalToHHMM } from '../../hooks/useTimeFormat';
import { DroneCategoryPicker } from '../../components/DroneCategoryPicker';
import { usePilotTypeStore } from '../../store/pilotTypeStore';
import { categoryLabel } from '../../constants/droneCategories';
import * as ImagePicker from 'expo-image-picker';
import { scanDroneImage } from '../../services/droneScan';

const TYPE_OPTIONS: { value: DroneType; label: string }[] = [
  { value: 'multirotor', label: 'Multirotor' },
  { value: 'fixedwing',  label: 'Fixed wing' },
  { value: 'vtol',       label: 'VTOL' },
  { value: 'helicopter', label: 'Helicopter' },
];

// CATEGORY_OPTIONS ersatt av DroneCategoryPicker som följer pilottyp (civil/militär).

export default function DronesScreen() {
  const { t } = useTranslation();
  const styles = makeStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ editId?: string }>();
  const [drones, setDrones] = useState<DroneRegistryEntry[]>([]);
  const [usage, setUsage] = useState<Record<number, { total_time: number; flight_count: number }>>({});
  const [editing, setEditing] = useState<DroneRegistryEntry | null>(null);
  const [adding, setAdding] = useState(false);

  const load = async () => {
    setDrones(await listDrones());
    const rows = await getDroneUsage();
    const map: Record<number, { total_time: number; flight_count: number }> = {};
    for (const r of rows) map[r.drone_id] = { total_time: r.total_time ?? 0, flight_count: r.flight_count ?? 0 };
    setUsage(map);
  };
  useFocusEffect(useCallback(() => { load(); }, []));

  // Auto-öppna redigering om editId skickades som route-param
  useEffect(() => {
    if (!params.editId) return;
    const id = parseInt(params.editId, 10);
    const d = drones.find((x) => x.id === id);
    if (d) {
      setEditing(d);
      router.setParams({ editId: undefined } as any);
    }
  }, [params.editId, drones]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.subtitle}>{t('drones_subtitle')}</Text>

      {drones.map((d) => {
        const u = usage[d.id];
        const hasHours = u && u.total_time > 0;
        return (
          <TouchableOpacity key={d.id} style={styles.row} onPress={() => setEditing(d)} activeOpacity={0.75}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{d.model || d.drone_type || '—'}</Text>
              <Text style={styles.rowMeta}>
                {d.registration ? `${d.registration} · ` : ''}{d.mtow_g}g · {categoryLabel(d.category) || 'No category'}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', marginRight: 6 }}>
              <Text style={{
                color: hasHours ? Colors.primary : Colors.textMuted,
                fontSize: 16, fontWeight: '800',
                fontFamily: 'Menlo', letterSpacing: 1,
                fontVariant: ['tabular-nums'],
              }}>
                {hasHours ? `${decimalToHHMM(u.total_time)}h` : '—'}
              </Text>
              {u && u.flight_count > 0 ? (
                <Text style={{ color: Colors.textMuted, fontSize: 10, marginTop: 1 }}>
                  {u.flight_count} flt.
                </Text>
              ) : null}
            </View>
            <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
          </TouchableOpacity>
        );
      })}

      {drones.length === 0 && (
        <View style={styles.empty}>
          <Ionicons name="hardware-chip-outline" size={40} color={Colors.textMuted} />
          <Text style={styles.emptyText}>{t('drones_empty')}</Text>
        </View>
      )}

      <TouchableOpacity style={styles.addBtn} onPress={() => setAdding(true)} activeOpacity={0.8}>
        <Ionicons name="add" size={18} color={Colors.textInverse} />
        <Text style={styles.addBtnText}>{t('add_drone')}</Text>
      </TouchableOpacity>

      <DroneFormModal
        visible={adding}
        initial={null}
        onClose={() => setAdding(false)}
        onSaved={async () => { await load(); setAdding(false); }}
      />
      <DroneFormModal
        visible={!!editing}
        initial={editing}
        onClose={() => setEditing(null)}
        onSaved={async () => { await load(); setEditing(null); }}
      />
    </ScrollView>
  );
}

function DroneFormModal({
  visible, initial, onClose, onSaved,
}: {
  visible: boolean;
  initial: DroneRegistryEntry | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const styles = makeStyles();
  const pilotType = usePilotTypeStore((s) => s.pilotType);
  const [droneType, setDroneType] = useState<DroneType>('multirotor');
  const [model, setModel] = useState('');
  const [reg, setReg] = useState('');
  const [mtow, setMtow] = useState('');
  const [category, setCategory] = useState<DroneCategory>(pilotType === 'military' ? '' : 'A1');
  const [notes, setNotes] = useState('');
  const [batteries, setBatteries] = useState<DroneBattery[]>([]);
  const [scanning, setScanning] = useState(false);

  const handleScan = async (fromCamera: boolean) => {
    try {
      let result;
      if (fromCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          Alert.alert(t('permission_required'), t('camera_permission'));
          return;
        }
        result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'] as any, quality: 0.85 });
      } else {
        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] as any, quality: 0.85 });
      }
      if (result.canceled || !result.assets[0]) return;
      setScanning(true);
      const scan = await scanDroneImage(result.assets[0].uri);

      if (scan.needs_manual || !scan.model) {
        Alert.alert(
          t('drone_scan_unclear_title'),
          scan.notes || t('drone_scan_unclear_body'),
        );
        return;
      }

      const msg = `${scan.manufacturer} ${scan.model}`
        + (scan.suggested_mtow_g ? ` · ${scan.suggested_mtow_g} g` : '')
        + `\n${t('drone_scan_confidence')}: ${Math.round(scan.confidence * 100)}%`
        + (scan.evidence ? `\n${scan.evidence}` : '');

      Alert.alert(
        t('drone_scan_result_title'),
        msg,
        [
          { text: t('cancel'), style: 'cancel' },
          {
            text: t('drone_scan_apply'),
            onPress: () => {
              setModel(`${scan.manufacturer} ${scan.model}`.trim());
              if (scan.drone_type) setDroneType(scan.drone_type);
              if (scan.suggested_mtow_g > 0) setMtow(String(scan.suggested_mtow_g));
              const suggested = pilotType === 'military'
                ? scan.suggested_category_military
                : scan.suggested_category_civil;
              if (suggested) setCategory(suggested as DroneCategory);
            },
          },
        ],
      );
    } catch (e: any) {
      Alert.alert(t('error'), e.message || String(e));
    } finally {
      setScanning(false);
    }
  };

  useEffect(() => {
    if (!visible) return;
    if (initial) {
      setDroneType(initial.drone_type || 'multirotor');
      setModel(initial.model);
      setReg(initial.registration);
      setMtow(String(initial.mtow_g || ''));
      setCategory(initial.category || (pilotType === 'military' ? '' : 'A1'));
      setNotes(initial.notes);
      listBatteries(initial.id).then(setBatteries);
    } else {
      setDroneType('multirotor');
      setModel('');
      setReg('');
      setMtow('');
      setCategory(pilotType === 'military' ? '' : 'A1');
      setNotes('');
      setBatteries([]);
    }
  }, [visible, initial?.id]);

  const save = async () => {
    const data = {
      drone_type: droneType,
      model: model.trim(),
      registration: reg.trim(),
      mtow_g: parseInt(mtow, 10) || 0,
      category,
      notes: notes.trim(),
    };
    if (!data.model && !data.registration) {
      Alert.alert(t('error'), t('drone_name_required'));
      return;
    }
    if (initial) await updateDrone(initial.id, data);
    else await addDrone(data, 2);
    onSaved();
  };

  const onDelete = () => {
    if (!initial) return;
    Alert.alert(t('delete'), `${initial.model || initial.registration}?`, [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: async () => { await deleteDrone(initial.id); onSaved(); } },
    ]);
  };

  const addBat = async () => {
    if (!initial) return;
    const idx = batteries.length + 1;
    await addBattery(initial.id, `Battery #${idx}`);
    setBatteries(await listBatteries(initial.id));
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>{initial ? t('edit_drone') : t('add_drone')}</Text>

          <ScrollView style={{ maxHeight: '75%' }} keyboardShouldPersistTaps="handled">
            {!initial && (
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                <TouchableOpacity
                  style={{
                    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                    paddingVertical: 12, borderRadius: 10,
                    backgroundColor: Colors.primary + '1F', borderWidth: 1, borderColor: Colors.primary + '88',
                  }}
                  disabled={scanning}
                  onPress={() => handleScan(true)}
                  activeOpacity={0.75}
                >
                  {scanning
                    ? <ActivityIndicator size="small" color={Colors.primary} />
                    : <Ionicons name="camera" size={16} color={Colors.primary} />}
                  <Text style={{ color: Colors.primary, fontSize: 13, fontWeight: '800' }}>
                    {scanning ? t('drone_scan_loading') : t('drone_scan_camera')}
                  </Text>
                  <View style={{
                    backgroundColor: Colors.gold + '22', borderRadius: 4,
                    paddingHorizontal: 4, paddingVertical: 1,
                    borderWidth: 0.5, borderColor: Colors.gold + '66',
                  }}>
                    <Text style={{ color: Colors.gold, fontSize: 7, fontWeight: '800' }}>★</Text>
                  </View>
                </TouchableOpacity>
                <TouchableOpacity
                  style={{
                    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                    paddingVertical: 12, borderRadius: 10,
                    backgroundColor: Colors.elevated, borderWidth: 0.5, borderColor: Colors.border,
                  }}
                  disabled={scanning}
                  onPress={() => handleScan(false)}
                  activeOpacity={0.75}
                >
                  <Ionicons name="image-outline" size={16} color={Colors.textSecondary} />
                  <Text style={{ color: Colors.textSecondary, fontSize: 13, fontWeight: '700' }}>
                    {t('drone_scan_library')}
                  </Text>
                  <View style={{
                    backgroundColor: Colors.gold + '22', borderRadius: 4,
                    paddingHorizontal: 4, paddingVertical: 1,
                    borderWidth: 0.5, borderColor: Colors.gold + '66',
                  }}>
                    <Text style={{ color: Colors.gold, fontSize: 7, fontWeight: '800' }}>★</Text>
                  </View>
                </TouchableOpacity>
              </View>
            )}

            <Text style={styles.label}>{t('drone_model')}</Text>
            <TextInput style={styles.input} value={model} onChangeText={setModel} placeholder="DJI Mavic 3" placeholderTextColor={Colors.textMuted} />

            <Text style={styles.label}>{t('drone_reg')}</Text>
            <TextInput
              style={styles.input}
              value={reg}
              onChangeText={(v) => setReg(v.toUpperCase())}
              placeholder="SE-DRÖ-XXX"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="characters"
            />

            <Text style={styles.label}>{t('drone_mtow')}</Text>
            <TextInput
              style={styles.input}
              value={mtow}
              onChangeText={(v) => setMtow(v.replace(/\D/g, ''))}
              placeholder="899"
              placeholderTextColor={Colors.textMuted}
              keyboardType="number-pad"
              returnKeyType="done"
              inputAccessoryViewID="mtow-done"
            />

            <Text style={styles.label}>{t('drone_type')}</Text>
            <View style={styles.segRow}>
              {TYPE_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  style={[styles.segBtn, droneType === opt.value && styles.segBtnActive]}
                  onPress={() => setDroneType(opt.value)}
                >
                  <Text style={[styles.segText, droneType === opt.value && styles.segTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.label}>{t('drone_category')}</Text>
            <DroneCategoryPicker
              pilotType={pilotType}
              value={category}
              onChange={(v) => setCategory(v as DroneCategory)}
            />

            <Text style={styles.label}>{t('notes')}</Text>
            <TextInput
              style={[styles.input, { minHeight: 60, textAlignVertical: 'top' }]}
              value={notes}
              onChangeText={setNotes}
              placeholder=""
              placeholderTextColor={Colors.textMuted}
              multiline
            />

            {initial && (
              <>
                <Text style={[styles.label, { marginTop: 16 }]}>{t('batteries')}</Text>
                {batteries.map((b) => (
                  <BatteryRow
                    key={b.id}
                    battery={b}
                    onChange={async (label, serial, cycles) => {
                      await updateBattery(b.id, label, serial, cycles);
                      setBatteries(await listBatteries(initial.id));
                    }}
                    onDelete={async () => {
                      Alert.alert(t('delete'), b.label, [
                        { text: t('cancel'), style: 'cancel' },
                        { text: t('delete'), style: 'destructive', onPress: async () => {
                          await deleteBattery(b.id);
                          setBatteries(await listBatteries(initial.id));
                        } },
                      ]);
                    }}
                  />
                ))}
                <TouchableOpacity style={styles.secondaryBtn} onPress={addBat} activeOpacity={0.8}>
                  <Ionicons name="add-circle-outline" size={16} color={Colors.primary} />
                  <Text style={styles.secondaryBtnText}>{t('add_battery')}</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            {initial && (
              <TouchableOpacity style={styles.dangerBtn} onPress={onDelete} activeOpacity={0.8}>
                <Ionicons name="trash-outline" size={15} color={Colors.danger} />
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.saveBtn} onPress={save} activeOpacity={0.85}>
              <Ionicons name="checkmark-circle" size={16} color={Colors.textInverse} />
              <Text style={styles.saveBtnText}>{t('save')}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </KeyboardAvoidingView>
      {Platform.OS === 'ios' && (
        <InputAccessoryView nativeID="mtow-done">
          <View style={{
            flexDirection: 'row', justifyContent: 'flex-end',
            backgroundColor: Colors.elevated,
            borderTopWidth: 0.5, borderTopColor: Colors.border,
            paddingHorizontal: 14, paddingVertical: 8,
          }}>
            <TouchableOpacity onPress={() => Keyboard.dismiss()} activeOpacity={0.7}>
              <Text style={{ color: Colors.primary, fontSize: 15, fontWeight: '700' }}>{t('done')}</Text>
            </TouchableOpacity>
          </View>
        </InputAccessoryView>
      )}
    </Modal>
  );
}

function BatteryRow({ battery, onChange, onDelete }: {
  battery: DroneBattery;
  onChange: (label: string, serial: string, cycles: number) => Promise<void>;
  onDelete: () => void;
}) {
  const styles = makeStyles();
  const [label, setLabel] = useState(battery.label);
  const [serial, setSerial] = useState(battery.serial);
  const [cycles, setCycles] = useState(String(battery.cycle_count));

  const commit = () => onChange(label, serial, parseInt(cycles, 10) || 0);

  return (
    <View style={styles.batteryRow}>
      <View style={{ flex: 1, gap: 4 }}>
        <TextInput style={styles.inputSm} value={label} onChangeText={setLabel} onBlur={commit} placeholderTextColor={Colors.textMuted} />
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <TextInput
            style={[styles.inputSm, { flex: 1 }]}
            value={serial}
            onChangeText={setSerial}
            onBlur={commit}
            placeholder="Serial #"
            placeholderTextColor={Colors.textMuted}
          />
          <TextInput
            style={[styles.inputSm, { width: 60 }]}
            value={cycles}
            onChangeText={(v) => setCycles(v.replace(/\D/g, ''))}
            onBlur={commit}
            placeholder="0"
            placeholderTextColor={Colors.textMuted}
            keyboardType="number-pad"
          />
        </View>
      </View>
      <TouchableOpacity onPress={onDelete} style={{ padding: 6 }}>
        <Ionicons name="trash-outline" size={16} color={Colors.danger} />
      </TouchableOpacity>
    </View>
  );
}

function makeStyles() {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    content: { padding: 16, paddingBottom: 60, gap: 10 },
    subtitle: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
    row: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: Colors.card, borderRadius: 10, padding: 12,
      borderWidth: 1, borderColor: Colors.cardBorder, gap: 8,
    },
    rowTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
    rowMeta: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
    empty: { alignItems: 'center', gap: 8, paddingVertical: 24 },
    emptyText: { color: Colors.textMuted, fontSize: 13 },
    addBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 12, gap: 6,
    },
    addBtnText: { color: Colors.textInverse, fontSize: 15, fontWeight: '700' },

    modalBackdrop: { flex: 1, backgroundColor: '#000A', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: Colors.card, borderTopLeftRadius: 16, borderTopRightRadius: 16,
      padding: 20, paddingBottom: 32, borderWidth: 1, borderColor: Colors.border,
    },
    handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 10 },
    sheetTitle: { color: Colors.textPrimary, fontSize: 18, fontWeight: '800', marginBottom: 8 },
    label: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', marginTop: 10, marginBottom: 4 },
    input: {
      backgroundColor: Colors.elevated, borderRadius: 8,
      borderWidth: 1, borderColor: Colors.border,
      color: Colors.textPrimary, fontSize: 14, paddingHorizontal: 10, paddingVertical: 9,
    },
    inputSm: {
      backgroundColor: Colors.elevated, borderRadius: 7,
      borderWidth: 0.5, borderColor: Colors.border,
      color: Colors.textPrimary, fontSize: 13, paddingHorizontal: 8, paddingVertical: 6,
    },
    segRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    segBtn: {
      paddingHorizontal: 10, paddingVertical: 7, borderRadius: 7,
      backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
    },
    segBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
    segText: { color: Colors.textMuted, fontSize: 11, fontWeight: '700' },
    segTextActive: { color: Colors.textInverse },

    batteryRow: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      marginTop: 6,
    },
    secondaryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      paddingVertical: 10, borderRadius: 8, marginTop: 8,
      backgroundColor: Colors.primary + '14',
      borderWidth: 1, borderColor: Colors.primary + '44',
    },
    secondaryBtnText: { color: Colors.primary, fontSize: 13, fontWeight: '700' },

    saveBtn: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      paddingVertical: 12, borderRadius: 10, backgroundColor: Colors.primary,
    },
    saveBtnText: { color: Colors.textInverse, fontSize: 14, fontWeight: '700' },
    dangerBtn: {
      paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center',
      borderRadius: 10, backgroundColor: Colors.danger + '18',
      borderWidth: 1, borderColor: Colors.danger + '44',
    },
  });
}
