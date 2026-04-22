import { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet, TextInput, FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { getVisitedAirportIcaos } from '../db/flights';
import { getAirportCoordinates, getAllTemporaryPlaces } from '../db/icao';
import { SEED_AIRPORTS } from '../db/seedAirports';
import { Colors } from '../constants/colors';
import { useTranslation } from '../hooks/useTranslation';
import { useFlightStore } from '../store/flightStore';

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

const countryList = (() => {
  const map = new Map<string, number>();
  for (const [, , country] of SEED_AIRPORTS) {
    map.set(country, (map.get(country) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([code, count]) => ({ code, name: getCountryName(code), count }))
    .sort((a, b) => a.name.localeCompare(b.name));
})();

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
  var map=L.map('map',{center:[${centerLat},${centerLon}],zoom:${zoom},zoomControl:true,attributionControl:true});
  var layers={
    'Light':L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',{subdomains:'abcd',maxZoom:19,crossOrigin:true,attribution:'© OSM © CARTO'}),
    'Satellite':L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'© Esri'}),
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
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');
  const insets = useSafeAreaInsets();
  const { isPremium } = useFlightStore();

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
        onRequestClose={() => { setModalVisible(false); setSelectedCountry(null); setShowCountryPicker(false); }}
      >
        <View style={styles.modal}>
          {(() => {
            const visitedSet = new Set(allIcaos);
            if (selectedCountry) {
              const countryApts = SEED_AIRPORTS
                .filter(([, , c]) => c === selectedCountry)
                .map(([icao, name, , , lat, lon]) => ({ icao, name, lat, lon }));
              const visitedInCountry = countryApts.filter(a => visitedSet.has(a.icao)).length;
              return (
                <>
                  <WebView
                    style={styles.webview}
                    source={{ html: buildCountryOverlayHtml(airports, countryApts, visitedSet), baseUrl: 'https://tile.openstreetmap.org' }}
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
                source={{ html: buildMapHtml(airports), baseUrl: 'https://tile.openstreetmap.org' }}
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
                  const visitedCount = SEED_AIRPORTS
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
    </>
  );
}

