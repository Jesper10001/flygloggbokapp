// Global flygplatskarta med level-of-detail-klustring (Apple Maps via
// react-native-maps). Zoomnivån (region.latitudeDelta) avgör vad som visas:
//   utzoomad   → en FLAGG-pin per LAND med antal
//   inzoomad   → enskilda blå PLUPPAR (viewport-filtrerat)
//   mer inzoom → pluppar + ICAO-etikett
//
// 34k flygplatser kan inte renderas samtidigt — därför aggregat + viewport-cap.

import { useMemo, useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, Polyline, Polygon, type Region, type MapType } from 'react-native-maps';
import { Colors } from '../constants/colors';
import { flagEmoji } from '../constants/continents';
import { getRunways } from '../utils/runways';

// icao,name,country,region,lat,lon + berikning (airportmap.de): iata,alt,type,municipality,restriction.
// Berikningsfälten är optional så äldre 6-elements-konstruktioner (ex AirportMapWidget) fortsätter gälla.
export type SeedRow = [string, string, string, string, number, number, string?, (number | null)?, string?, string?, string?];

const INITIAL: Region = { latitude: 25, longitude: 5, latitudeDelta: 110, longitudeDelta: 110 };
// Markör-tak sätts per nivå nedan: pluppar = lätta native-nålar (tål många),
// ICAO-etiketter = egna vyer (tunga) → bara få på närmsta zoomen.

// initialRegion: ramar in en specifik vy (t.ex. en pilots besökta flygplatser i
// Wrapped). interactive=false låser gesterna (svep i Wrapped-storyn ska bläddra,
// inte panorera kartan).
// mode: 'auto' = nivå efter zoom (land → pluppar → pluppar+etikett). 'pins' = alltid
// enskilda pins + ICAO-etikett (för FÅ flygplatser, t.ex. besökta). 'country' = ALLTID
// land-flaggor oavsett zoom (för den stora 34k-databasen → byter aldrig till pins, kraschar ej).
export type RegionMarker = { key: string; label: string; count: number; lat: number; lon: number };

