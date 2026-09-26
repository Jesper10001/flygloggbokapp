import React, { useMemo, useRef, useState } from 'react';
import { View, Text, Modal, Pressable, TouchableOpacity, StyleSheet } from 'react-native';
import MapView, { Marker, Polyline, type Region } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';

export interface MapPoint { icao: string; name?: string; lat: number; lon: number }

// Gemensam: filtrera giltiga punkter, bygg koordinater, unika flygplatser och en region som ramar rutten.
function useRouteGeo(points: MapPoint[]) {
  const valid = useMemo(
    () => points.filter((p) => p.icao !== 'ZZZZ' && Number.isFinite(p.lat) && Number.isFinite(p.lon)),
    [points],
  );
  const coords = useMemo(() => valid.map((p) => ({ latitude: p.lat, longitude: p.lon })), [valid]);
  const airports = useMemo(() => {
    const seen = new Set<string>();
    return valid.filter((p) => (seen.has(p.icao) ? false : (seen.add(p.icao), true)));
  }, [valid]);
  const region: Region | undefined = useMemo(() => {
    if (!valid.length) return undefined;
    const lats = valid.map((p) => p.lat), lons = valid.map((p) => p.lon);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    return {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLon + maxLon) / 2,
      latitudeDelta: Math.max(0.4, (maxLat - minLat) * 1.6),
      longitudeDelta: Math.max(0.4, (maxLon - minLon) * 1.6),
    };
  }, [valid]);
  return { valid, coords, airports, region };
}

// Rutt-lager (kontur + färgad linje + ICAO-markörer) — delas av preview och fullskärmsmodal.
function RouteOverlay({ coords, airports, accent }: {
  coords: { latitude: number; longitude: number }[];
  airports: MapPoint[];
  accent: string;
}) {
  return (
    <>
      {coords.length >= 2 && (
        <Polyline coordinates={coords} strokeColor="rgba(0,0,0,0.55)" strokeWidth={6} lineCap="round" lineJoin="round" zIndex={2} />
      )}
      {coords.length >= 2 && (
        <Polyline coordinates={coords} strokeColor={accent} strokeWidth={3.5} lineCap="round" lineJoin="round" zIndex={3} />
      )}
      {airports.flatMap((p, i) => [
        <Marker key={'d' + i} coordinate={{ latitude: p.lat, longitude: p.lon }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} zIndex={5}>
          <View style={[styles.dot, { backgroundColor: accent }]} />
        </Marker>,
        <Marker key={'l' + i} coordinate={{ latitude: p.lat, longitude: p.lon }} anchor={{ x: 0.5, y: 1 }} tracksViewChanges={false} zIndex={6}>
          <View style={{ alignItems: 'center' }}>
            <View style={styles.chip}><Text style={styles.chipTxt}>{p.icao}</Text></View>
            <View style={{ height: 12 }} />
          </View>
        </Marker>,
      ])}
    </>
  );
}

// Icke-interaktiv preview-karta för kortet — visar HELA rutten på Apple Maps.
export function RouteMapPreview({ points, accent = Colors.accent, height = 300, borderRadius = 0, padding = 46 }: {
  points: MapPoint[]; accent?: string; height?: number; borderRadius?: number; padding?: number;
}) {
  const mapRef = useRef<MapView>(null);
  const { coords, airports, region } = useRouteGeo(points);
  if (!region) return null;
  return (
    <View style={{ height, borderRadius, overflow: 'hidden' }}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        mapType="standard"
        onMapReady={() => {
          if (coords.length >= 2) {
            mapRef.current?.fitToCoordinates(coords, {
              edgePadding: { top: padding, right: padding, bottom: padding, left: padding },
              animated: false,
            });
          }
        }}
        scrollEnabled={false}
        zoomEnabled={false}
        rotateEnabled={false}
        pitchEnabled={false}
        showsCompass={false}
        pointerEvents="none"
      >
        <RouteOverlay coords={coords} airports={airports} accent={accent} />
      </MapView>
    </View>
  );
}

interface Props {
  visible: boolean;
  onClose: () => void;
  points: MapPoint[];
  accent?: string;
}

// Rutten ritas på Apple Maps (react-native-maps, standard-provider på iOS). Karta ↔ satellit via knapp.
export function RouteLeafletModal({ visible, onClose, points, accent = Colors.accent }: Props) {
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const [sat, setSat] = useState(false);
  const { coords, airports, region } = useRouteGeo(points);

  const fitRoute = () => {
    if (coords.length >= 2) {
      mapRef.current?.fitToCoordinates(coords, {
        edgePadding: { top: insets.top + 70, right: 60, bottom: 90, left: 60 },
        animated: true,
      });
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {region && (
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            initialRegion={region}
            mapType={sat ? 'hybrid' : 'standard'}
            onMapReady={fitRoute}
            showsCompass={false}
          >
            <RouteOverlay coords={coords} airports={airports} accent={accent} />
          </MapView>
        )}

        {/* Knappar nere till höger: zooma till rutten + karta/satellit-växling. */}
        <View style={[styles.btnRow, { bottom: insets.bottom + 14 }]}>
          <TouchableOpacity onPress={fitRoute} activeOpacity={0.85} style={styles.mapBtn}>
            <Ionicons name="scan-outline" size={13} color="#fff" />
            <Text style={styles.btnTxt}>Fit route</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setSat((v) => !v)} activeOpacity={0.85} style={styles.mapBtn}>
            <Ionicons name={sat ? 'map' : 'globe'} size={13} color="#fff" />
            <Text style={styles.btnTxt}>{sat ? 'Map' : 'Satellite'}</Text>
          </TouchableOpacity>
        </View>

        <Pressable style={[styles.closeBtn, { top: insets.top + 12 }]} onPress={onClose} hitSlop={12}>
          <Ionicons name="close" size={20} color="#fff" />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A1628' },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: '#fff' },
  chip: {
    backgroundColor: 'rgba(15,22,38,0.92)', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.28)',
  },
  chipTxt: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 0.5, fontFamily: 'Menlo' },
  btnRow: { position: 'absolute', right: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  mapBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, height: 32, paddingHorizontal: 12, borderRadius: 16,
    backgroundColor: 'rgba(15,22,38,0.92)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.22)',
  },
  btnTxt: { color: '#fff', fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  closeBtn: {
    position: 'absolute', right: 16,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.2)',
  },
});
