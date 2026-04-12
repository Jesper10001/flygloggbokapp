import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { insertFlight, addAircraftTypeToRegistry } from '../../db/flights';
import { useFlightStore } from '../../store/flightStore';
import { Colors } from '../../constants/colors';

// ── Typdef ────────────────────────────────────────────────────────────────────

interface YearBlock {
  id: string;
  year: string;
  total_time: string;
  pic: string;
  co_pilot: string;
  dual: string;
  instructor: string;
  ifr: string;
  night: string;
  multi_pilot: string;
  single_pilot: string;
  landings_day: string;
  landings_night: string;
  aircraft_type: string;
  remarks: string;
}

function emptyBlock(year = ''): YearBlock {
  return {
    id: `${Date.now()}-${Math.random()}`,
    year,
    total_time: '', pic: '', co_pilot: '', dual: '', instructor: '',
    ifr: '', night: '', multi_pilot: '', single_pilot: '',
    landings_day: '', landings_night: '',
    aircraft_type: '', remarks: '',
  };
}

// ── Hjälpfunktioner ───────────────────────────────────────────────────────────

function parseH(v: string): number {
  const t = v.trim().replace(',', '.');
  if (!t) return 0;
  if (t.includes(':')) {
    const [h, m] = t.split(':').map(Number);
    return Math.round((h + (m || 0) / 60) * 100) / 100;
  }
  return parseFloat(t) || 0;
}

function blockDate(year: string): string {
  const y = parseInt(year);
  if (y >= 1950 && y <= 2099) return `${y}-12-31`;
  return new Date().toISOString().slice(0, 10);
}

function blockHasData(b: YearBlock): boolean {
  return parseH(b.total_time) > 0;
}

// ── Formulärrad ───────────────────────────────────────────────────────────────

function FieldRow({
  label, value, onChange, integer, text, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  integer?: boolean;
  text?: boolean;
  placeholder?: string;
}) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.fieldInput, text && styles.fieldInputText]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder ?? (text ? '' : '0')}
        placeholderTextColor={Colors.textMuted}
        keyboardType={text ? 'default' : integer ? 'number-pad' : 'decimal-pad'}
        autoCapitalize="none"
        selectTextOnFocus
      />
      {!text && <Text style={styles.fieldUnit}>{integer ? 'st' : 'h'}</Text>}
    </View>
  );
}

// ── Årsblock ──────────────────────────────────────────────────────────────────

