import { useState, useEffect, useRef } from 'react';
import { Modal, View, Text, ScrollView, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Animated } from 'react-native';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Colors } from '../constants/colors';
import { GlassDialog, dialogStyles } from './GlassDialog';
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
  const [lastHapticPercent, setLastHapticPercent] = useState<Record<number, number>>({});

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

  const animateSliderTo100 = (flightId: number, maxValue: number) => {
    setEditingId(flightId);
    setNvgHours(String(maxValue));
    setLastHapticPercent(prev => ({ ...prev, [flightId]: 100 }));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  };

  const handleSaveNvg = async (flightId: number) => {
    const hours = parseFloat(nvgHours);
    if (isNaN(hours) || hours < 0) {
      Alert.alert(t('error'), 'Enter a valid time');
      return;
    }

    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await setFlightNvg(flightId, hours);
      await loadStats();

      const newTotal = totalNvgAdded + hours;
      setTotalNvgAdded(newTotal);
      onTotalNvgUpdate?.(newTotal);
      animateValue(newTotal);

      setFlights(flights.filter(f => f.id !== flightId));
      setEditingId(null);
      setNvgHours('');
      setLastHapticPercent(prev => {
        const updated = { ...prev };
        delete updated[flightId];
        return updated;
      });
    } catch (err) {
      Alert.alert(t('error'), 'Could not save NVG hours');
    }
  };


  const added = displayedValue > 0 ? formatTime(displayedValue) : null;
  return (
    <GlassDialog
      visible={visible}
      onClose={onClose}
      eyebrow="Missing hours"
      title={t('missing_nvg_title')}
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
        <Text style={s.emptyText}>{t('missing_nvg_none')}</Text>
      ) : (
        <ScrollView style={s.list} showsVerticalScrollIndicator={false}>
          {flights.map((flight, index) => (
            <View key={flight.id} style={[dialogStyles.row, index === flights.length - 1 && { borderBottomWidth: 0 }]}>
              <Text style={dialogStyles.rowTitle}>
                {placeNames[flight.dep_place] || flight.dep_place} → {placeNames[flight.arr_place] || flight.arr_place}
              </Text>
              <Text style={dialogStyles.rowMeta}>{flight.date} · {flight.aircraft_type} · {formatTime(flight.night)}h night</Text>
              <View style={s.sliderGroup}>
                <Slider
                  style={s.slider}
                  minimumValue={0}
                  maximumValue={flight.night}
                  value={editingId === flight.id ? parseFloat(nvgHours) || 0 : flight.nvg || 0}
                  onValueChange={(val) => {
                    setEditingId(flight.id);
                    setNvgHours(val.toFixed(1));
                    // Haptik var tionde procent
                    const percent = Math.floor((val / flight.night) * 10) * 10;
                    const lastPercent = lastHapticPercent[flight.id] || 0;
                    if (percent > lastPercent && percent > 0) {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setLastHapticPercent(prev => ({ ...prev, [flight.id]: percent }));
                    }
                  }}
                  minimumTrackTintColor={Colors.primary}
                  maximumTrackTintColor="rgba(255,255,255,0.18)"
                  thumbTintColor={Colors.textPrimary}
                />
                <TouchableOpacity style={dialogStyles.pillGhost} onPress={() => animateSliderTo100(flight.id, flight.night)} activeOpacity={0.7}>
                  <Text style={dialogStyles.pillGhostTxt}>100%</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[dialogStyles.pill, { paddingHorizontal: 12 }]} onPress={() => handleSaveNvg(flight.id)} activeOpacity={0.8} accessibilityLabel="Save NVG time">
                  <Ionicons name="checkmark" size={18} color={Colors.textPrimary} />
                </TouchableOpacity>
              </View>
              <Text style={s.valueText}>{editingId === flight.id ? nvgHours : flight.nvg || '0'} h / {flight.night} h NVG</Text>
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
  sliderGroup: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  slider: { flex: 1, height: 40 },
  valueText: { color: Colors.textSecondary, fontSize: 12, textAlign: 'center', marginTop: 2, fontVariant: ['tabular-nums'] },
});
