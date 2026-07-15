// "Backfill missing hours" — överst i Imported data. Tre kolumner: Imported · Current · Additional.
// Current är redigerbar: skriv in vad din riktiga loggbok visar. Additional visar hur många
// timmar du lagt till ovanpå din befintliga (Current − befintligt). Vid redigering visas
// mellanskillnaden live i grönt (+) eller rött (−) med en ✓ (godkänn) och ✗ (ångra) per fält.
// Justeringen lagras som en SIFFRA (ej flight) → den adderas till dina totaler/insights/
// projektioner men skapar ingen flygning i loggboken eller tidslinjer.
import { useState, useEffect, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useTimeFormat, parseTimeInput, formatTimeValue } from '../../hooks/useTimeFormat';
import { useFlightStore } from '../../store/flightStore';
import { getBackfill, setBackfill, ZERO_BACKFILL, type BackfillValues } from '../../db/backfill';
import type { Flight } from '../../types/flight';

type FieldKey = keyof BackfillValues;
const FIELDS: { key: FieldKey; label: string; kind: 'time' | 'int' }[] = [
  { key: 'pic', label: 'PIC', kind: 'time' },
  { key: 'co_pilot', label: 'Co-pilot', kind: 'time' },
  { key: 'dual', label: 'Dual', kind: 'time' },
  { key: 'picus', label: 'PICUS', kind: 'time' },
  { key: 'instructor', label: 'Instructor', kind: 'time' },
  { key: 'ifr', label: 'IFR', kind: 'time' },
  { key: 'night', label: 'Night', kind: 'time' },
  { key: 'cross_country', label: 'Cross-country', kind: 'time' },
  { key: 'multi_pilot', label: 'Multi-pilot', kind: 'time' },
  { key: 'sim', label: 'FSTD', kind: 'time' },
  { key: 'landings_day', label: 'Landings · day', kind: 'int' },
  { key: 'landings_night', label: 'Landings · night', kind: 'int' },
];

function sumField(flights: Flight[], key: FieldKey): number {
  if (key === 'sim') return flights.filter((f) => f.flight_type === 'sim').reduce((s, f) => s + (f.total_time || 0), 0);
  return flights.reduce((s, f) => s + (Number((f as any)[key]) || 0), 0);
}

