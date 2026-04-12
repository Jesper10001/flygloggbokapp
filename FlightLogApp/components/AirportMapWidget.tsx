import { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { getVisitedAirportIcaos } from '../db/flights';
import { getAirportCoordinates } from '../db/icao';
import { Colors } from '../constants/colors';

type AirportPoint = { icao: string; name: string; lat: number; lon: number };

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

  const markers = airports
    .map(a => `L.circleMarker([${a.lat},${a.lon}],{radius:7,fillColor:'#2563EB',color:'#fff',weight:1.5,opacity:1,fillOpacity:.9}).addTo(map).bindPopup('<strong>${a.icao}</strong><br><span style="font-size:11px">${a.name.replace(/'/g, "\\'")}</span>');`)
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
    zoomControl: true,
    attributionControl: true,
    layers: []
  });

  var layers = {
    'Mörk':      L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {subdomains:'abcd',maxZoom:19,crossOrigin:true,attribution:'© OpenStreetMap © CARTO'}),
    'Satellit':  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {maxZoom:19,attribution:'© Esri'}),
    'Terrängkarta': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {subdomains:'abc',maxZoom:17,crossOrigin:true,attribution:'© OpenStreetMap © OpenTopoMap'}),
  };

  var activeKey = 'Mörk';
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

export function AirportMapWidget() {
  const [airports, setAirports] = useState<AirportPoint[]>([]);
  const [allIcaos, setAllIcaos] = useState<string[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    (async () => {
      const icaos = await getAllVisitedIcaos();
      if (!icaos.length) return;
      setAllIcaos(icaos);
      const coords = await getAirportCoordinates(icaos);
      setAirports(coords.filter(a => a.lat && a.lon));
    })();
  }, []);

  if (!allIcaos.length) return null;

  return (
    <>
      {/* Mini-widget — klickbar förhandvisning */}
      <TouchableOpacity
        style={styles.widget}
        onPress={() => airports.length > 0 && setModalVisible(true)}
        activeOpacity={airports.length > 0 ? 0.85 : 1}
      >
        <View style={styles.widgetHeader}>
          <Ionicons name="map-outline" size={14} color={Colors.primary} />
          <Text style={styles.widgetTitle}>Besökta flygplatser</Text>
          <Text style={styles.widgetCount}>{allIcaos.length} st</Text>
          <Ionicons name="expand-outline" size={14} color={Colors.textMuted} />
        </View>
        <View style={styles.airportGrid}>
          {allIcaos.slice(0, 8).map(icao => (
            <View key={icao} style={styles.airportChip}>
              <Text style={styles.airportCode}>{icao}</Text>
            </View>
          ))}
          {allIcaos.length > 8 && (
            <View style={styles.airportChip}>
              <Text style={styles.airportCode}>+{allIcaos.length - 8}</Text>
            </View>
          )}
        </View>
        <View style={styles.mapPreviewHint}>
          <Ionicons name="globe-outline" size={12} color={Colors.textMuted} />
          <Text style={styles.mapPreviewHintText}>
            {airports.length > 0
              ? `Tryck för att visa karta (${airports.length} med koordinater)`
              : 'Karta kräver kända koordinater — lägg till via Hantera flygplatser'}
          </Text>
        </View>
      </TouchableOpacity>

      {/* Fullskärmskarta med Leaflet */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modal}>
          {/* Karta tar hela skärmen */}
          <WebView
            style={styles.webview}
            source={{ html: buildMapHtml(airports), baseUrl: 'https://tile.openstreetmap.org' }}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            mixedContentMode="always"
            cacheEnabled={false}
          />
          {/* Stäng-knapp som overlay i övre högra hörnet, under statusbar */}
          <TouchableOpacity
            style={[styles.closeBtn, { top: insets.top + 12 }]}
            onPress={() => setModalVisible(false)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="close" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  widget: {
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    gap: 10,
  },
  widgetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  widgetTitle: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  widgetCount: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  airportGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  airportChip: {
    backgroundColor: Colors.elevated,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  airportCode: {
    color: Colors.textPrimary,
    fontSize: 12,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  mapPreviewHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  mapPreviewHintText: {
    color: Colors.textMuted,
    fontSize: 11,
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
