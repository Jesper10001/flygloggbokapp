import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, Alert, Keyboard, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { useTranslation } from '../hooks/useTranslation';
import { lookupAircraft, type AircraftLookupResult } from '../services/aircraftLookup';
import { enrichFleetInBackground, enrichFromLookup } from '../services/fleetEnrich';
import { isAiConsentError } from '../services/aiConsent';
import { useFlightStore } from '../store/flightStore';
import { hasTokenQuota, showMonthlyTokenLimitAlert, isTokenQuotaError } from '../utils/tokenGate';
import { PremiumModal } from './PremiumModal';
import { presentPaywall } from '../services/purchases';
import { getAllAircraftTypes, getAircraftAliases, setAircraftAlias, deleteAircraftAlias, setAircraftFamily, type AircraftRegistryEntry } from '../db/flights';
import { typeKey } from '../services/scanTypes';
import { sameFamily, distinctVariants, familyName } from '../services/aircraftFamily';

type CrewKey = 'sp' | 'mp';
type Category = 'airplane' | 'helicopter' | '';
type EngineType = 'se' | 'me' | '';


function parseCrewType(raw: string): Set<CrewKey> {
  if (!raw) return new Set();
  return new Set(raw.split(',').map((s) => s.trim()).filter((s): s is CrewKey => s === 'sp' || s === 'mp'));
}

function serializeCrewType(set: Set<CrewKey>): string {
  return set.size === 0 ? '' : [...set].sort().join(',');
}

type Props = {
  visible: boolean;
  editMode?: boolean;
  initialType?: string;
  initialSpeedKts?: number;
  initialEnduranceH?: number;
  initialCrewType?: string;
  initialCategory?: string;
  initialEngineType?: string;
  onSave: (type: string, speedKts: number, enduranceH: number, crewType: string, category: Category, engineType: EngineType) => Promise<void>;
  onClose: () => void;
};

function makeStyles() {
  return StyleSheet.create({
    backdrop: { flex: 1, justifyContent: 'flex-end' },
    backdropTouch: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
    sheet: {
      backgroundColor: Colors.card,
      borderTopLeftRadius: 20, borderTopRightRadius: 20,
      padding: 20, paddingBottom: 40, gap: 10,
      borderWidth: 1, borderColor: Colors.border,
      maxHeight: '90%',
    },
    handle: {
      width: 36, height: 4, borderRadius: 2,
      backgroundColor: Colors.border,
      alignSelf: 'center', marginBottom: 4,
    },
    title: { color: Colors.textPrimary, fontSize: 17, fontWeight: '700', marginBottom: 4 },
    label: {
      color: Colors.textSecondary, fontSize: 11, fontWeight: '700',
      textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4,
    },
    input: {
      backgroundColor: Colors.elevated, borderRadius: 8, padding: 11,
      borderWidth: 1, borderColor: Colors.border,
      color: Colors.textPrimary, fontSize: 15, fontWeight: '600',
    },
    inputReadOnly: { opacity: 0.6 },
    row: { flexDirection: 'row', gap: 10 },

    optRow: { flexDirection: 'row', gap: 6 },
    optBtn: {
      flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 8,
      borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.elevated,
    },
    optBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' },
    optLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700' },
    optLabelActive: { color: Colors.primary },
    optSub: { color: Colors.textMuted, fontSize: 9, marginTop: 1 },

    btnRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
    cancelBtn: {
      flex: 1, alignItems: 'center', paddingVertical: 13, borderRadius: 10,
      borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.elevated,
    },
    cancelBtnText: { color: Colors.textSecondary, fontSize: 15, fontWeight: '600' },
    saveBtn: {
      flex: 2, alignItems: 'center', paddingVertical: 13, borderRadius: 10,
      backgroundColor: Colors.primary,
    },
    saveBtnText: { color: Colors.textInverse, fontSize: 15, fontWeight: '700' },
    famCard: { marginTop: 12, padding: 12, gap: 10, borderRadius: 12, borderWidth: 1, borderColor: Colors.primary + '66', backgroundColor: Colors.primary + '10' },
    famTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
    famSub: { color: Colors.textSecondary, fontSize: 12, lineHeight: 16 },
    famChoice: { flexDirection: 'row', gap: 10, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.elevated },
    famChoiceOn: { borderColor: Colors.primary, backgroundColor: Colors.primary + '1A' },
    famChoiceTitle: { color: Colors.textPrimary, fontSize: 13.5, fontWeight: '700' },
    famRadio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
    famRadioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: Colors.primary },
    famUsed: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 10, borderWidth: 1, borderStyle: 'dashed', borderColor: Colors.border },
  });
}

