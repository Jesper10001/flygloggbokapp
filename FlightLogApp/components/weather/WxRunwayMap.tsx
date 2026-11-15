// Kartbilden på vädersidan: vänstra halvan av Now-kortet. Mörk Apple-karta (mutedStandard) över flygplatsen,
// inramad så att alla banor ur runway-geo.json (samma data som Global map) får plats. Banorna ritas ovanpå som
// små landningsbanor: asfalt, vita kantlinjer, streckad centrumlinje och bannumret målat i varje ände (läses
// åt det håll man landar, som på en riktig flygplats). Banorna vinden gynnar har cyan kanter och nummer.
// Vindpilen kommer in från vindriktningen mot flygplatsens mitt. Kartan går inte att röra.
// Banornas lägen på skärmen hämtas från kartan själv (pointForCoordinate), så de ligger exakt på kartbilden.
import { useCallback, useMemo, useRef, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import MapView from 'react-native-maps';
import Svg, { G, Line, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import type { RunwayGeo } from '../../constants/runwayGeo';
import { Colors } from '../../constants/colors';

const FAV = '#67E8F9';
const ASPHALT = '#3A4352';
const W = 13; // banans bredd i punkter

type Pt = { x: number; y: number };

export function WxRunwayMap({ runways, favored, windDir }: { runways: RunwayGeo[]; favored: number[]; windDir: number | null }) {
  const mapRef = useRef<MapView>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [pts, setPts] = useState<{ a: Pt; b: Pt }[] | null>(null);

  const region = useMemo(() => {
    if (!runways.length) return null;
    let minLa = 90, maxLa = -90, minLo = 180, maxLo = -180;
    for (const r of runways) for (const p of [r.le, r.he]) {
      minLa = Math.min(minLa, p.lat); maxLa = Math.max(maxLa, p.lat); minLo = Math.min(minLo, p.lon); maxLo = Math.max(maxLo, p.lon);
    }
    const lat = (minLa + maxLa) / 2, lon = (minLo + maxLo) / 2;
    const k = Math.cos((lat * Math.PI) / 180);
    // Kvadratisk ram (kartan är kvadratisk): den största sidan + luft för nummer och kanter.
    const sideM = Math.max((maxLa - minLa) * 111320, (maxLo - minLo) * 111320 * k, 800) * 1.3;
    const latDelta = sideM / 111320;
    return { latitude: lat, longitude: lon, latitudeDelta: latDelta, longitudeDelta: latDelta / k };
  }, [runways]);

  const project = useCallback(async () => {
    const m = mapRef.current;
    if (!m || !runways.length) return;
    try {
      const out = await Promise.all(runways.map(async (r) => ({
        a: await m.pointForCoordinate({ latitude: r.le.lat, longitude: r.le.lon }),
        b: await m.pointForCoordinate({ latitude: r.he.lat, longitude: r.he.lon }),
      })));
      setPts(out);
    } catch { /* kartan inte klar än → nästa onRegionChangeComplete */ }
  }, [runways]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (!size || Math.abs(size.w - width) > 0.5 || Math.abs(size.h - height) > 0.5) setSize({ w: width, h: height });
  };

  const cx = (size?.w ?? 0) / 2, cy = (size?.h ?? 0) / 2;
  const R = Math.min(cx, cy);
  return (
    <View pointerEvents="none" onLayout={onLayout} style={{ flex: 1, backgroundColor: '#15263D' }}>
      {region ? (
        <MapView
          ref={mapRef}
          style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
          initialRegion={region}
          mapType="mutedStandard"
          userInterfaceStyle="dark"
          scrollEnabled={false} zoomEnabled={false} rotateEnabled={false} pitchEnabled={false}
          showsPointsOfInterests={false}
          showsBuildings={false}
          showsCompass={false}
          showsScale={false}
          toolbarEnabled={false}
          onMapReady={project}
          onRegionChangeComplete={project}
        />
      ) : null}
      {size ? (
        <Svg width={size.w} height={size.h} style={{ position: 'absolute', left: 0, top: 0 }}>
          {pts?.map((p, i) => {
            const dx = p.b.x - p.a.x, dy = p.b.y - p.a.y;
            const L = Math.hypot(dx, dy);
            if (L < 20) return null;
            const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
            const fav = favored.includes(i);
            const edge = fav ? FAV : 'rgba(255,255,255,0.9)';
            const num = fav ? FAV : '#FFFFFF';
            const rw = runways[i];
            return (
              <G key={i} transform={`translate(${p.a.x} ${p.a.y}) rotate(${ang})`}>
                <Rect x={0} y={-W / 2} width={L} height={W} rx={1} fill={ASPHALT} />
                <Line x1={0} y1={-W / 2 + 0.8} x2={L} y2={-W / 2 + 0.8} stroke={edge} strokeWidth={0.9} />
                <Line x1={0} y1={W / 2 - 0.8} x2={L} y2={W / 2 - 0.8} stroke={edge} strokeWidth={0.9} />
                {L > 44 ? <Line x1={15} y1={0} x2={L - 15} y2={0} stroke="rgba(255,255,255,0.75)" strokeWidth={0.8} strokeDasharray="3.5 3" /> : null}
                {/* Bannumret målat i änden, läses åt landningsriktningen. */}
                <SvgText x={7.5} y={0} fill={num} fontSize={6} fontWeight="800" fontFamily="JetBrainsMono"
                  textAnchor="middle" alignmentBaseline="middle" transform={`rotate(90 7.5 0)`}>{rw.leIdent}</SvgText>
                <SvgText x={L - 7.5} y={0} fill={num} fontSize={6} fontWeight="800" fontFamily="JetBrainsMono"
                  textAnchor="middle" alignmentBaseline="middle" transform={`rotate(-90 ${L - 7.5} 0)`}>{rw.heIdent}</SvgText>
              </G>
            );
          })}
          {/* Vindpilen: fjädrar vid kanten (där vinden kommer ifrån), spetsen mot mitten. */}
          {windDir != null && R > 0 ? (
            <G transform={`rotate(${windDir} ${cx} ${cy})`}>
              <Line x1={cx} y1={cy - R + 8} x2={cx} y2={cy - R * 0.32} stroke="#0A1628" strokeWidth={5} strokeLinecap="round" />
              <Line x1={cx} y1={cy - R + 8} x2={cx} y2={cy - R * 0.32} stroke={Colors.primary} strokeWidth={2.6} strokeLinecap="round" />
              {[0, 7].map((o) => (
                <Path key={o} d={`M${cx - 6} ${cy - R + 4 + o} L${cx} ${cy - R + 10 + o} L${cx + 6} ${cy - R + 4 + o}`}
                  fill="none" stroke={Colors.primary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              ))}
              <Polygon points={`${cx},${cy - R * 0.2} ${cx - 7},${cy - R * 0.2 - 14} ${cx + 7},${cy - R * 0.2 - 14}`}
                fill={Colors.primary} stroke="#0A1628" strokeWidth={1.5} strokeLinejoin="round" />
            </G>
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}
