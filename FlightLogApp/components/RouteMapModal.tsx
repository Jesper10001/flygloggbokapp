import { useEffect, useRef, useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { getAirportCoordinates } from '../db/icao';
import { getXCLegsForDate, type XCLeg } from '../db/flights';
import { Colors } from '../constants/colors';
import { useTranslation } from '../hooks/useTranslation';

interface Props {
  visible: boolean;
  onClose: () => void;
  xcDate: string;
  hours: number;
}

type Airport = { icao: string; name: string; lat: number; lon: number };

interface EnrichedLeg extends XCLeg {
  dep: Airport;
  arr: Airport;
  bearing: number;
}

function coPilotLabel(leg: EnrichedLeg): string {
  if (leg.second_pilot?.trim()) return leg.second_pilot.trim();
  if (leg.co_pilot > 0) return toHHMM(leg.co_pilot);
  return '—';
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

function buildInteractiveHtml(legs: EnrichedLeg[]): string {
  const allPts = legs.flatMap(l => [l.dep, l.arr]);
  const lats = allPts.map(p => p.lat);
  const lons = allPts.map(p => p.lon);
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;
  const span = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lons) - Math.min(...lons));
  const zoom = span > 15 ? 4 : span > 8 ? 5 : span > 4 ? 6 : span > 2 ? 7 : 8;

  const seen = new Set<string>();
  const uniqueAirports: Airport[] = [];
  allPts.forEach(p => { if (!seen.has(p.icao)) { seen.add(p.icao); uniqueAirports.push(p); } });

  const legsJson = JSON.stringify(legs.map(l => ({
    dep: l.dep, arr: l.arr, bearing: l.bearing,
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
var LEGS = ${legsJson};
var map, polylines, planeMarker;
var animLine = null, animFrame = null;

window.onload = function() {
  map = L.map('map',{center:[${centerLat},${centerLon}],zoom:${zoom},zoomControl:true,attributionControl:true});
  var layers = {
    'Light':     L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',{subdomains:'abcd',maxZoom:19,crossOrigin:true,attribution:'© OpenStreetMap © CARTO'}),
    'Satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'© Esri'}),
    'Terrain':   L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',{subdomains:'abc',maxZoom:17,crossOrigin:true,attribution:'© OpenStreetMap © OpenTopoMap'}),
  };
  var activeKey = 'Light';
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

  polylines = LEGS.map(function(leg){
    return L.polyline([[leg.dep.lat,leg.dep.lon],[leg.arr.lat,leg.arr.lon]],
      {color:'#CBD5E1',weight:2,opacity:0.35,dashArray:'5,4'}).addTo(map);
  });

  planeMarker = L.marker([LEGS[0].dep.lat,LEGS[0].dep.lon],{
    icon: makePlaneIcon(LEGS[0].bearing), zIndexOffset:1000
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

function goto(idx){
  if(idx<0||idx>=LEGS.length) return;
  var leg = LEGS[idx];
  for(var i=0;i<LEGS.length;i++){
    if(i<idx) polylines[i].setStyle({color:'#1e3a6e',weight:2.5,opacity:0.45,dashArray:''});
    else      polylines[i].setStyle({color:'#CBD5E1',weight:1.5,opacity:0.3,dashArray:'5,4'});
  }
  animateLeg(leg.dep, leg.arr);
  var from = idx===0 ? [leg.dep.lat,leg.dep.lon] : [LEGS[idx-1].arr.lat,LEGS[idx-1].arr.lon];
  animatePlane(from,[leg.arr.lat,leg.arr.lon],leg.bearing);
  map.fitBounds([[leg.dep.lat,leg.dep.lon],[leg.arr.lat,leg.arr.lon]],{padding:[70,70],maxZoom:11,animate:true});
}

function animateLeg(dep, arr){
  if(animLine){ map.removeLayer(animLine); animLine = null; }
  if(animFrame){ cancelAnimationFrame(animFrame); animFrame = null; }
  var DURATION = 2000;
  var startTs = null;
  animLine = L.polyline([[dep.lat,dep.lon],[dep.lat,dep.lon]],{
    color:'#0A1E3C',weight:4,opacity:0,lineCap:'round',lineJoin:'round'
  }).addTo(map);
  function frame(ts){
    if(!startTs) startTs = ts;
    var progress = Math.min((ts - startTs) / DURATION, 1);
    // ease-in-out cubic
    var t = progress < 0.5 ? 4*progress*progress*progress : 1 - Math.pow(-2*progress+2,3)/2;
    var lat = dep.lat + (arr.lat - dep.lat) * t;
    var lon = dep.lon + (arr.lon - dep.lon) * t;
    animLine.setLatLngs([[dep.lat,dep.lon],[lat,lon]]);
    animLine.setStyle({opacity: t * 0.92});
    if(progress < 1){ animFrame = requestAnimationFrame(frame); }
  }
  animFrame = requestAnimationFrame(frame);
}

function animatePlane(from,to,hdg){
  var STEPS=80,step=0,icon=makePlaneIcon(hdg);
  function tick(){
    step++;
    var t=step/STEPS;
    t=t<0.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
    planeMarker.setLatLng([from[0]+(to[0]-from[0])*t, from[1]+(to[1]-from[1])*t]);
    if(step===1) planeMarker.setIcon(icon);
    if(step<STEPS) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
</script></body></html>`;
}

export function RouteMapModal({ visible, onClose, xcDate, hours }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [legs, setLegs] = useState<EnrichedLeg[]>([]);
  const [step, setStep] = useState(0);
  const [webViewReady, setWebViewReady] = useState(false);

  useEffect(() => {
    if (!visible || !xcDate) return;
    setLoading(true);
    setError(false);
    setHtml(null);
    setLegs([]);
    setStep(0);
    setWebViewReady(false);

    (async () => {
      try {
        const legData = await getXCLegsForDate(xcDate);
        if (!legData.length) { setError(true); return; }

        const allIcaos = [...new Set(legData.flatMap(l => [l.dep_place, l.arr_place]))];
        const coords = await getAirportCoordinates(allIcaos);
        const find = (icao: string): Airport | undefined => coords.find(c => c.icao === icao);

        const enriched: EnrichedLeg[] = legData
          .map(l => {
            const dep = find(l.dep_place);
            const arr = find(l.arr_place);
            if (!dep || !arr) return null;
            return { ...l, dep, arr, bearing: calcBearing(dep, arr) };
          })
          .filter((l): l is EnrichedLeg => l !== null);

        if (!enriched.length) { setError(true); return; }

        setLegs(enriched);
        setHtml(buildInteractiveHtml(enriched));
      } catch {
        setError(true);
      }
    })().finally(() => setLoading(false));
  }, [visible, xcDate]);

  const goTo = (idx: number) => {
    if (idx < 0 || idx >= legs.length) return;
    setStep(idx);
    webViewRef.current?.postMessage(JSON.stringify({ type: 'GOTO', index: idx }));
  };

  const currentLeg = legs[step];
  const hhmm = toHHMM(hours);

  // Route stops for banner
  const stops: Airport[] = legs.length
    ? [legs[0].dep, ...legs.map(l => l.arr)]
    : [];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {loading && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>{t('loading_coordinates')}</Text>
          </View>
        )}
        {error && (
          <View style={styles.center}>
            <Ionicons name="map-outline" size={48} color={Colors.textMuted} />
            <Text style={styles.errorText}>{t('coordinates_missing_airports')}</Text>
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
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.stopsScroll}>
              {stops.map((stop, i) => (
                <View key={`${stop.icao}-${i}`} style={styles.stopItem}>
                  {i > 0 && <Ionicons name="caret-forward" size={9} color={Colors.gold} style={styles.stopArrow} />}
                  <View style={styles.stopInfo}>
                    <Text style={styles.stopIcao}>{stop.icao}</Text>
                    <Text style={styles.stopName} numberOfLines={1}>{stop.name}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>
            <Text style={styles.routeMeta}>{hhmm} · {xcDate}</Text>
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
        {html && currentLeg && (
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
                <Text style={styles.stepLabel}>{t('leg')}</Text>
                <Text style={styles.stepValue}>{step + 1} / {legs.length}</Text>
              </View>

              <TouchableOpacity
                style={[styles.navBtn, step === legs.length - 1 && styles.navBtnDisabled]}
                onPress={() => goTo(step + 1)}
                disabled={step === legs.length - 1 || !webViewReady}
              >
                <Ionicons name="chevron-forward" size={18} color={step === legs.length - 1 ? Colors.textMuted : Colors.textPrimary} />
              </TouchableOpacity>
            </View>

            {/* Flight data row */}
            <View style={styles.dataRow}>
              <DataCell label="T/O" value={`${currentLeg.dep_place}${currentLeg.dep_utc ? ' · ' + currentLeg.dep_utc : ''}`} />
              <View style={styles.dataDivider} />
              <DataCell label="LDG" value={`${currentLeg.arr_place}${currentLeg.arr_utc ? ' · ' + currentLeg.arr_utc : ''}`} />
              <View style={styles.dataDivider} />
              <DataCell label={t('flight_time_label')} value={toHHMM(currentLeg.total_time)} mono />
              <View style={styles.dataDivider} />
              <DataCell
                label={currentLeg.pic > 0 ? 'Co-pilot' : currentLeg.co_pilot > 0 ? 'PIC' : 'Co-pilot'}
                value={coPilotLabel(currentLeg)}
                mono={!currentLeg.second_pilot?.trim() && currentLeg.co_pilot > 0}
              />
            </View>

            {/* Aircraft row */}
            <Text style={styles.aircraftRow}>
              {[currentLeg.aircraft_type, currentLeg.registration].filter(Boolean).join(' · ')}
            </Text>
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
    borderWidth: 0.5, borderColor: Colors.gold + '88', gap: 4,
  },
  stopsScroll: { flexGrow: 0 },
  stopItem: { flexDirection: 'row', alignItems: 'center' },
  stopArrow: { marginHorizontal: 4 },
  stopInfo: { alignItems: 'flex-start' },
  stopIcao: { color: '#1e293b', fontSize: 13, fontWeight: '800', fontFamily: 'Menlo', letterSpacing: 1 },
  stopName: { color: '#64748B', fontSize: 9, maxWidth: 70 },
  routeMeta: { color: '#64748B', fontSize: 11, fontFamily: 'Menlo' },

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

  aircraftRow: {
    color: Colors.textMuted, fontSize: 11, textAlign: 'center',
    fontFamily: 'Menlo', paddingBottom: 2,
  },
});
