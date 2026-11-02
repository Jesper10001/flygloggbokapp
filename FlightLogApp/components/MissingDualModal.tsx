import { useState, useEffect, useRef } from 'react';
import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Colors } from '../constants/colors';
import { GlassDialog, dialogStyles } from './GlassDialog';
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
      Alert.alert(t('error'), 'Could not save DUAL hours');
    }
  };

  const handleSkipDual = (flightId: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setFlights(flights.filter(f => f.id !== flightId));
  };

  const added = displayedValue > 0 ? formatTime(displayedValue) : null;
  return (
    <GlassDialog
      visible={visible}
      onClose={onClose}
      eyebrow="Missing hours"
      title="Missing DUAL hours?"
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
        <Text style={s.emptyText}>No DUAL flights without pilot time tracking</Text>
      ) : (
        <ScrollView style={s.list} showsVerticalScrollIndicator={false}>
          {flights.map((flight, index) => (
            <View key={flight.id} style={[dialogStyles.row, index === flights.length - 1 && { borderBottomWidth: 0 }]}>
              <Text style={dialogStyles.rowTitle}>
                {placeNames[flight.dep_place] || flight.dep_place} → {placeNames[flight.arr_place] || flight.arr_place}
              </Text>
              <Text style={dialogStyles.rowMeta}>{flight.date} · {flight.aircraft_type} · {formatTime(flight.dual)}h dual</Text>
              <View style={s.buttonGroup}>
                <TouchableOpacity style={[dialogStyles.pill, { flex: 1 }]} onPress={() => handleSaveDual(flight.id, flight)} activeOpacity={0.8}>
                  <Ionicons name="checkmark" size={18} color={Colors.textPrimary} />
                  <Text style={dialogStyles.pillTxt}>Yes</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[dialogStyles.pillGhost, { flex: 1 }]} onPress={() => handleSkipDual(flight.id)} activeOpacity={0.7}>
                  <Text style={dialogStyles.pillGhostTxt}>No</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </GlassDialog>
  );
}

const s = StyleSheet.create({
  note: { color: Colors.textSecondary, fontSize: 13.5, lineHeight: 19, textAlign: 'center', marginTop: 2 },
  added: { color: Colors.gold, fontWeight: '800' },
  list: { alignSelf: 'stretch', maxHeight: 360, marginTop: 14, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.14)' },
  emptyText: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', marginTop: 18 },
  buttonGroup: { flexDirection: 'row', gap: 8, alignItems: 'center', marginTop: 10 },
});
