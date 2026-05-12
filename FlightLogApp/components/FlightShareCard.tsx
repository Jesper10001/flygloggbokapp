import { useRef, useState, useEffect } from 'react';
import {
  View, Text, Image, StyleSheet, Dimensions, TouchableOpacity,
  Modal, ActivityIndicator, Animated, PanResponder,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { getAirportCoordinates } from '../db/icao';
import { getAircraftCruiseSpeed, getFlightNumberOfYear, getAllAircraftTypes } from '../db/flights';
import type { Flight } from '../types/flight';

let runwayData: Record<string, number[]> = {};
try { runwayData = require('../assets/runways.json'); } catch {}

const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W = SCREEN_W;
const CARD_H = CARD_W * 1.33;

const SHADOW = {} as const;

interface Props {
  flight: Flight;
  depName: string;
  arrName: string;
  visible: boolean;
  onClose: () => void;
  formatTime: (n: number) => string;
}

export function FlightShareCard({ flight, depName, arrName, visible, onClose, formatTime }: Props) {
  const insets = useSafeAreaInsets();
  const viewShotRef = useRef<ViewShot>(null);
  const [sharing, setSharing] = useState(false);
  const [depCoord, setDepCoord] = useState<{ lat: number; lon: number } | null>(null);
  const [arrCoord, setArrCoord] = useState<{ lat: number; lon: number } | null>(null);
  const [distanceNm, setDistanceNm] = useState(0);
  const [flightNum, setFlightNum] = useState(0);
  const [isHeli, setIsHeli] = useState(false);

  // Overlay pan + slider scale
  const panRef = useRef({ x: 0, y: 0 });
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const [overlayScale, setOverlayScale] = useState(0.8);
  const [mode, setMode] = useState<'slim' | 'extra'>('extra');
  const FONTS = ['Georgia', 'Helvetica Neue', 'Futura'] as const;
  const [fontIdx, setFontIdx] = useState(0);
  const font = FONTS[fontIdx];

  useEffect(() => {
    if (visible) {
      panRef.current = { x: 0, y: 0 };
      pan.setValue({ x: 0, y: 0 });
      setOverlayScale(0.8);
    }
  }, [visible]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 3 || Math.abs(gs.dy) > 3,
      onPanResponderGrant: () => {
        pan.setOffset(panRef.current);
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: () => {
        pan.flattenOffset();
        panRef.current = { x: (pan as any).__getValue().x, y: (pan as any).__getValue().y };
      },
    })
  ).current;

  useEffect(() => {
    if (!visible) return;
    const codes = [flight.dep_place, flight.arr_place].filter(Boolean);
    if (codes.length) {
      getAirportCoordinates(codes).then(coords => {
        const d = coords.find(c => c.icao === flight.dep_place);
        const a = coords.find(c => c.icao === flight.arr_place);
        if (d) setDepCoord({ lat: d.lat, lon: d.lon });
        if (a) setArrCoord({ lat: a.lat, lon: a.lon });
      });
    }
    if (flight.aircraft_type && flight.total_time > 0) {
      getAircraftCruiseSpeed(flight.aircraft_type).then(kts => {
        if (kts > 0) setDistanceNm(Math.round(kts * flight.total_time));
      });
    }
    getFlightNumberOfYear(flight.id, flight.date).then(setFlightNum);
    if (flight.aircraft_type) {
      getAllAircraftTypes().then(types => {
        const entry = types.find(t => t.aircraft_type === flight.aircraft_type);
        if (entry?.category === 'helicopter') setIsHeli(true);
      });
    }
  }, [visible, flight.id, flight.date, flight.dep_place, flight.arr_place, flight.aircraft_type, flight.total_time]);

  const handleShare = async () => {
    if (!viewShotRef.current?.capture) return;
    setSharing(true);
    try {
      const uri = await viewShotRef.current.capture();
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Dela flygning' });
      }
    } catch (e) {
      console.warn('Share failed', e);
    } finally {
      setSharing(false);
    }
  };

  const f = flight;
  const dateStr = f.date.replace(/-/g, '.');

  const timeOfDay = (() => {
    const h = parseInt(f.dep_utc?.split(':')[0] ?? '', 10);
    if (isNaN(h)) return '';
    if (h >= 5 && h < 8) return 'Dawn flight';
    if (h >= 8 && h < 12) return 'Morning flight';
    if (h >= 12 && h < 17) return 'Afternoon flight';
    if (h >= 17 && h < 20) return 'Evening flight';
    return 'Night flight';
  })();
  const hasRoute = depCoord && arrCoord && (depCoord.lat !== arrCoord.lat || depCoord.lon !== arrCoord.lon);
  const routeSvg = hasRoute ? buildRouteSvg(depCoord!, arrCoord!, depName, arrName) : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ViewShot ref={viewShotRef} options={{ format: 'png', quality: 1, width: 1080, height: 1440 }}>
            <View style={styles.card}>
              {/* Static photo background */}
              {f.photo_uri ? (
                <Image source={{ uri: f.photo_uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              ) : (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: '#0f1728' }]} />
              )}

              {/* Draggable/scalable info overlay */}
              <Animated.View
                style={[
                  StyleSheet.absoluteFill,
                  { transform: [{ translateX: pan.x }, { translateY: pan.y }, { scale: overlayScale }] },
                ]}
                {...panResponder.panHandlers}
              >
                {/* Route SVG */}
                {routeSvg && (
                  <View style={styles.routeOverlay}>
                    <Image
                      source={{ uri: `data:image/svg+xml;utf8,${encodeURIComponent(routeSvg)}` }}
                      style={{ width: CARD_W * 0.55, height: CARD_W * 0.35 }}
                      resizeMode="contain"
                    />
                  </View>
                )}

                {/* Stats */}
                <View style={styles.statsContainer}>
                  <View style={styles.routeTextRow}>
                    <View style={{ alignItems: 'center' }}>
                      <RunwayDiagram icao={f.dep_place} size={32} />
                      <Text style={[styles.placeText, SHADOW, { fontFamily: font }]}>{depName}</Text>
                    </View>
                    <View style={styles.routeLine}>
                      <View style={styles.dot} />
                      <View style={styles.line} />
                      <View style={{ alignItems: 'center' }}>
                        <Ionicons name="airplane" size={14} color="rgba(255,255,255,0.8)" style={SHADOW} />
                        {distanceNm > 0 && <Text style={[{ color: 'rgba(255,255,255,0.6)', fontSize: 10, fontWeight: '700', fontFamily: font }, SHADOW]}>{distanceNm} NM</Text>}
                      </View>
                      <View style={styles.line} />
                      <View style={styles.dot} />
                    </View>
                    <View style={{ alignItems: 'center' }}>
                      <RunwayDiagram icao={f.arr_place} size={32} />
                      <Text style={[styles.placeText, SHADOW, { fontFamily: font }]}>{arrName}</Text>
                    </View>
                  </View>

                  {mode === 'extra' && (
                    <View style={styles.statsGrid}>
                      <StatItem label="Total Time" value={`${formatTime(f.total_time)}h`} large font={font} />
                      <StatItem label="Aircraft" value={`${f.aircraft_type} ${f.registration}`} font={font} />
                      <StatItem label="Date" value={dateStr} font={font} />
                      {(f.max_fl ?? 0) > 0 && <StatItem label="Max FL" value={`FL${f.max_fl}`} font={font} />}
                        {flightNum > 0 && <StatItem label="Flight" value={`#${flightNum} of ${f.date.slice(0, 4)}`} font={font} />}
                      {timeOfDay ? <StatItem label="" value={timeOfDay} font={font} /> : null}
                    </View>
                  )}

                  <View style={styles.branding}>
                    <Text style={[styles.brandText, SHADOW, { fontFamily: font }]}>BLADES</Text>
                    <Text style={[styles.brandSub, SHADOW, { fontFamily: font }]}>Joint Logbook</Text>
                  </View>
                </View>
              </Animated.View>
            </View>
          </ViewShot>

          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingHorizontal: 20, gap: 10 }}>
            <Ionicons name="remove" size={16} color="rgba(255,255,255,0.4)" />
            <Slider
              style={{ flex: 1, height: 30 }}
              minimumValue={0.4}
              maximumValue={2}
              value={0.8}
              onValueChange={setOverlayScale}
              minimumTrackTintColor="#2563EB"
              maximumTrackTintColor="rgba(255,255,255,0.15)"
              thumbTintColor="#fff"
            />
            <Ionicons name="add" size={16} color="rgba(255,255,255,0.4)" />
          </View>

          <View style={{ flexDirection: 'row', alignSelf: 'center', marginTop: 10, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' }}>
            {(['slim', 'extra'] as const).map(m => (
              <TouchableOpacity
                key={m}
                style={{ paddingHorizontal: 20, paddingVertical: 8, backgroundColor: mode === m ? '#2563EB' : 'transparent' }}
                onPress={() => setMode(m)}
              >
                <Text style={{ color: mode === m ? '#fff' : 'rgba(255,255,255,0.5)', fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1 }}>
                  {m === 'slim' ? 'Slim' : 'Extra'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <View style={{ flexDirection: 'row', alignSelf: 'center', marginTop: 8, gap: 8 }}>
            {FONTS.map((f, i) => {
              const labels = ['Serif', 'Sans', 'Futura'];
              const active = fontIdx === i;
              return (
                <TouchableOpacity
                  key={f}
                  style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: active ? 'rgba(255,255,255,0.15)' : 'transparent' }}
                  onPress={() => setFontIdx(i)}
                >
                  <Text style={{ fontFamily: f, color: active ? '#fff' : 'rgba(255,255,255,0.4)', fontSize: 12, fontWeight: '600' }}>
                    {labels[i]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Actions */}
        <View style={{
          paddingBottom: insets.bottom + 16, paddingTop: 12, paddingHorizontal: 20,
          flexDirection: 'row', gap: 12, alignItems: 'center',
        }}>
          <TouchableOpacity
            style={{ flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' }}
            onPress={onClose}
          >
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>Stäng</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ flex: 2, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: '#2563EB', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
            onPress={handleShare}
            disabled={sharing}
          >
            {sharing ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="share-outline" size={18} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Dela</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function StatItem({ label, value, large, font = 'Georgia' }: { label: string; value: string; large?: boolean; font?: string }) {
  return (
    <View style={{ marginRight: 16, marginBottom: 8 }}>
      <Text style={[{ color: 'rgba(255,255,255,0.6)', fontSize: 9, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, fontFamily: font }, SHADOW]}>
        {label}
      </Text>
      <Text style={[{
        color: '#fff', fontSize: large ? 28 : 16, fontWeight: '800',
        fontFamily: font,
      }, SHADOW]}>
        {value}
      </Text>
    </View>
  );
}

function HeliIcon({ size = 14, color = 'rgba(255,255,255,0.8)' }: { size?: number; color?: string }) {
  const s = size;
  return (
    <View style={{ width: s, height: s, alignItems: 'center', justifyContent: 'center' }}>
      {/* Main rotor — horizontal line */}
      <View style={{ position: 'absolute', width: s * 0.95, height: 1.5, backgroundColor: color, borderRadius: 1 }} />
      {/* Main rotor — vertical line */}
      <View style={{ position: 'absolute', width: 1.5, height: s * 0.95, backgroundColor: color, borderRadius: 1 }} />
      {/* Rotor hub */}
      <View style={{ position: 'absolute', width: s * 0.22, height: s * 0.22, borderRadius: s * 0.11, backgroundColor: color }} />
      {/* Body */}
      <View style={{ position: 'absolute', top: s * 0.38, width: s * 0.28, height: s * 0.42, borderRadius: s * 0.1, backgroundColor: color }} />
      {/* Tail boom */}
      <View style={{ position: 'absolute', top: s * 0.72, width: 1.2, height: s * 0.28, backgroundColor: color }} />
      {/* Tail rotor */}
      <View style={{ position: 'absolute', top: s * 0.92, width: s * 0.35, height: 1.2, backgroundColor: color, borderRadius: 1 }} />
    </View>
  );
}

function RunwayDiagram({ icao, size = 32 }: { icao: string; size?: number }) {
  const headings = runwayData[icao];
  if (!headings || headings.length === 0) return null;

  const groups: { heading: number; offset: number }[] = [];
  const used = new Set<number>();

  for (let i = 0; i < headings.length; i++) {
    if (used.has(i)) continue;
    const parallel: number[] = [i];
    for (let j = i + 1; j < headings.length; j++) {
      if (used.has(j)) continue;
      const diff = Math.abs(headings[i] - headings[j]);
      const wrap = Math.min(diff, 360 - diff);
      if (wrap < 30) { parallel.push(j); used.add(j); }
    }
    used.add(i);
    const avg = headings[parallel[0]];
    const spacing = 3.5;
    const total = parallel.length;
    for (let k = 0; k < total; k++) {
      const off = (k - (total - 1) / 2) * spacing;
      groups.push({ heading: avg, offset: off });
    }
  }

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      {groups.map((g, i) => {
        const rad = (g.heading - 90) * Math.PI / 180;
        const perpX = -Math.sin(rad) * g.offset;
        const perpY = Math.cos(rad) * g.offset;
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              width: 2,
              height: size * 0.76,
              backgroundColor: '#D4A84B',
              borderRadius: 1,
              transform: [
                { translateX: perpX },
                { translateY: perpY },
                { rotate: `${g.heading}deg` },
              ],
            }}
          />
        );
      })}
    </View>
  );
}

function buildRouteSvg(
  dep: { lat: number; lon: number },
  arr: { lat: number; lon: number },
  depName: string,
  arrName: string,
): string {
  const W = 300;
  const H = 200;
  const pad = 40;
  const minLat = Math.min(dep.lat, arr.lat);
  const maxLat = Math.max(dep.lat, arr.lat);
  const minLon = Math.min(dep.lon, arr.lon);
  const maxLon = Math.max(dep.lon, arr.lon);
  const latSpan = maxLat - minLat || 1;
  const lonSpan = maxLon - minLon || 1;
  const toX = (lon: number) => pad + ((lon - minLon) / lonSpan) * (W - 2 * pad);
  const toY = (lat: number) => pad + ((maxLat - lat) / latSpan) * (H - 2 * pad);
  const x1 = toX(dep.lon), y1 = toY(dep.lat);
  const x2 = toX(arr.lon), y2 = toY(arr.lat);
  const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2 - 30;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <path d="M${x1},${y1} Q${midX},${midY} ${x2},${y2}" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="2" stroke-dasharray="6,4"/>
    <circle cx="${x1}" cy="${y1}" r="4" fill="#fff"/>
    <circle cx="${x2}" cy="${y2}" r="4" fill="#fff"/>
    <text x="${x1}" y="${y1 + 14}" fill="rgba(255,255,255,0.8)" font-size="10" font-family="sans-serif" text-anchor="middle">${depName}</text>
    <text x="${x2}" y="${y2 + 14}" fill="rgba(255,255,255,0.8)" font-size="10" font-family="sans-serif" text-anchor="middle">${arrName}</text>
  </svg>`;
}

const styles = StyleSheet.create({
  card: {
    width: CARD_W,
    height: CARD_H,
    overflow: 'hidden',
    backgroundColor: '#0f1728',
  },
  routeOverlay: {
    position: 'absolute',
    top: '12%',
    right: 12,
    opacity: 0.85,
  },
  statsContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 20,
    paddingBottom: 20,
    paddingTop: 40,
  },
  routeTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 10,
  },
  placeText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1,
    fontFamily: 'Georgia',
  },
  routeLine: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: 'rgba(255,255,255,0.6)',
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  branding: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  brandText: {
    color: '#D4A84B',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 3,
    fontFamily: 'Georgia',
  },
  brandSub: {
    color: '#D4A84Baa',
    fontSize: 9,
    fontWeight: '600',
    fontFamily: 'Georgia',
  },
});
