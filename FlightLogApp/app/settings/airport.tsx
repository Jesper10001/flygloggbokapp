import { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert, TextInput, Modal,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { searchAirports, addCustomAirport, deleteCustomAirport, deleteTemporaryPlace, renameCustomAirport, updateUserAirport, getAllUserAirports } from '../../db/icao';
import { SEED_AIRPORTS } from '../../db/seedAirports';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { useFlightStore } from '../../store/flightStore';
import { PremiumModal } from '../../components/PremiumModal';
import type { IcaoAirport } from '../../types/flight';

const EMPTY = { icao: '', name: '', country: '', region: '', lat: '', lon: '' };

function buildGlobalMapHtml(airports: [string, string, string, string, number, number][]): string {
  const pts = airports.map(([icao, name, , , lat, lon]) =>
    `[${lat},${lon},"${icao}","${name.replace(/"/g, '\\"')}"]`
  ).join(',');

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
  }
  #layer-switcher button.active{background:#2563EB;color:#fff}
</style>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin=""/>
</head><body>
<div id="map"></div>
<div id="layer-switcher"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
<script>
window.onload=function(){
  var map=L.map('map',{center:[30,0],zoom:2,zoomControl:true,attributionControl:true});
  var layers={
    'Light':L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',{subdomains:'abcd',maxZoom:19,crossOrigin:true,attribution:'© OSM © CARTO'}),
    'Satellite':L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'© Esri'}),
    'Dark':L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',{subdomains:'abcd',maxZoom:19,crossOrigin:true,attribution:'© OSM © CARTO'})
  };
  var ak='Light';layers[ak].addTo(map);
  var sw=document.getElementById('layer-switcher');
  Object.keys(layers).forEach(function(k){
    var b=document.createElement('button');b.textContent=k;
    if(k===ak)b.className='active';
    b.onclick=function(){map.removeLayer(layers[ak]);ak=k;layers[ak].addTo(map);
      sw.querySelectorAll('button').forEach(function(x){x.className='';});b.className='active';};
    sw.appendChild(b);
  });
  var pts=[${pts}];
  pts.forEach(function(p){
    L.circleMarker([p[0],p[1]],{radius:2,fillColor:'#4f7cff',fillOpacity:0.7,color:'#2563EB',weight:0.4})
      .addTo(map).bindPopup('<strong>'+p[2]+'</strong><br><span style="font-size:11px">'+p[3]+'</span>');
  });
  setTimeout(function(){map.invalidateSize();},300);
};
</script></body></html>`;
}

// ── Mini-karta ────────────────────────────────────────────────────────────────

function buildMapHtml(lat: number, lon: number, name: string, icao: string): string {
  const safeName = name.replace(/'/g, "\\'").replace(/`/g, '\\`');
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html, body, #map { width:100%; height:100%; background:#f5f5f5; }
  #layer-switcher {
    position:absolute; top:10px; right:10px; z-index:1000;
    display:flex; gap:4px;
  }
  #layer-switcher button {
    background:rgba(30,30,40,0.85); color:#fff; border:none;
    border-radius:6px; padding:5px 10px; font-size:12px; font-weight:600;
    cursor:pointer; backdrop-filter:blur(4px);
  }
  #layer-switcher button.active { background:#4f7cff; }
