// Drönar-glob — KOPIA av DashboardGlobe (manned) men matad med drönar-GPS och med
// bara två lägen: 'rings' (ripples vid flugna platser) ↔ 'heatmap'. Inga arcs (paths),
// eftersom drönarflygningar inte har dep→arr-rutter. Identisk look i övrigt (nattjord,
// röda ripples, blått sken). Enkel-tap → öppna drönar-kartan; dubbel-tap → cykla effekt.
import { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, Dimensions, ActivityIndicator, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { useFocusEffect } from '@react-navigation/native';
import { getDroneFlights } from '../db/drones';
import { DR } from '../constants/droneTheme';

type Ring = { lat: number; lng: number; maxR: number; propagationSpeed: number; repeatPeriod: number };
type Heat = { lat: number; lng: number; weight: number };
type ViewCfg = { altitude: number; minDistance: number; maxDistance: number };

function buildHtml(rings: Ring[], heat: Heat[], view: ViewCfg): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>html,body{margin:0;padding:0;width:100%;height:100%;background:transparent;overflow:hidden;}#g{width:100vw;height:100vh;}</style>
<script src="https://unpkg.com/globe.gl@2.34.4/dist/globe.gl.min.js"></script>
</head>
<body>
<div id="g"></div>
<script>
  (function(){
    var RINGS = ${JSON.stringify(rings)};
    var HEAT = ${JSON.stringify(heat)};
    var world = Globe()(document.getElementById('g'))
      .backgroundColor('rgba(0,0,0,0)')
      .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-night.jpg')
      .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
      .showAtmosphere(true).atmosphereColor('lightskyblue').atmosphereAltitude(0.15)
      .ringLat('lat').ringLng('lng').ringMaxRadius('maxR')
      .ringPropagationSpeed('propagationSpeed').ringRepeatPeriod('repeatPeriod')
      .ringColor(function(){ return function(t){ return 'rgba(255,100,50,' + Math.sqrt(1 - t) + ')'; }; })
      .heatmapPoints(function(d){ return d; })
      .heatmapPointLat('lat').heatmapPointLng('lng').heatmapPointWeight('weight')
      .heatmapBandwidth(2.8).heatmapColorSaturation(2.2).heatmapBaseAltitude(0.01)
      .heatmapTopAltitude(0.15).heatmapsTransitionDuration(500);

    // Bara två lägen: rings ↔ heatmap (inga arcs). Auto-cyklas var 15:e sekund.
    var mode = 'rings';
    function applyMode(){
      world.ringsData(mode === 'rings' ? RINGS : []);
      world.heatmapsData(mode === 'heatmap' ? [HEAT] : []);
    }
    applyMode();
    setInterval(function(){ mode = (mode === 'rings') ? 'heatmap' : 'rings'; applyMode(); }, 15000);
    window.__updateGlobe = function(r, h){ try { RINGS = JSON.parse(r); HEAT = JSON.parse(h); applyMode(); } catch(e){} };

    function size(){ world.width(document.body.clientWidth); world.height(document.body.clientHeight); }
    size(); window.addEventListener('resize', size);

    var c = world.controls();
    c.enableZoom = true; c.zoomSpeed = 1.4;
    c.minDistance = ${view.minDistance}; c.maxDistance = ${view.maxDistance};
    c.autoRotate = true; c.autoRotateSpeed = 0.55; c.enablePan = false;
    world.pointOfView({ lat: 20, lng: 10, altitude: ${view.altitude} });

    try {
      var rndr = world.renderer();
      rndr.setPixelRatio(Math.min(window.devicePixelRatio || 1, 3));
      var maxAniso = (rndr.capabilities && rndr.capabilities.getMaxAnisotropy) ? rndr.capabilities.getMaxAnisotropy() : 8;
      var aniTries = 0;
      var aniTimer = setInterval(function(){
        var m = world.globeMaterial();
        if (m && m.map){ m.map.anisotropy = maxAniso; m.map.needsUpdate = true; clearInterval(aniTimer); }
        else if (aniTries++ > 40){ clearInterval(aniTimer); }
      }, 150);
    } catch(e){}

    function post(m){ try { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(m); } catch(e){} }
    var sX = 0, sY = 0, sT = 0, lastTap = 0, tapTimer = null;
    document.addEventListener('touchstart', function(e){ post('grab'); var t = e.touches[0]; if (t){ sX = t.clientX; sY = t.clientY; sT = Date.now(); } }, { passive: true });
    document.addEventListener('touchend', function(e){
      post('release');
      var ct = e.changedTouches[0]; if (!ct) return;
      var now = Date.now();
      var moved = Math.abs(ct.clientX - sX) > 12 || Math.abs(ct.clientY - sY) > 12;
      var isTap = !moved && (now - sT) < 300;
      if (isTap){
        if (now - lastTap < 320){ if (tapTimer){ clearTimeout(tapTimer); tapTimer = null; } mode = (mode === 'rings') ? 'heatmap' : 'rings'; applyMode(); lastTap = 0; }
        else { lastTap = now; if (tapTimer) clearTimeout(tapTimer); tapTimer = setTimeout(function(){ tapTimer = null; post('tap'); }, 340); }
      } else { lastTap = 0; if (tapTimer){ clearTimeout(tapTimer); tapTimer = null; } }
    }, { passive: true });
    document.addEventListener('touchcancel', function(){ post('release'); lastTap = 0; if (tapTimer){ clearTimeout(tapTimer); tapTimer = null; } }, { passive: true });
  })();
  true;
</script>
</body>
</html>`;
}

// Läser drone_flights → rings (unika flugna platser) + heat (en punkt per flygning).
async function loadDroneGlobeData(): Promise<{ rings: Ring[]; heat: Heat[] }> {
  const flights = await getDroneFlights(100000);
  const pts = flights
    .filter((f) => f.lat && f.lon)
    .map((f) => ({ lat: f.lat, lng: f.lon }));
  const seen = new Set<string>();
  const rings: Ring[] = [];
  for (const p of pts) {
    const key = `${p.lat.toFixed(3)},${p.lng.toFixed(3)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rings.push({ lat: p.lat, lng: p.lng, maxR: 3, propagationSpeed: 2, repeatPeriod: 1100 + (rings.length % 7) * 90 });
  }
  const heat: Heat[] = pts.map((p) => ({ lat: p.lat, lng: p.lng, weight: 1 }));
  return { rings, heat };
}

