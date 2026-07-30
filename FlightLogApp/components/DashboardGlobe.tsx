// PROTOTYP: fristående, snurrbar 3D-glob på dashboarden (globe.gl / three.js i en WebView).
// Look som globe.gls Ripple Rings-exempel: nattjord (earth-night) + globe.gls standardljus + blått sken.
// Två visningslägen som växlas med DUBBEL-TAP på globen:
//   • rings  = små röda ripples vid varje besökt flygplats (default)
//   • arcs   = arc links som visar dina flugna rutter (dep→arr)
// Transparent bakgrund → svävar utan ruta/stjärnor. Ej länkad ännu.
//
// OBS (prototyp): three.js/globe.gl + jord-texturerna laddas från unpkg (CDN) → kräver internet
// vid första laddning. Görs den permanent bör biblioteken/texturerna bäddas in lokalt (offline).
import { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, Dimensions, ActivityIndicator, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { useFocusEffect } from '@react-navigation/native';
import { getAirportCoordinates } from '../db/icao';
import { getFlights } from '../db/flights';
import { useFlightStore } from '../store/flightStore';
import { Colors } from '../constants/colors';

type Ring = { lat: number; lng: number; maxR: number; propagationSpeed: number; repeatPeriod: number };
type Arc = { startLat: number; startLng: number; endLat: number; endLng: number };
type Heat = { lat: number; lng: number; weight: number };

function buildHtml(rings: Ring[], arcs: Arc[], heat: Heat[]): string {
  const ringData = JSON.stringify(rings);
  const arcData = JSON.stringify(arcs);
  const heatData = JSON.stringify(heat);
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<style>
  html,body{margin:0;padding:0;width:100%;height:100%;background:transparent;overflow:hidden;}
  #g{width:100vw;height:100vh;}
</style>
<script src="https://unpkg.com/globe.gl@2.34.4/dist/globe.gl.min.js"></script>
</head>
<body>
<div id="g"></div>
<script>
  (function(){
    var RINGS = ${ringData};
    var ARCS = ${arcData};
    var HEAT = ${heatData};
    var world = Globe()(document.getElementById('g'))
      .backgroundColor('rgba(0,0,0,0)')
      // Nattjord (stadsljus + relief) — som globe.gls Ripple Rings-exempel.
      .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-night.jpg')
      .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
      .showAtmosphere(true)
      .atmosphereColor('lightskyblue')
      .atmosphereAltitude(0.15)
      // Ripple Rings vid besökta flygplatser (röda, tonar ut).
      .ringLat('lat').ringLng('lng')
      .ringMaxRadius('maxR')
      .ringPropagationSpeed('propagationSpeed')
      .ringRepeatPeriod('repeatPeriod')
      .ringColor(function(){ return function(t){ return 'rgba(255,100,50,' + Math.sqrt(1 - t) + ')'; }; })
      // Arc links för flugna rutter (dep→arr) — röda, dash-animation som "hoppar" längs bågen.
      // Låg båghöjd (autoScale) → bågarna håller sig nära ytan och klipps inte av WebViewns övre
      // kant (globen stannar kvar i nuvarande position/storlek).
      .arcStartLat('startLat').arcStartLng('startLng')
      .arcEndLat('endLat').arcEndLng('endLng')
      .arcColor(function(){ return ['rgba(255,90,70,0.9)', 'rgba(255,40,40,0.98)']; })
      .arcStroke(0.5)
      .arcAltitudeAutoScale(0.25)
      .arcDashLength(0.4)
      .arcDashGap(0.15)
      .arcDashInitialGap(function(){ return Math.random(); })
      .arcDashAnimateTime(1600)
      // Heatmap: heat per land driven av antal besökta flygplatser (en punkt per besökt flygplats,
      // vikt = 1). Fler flygplatser i ett land → tätare punkter → hetare.
      .heatmapPoints(function(d){ return d; })
      .heatmapPointLat('lat')
      .heatmapPointLng('lng')
      .heatmapPointWeight('weight')
      .heatmapBandwidth(2.8)
      .heatmapColorSaturation(2.2)
      .heatmapBaseAltitude(0.01)
      // MAXTAK för bergshöjden: globe.gl skalar det hetaste området (din tätaste kluster, t.ex.
      // ~20 tighta flygplatser i Sverige) till detta värde och INGET berg blir högre. Övriga
      // länder skalas proportionellt därunder. Sänk 0.15 om du vill ha lägre tak.
      .heatmapTopAltitude(0.15)
      .heatmapsTransitionDuration(500);

    // Visningsläge: 'rings' (default) → 'arcs' → 'heatmap'. Dubbel-tap växlar (cyklar).
    var mode = 'rings';
    function applyMode(){
      world.ringsData(mode === 'rings' ? RINGS : []);
      world.arcsData(mode === 'arcs' ? ARCS : []);
      world.heatmapsData(mode === 'heatmap' ? [HEAT] : []);
    }
    applyMode();

    // Låter RN uppdatera globens data i realtid (utan att ladda om) när nya flighter läggs till.
    window.__updateGlobe = function(r, a, h){
      try { RINGS = JSON.parse(r); ARCS = JSON.parse(a); HEAT = JSON.parse(h); applyMode(); } catch(e){}
    };

    function size(){ world.width(document.body.clientWidth); world.height(document.body.clientHeight); }
    size();
    window.addEventListener('resize', size);

    var c = world.controls();
    c.enableZoom = false;      // ingen zoom
    c.autoRotate = true;       // snurrar av sig själv
    c.autoRotateSpeed = 0.55;
    c.enablePan = false;
    world.pointOfView({ lat: 20, lng: 10, altitude: 1.65 }); // ~20% större glob (närmare kamera)
    // Ingen ljus-override → globe.gls standardljus (riktljus + ambient) ger samma look som hemsidan.

    // Skärpa: rendera i enhetens pixeltäthet (retina) + max anisotropi på jord-texturen.
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

    // Meddela RN när globen rörs → dashboardens vertikala scroll pausas medan man snurrar.
    // Dessutom: dubbel-tap (två snabba tapp utan att dra) cyklar rings → arcs → heatmap.
    function post(m){ try { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(m); } catch(e){} }
    post('mode:' + mode); // meddela RN startläget → läges-etiketten under globen
    var sX = 0, sY = 0, sT = 0, lastTap = 0;
    document.addEventListener('touchstart', function(e){
      post('grab');
      var t = e.touches[0]; if (t){ sX = t.clientX; sY = t.clientY; sT = Date.now(); }
    }, { passive: true });
    document.addEventListener('touchend', function(e){
      post('release');
      var ct = e.changedTouches[0]; if (!ct) return;
      var now = Date.now();
      var moved = Math.abs(ct.clientX - sX) > 12 || Math.abs(ct.clientY - sY) > 12;
      var isTap = !moved && (now - sT) < 300;
      if (isTap){
        if (now - lastTap < 320){ mode = (mode === 'rings') ? 'arcs' : (mode === 'arcs') ? 'heatmap' : 'rings'; applyMode(); post('mode:' + mode); lastTap = 0; }
        else { lastTap = now; }
      } else { lastTap = 0; }
    }, { passive: true });
    document.addEventListener('touchcancel', function(){ post('release'); lastTap = 0; }, { passive: true });
  })();
  true;
</script>
</body>
</html>`;
}

// Läser flighter → bygger rings (besökta flygplatser) + arcs (unika dep→arr-rutter) + heat
// (en punkt per besökt flygplats → heatmap-tätheten per land speglar antal flygplatser).
async function loadGlobeData(): Promise<{ rings: Ring[]; arcs: Arc[]; heat: Heat[] }> {
  const flights = await getFlights(100000);
  const icaos = new Set<string>();
  for (const f of flights) {
    if (f.dep_place) icaos.add(f.dep_place.toUpperCase());
    if (f.arr_place) icaos.add(f.arr_place.toUpperCase());
  }
  const coordRows = await getAirportCoordinates([...icaos]);
  const coord = new Map(coordRows.map((r) => [r.icao.toUpperCase(), { lat: r.lat, lon: r.lon }] as const));

  // Ripple: en ring per unik besökt flygplats.
  const rings: Ring[] = coordRows.map((r, i) => ({
    lat: r.lat,
    lng: r.lon,
    maxR: 3,                        // liten radie → små ripples
    propagationSpeed: 2,
    repeatPeriod: 1100 + (i % 7) * 90, // stagger så ringarna inte pulserar i takt
  }));

  // Arcs: unika dep→arr-par ur dina flygningar.
  const seenRoute = new Set<string>();
  const arcs: Arc[] = [];
  for (const f of flights) {
    const d = f.dep_place?.toUpperCase(), a = f.arr_place?.toUpperCase();
    if (!d || !a || d === a) continue;
    const key = `${d}|${a}`;
    if (seenRoute.has(key)) continue;
    const dc = coord.get(d), ac = coord.get(a);
    if (!dc || !ac) continue;
    seenRoute.add(key);
    arcs.push({ startLat: dc.lat, startLng: dc.lon, endLat: ac.lat, endLng: ac.lon });
  }

  // Heat: en punkt (vikt 1) per besökt flygplats → tätheten per land ∝ antal flygplatser.
  const heat: Heat[] = coordRows.map((r) => ({ lat: r.lat, lng: r.lon, weight: 1 }));

  return { rings, arcs: arcs.slice(0, 500), heat };
}

export function DashboardGlobe({ onGrab }: { onGrab?: (grabbing: boolean) => void } = {}) {
  const W = Dimensions.get('window').width;
  // 30% större än ursprungliga 0.8·W → 1.04·W, kapad till skärmbredden så den inte går utanför.
  const size = Math.min(W, Math.round(W * 0.8 * 1.3));
  const flightCount = useFlightStore((st) => st.flightCount); // ändras när flighter läggs till/tas bort
  const webRef = useRef<any>(null); // WebView-instans (injectJavaScript)
  const ready = useRef(false); // WebViewn har laddat klart → säkert att injicera
  const [initial, setInitial] = useState<{ rings: Ring[]; arcs: Arc[]; heat: Heat[] } | null>(null);
  const [mode, setMode] = useState<'rings' | 'arcs' | 'heatmap'>('rings'); // aktivt lager → etikett under globen

  // Initial data → byggs in i HTML:n en gång (source ändras aldrig efteråt → ingen reload).
  useEffect(() => {
    loadGlobeData().then(setInitial).catch(() => setInitial({ rings: [], arcs: [], heat: [] }));
  }, []);

  // Pusha uppdaterad data in i den redan laddade globen (utan reload) när flighter ändras/fokus.
  const pushUpdate = useCallback(async () => {
    if (!ready.current || !webRef.current) return;
    try {
      const { rings, arcs, heat } = await loadGlobeData();
      const js = `window.__updateGlobe && window.__updateGlobe(${JSON.stringify(JSON.stringify(rings))}, ${JSON.stringify(JSON.stringify(arcs))}, ${JSON.stringify(JSON.stringify(heat))}); true;`;
      webRef.current.injectJavaScript(js);
    } catch {}
  }, []);

  useEffect(() => { pushUpdate(); }, [flightCount, pushUpdate]);
  useFocusEffect(useCallback(() => { pushUpdate(); }, [pushUpdate]));

  return (
    <View style={{ width: size, alignSelf: 'center' }}>
      <View style={[styles.wrap, { width: size, height: size }]}>
        {initial ? (
          <WebView
            ref={webRef}
            originWhitelist={['*']}
            source={{ html: buildHtml(initial.rings, initial.arcs, initial.heat) }}
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
              else if (d.indexOf('mode:') === 0) {
                const m = d.slice(5);
                if (m === 'rings' || m === 'arcs' || m === 'heatmap') setMode(m);
              }
            }}
          />
        ) : (
          <ActivityIndicator color={Colors.primary} />
        )}
      </View>
      {/* Info-rutor UNDER globen (tuckade upp i den tomma zonen under sfären så de inte skär den):
          aktivt lager överst, "double-tap"-hinten under, båda högerställda. */}
      {initial && (
        <View pointerEvents="none" style={styles.labelCol}>
          <View style={styles.modeBox}>
            <Text style={styles.modeText}>{MODE_LABELS[mode]}</Text>
          </View>
          <View style={styles.hintBox}>
            <Text style={styles.hintText}>Double-tap globe for effect</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const MODE_LABELS: Record<'rings' | 'arcs' | 'heatmap', string> = {
  rings: 'Ripples',
  arcs: 'Paths',
  heatmap: 'Heatmap',
};

const styles = StyleSheet.create({
  wrap: { alignSelf: 'center', alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  web: { flex: 1, width: '100%', height: '100%', backgroundColor: 'transparent' },
  // Kolumn under globen (högerställd); negativ marginTop tuckar upp rutorna i den tomma zonen
  // under sfären. Aktivt lager överst, "double-tap"-hint under.
  labelCol: {
    alignItems: 'flex-end', gap: 6,
    paddingHorizontal: 12, marginTop: -22,
  },
  hintBox: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: 'rgba(6,11,22,0.55)',
  },
  hintText: { color: Colors.textSecondary, fontSize: 10, fontWeight: '600' },
  modeBox: {
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.primary + '66', backgroundColor: 'rgba(6,11,22,0.55)',
  },
  modeText: { color: Colors.primary, fontSize: 10.5, fontWeight: '800', letterSpacing: 0.5 },
});
