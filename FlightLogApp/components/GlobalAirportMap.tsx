// Global flygplatskarta med level-of-detail-klustring (Apple Maps via
// react-native-maps). Zoomnivån (region.latitudeDelta) avgör vad som visas:
//   utzoomad   → en FLAGG-pin per LAND med antal
//   inzoomad   → enskilda blå PLUPPAR (viewport-filtrerat)
//   mer inzoom → pluppar + ICAO-etikett
//
// 34k flygplatser kan inte renderas samtidigt — därför aggregat + viewport-cap.

import { useMemo, useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, InteractionManager } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import MapView, { Marker, Polygon, type Region, type MapType } from 'react-native-maps';
import { getRunwayGeo, runwayCorners, runwaySideLabelPoint, runwayLabelRotation, runwayBearing } from '../constants/runwayGeo';
import { clusterIndexFor, regionToZoom, regionToBbox } from '../services/airportClusters';

// En post från supercluster: antingen ett kluster (properties.cluster) eller en flygplats (properties.row).
type ClusterFeature = { id?: number | string; geometry: { coordinates: [number, number] }; properties: any };
import { Colors } from '../constants/colors';
import { flagEmoji } from '../constants/continents';
import { getRunways } from '../utils/runways';

// icao,name,country,region,lat,lon + berikning (airportmap.de): iata,alt,type,municipality,restriction.
// Berikningsfälten är optional så äldre 6-elements-konstruktioner (ex AirportMapWidget) fortsätter gälla.
export type SeedRow = [string, string, string, string, number, number, string?, (number | null)?, string?, string?, string?, string?];

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