</style>
</head>
<body>
<div id="map"></div>
<div id="layer-switcher"></div>
<script>
window.onload = function() {
  var map = L.map('map', { zoomControl:true, attributionControl:false }).setView([${lat},${lon}], 12);

  var layers = {
    'Light':     L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',{subdomains:'abcd',maxZoom:19,crossOrigin:true}),
    'Satellite': L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19}),
    'Terrain':   L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',{subdomains:'abc',maxZoom:17,crossOrigin:true}),
  };

  var activeKey = 'Light';
  layers[activeKey].addTo(map);

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

  var icon = L.divIcon({
    html: '<div style="font-size:24px;line-height:1;filter:drop-shadow(0 1px 4px rgba(0,0,0,0.7))">✈</div>',
    iconSize:[24,24], iconAnchor:[12,12], className:''
  });
  L.marker([${lat},${lon}], { icon }).addTo(map)
    .bindPopup('<b>${icao}</b><br>${safeName}').openPopup();

  setTimeout(function(){ map.invalidateSize(); }, 200);
};
</script>
</body>
</html>`;
}

// ── Stilar ────────────────────────────────────────────────────────────────────

function makeStyles() {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    content: { padding: 16, paddingBottom: 40, gap: 10 },
    subtitle: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
    hint: { color: Colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: -4 },

    searchRow: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: Colors.card, borderRadius: 10,
      paddingHorizontal: 12, borderWidth: 1, borderColor: Colors.border, gap: 8,
    },
    searchInput: { flex: 1, color: Colors.textPrimary, fontSize: 15, paddingVertical: 10 },

    airportRow: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: Colors.card, borderRadius: 10, padding: 12,
      borderWidth: 1, borderColor: Colors.cardBorder, gap: 8,
    },
    airportLeft: { flex: 1, gap: 1 },
    airportIcao: {
      color: Colors.textPrimary, fontSize: 15, fontWeight: '800',
      letterSpacing: 1, fontFamily: 'Menlo',
    },
    airportName: { color: Colors.textSecondary, fontSize: 12 },
    airportCountry: { color: Colors.textMuted, fontSize: 11 },
    airportRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },

    badge: {
      backgroundColor: Colors.separator, borderRadius: 4,
      paddingHorizontal: 6, paddingVertical: 2,
    },
    badgeCustom: { backgroundColor: Colors.primary + '33' },
    badgeTemporary: { backgroundColor: Colors.textMuted + '33' },
    badgeText: { color: Colors.textMuted, fontSize: 10, fontWeight: '600' },

    empty: { alignItems: 'center', gap: 8, paddingVertical: 24 },
    emptyText: { color: Colors.textMuted, fontSize: 13, textAlign: 'center' },

    addBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: Colors.accent, borderRadius: 10, paddingVertical: 12, gap: 6,
      marginTop: 4,
    },
    addBtnText: { color: Colors.textInverse, fontSize: 15, fontWeight: '700' },

    form: {
      backgroundColor: Colors.card, borderRadius: 12, padding: 16,
      gap: 10, borderWidth: 1, borderColor: Colors.cardBorder,
    },
    formTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700', marginBottom: 4 },
    formField: { gap: 4 },
    formLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
    formInput: {
      backgroundColor: Colors.elevated, borderRadius: 8,
      borderWidth: 1, borderColor: Colors.border,
      color: Colors.textPrimary, fontSize: 14,
      paddingHorizontal: 10, paddingVertical: 9,
    },
    saveBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 12, gap: 6, marginTop: 4,
    },
    saveBtnText: { color: Colors.textInverse, fontSize: 14, fontWeight: '700' },
  });
}

function makeDetailStyles() {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },

    header: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingHorizontal: 16, paddingVertical: 12,
      borderBottomWidth: 0.5, borderBottomColor: Colors.border,
    },
    closeBtn: { padding: 4 },
    icao: {
      color: Colors.textPrimary, fontSize: 22, fontWeight: '900',
      letterSpacing: 2, fontFamily: 'Menlo',
    },
    name: { color: Colors.textSecondary, fontSize: 13, marginTop: 1 },
    badges: { flexDirection: 'row', gap: 6 },
    badge: {
      borderRadius: 4, paddingHorizontal: 7, paddingVertical: 3,
      backgroundColor: Colors.separator,
    },
    badgeCustom: { backgroundColor: Colors.primary + '33' },
    badgeTemporary: { backgroundColor: Colors.textMuted + '33' },
    badgeText: { color: Colors.textMuted, fontSize: 10, fontWeight: '700' },

    mapContainer: { height: 260, backgroundColor: Colors.elevated },
    noMap: {
      height: 120, alignItems: 'center', justifyContent: 'center',
      gap: 8, backgroundColor: Colors.elevated,
      borderBottomWidth: 0.5, borderBottomColor: Colors.border,
    },
    noMapText: { color: Colors.textMuted, fontSize: 13 },

    info: { flex: 1 },
    infoRow: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 16, paddingVertical: 13,
      borderBottomWidth: 0.5, borderBottomColor: Colors.separator,
    },
    infoLabel: {
      width: 90, color: Colors.textSecondary, fontSize: 12,
      fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5,
    },
    infoValue: { flex: 1, color: Colors.textPrimary, fontSize: 15 },
    infoMono: { fontFamily: 'Menlo', letterSpacing: 0.5 },

    renameBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 8, marginHorizontal: 16, marginTop: 16, paddingVertical: 13, borderRadius: 10,
      backgroundColor: Colors.primary + '18',
      borderWidth: 1, borderColor: Colors.primary + '44',
    },
    renameBtnText: { color: Colors.primary, fontSize: 14, fontWeight: '700' },
    deleteBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      gap: 8, marginHorizontal: 16, marginTop: 10, marginBottom: 16, paddingVertical: 13, borderRadius: 10,
      backgroundColor: Colors.danger + '18',
      borderWidth: 1, borderColor: Colors.danger + '44',
    },
    deleteBtnText: { color: Colors.danger, fontSize: 14, fontWeight: '700' },

    editForm: {
      marginHorizontal: 16, marginTop: 16, gap: 6,
    },
    editLabel: {
      color: Colors.textSecondary, fontSize: 11, fontWeight: '700',
      textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 4,
    },
    editInput: {
      backgroundColor: Colors.elevated, borderRadius: 8,
      borderWidth: 1, borderColor: Colors.border,
      color: Colors.textPrimary, fontSize: 14,
      paddingHorizontal: 10, paddingVertical: 10,
    },
    saveEditBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      paddingVertical: 12, borderRadius: 10,
      backgroundColor: Colors.primary,
    },
    saveEditBtnText: { color: Colors.textInverse, fontSize: 14, fontWeight: '700' },
  });
}

// ── Detaljmodal ───────────────────────────────────────────────────────────────

function AirportDetailModal({
  airport,
  onClose,
  onDelete,
  onUpdate,
}: {
  airport: IcaoAirport;
  onClose: () => void;
  onDelete: (a: IcaoAirport) => void;
  onUpdate: (a: IcaoAirport, name: string, lat: number, lon: number) => void;
}) {
  const detailStyles = makeDetailStyles();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const hasCoords = airport.lat && airport.lon && !(airport.lat === 0 && airport.lon === 0);
  const isTemporary = airport.temporary === 1;
  const editable = !!airport.custom || isTemporary;
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(airport.name);
  const [editLat, setEditLat] = useState(String(airport.lat || ''));
  const [editLon, setEditLon] = useState(String(airport.lon || ''));

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[detailStyles.container, { paddingTop: insets.top }]}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Rubrikrad */}
        <View style={detailStyles.header}>
          <TouchableOpacity onPress={onClose} style={detailStyles.closeBtn}>
            <Ionicons name="chevron-down" size={22} color={Colors.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={detailStyles.icao}>{airport.icao}</Text>
            <Text style={detailStyles.name} numberOfLines={1}>{airport.name}</Text>
          </View>
          <View style={detailStyles.badges}>
            {isTemporary && (
              <View style={[detailStyles.badge, detailStyles.badgeTemporary]}>
                <Text style={detailStyles.badgeText}>{t('temporary_badge')}</Text>
              </View>
            )}
            {!!airport.custom && !isTemporary && (
              <View style={[detailStyles.badge, detailStyles.badgeCustom]}>
                <Text style={detailStyles.badgeText}>{t('custom_badge')}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Karta */}
        {hasCoords && !isTemporary ? (
          <View style={detailStyles.mapContainer}>
            <WebView
              source={{ html: buildMapHtml(airport.lat, airport.lon, airport.name, airport.icao), baseUrl: 'https://tile.openstreetmap.org' }}
              style={{ flex: 1 }}
              scrollEnabled={false}
              originWhitelist={['*']}
            />
          </View>
        ) : (
          <View style={detailStyles.noMap}>
            <Ionicons name="map-outline" size={40} color={Colors.textMuted} />
            <Text style={detailStyles.noMapText}>
              {isTemporary ? t('temporary_no_map') : t('coordinates_missing')}
            </Text>
          </View>
        )}

        {/* Info */}
        <ScrollView style={detailStyles.info} contentContainerStyle={{ gap: 0 }}>
          <InfoRow label={t('icao_label')} value={airport.icao} mono />
          <InfoRow label={t('airport_name_label').replace(' *', '')} value={airport.name} />
          <InfoRow label={t('country_label')} value={airport.country || '–'} />
          <InfoRow label={t('region_label').replace(' (2 chars.)', '')} value={airport.region || '–'} />
          {hasCoords && !isTemporary ? (
            <>
              <InfoRow label={t('latitude_label')} value={airport.lat.toFixed(4)} mono />
              <InfoRow label={t('longitude_label')} value={airport.lon.toFixed(4)} mono />
            </>
          ) : null}

          {/* Redigera / Radera — gäller custom och tillfälliga platser */}
          {editable && !editing && (
            <>
              <TouchableOpacity
                style={detailStyles.renameBtn}
                onPress={() => {
                  setEditName(airport.name);
                  setEditLat(String(airport.lat || ''));
                  setEditLon(String(airport.lon || ''));
                  setEditing(true);
                }}
                activeOpacity={0.8}
              >
                <Ionicons name="create-outline" size={16} color={Colors.primary} />
                <Text style={detailStyles.renameBtnText}>{t('edit')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={detailStyles.deleteBtn}
                onPress={() => onDelete(airport)}
                activeOpacity={0.8}
              >
                <Ionicons name="trash-outline" size={16} color={Colors.danger} />
                <Text style={detailStyles.deleteBtnText}>{t('delete_from_database')}</Text>
              </TouchableOpacity>
            </>
          )}

          {editable && editing && (
            <View style={detailStyles.editForm}>
              <Text style={detailStyles.editLabel}>{t('airport_name_label').replace(' *', '')}</Text>
              <TextInput
                style={detailStyles.editInput}
                value={editName}
                onChangeText={setEditName}
                placeholder={airport.name}
                placeholderTextColor={Colors.textMuted}
              />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <View style={{ flex: 1 }}>
                  <Text style={detailStyles.editLabel}>{t('latitude_label')}</Text>
                  <TextInput
                    style={detailStyles.editInput}
                    value={editLat}
                    onChangeText={setEditLat}
                    placeholder="59.6519"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={detailStyles.editLabel}>{t('longitude_label')}</Text>
                  <TextInput
                    style={detailStyles.editInput}
                    value={editLon}
                    onChangeText={setEditLon}
                    placeholder="17.9186"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
                <TouchableOpacity
                  style={[detailStyles.renameBtn, { flex: 1, marginTop: 0 }]}
                  onPress={() => setEditing(false)}
                  activeOpacity={0.8}
                >
                  <Text style={detailStyles.renameBtnText}>{t('cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[detailStyles.saveEditBtn, { flex: 1 }]}
                  onPress={() => {
                    const name = editName.trim() || airport.name;
                    const lat = parseFloat(editLat.replace(',', '.')) || 0;
                    const lon = parseFloat(editLon.replace(',', '.')) || 0;
                    onUpdate(airport, name, lat, lon);
                    setEditing(false);
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="checkmark-circle" size={16} color={Colors.textInverse} />
                  <Text style={detailStyles.saveEditBtnText}>{t('save')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={detailStyles.infoRow}>
      <Text style={detailStyles.infoLabel}>{label}</Text>
      <Text style={[detailStyles.infoValue, mono && detailStyles.infoMono]}>{value}</Text>
    </View>
  );
}

// ── Huvudskärm ────────────────────────────────────────────────────────────────

// Country index from seed data
const countryIndex = (() => {
  const map = new Map<string, number>();
  for (const [, , country] of SEED_AIRPORTS) {
    map.set(country, (map.get(country) ?? 0) + 1);
  }
  return Array.from(map.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);
})();

function getPreviewForCountry(countryCode: string, limit = 10) {
  const all = SEED_AIRPORTS.filter(([, , c]) => c === countryCode);
  return {
    sample: all.slice(0, limit),
    total: all.length,
    remaining: Math.max(0, all.length - limit),
  };
}

export default function AirportScreen() {
  const { t } = useTranslation();
  const { isPremium } = useFlightStore();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<IcaoAirport[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<IcaoAirport | null>(null);
  const [tab, setTab] = useState<'custom' | 'temporary' | 'global'>('global');
  const [showPremium, setShowPremium] = useState(false);
  const [globalQuery, setGlobalQuery] = useState('');
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [showGlobalMap, setShowGlobalMap] = useState(false);

  useEffect(() => {
    if (query.length >= 2) {
      searchAirports(query).then((r) => setResults(
        r.filter((a) => tab === 'temporary' ? a.temporary === 1 : (!!a.custom && a.temporary !== 1))
      ));
    } else {
      // Full lista utan LIMIT så att stora mängder platser inte trunkeras
      getAllUserAirports().then((r) => setResults(
        r.filter((a) => tab === 'temporary' ? a.temporary === 1 : (!!a.custom && a.temporary !== 1))
      ));
    }
  }, [query, tab]);

  const handleAdd = async () => {
    if (!form.icao || form.icao.length !== 4) {
      Alert.alert(t('error'), t('error_icao_4'));
      return;
    }
    if (!form.name.trim()) {
      Alert.alert(t('error'), t('error_name_required'));
      return;
    }
    await addCustomAirport({
      icao: form.icao.toUpperCase(),
      name: form.name,
      country: form.country || 'Unknown',
      region: form.region || form.icao.slice(0, 2).toUpperCase(),
      lat: parseFloat(form.lat) || 0,
      lon: parseFloat(form.lon) || 0,
    });
    setForm(EMPTY);
    setShowForm(false);
    getAllUserAirports().then((r) => setResults(r.filter((a) => !!a.custom && a.temporary !== 1)));
    Alert.alert(t('added'), `${form.icao.toUpperCase()} ${t('has_been_added')}`);
  };

  const handleDelete = (airport: IcaoAirport) => {
    Alert.alert(t('delete'), `Delete ${airport.icao} — ${airport.name}?`, [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'), style: 'destructive',
        onPress: async () => {
          if (airport.temporary === 1) {
            await deleteTemporaryPlace(airport.icao);
          } else {
            await deleteCustomAirport(airport.icao);
          }
          setResults((prev) => prev.filter((a) => a.icao !== airport.icao));
          setSelected(null);
        },
      },
    ]);
  };

  const handleUpdate = async (airport: IcaoAirport, name: string, lat: number, lon: number) => {
    await updateUserAirport(airport.icao, name, lat, lon);
    setResults((prev) => prev.map((a) => a.icao === airport.icao ? { ...a, name, lat, lon } : a));
    setSelected({ ...airport, name, lat, lon });
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: Colors.background }}
      behavior={Platform.OS === 'android' ? 'height' : undefined}
    >
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        <Text style={styles.subtitle}>{t('airport_subtitle')}</Text>

        {/* Flik-växlare */}
        <View style={styles.tabRow}>
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'global' && styles.tabBtnActive]}
            onPress={() => setTab('global')}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabBtnText, tab === 'global' && styles.tabBtnTextActive]}>
              {t('global_database')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'custom' && styles.tabBtnActive]}
            onPress={() => setTab('custom')}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabBtnText, tab === 'custom' && styles.tabBtnTextActive]}>
              {t('custom_badge')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, tab === 'temporary' && styles.tabBtnActive]}
            onPress={() => setTab('temporary')}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabBtnText, tab === 'temporary' && styles.tabBtnTextActive]}>
              {t('temporary_badge')}
            </Text>
          </TouchableOpacity>
        </View>

        {/* ── Global tab ── */}
        {tab === 'global' && (
          <>
            <View style={styles.globalHeader}>
              <Ionicons name="globe" size={20} color={Colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.globalTitle}>{t('global_db_title')}</Text>
                <Text style={styles.globalSub}>
                  {SEED_AIRPORTS.length.toLocaleString()} {t('global_db_airports')} · {countryIndex.length} {t('global_db_countries')}
                </Text>
              </View>
              {isPremium ? (
                <View style={[styles.badge, styles.badgeCustom]}>
                  <Text style={[styles.badgeText, { color: Colors.primary }]}>{t('prem_active')}</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.unlockBtn}
                  onPress={() => setShowPremium(true)}
                  activeOpacity={0.8}
                >
                  <Ionicons name="lock-open" size={12} color={Colors.gold} />
                  <Text style={styles.unlockBtnText}>{t('global_db_unlock')}</Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Global map card */}
            <TouchableOpacity
              style={styles.globalHeader}
              onPress={() => setShowGlobalMap(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="map" size={20} color={Colors.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.globalTitle}>{t('global_map_title')}</Text>
                <Text style={styles.globalSub}>{t('global_map_sub')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
            </TouchableOpacity>

            <View style={styles.searchRow}>
              <Ionicons name="search" size={16} color={Colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder={t('global_db_search')}
                placeholderTextColor={Colors.textMuted}
                value={globalQuery}
                onChangeText={setGlobalQuery}
                autoCapitalize="characters"
              />
              {globalQuery.length > 0 && (
                <TouchableOpacity onPress={() => { setGlobalQuery(''); setSelectedCountry(null); }}>
                  <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            {(() => {
              const q = globalQuery.toUpperCase().trim();
              const filtered = q
                ? countryIndex.filter(c => c.code.toUpperCase().includes(q))
                : countryIndex;

              if (selectedCountry) {
                const preview = getPreviewForCountry(selectedCountry);
                return (
                  <>
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4 }}
                      onPress={() => setSelectedCountry(null)}
                    >
                      <Ionicons name="chevron-back" size={14} color={Colors.primary} />
                      <Text style={{ color: Colors.primary, fontSize: 13, fontWeight: '700' }}>{t('global_db_all_countries')}</Text>
                    </TouchableOpacity>
                    <Text style={{ color: Colors.textPrimary, fontSize: 16, fontWeight: '800' }}>
                      {selectedCountry} — {preview.total} {t('global_db_airports').toLowerCase()}
                    </Text>
                    {preview.sample.map(([icao, name, , region, lat, lon]) => (
                      <View key={icao} style={styles.airportRow}>
                        <View style={styles.airportLeft}>
                          <Text style={styles.airportIcao}>{icao}</Text>
                          <Text style={styles.airportName}>{name}</Text>
                          <Text style={styles.airportCountry}>{lat.toFixed(2)}, {lon.toFixed(2)}</Text>
                        </View>
                      </View>
                    ))}
                    {preview.remaining > 0 && (
                      <View style={styles.moreCard}>
                        <Ionicons name={isPremium ? 'checkmark-circle' : 'lock-closed'} size={16} color={isPremium ? Colors.success : Colors.gold} />
                        <Text style={styles.moreText}>
                          {isPremium
                            ? `${preview.total} ${t('global_db_airports').toLowerCase()} ${t('global_db_available')}`
                            : `${t('global_db_and')} ${preview.remaining} ${t('global_db_more')}`}
                        </Text>
                        {!isPremium && (
                          <TouchableOpacity onPress={() => setShowPremium(true)}>
                            <Text style={styles.moreUnlock}>{t('global_db_unlock')}</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    )}
                  </>
                );
              }

              const FEATURED = ['US', 'BR', 'AU', 'DE', 'ZA', 'JP'];
              const isSearching = q.length > 0;
              const shown = isSearching ? filtered.slice(0, 30) : filtered.filter(c => FEATURED.includes(c.code));
              const remaining = isSearching ? 0 : filtered.length - shown.length;

              return (
                <>
                  {shown.map(c => (
                    <TouchableOpacity
                      key={c.code}
                      style={styles.airportRow}
                      onPress={() => setSelectedCountry(c.code)}
                      activeOpacity={0.75}
                    >
                      <View style={styles.airportLeft}>
                        <Text style={styles.airportIcao}>{c.code}</Text>
                        <Text style={styles.airportName}>
                          {c.count.toLocaleString()} {t('global_db_airports').toLowerCase()}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
                    </TouchableOpacity>
                  ))}
                  {remaining > 0 && (
                    <Text style={{ color: Colors.textMuted, fontSize: 12, textAlign: 'center', paddingVertical: 8 }}>
                      {t('global_db_and')} {remaining} {t('global_db_more_countries')}
                    </Text>
                  )}
                </>
              );
            })()}
          </>
        )}

        {/* ── Custom/Temporary tabs ── */}
        {tab !== 'global' && (
        <>
        {/* Sök */}
        <View style={styles.searchRow}>
          <Ionicons name="search" size={16} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder={t('search_icao_name')}
            placeholderTextColor={Colors.textMuted}
            value={query}
            onChangeText={setQuery}
            autoCapitalize="characters"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')}>
              <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {/* Hint om minsta 2 tecken */}
        {query.length === 1 && (
          <Text style={styles.hint}>{t('type_min_2')}</Text>
        )}

        {/* Resultat */}
        {results.map((a) => (
          <TouchableOpacity
            key={a.icao}
            style={styles.airportRow}
            onPress={() => setSelected(a)}
            activeOpacity={0.75}
          >
            <View style={styles.airportLeft}>
              <Text style={styles.airportIcao}>{a.icao}</Text>
              <Text style={styles.airportName}>{a.name}</Text>
              <Text style={styles.airportCountry}>{a.country} · {a.region}</Text>
            </View>
            <View style={styles.airportRight}>
              {a.temporary === 1 && (
                <View style={[styles.badge, styles.badgeTemporary]}>
                  <Text style={styles.badgeText}>{t('temporary_badge')}</Text>
                </View>
              )}
              {!!a.custom && a.temporary !== 1 && (
                <View style={[styles.badge, styles.badgeCustom]}>
                  <Text style={styles.badgeText}>{t('custom_badge')}</Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
            </View>
          </TouchableOpacity>
        ))}

        {results.length === 0 && query.length >= 2 && (
          <View style={styles.empty}>
            <Ionicons name="location-outline" size={32} color={Colors.textMuted} />
            <Text style={styles.emptyText}>{t('no_airports_found')} "{query}"</Text>
          </View>
        )}

        {results.length === 0 && query.length < 2 && (
          <View style={styles.empty}>
            <Ionicons name="location-outline" size={32} color={Colors.textMuted} />
            <Text style={styles.emptyText}>
              {tab === 'temporary' ? t('no_temporary_places') : t('no_custom_airports')}
            </Text>
          </View>
        )}

        {/* Lägg till — bara i custom-tab */}
        {tab === 'custom' && (
          <TouchableOpacity
            style={styles.addBtn}
            onPress={() => setShowForm(!showForm)}
            activeOpacity={0.8}
          >
            <Ionicons name={showForm ? 'close' : 'add'} size={18} color={Colors.textInverse} />
            <Text style={styles.addBtnText}>{showForm ? t('cancel') : t('add_airport')}</Text>
          </TouchableOpacity>
        )}

        {tab === 'custom' && showForm && (
          <View style={styles.form}>
            <Text style={styles.formTitle}>{t('new_airport')}</Text>
            {[
              { label: t('icao_code'), key: 'icao', placeholder: 'ESSA', maxLength: 4, caps: true },
              { label: t('airport_name_label'), key: 'name', placeholder: 'Stockholm Arlanda' },
              { label: t('country_label'), key: 'country', placeholder: 'Sweden' },
              { label: t('region_label'), key: 'region', placeholder: 'ES', maxLength: 2, caps: true },
              { label: t('latitude_label'), key: 'lat', placeholder: '59.6519', keyboard: 'decimal-pad' },
              { label: t('longitude_label'), key: 'lon', placeholder: '17.9186', keyboard: 'decimal-pad' },
            ].map(({ label, key, placeholder, maxLength, caps, keyboard }) => (
              <View key={key} style={styles.formField}>
                <Text style={styles.formLabel}>{label}</Text>
                <TextInput
                  style={styles.formInput}
                  value={(form as any)[key]}
                  onChangeText={(v) => setForm((p) => ({ ...p, [key]: v }))}
                  placeholder={placeholder}
                  placeholderTextColor={Colors.textMuted}
                  maxLength={maxLength}
                  autoCapitalize={caps ? 'characters' : 'none'}
                  keyboardType={(keyboard as any) ?? 'default'}
                />
              </View>
            ))}
            <TouchableOpacity style={styles.saveBtn} onPress={handleAdd}>
              <Ionicons name="checkmark-circle" size={18} color={Colors.textInverse} />
              <Text style={styles.saveBtnText}>{t('save_airport')}</Text>
            </TouchableOpacity>
          </View>
        )}
        </>
        )}
      </ScrollView>

      <PremiumModal visible={showPremium} onClose={() => setShowPremium(false)} feature={t('prem_feat_icao_title')} />

      {/* Global map modal */}
      <Modal visible={showGlobalMap} animationType="slide" onRequestClose={() => setShowGlobalMap(false)}>
        <View style={{ flex: 1, backgroundColor: Colors.background, paddingTop: insets.top }}>
          <View style={{
            flexDirection: 'row', alignItems: 'center', gap: 8,
            paddingHorizontal: 12, paddingVertical: 10,
            backgroundColor: Colors.surface,
            borderBottomWidth: 0.5, borderBottomColor: Colors.border,
          }}>
            <Ionicons name="globe" size={18} color={Colors.primary} />
            <Text style={{ color: Colors.textPrimary, fontSize: 15, fontWeight: '700', flex: 1 }}>
              {t('global_map_title')}
            </Text>
            <Text style={{ color: Colors.textMuted, fontSize: 11 }}>
              {SEED_AIRPORTS.length.toLocaleString()} {t('global_db_airports')}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            {showGlobalMap && (
              <WebView
              source={{ html: buildGlobalMapHtml(SEED_AIRPORTS), baseUrl: 'https://tile.openstreetmap.org' }}
              style={{ flex: 1 }}
              originWhitelist={['*']}
            />
            )}
            <TouchableOpacity
              onPress={() => setShowGlobalMap(false)}
              style={{
                position: 'absolute', top: 10, right: 10, zIndex: 10,
                width: 36, height: 36, borderRadius: 18,
                backgroundColor: 'rgba(15,22,38,0.85)',
                alignItems: 'center', justifyContent: 'center',
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="close" size={20} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Detaljmodal */}
      {selected && (
        <AirportDetailModal
          airport={selected}
          onClose={() => setSelected(null)}
          onDelete={handleDelete}
          onUpdate={handleUpdate}
        />
      )}
    </KeyboardAvoidingView>
  );
}

// ── Stilar ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 40, gap: 10 },
  subtitle: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  hint: { color: Colors.textMuted, fontSize: 12, textAlign: 'center', marginTop: -4 },

  tabRow: {
    flexDirection: 'row',
    backgroundColor: Colors.elevated, borderRadius: 8, padding: 3,
    borderWidth: 0.5, borderColor: Colors.border,
  },
  tabBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 6 },
  tabBtnActive: { backgroundColor: Colors.primary },
  tabBtnText: { color: Colors.textMuted, fontSize: 12, fontWeight: '700' },
  tabBtnTextActive: { color: Colors.textInverse },

  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card, borderRadius: 10,
    paddingHorizontal: 12, borderWidth: 1, borderColor: Colors.border, gap: 8,
  },
  searchInput: { flex: 1, color: Colors.textPrimary, fontSize: 15, paddingVertical: 10 },

  airportRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: Colors.cardBorder, gap: 8,
  },
  airportLeft: { flex: 1, gap: 1 },
  airportIcao: {
    color: Colors.textPrimary, fontSize: 15, fontWeight: '800',
    letterSpacing: 1, fontFamily: 'Menlo',
  },
  airportName: { color: Colors.textSecondary, fontSize: 12 },
  airportCountry: { color: Colors.textMuted, fontSize: 11 },
  airportRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  badge: {
    backgroundColor: Colors.separator, borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  badgeCustom: { backgroundColor: Colors.primary + '33' },
  badgeTemporary: { backgroundColor: Colors.textMuted + '33' },
  badgeText: { color: Colors.textMuted, fontSize: 10, fontWeight: '600' },

  globalHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.card, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  globalTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
  globalSub: { color: Colors.textMuted, fontSize: 11, marginTop: 1 },
  unlockBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.gold + '18', paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 8, borderWidth: 0.5, borderColor: Colors.gold + '44',
  },
  unlockBtnText: { color: Colors.gold, fontSize: 11, fontWeight: '700' },
  moreCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.elevated, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: Colors.border,
  },
  moreText: { color: Colors.textSecondary, fontSize: 12, flex: 1 },
  moreUnlock: { color: Colors.gold, fontSize: 12, fontWeight: '700' },

  empty: { alignItems: 'center', gap: 8, paddingVertical: 24 },
  emptyText: { color: Colors.textMuted, fontSize: 13, textAlign: 'center' },

  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.accent, borderRadius: 10, paddingVertical: 12, gap: 6,
    marginTop: 4,
  },
  addBtnText: { color: Colors.textInverse, fontSize: 15, fontWeight: '700' },

  form: {
    backgroundColor: Colors.card, borderRadius: 12, padding: 16,
    gap: 10, borderWidth: 1, borderColor: Colors.cardBorder,
  },
  formTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  formField: { gap: 4 },
  formLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600', textTransform: 'uppercase' },
  formInput: {
    backgroundColor: Colors.elevated, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.border,
    color: Colors.textPrimary, fontSize: 14,
    paddingHorizontal: 10, paddingVertical: 9,
  },
  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 12, gap: 6, marginTop: 4,
  },
  saveBtnText: { color: Colors.textInverse, fontSize: 14, fontWeight: '700' },
});

const detailStyles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 0.5, borderBottomColor: Colors.border,
  },
  closeBtn: { padding: 4 },
  icao: {
    color: Colors.textPrimary, fontSize: 22, fontWeight: '900',
    letterSpacing: 2, fontFamily: 'Menlo',
  },
  name: { color: Colors.textSecondary, fontSize: 13, marginTop: 1 },
  badges: { flexDirection: 'row', gap: 6 },
  badge: {
    borderRadius: 4, paddingHorizontal: 7, paddingVertical: 3,
    backgroundColor: Colors.separator,
  },
  badgeCustom: { backgroundColor: Colors.primary + '33' },
  badgeTemporary: { backgroundColor: Colors.textMuted + '33' },
  badgeText: { color: Colors.textMuted, fontSize: 10, fontWeight: '700' },

  mapContainer: { height: 260, backgroundColor: Colors.elevated },
  noMap: {
    height: 120, alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: Colors.elevated,
    borderBottomWidth: 0.5, borderBottomColor: Colors.border,
  },
  noMapText: { color: Colors.textMuted, fontSize: 13 },

  info: { flex: 1 },
  infoRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 13,
    borderBottomWidth: 0.5, borderBottomColor: Colors.separator,
  },
  infoLabel: {
    width: 90, color: Colors.textSecondary, fontSize: 12,
    fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5,
  },
  infoValue: { flex: 1, color: Colors.textPrimary, fontSize: 15 },
  infoMono: { fontFamily: 'Menlo', letterSpacing: 0.5 },

  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, margin: 16, paddingVertical: 13, borderRadius: 10,
    backgroundColor: Colors.danger + '18',
    borderWidth: 1, borderColor: Colors.danger + '44',
  },
  deleteBtnText: { color: Colors.danger, fontSize: 14, fontWeight: '700' },
});
