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
import * as VideoThumbnails from 'expo-video-thumbnails';
import { VideoView } from 'expo-video';
import Svg, { Line, Circle, Path } from 'react-native-svg';
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
  const videoRef = useRef<any>(null);
  const [sharing, setSharing] = useState(false);
  const [depCoord, setDepCoord] = useState<{ lat: number; lon: number } | null>(null);
  const [arrCoord, setArrCoord] = useState<{ lat: number; lon: number } | null>(null);
  const [distanceNm, setDistanceNm] = useState(0);
  const [flightNum, setFlightNum] = useState(0);
  const [isHeli, setIsHeli] = useState(false);
  const [thumbnailUri, setThumbnailUri] = useState<string | null>(null);

  // Overlay pan + slider scale
  const panRef = useRef({ x: 0, y: 0 });
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const [overlayScale, setOverlayScale] = useState(0.8);
  const [mode, setMode] = useState<'slim' | 'extra' | 'boarding' | 'postcard'>('postcard');
  const [layerTheme, setLayerTheme] = useState<'light' | 'dark'>('light');
  const font = 'Georgia';
  const LT = {
    text: layerTheme === 'light' ? '#FFFFFF' : '#0A1628',
    muted: layerTheme === 'light' ? 'rgba(255,255,255,0.6)' : 'rgba(10,22,40,0.55)',
    dot: layerTheme === 'light' ? 'rgba(255,255,255,0.6)' : 'rgba(10,22,40,0.5)',
    line: layerTheme === 'light' ? 'rgba(255,255,255,0.4)' : 'rgba(10,22,40,0.35)',
    shadow: layerTheme === 'light'
      ? { textShadowColor: 'rgba(0,0,0,0.55)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 8 }
      : { textShadowColor: 'rgba(255,255,255,0.4)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 6 },
  } as const;

  const applyModeDefaults = (m: string) => {
    const defaults: Record<string, { x: number; y: number; s: number }> = {
      slim:     { x: 0, y: -CARD_H * 0.35, s: 0.7 },
      extra:    { x: 0, y: -CARD_H * 0.25, s: 0.65 },
      postcard: { x: -CARD_W * 0.15, y: -CARD_H * 0.15, s: 0.8 },
    };
    const d = defaults[m] ?? { x: 0, y: 0, s: 0.8 };
    panRef.current = { x: d.x, y: d.y };
    pan.setValue({ x: d.x, y: d.y });
    setOverlayScale(d.s);
  };

  useEffect(() => {
    if (visible) applyModeDefaults(mode);
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

    // Generera thumbnail för video och starta uppspelning
    if (flight.media_type === 'video' && flight.photo_uri) {
      (async () => {
        try {
          const { uri } = await VideoThumbnails.getThumbnailAsync(flight.photo_uri, { time: 0 });
          setThumbnailUri(uri);
        } catch (err) {
          console.warn('Failed to generate video thumbnail:', err);
        }
      })();
    } else {
      setThumbnailUri(null);
    }

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
  }, [visible, flight.id, flight.date, flight.dep_place, flight.arr_place, flight.aircraft_type, flight.total_time, flight.media_type, flight.photo_uri]);

  // Kontrollera videouppspelning när modal öppnas/stängs
  useEffect(() => {
    if (visible && flight.media_type === 'video' && videoRef.current) {
      setTimeout(() => {
        videoRef.current?.play?.();
      }, 50);
    }
  }, [visible, flight.media_type]);

  const handleShare = async () => {
    setSharing(true);
    try {
      // För video: dela videon direkt
      if (f.media_type === 'video' && f.photo_uri) {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(f.photo_uri, { mimeType: 'video/mp4', dialogTitle: 'Dela flygning' });
        }
      } else {
        // För bild: fånga via ViewShot och dela som PNG
        if (!viewShotRef.current?.capture) return;
        const uri = await viewShotRef.current.capture();
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'Dela flygning' });
        }
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
    const utcH = parseInt(f.dep_utc?.split(':')[0] ?? '', 10);
    if (isNaN(utcH)) return '';
    const utcOffset = depCoord ? Math.round(depCoord.lon / 15) : 0;
    const localH = ((utcH + utcOffset) % 24 + 24) % 24;
    if (localH >= 5 && localH < 8) return 'Dawn flight';
    if (localH >= 8 && localH < 12) return 'Morning flight';
    if (localH >= 12 && localH < 17) return 'Afternoon flight';
    if (localH >= 17 && localH < 20) return 'Evening flight';
    return 'Night flight';
  })();
  const hasRoute = depCoord && arrCoord && (depCoord.lat !== arrCoord.lat || depCoord.lon !== arrCoord.lon);
  const routeSvg = hasRoute ? buildRouteSvg(depCoord!, arrCoord!, depName, arrName) : null;

  // För video: visa och dela bara videon, ingen ViewShot/lager
  if (f.media_type === 'video' && f.photo_uri) {
    return (
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <VideoView
            ref={videoRef}
            source={{ uri: f.photo_uri }}
            style={{ flex: 1 }}
            resizeMode="cover"
            isLooping
            isMuted
            shouldPlay
            useNativeControls
          />
          <View style={{ position: 'absolute', top: insets.top + 12, right: 16, gap: 12, zIndex: 10 }}>
            <TouchableOpacity
              onPress={handleShare}
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}
              disabled={sharing}
            >
              {sharing ? <ActivityIndicator color="#fff" /> : <Ionicons name="share-outline" size={20} color="#fff" />}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onClose}
              style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}
            >
              <Ionicons name="close" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  // För bild: använd ViewShot med lager
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000', position: 'relative' }}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ViewShot ref={viewShotRef} options={{ format: 'png', quality: 1, width: 1080, height: 1440 }}>
            <View style={styles.card}>
              {/* Static photo/video background - använd thumbnail för video */}
              {f.photo_uri ? (
                <Image
                  source={{ uri: f.media_type === 'video' ? (thumbnailUri || f.photo_uri) : f.photo_uri }}
                  style={StyleSheet.absoluteFill}
                  resizeMode="cover"
                />
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
                {(mode === 'slim' || mode === 'extra') && (<>
                  {routeSvg && (
                    <View style={styles.routeOverlay}>
                      <Image source={{ uri: `data:image/svg+xml;utf8,${encodeURIComponent(routeSvg)}` }} style={{ width: CARD_W * 0.55, height: CARD_W * 0.35 }} resizeMode="contain" />
                    </View>
                  )}
                  <View style={styles.statsContainer}>
                    <View style={styles.routeTextRow}>
                      <View style={{ alignItems: 'center' }}>
                        <RunwayDiagram icao={f.dep_place} size={32} />
                        <Text style={[styles.placeText, LT.shadow, { fontFamily: font, color: LT.text }]}>{depName}</Text>
                      </View>
                      <View style={styles.routeLine}>
                        <View style={[styles.dot, { backgroundColor: LT.dot }]} />
                        <View style={[styles.line, { backgroundColor: LT.line }]} />
                        <View style={{ alignItems: 'center' }}>
                          <Ionicons name="airplane" size={14} color={LT.muted} style={LT.shadow} />
                          {distanceNm > 0 && <Text style={[{ color: LT.muted, fontSize: 10, fontWeight: '700', fontFamily: font }, LT.shadow]}>{distanceNm} NM</Text>}
                        </View>
                        <View style={[styles.line, { backgroundColor: LT.line }]} />
                        <View style={[styles.dot, { backgroundColor: LT.dot }]} />
                      </View>
                      <View style={{ alignItems: 'center' }}>
                        <RunwayDiagram icao={f.arr_place} size={32} />
                        <Text style={[styles.placeText, LT.shadow, { fontFamily: font, color: LT.text }]}>{arrName}</Text>
                      </View>
                    </View>
                    {mode === 'extra' && (
                      <View style={styles.statsGrid}>
                        <StatItem label="Total Time" value={`${formatTime(f.total_time)}h`} large font={font} textColor={LT.text} mutedColor={LT.muted} shadow={LT.shadow} />
                        <StatItem label="Aircraft" value={`${f.aircraft_type} ${f.registration}`} font={font} textColor={LT.text} mutedColor={LT.muted} shadow={LT.shadow} />
                        <StatItem label="Date" value={dateStr} font={font} textColor={LT.text} mutedColor={LT.muted} shadow={LT.shadow} />
                        {(f.max_fl ?? 0) > 0 && <StatItem label="Max FL" value={`FL${f.max_fl}`} font={font} textColor={LT.text} mutedColor={LT.muted} shadow={LT.shadow} />}
                        {flightNum > 0 && <StatItem label="Flight" value={`#${flightNum} of ${f.date.slice(0, 4)}`} font={font} textColor={LT.text} mutedColor={LT.muted} shadow={LT.shadow} />}
                        {timeOfDay ? <StatItem label="" value={timeOfDay} font={font} textColor={LT.text} mutedColor={LT.muted} shadow={LT.shadow} /> : null}
                      </View>
                    )}
                    <View style={styles.branding}>
                      <Text style={[styles.brandText, LT.shadow, { fontFamily: font }]}>BLADES</Text>
                      <Text style={[styles.brandSub, LT.shadow, { fontFamily: font }]}>Joint Logbook</Text>
                    </View>
                  </View>
                </>)}

                {/* Boarding pass layer */}
                {mode === 'boarding' && (
                  <View style={{ position: 'absolute', left: 16, right: 16, bottom: 16, backgroundColor: '#F6F1E8', borderRadius: 8, overflow: 'hidden' }}>
                    <View style={{ padding: 14, paddingBottom: 12 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <Text style={{ fontFamily: 'Menlo', fontSize: 8, fontWeight: '700', letterSpacing: 1.6, color: '#C9522C' }}>
                          BOARDING · {f.aircraft_type}
                        </Text>
                        <Text style={{ fontFamily: 'Menlo', fontSize: 8, fontWeight: '600', color: '#8A8170', letterSpacing: 0.6 }}>
                          #{flightNum} of {f.date.slice(0, 4)}
                        </Text>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontFamily: 'Menlo', fontSize: 7, color: '#8A8170', letterSpacing: 1.2, fontWeight: '700' }}>FROM</Text>
                          <Text style={{ fontSize: 28, fontWeight: '700', color: '#1B2233', letterSpacing: 1.4 }}>{depName}</Text>
                          <Text style={{ fontSize: 9, color: '#4A5468', marginTop: 2 }}>{f.dep_utc}z</Text>
                        </View>
                        <View style={{ alignItems: 'center', paddingHorizontal: 4 }}>
                          <Svg width={48} height={14} viewBox="0 0 48 14">
                            <Line x1={2} y1={7} x2={46} y2={7} stroke="#C9522C" strokeWidth={0.6} />
                            <Circle cx={2} cy={7} r={1.5} fill="#C9522C" />
                            <Circle cx={46} cy={7} r={1.5} fill="#C9522C" />
                            <Path d="M24 4 L30 7 L24 10 L25.5 7 Z" fill="#C9522C" />
                          </Svg>
                          {distanceNm > 0 && <Text style={{ fontFamily: 'Menlo', fontSize: 7, color: '#8A8170', marginTop: 3, letterSpacing: 0.6 }}>{distanceNm} NM</Text>}
                        </View>
                        <View style={{ flex: 1, alignItems: 'flex-end' }}>
                          <Text style={{ fontFamily: 'Menlo', fontSize: 7, color: '#8A8170', letterSpacing: 1.2, fontWeight: '700' }}>TO</Text>
                          <Text style={{ fontSize: 28, fontWeight: '700', color: '#1B2233', letterSpacing: 1.4 }}>{arrName}</Text>
                          <Text style={{ fontSize: 9, color: '#4A5468', marginTop: 2 }}>{f.arr_utc}z</Text>
                        </View>
                      </View>
                    </View>
                    <View style={{ borderTopWidth: 1, borderTopColor: '#C9C2AE', borderStyle: 'dashed', paddingVertical: 7, paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#EFE7D2' }}>
                      <Text style={{ fontSize: 11, fontWeight: '700', letterSpacing: 2.8, color: '#1B2233' }}>BLADES</Text>
                      <Text style={{ fontFamily: 'Menlo', fontSize: 8, color: '#8A8170', letterSpacing: 0.6 }}>{dateStr} · {formatTime(f.total_time)}h</Text>
                    </View>
                  </View>
                )}

                {/* Postcard — only the title block is draggable */}
                {mode === 'postcard' && (
                  <View style={{ alignItems: 'center', justifyContent: 'center', flex: 1 }}>
                    <Text style={[{ fontFamily: 'Georgia', fontStyle: 'italic', fontWeight: '500', fontSize: 36, color: LT.text, letterSpacing: -0.6 }, LT.shadow]}>
                      From
                    </Text>
                    <Text style={[{ fontFamily: 'Georgia', fontWeight: '600', fontSize: 52, color: LT.text, letterSpacing: -1 }, LT.shadow]}>
                      {depName}
                    </Text>
                    <Text style={[{ fontFamily: 'Georgia', fontStyle: 'italic', fontWeight: '500', fontSize: 36, color: LT.text, letterSpacing: -0.6, marginTop: 6 }, LT.shadow]}>
                      to {arrName}.
                    </Text>
                  </View>
                )}
              </Animated.View>

              {/* Postcard fixed elements — outside draggable area */}
              {mode === 'postcard' && (<>
                <View style={{ position: 'absolute', left: -(CARD_H * 0.25) + 14, top: CARD_H / 2 - 7, width: CARD_H * 0.5, transform: [{ rotate: '-90deg' }] }} pointerEvents="none">
                  <Text style={{ fontFamily: 'Menlo', fontSize: 9, color: '#FFB830', letterSpacing: 1.8, textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.7)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 3 }}>
                    No. {flightNum} · {dateStr} · {timeOfDay.toLowerCase()}
                  </Text>
                </View>
                <View style={{ position: 'absolute', left: 14, right: 14, bottom: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }} pointerEvents="none">
                  <View>
                    <Text style={[{ fontFamily: 'Menlo', fontSize: 7, color: '#FFB830', letterSpacing: 1, marginBottom: 2 }, LT.shadow]}>FLIGHT TIME</Text>
                    <Text style={[{ fontFamily: 'Georgia', fontWeight: '600', fontSize: 14, color: LT.text, letterSpacing: -0.2 }, LT.shadow]}>
                      {formatTime(f.total_time)}h · {f.aircraft_type}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={[{ fontFamily: 'Georgia', fontStyle: 'italic', fontSize: 9, color: LT.text, marginBottom: 1 }, LT.shadow]}>logged in</Text>
                    <Text style={[{ fontFamily: 'Georgia', fontWeight: '700', fontSize: 10, letterSpacing: 2.4, color: '#FFB830' }, LT.shadow]}>BLADES</Text>
                  </View>
                </View>
              </>)}
            </View>
          </ViewShot>

          <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingHorizontal: 20, gap: 10 }}>
            <Ionicons name="remove" size={16} color="rgba(255,255,255,0.4)" />
            <Slider
              style={{ flex: 1, height: 30 }}
              minimumValue={0.4}
              maximumValue={2}
              value={overlayScale}
              onValueChange={setOverlayScale}
              minimumTrackTintColor="#2563EB"
              maximumTrackTintColor="rgba(255,255,255,0.15)"
              thumbTintColor="#fff"
            />
            <Ionicons name="add" size={16} color="rgba(255,255,255,0.4)" />
          </View>

          <View style={{ flexDirection: 'row', alignSelf: 'center', marginTop: 10, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' }}>
            {(['slim', 'extra', 'postcard'] as const).map(m => {
              const labels = { slim: 'Minimal', extra: 'Detailed', postcard: 'Postcard' };
              return (
                <TouchableOpacity
                  key={m}
                  style={{ paddingHorizontal: 14, paddingVertical: 8, backgroundColor: mode === m ? '#2563EB' : 'transparent' }}
                  onPress={() => { setMode(m); applyModeDefaults(m); }}
                >
                  <Text style={{ color: mode === m ? '#fff' : 'rgba(255,255,255,0.5)', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 }}>
                    {labels[m]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={{ flexDirection: 'row', alignSelf: 'center', marginTop: 8, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' }}>
            {(['light', 'dark'] as const).map(t => (
              <TouchableOpacity
                key={t}
                style={{ paddingHorizontal: 16, paddingVertical: 6, backgroundColor: layerTheme === t ? 'rgba(255,255,255,0.15)' : 'transparent' }}
                onPress={() => setLayerTheme(t)}
              >
                <Ionicons name={t === 'light' ? 'sunny' : 'moon'} size={14} color={layerTheme === t ? '#fff' : 'rgba(255,255,255,0.4)'} />
              </TouchableOpacity>
            ))}
          </View>
          <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, textAlign: 'center', marginTop: 6 }}>Drag to move · Slider to resize</Text>
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

function StatItem({ label, value, large, font = 'Georgia', textColor = '#fff', mutedColor = 'rgba(255,255,255,0.6)', shadow = SHADOW }: { label: string; value: string; large?: boolean; font?: string; textColor?: string; mutedColor?: string; shadow?: any }) {
  return (
    <View style={{ marginRight: 16, marginBottom: 8 }}>
      <Text style={[{ color: mutedColor, fontSize: 9, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, fontFamily: font }, shadow]}>
        {label}
      </Text>
      <Text style={[{
        color: textColor, fontSize: large ? 28 : 16, fontWeight: '800',
        fontFamily: font,
      }, shadow]}>
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
              backgroundColor: '#FFB830',
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
    color: '#FFB830',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 3,
    fontFamily: 'Georgia',
  },
  brandSub: {
    color: '#FFB830aa',
    fontSize: 9,
    fontWeight: '600',
    fontFamily: 'Georgia',
  },
});
