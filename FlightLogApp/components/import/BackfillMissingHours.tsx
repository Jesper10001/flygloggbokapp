// "Backfill missing hours" — överst i Imported data. Låter piloten fylla i saknade
// timmar/landningar per fält som en LUMP SUM (oberoende av total flygtid), och se sin
// Imported- och Current-data samtidigt — samma återkoppling som i bokens Opening balance.
// Current är redigerbar: skriv in vad din riktiga loggbok visar → appen lägger till
// mellanskillnaden (mål − befintligt) som en dold justering. Påverkar inte total flygtid.
import { useState, useEffect, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useTimeFormat, parseTimeInput, formatTimeValue } from '../../hooks/useTimeFormat';
import { useFlightStore } from '../../store/flightStore';
import { getBackfill, setBackfill, ZERO_BACKFILL, BF_MARKER, type BackfillValues } from '../../db/backfill';
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
  const [edited, setEdited] = useState(false);
  const [saving, setSaving] = useState(false);

  // Befintligt per fält (exkl. dolda backfill-poster) och importerat (source ≠ 'manual').
  const base = useMemo(() => {
    const nonBf = flights.filter((f) => f.remarks !== BF_MARKER);
    const o: Record<string, number> = {};
    for (const f of FIELDS) o[f.key] = sumField(nonBf, f.key);
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

  // Seed Current = befintligt + backfill (såvida användaren inte redigerar just nu).
  useEffect(() => {
    if (edited) return;
    let alive = true;
    (async () => {
      const b = bf ?? (await getBackfill());
      if (!alive) return;
      if (!bf) setBf(b);
      const o: Record<string, string> = {};
      for (const f of FIELDS) {
        const cur = (base[f.key] || 0) + (b[f.key] || 0);
        o[f.key] = !cur ? '' : fmt(cur, f.kind);
      }
      setVals(o);
    })();
    return () => { alive = false; };
  }, [flights, edited]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    const nv: BackfillValues = { ...ZERO_BACKFILL };
    for (const f of FIELDS) {
      const raw = (vals[f.key] || '').trim();
      let target = 0;
      if (raw) {
        if (f.kind === 'int') target = parseInt(raw, 10) || 0;
        else {
          const n = parseTimeInput(raw, timeFormat);
          if (n === null) { Alert.alert('Invalid value', `${f.label}: enter time as h:mm`); return; }
          target = n;
        }
      }
      // Lump sum som läggs till = mål (din riktiga loggbok) − befintligt. Aldrig negativt.
      nv[f.key] = Math.max(0, target - (base[f.key] || 0));
    }
    try {
      setSaving(true);
      await setBackfill(nv);
      setBf(nv);
      setEdited(false);
      await loadStats();
      onSaved();
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Could not save');
    } finally {
      setSaving(false);
    }
  };

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
            Set each field to what your real logbook shows. Only that field changes — total flight time is never affected.
          </Text>

          {/* Kolumnrubriker */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, marginBottom: 2 }}>
            <View style={{ flex: 1 }} />
            <Text style={{ width: 68, textAlign: 'right', color: Colors.textMuted, fontSize: 8, fontWeight: '700', letterSpacing: 0.6 }}>IMPORTED</Text>
            <Text style={{ width: 92, textAlign: 'right', color: Colors.textMuted, fontSize: 8, fontWeight: '700', letterSpacing: 0.6 }}>CURRENT</Text>
          </View>

          {FIELDS.map((f) => (
            <View key={f.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}>
              <Text style={{ flex: 1, color: Colors.textSecondary, fontSize: 13 }}>{f.label}</Text>
              <Text style={{ width: 68, textAlign: 'right', color: Colors.textMuted, fontSize: 13, fontFamily: 'Menlo' }}>{fmtRef(imported[f.key] || 0, f.kind)}</Text>
              <TextInput
                style={{ width: 92, backgroundColor: Colors.elevated, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, color: Colors.textPrimary, fontSize: 14, fontWeight: '700', borderWidth: 1, borderColor: Colors.border, textAlign: 'right', fontFamily: 'Menlo' }}
                value={vals[f.key] ?? ''}
                onChangeText={(v) => { setVals((p) => ({ ...p, [f.key]: v })); setEdited(true); }}
                keyboardType={f.kind === 'int' ? 'number-pad' : (timeFormat === 'decimal' ? 'decimal-pad' : 'numbers-and-punctuation')}
                placeholder={f.kind === 'int' ? '0' : (timeFormat === 'decimal' ? '0.0' : '0:00')}
                placeholderTextColor={Colors.textMuted}
              />
            </View>
          ))}

          {edited && (
            <TouchableOpacity onPress={handleSave} disabled={saving} activeOpacity={0.85}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 12, marginTop: 14, opacity: saving ? 0.6 : 1 }}>
              <Ionicons name="checkmark-circle" size={18} color={Colors.textInverse} />
              <Text style={{ color: Colors.textInverse, fontSize: 15, fontWeight: '700' }}>Save backfilled hours</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}