export function GlobalAirportMap({ airports, initialRegion, interactive = true, mode = 'auto', onSelectAirport, onSelectCountry, selectedIcao, mapType = 'standard', focus, hideCountries, showLayerToggle, pins, matrixStroke, matrixFill, hulls, regionShapes, regionMarkers, onSelectRegion, frameRegion, showCompass, compassTop, neighborShapes, neighborMarkers, onSelectNeighbor }: { airports: SeedRow[]; initialRegion?: Region; interactive?: boolean; mode?: 'auto' | 'pins' | 'country'; onSelectAirport?: (icao: string) => void; onSelectCountry?: (cc: string) => void; selectedIcao?: string; mapType?: MapType; focus?: SeedRow | null; hideCountries?: boolean; showLayerToggle?: boolean; pins?: SeedRow[]; matrixStroke?: { latitude: number; longitude: number }[]; matrixFill?: { latitude: number; longitude: number }[]; hulls?: { latitude: number; longitude: number }[][]; regionShapes?: { key: string; rings: { latitude: number; longitude: number }[][] }[]; regionMarkers?: RegionMarker[]; onSelectRegion?: (key: string) => void; frameRegion?: Region; showCompass?: boolean; compassTop?: number; neighborShapes?: { key: string; rings: { latitude: number; longitude: number }[][] }[]; neighborMarkers?: RegionMarker[]; onSelectNeighbor?: (key: string) => void }) {
  const mapRef = useRef<MapView>(null);
  const [region, setRegion] = useState<Region>(initialRegion ?? INITIAL);
  const [layer, setLayer] = useState<MapType>(mapType);
  useEffect(() => { setLayer(mapType); }, [mapType]); // följ extern mapType-prop (t.ex. visited-kartans satellitknapp)
  const [heading, setHeading] = useState(0); // kartans rotation (0 = norr uppåt) → styr kompassrosen
  const [pitch, setPitch] = useState(0);     // kartans lutning (0 = platt)
  const showPins = !!pins && pins.length > 0; // visa en exakt uppsättning flygplatser (filtrerat land)
  const prevRegionRef = useRef<Region | null>(null); // vy före fokus → återställs när kortet stängs
  const prevLayerRef = useRef<MapType | null>(null);

  // Aggregat per land (centroid + antal) — beräknas en gång.
  const byCountry = useMemo(() => {
    const ctry = new Map<string, { latSum: number; lonSum: number; count: number }>();
    for (const a of airports) {
      const lat = a[4], lon = a[5];
      if (!isFinite(lat) || !isFinite(lon)) continue;
      const cc = (a[2] || '').toUpperCase();
      const c = ctry.get(cc) ?? { latSum: 0, lonSum: 0, count: 0 };
      c.latSum += lat; c.lonSum += lon; c.count++; ctry.set(cc, c);
    }
    return [...ctry.entries()].map(([cc, v]) => ({ cc, lat: v.latSum / v.count, lon: v.lonSum / v.count, count: v.count }));
  }, [airports]);

  const delta = region.latitudeDelta;
  // Klustra länder längre in (delta>3.5) så pluppar bara dyker upp när vyn är
  // liten nog att hålla få markörer → undviker Apple Maps-krasch.
  const level: 'country' | 'dots' | 'labels' =
    mode === 'country' ? 'country'
      : mode === 'pins' ? 'labels'
      : delta > 3.5 ? 'country' : delta > 0.8 ? 'dots' : 'labels';

  // Viewport-filtrerade enskilda flygplatser (bara på plupp-nivåerna).
  const dots = useMemo(() => {
    if (mode === 'pins') return airports; // få flygplatser → visa alla enskilt
    if (level !== 'dots' && level !== 'labels') return [];
    const latMin = region.latitude - region.latitudeDelta / 2 - 0.1;
    const latMax = region.latitude + region.latitudeDelta / 2 + 0.1;
    const lonMin = region.longitude - region.longitudeDelta / 2 - 0.1;
    const lonMax = region.longitude + region.longitudeDelta / 2 + 0.1;
    const out: SeedRow[] = [];
    const cap = level === 'labels' ? 70 : 350; // egna vyer (labels) hålls få; native-nålar tål fler
    for (const a of airports) {
      if (a[4] >= latMin && a[4] <= latMax && a[5] >= lonMin && a[5] <= lonMax) {
        out.push(a);
        if (out.length >= cap) break;
      }
    }
    return out;
  }, [airports, level, region, mode]);

  // Vald flygplats (för guld-markeringen) — finns bara i pins/labels-läget.
  const selRow = useMemo(
    () => (selectedIcao ? dots.find((a) => a[0] === selectedIcao) : undefined),
    [dots, selectedIcao],
  );

  // Platta ut region-/grann-ytor till [{nyckel, ring}] (nyckel per ring → hela ytan klickbar) med
  // hårt tak (kraschsäkerhet). Löv-konturen (hulls) ritas separat, ej klickbar.
  type FlatPoly = { key: string; ring: { latitude: number; longitude: number }[] };
  const regionPolys = useMemo<FlatPoly[]>(() => {
    const out: FlatPoly[] = [];
    for (const sh of regionShapes ?? []) for (const ring of sh.rings) if (ring.length >= 3) { out.push({ key: sh.key, ring }); if (out.length >= 240) return out; }
    return out;
  }, [regionShapes]);
  const neighborPolys = useMemo<FlatPoly[]>(() => {
    const out: FlatPoly[] = [];
    for (const sh of neighborShapes ?? []) for (const ring of sh.rings) if (ring.length >= 3) { out.push({ key: sh.key, ring }); if (out.length >= 70) return out; }
    return out;
  }, [neighborShapes]);

  const zoomTo = (lat: number, lon: number, d: number) =>
    mapRef.current?.animateToRegion({ latitude: lat, longitude: lon, latitudeDelta: d, longitudeDelta: d }, 450);

  // Kompassros → återställ norr uppåt + platt vy (behåll center/zoom).
  const resetNorth = async () => {
    const cam = await mapRef.current?.getCamera().catch(() => undefined);
    if (cam) mapRef.current?.animateCamera({ ...cam, heading: 0, pitch: 0 }, { duration: 300 });
  };
  // Läs av rotation/lutning löpande (getCamera är async). Inflight-skydd → ingen anrops-hög vid
  // snabba region-ändringar; körs både under (onRegionChange) och efter (onRegionChangeComplete) gest.
  const camBusy = useRef(false);
  const syncCamera = () => {
    if (camBusy.current) return;
    camBusy.current = true;
    mapRef.current?.getCamera()
      .then((c) => { camBusy.current = false; if (c) { setHeading(c.heading || 0); setPitch(c.pitch || 0); } })
      .catch(() => { camBusy.current = false; });
  };

  // Vald flygplats (sök/lista) → zooma in så hela banan syns tydligt + skifta till satellit.
  // Zoomgrad skalas efter längsta rullbanan (~2.2× dess längd). När fokus stängs → återställ
  // föregående vy (region + lager) som fanns innan man valde flygplatsen.
  useEffect(() => {
    if (focus) {
      if (!prevRegionRef.current) { prevRegionRef.current = region; prevLayerRef.current = layer; }
      const longestM = getRunways(focus[0]).reduce((m, r) => Math.max(m, r.lengthM), 0);
      const km = longestM > 0 ? longestM / 1000 : 0.9;
      const delta = Math.min(0.11, Math.max(0.018, (km / 111) * 2.2));
      zoomTo(focus[4], focus[5], delta);
      // Byt lager (mapType) FÖRST efter att zoom-animationen körts klart — ändras mapType under
      // animationen avbryter iOS den (kartan zoomar då in först vid nästa val).
      const id = setTimeout(() => setLayer('satelliteFlyover'), 550);
      return () => clearTimeout(id);
    } else if (prevRegionRef.current) {
      const p = prevRegionRef.current, pl = prevLayerRef.current;
      prevRegionRef.current = null; prevLayerRef.current = null;
      mapRef.current?.animateToRegion(p, 450);
      const id = setTimeout(() => { if (pl) setLayer(pl); }, 550);
      return () => clearTimeout(id);
    }
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  // All inramning i land/drill-läget styrs av frameRegion (byts bara vid NAVIGERING, ej vid
  // filterändring) → kartan stannar kvar på samma plats när man redigerar filter.
  useEffect(() => {
    if (frameRegion) mapRef.current?.animateToRegion(frameRegion, 550);
  }, [frameRegion]);

  return (
    <View style={{ flex: 1 }}>
    <MapView
      ref={mapRef}
      style={{ flex: 1 }}
      initialRegion={initialRegion ?? INITIAL}
      onRegionChange={syncCamera}
      onRegionChangeComplete={(r) => { setRegion(r); syncCamera(); }}
      mapType={layer}
      userInterfaceStyle="dark"
      scrollEnabled={interactive}
      zoomEnabled={interactive}
      rotateEnabled={interactive}
      pitchEnabled={interactive}
      showsBuildings
      showsPointsOfInterest={false}
      showsCompass={interactive && !showCompass}
      toolbarEnabled={false}
    >
      {/* Matrix-hölje (largest-area convex hull): svagt cyan-lager som målas fram. Ligger först = bakom pins. */}
      {matrixFill && matrixFill.length >= 3 && (
        <Polygon coordinates={matrixFill} fillColor="rgba(103,232,249,0.20)" strokeColor="rgba(103,232,249,0.5)" strokeWidth={1.5} />
      )}
      {matrixStroke && matrixStroke.length >= 2 && (
        <Polyline coordinates={matrixStroke} strokeColor="#67E8F9" strokeWidth={3} />
      )}

      {/* Grann-ytor (kringliggande länder/regioner): FYLLD dämpad cyan, HELA ytan klickbar → hoppa dit
          (inte bara chippen). tappable-polygonen träffar hela geometrin oavsett fyllnadsopacitet. */}
      {neighborPolys.map(({ key, ring }, i) => (
        <Polygon key={`nb-${key}-${i}`} coordinates={ring} tappable onPress={() => onSelectNeighbor?.(key)}
          fillColor="rgba(103,232,249,0.12)" strokeColor="rgba(103,232,249,0.5)" strokeWidth={1} />
      ))}

      {/* Aktuell nod (löv): BARA kontur (ingen fyllning → cyan täcker inte flygplatserna), EJ klickbar
          — man är redan här. Exakta gränser (borders.json) eller convex-hull-fallback. Tak för säkerhet. */}
      {hulls && hulls.slice(0, 240).map((ring, i) => ring.length >= 3 && (
        <Polygon key={`hull-${i}`} coordinates={ring} fillColor="rgba(0,0,0,0)" strokeColor="rgba(103,232,249,0.85)" strokeWidth={1.5} />
      ))}

      {/* Delregioner (gren): kontur per delnod, HELA ytan klickbar → borra ner (inte bara chippen). */}
      {regionPolys.map(({ key, ring }, i) => (
        <Polygon key={`rs-${key}-${i}`} coordinates={ring} tappable onPress={() => onSelectRegion?.(key)}
          fillColor="rgba(0,0,0,0)" strokeColor="rgba(103,232,249,0.85)" strokeWidth={1.5} />
      ))}

      {level === 'country' && !hideCountries && !showPins && byCountry.map((c) => (
        <Marker
          key={`ctry-${c.cc}`}
          coordinate={{ latitude: c.lat, longitude: c.lon }}
          onPress={() => onSelectCountry ? onSelectCountry(c.cc) : zoomTo(c.lat, c.lon, 3.5)}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
        >
          <View style={s.flagPin}>
            <Text style={s.flagEmoji}>{flagEmoji(c.cc)}</Text>
            <Text style={s.flagCount}>{c.count}</Text>
          </View>
        </Marker>
      ))}

      {/* Pluppar = lätta native-nålar (tål hundratals utan att krascha). Tap → ICAO+namn. */}
      {!showPins && level === 'dots' && dots.map((a) => (
        <Marker
          key={a[0]}
          coordinate={{ latitude: a[4], longitude: a[5] }}
          pinColor="#3b82f6"
          title={a[0]}
          description={a[1]}
        />
      ))}

      {/* Närmsta zoomen: blå plupp PÅ flygplatsen + ICAO-etikett ovanför (egna vyer, hålls
          få via cap). Symmetrisk kolumn [etikett][plupp][spacer] → ankaret (mitten) hamnar
          exakt på pluppen, inte på texten. */}
      {!showPins && level === 'labels' && dots.map((a) => (
        <Marker
          key={a[0]}
          coordinate={{ latitude: a[4], longitude: a[5] }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
          title={onSelectAirport ? undefined : a[0]}
          description={onSelectAirport ? undefined : a[1]}
          onPress={onSelectAirport ? () => onSelectAirport(a[0]) : undefined}
        >
          <View style={{ alignItems: 'center' }}>
            <View style={s.labelChip}><Text style={s.labelText}>{a[0]}</Text></View>
            <View style={s.dot} />
            <View style={s.dotSpacer} />
          </View>
        </Marker>
      ))}

      {/* Guld-markering för vald flygplats: SEPARAT markör ovanpå pluppen. Konstant key +
          statiskt innehåll → byter bara koordinat mellan val, ingen re-snapshot (inget hopp
          till hörnet, ingen krasch). Basmarkörerna rörs aldrig. */}
      {level === 'labels' && selRow && (
        <Marker
          key="__selhl__"
          coordinate={{ latitude: selRow[4], longitude: selRow[5] }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
          onPress={onSelectAirport ? () => onSelectAirport(selRow[0]) : undefined}
        >
          <View style={s.selDot} />
        </Marker>
      )}

      {/* Filtrerat land: filtrerade flygplatser som ICAO-boxar (samma stil som landsflaggan). Tak
          för att inte krascha Apple Maps med för många egna markörvyer. */}
      {showPins && pins!.slice(0, 170).map((a) => (
        <Marker
          key={a[0]}
          coordinate={{ latitude: a[4], longitude: a[5] }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
          onPress={onSelectAirport ? () => onSelectAirport(a[0]) : undefined}
        >
          <View style={s.icaoPin}><Text style={s.icaoPinTxt}>{a[0]}</Text></View>
        </Marker>
      ))}

      {/* Region-drill: text-chip (etikett + antal) per delnod → tryck borrar ner. */}
      {regionMarkers && regionMarkers.slice(0, 60).map((m) => (
        <Marker
          key={`${m.key}:${m.count}`}
          coordinate={{ latitude: m.lat, longitude: m.lon }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
          onPress={onSelectRegion ? () => onSelectRegion(m.key) : undefined}
        >
          <View style={s.regionChip}>
            <Text style={s.regionChipLabel} numberOfLines={2}>{m.label}</Text>
            <Text style={s.regionChipCount}>{m.count}</Text>
          </View>
        </Marker>
      ))}

      {/* Grann-gränser: dämpad klickbar chip (land/region) → tryck hoppar dit. */}
      {neighborMarkers && neighborMarkers.slice(0, 10).map((m) => (
        <Marker
          key={`nb:${m.key}`}
          coordinate={{ latitude: m.lat, longitude: m.lon }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
          onPress={onSelectNeighbor ? () => onSelectNeighbor(m.key) : undefined}
        >
          <View style={s.neighborChip}>
            <Text style={s.neighborChipLabel} numberOfLines={1}>{m.label}</Text>
          </View>
        </Marker>
      ))}

      {/* Sökt/vald flygplats: guld-markör + ICAO-etikett. Döljs i pins-läge (filter) — där är den
          valda flygplatsen redan en blå ICAO-box, annars blir det dubbla markörer. */}
      {focus && !showPins && (
        <Marker
          key="__focus__"
          coordinate={{ latitude: focus[4], longitude: focus[5] }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={false}
          onPress={onSelectAirport ? () => onSelectAirport(focus[0]) : undefined}
        >
          <View style={{ alignItems: 'center' }}>
            <View style={[s.labelChip, { borderColor: '#F5C84B' }]}><Text style={s.labelText}>{focus[0]}</Text></View>
            <View style={s.selDot} />
            <View style={s.dotSpacer} />
          </View>
        </Marker>
      )}
    </MapView>

    {/* Kompassros — uppe till höger (under X-knappen i modalen). Alltid synlig på interaktiv karta;
        roterar med kartan och återställer norr uppåt + platt vy vid tryck (som Apple Kartor). */}
    {showCompass && interactive && (
      <TouchableOpacity onPress={resetNorth} activeOpacity={0.85} style={[s.compass, { top: compassTop ?? 60 }]}>
        <Ionicons name="compass" size={26} color="#fff" style={{ transform: [{ rotate: `${-heading}deg` }] }} />
      </TouchableOpacity>
    )}

    {/* Lager-växlare (karta ⇄ satellit) — samma placering/stil som albumkartan */}
    {showLayerToggle && (
      <TouchableOpacity
        onPress={() => setLayer((m) => (m === 'satellite' ? 'standard' : 'satellite'))}
        activeOpacity={0.85}
        style={s.layerBtn}
      >
        <Ionicons name="layers" size={15} color="#fff" />
        <Text style={s.layerTxt}>{layer === 'satellite' ? 'Satellite' : layer === 'hybrid' ? 'Hybrid' : 'Map'}</Text>
      </TouchableOpacity>
    )}
    </View>
  );
}

const s = StyleSheet.create({
  flagPin: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(15,22,38,0.92)', borderRadius: 9,
    borderWidth: 1, borderColor: Colors.primary,
    paddingLeft: 3, paddingRight: 6, paddingVertical: 2,
  },
  flagEmoji: { fontSize: 11 },
  flagCount: { color: '#FFFFFF', fontSize: 8.5, fontWeight: '800' },
  dot: {
    width: 12, height: 12, borderRadius: 6,
    backgroundColor: '#4f7cff', borderWidth: 1.5, borderColor: '#FFFFFF',
    marginVertical: 3,
  },
  selDot: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: '#F5C84B', borderWidth: 2, borderColor: '#FFFFFF',
  },
  dotSpacer: { height: 16 },
  labelChip: {
    height: 16, justifyContent: 'center',
    backgroundColor: 'rgba(15,22,38,0.9)', borderRadius: 5,
    paddingHorizontal: 5, borderWidth: 0.5, borderColor: Colors.border,
  },
  labelText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700', fontFamily: 'Menlo' },
  layerBtn: {
    position: 'absolute', top: 12, right: 12,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(6,11,22,0.82)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 10, paddingHorizontal: 11, paddingVertical: 8,
  },
  layerTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },
  compass: {
    position: 'absolute', right: 12, width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(15,22,38,0.9)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center',
  },
  icaoPin: {
    backgroundColor: 'rgba(15,22,38,0.92)', borderRadius: 10,
    borderWidth: 1, borderColor: Colors.primary,
    paddingHorizontal: 7, paddingVertical: 3,
  },
  icaoPinTxt: { color: '#fff', fontSize: 11, fontWeight: '800', fontFamily: 'Menlo', letterSpacing: 0.5 },
  regionChip: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(8,20,28,0.94)', borderRadius: 8,
    borderWidth: 1, borderColor: '#67E8F9',
    paddingLeft: 5, paddingRight: 3, paddingVertical: 1.5,
  },
  regionChipLabel: { color: '#fff', fontSize: 9.5, fontWeight: '800', maxWidth: 110, textAlign: 'center' },
  regionChipCount: {
    color: '#062024', fontSize: 7.5, fontWeight: '900',
    backgroundColor: '#67E8F9', borderRadius: 6, paddingHorizontal: 4, paddingVertical: 0.5, overflow: 'hidden',
  },
  neighborChip: {
    backgroundColor: 'rgba(8,20,28,0.7)', borderRadius: 8,
    borderWidth: 1, borderColor: 'rgba(103,232,249,0.45)',
    paddingHorizontal: 7, paddingVertical: 2.5,
  },
  neighborChipLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 9, fontWeight: '700', maxWidth: 102 },
});
