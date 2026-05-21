import { useState, useEffect, useRef } from 'react';
import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Animated, Pressable } from 'react-native';
import Slider from '@react-native-community/slider';
import { Calendar } from 'react-native-calendars';
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
  const [editingId, setEditingId] = useState<number | null>(null);
  const [instructorHours, setInstructorHours] = useState('');
  const [remainingCount, setRemainingCount] = useState(0);
  const [totalInstructorAdded, setTotalInstructorAdded] = useState(0);
  const animatedValue = useRef(new Animated.Value(0)).current;
  const [displayedValue, setDisplayedValue] = useState(0);
  const [lastHapticPercent, setLastHapticPercent] = useState<Record<number, number>>({});

  const [showDatePicker, setShowDatePicker] = useState(true);
  const [startDate, setStartDate] = useState(getDefaultStartDate());
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [showStartDateSelector, setShowStartDateSelector] = useState(false);
  const [showEndDateSelector, setShowEndDateSelector] = useState(false);

  function getDefaultStartDate(): string {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().split('T')[0];
  }

  const handleDateRangeSelected = async () => {
    setShowDatePicker(false);
    setLoading(true);
    try {
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

  const animateSliderTo100 = (flightId: number, maxValue: number) => {
    setEditingId(flightId);
    setInstructorHours(String(maxValue));
    setLastHapticPercent(prev => ({ ...prev, [flightId]: 100 }));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handleSaveInstructor = async (flightId: number) => {
    const hours = parseFloat(instructorHours);
    if (isNaN(hours) || hours < 0) {
      Alert.alert(t('error'), 'Ange en giltig tid');
      return;
    }

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await setFlightInstructor(flightId, hours);
      await loadStats();

      const newTotal = totalInstructorAdded + hours;
      setTotalInstructorAdded(newTotal);
      onTotalInstructorUpdate?.(newTotal);
      animateValue(newTotal);

      setFlights(flights.filter(f => f.id !== flightId));
      setEditingId(null);
      setInstructorHours('');
      setLastHapticPercent(prev => {
        const updated = { ...prev };
        delete updated[flightId];
        return updated;
      });
    } catch (err) {
      Alert.alert(t('error'), 'Kunde inte spara INSTRUCTOR-timmar');
    }
  };

  return (
    <>
      <Modal visible={showStartDateSelector} transparent animationType="slide" onRequestClose={() => setShowStartDateSelector(false)}>
        <Pressable style={s.datePickerBackdrop} onPress={() => setShowStartDateSelector(false)}>
          <Pressable style={s.calendarSheet} onPress={(e) => e.stopPropagation()}>
            <View style={s.calendarHeader}>
              <Text style={s.calendarTitle}>Select Start Date</Text>
              <TouchableOpacity onPress={() => setShowStartDateSelector(false)} hitSlop={8}>
                <Ionicons name="close" size={24} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <Calendar
              current={startDate}
              onDayPress={(day) => {
                setStartDate(day.dateString);
                setShowStartDateSelector(false);
              }}
              markedDates={{ [startDate]: { selected: true, selectedColor: Colors.primary } }}
              theme={{
                backgroundColor: Colors.card,
                calendarBackground: Colors.card,
                textSectionTitleColor: Colors.textSecondary,
                selectedDayBackgroundColor: Colors.primary,
                selectedDayTextColor: Colors.textInverse,
                todayTextColor: Colors.primary,
                dayTextColor: Colors.textPrimary,
                textDisabledColor: Colors.textMuted,
                dotColor: Colors.primary,
                selectedDotColor: Colors.textInverse,
                monthTextColor: Colors.textPrimary,
                textDayFontSize: 16,
                textMonthFontSize: 16,
                textDayHeaderFontSize: 14,
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={showEndDateSelector} transparent animationType="slide" onRequestClose={() => setShowEndDateSelector(false)}>
        <Pressable style={s.datePickerBackdrop} onPress={() => setShowEndDateSelector(false)}>
          <Pressable style={s.calendarSheet} onPress={(e) => e.stopPropagation()}>
            <View style={s.calendarHeader}>
              <Text style={s.calendarTitle}>Select End Date</Text>
              <TouchableOpacity onPress={() => setShowEndDateSelector(false)} hitSlop={8}>
                <Ionicons name="close" size={24} color={Colors.textPrimary} />
              </TouchableOpacity>
            </View>
            <Calendar
              current={endDate}
              onDayPress={(day) => {
                setEndDate(day.dateString);
                setShowEndDateSelector(false);
              }}
              markedDates={{ [endDate]: { selected: true, selectedColor: Colors.primary } }}
              theme={{
                backgroundColor: Colors.card,
                calendarBackground: Colors.card,
                textSectionTitleColor: Colors.textSecondary,
                selectedDayBackgroundColor: Colors.primary,
                selectedDayTextColor: Colors.textInverse,
                todayTextColor: Colors.primary,
                dayTextColor: Colors.textPrimary,
                textDisabledColor: Colors.textMuted,
                dotColor: Colors.primary,
                selectedDotColor: Colors.textInverse,
                monthTextColor: Colors.textPrimary,
                textDayFontSize: 16,
                textMonthFontSize: 16,
                textDayHeaderFontSize: 14,
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={visible && showDatePicker} transparent animationType="fade" onRequestClose={onClose}>
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
              <Text style={{ color: Colors.textMuted, fontSize: 12, fontWeight: '600' }}>Select date range</Text>
            </View>

            <View style={{ padding: 16, gap: 20 }}>
              <View>
                <Text style={s.label}>Start date</Text>
                <TouchableOpacity style={s.dateInput} onPress={() => setShowStartDateSelector(true)}>
                  <Ionicons name="calendar" size={18} color={Colors.primary} style={{ marginRight: 8 }} />
                  <Text style={s.dateInputText}>{startDate}</Text>
                </TouchableOpacity>
              </View>

              <View>
                <Text style={s.label}>End date</Text>
                <TouchableOpacity style={s.dateInput} onPress={() => setShowEndDateSelector(true)}>
                  <Ionicons name="calendar" size={18} color={Colors.primary} style={{ marginRight: 8 }} />
                  <Text style={s.dateInputText}>{endDate}</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={s.continueBtn} onPress={handleDateRangeSelected}>
                <Text style={s.continueBtnText}>Continue</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
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
              <Text style={{ color: Colors.textMuted, fontSize: 11, marginTop: 4 }}>Changes visible in settings > audit log</Text>
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

                  <View style={s.editContainer}>
                    <View style={s.sliderGroup}>
                      <Slider
                        style={s.slider}
                        minimumValue={0}
                        maximumValue={flight.total_time}
                        value={editingId === flight.id ? parseFloat(instructorHours) || 0 : flight.instructor || 0}
                        onValueChange={(val) => {
                          setEditingId(flight.id);
                          setInstructorHours(val.toFixed(1));

                          // Trigger haptic feedback every 10%
                          const percent = Math.floor((val / flight.total_time) * 10) * 10;
                          const lastPercent = lastHapticPercent[flight.id] || 0;
                          if (percent > lastPercent && percent > 0) {
                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            setLastHapticPercent(prev => ({ ...prev, [flight.id]: percent }));
                          }
                        }}
                        minimumTrackTintColor={Colors.primary}
                        maximumTrackTintColor={Colors.separator}
                        thumbTintColor={Colors.primary}
                      />
                      <TouchableOpacity
                        style={s.max100Btn}
                        onPress={() => animateSliderTo100(flight.id, flight.total_time)}
                      >
                        <Text style={s.max100BtnText}>100%</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={s.saveSmallBtn}
                        onPress={() => handleSaveInstructor(flight.id)}
                      >
                        <Ionicons name="checkmark" size={18} color={Colors.textInverse} />
                      </TouchableOpacity>
                    </View>
                    <View style={s.valueDisplay}>
                      <Text style={s.valueText}>{editingId === flight.id ? instructorHours : flight.instructor || '0'} h / {flight.total_time} h</Text>
                    </View>
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
  continueBtn: { backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 12 },
  continueBtnText: { color: Colors.textInverse, fontSize: 15, fontWeight: '700' },
  datePickerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  calendarSheet: { backgroundColor: Colors.card, borderTopLeftRadius: 16, borderTopRightRadius: 16, borderTopWidth: 1, borderTopColor: Colors.border, maxHeight: '80%' },
  calendarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.separator },
  calendarTitle: { color: Colors.textPrimary, fontSize: 17, fontWeight: '700' },
  list: { paddingHorizontal: 16 },
  emptyContainer: { padding: 32, alignItems: 'center' },
  emptyText: { color: Colors.textMuted, fontSize: 14, textAlign: 'center' },
  flightRow: { paddingVertical: 16 },
  flightInfo: { marginBottom: 12 },
  route: { color: Colors.textPrimary, fontSize: 15, fontWeight: '600', marginBottom: 4 },
  meta: { color: Colors.textSecondary, fontSize: 12 },
  editContainer: { gap: 8 },
  sliderGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  slider: { flex: 1, height: 40 },
  max100Btn: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, backgroundColor: Colors.primary + '22', borderWidth: 1, borderColor: Colors.primary + '44', alignItems: 'center', justifyContent: 'center' },
  max100BtnText: { color: Colors.primary, fontSize: 12, fontWeight: '700' },
  saveSmallBtn: { width: 40, height: 40, borderRadius: 8, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  valueDisplay: { paddingTop: 4, alignItems: 'center' },
  valueText: { color: Colors.textSecondary, fontSize: 12 },
});
