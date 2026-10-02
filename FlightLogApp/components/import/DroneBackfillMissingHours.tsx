// "Backfill missing hours" (drönare) — speglar den bemannade komponenten men på drönar-fält
// och DR-tema. Tre kolumner: Imported · Current · Additional. Current är redigerbar: skriv in
// vad din riktiga loggbok visar. Justeringen lagras som en SIFFRA (settings, ej flygning) och
// adderas till drönar-totalerna (getDroneStats → dashboard/insights) utan att skapa en flygning.
import { useState, useEffect, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DR } from '../../constants/droneTheme';
import { useDroneAccentStore } from '../../store/droneAccentStore';
import { useTimeFormat, parseTimeInput, formatTimeValue } from '../../hooks/useTimeFormat';
import { useDroneFlightStore } from '../../store/droneFlightStore';
import { useTourStore } from '../../store/tourStore';
import { TourPress } from '../TourPress';
import { getDroneBackfill, setDroneBackfill, type DroneBackfillValues } from '../../db/droneBackfill';
import type { DroneFlight } from '../../db/drones';

type FieldKey = keyof DroneBackfillValues;
type Field = { key: FieldKey; label: string };
// Grupperat som drönar-stats (Total / Operation / Category) — alla fält är tid (timmar).
const GROUPS: { title: string; fields: Field[] }[] = [
  { title: 'Total', fields: [
    { key: 'total_time', label: 'Total time' },
  ] },
  { title: 'Operation', fields: [
    { key: 'vlos', label: 'VLOS' },
    { key: 'evlos', label: 'EVLOS' },
    { key: 'bvlos', label: 'BVLOS' },
    { key: 'night', label: 'Night' },
  ] },
  { title: 'Category', fields: [
    { key: 'cat_a1', label: 'A1' },
    { key: 'cat_a2', label: 'A2' },
    { key: 'cat_a3', label: 'A3' },
    { key: 'cat_specific', label: 'Specific' },
    { key: 'cat_certified', label: 'Certified' },
  ] },
];
const FIELDS: Field[] = GROUPS.flatMap((g) => g.fields);

// Summera ett drönar-fält ur flygningarna — samma logik som getDroneStats SQL.
function sumDroneField(flights: DroneFlight[], key: FieldKey): number {
  const t = (f: DroneFlight) => Number(f.total_time) || 0;
  switch (key) {
    case 'total_time':    return flights.reduce((s, f) => s + t(f), 0);
    case 'night':         return flights.reduce((s, f) => s + (f.is_night ? t(f) : 0), 0);
    case 'vlos':          return flights.reduce((s, f) => s + (f.flight_mode === 'VLOS' ? t(f) : 0), 0);
    case 'evlos':         return flights.reduce((s, f) => s + (f.flight_mode === 'EVLOS' ? t(f) : 0), 0);
    case 'bvlos':         return flights.reduce((s, f) => s + (f.flight_mode === 'BVLOS' ? t(f) : 0), 0);
    case 'cat_a1':        return flights.reduce((s, f) => s + (f.category === 'A1' ? t(f) : 0), 0);
    case 'cat_a2':        return flights.reduce((s, f) => s + (f.category === 'A2' ? t(f) : 0), 0);
    case 'cat_a3':        return flights.reduce((s, f) => s + (f.category === 'A3' ? t(f) : 0), 0);
    case 'cat_specific':  return flights.reduce((s, f) => s + (f.category === 'Specific' ? t(f) : 0), 0);
    case 'cat_certified': return flights.reduce((s, f) => s + (f.category === 'Certified' ? t(f) : 0), 0);
    default:              return 0;
  }
}

