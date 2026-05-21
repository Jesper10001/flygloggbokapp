import { useState, useEffect, useRef } from 'react';
import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Colors } from '../constants/colors';
import { useTranslation } from '../hooks/useTranslation';
import { useTimeFormat } from '../hooks/useTimeFormat';
import { getDualFlightsMissingPilotTracking, setFlightDual } from '../db/flights';
import { useFlightStore } from '../store/flightStore';
import { batchPlaceNames } from '../db/icao';
import type { Flight } from '../types/flight';

interface MissingDualModalProps {
  visible: boolean;
  onClose: () => void;
  onCountUpdate?: (count: number) => void;
  onTotalDualUpdate?: (hours: number) => void;
}

export function MissingDualModal({ visible, onClose, onCountUpdate, onTotalDualUpdate }: MissingDualModalProps) {
  const { t } = useTranslation();
  const { formatTime } = useTimeFormat();
  const { loadStats } = useFlightStore();
  const insets = useSafeAreaInsets();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loading, setLoading] = useState(false);
  const [placeNames, setPlaceNames] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [remainingCount, setRemainingCount] = useState(0);
  const [totalDualAdded, setTotalDualAdded] = useState(0);
  const animatedValue = useRef(new Animated.Value(0)).current;
  const [displayedValue, setDisplayedValue] = useState(0);

  useEffect(() => {
    if (visible) {
      loadFlights();
    }
  }, [visible]);

  const loadFlights = async () => {
    setLoading(true);
    try {
      const nightFlights = await getDualFlightsMissingPilotTracking();
      setFlights(nightFlights);
      setRemainingCount(nightFlights.length);
      onCountUpdate?.(nightFlights.length);
      
      // Start from 0, don't pre-fill
      setTotalDualAdded(0);
      setDisplayedValue(0);
      animatedValue.setValue(0);
      onTotalDualUpdate?.(0);
      
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

  const handleSaveDual = async (flightId: number, flight: Flight) => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await setFlightDual(flightId, flight.total_time);
      await loadStats();

      const newTotal = totalDualAdded + flight.total_time;
      setTotalDualAdded(newTotal);
      onTotalDualUpdate?.(newTotal);
      animateValue(newTotal);

      setFlights(flights.filter(f => f.id !== flightId));
    } catch (err) {
      Alert.alert(t('error'), 'Kunde inte spara DUAL-timmar');
    }
  };

  const handleSkipDual = (flightId: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFlights(flights.filter(f => f.id !== flightId));
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={[s.backdrop, { paddingTop: insets.top }]}>
        <View style={s.container}>
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={s.title}>Missing DUAL hours?</Text>
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
              <Text style={s.emptyText}>No DUAL flights without pilot time tracking</Text>
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
                      {flight.date} · {flight.aircraft_type} · {formatTime(flight.dual)}h dual
                    </Text>
                  </View>

                  <View style={s.buttonGroup}>
                    <TouchableOpacity
                      style={[s.actionBtn, s.confirmBtn]}
                      onPress={() => handleSaveDual(flight.id, flight)}
                    >
                      <Ionicons name="checkmark" size={20} color={Colors.textInverse} />
                      <Text style={s.actionBtnText}>Yes</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[s.actionBtn, s.cancelBtn]}
                      onPress={() => handleSkipDual(flight.id)}
                    >
                      <Ionicons name="close" size={20} color={Colors.textInverse} />
                      <Text style={s.actionBtnText}>No</Text>
                    </TouchableOpacity>
                  </View>
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
  buttonGroup: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  actionBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 8 },
  confirmBtn: { backgroundColor: Colors.success },
  cancelBtn: { backgroundColor: Colors.danger },
  actionBtnText: { color: Colors.textInverse, fontSize: 14, fontWeight: '600' },
});