export function BackfillMissingHours({ flights, onSaved }: { flights: Flight[]; onSaved: () => void }) {
  const { timeFormat } = useTimeFormat();
  const loadStats = useFlightStore((s) => s.loadStats);
  const [open, setOpen] = useState(false);
  const [bf, setBf] = useState<BackfillValues | null>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());

  // Befintligt (alla riktiga flygningar; ev. gamla dolda [BACKFILL]-poster exkluderas under
  // migrering) och importerat (source ≠ 'manual').
  const base = useMemo(() => {
    const real = flights.filter((f) => (f as any).remarks !== '[BACKFILL]');
    const o: Record<string, number> = {};
    for (const f of FIELDS) o[f.key] = sumField(real, f.key);
    return o;
  }, [flights]);
  const imported = useMemo(() => {
    const imp = flights.filter((f) => f.source !== 'manual');
    const o: Record<string, number> = {};
    for (const f of FIELDS) o[f.key] = sumField(imp, f.key);
    return o;
  }, [flights]);

  const fmt = (v: number, kind: 'time' | 'int') => (kind === 'int' ? String(Math.round(v)) : formatTimeValue(v, timeFormat));
  const fmtRef = (v: number, kind: 'time' | 'int') => (!v ? '—' : fmt(v, kind));
  const parseVal = (key: FieldKey, kind: 'time' | 'int'): number => {
    const raw = (vals[key] || '').trim();
    if (!raw) return 0;
    if (kind === 'int') return parseInt(raw, 10) || 0;
    return parseTimeInput(raw, timeFormat) ?? NaN;
  };
  const committedCurrent = (key: FieldKey) => (base[key] || 0) + (bf?.[key] ?? 0);
  const seedVal = (key: FieldKey, kind: 'time' | 'int', b: BackfillValues) => {
    const cur = (base[key] || 0) + (b[key] || 0);
    return !cur ? '' : fmt(cur, kind);
  };

  useEffect(() => { getBackfill().then(setBf); }, []);

  // Reseeda icke-redigerade fält när data/backfill ändras (så Current följer med).
  useEffect(() => {
    if (!bf) return;
    setVals((prev) => {
      const o = { ...prev };
      for (const f of FIELDS) if (!dirty.has(f.key)) o[f.key] = seedVal(f.key, f.kind, bf);
      return o;
    });
  }, [base, bf]); // eslint-disable-line react-hooks/exhaustive-deps

  const setDirtyKey = (key: string, on: boolean) =>
    setDirty((prev) => { const n = new Set(prev); on ? n.add(key) : n.delete(key); return n; });

  const approve = async (f: { key: FieldKey; kind: 'time' | 'int'; label: string }) => {
    if (!bf) return;
    const target = parseVal(f.key, f.kind);
    if (isNaN(target)) { Alert.alert('Invalid value', `${f.label}: enter time as h:mm`); return; }
    const nv: BackfillValues = { ...bf, [f.key]: Math.max(0, target - (base[f.key] || 0)) };
    try {
      await setBackfill(nv);
      setBf(nv);
      setDirtyKey(f.key, false);
      setVals((p) => ({ ...p, [f.key]: seedVal(f.key, f.kind, nv) }));
      await loadStats();
      onSaved();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not save');
    }
  };
  const reject = (f: { key: FieldKey; kind: 'time' | 'int'; label: string }) => {
    if (!bf) return;
    setVals((p) => ({ ...p, [f.key]: seedVal(f.key, f.kind, bf) }));
    setDirtyKey(f.key, false);
  };

  const W_IMP = 62, W_CUR = 82, W_ADD = 60;

  return (
    <View style={{ backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden' }}>
      <TouchableOpacity onPress={() => setOpen((o) => !o)} activeOpacity={0.7}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
        <View style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.primary + '18', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="calculator-outline" size={18} color={Colors.primary} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: Colors.textPrimary, fontSize: 14, fontWeight: '700' }}>Backfill missing hours</Text>
          <Text style={{ color: Colors.textMuted, fontSize: 11.5, marginTop: 2 }}>Add hours or landings your import missed</Text>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textMuted} />
      </TouchableOpacity>

      {open && (
        <View style={{ paddingHorizontal: 14, paddingBottom: 14, borderTopWidth: 1, borderTopColor: Colors.separator }}>
          <Text style={{ color: Colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 10 }}>
            Set each field to what your real logbook shows. The added hours flow into your totals, insights and projections — without creating a flight in your logbook.
          </Text>

          {/* Kolumnrubriker */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, marginBottom: 2 }}>
            <View style={{ flex: 1 }} />
            <Text style={{ width: W_IMP, textAlign: 'right', color: Colors.textMuted, fontSize: 8, fontWeight: '700', letterSpacing: 0.6 }}>IMPORTED</Text>
            <Text style={{ width: W_CUR, textAlign: 'right', color: Colors.textMuted, fontSize: 8, fontWeight: '700', letterSpacing: 0.6 }}>CURRENT</Text>
            <Text style={{ width: W_ADD, textAlign: 'right', color: Colors.textMuted, fontSize: 8, fontWeight: '700', letterSpacing: 0.6 }}>ADDITIONAL</Text>
          </View>

          {FIELDS.map((f) => {
            const isDirty = dirty.has(f.key);
            const parsed = isDirty ? parseVal(f.key, f.kind) : 0;
            const delta = isDirty && !isNaN(parsed) ? parsed - committedCurrent(f.key) : 0;
            const added = bf?.[f.key] ?? 0; // committerad "additional"
            return (
              <View key={f.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
                <Text style={{ flex: 1, color: Colors.textSecondary, fontSize: 13 }}>{f.label}</Text>

                {/* Imported-slot — vid redigering visas ✓/✗ (till vänster om Current, vid Imported-läget) */}
                <View style={{ width: W_IMP, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
                  {isDirty ? (
                    <>
                      <TouchableOpacity onPress={() => approve(f)} hitSlop={6} activeOpacity={0.7}>
                        <Ionicons name="checkmark-circle" size={22} color={Colors.success} />
                      </TouchableOpacity>
                      <TouchableOpacity onPress={() => reject(f)} hitSlop={6} activeOpacity={0.7}>
                        <Ionicons name="close-circle" size={22} color={Colors.danger} />
                      </TouchableOpacity>
                    </>
                  ) : (
                    <Text style={{ color: Colors.textMuted, fontSize: 13, fontFamily: 'Menlo' }}>{fmtRef(imported[f.key] || 0, f.kind)}</Text>
                  )}
                </View>

                {/* Current — redigerbar */}
                <TextInput
                  style={{ width: W_CUR, backgroundColor: Colors.elevated, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 7, color: Colors.textPrimary, fontSize: 14, fontWeight: '700', borderWidth: 1, borderColor: isDirty ? Colors.primary : Colors.border, textAlign: 'right', fontFamily: 'Menlo' }}
                  value={vals[f.key] ?? ''}
                  onChangeText={(v) => { setVals((p) => ({ ...p, [f.key]: v })); setDirtyKey(f.key, true); }}
                  keyboardType={f.kind === 'int' ? 'number-pad' : (timeFormat === 'decimal' ? 'decimal-pad' : 'numbers-and-punctuation')}
                  placeholder={f.kind === 'int' ? '0' : (timeFormat === 'decimal' ? '0.0' : '0:00')}
                  placeholderTextColor={Colors.textMuted}
                />

                {/* Additional — committerad summa, eller live-delta (+grön / −röd) vid redigering */}
                <View style={{ width: W_ADD, alignItems: 'flex-end' }}>
                  {isDirty ? (
                    <Text style={{ color: delta >= 0 ? Colors.success : Colors.danger, fontSize: 13, fontWeight: '800', fontFamily: 'Menlo' }}>
                      {delta >= 0 ? '+ ' : '− '}{fmt(Math.abs(delta), f.kind)}
                    </Text>
                  ) : (
                    <Text style={{ color: added ? Colors.primary : Colors.textMuted, fontSize: 13, fontWeight: added ? '700' : '400', fontFamily: 'Menlo' }}>{fmtRef(added, f.kind)}</Text>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
