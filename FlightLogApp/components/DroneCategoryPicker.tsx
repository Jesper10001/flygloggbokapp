import { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { useTranslation } from '../hooks/useTranslation';
import {
  CIVIL_CATEGORIES, MILITARY_TOP_LEVEL, NATO_CLASSES,
  categoryLabel, type PilotType,
} from '../constants/droneCategories';

interface Props {
  pilotType: PilotType;
  value: string;
  onChange: (v: string) => void;
}

export function DroneCategoryPicker({ pilotType, value, onChange }: Props) {
  const styles = makeStyles();
  const { t } = useTranslation();
  const [natoOpen, setNatoOpen] = useState(false);

  const isNatoValue = value?.startsWith('NATO-');

  if (pilotType === 'commercial') {
    return (
      <View style={styles.chipRow}>
        {CIVIL_CATEGORIES.map((c) => (
          <TouchableOpacity
            key={c}
            style={[styles.chip, value === c && styles.chipActive]}
            onPress={() => onChange(c)}
            activeOpacity={0.75}
          >
            <Text style={[styles.chipText, value === c && styles.chipTextActive]}>{c}</Text>
          </TouchableOpacity>
        ))}
      </View>
    );
  }

  // Militär: MRPAS / RPAS som knappar + "NATO…" som öppnar modal
  return (
    <>
      <View style={styles.milRow}>
        <TouchableOpacity
          style={[styles.milBtn, value === 'MRPAS' && styles.milBtnActive]}
          onPress={() => onChange('MRPAS')}
          activeOpacity={0.75}
        >
          <Text style={[styles.milBtnText, value === 'MRPAS' && styles.milBtnTextActive]}>MRPAS</Text>
          <Text style={[styles.milBtnSub, value === 'MRPAS' && { color: Colors.textInverse + 'CC' }]}>&lt; 25 kg</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.milBtn, value === 'RPAS' && styles.milBtnActive]}
          onPress={() => onChange('RPAS')}
          activeOpacity={0.75}
        >
          <Text style={[styles.milBtnText, value === 'RPAS' && styles.milBtnTextActive]}>RPAS</Text>
          <Text style={[styles.milBtnSub, value === 'RPAS' && { color: Colors.textInverse + 'CC' }]}>&gt; 25 kg</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.milBtn, isNatoValue && styles.milBtnActive]}
          onPress={() => setNatoOpen(true)}
          activeOpacity={0.75}
        >
          <Text style={[styles.milBtnText, isNatoValue && styles.milBtnTextActive]}>NATO</Text>
          <Text style={[styles.milBtnSub, isNatoValue && { color: Colors.textInverse + 'CC' }]} numberOfLines={1}>
            {isNatoValue ? categoryLabel(value).replace('Class ', 'C-') : t('pick_class')}
          </Text>
        </TouchableOpacity>
      </View>

      <Modal visible={natoOpen} transparent animationType="slide" onRequestClose={() => setNatoOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setNatoOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{t('nato_class_title')}</Text>
            <ScrollView style={{ maxHeight: 460 }}>
              {NATO_CLASSES.map((group) => (
                <View key={group.group} style={{ marginBottom: 10 }}>
                  <Text style={styles.groupLabel}>{group.group}</Text>
                  {group.options.map((opt) => (
                    <TouchableOpacity
                      key={opt.value}
                      style={[styles.optionRow, value === opt.value && styles.optionRowActive]}
                      onPress={() => { onChange(opt.value); setNatoOpen(false); }}
                      activeOpacity={0.75}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.optionLabel}>{opt.label}</Text>
                        {opt.note ? <Text style={styles.optionNote}>{opt.note}</Text> : null}
                      </View>
                      {value === opt.value && (
                        <Ionicons name="checkmark" size={18} color={Colors.primary} />
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function makeStyles() {
  return StyleSheet.create({
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: {
      paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8,
      backgroundColor: Colors.elevated, borderWidth: 0.5, borderColor: Colors.border,
    },
    chipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
    chipText: { color: Colors.textMuted, fontSize: 12, fontWeight: '700' },
    chipTextActive: { color: Colors.textInverse },

    milRow: { flexDirection: 'row', gap: 8 },
    milBtn: {
      flex: 1, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 6, borderRadius: 10,
      backgroundColor: Colors.elevated, borderWidth: 0.5, borderColor: Colors.border, gap: 2,
    },
    milBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
    milBtnText: { color: Colors.textPrimary, fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
    milBtnTextActive: { color: Colors.textInverse },
    milBtnSub: { color: Colors.textMuted, fontSize: 10, fontWeight: '600' },

    backdrop: { flex: 1, backgroundColor: '#00000088', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: Colors.surface, borderTopLeftRadius: 18, borderTopRightRadius: 18,
      padding: 18, paddingBottom: 32, borderTopWidth: 0.5, borderTopColor: Colors.border,
    },
    sheetHandle: {
      width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border,
      alignSelf: 'center', marginBottom: 10,
    },
    sheetTitle: {
      color: Colors.textPrimary, fontSize: 16, fontWeight: '800',
      marginBottom: 14, letterSpacing: 0.3,
    },
    groupLabel: {
      color: Colors.textSecondary, fontSize: 11, fontWeight: '700',
      letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6,
    },
    optionRow: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10,
      backgroundColor: Colors.card, borderWidth: 0.5, borderColor: Colors.cardBorder,
      marginBottom: 4,
    },
    optionRowActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '18' },
    optionLabel: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
    optionNote: { color: Colors.textSecondary, fontSize: 11, marginTop: 2 },
  });
}
