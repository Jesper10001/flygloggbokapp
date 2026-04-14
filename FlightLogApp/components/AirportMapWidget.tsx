import { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { getVisitedAirportIcaos } from '../db/flights';
import { getAirportCoordinates, getAllTemporaryPlaces } from '../db/icao';
import { Colors } from '../constants/colors';
import { useTranslation } from '../hooks/useTranslation';
import { useFlightStore } from '../store/flightStore';

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
  const heliSvg = `<svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="2" y="10" width="13" height="5" rx="2.5" fill="#1565C0"/><rect x="11" y="12" width="10" height="2" rx="1" fill="#1565C0"/><rect x="1" y="9" width="14" height="2" rx="1" fill="#42A5F5"/><circle cx="5" cy="17" r="1.5" fill="#1565C0"/><circle cx="15" cy="17" r="1.5" fill="#1565C0"/><rect x="4.5" y="14" width="1" height="3" fill="#1565C0"/><rect x="14.5" y="14" width="1" height="3" fill="#1565C0"/><circle cx="12" cy="7" r="5" fill="none" stroke="#42A5F5" stroke-width="1.2"/><line x1="7" y1="7" x2="17" y2="7" stroke="#42A5F5" stroke-width="1.5"/></svg>`;
  const markers = airports
    .map(a => {
      const name = a.name.replace(/'/g, "\\'");
      const svg = a.temporary ? heliSvg : pinSvg;
      const size = a.temporary ? '[20,20]' : '[14,20]';
      const anchor = a.temporary ? '[10,10]' : '[7,20]';
      const popupAnchor = a.temporary ? '[0,-12]' : '[0,-22]';
      return `L.marker([${a.lat},${a.lon}],{icon:L.divIcon({html:'${svg}',className:'',iconSize:${size},iconAnchor:${anchor},popupAnchor:${popupAnchor}})}).addTo(map).bindPopup('<strong>${a.icao}</strong><br><span style="font-size:11px">${name}</span>');`;
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
    zoomControl: true,
    attributionControl: true,
    layers: []
  });

  var layers = {
    'Light':    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png', {subdomains:'abcd',maxZoom:19,crossOrigin:true,attribution:'© OpenStreetMap © CARTO'}),
    'Satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {maxZoom:19,attribution:'© Esri'}),
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

function makeStyles() {
  return StyleSheet.create({
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
}

export function AirportMapWidget() {
  const styles = makeStyles();
  const { t } = useTranslation();
  const [airports, setAirports] = useState<AirportPoint[]>([]);
  const [allIcaos, setAllIcaos] = useState<string[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const insets = useSafeAreaInsets();

  const flightCount = useFlightStore((s) => s.flightCount);

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
    })();
  }, [flightCount]);

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
          <Text style={styles.widgetTitle}>{t('visited_airports')}</Text>
          <Text style={styles.widgetCount}>{allIcaos.length}</Text>
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
              ? `${t('tap_to_show_map_with_count')} (${airports.length})`
              : t('map_requires_coordinates')}
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

