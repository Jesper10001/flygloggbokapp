import { useState, useEffect } from 'react';
import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { useTranslation } from '../hooks/useTranslation';
import { useTimeFormat } from '../hooks/useTimeFormat';
import { getNightFlightsMissingNvg, setFlightNvg } from '../db/flights';
import { useFlightStore } from '../store/flightStore';
import { batchPlaceNames } from '../db/icao';
import type { Flight } from '../types/flight';

interface MissingNvgModalProps {
  visible: boolean;
  onClose: () => void;
}

export function MissingNvgModal({ visible, onClose }: MissingNvgModalProps) {
  const { t } = useTranslation();
  const { formatTime } = useTimeFormat();
  const { loadStats } = useFlightStore();
  const insets = useSafeAreaInsets();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loading, setLoading] = useState(false);
  const [placeNames, setPlaceNames] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [nvgHours, setNvgHours] = useState('');

  useEffect(() => {
    if (visible) {
      loadFlights();
    }
  }, [visible]);

  const loadFlights = async () => {
    setLoading(true);
    try {
      const nightFlights = await getNightFlightsMissingNvg();
      setFlights(nightFlights);
      
      const codes = nightFlights
        .flatMap(f => [f.dep_place, f.arr_place])
        .filter(Boolean);
      if (codes.length) {
        const names = await batchPlaceNames(codes);
        setPlaceNames(names);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSaveNvg = async (flightId: number) => {
    const hours = parseFloat(nvgHours);
    if (isNaN(hours) || hours < 0) {
      Alert.alert(t('error'), 'Ange en giltig tid');
      return;
    }

    try {
      await setFlightNvg(flightId, hours);
      await loadStats();
      setFlights(flights.filter(f => f.id !== flightId));
      setEditingId(null);
      setNvgHours('');
    } catch (err) {
      Alert.alert(t('error'), 'Kunde inte spara NVG-timmar');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[s.backdrop, { paddingTop: insets.top }]}>
        <View style={s.container}>
          <View style={s.header}>
            <Text style={s.title}>{t('missing_nvg_title')}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={24} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator color={Colors.primary} size="large" style={{ marginVertical: 40 }} />
          ) : flights.length === 0 ? (
            <View style={s.emptyContainer}>
              <Text style={s.emptyText}>{t('missing_nvg_none')}</Text>
            </View>
          ) : (
            <ScrollView style={s.list} showsVerticalScrollIndicator={false}>
              {flights.map((flight, index) => (
                <View key={flight.id} style={[s.flightRow, index < flights.length - 1 && { borderBottomWidth: 1, borderBottomColor: Colors.separator }]}>
                  <View style={s.flightInfo}>
                    <Text style={s.route}>
                      {placeNames[flight.dep_place] || flight.dep_place} → {placeNames[flight.arr_place] || flight.arr_place}
                    </Text>
                    <Text style={s.meta}>
                      {flight.date} · {flight.aircraft_type} · {formatTime(flight.night)}h night
                    </Text>
                  </View>

                  {editingId === flight.id ? (
                    <View style={s.editContainer}>
                      <View style={s.inputGroup}>
                        <Text style={s.label}>NVG hours</Text>
                        <View style={s.inputRow}>
                          <TouchableOpacity 
                            style={s.inputBtn} 
                            onPress={() => setNvgHours((Math.max(0, parseFloat(nvgHours) || 0) - 0.1).toFixed(1))}
                          >
                            <Ionicons name="remove" size={16} color={Colors.primary} />
                          </TouchableOpacity>
                          <Text style={s.inputValue}>{nvgHours || '0'}</Text>
                          <TouchableOpacity 
                            style={s.inputBtn}
                            onPress={() => setNvgHours(((parseFloat(nvgHours) || 0) + 0.1).toFixed(1))}
                          >
                            <Ionicons name="add" size={16} color={Colors.primary} />
                          </TouchableOpacity>
                        </View>
                      </View>
                      <View style={s.buttonRow}>
                        <TouchableOpacity style={s.cancelBtn} onPress={() => setEditingId(null)}>
                          <Text style={s.cancelBtnText}>{t('cancel')}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={s.saveBtn} onPress={() => handleSaveNvg(flight.id)}>
                          <Text style={s.saveBtnText}>{t('save')}</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : (
                    <TouchableOpacity 
                      style={s.editBtn}
                      onPress={() => {
                        setEditingId(flight.id);
                        setNvgHours(String(flight.nvg || 0));
                      }}
                    >
                      <Ionicons name="pencil" size={16} color={Colors.primary} />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: 20 },
  container: { backgroundColor: Colors.card, borderRadius: 16, maxHeight: '80%', borderWidth: 1, borderColor: Colors.border },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.separator },
  title: { color: Colors.textPrimary, fontSize: 17, fontWeight: '700', flex: 1 },
  list: { paddingHorizontal: 16 },
  emptyContainer: { padding: 32, alignItems: 'center' },
  emptyText: { color: Colors.textMuted, fontSize: 14, textAlign: 'center' },
  flightRow: { paddingVertical: 16 },
  flightInfo: { marginBottom: 12 },
  route: { color: Colors.textPrimary, fontSize: 15, fontWeight: '600', marginBottom: 4 },
  meta: { color: Colors.textSecondary, fontSize: 12 },
  editBtn: { paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center' },
  editContainer: { gap: 12 },
  inputGroup: { gap: 6 },
  label: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inputBtn: { width: 36, height: 36, borderRadius: 8, backgroundColor: Colors.primary + '22', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.primary + '44' },
  inputValue: { flex: 1, textAlign: 'center', color: Colors.textPrimary, fontSize: 15, fontWeight: '600' },
  buttonRow: { flexDirection: 'row', gap: 8 },
  cancelBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: Colors.elevated, alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  cancelBtnText: { color: Colors.textSecondary, fontWeight: '600', fontSize: 14 },
  saveBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, backgroundColor: Colors.primary, alignItems: 'center' },
  saveBtnText: { color: Colors.textInverse, fontWeight: '700', fontSize: 14 },
});