export function AircraftModal({
  visible, editMode, initialType, initialSpeedKts, initialEnduranceH,
  initialCrewType, initialCategory, initialEngineType, onSave, onClose,
}: Props) {
  const styles = makeStyles();
  const { t } = useTranslation();
  const [type, setType] = useState(initialType ?? '');
  const [speed, setSpeed] = useState('');
  const [endurance, setEndurance] = useState('');
  const [crewTypes, setCrewTypes] = useState<Set<CrewKey>>(new Set());
  const [category, setCategory] = useState<Category>('');
  const [engineType, setEngineType] = useState<EngineType>('');
  const [saving, setSaving] = useState(false);
  const [looking, setLooking] = useState(false);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const { isPremium, isMax } = useFlightStore();
  const [lookupInfo, setLookupInfo] = useState<{ manufacturer: string; model: string } | null>(null);
  const lastLookup = useRef<AircraftLookupResult | null>(null); // fullt smart-search-resultat → berika utan extra AI
  // Familjer (services/aircraftFamily.ts): en ny typ i samma familj som en i flottan (EC135T2 när flottan har
  // EC135T1) läggs till som variant (förval, specifikationerna fylls i från familjen) eller loggas som den
  // befintliga ("Merge into …"). Valet sparas som alias och frågas inte igen.
  const [fleet, setFleet] = useState<AircraftRegistryEntry[]>([]);
  const [aliases, setAliases] = useState<Map<string, string>>(new Map());
  const [famChoice, setFamChoice] = useState<'variant' | 'merge'>('variant');
  const prefilledFrom = useRef<string | null>(null);

  const handleSmartLookup = async () => {
    // Token-styrt, inte premium-låst: fri nivå får slå upp tills engångspotten tar slut.
    if (!hasTokenQuota()) {
      if (isPremium || isMax) { showMonthlyTokenLimitAlert(); } else { presentPaywall(); }
      return;
    }
    const q = type.trim();
    if (!q) {
      Alert.alert(t('aircraft_lookup_empty_title'), t('aircraft_lookup_empty_body'));
      return;
    }
    setLooking(true);
    try {
      const r = await lookupAircraft(q);
      if (r.needs_manual || !r.aircraft_type) {
        Alert.alert(t('aircraft_lookup_unclear_title'), t('aircraft_lookup_unclear_body'));
        return;
      }
      const summary = `${r.manufacturer} ${r.model}`.trim()
        + (r.cruise_speed_kts ? ` · ${r.cruise_speed_kts} kt` : '')
        + (r.endurance_h ? ` · ${r.endurance_h} h` : '')
        + `\n${t('drone_scan_confidence')}: ${Math.round(r.confidence * 100)}%`;
      Alert.alert(
        t('aircraft_lookup_result_title'),
        summary,
        [
          { text: t('cancel'), style: 'cancel' },
          {
            text: t('drone_scan_apply'),
            onPress: () => {
              Keyboard.dismiss();
              setType(r.aircraft_type);
              if (r.cruise_speed_kts > 0) setSpeed(String(r.cruise_speed_kts));
              if (r.endurance_h > 0) setEndurance(String(r.endurance_h));
              if (r.category) setCategory(r.category);
              if (r.engine_type) setEngineType(r.engine_type);
              if (r.crew_type) setCrewTypes(parseCrewType(r.crew_type));
              setLookupInfo({ manufacturer: r.manufacturer, model: r.model });
              lastLookup.current = r; // spara hela resultatet → full Fleet-berikning vid save utan ny AI

            },
          },
        ],
      );
    } catch (e: any) {
      if (isAiConsentError(e)) return; // användaren valde "Not now" — inget fel att visa
      if (isTokenQuotaError(e)) {
        if (isPremium || isMax) showMonthlyTokenLimitAlert(); else presentPaywall();
      } else {
        Alert.alert(t('error'), e.message || String(e));
      }
    } finally {
      setLooking(false);
    }
  };

  useEffect(() => {
    if (visible) {
      setType(initialType ?? '');
      setSpeed(initialSpeedKts && initialSpeedKts > 0 ? String(initialSpeedKts) : '');
      setEndurance(initialEnduranceH && initialEnduranceH > 0 ? String(initialEnduranceH) : '');
      setCrewTypes(parseCrewType(initialCrewType ?? ''));
      const cat = initialCategory ?? '';
      setCategory(cat === 'airplane' || cat === 'helicopter' ? cat : '');
      const eng = initialEngineType ?? '';
      setEngineType(eng === 'se' || eng === 'me' ? eng : '');
      setLookupInfo(null);
      lastLookup.current = null;
      prefilledFrom.current = null;
      if (!editMode) {
        Promise.all([getAllAircraftTypes(), getAircraftAliases()])
          .then(([f, a]) => { setFleet(f); setAliases(a); })
          .catch(() => {});
      }
    }
  }, [visible, initialType, initialSpeedKts, initialEnduranceH, initialCrewType, initialCategory, initialEngineType]);

  // Typen som skrivs: finns den redan, är den ett alias (valt tidigare), eller en ny variant i en familj?
  const fam = useMemo(() => {
    const k = typeKey(type);
    if (editMode || k.length < 3 || fleet.some((a) => typeKey(a.aircraft_type) === k)) return null;
    const alias = aliases.get(k);
    if (alias) return { kind: 'alias' as const, target: alias, family: familyName([k, alias]) ?? alias, peer: fleet.find((a) => a.aircraft_type === alias) ?? null };
    const peers = fleet
      .filter((a) => !(a.family_locked && !a.family) && sameFamily(k, a.aircraft_type))
      .sort((a, b) => Number(distinctVariants(k, b.aircraft_type)) - Number(distinctVariants(k, a.aircraft_type)) || (b.total_hours || 0) - (a.total_hours || 0));
    const peer = peers[0];
    if (!peer) return null;
    return { kind: 'family' as const, target: peer.aircraft_type, family: peer.family || familyName([k, peer.aircraft_type]) || peer.aircraft_type, peer };
  }, [type, fleet, aliases, editMode]);
  const merging = !!fam && famChoice === 'merge';
  useEffect(() => { setFamChoice(fam?.kind === 'alias' ? 'merge' : 'variant'); }, [fam?.kind, fam?.target]);
  // Ny variant: specifikationerna fylls i från familjen (bara tomma fält, en gång per typ i familjen).
  useEffect(() => {
    const p = fam?.peer;
    if (!p || famChoice !== 'variant' || prefilledFrom.current === p.aircraft_type) return;
    prefilledFrom.current = p.aircraft_type;
    if (!speed && p.cruise_speed_kts > 0) setSpeed(String(p.cruise_speed_kts));
    if (!endurance && p.endurance_h > 0) setEndurance(String(p.endurance_h));
    if (!crewTypes.size && p.crew_type) setCrewTypes(parseCrewType(p.crew_type));
    if (!category && (p.category === 'airplane' || p.category === 'helicopter')) setCategory(p.category);
    if (!engineType && (p.engine_type === 'se' || p.engine_type === 'me')) setEngineType(p.engine_type);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fam?.peer?.aircraft_type, famChoice]);

  const toggleCrew = (key: CrewKey) => {
    setCrewTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const handleSave = async () => {
    const trimmed = type.trim().toUpperCase();
    if (!trimmed) return;
    setSaving(true);
    try {
      // "Merge into …": typen loggas som den befintliga; valet sparas så att det inte frågas igen.
      if (fam && merging) {
        await setAircraftAlias(typeKey(trimmed), fam.target);
        await onSave(fam.target, 0, 0, '', '', '');   // finns redan; tomma värden skriver inte över något
        return;
      }
      if (fam?.kind === 'alias') await deleteAircraftAlias(typeKey(trimmed));
      await onSave(trimmed, parseInt(speed) || 0, parseFloat(endurance.replace(',', '.')) || 0, serializeCrewType(crewTypes), category, engineType);
      // Ny variant: samma familj som den befintliga typen (Fleet räknar också fram det, men Log Flight öppnar inte Fleet).
      if (fam) {
        await setAircraftFamily(trimmed, fam.family).catch(() => {});
        if (fam.peer && !fam.peer.family) await setAircraftFamily(fam.peer.aircraft_type, fam.family).catch(() => {});
      }
      // Hämta resten av Fleet-datan (VNE/MTOW/consumption/bild) i BAKGRUNDEN så kortet är komplett när
      // man öppnar Fleet. Gäller bara nya farkoster (ej redigering). Har smart search redan körts återanvänds
      // dess resultat (ingen ny AI); annars full uppslagning. Fire-and-forget, tyst, token-gated.
      if (!editMode) {
        const lk = lastLookup.current;
        if (lk && lk.aircraft_type?.toUpperCase() === trimmed) enrichFromLookup(trimmed, lk);
        else enrichFleetInBackground([trimmed]);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <TouchableOpacity style={styles.backdropTouch} onPress={onClose} activeOpacity={1} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>{editMode ? t('edit_aircraft') : t('new_aircraft')}</Text>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          {lookupInfo && (
            <View style={{ alignItems: 'center', paddingVertical: 6 }}>
              <Text style={{ color: Colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 }}>
                {lookupInfo.manufacturer} {lookupInfo.model}
              </Text>
            </View>
          )}

          <Text style={styles.label}>{t('aircraft_type')}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput
              style={[styles.input, editMode && styles.inputReadOnly, { flex: 1 }]}
              value={type}
              onChangeText={(v) => { if (!editMode) setType(v.toUpperCase()); }}
              placeholder="C172, R44, A320…"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="characters"
              editable={!editMode}
            />
            {!editMode && (
              <TouchableOpacity
                onPress={handleSmartLookup}
                disabled={looking}
                activeOpacity={0.75}
                style={{
                  paddingHorizontal: 14,
                  borderRadius: 10,
                  backgroundColor: Colors.primary + '1F',
                  borderWidth: 1,
                  borderColor: Colors.primary + '88',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  gap: 6,
                }}
              >
                {looking
                  ? <ActivityIndicator size="small" color={Colors.primary} />
                  : <Ionicons name="sparkles" size={14} color={Colors.primary} />}
                <Text style={{ color: Colors.primary, fontSize: 12, fontWeight: '800', letterSpacing: 0.3 }}>
                  {looking ? t('drone_scan_loading') : t('aircraft_lookup_btn')}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {fam ? (
            <View style={styles.famCard}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Ionicons name="git-merge-outline" size={17} color={Colors.primary} style={{ marginTop: 1 }} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={styles.famTitle}>
                    {fam.kind === 'alias' ? `${type.trim().toUpperCase()} is logged as ${fam.target}` : `${type.trim().toUpperCase()} is in the ${fam.family} family`}
                  </Text>
                  <Text style={styles.famSub}>
                    {fam.kind === 'alias' ? 'You chose this when you added it before.'
                      : `You already have ${fam.target} in your fleet${fam.peer?.total_hours ? ` (${fam.peer.total_hours.toFixed(1)} h)` : ''}.`}
                  </Text>
                </View>
              </View>
              {([['variant', fam.kind === 'alias' ? `Add ${type.trim().toUpperCase()} as its own variant` : 'Add as a variant',
                'Its own specs and hours. Shares the type rating and the family total.'],
                ['merge', fam.kind === 'alias' ? `Log as ${fam.target}` : `Merge into ${fam.target}`,
                `Flights are logged as ${fam.target}, with one set of specs.`]] as const).map(([key, title, sub]) => {
                const on = famChoice === key;
                return (
                  <TouchableOpacity key={key} onPress={() => setFamChoice(key)} activeOpacity={0.8}
                    style={[styles.famChoice, on && styles.famChoiceOn]} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                    <View style={[styles.famRadio, on && { borderColor: Colors.primary }]}>{on ? <View style={styles.famRadioDot} /> : null}</View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.famChoiceTitle}>{title}</Text>
                      <Text style={styles.famSub}>{sub}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}

          {merging ? (
            <View style={styles.famUsed}>
              <Ionicons name="arrow-forward" size={16} color={Colors.textSecondary} />
              <Text style={[styles.famSub, { flex: 1 }]}>Uses {fam!.target}'s specs. You can change them on its Fleet card.</Text>
            </View>
          ) : (<>
          <View style={[styles.row, { marginTop: 14 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>{t('cruise_speed_kts')}</Text>
              <TextInput
                style={styles.input}
                value={speed}
                onChangeText={setSpeed}
                placeholder="110"
                placeholderTextColor={Colors.textMuted}
                keyboardType="number-pad"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>{t('endurance_h')}</Text>
              <TextInput
                style={styles.input}
                value={endurance}
                onChangeText={setEndurance}
                placeholder="3.0"
                placeholderTextColor={Colors.textMuted}
                keyboardType="decimal-pad"
              />
            </View>
          </View>

          {/* SP / MP  +  SE / ME */}
          <Text style={[styles.label, { marginTop: 14 }]}>{t('crew_type')}</Text>
          <View style={styles.optRow}>
            {(['sp', 'mp'] as const).map((key) => {
              const active = crewTypes.has(key);
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.optBtn, active && styles.optBtnActive]}
                  onPress={() => toggleCrew(key)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.optLabel, active && styles.optLabelActive]}>
                    {key === 'sp' ? 'SP' : 'MP'}
                  </Text>
                  <Text style={styles.optSub}>{key === 'sp' ? 'Single pilot' : 'Multi-pilot'}</Text>
                </TouchableOpacity>
              );
            })}
            {(['se', 'me'] as const).map((key) => {
              const active = engineType === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[styles.optBtn, active && styles.optBtnActive]}
                  onPress={() => setEngineType(active ? '' : key)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.optLabel, active && styles.optLabelActive]}>
                    {key === 'se' ? 'SE' : 'ME'}
                  </Text>
                  <Text style={styles.optSub}>{key === 'se' ? 'Single engine' : 'Multi engine'}</Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Airplane / Helicopter */}
          <View style={[styles.optRow, { marginTop: 8 }]}>
            {(['airplane', 'helicopter'] as const).map((cat) => {
              const active = category === cat;
              return (
                <TouchableOpacity
                  key={cat}
                  style={[styles.optBtn, { flex: 1 }, active && styles.optBtnActive]}
                  onPress={() => setCategory(active ? '' : cat)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.optLabel, active && styles.optLabelActive]}>
                    {cat === 'airplane' ? t('airplane') : t('helicopter')}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          </>)}

          </ScrollView>
          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.7}>
              <Text style={styles.cancelBtnText}>{t('cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.saveBtn, (!type.trim() || saving) && { opacity: 0.5 }]}
              onPress={handleSave}
              disabled={saving || !type.trim()}
              activeOpacity={0.8}
            >
              {saving ? (
                <ActivityIndicator color={Colors.textInverse} size="small" />
              ) : (
                <Text style={styles.saveBtnText}>{merging ? `Use ${fam!.target}` : fam ? `Add ${type.trim().toUpperCase()}` : t('save')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
      <PremiumModal visible={showPremiumModal} onClose={() => setShowPremiumModal(false)} feature={t('aircraft_lookup_btn')} />
    </Modal>
  );
}
