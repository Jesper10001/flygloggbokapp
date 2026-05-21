import { useState, useEffect, useRef } from 'react';
import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Animated } from 'react-native';
import Slider from '@react-native-community/slider';
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
  onCountUpdate?: (count: number) => void;
  onTotalNvgUpdate?: (hours: number) => void;
}

export function MissingNvgModal({ visible, onClose, onCountUpdate, onTotalNvgUpdate }: MissingNvgModalProps) {
  const { t } = useTranslation();
  const { formatTime } = useTimeFormat();
  const { loadStats } = useFlightStore();
  const insets = useSafeAreaInsets();
  const [flights, setFlights] = useState<Flight[]>([]);
  const [loading, setLoading] = useState(false);
  const [placeNames, setPlaceNames] = useState<Record<string, string>>({});
  const [editingId, setEditingId] = useState<number | null>(null);
  const [nvgValues, setNvgValues] = useState<Record<number, string>>({});
  const [nvgHours, setNvgHours] = useState('');
  const [remainingCount, setRemainingCount] = useState(0);
  const [totalNvgAdded, setTotalNvgAdded] = useState(0);
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
      const nightFlights = await getNightFlightsMissingNvg();
      setFlights(nightFlights);
      setRemainingCount(nightFlights.length);
      onCountUpdate?.(nightFlights.length);
      
      // Start from 0, don't pre-fill
      setTotalNvgAdded(0);
      setDisplayedValue(0);
      animatedValue.setValue(0);
      onTotalNvgUpdate?.(0);
      
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

  const handleSaveNvg = async (flightId: number) => {
    const hours = parseFloat(nvgHours);
    if (isNaN(hours) || hours < 0) {
      Alert.alert(t('error'), 'Ange en giltig tid');
      return;
    }

    try {
      await setFlightNvg(flightId, hours);
      await loadStats();
      
      const newTotal = totalNvgAdded + hours;
      setTotalNvgAdded(newTotal);
      onTotalNvgUpdate?.(newTotal);
      animateValue(newTotal);
      
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
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flex: 1 }}>
              <Text style={s.title}>{t('missing_nvg_title')}</Text>
              {displayedValue > 0 && (
                <Text style={{ color: Colors.gold, fontSize: 16, fontWeight: '700' }}>+{formatTime(displayedValue)}</Text>
              )}
            </View>
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

                  <View style={s.editContainer}>
                    <View style={s.sliderGroup}>
                      <Slider
                        style={s.slider}
                        minimumValue={0}
                        maximumValue={flight.night}
                        value={flight.nvg || 0}
                        onValueChange={(val) => {
                          setEditingId(flight.id);
                          setNvgHours(val.toFixed(1));
                        }}
                        minimumTrackTintColor={Colors.primary}
                        maximumTrackTintColor={Colors.separator}
                        thumbTintColor={Colors.primary}
                      />
                      <TouchableOpacity 
                        style={s.max100Btn}
                        onPress={() => {
                          setEditingId(flight.id);
                          setNvgHours(String(flight.night));
                        }}
                      >
                        <Text style={s.max100BtnText}>100%</Text>
                      </TouchableOpacity>
                      <TouchableOpacity 
                        style={s.saveSmallBtn}
                        onPress={() => handleSaveNvg(flight.id)}
                      >
                        <Ionicons name="checkmark" size={18} color={Colors.textInverse} />
                      </TouchableOpacity>
                    </View>
                    <View style={s.valueDisplay}>
                      <Text style={s.valueText}>{editingId === flight.id ? nvgHours : flight.nvg || '0'} h / {flight.night} h</Text>
                    </View>
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
  editBtn: { paddingVertical: 8, paddingHorizontal: 12, alignItems: 'center' },
  editContainer: { gap: 8 },
  sliderGroup: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  slider: { flex: 1, height: 40 },
  max100Btn: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, backgroundColor: Colors.primary + '22', borderWidth: 1, borderColor: Colors.primary + '44', alignItems: 'center', justifyContent: 'center' },
  max100BtnText: { color: Colors.primary, fontSize: 12, fontWeight: '700' },
  saveSmallBtn: { width: 40, height: 40, borderRadius: 8, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  valueDisplay: { paddingTop: 4, alignItems: 'center' },
  valueText: { color: Colors.textSecondary, fontSize: 12 },
});
