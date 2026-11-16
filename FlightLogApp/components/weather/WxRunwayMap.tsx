// Kartbilden på vädersidan: vänstra halvan av Now-kortet. Mörk Apple-karta (mutedStandard) över flygplatsen,
// med en mörkblå ton över så att den smälter in i sidan, inramad så att alla banor ur runway-geo.json (samma
// data som Global map) får plats. Banorna ritas ovanpå som små landningsbanor: asfalt, vit kantlinje, streckad
// mittlinje, tröskelstreck och bannumret målat i varje ände (läses åt det håll man landar).
// Banor som korsar varandra ritas som EN yta: först allas kontur, sedan allas asfalt, sist markeringarna. Då
// följer kantlinjen ytterkonturen i stället för att skära över den andra banan. Mittlinjen går obruten på den
// längsta banan och bryts på den korsande, som på en riktig flygplats.
// Banänden vinden gynnar (motvind) är cyan: tröskel, nummer och en liten pil in mot banan.
// Vindpilen sitter vid kartans kant på den sida vinden kommer ifrån. Kartan går inte att röra.
// Banornas lägen på skärmen hämtas från kartan själv (pointForCoordinate), så de ligger exakt på kartbilden.
import { useCallback, useMemo, useRef, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import MapView from 'react-native-maps';
import Svg, { G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import type { RunwayGeo } from '../../constants/runwayGeo';
import { Colors } from '../../constants/colors';

const FAV = '#67E8F9';
const EDGE = '#EEF3F8';
const ASPHALT = '#364154';
const MARK = 'rgba(255,255,255,0.85)';
const W = 13; // banans bredd i punkter

type Pt = { x: number; y: number };
export type RunwayEnd = 'le' | 'he' | null;

// Var på bana i (0…längd, från a) den korsas av bana j:s mittlinje, och vinkeln mellan dem. null om de inte möts.
function crossing(a: { a: Pt; b: Pt }, b: { a: Pt; b: Pt }): { at: number; sin: number } | null {
  const rx = a.b.x - a.a.x, ry = a.b.y - a.a.y, sx = b.b.x - b.a.x, sy = b.b.y - b.a.y;
  const den = rx * sy - ry * sx;
  const la = Math.hypot(rx, ry), lb = Math.hypot(sx, sy);
  if (Math.abs(den) < 1e-6 || la < 1 || lb < 1) return null;
  const t = ((b.a.x - a.a.x) * sy - (b.a.y - a.a.y) * sx) / den;
  const u = ((b.a.x - a.a.x) * ry - (b.a.y - a.a.y) * rx) / den;
  const pad = W / 2 / lb;   // räkna även en bana som bara nuddar den andra
  if (t < 0 || t > 1 || u < -pad || u > 1 + pad) return null;
  return { at: t * la, sin: Math.abs(den) / (la * lb) };
}

export function WxRunwayMap({ runways, ends, windDir }: { runways: RunwayGeo[]; ends: RunwayEnd[]; windDir: number | null }) {
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
    // Kvadratisk ram (kartan är kvadratisk): den största sidan + luft för nummer, pilar och vindpilen i kanten.
    const sideM = Math.max((maxLa - minLa) * 111320, (maxLo - minLo) * 111320 * k, 800) * 1.4;
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

  // Varje bana i skärmkoordinater: läge, längd, vinkel och var mittlinjen ska brytas (korsning med en längre bana).
  const drawn = useMemo(() => (pts ?? []).map((p, i) => {
    const dx = p.b.x - p.a.x, dy = p.b.y - p.a.y;
    const L = Math.hypot(dx, dy);
    const gaps: [number, number][] = [];
    (pts ?? []).forEach((q, j) => {
      if (j === i) return;
      const lq = Math.hypot(q.b.x - q.a.x, q.b.y - q.a.y);
      if (lq < L || (lq === L && j > i)) return;   // den längsta banans mittlinje går obruten
      const c = crossing(p, q);
      if (!c) return;
      const half = (W / 2 + 2) / Math.max(0.35, c.sin);
      gaps.push([c.at - half, c.at + half]);
    });
    gaps.sort((a, b) => a[0] - b[0]);
    // Mittlinjens delar mellan trösklarna, utan korsningarna.
    const parts: [number, number][] = [];
    let from = 18;
    for (const [g1, g2] of gaps) { if (g1 - from > 3) parts.push([from, g1]); from = Math.max(from, g2); }
    if (L - 18 - from > 3) parts.push([from, L - 18]);
    return { i, L, tf: `translate(${p.a.x} ${p.a.y}) rotate(${(Math.atan2(dy, dx) * 180) / Math.PI})`, parts };
  }).filter((r) => r.L >= 20), [pts]);

  const cx = (size?.w ?? 0) / 2, cy = (size?.h ?? 0) / 2;
  const R = Math.min(cx, cy);
  const top = cy - R;
  const keys = (x: number) => `M${x} -3.9h4M${x} -1.3h4M${x} 1.3h4M${x} 3.9h4`;
  return (
    <View pointerEvents="none" onLayout={onLayout} style={{ flex: 1, backgroundColor: '#12233B' }}>
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
      {/* Mörkblå ton över kartan: dämpar kartans gröna och blå så att den hör ihop med sidan. */}
      <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, backgroundColor: 'rgba(10,22,40,0.38)' }} />
      {size ? (
        <Svg width={size.w} height={size.h} style={{ position: 'absolute', left: 0, top: 0 }}>
          {/* 1. Allas kontur, 2. allas asfalt: asfalten täcker den andra banans kantlinje i korsningen. */}
          {drawn.map((r) => (
            <G key={`c${r.i}`} transform={r.tf}><Rect x={0} y={-W / 2} width={r.L} height={W} rx={1.2} fill={EDGE} /></G>
          ))}
          {drawn.map((r) => (
            <G key={`a${r.i}`} transform={r.tf}><Rect x={1} y={-W / 2 + 1} width={r.L - 2} height={W - 2} rx={0.6} fill={ASPHALT} /></G>
          ))}
          {/* 3. Markeringarna: mittlinje, tröskelstreck, nummer och pilen vid änden vinden gynnar. */}
          {drawn.map((r) => {
            const rw = runways[r.i];
            const end = ends[r.i] ?? null;
            const le = end === 'le' ? FAV : MARK, he = end === 'he' ? FAV : MARK;
            return (
              <G key={`m${r.i}`} transform={r.tf}>
                {r.L > 44 ? r.parts.map(([x1, x2], n) => (
                  <Line key={n} x1={x1} y1={0} x2={x2} y2={0} stroke="rgba(255,255,255,0.8)" strokeWidth={0.8} strokeDasharray="3.5 3" />
                )) : null}
                {r.L > 34 ? <Path d={keys(2.6)} stroke={le} strokeWidth={1} /> : null}
                {r.L > 34 ? <Path d={keys(r.L - 6.6)} stroke={he} strokeWidth={1} /> : null}
                {/* Bannumret målat innanför tröskeln, läses åt landningsriktningen. */}
                <SvgText x={11.6} y={0} fill={le} fontSize={6.4} fontWeight="800" fontFamily="JetBrainsMono"
                  textAnchor="middle" alignmentBaseline="middle" transform={`rotate(90 11.6 0)`}>{rw.leIdent}</SvgText>
                <SvgText x={r.L - 11.6} y={0} fill={he} fontSize={6.4} fontWeight="800" fontFamily="JetBrainsMono"
                  textAnchor="middle" alignmentBaseline="middle" transform={`rotate(-90 ${r.L - 11.6} 0)`}>{rw.heIdent}</SvgText>
                {end === 'le' ? <Path d="M-8 -3.2L-4 0L-8 3.2" stroke={FAV} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
                {end === 'he' ? <Path d={`M${r.L + 8} -3.2L${r.L + 4} 0L${r.L + 8} 3.2`} stroke={FAV} strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
              </G>
            );
          })}
          {/* Vindpilen: kort, vid kanten där vinden kommer ifrån, spetsen in mot flygplatsen. */}
          {windDir != null && R > 0 ? (
            <G transform={`rotate(${windDir} ${cx} ${cy})`}>
              <Line x1={cx} y1={top + 9} x2={cx} y2={top + 24} stroke="#0A1628" strokeWidth={5.4} strokeLinecap="round" />
              <Line x1={cx} y1={top + 9} x2={cx} y2={top + 24} stroke={Colors.primary} strokeWidth={2.4} strokeLinecap="round" />
              <Path d={`M${cx - 5.5} ${top + 5}L${cx} ${top + 10.5}L${cx + 5.5} ${top + 5}M${cx - 5.5} ${top + 11}L${cx} ${top + 16.5}L${cx + 5.5} ${top + 11}`}
                fill="none" stroke={Colors.primary} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
              <Path d={`M${cx} ${top + 34}L${cx - 6.5} ${top + 22}H${cx + 6.5}Z`}
                fill={Colors.primary} stroke="#0A1628" strokeWidth={1.4} strokeLinejoin="round" />
            </G>
          ) : null}
          {/* Norr uppåt (kartan vrids aldrig). */}
          <Path d={`M${size.w - 13} 5l2.4 3.8h-4.8z`} fill={Colors.textSecondary} />
          <SvgText x={size.w - 13} y={16.5} fill={Colors.textSecondary} fontSize={6.5} fontWeight="700" fontFamily="JetBrainsMono" textAnchor="middle">N</SvgText>
        </Svg>
      ) : null}
    </View>
  );
}
