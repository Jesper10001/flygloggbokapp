import { useState, useEffect, useRef } from 'react';
import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Animated, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Colors } from '../constants/colors';
import { GlassDialog, dialogStyles } from './GlassDialog';
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
      Alert.alert(t('error'), 'Could not save INSTRUCTOR hours');
    }
  };

  const handleSkipInstructor = (flightId: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFlights(flights.filter(f => f.id !== flightId));
  };

  const added = displayedValue > 0 ? formatTime(displayedValue) : null;
  return (
    <>
      <GlassDialog
        visible={visible && showYearPicker}
        onClose={onClose}
        eyebrow="Missing hours"
        title="Missing instructor hours?"
        body="Which years did you instruct? Blades lists your PIC flights from them."
        primary={{ label: 'Continue', onPress: handleYearRangeSelected }}
        secondary={{ label: 'Not now', onPress: onClose }}
      >
        <View style={s.years}>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>Start year</Text>
            <TextInput style={s.yearInput} placeholder="2023" placeholderTextColor={Colors.textMuted} value={startYear}
              onChangeText={setStartYear} keyboardType="number-pad" maxLength={4} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.label}>End year</Text>
            <TextInput style={s.yearInput} placeholder={String(currentYear)} placeholderTextColor={Colors.textMuted} value={endYear}
              onChangeText={setEndYear} keyboardType="number-pad" maxLength={4} />
          </View>
        </View>
      </GlassDialog>
      <GlassDialog
        visible={visible && !showYearPicker}
        onClose={onClose}
        eyebrow="Missing hours"
        title="Missing instructor hours?"
        body={
          <Text style={s.note}>
            {added ? <Text style={s.added}>+{added} added · </Text> : null}Changes are listed under Settings › Audit log.
          </Text>
        }
        primary={{ label: 'Done', onPress: onClose }}
      >
        {loading ? (
          <ActivityIndicator color={Colors.primary} size="large" style={{ marginVertical: 32 }} />
        ) : flights.length === 0 ? (
          <Text style={s.emptyText}>No flights missing instructor time</Text>
        ) : (
          <ScrollView style={s.list} showsVerticalScrollIndicator={false}>
            {flights.map((flight, index) => (
              <View key={flight.id} style={[dialogStyles.row, index === flights.length - 1 && { borderBottomWidth: 0 }]}>
                <Text style={dialogStyles.rowTitle}>
                  {placeNames[flight.dep_place] || flight.dep_place} → {placeNames[flight.arr_place] || flight.arr_place}
                </Text>
                <Text style={dialogStyles.rowMeta}>{flight.date} · {flight.aircraft_type} · {formatTime(flight.pic)}h pic</Text>
                <View style={s.buttonGroup}>
                  <TouchableOpacity style={[dialogStyles.pill, { flex: 1 }]} onPress={() => handleSaveInstructor(flight.id, flight)} activeOpacity={0.8}>
                    <Ionicons name="checkmark" size={18} color={Colors.textPrimary} />
                    <Text style={dialogStyles.pillTxt}>Yes</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[dialogStyles.pillGhost, { flex: 1 }]} onPress={() => handleSkipInstructor(flight.id)} activeOpacity={0.7}>
                    <Text style={dialogStyles.pillGhostTxt}>No</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </ScrollView>
        )}
      </GlassDialog>
    </>
  );
}

const s = StyleSheet.create({
  note: { color: Colors.textSecondary, fontSize: 13.5, lineHeight: 19, textAlign: 'center', marginTop: 2 },
  added: { color: Colors.gold, fontWeight: '800' },
  list: { alignSelf: 'stretch', maxHeight: 360, marginTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.14)' },
  emptyText: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', marginTop: 18 },
  buttonGroup: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 10 },
  years: { flexDirection: 'row', gap: 12, alignSelf: 'stretch', marginTop: 16 },
  label: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 6 },
  yearInput: {
    height: 48, paddingHorizontal: 14, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)', color: Colors.textPrimary, fontSize: 17, fontWeight: '700',
  },
});
