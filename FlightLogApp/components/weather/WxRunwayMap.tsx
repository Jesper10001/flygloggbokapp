// Liten rund kartbild på vädersidan: Esris mörka karta (Dark Gray Canvas utan etiketter, via proxyns /map/dark
// som lägger på nyckeln), banorna ur runway-geo.json (samma data som Global map) ritade tjockt utan mått och
// bannummer, och vindpilen ovanpå. Inramningen räknas så att alla banor precis får plats i cirkeln.
// Svarar inte proxyn med kartrutor, eller saknas bangeometri, ritas banorna/kompassen på mörk botten.
// Esris krav: "Powered by Esri" + källorna syns på sidan → onCredit (WeatherPage skriver ut raden).
import { useEffect, useMemo, useState } from 'react';
import { View, Image } from 'react-native';
import Svg, { Circle, G, Line, Path } from 'react-native-svg';
import type { RunwayGeo } from '../../constants/runwayGeo';
import { Colors } from '../../constants/colors';
import { getDeviceId } from '../../services/anthropicClient';

const PROXY_URL = process.env.EXPO_PUBLIC_PROXY_URL ?? '';
const MAX_ZOOM = 16; // = proxyns tak
const tileUri = (z: number, y: number, x: number) => `${PROXY_URL}/map/dark/${z}/${y}/${x}`;
// Fast källtext för stilen Dark Gray Canvas.
export const DARK_MAP_CREDIT = 'Powered by Esri · Source: Esri, TomTom, Garmin, FAO, NOAA, USGS, © OpenStreetMap contributors, and the GIS User Community';

// Har proxyn mörka kartrutor? Provas en gång per appsession; ett "nej" provas om efter 10 min (rutorna dyker då
// upp av sig själva när proxyn fått vägen, utan ny app-uppdatering).
let darkProbe: { ok: boolean; at: number } | null = null;
async function darkAvailable(): Promise<boolean> {
  if (!PROXY_URL) return false;
  if (darkProbe && (darkProbe.ok || Date.now() - darkProbe.at < 10 * 60 * 1000)) return darkProbe.ok;
  try {
    const r = await fetch(tileUri(1, 0, 0), { headers: { 'X-Device-ID': getDeviceId() } });
    darkProbe = { ok: r.ok && (r.headers.get('Content-Type') ?? '').startsWith('image/'), at: Date.now() };
  } catch { darkProbe = { ok: false, at: Date.now() }; }
  return darkProbe.ok;
}

const FAV = '#67E8F9';   // banor vinden gynnar (samma cyan som kart-snippeten)
const RWY = '#E8F0F8';
const TILE = 256;

function worldPx(lat: number, lon: number, z: number) {
  const n = TILE * 2 ** z;
  const s = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}

