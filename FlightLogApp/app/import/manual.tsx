import { useState, useEffect } from 'react';
import { lookupAircraft } from '../../services/aircraftLookup';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { insertFlight, addAircraftTypeToRegistry } from '../../db/flights';
import { useFlightStore } from '../../store/flightStore';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';

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

// ── Styles ───────────────────────────────────────────────────────────────────

function makeStyles() {
  return StyleSheet.create({
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
  const styles = makeStyles();
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
  const styles = makeStyles();
  const { t } = useTranslation();
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
          placeholder={t('year_optional')}
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

      {/* Flight times */}
      <Text style={styles.groupLabel}>{t('flight_times_group')}</Text>
      <FieldRow label={t('total_flight_time')} value={block.total_time}   onChange={set('total_time')} />
      <FieldRow label={t('pic')}               value={block.pic}          onChange={set('pic')} />
      <FieldRow label={t('co_pilot')}          value={block.co_pilot}     onChange={set('co_pilot')} />
      <FieldRow label={t('dual')}              value={block.dual}         onChange={set('dual')} />
      <FieldRow label={t('instructor')}        value={block.instructor}   onChange={set('instructor')} />
      <FieldRow label={t('multi_pilot')}       value={block.multi_pilot}  onChange={set('multi_pilot')} />
      <FieldRow label={t('single_pilot')}      value={block.single_pilot} onChange={set('single_pilot')} />

      {/* Operational conditions */}
      <Text style={styles.groupLabel}>{t('operational')}</Text>
      <FieldRow label={t('ifr')}   value={block.ifr}   onChange={set('ifr')} />
      <FieldRow label={t('night')} value={block.night} onChange={set('night')} />

      {/* Landings */}
      <Text style={styles.groupLabel}>{t('landings')}</Text>
      <FieldRow label={t('day')}   value={block.landings_day}   onChange={set('landings_day')}  integer />
      <FieldRow label={t('night')} value={block.landings_night} onChange={set('landings_night')} integer />

      {/* Other */}
      <Text style={styles.groupLabel}>{t('other_optional')}</Text>
      <FieldRow label={t('aircraft_type')} value={block.aircraft_type} onChange={set('aircraft_type')} text placeholder="e.g. R44, C172" />
      <FieldRow label={t('remarks')}       value={block.remarks}       onChange={set('remarks')}       text placeholder="e.g. Military service" />
    </View>
  );
}

// ── Huvud ─────────────────────────────────────────────────────────────────────

export default function ManualExperienceScreen() {
  const styles = makeStyles();
  const { t } = useTranslation();
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
  const [category, setCategory] = useState<'airplane' | 'helicopter' | ''>('');
  const [engineType, setEngineType] = useState<'se' | 'me' | ''>('');
  const [lookupStatus, setLookupStatus] = useState<
    { state: 'idle' } | { state: 'loading' } | { state: 'ok'; summary: string } | { state: 'unknown' }
  >({ state: 'idle' });
  const [lastLookupQuery, setLastLookupQuery] = useState('');
  const [aiFilledFields, setAiFilledFields] = useState<Set<string>>(new Set());

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

  // Smart auto-lookup — debounce 800 ms, fyller i tomma fält, skriver aldrig
  // över värden användaren redan har editerat manuellt.
  useEffect(() => {
    const q = aircraftType.trim();
    if (q.length < 2 || q === lastLookupQuery) {
      if (q.length < 2) setLookupStatus({ state: 'idle' });
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLookupStatus({ state: 'loading' });
      try {
        const r = await lookupAircraft(q);
        if (cancelled) return;
        setLastLookupQuery(q);
        if (r.needs_manual || !r.aircraft_type) {
          setLookupStatus({ state: 'unknown' });
          return;
        }
        // Fyll endast tomma fält så vi inte överskriver användarens ändringar
        const filled = new Set<string>();
        if (!cruiseSpeed && r.cruise_speed_kts > 0) {
          setCruiseSpeed(String(r.cruise_speed_kts));
          filled.add('cruiseSpeed');
        }
        if (!endurance && r.endurance_h > 0) {
          setEndurance(String(r.endurance_h));
          filled.add('endurance');
        }
        if (crewTypes.size === 0 && r.crew_type) {
          const keys = r.crew_type.split(',').filter((k) => ['sp', 'mp'].includes(k));
          if (keys.length) {
            setCrewTypes(new Set(keys));
            filled.add('crew');
          }
        }
        if (!category && r.category) {
          setCategory(r.category);
          filled.add('category');
        }
        if (!engineType && r.engine_type) {
          setEngineType(r.engine_type);
          filled.add('engine');
        }
        setAiFilledFields(filled);
        const parts = [r.manufacturer, r.model].filter(Boolean).join(' ');
        const tail = [
          r.cruise_speed_kts ? `${r.cruise_speed_kts} kt` : null,
          r.endurance_h ? `${r.endurance_h} h` : null,
        ].filter(Boolean).join(' · ');
        setLookupStatus({
          state: 'ok',
          summary: tail ? `${parts} · ${tail}` : parts || r.aircraft_type,
        });
      } catch {
        if (!cancelled) setLookupStatus({ state: 'unknown' });
      }
    }, 800);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [aircraftType]);

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
      Alert.alert(t('nothing_to_save'), t('enter_flight_time'));
      return;
    }
    setSaving(true);
    let saved = 0;
    try {
      for (const b of readyBlocks) {
        const label = b.year
          ? `Experience summary ${b.year}`
          : 'Total experience';
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
          category,
          engineType,
        );
      }

      await Promise.all([loadFlights(), loadStats()]);
      Alert.alert(
        t('done_exclamation'),
        `${saved} ${t('block_saved')}${aircraftType.trim() ? `\n${aircraftType.toUpperCase()} ${t('registered')}` : ''}`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (e: any) {
      Alert.alert(t('fel'), e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'android' ? 'height' : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        <Text style={styles.title}>{t('manual_experience')}</Text>
        <Text style={styles.subtitle}>{t('manual_experience_sub')}</Text>

        {/* Add year button */}
        <TouchableOpacity style={styles.addYearBtn} onPress={addBlock} activeOpacity={0.8}>
          <Ionicons name="add-circle-outline" size={16} color={Colors.primary} />
          <Text style={styles.addYearText}>{t('add_year')}</Text>
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
            {showAircraftSection ? t('hide_aircraft_type') : t('add_aircraft_type_optional')}
          </Text>
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 'auto',
            paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
            backgroundColor: Colors.primary + '1F',
            borderWidth: 0.5, borderColor: Colors.primary + '66',
          }}>
            <Ionicons name="sparkles" size={10} color={Colors.primary} />
            <Text style={{ color: Colors.primary, fontSize: 10, fontWeight: '700', letterSpacing: 0.3 }}>
              {t('autofilled_with_ai')}
            </Text>
          </View>
          <Ionicons
            name={showAircraftSection ? 'chevron-up' : 'chevron-down'}
            size={14} color={Colors.textMuted}
            style={{ marginLeft: 6 }}
          />
        </TouchableOpacity>

        {showAircraftSection && (
          <View style={styles.aircraftBlock}>
            {/* Type */}
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Type</Text>
              <TextInput
                style={[styles.fieldInput, styles.fieldInputText]}
                value={aircraftType}
                onChangeText={(v) => setAircraftType(v.toUpperCase())}
                placeholder="ex. R44, EC135, B737"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="characters"
              />
            </View>
            {lookupStatus.state !== 'idle' && (
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 6,
                paddingHorizontal: 12, paddingVertical: 6, marginBottom: 4,
              }}>
                {lookupStatus.state === 'loading' && (
                  <>
                    <ActivityIndicator size="small" color={Colors.primary} />
                    <Text style={{ color: Colors.textMuted, fontSize: 11 }}>{t('aircraft_lookup_searching')}</Text>
                  </>
                )}
                {lookupStatus.state === 'ok' && (
                  <>
                    <Ionicons name="sparkles" size={12} color={Colors.primary} />
                    <Text style={{ color: Colors.primary, fontSize: 11, fontWeight: '600', flex: 1 }} numberOfLines={2}>
                      {lookupStatus.summary}
                    </Text>
                  </>
                )}
                {lookupStatus.state === 'unknown' && (
                  <>
                    <Ionicons name="help-circle-outline" size={12} color={Colors.textMuted} />
                    <Text style={{ color: Colors.textMuted, fontSize: 11 }}>{t('aircraft_lookup_unknown_hint')}</Text>
                  </>
                )}
              </View>
            )}

            {/* Cruise speed */}
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Cruise speed</Text>
              <TextInput
                style={[
                  styles.fieldInput,
                  aiFilledFields.has('cruiseSpeed') && { borderColor: Colors.primary, color: Colors.primary, backgroundColor: Colors.primary + '14' },
                ]}
                value={cruiseSpeed}
                onChangeText={(v) => { setCruiseSpeed(v); setAiFilledFields(s => { const n = new Set(s); n.delete('cruiseSpeed'); return n; }); }}
                placeholder="0"
                placeholderTextColor={Colors.textMuted}
                keyboardType="number-pad"
                selectTextOnFocus
              />
              <Text style={styles.fieldUnit}>kts</Text>
            </View>

            {/* Endurance */}
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Endurance</Text>
              <TextInput
                style={[
                  styles.fieldInput,
                  aiFilledFields.has('endurance') && { borderColor: Colors.primary, color: Colors.primary, backgroundColor: Colors.primary + '14' },
                ]}
                value={endurance}
                onChangeText={(v) => { setEndurance(v); setAiFilledFields(s => { const n = new Set(s); n.delete('endurance'); return n; }); }}
                placeholder="0"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
                selectTextOnFocus
              />
              <Text style={styles.fieldUnit}>h</Text>
            </View>

            {/* Airplane / Helicopter */}
            <Text style={styles.groupLabel}>Category</Text>
            <View style={styles.crewGrid}>
              {(['airplane', 'helicopter'] as const).map((c) => {
                const active = category === c;
                const ai = aiFilledFields.has('category') && active;
                return (
                  <TouchableOpacity
                    key={c}
                    style={[
                      styles.crewBtn,
                      active && styles.crewBtnActive,
                      ai && { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' },
                    ]}
                    onPress={() => {
                      setCategory(active ? '' : c);
                      setAiFilledFields(s => { const n = new Set(s); n.delete('category'); return n; });
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.crewBtnLabel, active && styles.crewBtnLabelActive]}>
                      {c === 'airplane' ? t('airplane') : t('helicopter')}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Engine type */}
            <Text style={styles.groupLabel}>Engine</Text>
            <View style={styles.crewGrid}>
              {(['se', 'me'] as const).map((k) => {
                const active = engineType === k;
                const ai = aiFilledFields.has('engine') && active;
                return (
                  <TouchableOpacity
                    key={k}
                    style={[
                      styles.crewBtn,
                      active && styles.crewBtnActive,
                      ai && { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' },
                    ]}
                    onPress={() => {
                      setEngineType(active ? '' : k);
                      setAiFilledFields(s => { const n = new Set(s); n.delete('engine'); return n; });
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.crewBtnLabel, active && styles.crewBtnLabelActive]}>
                      {k === 'se' ? 'SE' : 'ME'}
                    </Text>
                    <Text style={styles.crewBtnSub}>{k === 'se' ? 'Single engine' : 'Multi engine'}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Crew type */}
            <Text style={styles.groupLabel}>Crew type</Text>
            <View style={styles.crewGrid}>
              {([
                { key: 'sp',      label: 'Single-pilot',    sub: 'SP certified' },
                { key: 'mp',      label: 'Multi-pilot',     sub: 'Both roles' },
                { key: 'sp_only', label: 'SP only',         sub: 'Always SP' },
                { key: 'mp_only', label: 'MP only',         sub: 'Always requires crew' },
              ] as const).map(opt => {
                const active = crewTypes.has(opt.key);
                const ai = aiFilledFields.has('crew') && active && (opt.key === 'sp' || opt.key === 'mp');
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[
                      styles.crewBtn,
                      active && styles.crewBtnActive,
                      ai && { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' },
                    ]}
                    onPress={() => {
                      toggleCrew(opt.key as 'sp' | 'mp' | 'sp_only' | 'mp_only');
                      setAiFilledFields(s => { const n = new Set(s); n.delete('crew'); return n; });
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.crewBtnLabel, active && styles.crewBtnLabelActive]}>
                      {opt.label}
                    </Text>
                    <Text style={styles.crewBtnSub}>{opt.sub}</Text>
                  </TouchableOpacity>
                );
              })}
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
                  Save {readyBlocks.length} {readyBlocks.length === 1 ? 'block' : 'blocks'}
                </Text>
              </>
            )}
        </TouchableOpacity>

        <Text style={styles.hint}>
          Each block is saved as a row with the date Dec 31 of the given year. Hours in decimal
          or HH:MM format are accepted.
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