export function DroneBackfillMissingHours({ flights, onSaved }: { flights: DroneFlight[]; onSaved: () => void }) {
  const { timeFormat } = useTimeFormat();
  const accent = useDroneAccentStore((s) => s.color);
  const loadStats = useDroneFlightStore((s) => s.loadStats);
  const [open, setOpen] = useState(false);
  // Blades introduction: fäll ut automatiskt när rundturen når backfill-steget.
  const tourOpenBackfill = useTourStore((s) => s.openBackfill);
  useEffect(() => { if (tourOpenBackfill) setOpen(true); }, [tourOpenBackfill]);
  const [bf, setBf] = useState<DroneBackfillValues | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  const base = useMemo(() => {
    const o: Record<string, number> = {};
    for (const f of FIELDS) o[f.key] = sumDroneField(flights, f.key);
    return o;
  }, [flights]);
  const imported = useMemo(() => {
    const imp = flights.filter((f) => f.source !== 'manual');
    const o: Record<string, number> = {};
    for (const f of FIELDS) o[f.key] = sumDroneField(imp, f.key);
    return o;
  }, [flights]);

  const fmt = (v: number) => formatTimeValue(v, timeFormat);
  const fmtRef = (v: number) => (!v ? '—' : fmt(v));
  const parseVal = (key: FieldKey): number => {
    const raw = (vals[key] || '').trim();
    if (!raw) return 0;
    return parseTimeInput(raw, timeFormat) ?? NaN;
  };
  const committedCurrent = (key: FieldKey) => (base[key] || 0) + (bf?.[key] ?? 0);
  const seedVal = (key: FieldKey, b: DroneBackfillValues) => {
    const cur = (base[key] || 0) + (b[key] || 0);
    return !cur ? '' : fmt(cur);
  };

  useEffect(() => { getDroneBackfill().then(setBf); }, []);

  // Reseeda icke-redigerade fält när data/backfill ändras.
  useEffect(() => {
    if (!bf) return;
    setVals((prev) => {
      const o = { ...prev };
      for (const f of FIELDS) if (!dirty.has(f.key)) o[f.key] = seedVal(f.key, bf);
      return o;
    });
  }, [base, bf]); // eslint-disable-line react-hooks/exhaustive-deps

  const setDirtyKey = (key: string, on: boolean) =>
    setDirty((prev) => { const n = new Set(prev); on ? n.add(key) : n.delete(key); return n; });

  const approve = async (f: Field) => {
    if (!bf) return;
    const target = parseVal(f.key);
    if (isNaN(target)) { Alert.alert('Invalid value', `${f.label}: enter time as h:mm`); return; }
    const nv: DroneBackfillValues = { ...bf, [f.key]: Math.max(0, target - (base[f.key] || 0)) };
    try {
      await setDroneBackfill(nv);
      setBf(nv);
      setDirtyKey(f.key, false);
      setVals((p) => ({ ...p, [f.key]: seedVal(f.key, nv) }));
      await loadStats();
      onSaved();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not save');
    }
  };
  const reject = (f: Field) => {
    if (!bf) return;
    setVals((p) => ({ ...p, [f.key]: seedVal(f.key, bf) }));
    setDirtyKey(f.key, false);
  };

  const W_IMP = 54, W_CUR = 76, W_ADD = 80;

  return (
    <View style={{ backgroundColor: DR.surface, borderRadius: 12, borderWidth: 1, borderColor: DR.border, overflow: 'hidden' }}>
      <TourPress id="backfill" radius={12} />
      <TouchableOpacity onPress={() => setOpen((o) => !o)} activeOpacity={0.7}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
        <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: accent + '22', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="calculator-outline" size={18} color={accent} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: DR.text, fontSize: 14, fontWeight: '700' }}>Backfill missing hours</Text>
          <Text style={{ color: DR.muted, fontSize: 11.5, marginTop: 2 }}>Top up drone hours your logs are missing</Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={DR.muted} />
      </TouchableOpacity>

      {open && (
        <View style={{ paddingHorizontal: 14, paddingBottom: 14, borderTopWidth: 1, borderTopColor: DR.separator }}>
          <Text style={{ color: DR.text2, fontSize: 12, lineHeight: 17, marginTop: 10 }}>
            Set each field to what your real logbook shows. The added hours flow into your totals and insights — without creating a flight in your logbook.
          </Text>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, marginBottom: 2 }}>
            <View style={{ flex: 1 }} />
            <Text style={{ width: W_IMP, textAlign: 'right', color: DR.muted, fontSize: 8, fontWeight: '700', letterSpacing: 0.6 }}>IMPORTED</Text>
            <Text style={{ width: W_CUR, textAlign: 'right', color: DR.muted, fontSize: 8, fontWeight: '700', letterSpacing: 0.6 }}>CURRENT</Text>
            <Text style={{ width: W_ADD, textAlign: 'right', color: DR.muted, fontSize: 8, fontWeight: '700', letterSpacing: 0.6 }}>ADDITIONAL</Text>
          </View>

          {GROUPS.map((group) => (
            <View key={group.title}>
              <Text style={{ color: DR.muted, fontSize: 9, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 12, marginBottom: 2 }}>{group.title}</Text>
              {group.fields.map((f) => {
                const isDirty = dirty.has(f.key);
                const parsed = isDirty ? parseVal(f.key) : 0;
                const delta = isDirty && !isNaN(parsed) ? parsed - committedCurrent(f.key) : 0;
                const added = bf?.[f.key] ?? 0;
                return (
                  <View key={f.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
                    <Text style={{ flex: 1, color: DR.text2, fontSize: 13 }}>{f.label}</Text>

                    <View style={{ width: W_IMP, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
                      {isDirty ? (
                        <>
                          <TouchableOpacity onPress={() => approve(f)} hitSlop={6} activeOpacity={0.7}>
                            <Ionicons name="checkmark-circle" size={22} color={DR.success} />
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => reject(f)} hitSlop={6} activeOpacity={0.7}>
                            <Ionicons name="close-circle" size={22} color={DR.danger} />
                          </TouchableOpacity>
                        </>
                      ) : (
                        <Text style={{ color: DR.muted, fontSize: 13, fontFamily: 'Menlo' }}>{fmtRef(imported[f.key] || 0)}</Text>
                      )}
                    </View>

                    <TextInput
                      style={{ width: W_CUR, backgroundColor: DR.elevated, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 7, color: DR.text, fontSize: 14, fontWeight: '700', borderWidth: 1, borderColor: isDirty ? accent : DR.border, textAlign: 'right', fontFamily: 'Menlo' }}
                      value={vals[f.key] ?? ''}
                      onChangeText={(v) => { setVals((p) => ({ ...p, [f.key]: v })); setDirtyKey(f.key, true); }}
                      keyboardType={timeFormat === 'decimal' ? 'decimal-pad' : 'numbers-and-punctuation'}
                      placeholder={timeFormat === 'decimal' ? '0.0' : '0:00'}
                      placeholderTextColor={DR.muted}
                    />

                    <View style={{ width: W_ADD, alignItems: 'flex-end' }}>
                      {isDirty ? (
                        <Text style={{ color: delta >= 0 ? DR.success : DR.danger, fontSize: 13, fontWeight: '800', fontFamily: 'Menlo' }}>
                          {delta >= 0 ? '+ ' : '− '}{fmt(Math.abs(delta))}
                        </Text>
                      ) : (
                        <Text style={{ color: added ? accent : DR.muted, fontSize: 13, fontWeight: added ? '700' : '400', fontFamily: 'Menlo' }}>{fmtRef(added)}</Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
