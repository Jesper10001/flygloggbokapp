import { useState, useEffect } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, Alert, Keyboard, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DR } from '../constants/droneTheme';
import { useDroneAccentStore } from '../store/droneAccentStore';
import { useTranslation } from '../hooks/useTranslation';
import { lookupDrone } from '../services/droneLookup';
import { useFlightStore } from '../store/flightStore';
import { hasTokenQuota, showMonthlyTokenLimitAlert, isTokenQuotaError } from '../utils/tokenGate';
import { PremiumModal } from './PremiumModal';
import { CIVIL_CATEGORIES, MILITARY_TOP_LEVEL, NATO_CLASSES, categoryFromCClass } from '../constants/droneCategories';
import type { DroneRegistryEntry, DroneType, DroneCategory } from '../db/drones';

type Airframe = 'multirotor' | 'helicopter' | 'fixedwing';
// Detaljerad klass ur droneCategories: civil (A1–Certified) · militär (MRPAS/RPAS/NATO I–III).
type DroneClass = string;

// Klass-val i TRE grupper (Civil / Military general / NATO). Endast EN klass kan väljas totalt.
type ClassGroupKey = 'civil' | 'military' | 'nato';
const CLASS_GROUPS: { key: ClassGroupKey; label: string; icon: keyof typeof Ionicons.glyphMap; options: { value: string; label: string; note?: string }[] }[] = [
  { key: 'civil',    label: 'Civil',            icon: 'business', options: CIVIL_CATEGORIES.map((c) => ({ value: c, label: c })) },
  { key: 'military', label: 'Military general',  icon: 'shield',   options: MILITARY_TOP_LEVEL.map((c) => ({ value: c, label: c })) },
  { key: 'nato',     label: 'NATO',             icon: 'ribbon',   options: NATO_CLASSES.flatMap((g) => g.options) },
];

// AI kan returnera 'vtol' — vik in i fixed-wing för airframe-toggeln (3 val).
function toAirframe(t: DroneType | string): Airframe | '' {
  if (t === 'multirotor') return 'multirotor';
  if (t === 'helicopter') return 'helicopter';
  if (t === 'fixedwing' || t === 'vtol') return 'fixedwing';
  return '';
}

type Props = {
  visible: boolean;
  editMode?: boolean;
  initial?: DroneRegistryEntry | null;
  initialModel?: string; // förifylld modell (t.ex. från type-fältet)
  onSave: (data: Omit<DroneRegistryEntry, 'id'>) => Promise<void>;
  onClose: () => void;
};