function Block({
  block, onChange, onRemove, canRemove,
}: {
  block: YearBlock;
  onChange: (key: keyof YearBlock, val: string) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const set = (key: keyof YearBlock) => (val: string) => onChange(key, val);

  return (
    <View style={styles.block}>
      {/* Årsrubrik */}
      <View style={styles.blockHeader}>
        <Ionicons name="calendar-outline" size={14} color={Colors.primary} />
        <TextInput
          style={styles.yearInput}
          value={block.year}
          onChangeText={set('year')}
          placeholder="År (valfritt)"
          placeholderTextColor={Colors.textMuted}
          keyboardType="number-pad"
          maxLength={4}
        />
        {canRemove && (
          <TouchableOpacity onPress={onRemove} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="trash-outline" size={16} color={Colors.danger} />
          </TouchableOpacity>
        )}
      </View>

      {/* Flygtider */}
      <Text style={styles.groupLabel}>Flygtider</Text>
      <FieldRow label="Total flygtid"  value={block.total_time}   onChange={set('total_time')} />
      <FieldRow label="PIC"            value={block.pic}          onChange={set('pic')} />
      <FieldRow label="Co-pilot"       value={block.co_pilot}     onChange={set('co_pilot')} />
      <FieldRow label="Dual"           value={block.dual}         onChange={set('dual')} />
      <FieldRow label="Instruktör"     value={block.instructor}   onChange={set('instructor')} />
      <FieldRow label="Multi-pilot"    value={block.multi_pilot}  onChange={set('multi_pilot')} />
      <FieldRow label="Single pilot"   value={block.single_pilot} onChange={set('single_pilot')} />

      {/* Operativa förhållanden */}
      <Text style={styles.groupLabel}>Operativt</Text>
      <FieldRow label="IFR"  value={block.ifr}   onChange={set('ifr')} />
      <FieldRow label="Natt" value={block.night} onChange={set('night')} />

      {/* Landningar */}
      <Text style={styles.groupLabel}>Landningar</Text>
      <FieldRow label="Dag"  value={block.landings_day}   onChange={set('landings_day')}  integer />
      <FieldRow label="Natt" value={block.landings_night} onChange={set('landings_night')} integer />

      {/* Övrigt */}
      <Text style={styles.groupLabel}>Övrigt (valfritt)</Text>
      <FieldRow label="Luftfartygstyp" value={block.aircraft_type} onChange={set('aircraft_type')} text placeholder="ex. R44, C172" />
      <FieldRow label="Anmärkningar"   value={block.remarks}       onChange={set('remarks')}       text placeholder="ex. Militär tjänst" />
    </View>
  );
}

// ── Huvud ─────────────────────────────────────────────────────────────────────

export default function ManualExperienceScreen() {
  const router = useRouter();
  const { loadFlights, loadStats } = useFlightStore();

  const currentYear = String(new Date().getFullYear());
  const [blocks, setBlocks] = useState<YearBlock[]>([emptyBlock(currentYear)]);
  const [saving, setSaving] = useState(false);

  // Farkosttyp
  const [aircraftType, setAircraftType] = useState('');
  const [cruiseSpeed, setCruiseSpeed] = useState('');
  const [endurance, setEndurance] = useState('');
  const [crewTypes, setCrewTypes] = useState<Set<string>>(new Set());

  const toggleCrew = (key: 'sp' | 'mp' | 'sp_only' | 'mp_only') => {
    setCrewTypes(prev => {
      const next = new Set(prev);
      if (key === 'sp_only' || key === 'mp_only') {
        // Exklusiva alternativ — rensar allt annat
        if (next.has(key)) { next.clear(); }
        else { next.clear(); next.add(key); }
      } else {
        // SP/MP kan kombineras — men ta bort exklusiva val först
        next.delete('sp_only');
        next.delete('mp_only');
        if (next.has(key)) next.delete(key); else next.add(key);
      }
      return next;
    });
  };

  const serializeCrewType = (): string =>
    crewTypes.size === 0 ? '' : [...crewTypes].sort().join(',');
  const [showAircraftSection, setShowAircraftSection] = useState(false);

  const updateBlock = (id: string, key: keyof YearBlock, val: string) => {
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, [key]: val } : b));
  };

  const addBlock = () => {
    const years = blocks.map(b => parseInt(b.year)).filter(y => !isNaN(y));
    const prevYear = years.length ? String(Math.min(...years) - 1) : '';
    setBlocks(prev => [emptyBlock(prevYear), ...prev]);
  };

  const removeBlock = (id: string) => {
    setBlocks(prev => prev.filter(b => b.id !== id));
  };

  const readyBlocks = blocks.filter(blockHasData);

  const saveAll = async () => {
    if (!readyBlocks.length) {
      Alert.alert('Inget att spara', 'Ange flygtid för minst ett block.');
      return;
    }
    setSaving(true);
    let saved = 0;
    try {
      for (const b of readyBlocks) {
        const label = b.year
          ? `Erfarenhetssammanfattning ${b.year}`
          : 'Sammanlagd erfarenhet';
        await insertFlight({
          date: blockDate(b.year),
          aircraft_type: b.aircraft_type || '',
          registration: '',
          dep_place: '',
          arr_place: '',
          dep_utc: '',
          arr_utc: '',
          total_time: String(parseH(b.total_time)),
          ifr:           String(parseH(b.ifr)),
          night:         String(parseH(b.night)),
          pic:           String(parseH(b.pic)),
          co_pilot:      String(parseH(b.co_pilot)),
          dual:          String(parseH(b.dual)),
          instructor:    String(parseH(b.instructor)),
          multi_pilot:   String(parseH(b.multi_pilot)),
          single_pilot:  String(parseH(b.single_pilot)),
          landings_day:  String(parseInt(b.landings_day) || 0),
          landings_night: String(parseInt(b.landings_night) || 0),
          remarks: b.remarks || label,
          flight_rules: 'VFR',
          second_pilot: '',
          nvg: '0',
          tng_count: '0',
          flight_type: 'summary',
          needs_review: false,
        }, { source: 'import' });
        saved++;
      }
      // Spara farkosttyp om ifylld
      if (aircraftType.trim()) {
        await addAircraftTypeToRegistry(
          aircraftType.trim(),
          parseInt(cruiseSpeed) || 0,
          parseFloat(endurance.replace(',', '.')) || 0,
          serializeCrewType(),
        );
      }

      await Promise.all([loadFlights(), loadStats()]);
      Alert.alert(
        'Klart!',
        `${saved} block sparade.${aircraftType.trim() ? `\n${aircraftType.toUpperCase()} registrerad.` : ''}`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (e: any) {
      Alert.alert('Fel', e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.title}>Manuell erfarenhet</Text>
        <Text style={styles.subtitle}>
          Fyll i din sammanlagda flygerfarenhet. Dela upp per år om du vill ha
          detaljerad historik, annars räcker ett block.
        </Text>

        {/* Lägg till år-knapp */}
        <TouchableOpacity style={styles.addYearBtn} onPress={addBlock} activeOpacity={0.8}>
          <Ionicons name="add-circle-outline" size={16} color={Colors.primary} />
          <Text style={styles.addYearText}>Lägg till år</Text>
        </TouchableOpacity>

        {/* Årsblock */}
        {blocks.map(block => (
          <Block
            key={block.id}
            block={block}
            onChange={(key, val) => updateBlock(block.id, key, val)}
            onRemove={() => removeBlock(block.id)}
            canRemove={blocks.length > 1}
          />
        ))}

        {/* Farkosttyp */}
        <TouchableOpacity
          style={styles.aircraftToggle}
          onPress={() => setShowAircraftSection(v => !v)}
          activeOpacity={0.8}
        >
          <Ionicons name="airplane-outline" size={15} color={Colors.primary} />
          <Text style={styles.aircraftToggleText}>
            {showAircraftSection ? 'Dölj farkosttyp' : 'Lägg till farkosttyp (valfritt)'}
          </Text>
          <Ionicons
            name={showAircraftSection ? 'chevron-up' : 'chevron-down'}
            size={14} color={Colors.textMuted}
            style={{ marginLeft: 'auto' }}
          />
        </TouchableOpacity>

        {showAircraftSection && (
          <View style={styles.aircraftBlock}>
            {/* Typ */}
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Typ</Text>
              <TextInput
                style={[styles.fieldInput, styles.fieldInputText]}
                value={aircraftType}
                onChangeText={setAircraftType}
                placeholder="ex. R44, EC135, B737"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="characters"
              />
            </View>

            {/* Marschfart */}
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Marschfart</Text>
              <TextInput
                style={styles.fieldInput}
                value={cruiseSpeed}
                onChangeText={setCruiseSpeed}
                placeholder="0"
                placeholderTextColor={Colors.textMuted}
                keyboardType="number-pad"
                selectTextOnFocus
              />
              <Text style={styles.fieldUnit}>kts</Text>
            </View>

            {/* Uthållighet */}
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Uthållighet</Text>
              <TextInput
                style={styles.fieldInput}
                value={endurance}
                onChangeText={setEndurance}
                placeholder="0"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
                selectTextOnFocus
              />
              <Text style={styles.fieldUnit}>h</Text>
            </View>

            {/* Besättningstyp */}
            <Text style={styles.groupLabel}>Besättningstyp</Text>
            <View style={styles.crewGrid}>
              {([
                { key: 'sp',      label: 'Single-pilot',       sub: 'SP-certifierad' },
                { key: 'mp',      label: 'Multi-pilot',        sub: 'Båda roller' },
                { key: 'sp_only', label: 'Enbart single-pilot', sub: 'Alltid SP' },
                { key: 'mp_only', label: 'Enbart multi-pilot',  sub: 'Kräver alltid besättning' },
              ] as const).map(opt => (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.crewBtn, crewTypes.has(opt.key) && styles.crewBtnActive]}
                  onPress={() => toggleCrew(opt.key as 'sp' | 'mp' | 'sp_only' | 'mp_only')}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.crewBtnLabel, crewTypes.has(opt.key) && styles.crewBtnLabelActive]}>
                    {opt.label}
                  </Text>
                  <Text style={styles.crewBtnSub}>{opt.sub}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Spara */}
        <TouchableOpacity
          style={[styles.saveBtn, (saving || !readyBlocks.length) && { opacity: 0.5 }]}
          onPress={saveAll}
          disabled={saving || !readyBlocks.length}
          activeOpacity={0.8}
        >
          {saving
            ? <ActivityIndicator color={Colors.textInverse} />
            : (
              <>
                <Ionicons name="checkmark-circle" size={20} color={Colors.textInverse} />
                <Text style={styles.saveBtnText}>
                  Spara {readyBlocks.length} {readyBlocks.length === 1 ? 'block' : 'block'}
                </Text>
              </>
            )}
        </TouchableOpacity>

        <Text style={styles.hint}>
          Varje block sparas som en rad med datum 31 dec angivet år. Timmar i decimalform
          eller HH:MM accepteras.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 48, gap: 12 },

  title: { color: Colors.textPrimary, fontSize: 24, fontWeight: '800' },
  subtitle: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20 },

  addYearBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 11,
    backgroundColor: Colors.primary + '18',
    borderRadius: 10, borderWidth: 1, borderColor: Colors.primary + '55',
  },
  addYearText: { color: Colors.primary, fontSize: 14, fontWeight: '700' },

  // ── Block ──
  block: {
    backgroundColor: Colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden',
  },
  blockHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.elevated,
    paddingHorizontal: 14, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: Colors.separator,
  },
  yearInput: {
    flex: 1, color: Colors.textPrimary, fontSize: 16, fontWeight: '800',
    fontFamily: 'Menlo',
  },

  groupLabel: {
    color: Colors.textMuted, fontSize: 10, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1,
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 2,
  },

  fieldRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 6,
    borderBottomWidth: 1, borderBottomColor: Colors.separator,
  },
  fieldLabel: {
    color: Colors.textSecondary, fontSize: 13, flex: 1,
  },
  fieldInput: {
    color: Colors.textPrimary, fontSize: 14, fontWeight: '600',
    fontFamily: 'Menlo', fontVariant: ['tabular-nums'],
    textAlign: 'right', minWidth: 72,
    paddingVertical: 4, paddingHorizontal: 6,
    backgroundColor: Colors.elevated, borderRadius: 6,
    borderWidth: 1, borderColor: Colors.border,
  },
  fieldInputText: {
    fontFamily: undefined, fontVariant: undefined,
    textAlign: 'left', minWidth: 120,
  },
  fieldUnit: {
    color: Colors.textMuted, fontSize: 11, width: 18,
    textAlign: 'right', marginLeft: 4,
  },

  aircraftToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 11, paddingHorizontal: 14,
    backgroundColor: Colors.card, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border,
  },
  aircraftToggleText: { color: Colors.primary, fontSize: 13, fontWeight: '600' },

  aircraftBlock: {
    backgroundColor: Colors.card, borderRadius: 14,
    borderWidth: 1, borderColor: Colors.border,
    overflow: 'hidden',
  },

  crewGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    gap: 8, padding: 12,
  },
  crewBtn: {
    flex: 1, minWidth: '45%',
    backgroundColor: Colors.elevated, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border,
    padding: 10, alignItems: 'center', gap: 2,
  },
  crewBtnActive: {
    backgroundColor: Colors.primary + '1A',
    borderColor: Colors.primary,
  },
  crewBtnLabel: {
    color: Colors.textSecondary, fontSize: 12, fontWeight: '700', textAlign: 'center',
  },
  crewBtnLabelActive: { color: Colors.primary },
  crewBtnSub: {
    color: Colors.textMuted, fontSize: 10, textAlign: 'center',
  },

  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.accent, borderRadius: 12,
    paddingVertical: 15, gap: 8, marginTop: 4,
  },
  saveBtnText: { color: Colors.textInverse, fontSize: 16, fontWeight: '700' },
  hint: { color: Colors.textMuted, fontSize: 11, textAlign: 'center', lineHeight: 16 },
});
