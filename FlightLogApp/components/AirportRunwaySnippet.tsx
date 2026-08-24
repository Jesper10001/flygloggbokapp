// Liten fokuserad kart-snippet över EN flygplats med utritade landningsbanor (samma stil som global map).
// Ej vridbar (rotateEnabled=false) men inzoomningsbar. Saknas bangeometri → visa bara flygplatsens läge.
import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import MapView, { Marker, Polygon, type Region } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { getRunwayGeo, runwayCorners, runwayBearing, runwaySideLabelPoint } from '../constants/runwayGeo';
import { Colors } from '../constants/colors';

const RWY_HL = '#67E8F9'; // cyan-highlight för aktiv bana (efter vind)

export function AirportRunwaySnippet({ icao, lat, lon, windDir, windSpeed, style }: {
  icao: string;
  lat: number;
  lon: number;
  windDir?: number | null;   // METAR-vind (varifrån) → highlighta banänden man landar/startar mot
  windSpeed?: number | null; // kt; lugn vind (<3) → ingen aktiv bana
  style?: object;
}) {
  // Vilken banände (le/he) är gynnad av vinden? Motvind = ändens kurs pekar mot vindkällan.
  // ~vinkelrät vind (mitt mellan) eller lugn/variabel → ingen highlight.
  const activeEnd = (rw: { le: { lat: number; lon: number }; he: { lat: number; lon: number } }): 'le' | 'he' | null => {
    if (windDir == null) return null;
    if (windSpeed != null && windSpeed < 3) return null; // lugnt → ingen aktiv bana
    const leHeading = runwayBearing(rw as any); // le→he-kurs
    const hw = Math.cos(((windDir - leHeading) * Math.PI) / 180); // >0 → le mot vinden, <0 → he
    if (Math.abs(hw) < 0.02) return null; // ~vinkelrät (mitt mellan) → ingen
    return hw > 0 ? 'le' : 'he';
  };
  const runways = useMemo(
    () => getRunwayGeo(icao).map((rw) => ({ rw, corners: runwayCorners(rw) })),
    [icao],
  );
  const hasRw = runways.length > 0;

  // Rama in banorna (annars en liten default-ruta runt fältet). ×1.7 → lite mer inzoomad (banorna fyller mer).
  const region = useMemo<Region>(() => {
    if (!hasRw) return { latitude: lat, longitude: lon, latitudeDelta: 0.018, longitudeDelta: 0.018 };
    let minLa = 90, maxLa = -90, minLo = 180, maxLo = -180;
    for (const { corners } of runways) for (const c of corners) {
      if (c.latitude < minLa) minLa = c.latitude; if (c.latitude > maxLa) maxLa = c.latitude;
      if (c.longitude < minLo) minLo = c.longitude; if (c.longitude > maxLo) maxLo = c.longitude;
    }
    return {
      latitude: (minLa + maxLa) / 2, longitude: (minLo + maxLo) / 2,
      latitudeDelta: Math.max((maxLa - minLa) * 1.7, 0.006),
      longitudeDelta: Math.max((maxLo - minLo) * 1.7, 0.006),
    };
  }, [runways, hasRw, lat, lon]);

  const [sat, setSat] = useState(false); // mörk standardkarta default; knappen växlar till satellit

  // iOS rasteriserar egna markörvyer bara medan tracksViewChanges=true → spåra en kort stund vid start.
  const [tracks, setTracks] = useState(true);
  // Re-rasterisera markörerna även när vinden kommer in (async efter mount) så highlighten dyker upp.
  useEffect(() => { setTracks(true); const id = setTimeout(() => setTracks(false), 2200); return () => clearTimeout(id); }, [icao, windDir, windSpeed]);

  return (
    <View style={[styles.wrap, style]}>
      <MapView
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        mapType={sat ? 'hybrid' : 'standard'} // mörk standardkarta default; satellit (2D hybrid) via knapp
        rotateEnabled={false}      // ej vridbar (som efterfrågat)
        pitchEnabled={false}
        zoomEnabled                // inzoomningsbar
        scrollEnabled
        userInterfaceStyle="dark"
        showsPointsOfInterest={false}
        showsCompass={false}
        toolbarEnabled={false}
      >
        {/* Banor (mörk asfalt + vit kant) */}
        {runways.map(({ corners }, i) => (
          <Polygon key={`rwy-${i}`} coordinates={corners}
            fillColor="rgba(24,24,27,0.82)" strokeColor="rgba(255,255,255,0.9)" strokeWidth={1.2} zIndex={5} />
        ))}
        {/* Bannummer vid trösklarna + mått bredvid banan. Billboard-markörer (ej flat, ingen rotation) →
            FASTA positioner + storlek: upprätta, roterar/skalar inte när man vrider skärmen/kartan. */}
        {runways.flatMap(({ rw }, i) => {
          const dimPt = runwaySideLabelPoint(rw, rw.widthM / 2 + 80);
          const act = activeEnd(rw); // banände gynnad av vinden → cyan-highlight (vit text kvar)
          return [
            <Marker key={`le-${i}`} coordinate={{ latitude: rw.le.lat, longitude: rw.le.lon }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={tracks}>
              <View style={act === 'le' ? styles.identActive : undefined}><Text style={styles.ident}>{rw.leIdent}</Text></View>
            </Marker>,
            <Marker key={`he-${i}`} coordinate={{ latitude: rw.he.lat, longitude: rw.he.lon }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={tracks}>
              <View style={act === 'he' ? styles.identActive : undefined}><Text style={styles.ident}>{rw.heIdent}</Text></View>
            </Marker>,
            <Marker key={`dim-${i}`} coordinate={dimPt} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={tracks}>
              <View><Text style={styles.dim}>{rw.lengthM} m × {rw.widthM} m</Text></View>
            </Marker>,
          ];
        })}
        {/* Utan bangeometri: markera bara fältets läge. */}
        {!hasRw && (
          <Marker coordinate={{ latitude: lat, longitude: lon }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={tracks}>
            <View style={styles.dot} />
          </Marker>
        )}
      </MapView>
      {!hasRw && (
        <View style={styles.noRwBadge} pointerEvents="none">
          <Text style={styles.noRwTxt}>No runway data</Text>
        </View>
      )}
      {/* Växla mörk karta ↔ satellit (nere till höger) */}
      <TouchableOpacity onPress={() => setSat((v) => !v)} activeOpacity={0.85} style={styles.satBtn}>
        <Ionicons name={sat ? 'map' : 'globe'} size={13} color="#fff" />
        <Text style={styles.satTxt}>{sat ? 'Map' : 'Satellite'}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 210, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: Colors.cardBorder, backgroundColor: Colors.card },
  ident: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 0.5, textShadowColor: 'rgba(0,0,0,0.95)', textShadowRadius: 3, textShadowOffset: { width: 0, height: 0 } },
  // Aktiv banände (efter vind): cyan ram runt bansiffran, texten förblir vit.
  identActive: { borderWidth: 1.5, borderColor: RWY_HL, borderRadius: 5, paddingHorizontal: 4, paddingVertical: 1, backgroundColor: 'rgba(103,232,249,0.18)' },
  dim: { color: '#fff', fontSize: 9, fontWeight: '700', letterSpacing: 0.3, textShadowColor: 'rgba(0,0,0,0.95)', textShadowRadius: 3, textShadowOffset: { width: 0, height: 0 } },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: Colors.primary, borderWidth: 2, borderColor: '#fff' },
  noRwBadge: { position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(15,22,38,0.9)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  noRwTxt: { color: Colors.textSecondary, fontSize: 10.5, fontWeight: '700' },
  satBtn: { position: 'absolute', bottom: 8, right: 8, flexDirection: 'row', alignItems: 'center', gap: 5, height: 30, paddingHorizontal: 10, borderRadius: 15, backgroundColor: 'rgba(15,22,38,0.92)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.22)' },
  satTxt: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
