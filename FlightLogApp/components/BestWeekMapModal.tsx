import { useEffect, useRef, useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getAirportCoordinates } from '../db/icao';
import { getFlightsForWeek } from '../db/flights';
import { Colors } from '../constants/colors';
import type { Flight } from '../types/flight';

interface Props {
  visible: boolean;
  onClose: () => void;
  weekStart: string;
  weekLabel: string;
  hours: number;
}

type Airport = { icao: string; name: string; lat: number; lon: number };

interface FlightStep {
  isXC: boolean;
  dep: Airport;
  arr: Airport | null;     // null for local flights (dep == arr)
  dep_utc: string;
  arr_utc: string;
  total_time: number;
  pic: number;
  co_pilot: number;
  aircraft_type: string;
  registration: string;
  second_pilot: string;
  bearing: number;
}

function calcBearing(dep: Airport, arr: Airport): number {
  const dLon = ((arr.lon - dep.lon) * Math.PI) / 180;
  const lat1 = (dep.lat * Math.PI) / 180;
  const lat2 = (arr.lat * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function toHHMM(dec: number): string {
  const h = Math.floor(dec);
  const m = Math.round((dec - h) * 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

function buildWeekHtml(steps: FlightStep[]): string {
  const allPts: Airport[] = steps.flatMap(s => s.arr ? [s.dep, s.arr] : [s.dep]);
  const lats = allPts.map(p => p.lat);
  const lons = allPts.map(p => p.lon);
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;
  const span = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lons) - Math.min(...lons));
  const zoom = span > 15 ? 4 : span > 8 ? 5 : span > 4 ? 6 : span > 2 ? 7 : 8;

  // Unique airports for static markers
  const seen = new Set<string>();
  const uniqueAirports: Airport[] = [];
  allPts.forEach(p => { if (!seen.has(p.icao)) { seen.add(p.icao); uniqueAirports.push(p); } });

  const stepsJson = JSON.stringify(steps.map(s => ({
    isXC: s.isXC,
    dep: s.dep,
    arr: s.arr,
    bearing: s.bearing,
  })));

  const airportsJs = uniqueAirports.map(a =>
    `L.circleMarker([${a.lat},${a.lon}],{radius:6,fillColor:'#475569',color:'#fff',weight:1.5,opacity:1,fillOpacity:0.9}).addTo(map).bindPopup('<strong>${a.icao}</strong><br><span style="font-size:11px;color:#64748B">${a.name.replace(/'/g, "\\'")}</span>');`
  ).join('\n');

  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:100%;height:100%;background:#f8fafc}
  #map{position:absolute;top:0;left:0;right:0;bottom:0}
  .leaflet-popup-content-wrapper{background:#fff;color:#1e293b;border-radius:8px;border:1px solid #e2e8f0;box-shadow:0 4px 12px rgba(0,0,0,.15)}
  .leaflet-popup-tip{background:#fff}
  .leaflet-popup-content{margin:8px 12px;font-family:-apple-system,sans-serif;font-size:13px}
  .leaflet-control-attribution{font-size:9px;background:rgba(255,255,255,.8)!important;color:#94a3b8}
  #layer-switcher{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);z-index:1000;display:flex;gap:6px;background:rgba(255,255,255,.92);border-radius:12px;padding:6px;box-shadow:0 4px 16px rgba(0,0,0,.15);border:1px solid #e2e8f0}
  #layer-switcher button{font-family:-apple-system,sans-serif;font-size:11px;font-weight:600;color:#64748B;background:transparent;border:none;border-radius:8px;padding:6px 12px;cursor:pointer}
  #layer-switcher button.active{background:#2563EB;color:#fff}
</style>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin=""/>
</head><body>
<div id="map"></div><div id="layer-switcher"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
<script>
var STEPS = ${stepsJson};
var map, polylines, planeMarker;

window.onload = function() {
  map = L.map('map',{center:[${centerLat},${centerLon}],zoom:${zoom},zoomControl:true,attributionControl:true});
  var layers = {
    'Ljus':         L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',{subdomains:'abcd',maxZoom:19,crossOrigin:true,attribution:'© OpenStreetMap © CARTO'}),
    'Satellit':     L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'© Esri'}),
    'Terrängkarta': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',{subdomains:'abc',maxZoom:17,crossOrigin:true,attribution:'© OpenStreetMap © OpenTopoMap'}),
  };
  var activeKey = 'Ljus';
  layers[activeKey].addTo(map);
  var sw = document.getElementById('layer-switcher');
  Object.keys(layers).forEach(function(key){
    var btn = document.createElement('button');
    btn.textContent = key;
    if(key===activeKey) btn.className='active';
    btn.onclick = function(){map.removeLayer(layers[activeKey]);activeKey=key;layers[activeKey].addTo(map);sw.querySelectorAll('button').forEach(function(b){b.className=''});btn.className='active';};
    sw.appendChild(btn);
  });

  ${airportsJs}

  // Polylines: only for XC flights, null for local
  polylines = STEPS.map(function(s){
    if(!s.isXC||!s.arr) return null;
    return L.polyline([[s.dep.lat,s.dep.lon],[s.arr.lat,s.arr.lon]],
      {color:'#CBD5E1',weight:2,opacity:0.35,dashArray:'5,4'}).addTo(map);
  });

  var first = STEPS[0];
  planeMarker = L.marker([first.dep.lat, first.dep.lon],{
    icon: makePlaneIcon(first.bearing||0), zIndexOffset:1000
  }).addTo(map);

  function handleMsg(e){
    try{var m=JSON.parse(e.data);if(m.type==='GOTO')goto(m.index);}catch(ex){}
  }
  document.addEventListener('message',handleMsg);
  window.addEventListener('message',handleMsg);

  goto(0);
  setTimeout(function(){map.invalidateSize();},300);
};

function makePlaneIcon(hdg){
  var rot = hdg - 90;
  return L.divIcon({
    className:'',
    html:'<div style="font-size:22px;transform:rotate('+rot+'deg);filter:drop-shadow(0 1px 3px rgba(0,0,0,0.55));line-height:1">✈</div>',
    iconSize:[24,24],iconAnchor:[12,12]
  });
}

function getPrevArrPos(idx){
  for(var i=idx-1;i>=0;i--){
    var s=STEPS[i];
    var a=s.isXC&&s.arr ? s.arr : s.dep;
    return [a.lat,a.lon];
  }
  return null;
}

function goto(idx){
  if(idx<0||idx>=STEPS.length) return;
  var s = STEPS[idx];

  // Update polyline styles
  for(var i=0;i<STEPS.length;i++){
    if(!polylines[i]) continue;
    if(i<idx)        polylines[i].setStyle({color:'#94A3B8',weight:2.5,opacity:0.7,dashArray:'6,4'});
    else if(i===idx) polylines[i].setStyle({color:'#2563EB',weight:3.5,opacity:1,dashArray:''});
    else             polylines[i].setStyle({color:'#CBD5E1',weight:1.5,opacity:0.3,dashArray:'5,4'});
  }

  var destLat, destLon;
  if(s.isXC && s.arr){
    destLat = s.arr.lat; destLon = s.arr.lon;
  } else {
    destLat = s.dep.lat; destLon = s.dep.lon;
  }

  var prevPos = getPrevArrPos(idx);
  var fromPos = prevPos || [s.dep.lat, s.dep.lon];
  animatePlane(fromPos, [destLat, destLon], s.bearing||0);

  // Fit bounds
  if(s.isXC && s.arr){
    map.fitBounds([[s.dep.lat,s.dep.lon],[s.arr.lat,s.arr.lon]],{padding:[70,70],maxZoom:11,animate:true});
  } else {
    map.setView([s.dep.lat,s.dep.lon],Math.max(map.getZoom(),9),{animate:true});
  }
}

function animatePlane(from,to,hdg){
  var STEPS_N=50,step=0,icon=makePlaneIcon(hdg);
  function tick(){
    step++;
    var t=step/STEPS_N;
    t=t<0.5?2*t*t:-1+(4-2*t)*t;
    planeMarker.setLatLng([from[0]+(to[0]-from[0])*t, from[1]+(to[1]-from[1])*t]);
    if(step===1) planeMarker.setIcon(icon);
    if(step<STEPS_N) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
</script></body></html>`;
}

export function BestWeekMapModal({ visible, onClose, weekStart, weekLabel, hours }: Props) {
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [steps, setSteps] = useState<FlightStep[]>([]);
  const [step, setStep] = useState(0);
  const [webViewReady, setWebViewReady] = useState(false);

  useEffect(() => {
    if (!visible || !weekStart) return;
    setLoading(true);
    setError(false);
    setHtml(null);
    setSteps([]);
    setStep(0);
    setWebViewReady(false);

    (async () => {
      try {
        const flights = await getFlightsForWeek(weekStart);
        if (!flights.length) { setError(true); return; }

        const icaos = [...new Set(flights.flatMap((f: Flight) => [f.dep_place, f.arr_place].filter(Boolean)))];
        const coords = await getAirportCoordinates(icaos);
        const find = (icao: string): Airport | undefined => coords.find(c => c.icao === icao);

        const builtSteps: FlightStep[] = flights
          .map((f: Flight): FlightStep | null => {
            const dep = find(f.dep_place);
            if (!dep) return null;
            const arr = f.dep_place !== f.arr_place ? find(f.arr_place) ?? null : null;
            const isXC = arr !== null;
            const bearing = isXC && arr ? calcBearing(dep, arr) : 0;
            return {
              isXC, dep, arr, bearing,
              dep_utc: f.dep_utc ?? '',
              arr_utc: f.arr_utc ?? '',
              total_time: f.total_time,
              pic: f.pic ?? 0,
              co_pilot: f.co_pilot ?? 0,
              aircraft_type: f.aircraft_type ?? '',
              registration: f.registration ?? '',
              second_pilot: f.second_pilot ?? '',
            };
          })
          .filter((s): s is FlightStep => s !== null);

        if (!builtSteps.length) { setError(true); return; }

        setSteps(builtSteps);
        setHtml(buildWeekHtml(builtSteps));
      } catch {
        setError(true);
      }
    })().finally(() => setLoading(false));
  }, [visible, weekStart]);

  const goTo = (idx: number) => {
    if (idx < 0 || idx >= steps.length) return;
    setStep(idx);
    webViewRef.current?.postMessage(JSON.stringify({ type: 'GOTO', index: idx }));
  };

  const currentStep = steps[step];
  const hhmm = toHHMM(hours);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {loading && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>Hämtar veckans flygningar…</Text>
          </View>
        )}
        {error && (
          <View style={styles.center}>
            <Ionicons name="map-outline" size={48} color={Colors.textMuted} />
            <Text style={styles.errorText}>Koordinater saknas för flygplatserna den här veckan.</Text>
          </View>
        )}
        {html && (
          <WebView
            ref={webViewRef}
            style={styles.webview}
            source={{ html, baseUrl: 'https://tile.openstreetmap.org' }}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            mixedContentMode="always"
            cacheEnabled={false}
            onLoad={() => setWebViewReady(true)}
          />
        )}

        {/* ── Info-banner topp ── */}
        {html && (
          <View style={[styles.infoBanner, { top: insets.top + 12 }]}>
            <View style={styles.bannerRow}>
              <Ionicons name="trophy" size={13} color={Colors.gold} />
              <Text style={styles.weekLabel}>{weekLabel}</Text>
            </View>
            <Text style={styles.bannerMeta}>{hhmm}h · {steps.length} flygn.</Text>
          </View>
        )}

        {/* ── Stäng ── */}
        <TouchableOpacity
          style={[styles.closeBtn, { top: insets.top + 12 }]}
          onPress={onClose}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Ionicons name="close" size={20} color="#fff" />
        </TouchableOpacity>

        {/* ── Bottom step panel ── */}
        {html && currentStep && (
          <View style={[styles.bottomPanel, { paddingBottom: insets.bottom + 8 }]}>
            {/* Navigation row */}
            <View style={styles.navRow}>
              <TouchableOpacity
                style={[styles.navBtn, step === 0 && styles.navBtnDisabled]}
                onPress={() => goTo(step - 1)}
                disabled={step === 0 || !webViewReady}
              >
                <Ionicons name="chevron-back" size={18} color={step === 0 ? Colors.textMuted : Colors.textPrimary} />
              </TouchableOpacity>

              <View style={styles.stepCenter}>
                <Text style={styles.stepLabel}>Flygning</Text>
                <Text style={styles.stepValue}>{step + 1} / {steps.length}</Text>
              </View>

              <TouchableOpacity
                style={[styles.navBtn, step === steps.length - 1 && styles.navBtnDisabled]}
                onPress={() => goTo(step + 1)}
                disabled={step === steps.length - 1 || !webViewReady}
              >
                <Ionicons name="chevron-forward" size={18} color={step === steps.length - 1 ? Colors.textMuted : Colors.textPrimary} />
              </TouchableOpacity>
            </View>

            {/* Flight data row */}
            <View style={styles.dataRow}>
              <DataCell
                label="T/O"
                value={`${currentStep.dep.icao}${currentStep.dep_utc ? ' · ' + currentStep.dep_utc : ''}`}
              />
              <View style={styles.dataDivider} />
              <DataCell
                label="LDG"
                value={currentStep.arr
                  ? `${currentStep.arr.icao}${currentStep.arr_utc ? ' · ' + currentStep.arr_utc : ''}`
                  : `${currentStep.dep.icao}${currentStep.arr_utc ? ' · ' + currentStep.arr_utc : ''}`}
              />
              <View style={styles.dataDivider} />
              <DataCell label="Flygtid" value={toHHMM(currentStep.total_time)} mono />
              <View style={styles.dataDivider} />
              <DataCell
                label={currentStep.pic > 0 ? 'Co-pilot' : currentStep.co_pilot > 0 ? 'PIC' : 'Co-pilot'}
                value={currentStep.second_pilot?.trim()
                  || (currentStep.co_pilot > 0 ? toHHMM(currentStep.co_pilot) : '—')}
                mono={!currentStep.second_pilot?.trim() && currentStep.co_pilot > 0}
              />
            </View>

            {/* Aircraft + type badge */}
            <View style={styles.bottomFooter}>
              <Text style={styles.aircraftRow}>
                {[currentStep.aircraft_type, currentStep.registration].filter(Boolean).join(' · ')}
              </Text>
              <View style={[styles.typeBadge, currentStep.isXC ? styles.badgeXC : styles.badgeLocal]}>
                <Text style={styles.typeBadgeText}>{currentStep.isXC ? 'XC' : 'Lokal'}</Text>
              </View>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

function DataCell({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.dataCell}>
      <Text style={styles.dataCellLabel}>{label}</Text>
      <Text style={[styles.dataCellValue, mono && styles.dataCellMono]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f8fafc' },
  webview: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  loadingText: { color: Colors.textSecondary, fontSize: 14 },
  errorText: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20 },

  infoBanner: {
    position: 'absolute', left: 16, right: 64,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 0.5, borderColor: Colors.gold + '88', gap: 2,
  },
  bannerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  weekLabel: { color: '#1e293b', fontSize: 13, fontWeight: '800', letterSpacing: 0.3 },
  bannerMeta: { color: '#64748B', fontSize: 11, fontFamily: 'Menlo' },

  closeBtn: {
    position: 'absolute', right: 16,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.2)',
  },

  // ── Bottom panel ──
  bottomPanel: {
    backgroundColor: Colors.surface,
    borderTopWidth: 1, borderTopColor: Colors.border,
    paddingTop: 10, paddingHorizontal: 16, gap: 8,
  },
  navRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  navBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: Colors.elevated,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  navBtnDisabled: { opacity: 0.3 },
  stepCenter: { alignItems: 'center' },
  stepLabel: { color: Colors.textMuted, fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  stepValue: { color: Colors.textPrimary, fontSize: 17, fontWeight: '800', fontFamily: 'Menlo' },

  dataRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card, borderRadius: 10,
    borderWidth: 0.5, borderColor: Colors.border,
    paddingVertical: 8,
  },
  dataDivider: { width: 0.5, height: 32, backgroundColor: Colors.separator },
  dataCell: { flex: 1, alignItems: 'center', paddingHorizontal: 4, gap: 2 },
  dataCellLabel: { color: Colors.textMuted, fontSize: 9, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.6 },
  dataCellValue: { color: Colors.textPrimary, fontSize: 11, fontWeight: '600', textAlign: 'center' },
  dataCellMono: { fontFamily: 'Menlo', fontVariant: ['tabular-nums'] },

  bottomFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 2 },
  aircraftRow: { color: Colors.textMuted, fontSize: 11, fontFamily: 'Menlo' },
  typeBadge: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
  },
  badgeXC: { backgroundColor: Colors.primary + '22' },
  badgeLocal: { backgroundColor: Colors.gold + '22' },
  typeBadgeText: { fontSize: 10, fontWeight: '700', color: Colors.textSecondary },
});
