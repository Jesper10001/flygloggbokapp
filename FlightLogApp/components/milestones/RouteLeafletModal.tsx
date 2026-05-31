import React from 'react';
import { View, Modal, Pressable, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';

export interface MapPoint { icao: string; name?: string; lat: number; lon: number }

interface Props {
  visible: boolean;
  onClose: () => void;
  points: MapPoint[];
  accent?: string;
}

function buildHtml(points: MapPoint[], accent: string): string {
  const pts = points.filter(p => p.icao !== 'ZZZZ' && Number.isFinite(p.lat) && Number.isFinite(p.lon));
  const lats = pts.map(p => p.lat);
  const lons = pts.map(p => p.lon);
  const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;

  const ptsJson = JSON.stringify(pts.map(p => ({ icao: p.icao, lat: p.lat, lon: p.lon })));
  const boundsJson = JSON.stringify(pts.map(p => [p.lat, p.lon]));

  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" crossorigin=""/>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:100%;height:100%;background:#0A1628}
  #map{position:absolute;inset:0}
  .leaflet-control-attribution{font-size:9px;background:rgba(255,255,255,.8)!important;color:#94a3b8}
  .route-anim{filter:drop-shadow(0 0 5px ${accent});}
  .ap{position:relative;width:0;height:0}
  .ap .halo{position:absolute;left:-13px;top:-13px;width:26px;height:26px;border-radius:50%;background:${accent};opacity:.5;animation:pulse 2.2s ease-out infinite}
  .ap .dot{position:absolute;left:-6px;top:-6px;width:12px;height:12px;border-radius:50%;background:${accent};border:2px solid #fff;box-shadow:0 0 6px ${accent}}
  .ap .lbl{position:absolute;left:12px;top:-9px;font-family:-apple-system,system-ui,sans-serif;font-weight:800;font-size:12px;letter-spacing:.5px;color:#0A1628;background:rgba(255,255,255,.9);padding:1px 5px;border-radius:5px;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,.2)}
  @keyframes pulse{0%{transform:scale(1);opacity:.5}70%{opacity:0}100%{transform:scale(2.6);opacity:0}}
</style>
</head><body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" crossorigin=""></script>
<script>
var PTS = ${ptsJson};
var BOUNDS = ${boundsJson};
var ACCENT = '${accent}';
window.onload = function(){
  var map = L.map('map',{center:[${centerLat},${centerLon}],zoom:5,zoomControl:true,attributionControl:true});
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png',
    {subdomains:'abcd',maxZoom:19,crossOrigin:true,attribution:'© OpenStreetMap © CARTO'}).addTo(map);

  // Airport pins (cyan dot + pulse + ICAO label) — unique airports only
  var seen={};
  PTS.forEach(function(p){
    if(seen[p.icao]) return; seen[p.icao]=1;
    L.marker([p.lat,p.lon],{icon:L.divIcon({className:'',
      html:'<div class="ap"><div class="halo"></div><div class="dot"></div><div class="lbl">'+p.icao+'</div></div>',
      iconSize:[0,0],iconAnchor:[0,0]}),interactive:false}).addTo(map);
  });

  var FULL = PTS.map(function(p){return [p.lat,p.lon];});

  // faint ghost of the whole route
  if(FULL.length>1){
    L.polyline(FULL,{color:ACCENT,weight:3,opacity:0.22,lineCap:'round',lineJoin:'round'}).addTo(map);
  }

  if(BOUNDS.length>1){ map.fitBounds(BOUNDS,{padding:[60,60],maxZoom:9}); }
  else if(BOUNDS.length===1){ map.setView(BOUNDS[0],8); }
  setTimeout(function(){map.invalidateSize();},250);

  // Animated cyan draw across all legs, looping
  if(FULL.length>1){
    var anim=L.polyline([FULL[0],FULL[0]],{color:ACCENT,weight:3.5,opacity:1,lineCap:'round',lineJoin:'round',className:'route-anim'}).addTo(map);
    var segLen=[],total=0;
    for(var i=1;i<FULL.length;i++){
      var dx=FULL[i][0]-FULL[i-1][0], dy=FULL[i][1]-FULL[i-1][1];
      var l=Math.sqrt(dx*dx+dy*dy); segLen.push(l); total+=l;
    }
    var DUR=5500, HOLD=1500, startTs=null;
    function lerp(a,b,t){return [a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t];}
    function frame(ts){
      if(!startTs) startTs=ts;
      var elapsed=ts-startTs;
      var cycle=DUR+HOLD;
      var raw=Math.min(elapsed/DUR,1);
      var t=raw<0.5?4*raw*raw*raw:1-Math.pow(-2*raw+2,3)/2; // ease-in-out
      var dist=t*total, acc=0, partial=[FULL[0]];
      for(var i=1;i<FULL.length;i++){
        if(acc+segLen[i-1]<=dist){ partial.push(FULL[i]); acc+=segLen[i-1]; }
        else { var rem=(dist-acc)/(segLen[i-1]||1); partial.push(lerp(FULL[i-1],FULL[i],rem)); break; }
      }
      anim.setLatLngs(partial);
      if(elapsed>=cycle){ startTs=ts; }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
};
</script></body></html>`;
}

export function RouteLeafletModal({ visible, onClose, points, accent = Colors.accent }: Props) {
  const insets = useSafeAreaInsets();
  const valid = points.filter(p => p.icao !== 'ZZZZ' && Number.isFinite(p.lat) && Number.isFinite(p.lon));

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.container}>
        {valid.length > 0 && (
          <WebView
            style={styles.webview}
            source={{ html: buildHtml(valid, accent), baseUrl: 'https://tile.openstreetmap.org' }}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            mixedContentMode="always"
          />
        )}
        <Pressable
          style={[styles.closeBtn, { top: insets.top + 12 }]}
          onPress={onClose}
          hitSlop={12}
        >
          <Ionicons name="close" size={20} color="#fff" />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0A1628' },
  webview: { flex: 1 },
  closeBtn: {
    position: 'absolute', right: 16,
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.2)',
  },
});
