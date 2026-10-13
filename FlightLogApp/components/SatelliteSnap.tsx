// Satellit-snapshot till share-kortet: Esri World Imagery-tiles via VÅR proxy, som lägger på ArcGIS-nyckeln
// (den finns aldrig i appen). Ritas som vanliga RN-bilder i en klippt ruta → ViewShot fångar dem direkt
// (ingen WebView, inget Leaflet/CDN). Utsnittet motsvarar en 220-px-vy på vald zoomnivå; tiles hämtas en
// nivå djupare (2× upplösning) så bilden är skarp även när rutan förstoras i exporten.
// Esris krav: "Powered by Esri" + alla bildleverantörer för området ska synas på bilden → imageryCredit().

import { useMemo, useRef } from 'react';
import { View, Image } from 'react-native';
import { getDeviceId } from '../services/anthropicClient';

const PROXY_URL = process.env.EXPO_PUBLIC_PROXY_URL ?? '';
const TILE = 256;
const VIEW = 220;          // utsnittets bredd i px på vald zoomnivå (samma yta som den gamla Leaflet-snapshoten)
const MAX_TILE_ZOOM = 16;  // = proxyns tak

// Esris generella källtext för World Imagery (tjänstens copyrightText) — används när den dynamiska
// leverantörslistan inte går att hämta.
export const ESRI_IMAGERY_SOURCE_FALLBACK = 'Esri, Vantor, Earthstar Geographics, and the GIS User Community';

const tileZoom = (zoom: number) => Math.min(MAX_TILE_ZOOM, Math.round(zoom) + 1);

// Web Mercator: lat/lon → världspixlar på zoom z.
function worldPx(lat: number, lon: number, z: number) {
  const n = TILE * 2 ** z;
  const s = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
  return { x: ((lon + 180) / 360) * n, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n };
}
function pxToLatLon(x: number, y: number, z: number) {
  const n = TILE * 2 ** z;
  return { lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI, lon: (x / n) * 360 - 180 };
}

// Utsnittet i tile-zoomens pixlar (övre vänstra hörnet + sida).
function viewport(lat: number, lon: number, zoom: number) {
  const tz = tileZoom(zoom);
  const span = VIEW * 2 ** (tz - Math.round(zoom));
  const c = worldPx(lat, lon, tz);
  return { tz, span, x0: c.x - span / 2, y0: c.y - span / 2 };
}

// Rutan (s, w, n, e, tile-zoom) som proxyn behöver för att räkna ut källhänvisningen.
function snapBox(lat: number, lon: number, zoom: number): number[] {
  const { tz, span, x0, y0 } = viewport(lat, lon, zoom);
  const nw = pxToLatLon(x0, y0, tz), se = pxToLatLon(x0 + span, y0 + span, tz);
  return [se.lat, nw.lon, nw.lat, se.lon].map((v) => Math.round(v * 1e4) / 1e4).concat(tz);
}

/** Bildleverantörerna för snapshotsen (t.ex. ["Microsoft", "Vantor"]), eller null om listan inte gick att hämta. */
export async function fetchImageryProviders(snaps: { lat: number; lon: number; zoom: number }[]): Promise<string[] | null> {
  if (!PROXY_URL || !snaps.length) return null;
  const qs = snaps.map((s) => `b=${snapBox(s.lat, s.lon, s.zoom).join(',')}`).join('&');
  try {
    const r = await fetch(`${PROXY_URL}/map/imagery/attribution?${qs}`);
    if (!r.ok) return null;
    const j = await r.json();
    const list = Array.isArray(j?.providers)
      ? j.providers.filter((p: unknown): p is string => typeof p === 'string' && p !== 'Esri' && p !== 'GIS User Community')
      : [];
    return list.length ? list : null;
  } catch {
    return null;
  }
}

/** Källhänvisningen som bränns in i kortet: "Powered by Esri" + leverantörerna (eller Esris generella text). */
export function imageryCredit(providers: string[] | null): string {
  const source = providers?.length ? `Esri, ${providers.join(', ')}, and the GIS User Community` : ESRI_IMAGERY_SOURCE_FALLBACK;
  return `Powered by Esri · Source: ${source}`;
}

/** Satellitbild centrerad på lat/lon. Montera om (key) vid ny plats/zoom → onSettled när alla tiles är klara. */
export function SatelliteSnap({ lat, lon, zoom, size, onSettled }: {
  lat: number; lon: number; zoom: number; size: number; onSettled?: () => void;
}) {
  const tiles = useMemo(() => {
    const { tz, span, x0, y0 } = viewport(lat, lon, zoom);
    const n = 2 ** tz;
    const out: { key: string; uri: string; left: number; top: number; span: number }[] = [];
    for (let ty = Math.floor(y0 / TILE); ty <= Math.floor((y0 + span - 1) / TILE); ty++) {
      if (ty < 0 || ty >= n) continue;
      for (let tx = Math.floor(x0 / TILE); tx <= Math.floor((x0 + span - 1) / TILE); tx++) {
        const wx = ((tx % n) + n) % n; // datumlinjen: x slår runt
        out.push({ key: `${tz}/${ty}/${tx}`, uri: `${PROXY_URL}/map/imagery/${tz}/${ty}/${wx}`, left: tx * TILE - x0, top: ty * TILE - y0, span });
      }
    }
    return out;
  }, [lat, lon, zoom]);
  const headers = useMemo(() => ({ 'X-Device-ID': getDeviceId() }), []);
  const done = useRef(new Set<string>());
  const settle = (key: string) => {
    done.current.add(key);
    if (done.current.size === tiles.length) onSettled?.();
  };

  if (!PROXY_URL) return null;
  const k = size / (tiles[0]?.span ?? VIEW);
  const side = Math.ceil(TILE * k) + 1; // 1 pt överlapp → inga hårfina skarvar mellan tiles
  return (
    <View style={{ width: size, height: size, overflow: 'hidden', backgroundColor: '#0a1422' }} pointerEvents="none">
      {tiles.map((t) => (
        <Image
          key={t.key}
          source={{ uri: t.uri, headers }}
          onLoadEnd={() => settle(t.key)}
          style={{ position: 'absolute', left: Math.floor(t.left * k), top: Math.floor(t.top * k), width: side, height: side }}
        />
      ))}
    </View>
  );
}
