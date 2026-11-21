// Vädret för en flygplats ovanpå kartorna (Global map, Visited airports): samma väderkort som i Find airport
// (MapWxPanel: kategori, fyra värden, TAF med tidslinje och alla ändringar, UTC/zon-växel), men genomskinligt som
// flygplatskortet, bara så högt som innehållet och med ✕. Tryck utanför stänger. Ett overlay, ingen native Modal:
// en Modal ovanpå kartans Modal gör att Apple-kartan slutar svara.
import { useEffect, useState } from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { getAirportByIcao } from '../db/icao';
import { MapWxPanel } from './MapWxPanel';

export function WxMapPopup({ icao, onClose }: { icao: string; onClose: () => void }) {
  // Land, region och longitud för flygplatsens tidszon
  const [ap, setAp] = useState<{ country?: string; region?: string; lon?: number } | null>(null);
  useEffect(() => {
    let alive = true;
    setAp(null);
    getAirportByIcao(icao).then((a) => { if (alive && a) setAp({ country: a.country, region: a.region, lon: a.lon }); }).catch(() => {});
    return () => { alive = false; };
  }, [icao]);
  // Bakgrunden och kortet är syskon (inte förälder/barn): en Pressable runt kortet tar annars beröringen
  // före TAF-delens rullista.
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 90, justifyContent: 'center', paddingHorizontal: 12 }]} pointerEvents="box-none">
      <Pressable onPress={onClose} accessibilityLabel="Close weather" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.35)' }]} />
      <View style={{ width: '100%', maxWidth: 460, alignSelf: 'center' }}>
        <MapWxPanel icao={icao} onClose={onClose} translucent country={ap?.country} region={ap?.region} lon={ap?.lon ?? null} />
      </View>
    </View>
  );
}