export function GlobalAirportMap({ airports, initialRegion, interactive = true, mode = 'auto', onSelectAirport, onSelectCountry, selectedIcao, mapType = 'standard', focus, hideCountries, showLayerToggle, pins, hulls, regionShapes, regionMarkers, onSelectRegion, frameRegion, showCompass, compassTop, neighborShapes, neighborMarkers, onSelectNeighbor, clustering, clusterKey, onRegionChange }: { airports: SeedRow[]; initialRegion?: Region; interactive?: boolean; mode?: 'auto' | 'pins' | 'country'; onSelectAirport?: (icao: string) => void; onSelectCountry?: (cc: string) => void; selectedIcao?: string; mapType?: MapType; focus?: SeedRow | null; hideCountries?: boolean; showLayerToggle?: boolean; pins?: SeedRow[]; hulls?: { latitude: number; longitude: number }[][]; regionShapes?: { key: string; rings: { latitude: number; longitude: number }[][] }[]; regionMarkers?: RegionMarker[]; onSelectRegion?: (key: string) => void; frameRegion?: Region; showCompass?: boolean; compassTop?: number; neighborShapes?: { key: string; rings: { latitude: number; longitude: number }[][] }[]; neighborMarkers?: RegionMarker[]; onSelectNeighbor?: (key: string) => void; clustering?: boolean; clusterKey?: string; onRegionChange?: (r: Region) => void }) {
  const mapRef = useRef<MapView>(null);
  const [region, setRegion] = useState<Region>(initialRegion ?? INITIAL);
  const [layer, setLayer] = useState<MapType>(mapType);
  useEffect(() => { setLayer(mapType); }, [mapType]); // följ extern mapType-prop (t.ex. visited-kartans satellitknapp)
  const [heading, setHeading] = useState(0); // kartans rotation (0 = norr uppåt) → styr kompassrosen
  const [pitch, setPitch] = useState(0);     // kartans lutning (0 = platt)
  // Pin-markörerna måste fångas (renderas) medan kartan initieras — i satellit/flyover hinner de
  // annars inte renderas och syns först efter att man panorerat. Spåra i ~2,5 s, frys sedan (prestanda).
  const [tracks, setTracks] = useState(true);
  useEffect(() => { const id = setTimeout(() => setTracks(false), 2500); return () => clearTimeout(id); }, [mapType]);
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
  // Land-flaggor vid utzoomad vy; klustring/pluppar tar över när man zoomat in tillräckligt.
  // I klustringsläge skiftar vi tidigare (större delta) → man slipper zooma in så långt för att få kluster.
  const countryMax = clustering ? 16 : 3.5;
  const level: 'country' | 'dots' | 'labels' =
    mode === 'country' ? 'country'
      : mode === 'pins' ? 'labels'
      : delta > countryMax ? 'country' : delta > 0.8 ? 'dots' : 'labels';

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

  // ── Geografisk klustring (nytt läge; "pausar" land/region-drillen) ────────────
  // Land-översikten (delta > 3.5) är oförändrad; när man zoomat in tar klustringen över och delas
  // successivt i mindre kluster → till slut enskilda flygplatser. Bara zoom behövs för att navigera.
  const clusterIdx = useRef<any>(null);
  const [clusterReady, setClusterReady] = useState(false);
  const [clusters, setClusters] = useState<ClusterFeature[]>([]);
  const clusterZoom = !!clustering && level !== 'country'; // klustring aktiv (inte i land-översikten)
  // Bygg klusterindexet LAT — först när man faktiskt zoomat in till klusternivå. Vid öppning står man på
  // världsvyn (land-flaggor), så bygget behövs inte då → kartan öppnas direkt utan att frysa JS-tråden.
  // Körs efter interaktionerna (runAfterInteractions) och bara EN gång per montering (ref-guard). Byggs
  // från `airports` (redan filtrerat i modalen) → klustren RESPEKTERAR filtret; clusterKey = filter-
  // signatur → clusterIndexFor cachar så att samma filter inte byggs om i onödan.
  useEffect(() => {
    if (!clustering || !clusterZoom || clusterIdx.current) return;
    let alive = true;
    const task = InteractionManager.runAfterInteractions(() => {
      if (!alive) return;
      try { clusterIdx.current = clusterIndexFor(airports, clusterKey ?? ''); setClusterReady(true); } catch {}
    });
    return () => { alive = false; task.cancel(); };
  }, [clustering, clusterZoom]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!clusterZoom || !clusterIdx.current) { setClusters([]); return; } // lämna klusternivån → töm direkt
    // DEBOUNCE: vid SNABB zoom/panorering avfyras region-ändringar tätt. Utan detta beräknas klustren om
    // för varje delsteg → pluppar mount/unmount:as i snabb följd (markör-churn) → Apple Maps kraschar,
    // särskilt vid snabb utzoomning. Vänta tills vyn lugnat sig (140 ms) och beräkna EN gång.
    const id = setTimeout(() => {
      try { setClusters(clusterIdx.current.getClusters(regionToBbox(region), regionToZoom(region)) as ClusterFeature[]); }
      catch { setClusters([]); }
    }, 140);
    return () => clearTimeout(id);
  }, [clusterZoom, region, clusterReady]);
  // iOS rasteriserar egna markörvyer bara medan tracksViewChanges=true → tick när klustren ändras.
  useEffect(() => {
    if (!clusterZoom || !clusters.length) return;
    setTracks(true);
    const id = setTimeout(() => setTracks(false), 800);
    return () => clearTimeout(id);
  }, [clusters, clusterZoom]);

  // Tryck på ett kluster → zooma in så det expanderar (delas i mindre kluster/flygplatser).
  const zoomToCluster = (c: ClusterFeature) => {
    const idx = clusterIdx.current;
    if (!idx) return;
    const [lon, lat] = c.geometry.coordinates;
    let z = regionToZoom(region) + 2;
    try { z = Math.min(16, idx.getClusterExpansionZoom(Number(c.id))); } catch {}
    const d = Math.max(0.008, 360 / Math.pow(2, z));
    mapRef.current?.animateToRegion({ latitude: lat, longitude: lon, latitudeDelta: d, longitudeDelta: d }, 400);
  };
  const fmtCount = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));

  // Landningsbanor ritas ENDAST för den flygplats man tryckt på (focus → inforuta + inzoomning).
  // Gejtat på focus, INTE på zoom/region → inget räknas om eller re-renderas under zoom/panorering,
  // vilket tidigare fick Apple Maps att krascha. PoC: bara ICAO som finns i RUNWAY_GEO (ESSA).
  const runwayShapes = useMemo(() => {
    const icao = focus?.[0];
    if (!icao) return [];
    return getRunwayGeo(icao).map((rw) => ({ key: `${icao}-${rw.leIdent}`, rw, corners: runwayCorners(rw) }));
  }, [focus]);
  const showRunwayLabels = runwayShapes.length > 0;

  // En spårnings-tick när en flygplats fokuseras så iOS rasteriserar de roterade etikett-vyerna.
  useEffect(() => {
    if (!focus) return;
    setTracks(true);
    const id = setTimeout(() => setTracks(false), 2000);
    return () => clearTimeout(id);
  }, [focus]);

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
      onRegionChangeComplete={(r) => { setRegion(r); syncCamera(); onRegionChange?.(r); }}
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

      {/* Landningsbanor på faktisk plats (mörk asfalt + vit kant) — syns när man zoomat in på flygplatsen. */}
      {runwayShapes.map((r) => (
        <Polygon key={`rwy-${r.key}`} coordinates={r.corners}
          fillColor="rgba(24,24,27,0.82)" strokeColor="rgba(255,255,255,0.9)" strokeWidth={1.2} zIndex={5} />
      ))}

      {/* Bannummer vid trösklarna + längd i mitten, roterade så de löper längs banan (AeroWeather-stil). */}
      {showRunwayLabels && runwayShapes.flatMap((r) => {
        const bearing = runwayBearing(r.rw);            // le→he (grader från norr)
        const dimRot = runwayLabelRotation(r.rw);        // måttet: löper LÄNGS banan, alltid läsbart
        const dimPt = runwaySideLabelPoint(r.rw, r.rw.widthM / 2 + 80); // mått bredvid banan, inte ovanpå
        // flat=true → markören ligger på kartytan och roterar MED kartan. Själva vinkeln sätts via en
        // child-transform (rotation-PROPEN ignoreras för egna vyer på Apple Maps) → bakas in i snapshoten,
        // och flat roterar sedan hela snapshoten med kartan → etiketterna sitter fast i linje med banan.
        // Bannumren orienteras "uppför banan" per ände (le = bäring, he = bäring+180) precis som på asfalten;
        // måttet löper längs banan (normaliserat så det aldrig blir upp-och-ner).
        return [
          <Marker key={`rwl-le-${r.key}`} coordinate={{ latitude: r.rw.le.lat, longitude: r.rw.le.lon }} anchor={{ x: 0.5, y: 0.5 }} flat tracksViewChanges={tracks}>
            <View style={{ transform: [{ rotate: `${bearing}deg` }] }}><Text style={s.rwyIdent}>{r.rw.leIdent}</Text></View>
          </Marker>,
          <Marker key={`rwl-he-${r.key}`} coordinate={{ latitude: r.rw.he.lat, longitude: r.rw.he.lon }} anchor={{ x: 0.5, y: 0.5 }} flat tracksViewChanges={tracks}>
            <View style={{ transform: [{ rotate: `${(bearing + 180) % 360}deg` }] }}><Text style={s.rwyIdent}>{r.rw.heIdent}</Text></View>
          </Marker>,
          <Marker key={`rwl-dim-${r.key}`} coordinate={dimPt} anchor={{ x: 0.5, y: 0.5 }} flat tracksViewChanges={tracks}>
            <View style={{ transform: [{ rotate: `${dimRot}deg` }] }}><Text style={s.rwyDim}>{r.rw.lengthM} m × {r.rw.widthM} m</Text></View>
          </Marker>,
        ];
      })}

      {level === 'country' && !hideCountries && !showPins && byCountry.map((c) => (
        <Marker
          key={`ctry-${c.cc}`}
          coordinate={{ latitude: c.lat, longitude: c.lon }}
          onPress={() => onSelectCountry ? onSelectCountry(c.cc) : zoomTo(c.lat, c.lon, 3.5)}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={tracks}
        >
          <View style={s.flagPin}>
            <Text style={s.flagEmoji}>{flagEmoji(c.cc)}</Text>
            <Text style={s.flagCount}>{c.count}</Text>
          </View>
        </Marker>
      ))}

      {/* ── Geografiska kluster (klustringsläge) ── kluster-plupp med antal (tap = zooma in så det delas)
          + enskilda flygplatser när klustret är litet nog. Bara zoom behövs för att navigera. */}
      {clusterZoom && clusters.slice(0, 150).map((c) => {
        const [lon, lat] = c.geometry.coordinates;
        if (c.properties?.cluster) {
          return (
            <Marker key={`cl-${c.id}`} coordinate={{ latitude: lat, longitude: lon }} anchor={{ x: 0.5, y: 0.5 }} onPress={() => zoomToCluster(c)} tracksViewChanges={tracks}>
              <View style={s.clusterPin}><Text style={s.clusterCount}>{fmtCount(c.properties.point_count)}</Text></View>
            </Marker>
          );
        }
        const icao = c.properties?.icao as string;
        if (showRunwayLabels && icao === focus?.[0]) return null; // dölj ICAO-boxen under utritade banor
        return (
          <Marker key={`ca-${icao}`} coordinate={{ latitude: lat, longitude: lon }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={tracks}
            onPress={onSelectAirport ? () => onSelectAirport(icao) : undefined}>
            <View style={{ alignItems: 'center' }}>
              <View style={s.labelChip}><Text style={s.labelText}>{icao}</Text></View>
              <View style={s.dot} />
              <View style={s.dotSpacer} />
            </View>
          </Marker>
        );
      })}

      {/* Pluppar = lätta native-nålar (tål hundratals utan att krascha). Tap → ICAO+namn. */}
      {!clustering && !showPins && level === 'dots' && dots.map((a) => (
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
      {!clustering && !showPins && level === 'labels' && dots.map((a) => (
        // Hoppa över ICAO-boxen för den flygplats vars banor ritas ut (chippen skymmer annars banan).
        (showRunwayLabels && a[0] === focus?.[0]) ? null : (
        <Marker
          key={a[0]}
          coordinate={{ latitude: a[4], longitude: a[5] }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={tracks}
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
        )
      ))}

      {/* Guld-markering för vald flygplats: SEPARAT markör ovanpå pluppen. Konstant key +
          statiskt innehåll → byter bara koordinat mellan val, ingen re-snapshot (inget hopp
          till hörnet, ingen krasch). Basmarkörerna rörs aldrig. */}
      {!clustering && level === 'labels' && selRow && !(showRunwayLabels && selRow[0] === focus?.[0]) && (
        <Marker
          key="__selhl__"
          coordinate={{ latitude: selRow[4], longitude: selRow[5] }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={tracks}
          onPress={onSelectAirport ? () => onSelectAirport(selRow[0]) : undefined}
        >
          <View style={s.selDot} />
        </Marker>
      )}

      {/* Filtrerat land: filtrerade flygplatser som ICAO-boxar (samma stil som landsflaggan). Tak
          för att inte krascha Apple Maps med för många egna markörvyer. */}
      {!clustering && showPins && pins!.slice(0, 170).map((a) => (
        // Dölj ICAO-boxen för den flygplats vars banor ritas ut (chippen skymmer annars banan).
        (showRunwayLabels && a[0] === focus?.[0]) ? null : (
        <Marker
          key={a[0]}
          coordinate={{ latitude: a[4], longitude: a[5] }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={tracks}
          onPress={onSelectAirport ? () => onSelectAirport(a[0]) : undefined}
        >
          <View style={s.icaoPin}><Text style={s.icaoPinTxt}>{a[0]}</Text></View>
        </Marker>
        )
      ))}

      {/* Region-drill: text-chip (etikett + antal) per delnod → tryck borrar ner. */}
      {regionMarkers && regionMarkers.slice(0, 60).map((m) => (
        <Marker
          key={`${m.key}:${m.count}`}
          coordinate={{ latitude: m.lat, longitude: m.lon }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={tracks}
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
          tracksViewChanges={tracks}
          onPress={onSelectNeighbor ? () => onSelectNeighbor(m.key) : undefined}
        >
          <View style={s.neighborChip}>
            <Text style={s.neighborChipLabel} numberOfLines={1}>{m.label}</Text>
          </View>
        </Marker>
      ))}

      {/* Sökt/vald flygplats: guld-markör + ICAO-etikett. Döljs i pins-läge (filter), och när banor
          ritas ut för flygplatsen (annars skymmer chippen/cirkeln en bana — banorna räcker som markör). */}
      {focus && !showPins && !showRunwayLabels && (
        <Marker
          key="__focus__"
          coordinate={{ latitude: focus[4], longitude: focus[5] }}
          anchor={{ x: 0.5, y: 0.5 }}
          tracksViewChanges={tracks}
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
  // Bana-etiketter: vit text med mörk skugga → läsbar mot den mörka asfaltsremsan/satelliten.
  rwyIdent: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 0.5, textShadowColor: 'rgba(0,0,0,0.95)', textShadowRadius: 3, textShadowOffset: { width: 0, height: 0 } },
  rwyDim: { color: '#fff', fontSize: 9, fontWeight: '700', letterSpacing: 0.3, textShadowColor: 'rgba(0,0,0,0.95)', textShadowRadius: 3, textShadowOffset: { width: 0, height: 0 } },
  flagPin: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: 'rgba(15,22,38,0.92)', borderRadius: 9,
    borderWidth: 1, borderColor: Colors.primary,
    paddingLeft: 3, paddingRight: 6, paddingVertical: 2,
  },
  flagEmoji: { fontSize: 11 },
  flagCount: { color: '#FFFFFF', fontSize: 8.5, fontWeight: '800' },
  // Kluster-plupp: cyan cirkel med antal (tap → zooma in så klustret delas).
  clusterPin: {
    minWidth: 38, height: 38, borderRadius: 19, paddingHorizontal: 6,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary + 'E6', borderWidth: 2, borderColor: '#FFFFFF',
  },
  clusterCount: { color: Colors.textInverse, fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] },
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
