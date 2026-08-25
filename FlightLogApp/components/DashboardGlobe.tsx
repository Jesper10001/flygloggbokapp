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
import { View, Text, TouchableOpacity, Dimensions, ActivityIndicator, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { useFocusEffect } from '@react-navigation/native';
import { getAirportCoordinates } from '../db/icao';
import { getFlights } from '../db/flights';
import { useFlightStore } from '../store/flightStore';
import { Colors } from '../constants/colors';

type Ring = { lat: number; lng: number; maxR: number; propagationSpeed: number; repeatPeriod: number };
type Arc = { startLat: number; startLng: number; endLat: number; endLng: number };
type Heat = { lat: number; lng: number; weight: number };

type ViewCfg = { altitude: number; minDistance: number; maxDistance: number };

function buildHtml(rings: Ring[], arcs: Arc[], heat: Heat[], view: ViewCfg): string {
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

    // Visningsläge: 'rings' (default) → 'arcs' → 'heatmap'. Cyklas AUTOMATISKT var 15:e sekund.
    var mode = 'rings';
    function applyMode(){
      world.ringsData(mode === 'rings' ? RINGS : []);
      world.arcsData(mode === 'arcs' ? ARCS : []);
      world.heatmapsData(mode === 'heatmap' ? [HEAT] : []);
    }
    applyMode();
    // Auto-cykla läget var 15:e sekund — ingen dubbel-tap behövs.
    setInterval(function(){ mode = (mode === 'rings') ? 'arcs' : (mode === 'arcs') ? 'heatmap' : 'rings'; applyMode(); }, 15000);

    // Låter RN uppdatera globens data i realtid (utan att ladda om) när nya flighter läggs till.
    window.__updateGlobe = function(r, a, h){
      try { RINGS = JSON.parse(r); ARCS = JSON.parse(a); HEAT = JSON.parse(h); applyMode(); } catch(e){}
    };

    function size(){ world.width(document.body.clientWidth); world.height(document.body.clientHeight); }
    size();
    window.addEventListener('resize', size);

    var c = world.controls();
    c.enableZoom = true;       // pinch-zoom (två fingrar) som på en karta
    c.zoomSpeed = 1.4;
    // Canvasen är större än skärmen → globen bleeder ut över kanterna som en bakgrund.
    // minDistance hålls > 100/tan(fov/2) så globen ALDRIG växer utanför canvasen (ingen hård
    // kant klipper halon, ens vid maximal inzoomning); maxDistance = hur litet man får zooma ut.
    c.minDistance = ${view.minDistance};
    c.maxDistance = ${view.maxDistance};
    c.autoRotate = true;       // snurrar av sig själv
    c.autoRotateSpeed = 0.55;
    c.enablePan = false;
    world.pointOfView({ lat: 20, lng: 10, altitude: ${view.altitude} }); // kamera tillbakadragen → luft runt globen i den större canvasen
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
    // Enkel-tap → öppna kart-val-menyn i RN. Dubbel-tap → cykla effekt manuellt (utöver auto var 15:e s).
    // Enkel-tappen fördröjs 340 ms för att kunna skiljas från en dubbel-tap.
    function post(m){ try { if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(m); } catch(e){} }
    var sX = 0, sY = 0, sT = 0, lastTap = 0, tapTimer = null;
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
        if (now - lastTap < 320){
          if (tapTimer){ clearTimeout(tapTimer); tapTimer = null; } // avbryt väntande enkel-tap
          mode = (mode === 'rings') ? 'arcs' : (mode === 'arcs') ? 'heatmap' : 'rings'; applyMode(); lastTap = 0;
        } else {
          lastTap = now;
          if (tapTimer) clearTimeout(tapTimer);
          tapTimer = setTimeout(function(){ tapTimer = null; post('tap'); }, 340); // ingen andra-tap → enkel-tap
        }
      } else { lastTap = 0; if (tapTimer){ clearTimeout(tapTimer); tapTimer = null; } }
    }, { passive: true });
    document.addEventListener('touchcancel', function(){ post('release'); lastTap = 0; if (tapTimer){ clearTimeout(tapTimer); tapTimer = null; } }, { passive: true });

    // Rapportera globens synliga radie (px) till RN vid zoom → connector-strecken följer konturen.
    function radiusPx(){
      try {
        var cam = world.camera();
        var dist = cam.position.length();          // kameraavstånd till globcentrum (origo)
        var h = document.body.clientHeight;
        var fov = cam.fov * Math.PI / 180;
        return 100 * (h / 2) / (dist * Math.tan(fov / 2)); // 100 = globe.gls GLOBE_RADIUS
      } catch(e){ return 0; }
    }
    var lastR = 0;
    function reportR(){ var r = radiusPx(); if (r > 0 && Math.abs(r - lastR) > 0.5){ lastR = r; post('radius:' + Math.round(r)); } }
    c.addEventListener('change', reportR);   // fyras vid zoom/rotation; guarden postar bara vid radie-ändring
    setTimeout(reportR, 200); setTimeout(reportR, 900);
  })();
  true;