export function WxRunwayMap({ runways, favored, windDir, size = 150, onCredit }: {
  runways: RunwayGeo[]; favored: number[]; windDir: number | null; size?: number; onCredit?: (credit: string | null) => void;
}) {
  const [imagery, setImagery] = useState(false);
  useEffect(() => { let alive = true; darkAvailable().then((ok) => { if (alive) setImagery(ok); }); return () => { alive = false; }; }, []);

  // Utsnittet: mitt i banornas ram, radie = längsta avståndet till en banände + luft. Rutorna hämtas på den
  // lägsta zoom som ger minst dubbla upplösningen (skarp bild), högst proxyns tak.
  const view = useMemo(() => {
    if (!runways.length) return null;
    let minLa = 90, maxLa = -90, minLo = 180, maxLo = -180;
    for (const r of runways) for (const p of [r.le, r.he]) {
      minLa = Math.min(minLa, p.lat); maxLa = Math.max(maxLa, p.lat); minLo = Math.min(minLo, p.lon); maxLo = Math.max(maxLo, p.lon);
    }
    const c0 = worldPx((minLa + maxLa) / 2, (minLo + maxLo) / 2, 0);
    let rad0 = 0;
    for (const r of runways) for (const p of [r.le, r.he]) { const w = worldPx(p.lat, p.lon, 0); rad0 = Math.max(rad0, Math.hypot(w.x - c0.x, w.y - c0.y)); }
    rad0 = Math.max(rad0, 0.002); // minst ~en liten flygplats
    const span0 = 2 * rad0 * 1.12;
    let z = 1;
    while (z < MAX_ZOOM && span0 * 2 ** z < size * 2) z++;
    const k = 2 ** z, span = span0 * k;
    const x0 = c0.x * k - span / 2, y0 = c0.y * k - span / 2;
    const scale = size / span;
    const tiles: { key: string; uri: string; left: number; top: number }[] = [];
    const n = 2 ** z;
    for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + span - 1) / TILE); ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + span - 1) / TILE); tx++) {
        const wx = ((tx % n) + n) % n;
        tiles.push({ key: `${z}/${ty}/${tx}`, uri: tileUri(z, ty, wx), left: (tx * TILE - x0) * scale, top: (ty * TILE - y0) * scale });
      }
    }
    const lines = runways.map((r) => {
      const a = worldPx(r.le.lat, r.le.lon, z), b = worldPx(r.he.lat, r.he.lon, z);
      return { x1: (a.x - x0) * scale, y1: (a.y - y0) * scale, x2: (b.x - x0) * scale, y2: (b.y - y0) * scale };
    });
    return { tiles, lines, side: Math.ceil(TILE * scale) + 1 };
  }, [runways, size]);

  // Källhänvisningen för området (Esri-krav), bara när bilden visas.
  useEffect(() => {
    if (!onCredit) return;
    onCredit(imagery && view ? DARK_MAP_CREDIT : null);
  }, [imagery, view, onCredit]);

  const headers = useMemo(() => ({ 'X-Device-ID': getDeviceId() }), []);
  const half = size / 2;
  return (
    <View pointerEvents="none" style={{ width: size, height: size, borderRadius: half, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border, backgroundColor: '#15263D' }}>
      {imagery && view ? view.tiles.map((t) => (
        <Image key={t.key} source={{ uri: t.uri, headers }}
          style={{ position: 'absolute', left: Math.floor(t.left), top: Math.floor(t.top), width: view.side, height: view.side }} />
      )) : null}
      {imagery && view ? <View style={{ position: 'absolute', left: 0, top: 0, width: size, height: size, backgroundColor: 'rgba(10,22,40,0.18)' }} /> : null}
      {view ? (
        <Svg width={size} height={size} style={{ position: 'absolute', left: 0, top: 0 }}>
          {view.lines.map((l, i) => (
            <Line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke={favored.includes(i) ? FAV : RWY} strokeWidth={5.5} strokeLinecap="butt" />
          ))}
        </Svg>
      ) : null}
      <Svg width={size} height={size} viewBox="0 0 300 300" style={{ position: 'absolute', left: 0, top: 0 }}>
        <Circle cx={150} cy={150} r={146} fill="none" stroke="#0A1628" strokeOpacity={0.55} strokeWidth={10} />
        {!view ? <Circle cx={150} cy={150} r={88} fill="none" stroke={Colors.separator} strokeWidth={2} /> : null}
        <Path d="M150 6 v14" stroke={Colors.textSecondary} strokeWidth={3} strokeLinecap="round" />
        {windDir != null ? (
          <G rotation={windDir} origin="150, 150">
            <Path d="M150 16 L150 92" stroke="#0A1628" strokeWidth={13} strokeLinecap="round" />
            <Path d="M136 78 L150 100 L164 78" fill="none" stroke="#0A1628" strokeWidth={13} strokeLinecap="round" strokeLinejoin="round" />
            <Path d="M150 16 L150 92" stroke={Colors.primary} strokeWidth={7} strokeLinecap="round" />
            <Path d="M136 78 L150 100 L164 78" fill="none" stroke={Colors.primary} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
          </G>
        ) : null}
      </Svg>
    </View>
  );
}
