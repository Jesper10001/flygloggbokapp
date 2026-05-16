import { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet, TextInput, FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { getVisitedAirportIcaos } from '../db/flights';
import { getAirportCoordinates, getAllTemporaryPlaces, getUnlocatedTemporaryPlaces, updateUserAirport, getSeedAirports } from '../db/icao';
import type { IcaoAirport } from '../types/flight';
import { Colors } from '../constants/colors';
import { useTranslation } from '../hooks/useTranslation';
import { useFlightStore } from '../store/flightStore';
import * as Haptics from 'expo-haptics';

const countryNames: Record<string, string> = {
  US:'United States',BR:'Brazil',CA:'Canada',AU:'Australia',RU:'Russia',CL:'Chile',DE:'Germany',
  PG:'Papua New Guinea',ID:'Indonesia',FR:'France',VE:'Venezuela',ZA:'South Africa',CN:'China',
  EC:'Ecuador',KR:'South Korea',IN:'India',ES:'Spain',GB:'United Kingdom',CD:'DR Congo',NZ:'New Zealand',
  AR:'Argentina',NO:'Norway',BO:'Bolivia',SE:'Sweden',IT:'Italy',MX:'Mexico',PE:'Peru',CO:'Colombia',
  JP:'Japan',CZ:'Czechia',PL:'Poland',CR:'Costa Rica',BE:'Belgium',NL:'Netherlands',NA:'Namibia',
  HN:'Honduras',KE:'Kenya',AT:'Austria',PH:'Philippines',IR:'Iran',FI:'Finland',PT:'Portugal',
  PK:'Pakistan',ZW:'Zimbabwe',DK:'Denmark',TR:'Turkey',CH:'Switzerland',UA:'Ukraine',ZM:'Zambia',
  TZ:'Tanzania',HU:'Hungary',IS:'Iceland',BW:'Botswana',SA:'Saudi Arabia',MY:'Malaysia',GL:'Greenland',
  MM:'Myanmar',TH:'Thailand',MG:'Madagascar',GR:'Greece',DZ:'Algeria',EG:'Egypt',KZ:'Kazakhstan',
  BG:'Bulgaria',BS:'Bahamas',RO:'Romania',IE:'Ireland',PA:'Panama',NG:'Nigeria',UY:'Uruguay',
  ET:'Ethiopia',IL:'Israel',AE:'UAE',TW:'Taiwan',MN:'Mongolia',NP:'Nepal',
};

function getCountryName(code: string): string {
  return countryNames[code] || code;
}

type SeedRow = [string, string, string, string, number, number];

function buildCountryList(data: SeedRow[]) {
  const map = new Map<string, number>();
  for (const [, , country] of data) map.set(country, (map.get(country) ?? 0) + 1);
  return Array.from(map.entries())
    .map(([code, count]) => ({ code, name: getCountryName(code), count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

type AirportPoint = { icao: string; name: string; lat: number; lon: number; temporary?: boolean };

// Hämta alla unika besökta ICAO-koder direkt från flygningarna
async function getAllVisitedIcaos(): Promise<string[]> {
  const icaos = await getVisitedAirportIcaos();
  return [...new Set(icaos)].filter(Boolean);
}

function buildMapHtml(airports: AirportPoint[]): string {
  const lats = airports.map(a => a.lat);
  const lons = airports.map(a => a.lon);
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;
  const latSpan = Math.max(...lats) - Math.min(...lats);
  const zoom = latSpan > 20 ? 4 : latSpan > 10 ? 5 : latSpan > 5 ? 6 : 7;

  const pinSvg = `<svg width="14" height="20" viewBox="0 0 28 40" xmlns="http://www.w3.org/2000/svg"><path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.268 21.732 0 14 0z" fill="#D32F2F" stroke="#fff" stroke-width="1.8"/><circle cx="14" cy="13" r="5.5" fill="#fff" opacity="0.9"/></svg>`;
  const tempPinSvg = `<svg width="14" height="20" viewBox="0 0 28 40" xmlns="http://www.w3.org/2000/svg"><path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.268 21.732 0 14 0z" fill="#2E7D32" stroke="#fff" stroke-width="1.8"/><circle cx="14" cy="13" r="5.5" fill="#fff" opacity="0.9"/></svg>`;
  const markers = airports
    .map(a => {
      const name = a.name.replace(/'/g, "\\'");
      const svg = a.temporary ? tempPinSvg : pinSvg;
      return `L.marker([${a.lat},${a.lon}],{icon:L.divIcon({html:'${svg}',className:'',iconSize:[14,20],iconAnchor:[7,20],popupAnchor:[0,-22]})}).addTo(map).bindPopup('<strong>${a.icao}</strong><br><span style="font-size:11px">${name}</span>');`;
    })
    .join('\n');

  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:100%;height:100%;background:#1a2235}
  #map{position:absolute;top:0;left:0;right:0;bottom:0}
  .leaflet-tile-pane img{-webkit-user-select:none;user-select:none}
  .leaflet-popup-content-wrapper{background:#1A2235;color:#F9FAFB;border-radius:8px;border:1px solid #2A3550}
  .leaflet-popup-tip{background:#1A2235}
  .leaflet-popup-content{margin:8px 12px;font-family:-apple-system,sans-serif;font-size:13px}
  .leaflet-control-attribution{font-size:9px;background:rgba(0,0,0,.4)!important;color:#aaa}
  #layer-switcher{
    position:absolute;bottom:24px;left:50%;transform:translateX(-50%);
    z-index:1000;display:flex;gap:6px;
    background:rgba(15,22,38,.88);border-radius:12px;padding:6px;
    box-shadow:0 4px 16px rgba(0,0,0,.5);
  }
  #layer-switcher button{
    font-family:-apple-system,sans-serif;font-size:11px;font-weight:600;
    color:#9BAAC0;background:transparent;border:none;
    border-radius:8px;padding:6px 10px;cursor:pointer;white-space:nowrap;
    transition:background .15s,color .15s;
  }
  #layer-switcher button.active{background:#2563EB;color:#fff}
</style>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin=""/>
</head>
<body>
<div id="map"></div>
<div id="layer-switcher"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
<script>
window.onload = function() {
  var map = L.map('map', {
    center: [${centerLat}, ${centerLon}],
    zoom: ${zoom},
    zoomControl: false,
    attributionControl: true,
    layers: []
  });

  var layers = {
    'Light':    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', {subdomains:'abcd',maxZoom:19,crossOrigin:true,attribution:'© OpenStreetMap © CARTO'}),
    'Hybrid': L.layerGroup([
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'© Esri'}),
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:''}),
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:''})
    ]),
    'Terrain':   L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {subdomains:'abc',maxZoom:17,crossOrigin:true,attribution:'© OpenStreetMap © OpenTopoMap'}),
  };

  var activeKey = 'Light';
  layers[activeKey].addTo(map);

  // Bygg knappar
  var sw = document.getElementById('layer-switcher');
  Object.keys(layers).forEach(function(key) {
    var btn = document.createElement('button');
    btn.textContent = key;
    if (key === activeKey) btn.className = 'active';
    btn.onclick = function() {
      map.removeLayer(layers[activeKey]);
      activeKey = key;
      layers[activeKey].addTo(map);
      sw.querySelectorAll('button').forEach(function(b){ b.className = ''; });
      btn.className = 'active';
    };
    sw.appendChild(btn);
  });

  setTimeout(function(){ map.invalidateSize(); }, 300);

  ${markers}
};
</script></body></html>`;
}

function buildCountryOverlayHtml(
  visited: AirportPoint[],
  countryAirports: { icao: string; name: string; lat: number; lon: number }[],
  visitedSet: Set<string>,
): string {
  const all = countryAirports;
  const lats = all.map(a => a.lat);
  const lons = all.map(a => a.lon);
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;
  const latSpan = Math.max(...lats) - Math.min(...lats);
  const zoom = latSpan > 20 ? 4 : latSpan > 10 ? 5 : latSpan > 5 ? 6 : 7;

  const pinSvg = `<svg width="14" height="20" viewBox="0 0 28 40" xmlns="http://www.w3.org/2000/svg"><path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.268 21.732 0 14 0z" fill="#D32F2F" stroke="#fff" stroke-width="1.8"/><circle cx="14" cy="13" r="5.5" fill="#fff" opacity="0.9"/></svg>`;

  const unvisitedMarkers = all
    .filter(a => !visitedSet.has(a.icao))
    .map(a => {
      const name = a.name.replace(/'/g, "\\'");
      return `L.circleMarker([${a.lat},${a.lon}],{radius:3,fillColor:'#4f7cff',fillOpacity:0.6,color:'#2563EB',weight:0.5}).addTo(map).bindPopup('<strong>${a.icao}</strong><br><span style="font-size:11px">${name}</span>');`;
    }).join('\n');

  const visitedMarkers = all
    .filter(a => visitedSet.has(a.icao))
    .map(a => {
      const name = a.name.replace(/'/g, "\\'");
      return `L.marker([${a.lat},${a.lon}],{icon:L.divIcon({html:'${pinSvg}',className:'',iconSize:[14,20],iconAnchor:[7,20],popupAnchor:[0,-22]})}).addTo(map).bindPopup('<strong>${a.icao}</strong><br><span style="font-size:11px">${name}</span><br><span style="color:#4CAF50;font-size:10px">✓ Visited</span>');`;
    }).join('\n');

  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:100%;height:100%;background:#1a2235}
  #map{position:absolute;top:0;left:0;right:0;bottom:0}
  .leaflet-popup-content-wrapper{background:#1A2235;color:#F9FAFB;border-radius:8px;border:1px solid #2A3550}
  .leaflet-popup-tip{background:#1A2235}
  .leaflet-popup-content{margin:8px 12px;font-family:-apple-system,sans-serif;font-size:13px}
  .leaflet-control-attribution{font-size:9px;background:rgba(0,0,0,.4)!important;color:#aaa}
  #layer-switcher{position:absolute;bottom:24px;left:50%;transform:translateX(-50%);z-index:1000;display:flex;gap:6px;background:rgba(15,22,38,.88);border-radius:12px;padding:6px;box-shadow:0 4px 16px rgba(0,0,0,.5);}
  #layer-switcher button{font-family:-apple-system,sans-serif;font-size:11px;font-weight:600;color:#9BAAC0;background:transparent;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;}
  #layer-switcher button.active{background:#2563EB;color:#fff}
</style>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin=""/>
</head><body>
<div id="map"></div>
<div id="layer-switcher"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
<script>
window.onload=function(){
  var map=L.map('map',{center:[${centerLat},${centerLon}],zoom:${zoom},zoomControl:false,attributionControl:true});
  var layers={
    'Light':L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',{subdomains:'abcd',maxZoom:19,crossOrigin:true,attribution:'© OSM © CARTO'}),
    'Hybrid':L.layerGroup([L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'© Esri'}),L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:''}),L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:''})]),
    'Terrain':L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',{subdomains:'abc',maxZoom:17,crossOrigin:true,attribution:'© OSM © OpenTopoMap'})
  };
  var ak='Light';layers[ak].addTo(map);
  var sw=document.getElementById('layer-switcher');
  Object.keys(layers).forEach(function(k){var b=document.createElement('button');b.textContent=k;if(k===ak)b.className='active';b.onclick=function(){map.removeLayer(layers[ak]);ak=k;layers[ak].addTo(map);sw.querySelectorAll('button').forEach(function(x){x.className='';});b.className='active';};sw.appendChild(b);});
  setTimeout(function(){map.invalidateSize();},300);
  ${unvisitedMarkers}
  ${visitedMarkers}
};
</script></body></html>`;
}

function buildPinPlacementHtml(placeName: string, centerLat = 59.3, centerLon = 18.0, safeTop = 0): string {
  const pinSvg = `<svg width="28" height="40" viewBox="0 0 28 40" xmlns="http://www.w3.org/2000/svg"><path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 26 14 26s14-15.5 14-26C28 6.268 21.732 0 14 0z" fill="#2E7D32" stroke="#fff" stroke-width="1.8"/><circle cx="14" cy="13" r="5.5" fill="#fff" opacity="0.9"/></svg>`;
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:100%;height:100%;background:#1a2235}
  #map{position:absolute;top:0;left:0;right:0;bottom:0}
  .leaflet-popup-content-wrapper{background:#1A2235;color:#F9FAFB;border-radius:8px;border:1px solid #2A3550}
  .leaflet-popup-tip{background:#1A2235}
  .leaflet-popup-content{margin:8px 12px;font-family:-apple-system,sans-serif;font-size:13px}
  .leaflet-control-attribution{font-size:9px;background:rgba(0,0,0,.4)!important;color:#aaa}
  #layer-switcher{position:absolute;bottom:24px;left:50%;transform:translateX(-50%);z-index:1000;display:flex;gap:6px;background:rgba(15,22,38,.88);border-radius:12px;padding:6px;box-shadow:0 4px 16px rgba(0,0,0,.5);}
  #layer-switcher button{font-family:-apple-system,sans-serif;font-size:11px;font-weight:600;color:#9BAAC0;background:transparent;border:none;border-radius:8px;padding:6px 10px;cursor:pointer;}
  #layer-switcher button.active{background:#2563EB;color:#fff}

</style>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin=""/>
</head><body>
<div id="map"></div>
<div id="layer-switcher"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
<script>
window.onload=function(){
  var map=L.map('map',{center:[${centerLat},${centerLon}],zoom:6,zoomControl:false,attributionControl:true});
  var layers={
    'Light':L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',{subdomains:'abcd',maxZoom:19,crossOrigin:true,attribution:'© OSM © CARTO'}),
    'Hybrid':L.layerGroup([L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'© Esri'}),L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:''}),L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:''})]),
    'Terrain':L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',{subdomains:'abc',maxZoom:17,crossOrigin:true,attribution:'© OSM © OpenTopoMap'})
  };
  var ak='Hybrid';layers[ak].addTo(map);
  var sw=document.getElementById('layer-switcher');
  Object.keys(layers).forEach(function(k){var b=document.createElement('button');b.textContent=k;if(k===ak)b.className='active';b.onclick=function(){map.removeLayer(layers[ak]);ak=k;layers[ak].addTo(map);sw.querySelectorAll('button').forEach(function(x){x.className='';});b.className='active';};sw.appendChild(b);});

  var pinIcon=L.divIcon({html:'${pinSvg.replace(/'/g, "\\'")}',className:'',iconSize:[28,40],iconAnchor:[14,40],popupAnchor:[0,-42]});
  var marker=null;

  function placePin(lat,lon){
    if(marker) map.removeLayer(marker);
    marker=L.marker([lat,lon],{icon:pinIcon,draggable:true}).addTo(map);
    marker.bindPopup('${placeName.replace(/'/g, "\\'")}').openPopup();
    window.ReactNativeWebView.postMessage(JSON.stringify({lat:lat,lon:lon}));
    marker.on('dragend',function(){
      var p=marker.getLatLng();
      window.ReactNativeWebView.postMessage(JSON.stringify({lat:p.lat,lon:p.lng}));
    });
  }

  map.on('click',function(e){ placePin(e.latlng.lat,e.latlng.lng); });

  window.searchFromNative=function(q){
    if(!q) return;
    fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q='+encodeURIComponent(q))
      .then(function(r){return r.json()})
      .then(function(data){
        if(data&&data.length>0){
          var lat=parseFloat(data[0].lat);
          var lon=parseFloat(data[0].lon);
          map.setView([lat,lon],14);
          placePin(lat,lon);
          window.ReactNativeWebView.postMessage(JSON.stringify({lat:lat,lon:lon,searchResult:data[0].display_name.slice(0,60)}));
        } else {
          window.ReactNativeWebView.postMessage(JSON.stringify({searchError:'Inga resultat'}));
        }
      })
      .catch(function(){
        window.ReactNativeWebView.postMessage(JSON.stringify({searchError:'Sökning misslyckades'}));
      });
  };

  setTimeout(function(){map.invalidateSize();},300);
};
</script></body></html>`;
}

function makeStyles() {
  return StyleSheet.create({
    widget: {
      backgroundColor: Colors.card,
      borderRadius: 12,
      padding: 12,
      borderWidth: 1,
      borderColor: Colors.cardBorder,
      marginBottom: 8,
    },

    modal: {
      flex: 1,
      backgroundColor: '#000',
    },
    webview: {
      flex: 1,
    },
    closeBtn: {
      position: 'absolute',
      right: 16,
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(0,0,0,0.65)',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 0.5,
      borderColor: 'rgba(255,255,255,0.2)',
    },
  });
}

export function AirportMapWidget() {
  const styles = makeStyles();
  const { t } = useTranslation();
  const [airports, setAirports] = useState<AirportPoint[]>([]);
  const [allIcaos, setAllIcaos] = useState<string[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const [seedData, setSeedData] = useState<SeedRow[]>([]);
  const [countryList, setCountryList] = useState<{ code: string; name: string; count: number }[]>([]);
  const [unlocated, setUnlocated] = useState<IcaoAirport[]>([]);
  const [placingPlace, setPlacingPlace] = useState<IcaoAirport | null>(null);
  const [placedCoord, setPlacedCoord] = useState<{ lat: number; lon: number } | null>(null);
  const pinWebRef = useRef<WebView>(null);
  const [pinSearch, setPinSearch] = useState('');
  const [pinSearching, setPinSearching] = useState(false);
  const insets = useSafeAreaInsets();
  const { isPremium } = useFlightStore();

  const flightCount = useFlightStore((s) => s.flightCount);

  useEffect(() => {
    getSeedAirports().then(data => { setSeedData(data); setCountryList(buildCountryList(data)); });
  }, []);

  useEffect(() => {
    (async () => {
      const icaos = await getAllVisitedIcaos();
      const tempPlaces = await getAllTemporaryPlaces();
      if (!icaos.length && !tempPlaces.length) {
        setAllIcaos([]);
        setAirports([]);
        return;
      }
      setAllIcaos([...icaos, ...tempPlaces.map(p => p.icao)]);
      const coords = await getAirportCoordinates(icaos);
      const regular = coords.filter(a => a.lat && a.lon).map(a => ({ ...a, temporary: false }));
      const temps = tempPlaces.map(p => ({ icao: p.icao, name: p.name, lat: p.lat, lon: p.lon, temporary: true }));
      setAirports([...regular, ...temps]);
      const unloc = await getUnlocatedTemporaryPlaces();
      setUnlocated(unloc);
    })();
  }, [flightCount]);

  if (!allIcaos.length) return null;

  return (
    <>
      {/* Visited airports — MC1 style */}
      <TouchableOpacity
        style={styles.widget}
        onPress={() => airports.length > 0 && setModalVisible(true)}
        activeOpacity={airports.length > 0 ? 0.75 : 1}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{
            width: 36, height: 36, borderRadius: 8,
            backgroundColor: Colors.info + '22',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Ionicons name="location" size={16} color={Colors.info} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Text style={{
                fontSize: 9, fontWeight: '700', color: Colors.textMuted,
                letterSpacing: 1, fontFamily: 'Menlo',
              }}>VISITED AIRPORTS</Text>
              <Text style={{
                fontSize: 11, fontWeight: '800', color: Colors.info,
                fontFamily: 'Menlo', fontVariant: ['tabular-nums'],
              }}>{allIcaos.length}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
              {allIcaos.slice(0, 6).map(icao => (
                <View key={icao} style={{
                  paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
                  backgroundColor: Colors.info + '15',
                  borderWidth: 1, borderColor: Colors.info + '30',
                }}>
                  <Text style={{
                    fontSize: 10, fontWeight: '700', color: Colors.textPrimary,
                    fontFamily: 'Menlo', letterSpacing: 0.4,
                  }}>{icao}</Text>
                </View>
              ))}
              {allIcaos.length > 6 && (
                <Text style={{
                  fontSize: 10, fontWeight: '700', color: Colors.textMuted,
                  fontFamily: 'Menlo', paddingVertical: 2,
                }}>+{allIcaos.length - 6}</Text>
              )}
            </View>
          </View>
          <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
        </View>
      </TouchableOpacity>

      {/* Unlocated temp places banner */}
      {unlocated.length > 0 && (
        <View style={{
          backgroundColor: Colors.warning + '12', borderRadius: 12,
          borderWidth: 1, borderColor: Colors.warning + '33',
          padding: 12, marginBottom: 8, gap: 8,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Ionicons name="location-outline" size={16} color={Colors.warning} />
            <Text style={{ color: Colors.textPrimary, fontSize: 12, fontWeight: '700', flex: 1 }}>
              {unlocated.length} {unlocated.length === 1 ? 'tillfällig plats' : 'tillfälliga platser'} saknar position
            </Text>
          </View>
          {unlocated.map(p => (
            <TouchableOpacity
              key={p.icao}
              style={{
                flexDirection: 'row', alignItems: 'center', gap: 8,
                backgroundColor: Colors.card, borderRadius: 8, padding: 10,
                borderWidth: 1, borderColor: Colors.cardBorder,
              }}
              onPress={() => { setPlacingPlace(p); setPlacedCoord(null); setPinSearch(p.name || p.icao); }}
              activeOpacity={0.75}
            >
              <View style={{
                width: 28, height: 28, borderRadius: 14,
                backgroundColor: '#2E7D32' + '22', alignItems: 'center', justifyContent: 'center',
              }}>
                <Ionicons name="pin" size={14} color="#2E7D32" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: Colors.textPrimary, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' }}>{p.icao}</Text>
                <Text style={{ color: Colors.textMuted, fontSize: 11 }}>{p.name}</Text>
              </View>
              <Text style={{ color: Colors.primary, fontSize: 11, fontWeight: '600' }}>Placera</Text>
              <Ionicons name="chevron-forward" size={12} color={Colors.textMuted} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Fullskärmskarta med Leaflet */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        onRequestClose={() => { setModalVisible(false); setSelectedCountry(null); setShowCountryPicker(false); }}
      >
        <View style={styles.modal}>
          {(() => {
            const visitedSet = new Set(allIcaos);
            if (selectedCountry) {
              const countryApts = seedData
                .filter(([, , c]) => c === selectedCountry)
                .map(([icao, name, , , lat, lon]) => ({ icao, name, lat, lon }));
              const visitedInCountry = countryApts.filter(a => visitedSet.has(a.icao)).length;
              return (
                <>
                  <WebView
                    style={styles.webview}
                    source={{ html: buildCountryOverlayHtml(airports.filter(a => a.icao !== 'ZZZZ'), countryApts, visitedSet), baseUrl: 'https://tile.openstreetmap.org' }}
                    originWhitelist={['*']}
                    javaScriptEnabled
                    domStorageEnabled
                  />
                  <View style={{
                    position: 'absolute', bottom: 70, left: 16, right: 16,
                    backgroundColor: 'rgba(15,22,38,0.9)', borderRadius: 12, padding: 12,
                    flexDirection: 'row', alignItems: 'center', gap: 8,
                  }}>
                    <Ionicons name="flag" size={16} color={Colors.primary} />
                    <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700', flex: 1 }}>
                      {visitedInCountry}/{countryApts.length} {t('visited_in')} {getCountryName(selectedCountry)}
                    </Text>
                    <TouchableOpacity onPress={() => setSelectedCountry(null)}>
                      <Text style={{ color: Colors.primary, fontSize: 12, fontWeight: '700' }}>{t('clear')}</Text>
                    </TouchableOpacity>
                  </View>
                </>
              );
            }
            return (
              <WebView
                style={styles.webview}
                source={{ html: buildMapHtml(airports.filter(a => a.icao !== 'ZZZZ')), baseUrl: 'https://tile.openstreetmap.org' }}
                originWhitelist={['*']}
                javaScriptEnabled
                domStorageEnabled
                mixedContentMode="always"
                cacheEnabled={false}
              />
            );
          })()}

          {/* Country picker button */}
          <View style={{
            position: 'absolute', top: insets.top + 12, left: 0, right: 0,
            alignItems: 'center', pointerEvents: 'box-none',
          }}>
            <TouchableOpacity
              style={{
                backgroundColor: 'rgba(15,22,38,0.85)', borderRadius: 10,
                paddingHorizontal: 12, paddingVertical: 8,
                flexDirection: 'row', alignItems: 'center', gap: 6,
              }}
              onPress={() => setShowCountryPicker(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="flag-outline" size={14} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
                {selectedCountry ? getCountryName(selectedCountry) : t('select_country')}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Close button */}
          <TouchableOpacity
            style={[styles.closeBtn, { top: insets.top + 12 }]}
            onPress={() => { setModalVisible(false); setSelectedCountry(null); setShowCountryPicker(false); }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="close" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Country picker overlay */}
        {showCountryPicker && (
          <View style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.7)', paddingTop: insets.top + 60,
            paddingHorizontal: 16, paddingBottom: 40,
          }}>
            <View style={{
              flex: 1, backgroundColor: Colors.surface, borderRadius: 16, overflow: 'hidden',
            }}>
              <View style={{
                flexDirection: 'row', alignItems: 'center', gap: 8,
                paddingHorizontal: 14, paddingVertical: 10,
                borderBottomWidth: 0.5, borderBottomColor: Colors.border,
              }}>
                <Ionicons name="search" size={16} color={Colors.textMuted} />
                <TextInput
                  style={{ flex: 1, color: Colors.textPrimary, fontSize: 15, paddingVertical: 6 }}
                  placeholder={t('search_country')}
                  placeholderTextColor={Colors.textMuted}
                  value={countrySearch}
                  onChangeText={setCountrySearch}
                  autoFocus
                />
                <TouchableOpacity onPress={() => { setShowCountryPicker(false); setCountrySearch(''); }}>
                  <Ionicons name="close" size={20} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>
              <FlatList
                data={countryList.filter(c =>
                  c.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
                  c.code.toLowerCase().includes(countrySearch.toLowerCase())
                )}
                keyExtractor={c => c.code}
                renderItem={({ item: c }) => {
                  const visitedCount = seedData
                    .filter(([icao, , cc]) => cc === c.code && allIcaos.includes(icao)).length;
                  return (
                    <TouchableOpacity
                      style={{
                        flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12,
                        borderBottomWidth: 0.5, borderBottomColor: Colors.separator,
                      }}
                      onPress={() => { setSelectedCountry(c.code); setShowCountryPicker(false); setCountrySearch(''); }}
                      activeOpacity={0.7}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: Colors.textPrimary, fontSize: 14, fontWeight: '600' }}>{c.name}</Text>
                        <Text style={{ color: Colors.textMuted, fontSize: 11 }}>{c.code} · {c.count} {t('global_db_airports')?.toLowerCase?.() ?? 'airports'}</Text>
                      </View>
                      {visitedCount > 0 && (
                        <View style={{
                          backgroundColor: Colors.success + '22', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6,
                        }}>
                          <Text style={{ color: Colors.success, fontSize: 11, fontWeight: '700' }}>{visitedCount}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                }}
                keyboardShouldPersistTaps="handled"
              />
            </View>
          </View>
        )}
      </Modal>

      {/* Pin placement modal */}
      <Modal
        visible={!!placingPlace}
        animationType="slide"
        onRequestClose={() => setPlacingPlace(null)}
      >
        <View style={styles.modal}>
          {placingPlace && (
            <WebView
              ref={pinWebRef}
              style={styles.webview}
              source={{ html: buildPinPlacementHtml(
                placingPlace.name || placingPlace.icao,
                airports.length > 0 ? airports[0].lat : 59.3,
                airports.length > 0 ? airports[0].lon : 18.0,
                insets.top,
              ), baseUrl: 'https://tile.openstreetmap.org' }}
              originWhitelist={['*']}
              javaScriptEnabled
              domStorageEnabled
              onMessage={(e) => {
                try {
                  const msg = JSON.parse(e.nativeEvent.data);
                  if (msg.lat !== undefined && msg.lon !== undefined) {
                    setPlacedCoord({ lat: msg.lat, lon: msg.lon });
                  }
                  setPinSearching(false);
                } catch {}
              }}
            />
          )}

          {/* Search + Save bar */}
          <View style={{
            paddingBottom: insets.bottom + 12, paddingTop: 10, paddingHorizontal: 16,
            backgroundColor: 'rgba(10,22,40,0.95)',
            borderTopWidth: 0.5, borderTopColor: 'rgba(255,255,255,0.1)',
            gap: 10,
          }}>
            {/* Search row */}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TextInput
                style={{
                  flex: 1, backgroundColor: 'rgba(255,255,255,0.08)',
                  borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
                  color: '#fff', fontSize: 14, fontWeight: '500',
                  borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
                }}
                value={pinSearch}
                onChangeText={setPinSearch}
                placeholder="Sök plats..."
                placeholderTextColor="rgba(255,255,255,0.4)"
                returnKeyType="search"
                autoCorrect={false}
                onSubmitEditing={() => {
                  if (!pinSearch.trim() || !pinWebRef.current) return;
                  setPinSearching(true);
                  pinWebRef.current.injectJavaScript(`window.searchFromNative(${JSON.stringify(pinSearch.trim())});true;`);
                }}
              />
              <TouchableOpacity
                style={{
                  backgroundColor: '#2E7D32', borderRadius: 10,
                  paddingHorizontal: 14, justifyContent: 'center',
                }}
                onPress={() => {
                  if (!pinSearch.trim() || !pinWebRef.current) return;
                  setPinSearching(true);
                  pinWebRef.current.injectJavaScript(`window.searchFromNative(${JSON.stringify(pinSearch.trim())});true;`);
                }}
              >
                <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>
                  {pinSearching ? '...' : 'Sök'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Buttons row */}
            <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity
              style={{
                flex: 1, paddingVertical: 13, borderRadius: 10, alignItems: 'center',
                borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.elevated,
              }}
              onPress={() => { setPlacingPlace(null); setPlacedCoord(null); }}
            >
              <Text style={{ color: Colors.textSecondary, fontSize: 14, fontWeight: '600' }}>Avbryt</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{
                flex: 2, paddingVertical: 13, borderRadius: 10, alignItems: 'center',
                backgroundColor: placedCoord ? '#2E7D32' : Colors.textMuted,
                flexDirection: 'row', justifyContent: 'center', gap: 6,
              }}
              disabled={!placedCoord}
              onPress={async () => {
                if (!placingPlace || !placedCoord) return;
                await updateUserAirport(placingPlace.icao, placingPlace.name, placedCoord.lat, placedCoord.lon);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                setUnlocated(prev => prev.filter(p => p.icao !== placingPlace.icao));
                setAirports(prev => [...prev, {
                  icao: placingPlace.icao, name: placingPlace.name,
                  lat: placedCoord.lat, lon: placedCoord.lon, temporary: true,
                }]);
                setPlacingPlace(null);
                setPlacedCoord(null);
              }}
              activeOpacity={0.85}
            >
              <Ionicons name="checkmark-circle" size={18} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Spara position</Text>
            </TouchableOpacity>
            </View>
          </View>

          {/* Close button */}
          <TouchableOpacity
            style={[styles.closeBtn, { top: insets.top + 12 }]}
            onPress={() => { setPlacingPlace(null); setPlacedCoord(null); }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="close" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

