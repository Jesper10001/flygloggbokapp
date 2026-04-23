import { useState } from 'react';
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
import { PremiumModal } from '../../components/PremiumModal';
import { useScanQuotaStore } from '../../store/scanQuotaStore';

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
  nvg: string;
  multi_pilot: string;
  single_pilot: string;
  landings_day: string;
  landings_night: string;
  aircraft_type: string;
  remarks: string;
  // Special roles
  examiner: string;
  safety_pilot: string;
  spic: string;
  ferry_pic: string;
  observer: string;
  relief_crew: string;
  // Simulator
  sim_ffs: string;
  sim_ftd: string;
  sim_fnpt_ii: string;
  sim_fnpt_i: string;
  sim_bitd: string;
  sim_cpt_ppt: string;
  sim_cbt: string;
}

function emptyBlock(year = ''): YearBlock {
  return {
    id: `${Date.now()}-${Math.random()}`,
    year,
    total_time: '', pic: '', co_pilot: '', dual: '', instructor: '',
    ifr: '', night: '', nvg: '', multi_pilot: '', single_pilot: '',
    landings_day: '', landings_night: '',
    aircraft_type: '', remarks: '',
    examiner: '', safety_pilot: '', spic: '', ferry_pic: '', observer: '', relief_crew: '',
    sim_ffs: '', sim_ftd: '', sim_fnpt_ii: '', sim_fnpt_i: '', sim_bitd: '', sim_cpt_ppt: '', sim_cbt: '',
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

    modeRow: {
      flexDirection: 'row', gap: 0,
      backgroundColor: Colors.elevated, borderRadius: 10,
      borderWidth: 1, borderColor: Colors.border,
      padding: 3,
    },
    modeBtn: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 6, paddingVertical: 9, borderRadius: 8,
    },
    modeBtnActive: {
      backgroundColor: Colors.primary,
    },
    modeText: {
      color: Colors.textSecondary, fontSize: 13, fontWeight: '700',
    },
    modeTextActive: {
      color: Colors.textInverse,
    },
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
  block, onChange, onRemove, canRemove, showYear = true,
}: {
  block: YearBlock;
  onChange: (key: keyof YearBlock, val: string) => void;
  onRemove: () => void;
  canRemove: boolean;
  showYear?: boolean;
}) {
  const styles = makeStyles();
  const { t } = useTranslation();
  const set = (key: keyof YearBlock) => (val: string) => onChange(key, val);

  const SPECIAL_ROLES: { key: keyof YearBlock; label: string }[] = [
    { key: 'examiner', label: t('role_examiner') },
    { key: 'safety_pilot', label: t('role_safety_pilot') },
    { key: 'spic', label: t('role_spic') },
    { key: 'ferry_pic', label: t('role_ferry_pic') },
    { key: 'observer', label: t('role_observer') },
    { key: 'relief_crew', label: t('role_relief_crew') },
  ];
  const SIM_TYPES: { key: keyof YearBlock; label: string }[] = [
    { key: 'sim_ffs', label: 'FFS' },
    { key: 'sim_ftd', label: 'FTD' },
    { key: 'sim_fnpt_ii', label: 'FNPT II' },
    { key: 'sim_fnpt_i', label: 'FNPT I' },
    { key: 'sim_bitd', label: 'BITD' },
    { key: 'sim_cpt_ppt', label: 'CPT/PPT' },
    { key: 'sim_cbt', label: 'CBT' },
  ];

  const [showRoles, setShowRoles] = useState(false);
  const [activeRoles, setActiveRoles] = useState<Set<string>>(new Set());
  const [showSim, setShowSim] = useState(false);
  const [activeSims, setActiveSims] = useState<Set<string>>(new Set());

  const addRole = (key: string) => setActiveRoles(prev => new Set([...prev, key]));
  const addSim = (key: string) => setActiveSims(prev => new Set([...prev, key]));

  return (
    <View style={styles.block}>
      {/* Årsrubrik — visas bara i year-by-year mode */}
      {showYear ? (
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
      ) : (
        <View style={[styles.blockHeader, { justifyContent: 'center' }]}>
          <Ionicons name="layers-outline" size={14} color={Colors.primary} />
          <Text style={{ color: Colors.textPrimary, fontSize: 14, fontWeight: '700' }}>{t('total_experience')}</Text>
        </View>
      )}

      {/* Flight times */}
      <Text style={styles.groupLabel}>{t('flight_times_group')}</Text>
      <FieldRow label={t('total_flight_time')} value={block.total_time}   onChange={set('total_time')} />
      <FieldRow label={t('pic')}               value={block.pic}          onChange={set('pic')} />
      <FieldRow label={t('co_pilot')}          value={block.co_pilot}     onChange={set('co_pilot')} />
      <FieldRow label={t('dual')}              value={block.dual}         onChange={set('dual')} />
      <FieldRow label={t('instructor')}        value={block.instructor}   onChange={set('instructor')} />
      <FieldRow label={t('multi_pilot')}       value={block.multi_pilot}  onChange={set('multi_pilot')} />
      <FieldRow label={t('single_pilot')}      value={block.single_pilot} onChange={set('single_pilot')} />

      {/* Special roles expand */}
      <TouchableOpacity
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8 }}
        onPress={() => setShowRoles(v => !v)}
        activeOpacity={0.7}
      >
        <Ionicons name={showRoles ? 'chevron-down' : 'chevron-forward'} size={13} color={Colors.textMuted} />
        <Text style={{ color: Colors.textSecondary, fontSize: 12, fontWeight: '700' }}>{t('special_role')}</Text>
      </TouchableOpacity>
      {showRoles && (
        <View style={{ paddingBottom: 4 }}>
          {SPECIAL_ROLES.map(r => activeRoles.has(r.key) ? (
            <FieldRow key={r.key} label={r.label} value={block[r.key]} onChange={set(r.key)} />
          ) : (
            <TouchableOpacity
              key={r.key}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 6 }}
              onPress={() => addRole(r.key)}
              activeOpacity={0.7}
            >
              <Ionicons name="add-circle-outline" size={15} color={Colors.primary} />
              <Text style={{ color: Colors.primary, fontSize: 13, fontWeight: '600' }}>{r.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Operational conditions */}
      <Text style={styles.groupLabel}>{t('operational')}</Text>
      <FieldRow label={t('ifr')}   value={block.ifr}   onChange={set('ifr')} />
      <FieldRow label={t('night')} value={block.night} onChange={set('night')} />
      <FieldRow label="NVG"       value={block.nvg}   onChange={set('nvg')} />

      {/* Simulator expand */}
      <TouchableOpacity
        style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8 }}
        onPress={() => setShowSim(v => !v)}
        activeOpacity={0.7}
      >
        <Ionicons name={showSim ? 'chevron-down' : 'chevron-forward'} size={13} color={Colors.textMuted} />
        <Text style={{ color: Colors.textSecondary, fontSize: 12, fontWeight: '700' }}>{t('simulator')}</Text>
      </TouchableOpacity>
      {showSim && (
        <View style={{ paddingBottom: 4 }}>
          {SIM_TYPES.map(s => activeSims.has(s.key) ? (
            <FieldRow key={s.key} label={s.label} value={block[s.key]} onChange={set(s.key)} />
          ) : (
            <TouchableOpacity
              key={s.key}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 6 }}
              onPress={() => addSim(s.key)}
              activeOpacity={0.7}
            >
              <Ionicons name="add-circle-outline" size={15} color={Colors.primary} />
              <Text style={{ color: Colors.primary, fontSize: 13, fontWeight: '600' }}>{s.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Landings */}
      <Text style={styles.groupLabel}>{t('landings')}</Text>
      <FieldRow label={t('day')}   value={block.landings_day}   onChange={set('landings_day')}  integer />
      <FieldRow label={t('night')} value={block.landings_night} onChange={set('landings_night')} integer />

    </View>
  );
}

// ── Huvud ─────────────────────────────────────────────────────────────────────

export default function ManualExperienceScreen() {
  const styles = makeStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const { loadFlights, loadStats, isPremium } = useFlightStore();
  const [showPremiumModal, setShowPremiumModal] = useState(false);

  const currentYear = String(new Date().getFullYear());
  const [mode, setMode] = useState<'lump' | 'yearly'>('lump');
  const [blocks, setBlocks] = useState<YearBlock[]>([emptyBlock('')]);
  const [saving, setSaving] = useState(false);

  // Farkosttyper (multi)
  type AircraftEntry = {
    id: string;
    type: string;
    totalTime: string;
    cruiseSpeed: string;
    endurance: string;
    crewTypes: Set<string>;
    category: 'airplane' | 'helicopter' | '';
    engineType: 'se' | 'me' | '';
    lookupStatus: { state: 'idle' } | { state: 'loading' } | { state: 'ok'; summary: string } | { state: 'unknown' };
    lastLookupQuery: string;
    aiFilledFields: Set<string>;
  };

  const emptyAircraft = (): AircraftEntry => ({
    id: `ac-${Date.now()}-${Math.random()}`,
    type: '', totalTime: '', cruiseSpeed: '', endurance: '',
    crewTypes: new Set(), category: '', engineType: '',
    lookupStatus: { state: 'idle' }, lastLookupQuery: '', aiFilledFields: new Set(),
  });

  const [aircraft, setAircraft] = useState<AircraftEntry[]>([emptyAircraft()]);
  const [showAircraftSection, setShowAircraftSection] = useState(false);
  const [acTimeErrors, setAcTimeErrors] = useState<Set<string>>(new Set());
  const [acOverflow, setAcOverflow] = useState(false);

  const updateAircraft = (id: string, updater: (a: AircraftEntry) => AircraftEntry) => {
    setAircraft(prev => prev.map(a => a.id === id ? updater(a) : a));
  };

  const toggleCrew = (acId: string, key: 'sp' | 'mp' | 'sp_only' | 'mp_only') => {
    updateAircraft(acId, a => {
      const next = new Set(a.crewTypes);
      if (key === 'sp_only' || key === 'mp_only') {
        if (next.has(key)) { next.clear(); }
        else { next.clear(); next.add(key); }
      } else {
        next.delete('sp_only');
        next.delete('mp_only');
        if (next.has(key)) next.delete(key); else next.add(key);
      }
      return { ...a, crewTypes: next };
    });
  };

  const serializeCrewType = (ct: Set<string>): string =>
    ct.size === 0 ? '' : [...ct].sort().join(',');

  const handleSmartLookup = async (acId: string) => {
    if (!isPremium) { setShowPremiumModal(true); return; }
    const { canLookup, consumeLookup } = useScanQuotaStore.getState();
    if (!canLookup()) { Alert.alert(t('quota_exceeded_title'), t('lookup_quota_exceeded')); return; }
    const ac = aircraft.find(a => a.id === acId);
    if (!ac) return;
    const q = ac.type.trim();
    if (!q) { Alert.alert(t('aircraft_lookup_empty_title'), t('aircraft_lookup_empty_body')); return; }
    updateAircraft(acId, a => ({ ...a, lookupStatus: { state: 'loading' } }));
    try {
      await consumeLookup();
      const r = await lookupAircraft(q);
      if (r.needs_manual || !r.aircraft_type) {
        updateAircraft(acId, a => ({ ...a, lookupStatus: { state: 'unknown' } }));
        return;
      }
      updateAircraft(acId, a => {
        const filled = new Set<string>();
        const updated = { ...a, type: r.aircraft_type, lastLookupQuery: q };
        if (!a.cruiseSpeed && r.cruise_speed_kts > 0) { updated.cruiseSpeed = String(r.cruise_speed_kts); filled.add('cruiseSpeed'); }
        if (!a.endurance && r.endurance_h > 0) { updated.endurance = String(r.endurance_h); filled.add('endurance'); }
        if (a.crewTypes.size === 0 && r.crew_type) {
          const keys = r.crew_type.split(',').filter(k => ['sp', 'mp'].includes(k));
          if (keys.length) { updated.crewTypes = new Set(keys); filled.add('crew'); }
        }
        if (!a.category && r.category) { updated.category = r.category; filled.add('category'); }
        if (!a.engineType && r.engine_type) { updated.engineType = r.engine_type; filled.add('engine'); }
        updated.aiFilledFields = filled;
        const parts = [r.manufacturer, r.model].filter(Boolean).join(' ');
        const tail = [r.cruise_speed_kts ? `${r.cruise_speed_kts} kt` : null, r.endurance_h ? `${r.endurance_h} h` : null].filter(Boolean).join(' · ');
        updated.lookupStatus = { state: 'ok', summary: tail ? `${parts} · ${tail}` : parts || r.aircraft_type };
        return updated;
      });
    } catch (e: any) {
      updateAircraft(acId, a => ({ ...a, lookupStatus: { state: 'unknown' } }));
    }
  };

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
    const acWithType = aircraft.filter(a => a.type.trim());
    const missingTime = acWithType.filter(a => !parseH(a.totalTime));
    if (missingTime.length > 0) {
      setAcTimeErrors(new Set(missingTime.map(a => a.id)));
      setAcOverflow(false);
      setShowAircraftSection(true);
      return;
    }
    const totalBlock = readyBlocks.reduce((s, b) => s + parseH(b.total_time), 0);
    const totalAc = acWithType.reduce((s, a) => s + parseH(a.totalTime), 0);
    if (totalAc > totalBlock + 0.01) {
      setAcTimeErrors(new Set(acWithType.map(a => a.id)));
      setAcOverflow(true);
      setShowAircraftSection(true);
      return;
    }
    setAcTimeErrors(new Set());
    setAcOverflow(false);
    setSaving(true);
    let saved = 0;
    try {
      for (const b of readyBlocks) {
        const label = b.year
          ? `${t('experience_summary')} ${b.year}`
          : t('total_experience');
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
          nvg: String(parseH(b.nvg)),
          examiner: String(parseH(b.examiner)),
          safety_pilot: String(parseH(b.safety_pilot)),
          spic: String(parseH(b.spic)),
          ferry_pic: String(parseH(b.ferry_pic)),
          observer: String(parseH(b.observer)),
          relief_crew: String(parseH(b.relief_crew)),
          tng_count: '0',
          flight_type: 'summary',
        }, { source: 'import' });
        saved++;
      }
      for (const ac of aircraft) {
        if (!ac.type.trim()) continue;
        await addAircraftTypeToRegistry(
          ac.type.trim(),
          parseInt(ac.cruiseSpeed) || 0,
          parseFloat(ac.endurance.replace(',', '.')) || 0,
          serializeCrewType(ac.crewTypes),
          ac.category,
          ac.engineType,
        );
      }
      const acNames = aircraft.filter(a => a.type.trim()).map(a => a.type.toUpperCase());

      await Promise.all([loadFlights(), loadStats()]);
      Alert.alert(
        t('done_exclamation'),
        `${saved} ${t('block_saved')}${acNames.length ? `\n${acNames.join(', ')} ${t('registered')}` : ''}`,
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

        {/* Mode toggle */}
        <View style={styles.modeRow}>
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'lump' && styles.modeBtnActive]}
            onPress={() => {
              setMode('lump');
              setBlocks([emptyBlock('')]);
            }}
            activeOpacity={0.75}
          >
            <Ionicons name="layers-outline" size={14} color={mode === 'lump' ? Colors.textInverse : Colors.textSecondary} />
            <Text style={[styles.modeText, mode === 'lump' && styles.modeTextActive]}>{t('lump_sum')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'yearly' && styles.modeBtnActive]}
            onPress={() => {
              if (mode !== 'yearly') {
                setMode('yearly');
                setBlocks([emptyBlock(currentYear)]);
              }
            }}
            activeOpacity={0.75}
          >
            <Ionicons name="calendar-outline" size={14} color={mode === 'yearly' ? Colors.textInverse : Colors.textSecondary} />
            <Text style={[styles.modeText, mode === 'yearly' && styles.modeTextActive]}>{t('year_by_year')}</Text>
          </TouchableOpacity>
        </View>

        {/* Add year button (only in yearly mode) */}
        {mode === 'yearly' && (
          <TouchableOpacity style={styles.addYearBtn} onPress={addBlock} activeOpacity={0.8}>
            <Ionicons name="add-circle-outline" size={16} color={Colors.primary} />
            <Text style={styles.addYearText}>{t('add_year')}</Text>
          </TouchableOpacity>
        )}

        {/* Blocks */}
        {blocks.map(block => (
          <Block
            key={block.id}
            block={block}
            onChange={(key, val) => updateBlock(block.id, key, val)}
            onRemove={() => removeBlock(block.id)}
            canRemove={mode === 'yearly' && blocks.length > 1}
            showYear={mode === 'yearly'}
          />
        ))}

        {/* Farkosttyper */}
        <TouchableOpacity
          style={styles.aircraftToggle}
          onPress={() => setShowAircraftSection(v => !v)}
          activeOpacity={0.8}
        >
          <Ionicons name="airplane-outline" size={15} color={Colors.primary} />
          <Text style={styles.aircraftToggleText}>
            {showAircraftSection ? t('hide_aircraft_type') : t('add_aircraft_type_optional')}
          </Text>
          <View style={{ marginLeft: 'auto' }} />
          <Ionicons
            name={showAircraftSection ? 'chevron-up' : 'chevron-down'}
            size={14} color={Colors.textMuted}
            style={{ marginLeft: 6 }}
          />
        </TouchableOpacity>

        {showAircraftSection && aircraft.map((ac, acIdx) => (
          <View key={ac.id} style={styles.aircraftBlock}>
            <View style={[styles.blockHeader, { justifyContent: 'space-between' }]}>
              <Text style={{ color: Colors.textPrimary, fontSize: 13, fontWeight: '700' }}>
                {t('aircraft_type')} {aircraft.length > 1 ? `#${acIdx + 1}` : ''}
              </Text>
              {aircraft.length > 1 && (
                <TouchableOpacity onPress={() => setAircraft(prev => prev.filter(a => a.id !== ac.id))} hitSlop={8}>
                  <Ionicons name="trash-outline" size={15} color={Colors.danger} />
                </TouchableOpacity>
              )}
            </View>

            <Text style={styles.groupLabel}>{t('aircraft_type')}</Text>
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingBottom: 6 }}>
              <TextInput
                style={[styles.fieldInput, styles.fieldInputText, { flex: 1 }]}
                value={ac.type}
                onChangeText={(v) => updateAircraft(ac.id, a => ({ ...a, type: v.toUpperCase(), lookupStatus: v.trim().length < 2 ? { state: 'idle' as const } : a.lookupStatus }))}
                placeholder="C172, R44, A320…"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="characters"
              />
              <TouchableOpacity
                onPress={() => handleSmartLookup(ac.id)}
                disabled={ac.lookupStatus.state === 'loading'}
                activeOpacity={0.75}
                style={{
                  paddingHorizontal: 12, borderRadius: 10,
                  backgroundColor: Colors.primary + '1F',
                  borderWidth: 1, borderColor: Colors.primary + '88',
                  alignItems: 'center', justifyContent: 'center',
                  flexDirection: 'row', gap: 5,
                }}
              >
                {ac.lookupStatus.state === 'loading'
                  ? <ActivityIndicator size="small" color={Colors.primary} />
                  : <Ionicons name="sparkles" size={14} color={Colors.primary} />}
                <Text style={{ color: Colors.primary, fontSize: 11, fontWeight: '800' }}>
                  {ac.lookupStatus.state === 'loading' ? t('drone_scan_loading') : t('aircraft_lookup_btn')}
                </Text>
              </TouchableOpacity>
            </View>
            {ac.lookupStatus.state === 'ok' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingBottom: 6 }}>
                <Ionicons name="checkmark-circle" size={13} color={Colors.success} />
                <Text style={{ color: Colors.success, fontSize: 11, fontWeight: '600', flex: 1 }} numberOfLines={2}>{ac.lookupStatus.summary}</Text>
              </View>
            )}
            {ac.lookupStatus.state === 'unknown' && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingBottom: 6 }}>
                <Ionicons name="help-circle-outline" size={13} color={Colors.textMuted} />
                <Text style={{ color: Colors.textMuted, fontSize: 11 }}>{t('aircraft_lookup_unknown_hint')}</Text>
              </View>
            )}

            <View style={styles.fieldRow}>
              <Text style={[styles.fieldLabel, acTimeErrors.has(ac.id) && { color: Colors.danger }]}>{t('total_flight_time')} *</Text>
              <TextInput
                style={[styles.fieldInput, acTimeErrors.has(ac.id) && { borderColor: Colors.danger, borderWidth: 1.5 }]}
                value={ac.totalTime}
                onChangeText={(v) => {
                  updateAircraft(ac.id, a => ({ ...a, totalTime: v }));
                  setAcTimeErrors(prev => { const n = new Set(prev); n.delete(ac.id); return n; });
                }}
                placeholder="0"
                placeholderTextColor={acTimeErrors.has(ac.id) ? Colors.danger : Colors.textMuted}
                keyboardType="decimal-pad"
                selectTextOnFocus
              />
              <Text style={styles.fieldUnit}>h</Text>
            </View>

            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>{t('cruise_speed_kts')}</Text>
              <TextInput
                style={[styles.fieldInput, ac.aiFilledFields.has('cruiseSpeed') && { borderColor: Colors.primary, color: Colors.primary, backgroundColor: Colors.primary + '14' }]}
                value={ac.cruiseSpeed}
                onChangeText={(v) => updateAircraft(ac.id, a => ({ ...a, cruiseSpeed: v, aiFilledFields: new Set([...a.aiFilledFields].filter(f => f !== 'cruiseSpeed')) }))}
                placeholder="0"
                placeholderTextColor={Colors.textMuted}
                keyboardType="number-pad"
                selectTextOnFocus
              />
              <Text style={styles.fieldUnit}>kts</Text>
            </View>

            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>{t('endurance_h')}</Text>
              <TextInput
                style={[styles.fieldInput, ac.aiFilledFields.has('endurance') && { borderColor: Colors.primary, color: Colors.primary, backgroundColor: Colors.primary + '14' }]}
                value={ac.endurance}
                onChangeText={(v) => updateAircraft(ac.id, a => ({ ...a, endurance: v, aiFilledFields: new Set([...a.aiFilledFields].filter(f => f !== 'endurance')) }))}
                placeholder="0"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
                selectTextOnFocus
              />
              <Text style={styles.fieldUnit}>h</Text>
            </View>

            <Text style={styles.groupLabel}>{t('category')}</Text>
            <View style={styles.crewGrid}>
              {(['airplane', 'helicopter'] as const).map((c) => {
                const active = ac.category === c;
                return (
                  <TouchableOpacity key={c} style={[styles.crewBtn, active && styles.crewBtnActive]} onPress={() => updateAircraft(ac.id, a => ({ ...a, category: active ? '' : c }))} activeOpacity={0.8}>
                    <Text style={[styles.crewBtnLabel, active && styles.crewBtnLabelActive]}>{c === 'airplane' ? t('airplane') : t('helicopter')}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.groupLabel}>{t('engine_type')}</Text>
            <View style={styles.crewGrid}>
              {(['se', 'me'] as const).map((k) => {
                const active = ac.engineType === k;
                return (
                  <TouchableOpacity key={k} style={[styles.crewBtn, active && styles.crewBtnActive]} onPress={() => updateAircraft(ac.id, a => ({ ...a, engineType: active ? '' : k }))} activeOpacity={0.8}>
                    <Text style={[styles.crewBtnLabel, active && styles.crewBtnLabelActive]}>{k === 'se' ? 'SE' : 'ME'}</Text>
                    <Text style={styles.crewBtnSub}>{k === 'se' ? t('single_engine') : t('multi_engine')}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.groupLabel}>{t('crew_type')}</Text>
            <View style={styles.crewGrid}>
              {([
                { key: 'sp', label: 'Single-pilot', sub: 'SP' },
                { key: 'mp', label: 'Multi-pilot', sub: 'MP' },
              ] as const).map(opt => {
                const active = ac.crewTypes.has(opt.key);
                return (
                  <TouchableOpacity key={opt.key} style={[styles.crewBtn, active && styles.crewBtnActive]} onPress={() => toggleCrew(ac.id, opt.key as any)} activeOpacity={0.8}>
                    <Text style={[styles.crewBtnLabel, active && styles.crewBtnLabelActive]}>{opt.label}</Text>
                    <Text style={styles.crewBtnSub}>{opt.sub}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ))}

        {showAircraftSection && (
          <>
            <TouchableOpacity
              style={styles.addYearBtn}
              onPress={() => setAircraft(prev => [...prev, emptyAircraft()])}
              activeOpacity={0.8}
            >
              <Ionicons name="add-circle-outline" size={16} color={Colors.primary} />
              <Text style={styles.addYearText}>{t('add_another_aircraft')}</Text>
            </TouchableOpacity>
            {acOverflow && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 }}>
                <Ionicons name="warning" size={14} color={Colors.danger} />
                <Text style={{ color: Colors.danger, fontSize: 12, fontWeight: '600', flex: 1 }}>
                  {t('ac_time_exceeds_total')}
                </Text>
              </View>
            )}
          </>
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
                  {t('save')} {readyBlocks.length} {readyBlocks.length === 1 ? t('block_singular') : t('block_plural')}
                </Text>
              </>
            )}
        </TouchableOpacity>

        <Text style={styles.hint}>
          {t('manual_hint')}
        </Text>

        <PremiumModal visible={showPremiumModal} onClose={() => setShowPremiumModal(false)} feature={t('prem_feat_ai_title')} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
