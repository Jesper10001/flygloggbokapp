import { useState, useEffect } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform, Alert, Keyboard, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { useTranslation } from '../hooks/useTranslation';
import { lookupAircraft } from '../services/aircraftLookup';
import { Image as RNImage } from 'react-native';

type CrewKey = 'sp' | 'mp';
type Category = 'airplane' | 'helicopter' | '';
type EngineType = 'se' | 'me' | '';

async function fetchAircraftImage(query: string): Promise<string | null> {
  try {
    const searchTerm = encodeURIComponent(`${query} aircraft`);
    const url = `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${searchTerm}&gsrlimit=3&prop=pageimages&piprop=thumbnail&pithumbsize=480&format=json&origin=*`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const pages = data.query?.pages;
    if (!pages) return null;
    for (const id of Object.keys(pages)) {
      const thumb = pages[id]?.thumbnail?.source;
      if (thumb) return thumb;
    }
    return null;
  } catch {
    return null;
  }
}

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
  onSave: (type: string, speedKts: number, enduranceH: number, crewType: string, category: Category, engineType: EngineType, imageUrl?: string) => Promise<void>;
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
  const [lookupInfo, setLookupInfo] = useState<{ manufacturer: string; model: string } | null>(null);
  const [aircraftImageUrl, setAircraftImageUrl] = useState<string | null>(null);

  const handleSmartLookup = async () => {
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
              fetchAircraftImage(`${r.manufacturer} ${r.model}`).then(setAircraftImageUrl).catch(() => {});
            },
          },
        ],
      );
    } catch (e: any) {
      Alert.alert(t('error'), e.message || String(e));
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
      setAircraftImageUrl(null);
    }
  }, [visible, initialType, initialSpeedKts, initialEnduranceH, initialCrewType, initialCategory, initialEngineType]);

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
      await onSave(trimmed, parseInt(speed) || 0, parseFloat(endurance.replace(',', '.')) || 0, serializeCrewType(crewTypes), category, engineType, aircraftImageUrl ?? undefined);
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

          {/* Bild från Wikipedia efter smart sökning */}
          {lookupInfo && (
            <View style={{ alignItems: 'center', gap: 6, paddingVertical: 8 }}>
              {aircraftImageUrl && (
                <RNImage
                  source={{ uri: aircraftImageUrl }}
                  style={{ width: 240, height: 140, borderRadius: 10 }}
                  resizeMode="cover"
                />
              )}
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
                <View style={{
                  backgroundColor: Colors.gold + '22', borderRadius: 4,
                  paddingHorizontal: 4, paddingVertical: 1,
                  borderWidth: 0.5, borderColor: Colors.gold + '66',
                }}>
                  <Text style={{ color: Colors.gold, fontSize: 7, fontWeight: '800' }}>★</Text>
                </View>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.row}>
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
          <Text style={styles.label}>{t('crew_type')}</Text>
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
          <View style={styles.optRow}>
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
                <Text style={styles.saveBtnText}>{t('save')}</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