export function DroneModal({ visible, editMode, initial, initialModel, onSave, onClose }: Props) {
  const accent = useDroneAccentStore((s) => s.color);
  const styles = makeStyles(accent);
  const { t } = useTranslation();
  const { isPremium, isMax } = useFlightStore();

  const [model, setModel] = useState('');
  const [airframe, setAirframe] = useState<Airframe | ''>('');
  const [weight, setWeight] = useState('');           // råvärde i vald enhet
  const [weightUnit, setWeightUnit] = useState<'g' | 'kg'>('g');
  const [droneClass, setDroneClass] = useState<DroneClass>('');
  const [openDropdown, setOpenDropdown] = useState<ClassGroupKey | null>(null);
  const [saving, setSaving] = useState(false);
  const [looking, setLooking] = useState(false);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [maker, setMaker] = useState('');

  useEffect(() => {
    if (!visible) return;
    setModel(initial?.model ?? initialModel ?? '');
    setAirframe(toAirframe(initial?.drone_type ?? ''));
    const g = initial?.mtow_g ?? 0;
    if (g >= 1000) { setWeight(String(Math.round(g / 10) / 100)); setWeightUnit('kg'); }
    else { setWeight(g > 0 ? String(g) : ''); setWeightUnit('g'); }
    // Läs klassen från `category` (enat fält); fall tillbaka på gamla drone_class för äldre poster.
    setDroneClass((initial?.category as DroneClass) || (initial?.drone_class as DroneClass) || '');
    setOpenDropdown(null);
    setMaker('');
  }, [visible, initial, initialModel]);

  const gramsFromInput = (): number => {
    const n = parseFloat(weight.replace(',', '.')) || 0;
    return weightUnit === 'kg' ? Math.round(n * 1000) : Math.round(n);
  };

  const handleSmartLookup = async () => {
    if (!hasTokenQuota()) {
      if (isPremium || isMax) showMonthlyTokenLimitAlert(); else setShowPremiumModal(true);
      return;
    }
    const q = model.trim();
    if (!q) { Alert.alert(t('aircraft_lookup_empty_title'), t('aircraft_lookup_empty_body')); return; }
    setLooking(true);
    try {
      const r = await lookupDrone(q);
      if (r.needs_manual || !r.model) {
        Alert.alert(t('aircraft_lookup_unclear_title'), t('aircraft_lookup_unclear_body'));
        return;
      }
      const wStr = r.mtow_g >= 1000 ? `${(r.mtow_g / 1000).toFixed(2)} kg` : `${r.mtow_g} g`;
      const summary = `${r.manufacturer} ${r.model}`.trim()
        + (r.mtow_g ? ` · ${wStr}` : '')
        + `\n${t('drone_scan_confidence')}: ${Math.round(r.confidence * 100)}%`;
      Alert.alert(t('aircraft_lookup_result_title'), summary, [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('drone_scan_apply'),
          onPress: () => {
            Keyboard.dismiss();
            setModel(r.model);
            const af = toAirframe(r.drone_type);
            if (af) setAirframe(af);
            if (r.mtow_g > 0) {
              if (r.mtow_g >= 1000) { setWeight(String(Math.round(r.mtow_g / 10) / 100)); setWeightUnit('kg'); }
              else { setWeight(String(r.mtow_g)); setWeightUnit('g'); }
            }
            setMaker(r.manufacturer);
            // AI-gissning av operativ klass ur EU C-märkningen (C0–C6 → A1/A2/A3/Specific). Bara förval;
            // användaren kan ändra. Saknas C-märkning (t.ex. militär/omärkt) lämnas valet orört.
            const guessedClass = categoryFromCClass(r.c_class);
            if (guessedClass) setDroneClass(guessedClass);
          },
        },
      ]);
    } catch (e: any) {
      if (isTokenQuotaError(e)) {
        if (isPremium || isMax) showMonthlyTokenLimitAlert(); else setShowPremiumModal(true);
      } else {
        Alert.alert(t('error'), e.message || String(e));
      }
    } finally {
      setLooking(false);
    }
  };

  const handleSave = async () => {
    const m = model.trim();
    if (!m) return;
    setSaving(true);
    try {
      await onSave({
        drone_type: (airframe || '') as DroneType,
        model: m,
        registration: initial?.registration ?? '', // registrering matas under Registration-fältet
        mtow_g: gramsFromInput(),
        // Chip-valet ÄR den operativa kategorin → spara till `category` (fältet Log Flight/Fleet använder),
        // inte bara det gamla drone_class-fältet. Så följer Log Flight-kategorin drönarens klass automatiskt.
        category: (droneClass || initial?.category || '') as DroneCategory,
        drone_class: droneClass,
        notes: initial?.notes ?? '',
      });
    } finally {
      setSaving(false);
    }
  };

  const AIRFRAMES: [Airframe, string][] = [
    ['multirotor', 'Multirotor'],
    ['helicopter', 'Single-rotor'],
    ['fixedwing', 'Fixed-wing'],
  ];

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={styles.backdropTouch} onPress={onClose} activeOpacity={1} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>{editMode ? 'Edit drone' : 'New drone'}</Text>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

            {maker ? (
              <View style={{ alignItems: 'center', paddingVertical: 6 }}>
                <Text style={{ color: DR.text2, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>{maker}</Text>
              </View>
            ) : null}

            {/* Modell/typ + AI-smartsearch */}
            <Text style={styles.label}>Model</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={model}
                onChangeText={setModel}
                placeholder="Mavic 3 Pro, Matrice 350…"
                placeholderTextColor={DR.muted}
              />
              <TouchableOpacity onPress={handleSmartLookup} disabled={looking} activeOpacity={0.75} style={styles.aiBtn}>
                {looking ? <ActivityIndicator size="small" color={accent} /> : <Ionicons name="sparkles" size={14} color={accent} />}
                <Text style={styles.aiBtnText}>{looking ? t('drone_scan_loading') : t('aircraft_lookup_btn')}</Text>
              </TouchableOpacity>
            </View>

            {/* Airframe: Multirotor / Single-rotor / Fixed-wing */}
            <Text style={[styles.label, { marginTop: 14 }]}>Airframe</Text>
            <View style={styles.optRow}>
              {AIRFRAMES.map(([key, lbl]) => {
                const active = airframe === key;
                return (
                  <TouchableOpacity key={key} style={[styles.optBtn, active && styles.optBtnActive]} onPress={() => setAirframe(active ? '' : key)} activeOpacity={0.7}>
                    <Text style={[styles.optLabel, active && styles.optLabelActive]}>{lbl}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Vikt (g/kg) — under 1 kg presenteras i gram */}
            <Text style={[styles.label, { marginTop: 14 }]}>Weight (MTOW)</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={weight}
                onChangeText={setWeight}
                placeholder={weightUnit === 'kg' ? '1.5' : '750'}
                placeholderTextColor={DR.muted}
                keyboardType="decimal-pad"
              />
              <View style={styles.unitRow}>
                {(['g', 'kg'] as const).map((u) => {
                  const active = weightUnit === u;
                  return (
                    <TouchableOpacity
                      key={u}
                      style={[styles.unitBtn, active && styles.unitBtnActive]}
                      onPress={() => {
                        if (u === weightUnit) return;
                        // Konvertera värdet vid enhetsbyte så det inte tolkas fel.
                        const n = parseFloat(weight.replace(',', '.')) || 0;
                        if (u === 'kg' && weightUnit === 'g') setWeight(n ? String(Math.round(n / 10) / 100) : '');
                        if (u === 'g' && weightUnit === 'kg') setWeight(n ? String(Math.round(n * 1000)) : '');
                        setWeightUnit(u);
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.unitText, active && styles.unitTextActive]}>{u}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            {/* Klass — 3 kompakta dropdowns (Civil / Military general / NATO). Endast EN klass väljbar totalt. */}
            <Text style={[styles.label, { marginTop: 14 }]}>Class</Text>
            <View style={{ gap: 8 }}>
              {CLASS_GROUPS.map((grp) => {
                const sel = grp.options.find((o) => o.value === droneClass);
                const open = openDropdown === grp.key;
                return (
                  <View key={grp.key}>
                    <TouchableOpacity style={styles.ddBtn} activeOpacity={0.75} onPress={() => setOpenDropdown(open ? null : grp.key)}>
                      <Ionicons name={grp.icon} size={13} color={DR.text2} />
                      <Text style={styles.ddGroupLabel}>{grp.label}</Text>
                      <Text style={[styles.ddValue, sel && { color: accent }]} numberOfLines={1}>{sel ? sel.label : '—'}</Text>
                      <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={15} color={DR.muted} />
                    </TouchableOpacity>
                    {open && (
                      <View style={styles.ddList}>
                        {grp.options.map((o) => {
                          const active = droneClass === o.value;
                          return (
                            <TouchableOpacity key={o.value} style={[styles.ddItem, active && { backgroundColor: accent + '1A' }]}
                              onPress={() => { setDroneClass(active ? '' : o.value); setOpenDropdown(null); }} activeOpacity={0.7}>
                              <Text style={[styles.ddItemText, active && { color: accent, fontWeight: '800' }]}>{o.label}</Text>
                              {o.note ? <Text style={styles.ddItemNote}>{o.note}</Text> : null}
                              {active && <Ionicons name="checkmark" size={15} color={accent} style={{ marginLeft: 'auto' }} />}
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>

          </ScrollView>
          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.7}>
              <Text style={styles.cancelBtnText}>{t('cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, (!model.trim() || saving) && { opacity: 0.5 }]}
              onPress={handleSave}
              disabled={saving || !model.trim()}
              activeOpacity={0.8}
            >
              {saving ? <ActivityIndicator color={DR.inkOnAccent} size="small" /> : <Text style={styles.saveBtnText}>{t('save')}</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
      <PremiumModal visible={showPremiumModal} onClose={() => setShowPremiumModal(false)} feature={t('aircraft_lookup_btn')} />
    </Modal>
  );
}

function makeStyles(accent: string) {
  return StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end' },
    backdropTouch: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: {
      backgroundColor: DR.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
      padding: 20, paddingBottom: 40, gap: 10, borderWidth: 1, borderColor: DR.border, maxHeight: '90%',
    },
    handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: DR.border, alignSelf: 'center', marginBottom: 4 },
    title: { color: DR.text, fontSize: 17, fontWeight: '700', marginBottom: 4 },
    label: { color: DR.text2, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 },
    input: {
      backgroundColor: DR.elevated, borderRadius: 8, padding: 11, borderWidth: 1, borderColor: DR.border,
      color: DR.text, fontSize: 15, fontWeight: '600',
    },
    aiBtn: {
      paddingHorizontal: 14, borderRadius: 10, backgroundColor: accent + '1F', borderWidth: 1, borderColor: accent + '88',
      alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6,
    },
    aiBtnText: { color: accent, fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
    optRow: { flexDirection: 'row', gap: 6 },
    optBtn: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 8, borderWidth: 1, borderColor: DR.border, backgroundColor: DR.elevated },
    optBtnActive: { borderColor: accent, backgroundColor: accent + '22' },
    optLabel: { color: DR.text2, fontSize: 12, fontWeight: '700' },
    optLabelActive: { color: accent },
    // Klass-dropdowns (Civil / Military general / NATO) — kompakta, spar höjd.
    ddBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 11, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: DR.border, backgroundColor: DR.elevated },
    ddGroupLabel: { color: DR.text2, fontSize: 12, fontWeight: '700' },
    ddValue: { flex: 1, textAlign: 'right', color: DR.muted, fontSize: 13, fontWeight: '700' },
    ddList: { marginTop: 4, borderRadius: 8, borderWidth: 1, borderColor: DR.border, backgroundColor: DR.elevated, overflow: 'hidden' },
    ddItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: DR.separator },
    ddItemText: { color: DR.text, fontSize: 13.5, fontWeight: '700' },
    ddItemNote: { color: DR.muted, fontSize: 11 },
    unitRow: { flexDirection: 'row', backgroundColor: DR.elevated, borderRadius: 8, borderWidth: 1, borderColor: DR.border, padding: 2, gap: 2 },
    unitBtn: { paddingHorizontal: 12, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
    unitBtnActive: { backgroundColor: accent },
    unitText: { color: DR.text2, fontSize: 13, fontWeight: '800' },
    unitTextActive: { color: DR.inkOnAccent },
    btnRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
    cancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 10, borderWidth: 1, borderColor: DR.border, backgroundColor: DR.elevated },
    cancelBtnText: { color: DR.text2, fontSize: 15, fontWeight: '600' },
    saveBtn: { flex: 2, alignItems: 'center', paddingVertical: 13, borderRadius: 10, backgroundColor: accent },
    saveBtnText: { color: DR.inkOnAccent, fontSize: 15, fontWeight: '700' },
  });
}
