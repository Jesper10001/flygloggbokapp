// Liten fokuserad kart-snippet över EN flygplats med utritade landningsbanor (RunwayOverlays: samma stil som
// vädersidan och Global map, i verklig bredd och längd).
// Ej vridbar (rotateEnabled=false) men inzoomningsbar. Saknas bangeometri → visa bara flygplatsens läge.
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import MapView, { Marker, Polyline, type Region } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { getRunwayGeo, runwayCorners, runwayBearing } from '../constants/runwayGeo';
import { RunwayOverlays } from './RunwayOverlays';
import { Colors } from '../constants/colors';

export function AirportRunwaySnippet({ icao, lat, lon, windDir, windSpeed, style, frozen, userLat, userLon, fitUser }: {
  icao: string;
  lat: number;
  lon: number;
  windDir?: number | null;   // METAR-vind (varifrån) → highlighta banänden man landar/startar mot
  windSpeed?: number | null; // kt; lugn vind (<3) → ingen aktiv bana
  style?: object;
  frozen?: boolean;          // sätts strax före avmontering → tvingar tracksViewChanges=false (annars kraschar iOS-teardown)
  userLat?: number | null;   // din position → rita ut position + färdväg + 5 km-cirkel (bara i "Closest to me")
  userLon?: number | null;
  fitUser?: boolean;         // true = öppnad via "Closest to me" → visa position/rutt/cirkel + zooma ut till overview
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
  const rwList = useMemo(() => getRunwayGeo(icao), [icao]);
  const runways = useMemo(() => rwList.map((rw) => ({ rw, corners: runwayCorners(rw) })), [rwList]);
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

  const hasUser = userLat != null && userLon != null;
  const showNav = !!fitUser; // position/rutt/cirkel + overview visas bara i "Closest to me"
  const mapRef = useRef<MapView>(null);
  const didFit = useRef(false);
  const CIRCLE_M = 2500; // 5 km diameter
  const circleDeg = CIRCLE_M / 111320;

  // Overview: ramar in din position + flygplatsen (+ 5 km-cirkeln). Utan position = bang-vyn.
  const overviewRegion = useMemo<Region>(() => {
    if (!hasUser) return region;
    const cosL = Math.max(0.2, Math.cos((lat * Math.PI) / 180));
    const minLa = Math.min(userLat!, lat - circleDeg), maxLa = Math.max(userLat!, lat + circleDeg);
    const minLo = Math.min(userLon!, lon - circleDeg / cosL), maxLo = Math.max(userLon!, lon + circleDeg / cosL);
    return {
      latitude: (minLa + maxLa) / 2, longitude: (minLo + maxLo) / 2,
      latitudeDelta: Math.max((maxLa - minLa) * 1.4, 0.02),
      longitudeDelta: Math.max((maxLo - minLo) * 1.4, 0.02),
    };
  }, [hasUser, userLat, userLon, lat, lon, region, circleDeg]);

  // Pil mitt på färdvägen som pekar mot flygplatsen. Mittpunkt + bäring räknas i Mercator så pilen
  // ligger exakt på det raka strecket och pekar rätt (kartans nord är uppåt, rotateEnabled=false).
  const routeArrow = useMemo(() => {
    if (!hasUser) return null;
    const rad = Math.PI / 180;
    const y1 = Math.log(Math.tan(Math.PI / 4 + (userLat! * rad) / 2));
    const y2 = Math.log(Math.tan(Math.PI / 4 + (lat * rad) / 2));
    const midLat = (2 * Math.atan(Math.exp((y1 + y2) / 2)) - Math.PI / 2) / rad;
    const midLon = (userLon! + lon) / 2;
    const bearing = ((Math.atan2((lon - userLon!) * rad, y2 - y1) / rad) + 360) % 360;
    return { midLat, midLon, bearing };
  }, [hasUser, userLat, userLon, lat, lon]);

  // Positionen kan komma EFTER mount → panorera ut till overview en gång (bara i "Closest to me").
  useEffect(() => {
    if (showNav && hasUser && !didFit.current) {
      didFit.current = true;
      mapRef.current?.animateToRegion(overviewRegion, 500);
    }
  }, [showNav, hasUser, overviewRegion]);

  // Closest to me: EN toggle-knapp Zoom ⇄ Zoom out (overview = din position + flygplatsen + cirkeln).
  // Startar utzoomad (kartan öppnar i overview) → knappen visar "Zoom" (in). Stegar sedan fram och tillbaka.
  const [zoomedIn, setZoomedIn] = useState(false);
  const toggleZoom = () => {
    if (zoomedIn) { mapRef.current?.animateToRegion(overviewRegion, 350); setZoomedIn(false); }
    else { mapRef.current?.animateToRegion(region, 350); setZoomedIn(true); }
  };

  // Meter per skärmpunkt (kartans höjd + regionens latitudspann) → banorna ritas utzoomat som linje + taggar.
  const [mapH, setMapH] = useState(0);
  const [latDelta, setLatDelta] = useState<number | null>(null);
  const mpp = mapH > 0 ? (((latDelta ?? (showNav && hasUser ? overviewRegion : region).latitudeDelta)) * 111320) / mapH : null;

  const [sat, setSat] = useState(false); // mörk standardkarta default; knappen växlar till satellit

  // iOS rasteriserar egna markörvyer bara medan tracksViewChanges=true → spåra en kort stund vid start.
  const [tracks, setTracks] = useState(true);
  // Re-rasterisera markörerna även när vinden kommer in (async efter mount) så highlighten dyker upp.
  useEffect(() => { setTracks(true); const id = setTimeout(() => setTracks(false), 2200); return () => clearTimeout(id); }, [icao, windDir, windSpeed]);

  return (
    <View style={[styles.wrap, style]} onLayout={(e) => setMapH(e.nativeEvent.layout.height)}>
      <MapView
        ref={mapRef}
        onRegionChangeComplete={(r) => setLatDelta(r.latitudeDelta)}
        style={StyleSheet.absoluteFill}
        initialRegion={showNav && hasUser ? overviewRegion : region}
        mapType={sat ? 'hybrid' : 'standard'} // mörk standardkarta default; satellit (2D hybrid) via knapp
        rotateEnabled={false}      // ej vridbar (som efterfrågat)
        pitchEnabled={false}
        zoomEnabled                // inzoomningsbar
        scrollEnabled
        userInterfaceStyle="dark"
        showsPointsOfInterests={false}
        showsCompass={false}
        toolbarEnabled={false}
      >
        {/* "Closest to me": färdväg från din position + position-markör */}
        {showNav && hasUser && (
          <>
            <Polyline coordinates={[{ latitude: userLat!, longitude: userLon! }, { latitude: lat, longitude: lon }]}
              strokeColor={Colors.primary} strokeWidth={3} zIndex={3} />
            {routeArrow && (
              <Marker coordinate={{ latitude: routeArrow.midLat, longitude: routeArrow.midLon }} anchor={{ x: 0.5, y: 0.5 }}
                zIndex={4} tracksViewChanges={!frozen && tracks}>
                {/* Riktnings-puck rakt på strecket: mörk disc + cyan pil + glöd. Pucken (cirkeln) hålls
                    OROTERAD så dess layout-box förblir 26×26 och ankaret (0.5/0.5) centrerar exakt på
                    koordinaten. BARA pilen inuti roteras (kring sin egen mitt) → ingen offset. */}
                <View style={styles.routeArrow}>
                  <Ionicons name="arrow-up" size={16} color={Colors.primary}
                    style={[styles.routeArrowIcon, { transform: [{ rotate: `${Math.round(routeArrow.bearing)}deg` }] }]} />
                </View>
              </Marker>
            )}
            <Marker coordinate={{ latitude: userLat!, longitude: userLon! }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={!frozen && tracks}>
              <View style={styles.youDot} />
            </Marker>
          </>
        )}
        {/* Banor i verklig bredd och längd, i vädersidans stil; änden vinden gynnar är cyan. Inga måttetiketter. */}
        {hasRw && <RunwayOverlays runways={rwList} ends={rwList.map(activeEnd)} tracks={!frozen && tracks} id={icao} mpp={mpp} frozen={frozen} />}
        {/* Utan bangeometri: markera bara fältets läge. */}
        {!hasRw && (
          <Marker coordinate={{ latitude: lat, longitude: lon }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={!frozen && tracks}>
            <View style={styles.dot} />
          </Marker>
        )}
      </MapView>
      {!hasRw && (
        <View style={styles.noRwBadge} pointerEvents="none">
          <Text style={styles.noRwTxt}>No runway data</Text>
        </View>
      )}
      {/* Nere till höger: Zoom-toggle (bara i Closest to me — stegar flygplats ⇄ overview) · karta/satellit.
          I vanliga Find airport-vyn finns ingen Zoom-knapp (kartan öppnas redan inramad → den gjorde inget). */}
      <View style={styles.btnRow}>
        {showNav && hasUser && (
          <TouchableOpacity onPress={toggleZoom} activeOpacity={0.85} style={styles.mapBtn}>
            <Ionicons name={zoomedIn ? 'contract-outline' : 'scan-outline'} size={13} color="#fff" />
            <Text style={styles.satTxt}>{zoomedIn ? 'Zoom out' : 'Zoom'}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={() => setSat((v) => !v)} activeOpacity={0.85} style={styles.mapBtn}>
          <Ionicons name={sat ? 'map' : 'globe'} size={13} color="#fff" />
          <Text style={styles.satTxt}>{sat ? 'Map' : 'Satellite'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 315, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: Colors.cardBorder, backgroundColor: Colors.card },
  btnRow: { position: 'absolute', bottom: 8, right: 8, flexDirection: 'row', alignItems: 'center', gap: 8 },
  mapBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 30, paddingHorizontal: 10, borderRadius: 15, backgroundColor: 'rgba(15,22,38,0.92)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.22)' },
  youDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: Colors.primary, borderWidth: 2.5, borderColor: '#fff' },
  // Riktnings-puck på färdvägen: mörk disc (som kartknapparna) + cyan kant + cyan glöd → syns mot både
  // den cyanfärgade linjen och kartan. Rund → rotationen vrider bara pilen inuti.
  routeArrow: {
    width: 26, height: 26, borderRadius: 13,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(11,17,32,0.95)',
    borderWidth: 1.5, borderColor: Colors.primary,
    shadowColor: Colors.primary, shadowOpacity: 0.9, shadowRadius: 5, shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  routeArrowIcon: { marginTop: -0.5 },
  dot: { width: 12, height: 12, borderRadius: 6, backgroundColor: Colors.primary, borderWidth: 2, borderColor: '#fff' },
  noRwBadge: { position: 'absolute', top: 8, left: 8, backgroundColor: 'rgba(15,22,38,0.9)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  noRwTxt: { color: Colors.textSecondary, fontSize: 10.5, fontWeight: '700' },
  satBtn: { position: 'absolute', bottom: 8, right: 8, flexDirection: 'row', alignItems: 'center', gap: 5, height: 30, paddingHorizontal: 10, borderRadius: 15, backgroundColor: 'rgba(15,22,38,0.92)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.22)' },
  satTxt: { color: '#fff', fontSize: 11, fontWeight: '700' },
});