</script>
</body>
</html>`;
}

// Läser alla flighter → bygger rings (besökta flygplatser) + arcs (unika dep→arr-rutter) +
// heat (en punkt per besökt flygplats → heatmap-tätheten per land ∝ antal).
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

export function DashboardGlobe({ onGrab, onMetrics, onTap }: { onGrab?: (grabbing: boolean) => void; onMetrics?: (radiusPx: number) => void; onTap?: () => void } = {}) {
  const W = Dimensions.get('window').width;
  // Canvasen görs 50% bredare/högre än skärmen så globen kan bleeda ut över alla kanter (som en
  // bakgrund) — den hårda WebView-kanten hamnar utanför skärmen och klipper aldrig halon.
  const canvas = Math.round(W * 1.5);
  const visibleH = Math.round(W * 1.06);           // sektionens synliga höjd i scroll-flödet
  const centerY = Math.round(visibleH * 0.5);      // globens mittpunkt → uppflyttad så globens topp nästan nuddar bildkarusellen ovanför
  const left = Math.round((W - canvas) / 2);       // centrerad horisontellt → sido-halo bleeder av skärmen (klipps vid skärmkanten, sömlöst)
  const top = centerY - Math.round(canvas / 2);    // negativ → globen svävar upp bakom sektionen, botten bleeder nedåt
  // Kamerakonfig: altitude 2.61 håller globens diameter ≈ 1.1·W i den 1.5·W-stora canvasen.
  // minDistance sänkt till 200 → man kan zooma in betydligt närmare (globen växer förbi canvasen
  // och fyller vyn; kanterna som klipps ligger utanför skärmen). maxDistance = minsta utzoomning.
  const VIEW: ViewCfg = { altitude: 2.61, minDistance: 200, maxDistance: 520 };
  const flightCount = useFlightStore((st) => st.flightCount); // ändras när flighter läggs till/tas bort
  const webRef = useRef<any>(null); // WebView-instans (injectJavaScript)
  const ready = useRef(false); // WebViewn har laddat klart → säkert att injicera
  const [initial, setInitial] = useState<{ rings: Ring[]; arcs: Arc[]; heat: Heat[] } | null>(null);

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
    // Sektionen reserverar bara visibleH i scroll-flödet; själva canvasen är absolut placerad och
    // större → globen bleeder ut över kanterna (bakgrundskänsla) utan att sträcka layouten.
    <View style={{ width: W, height: visibleH, alignSelf: 'center' }}>
      {initial ? (
        <View style={{ position: 'absolute', left, top, width: canvas, height: canvas }}>
          <WebView
            ref={webRef}
            originWhitelist={['*']}
            source={{ html: buildHtml(initial.rings, initial.arcs, initial.heat, VIEW) }}
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
              else if (d.indexOf('radius:') === 0) {
                const r = parseFloat(d.slice(7));
                if (isFinite(r) && r > 0) onMetrics?.(r);
              } else if (d === 'tap') {
                onTap?.();
              }
            }}
          />
        </View>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={Colors.primary} />
        </View>
      )}
      {/* Info-överlägg pinnat i sektionens övre högra hörn (globens övre del). */}
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

const styles = StyleSheet.create({
  web: { flex: 1, width: '100%', height: '100%', backgroundColor: 'transparent' },
  // Info-rad som absolut overlay i sektionens övre högra hörn (globens övre del). Högerställd.
  hintRow: {
    position: 'absolute', left: 0, right: 0, top: 6,
    flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'flex-start',
    paddingHorizontal: 12,
  },
  labelCol: { alignItems: 'flex-end', gap: 6 },
  hintBox: {
    paddingHorizontal: 10, paddingVertical: 5, // ingen border, ingen bakgrund → texten står fritt
  },
  hintText: { color: Colors.textSecondary, fontSize: 10, fontWeight: '600', textAlign: 'right' },
});