export function DroneDashboardGlobe({ onGrab, onTap }: { onGrab?: (grabbing: boolean) => void; onTap?: () => void } = {}) {
  const W = Dimensions.get('window').width;
  const canvas = Math.round(W * 1.5);
  const visibleH = Math.round(W * 1.06);
  const centerY = Math.round(visibleH * 0.5);
  const left = Math.round((W - canvas) / 2);
  const top = centerY - Math.round(canvas / 2);
  const VIEW: ViewCfg = { altitude: 2.61, minDistance: 200, maxDistance: 520 };
  const flights = useDroneCount();
  const webRef = useRef<any>(null);
  const ready = useRef(false);
  const [initial, setInitial] = useState<{ rings: Ring[]; heat: Heat[] } | null>(null);

  useEffect(() => {
    loadDroneGlobeData().then(setInitial).catch(() => setInitial({ rings: [], heat: [] }));
  }, []);

  const pushUpdate = useCallback(async () => {
    if (!ready.current || !webRef.current) return;
    try {
      const { rings, heat } = await loadDroneGlobeData();
      const js = `window.__updateGlobe && window.__updateGlobe(${JSON.stringify(JSON.stringify(rings))}, ${JSON.stringify(JSON.stringify(heat))}); true;`;
      webRef.current.injectJavaScript(js);
    } catch {}
  }, []);
  useEffect(() => { pushUpdate(); }, [flights, pushUpdate]);
  useFocusEffect(useCallback(() => { pushUpdate(); }, [pushUpdate]));

  return (
    <View style={{ width: W, height: visibleH, alignSelf: 'center' }}>
      {initial ? (
        <View style={{ position: 'absolute', left, top, width: canvas, height: canvas }}>
          <WebView
            ref={webRef}
            originWhitelist={['*']}
            source={{ html: buildHtml(initial.rings, initial.heat, VIEW) }}
            style={styles.web}
            containerStyle={styles.web}
            opaque={false}
            scrollEnabled={false}
            bounces={false}
            androidLayerType="hardware"
            onLoadEnd={() => { ready.current = true; }}
            onMessage={(e) => {
              const d = e.nativeEvent.data;
              if (d === 'grab') onGrab?.(true);
              else if (d === 'release') onGrab?.(false);
              else if (d === 'tap') onTap?.();
            }}
          />
        </View>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={DR.text3} />
        </View>
      )}
      {initial && (
        <View pointerEvents="box-none" style={styles.hintRow}>
          <View pointerEvents="none" style={styles.labelCol}>
            <View style={styles.hintBox}>
              <Text style={styles.hintText}>Tap globe once for maps</Text>
              <Text style={styles.hintText}>Double-tap for effect</Text>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

// Reaktivitetsnyckel: antal drönarflygningar (så globen uppdateras när nya loggas).
function useDroneCount(): number {
  const [n, setN] = useState(0);
  useFocusEffect(useCallback(() => {
    getDroneFlights(100000).then((f) => setN(f.length)).catch(() => {});
  }, []));
  return n;
}

const styles = StyleSheet.create({
  web: { flex: 1, width: '100%', height: '100%', backgroundColor: 'transparent' },
  hintRow: { position: 'absolute', left: 0, right: 0, top: 6, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'flex-start', paddingHorizontal: 12 },
  labelCol: { alignItems: 'flex-end', gap: 6 },
  hintBox: { paddingHorizontal: 10, paddingVertical: 5 },
  hintText: { color: DR.text3, fontSize: 10, fontWeight: '600', textAlign: 'right' },
});
