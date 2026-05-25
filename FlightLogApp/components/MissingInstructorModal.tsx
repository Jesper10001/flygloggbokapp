import { useState, useEffect, useRef } from 'react';
import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Animated, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Colors } from '../constants/colors';
import { useTranslation } from '../hooks/useTranslation';
import { useTimeFormat } from '../hooks/useTimeFormat';
import { getInstructorFlightsMissingTracking, setFlightInstructor } from '../db/flights';
import { useFlightStore } from '../store/flightStore';
import { batchPlaceNames } from '../db/icao';
import type { Flight } from '../types/flight';

interface MissingInstructorModalProps {
  visible: boolean;
  onClose: () => void;
  onCountUpdate?: (count: number) => void;
  onTotalInstructorUpdate?: (hours: number) => void;
}

export function MissingInstructorModal({ visible, onClose, onCountUpdate, onTotalInstructorUpdate }: MissingInstructorModalProps) {
  const { t } = useTranslation();
  const { formatTime } = useTimeFormat();
  const { loadStats } = useFlightStore();
  const insets = useSafeAreaInsets();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loading, setLoading] = useState(false);
  const [placeNames, setPlaceNames] = useState<Record<string, string>>({});
  const [remainingCount, setRemainingCount] = useState(0);
  const [totalInstructorAdded, setTotalInstructorAdded] = useState(0);
  const animatedValue = useRef(new Animated.Value(0)).current;
  const [displayedValue, setDisplayedValue] = useState(0);

  const [showYearPicker, setShowYearPicker] = useState(true);
  const currentYear = new Date().getFullYear();
  const [startYear, setStartYear] = useState(String(currentYear - 1));
  const [endYear, setEndYear] = useState(String(currentYear));

  // Reset to year picker when modal opens
  useEffect(() => {
    if (visible) {
      setShowYearPicker(true);
      setStartYear(String(currentYear - 1));
      setEndYear(String(currentYear));
      setFlights([]);
    }
  }, [visible]);

  const handleYearRangeSelected = async () => {
    if (!startYear || !endYear) {
      Alert.alert('Error', 'Please enter both start and end years');
      return;
    }

    const startYearNum = parseInt(startYear, 10);
    const endYearNum = parseInt(endYear, 10);

    if (isNaN(startYearNum) || isNaN(endYearNum)) {
      Alert.alert('Error', 'Years must be numbers');
      return;
    }

    if (startYearNum > endYearNum) {
      Alert.alert('Error', 'Start year must be before end year');
      return;
    }

    setShowYearPicker(false);
    setLoading(true);
    try {
      const startDate = `${startYearNum}-01-01`;
      const endDate = `${endYearNum}-12-31`;
      const flightList = await getInstructorFlightsMissingTracking(startDate, endDate);
      setFlights(flightList);
      setRemainingCount(flightList.length);
      onCountUpdate?.(flightList.length);

      setTotalInstructorAdded(0);
      setDisplayedValue(0);
      animatedValue.setValue(0);
      onTotalInstructorUpdate?.(0);

      const codes = flightList
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

  const animateValue = (newTotal: number) => {
    Animated.timing(animatedValue, {
      toValue: newTotal,
      duration: 1000,
      useNativeDriver: false,
    }).start();

    const listener = animatedValue.addListener(({ value }) => {
      setDisplayedValue(Math.round(value * 10) / 10);
    });

    return () => animatedValue.removeListener(listener);
  };

  const handleSaveInstructor = async (flightId: number, flight: Flight) => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await setFlightInstructor(flightId, flight.total_time);
      await loadStats();

      const newTotal = totalInstructorAdded + flight.total_time;
      setTotalInstructorAdded(newTotal);
      onTotalInstructorUpdate?.(newTotal);
      animateValue(newTotal);

      setFlights(flights.filter(f => f.id !== flightId));
    } catch (err) {
      Alert.alert(t('error'), 'Kunde inte spara INSTRUCTOR-timmar');
    }
  };

  const handleSkipInstructor = (flightId: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFlights(flights.filter(f => f.id !== flightId));
  };

  return (
    <>
      <Modal visible={visible && showYearPicker} transparent animationType="fade" onRequestClose={onClose}>
        <View style={[s.backdrop, { paddingTop: insets.top }]}>
          <View style={s.container}>
            <View style={s.header}>
              <View style={{ flex: 1 }}>
                <Text style={s.title}>Missing instructor hours?</Text>
              </View>
              <TouchableOpacity onPress={onClose} hitSlop={12}>
                <Ionicons name="close" size={24} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
              <Text style={{ color: Colors.textMuted, fontSize: 12, fontWeight: '600' }}>Select year range</Text>
            </View>

            <View style={{ padding: 16, gap: 20 }}>
              <View>
                <Text style={s.label}>Start year</Text>
                <TextInput
                  style={s.yearInput}
                  placeholder="2023"
                  placeholderTextColor={Colors.textMuted}
                  value={startYear}
                  onChangeText={setStartYear}
                  keyboardType="number-pad"
                  maxLength={4}
                />
              </View>

              <View>
                <Text style={s.label}>End year</Text>
                <TextInput
                  style={s.yearInput}
                  placeholder={String(currentYear)}
                  placeholderTextColor={Colors.textMuted}
                  value={endYear}
                  onChangeText={setEndYear}
                  keyboardType="number-pad"
                  maxLength={4}
                />
              </View>

              <TouchableOpacity style={s.continueBtn} onPress={handleYearRangeSelected}>
                <Text style={s.continueBtnText}>Continue</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={visible && !showYearPicker} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[s.backdrop, { paddingTop: insets.top }]}>
        <View style={s.container}>
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={s.title}>Missing instructor hours?</Text>
                {displayedValue > 0 && (
                  <Text style={{ color: Colors.gold, fontSize: 16, fontWeight: '700' }}>+{formatTime(displayedValue)}</Text>
                )}
              </View>
              <Text style={{ color: Colors.textMuted, fontSize: 11, marginTop: 4 }}>Changes visible in settings {'>'}  audit log</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={24} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {loading ? (
            <ActivityIndicator color={Colors.primary} size="large" style={{ marginVertical: 40 }} />
          ) : flights.length === 0 ? (
            <View style={s.emptyContainer}>
              <Text style={s.emptyText}>No flights missing instructor time</Text>
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
                      {flight.date} · {flight.aircraft_type} · {formatTime(flight.pic)}h pic
                    </Text>
                  </View>

                  <View style={s.buttonGroup}>
                    <TouchableOpacity
                      style={[s.actionBtn, s.confirmBtn]}
                      onPress={() => handleSaveInstructor(flight.id, flight)}
                    >
                      <Ionicons name="checkmark" size={20} color={Colors.textInverse} />
                      <Text style={[s.actionBtnText, { color: Colors.textInverse }]}>Yes</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.actionBtn, s.cancelBtn]}
                      onPress={() => handleSkipInstructor(flight.id)}
                    >
                      <Ionicons name="close" size={20} color={Colors.textPrimary} />
                      <Text style={[s.actionBtnText, { color: Colors.textPrimary }]}>No</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
    </>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: 20 },
  container: { backgroundColor: Colors.card, borderRadius: 16, maxHeight: '80%', borderWidth: 1, borderColor: Colors.border },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.separator },
  title: { color: Colors.textPrimary, fontSize: 17, fontWeight: '700', flex: 1 },
  label: { color: Colors.textMuted, fontSize: 12, fontWeight: '600', marginBottom: 6 },
  dateInput: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12, backgroundColor: Colors.elevated, borderRadius: 8, borderWidth: 1, borderColor: Colors.border },
  dateInputText: { color: Colors.textPrimary, fontSize: 14, fontWeight: '600' },
  yearInput: { paddingHorizontal: 12, paddingVertical: 12, backgroundColor: Colors.elevated, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, color: Colors.textPrimary, fontSize: 16, fontWeight: '600' },
  continueBtn: { backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 12 },
  continueBtnText: { color: Colors.textInverse, fontSize: 15, fontWeight: '700' },
  datePickerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  list: { paddingHorizontal: 16 },
  emptyContainer: { padding: 32, alignItems: 'center' },
  emptyText: { color: Colors.textMuted, fontSize: 14, textAlign: 'center' },
  flightRow: { paddingVertical: 16 },
  flightInfo: { marginBottom: 12 },
  route: { color: Colors.textPrimary, fontSize: 15, fontWeight: '600', marginBottom: 4 },
  meta: { color: Colors.textSecondary, fontSize: 12 },
  buttonGroup: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 8 },
  confirmBtn: { backgroundColor: Colors.primary },
  cancelBtn: { backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  actionBtnText: { fontSize: 14, fontWeight: '600' },
});
