import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { FormField } from '../../components/FormField';
import { IcaoInput } from '../../components/IcaoInput';
import { getFlightById, updateFlight, deleteFlight } from '../../db/flights';
import { useFlightStore } from '../../store/flightStore';
import { Colors } from '../../constants/colors';
import { calcFlightTime, isValidIcao, isValidTime, formatDate } from '../../utils/format';
import type { FlightFormData, Flight } from '../../types/flight';

type Errors = Partial<Record<keyof FlightFormData, string>>;

function validate(d: FlightFormData): Errors {
  const e: Errors = {};
  if (!d.date) e.date = 'Datum krävs';
  if (!d.aircraft_type.trim()) e.aircraft_type = 'Luftfartygstyp krävs';
  if (!d.registration.trim()) e.registration = 'Registration krävs';
  if (!isValidIcao(d.dep_place)) e.dep_place = 'Ogiltig ICAO-kod';
  if (!isValidIcao(d.arr_place)) e.arr_place = 'Ogiltig ICAO-kod';
  if (!isValidTime(d.dep_utc)) e.dep_utc = 'Format: HH:MM';
  if (!isValidTime(d.arr_utc)) e.arr_utc = 'Format: HH:MM';
  const tt = parseFloat(d.total_time);
  if (isNaN(tt) || tt <= 0) e.total_time = 'Ange flygtid i decimal (t.ex. 1.5)';
  return e;
}

function flightToForm(f: Flight): FlightFormData {
  return {
    date: f.date,
    aircraft_type: f.aircraft_type,
    registration: f.registration,
    dep_place: f.dep_place,
    dep_utc: f.dep_utc,
    arr_place: f.arr_place,
    arr_utc: f.arr_utc,
    total_time: String(f.total_time),
    ifr: String(f.ifr),
    night: String(f.night),
    pic: String(f.pic),
    co_pilot: String(f.co_pilot),
    dual: String(f.dual),
    landings_day: String(f.landings_day),
    landings_night: String(f.landings_night),
    remarks: f.remarks,
  };
}

export default function FlightDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { loadFlights, loadStats } = useFlightStore();
  const [flight, setFlight] = useState<Flight | null>(null);
  const [form, setForm] = useState<FlightFormData | null>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (id) {
      getFlightById(Number(id)).then((f) => {
        if (f) {
          setFlight(f);
          setForm(flightToForm(f));
        }
      });
    }
  }, [id]);

  const set = (key: keyof FlightFormData, val: string) => {
    if (!form) return;
    const next = { ...form, [key]: val };
    if ((key === 'dep_utc' || key === 'arr_utc') && isValidTime(next.dep_utc) && isValidTime(next.arr_utc)) {
      const t = calcFlightTime(next.dep_utc, next.arr_utc);
      if (t > 0) next.total_time = String(t);
    }
    setForm(next);
    if (errors[key]) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const handleSave = async () => {
    if (!form) return;
    const e = validate(form);
    if (Object.keys(e).length > 0) { setErrors(e); return; }
    setSaving(true);
    try {
      await updateFlight(Number(id), form);
      await Promise.all([loadFlights(), loadStats()]);
      setEditing(false);
    } catch {
      Alert.alert('Fel', 'Kunde inte spara.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    Alert.alert('Ta bort', 'Är du säker?', [
      { text: 'Avbryt', style: 'cancel' },
      {
        text: 'Ta bort', style: 'destructive',
        onPress: async () => {
          await deleteFlight(Number(id));
          await Promise.all([loadFlights(), loadStats()]);
          router.back();
        },
      },
    ]);
  };

  if (!flight || !form) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">

        {/* Header */}
        <View style={styles.header}>
          <View>
            <View style={styles.routeRow}>
              <Text style={styles.icao}>{flight.dep_place}</Text>
              <Ionicons name="arrow-forward" size={16} color={Colors.textMuted} />
              <Text style={styles.icao}>{flight.arr_place}</Text>
            </View>
            <Text style={styles.meta}>{formatDate(flight.date)} · {flight.aircraft_type} {flight.registration}</Text>
          </View>
          <View style={styles.headerActions}>
            {!editing ? (
              <>
                <TouchableOpacity style={styles.iconBtn} onPress={() => setEditing(true)}>
                  <Ionicons name="pencil" size={18} color={Colors.primary} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.iconBtn} onPress={handleDelete}>
                  <Ionicons name="trash-outline" size={18} color={Colors.danger} />
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={styles.iconBtn} onPress={() => { setEditing(false); setForm(flightToForm(flight)); }}>
                <Ionicons name="close" size={20} color={Colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {editing ? (
          <>
            <Text style={styles.section}>Grundinformation</Text>
            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <FormField label="Datum" value={form.date} onChangeText={(v) => set('date', v)} error={errors.date} placeholder="YYYY-MM-DD" keyboardType="numbers-and-punctuation" />
              </View>
              <View style={{ flex: 1 }}>
                <FormField label="Luftfartygstyp" value={form.aircraft_type} onChangeText={(v) => set('aircraft_type', v.toUpperCase())} error={errors.aircraft_type} placeholder="C172" autoCapitalize="characters" />
              </View>
            </View>
            <FormField label="Registration" value={form.registration} onChangeText={(v) => set('registration', v.toUpperCase())} error={errors.registration} placeholder="SE-KXY" autoCapitalize="characters" />

            <Text style={styles.section}>Rutt</Text>
            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <IcaoInput label="Avgångsplats" value={form.dep_place} onChangeText={(v) => set('dep_place', v)} error={errors.dep_place} />
              </View>
              <View style={{ flex: 1 }}>
                <IcaoInput label="Ankomstplats" value={form.arr_place} onChangeText={(v) => set('arr_place', v)} error={errors.arr_place} />
              </View>
            </View>
            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <FormField label="Avgångstid (UTC)" value={form.dep_utc} onChangeText={(v) => set('dep_utc', v)} error={errors.dep_utc} placeholder="08:30" keyboardType="numbers-and-punctuation" maxLength={5} />
              </View>
              <View style={{ flex: 1 }}>
                <FormField label="Ankomsttid (UTC)" value={form.arr_utc} onChangeText={(v) => set('arr_utc', v)} error={errors.arr_utc} placeholder="10:00" keyboardType="numbers-and-punctuation" maxLength={5} />
              </View>
            </View>

            <Text style={styles.section}>Flygtider</Text>
            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <FormField label="Total" value={form.total_time} onChangeText={(v) => set('total_time', v)} error={errors.total_time} placeholder="1.5" keyboardType="decimal-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <FormField label="IFR" value={form.ifr} onChangeText={(v) => set('ifr', v)} placeholder="0" keyboardType="decimal-pad" />
              </View>
            </View>
            <View style={styles.row3}>
              <View style={{ flex: 1 }}>
                <FormField label="PIC" value={form.pic} onChangeText={(v) => set('pic', v)} placeholder="0" keyboardType="decimal-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <FormField label="Co-pilot" value={form.co_pilot} onChangeText={(v) => set('co_pilot', v)} placeholder="0" keyboardType="decimal-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <FormField label="Dual" value={form.dual} onChangeText={(v) => set('dual', v)} placeholder="0" keyboardType="decimal-pad" />
              </View>
            </View>
            <FormField label="Natt" value={form.night} onChangeText={(v) => set('night', v)} placeholder="0" keyboardType="decimal-pad" />

            <Text style={styles.section}>Landningar</Text>
            <View style={styles.row2}>
              <View style={{ flex: 1 }}>
                <FormField label="Dag" value={form.landings_day} onChangeText={(v) => set('landings_day', v)} placeholder="1" keyboardType="number-pad" />
              </View>
              <View style={{ flex: 1 }}>
                <FormField label="Natt" value={form.landings_night} onChangeText={(v) => set('landings_night', v)} placeholder="0" keyboardType="number-pad" />
              </View>
            </View>
            <FormField label="Anmärkningar" value={form.remarks} onChangeText={(v) => set('remarks', v)} placeholder="..." multiline numberOfLines={3} style={{ minHeight: 70, textAlignVertical: 'top' }} />

            <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={handleSave} disabled={saving}>
              {saving ? <ActivityIndicator color={Colors.textInverse} /> : (
                <>
                  <Ionicons name="checkmark-circle" size={20} color={Colors.textInverse} />
                  <Text style={styles.saveBtnText}>Spara ändringar</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        ) : (
          // Läsvy
          <>
            <View style={styles.detailGrid}>
              <Detail label="Datum" value={formatDate(flight.date)} />
              <Detail label="Luftfartygstyp" value={flight.aircraft_type} />
              <Detail label="Registration" value={flight.registration} />
              <Detail label="Avgångstid UTC" value={flight.dep_utc} />
              <Detail label="Ankomsttid UTC" value={flight.arr_utc} />
              <Detail label="Total flygtid" value={`${flight.total_time}h`} highlight />
              <Detail label="PIC" value={`${flight.pic}h`} />
              <Detail label="Co-pilot" value={`${flight.co_pilot}h`} />
              <Detail label="Dual" value={`${flight.dual}h`} />
              <Detail label="IFR" value={`${flight.ifr}h`} />
              <Detail label="Natt" value={`${flight.night}h`} />
              <Detail label="Landningar dag" value={String(flight.landings_day)} />
              <Detail label="Landningar natt" value={String(flight.landings_night)} />
            </View>
            {flight.remarks ? (
              <View style={styles.remarksCard}>
                <Text style={styles.remarksLabel}>Anmärkningar</Text>
                <Text style={styles.remarksText}>{flight.remarks}</Text>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Detail({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, highlight && { color: Colors.primaryLight }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 40, gap: 10 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  routeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  icao: { color: Colors.textPrimary, fontSize: 22, fontWeight: '800', letterSpacing: 2 },
  meta: { color: Colors.textSecondary, fontSize: 13, marginTop: 4 },
  headerActions: { flexDirection: 'row', gap: 8 },
  iconBtn: {
    width: 36, height: 36,
    borderRadius: 8,
    backgroundColor: Colors.elevated,
    alignItems: 'center',
    justifyContent: 'center',
  },

  section: {
    color: Colors.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: 12,
    marginBottom: 2,
  },
  row2: { flexDirection: 'row', gap: 10 },
  row3: { flexDirection: 'row', gap: 10 },

  detailGrid: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    overflow: 'hidden',
  },
  detail: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.separator,
  },
  detailLabel: { color: Colors.textSecondary, fontSize: 14 },
  detailValue: { color: Colors.textPrimary, fontSize: 14, fontWeight: '600' },

  remarksCard: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
  },
  remarksLabel: { color: Colors.textSecondary, fontSize: 12, marginBottom: 6 },
  remarksText: { color: Colors.textPrimary, fontSize: 14, lineHeight: 20 },

  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 15,
    marginTop: 20, gap: 8,
  },
  saveBtnText: { color: Colors.textInverse, fontSize: 17, fontWeight: '700' },
});
