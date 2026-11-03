import { useRef, useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, Modal, StyleSheet, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { updateUserAirport } from '../db/icao';
import type { IcaoAirport } from '../types/flight';
import { Colors } from '../constants/colors';
import { useTranslation } from '../hooks/useTranslation';

// Kartan där en plats utan position (off-airport, t.ex. en landningsplats i fält) får sin pin: tryck för att
// placera, dra för att finjustera, eller sök på namnet. Samma karta som "Visited airports" (Apple Maps på iOS).
export function PlacePinModal({ place, center, onClose, onSaved }: {
  place: IcaoAirport | null;
  center: { lat: number; lon: number } | null;   // var kartan börjar (senaste flygplatsen med position)
  onClose: () => void;
  onSaved: (place: IcaoAirport, coord: { lat: number; lon: number }) => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const [coord, setCoord] = useState<{ lat: number; lon: number } | null>(null);
  const [sat, setSat] = useState(true); // satellit (hybrid) som standard
  const [search, setSearch] = useState('');
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    setCoord(null);
    setSearch(place ? place.name || place.icao : '');
  }, [place?.icao]);

  // Sök → centrera och sätt pin. Apples geokodning (CLGeocoder via expo-location): ingen tredjepartstjänst och
  // inget platstillstånd krävs. Ingen träff → inget händer.
  const geocode = async () => {
    const q = search.trim();
    if (!q) return;
    setSearching(true);
    try {
      const [hit] = await Location.geocodeAsync(q);
      if (hit) {
        setCoord({ lat: hit.latitude, lon: hit.longitude });
        mapRef.current?.animateToRegion({ latitude: hit.latitude, longitude: hit.longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 }, 450);
      }
    } catch {}
    finally { setSearching(false); }
  };

  const close = () => { setCoord(null); onClose(); };

  return (
    <Modal visible={!!place} animationType="slide" onRequestClose={close}>
      {/* KeyboardAvoidingView: sök/spara-baren skjuts upp ovanför tangentbordet så textrutan syns medan man
          skriver (kartan krymper i stället). */}
      <KeyboardAvoidingView style={s.modal} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {place && (
          <View style={{ flex: 1 }}>
            <MapView
              ref={mapRef}
              style={{ flex: 1 }}
              initialRegion={{
                latitude: center?.lat ?? 59.3,
                longitude: center?.lon ?? 18.0,
                latitudeDelta: 6, longitudeDelta: 6,
              }}
              mapType={sat ? 'hybrid' : 'standard'}
              userInterfaceStyle="dark"
              showsPointsOfInterests={false}
              showsCompass={false}
              toolbarEnabled={false}
              onPress={(e) => setCoord({ lat: e.nativeEvent.coordinate.latitude, lon: e.nativeEvent.coordinate.longitude })}
            >
              {coord && (
                <Marker
                  draggable
                  coordinate={{ latitude: coord.lat, longitude: coord.lon }}
                  onDragEnd={(e) => setCoord({ lat: e.nativeEvent.coordinate.latitude, lon: e.nativeEvent.coordinate.longitude })}
                  pinColor="#2E7D32"
                  title={place.name || place.icao}
                />
              )}
            </MapView>
            {/* Kartläge-växel: standard ↔ satellit, nere till höger ovanför sökbaren */}
            <TouchableOpacity onPress={() => setSat((v) => !v)} activeOpacity={0.8} style={s.satBtn}>
              <Ionicons name={sat ? 'map' : 'globe'} size={15} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{sat ? 'Map' : 'Satellite'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Sök + spara */}
        <View style={[s.bar, { paddingBottom: insets.bottom + 12 }]}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput
              style={s.input}
              value={search}
              onChangeText={setSearch}
              placeholder={t('search_place_ph')}
              placeholderTextColor="rgba(255,255,255,0.4)"
              returnKeyType="search"
              autoCorrect={false}
              onSubmitEditing={geocode}
            />
            <TouchableOpacity style={s.searchBtn} onPress={geocode}>
              <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{searching ? '...' : 'Search'}</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity style={s.cancel} onPress={close}>
              <Text style={{ color: Colors.textSecondary, fontSize: 14, fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.save, { backgroundColor: coord ? '#2E7D32' : Colors.textMuted }]}
              disabled={!coord}
              onPress={async () => {
                if (!place || !coord) return;
                await updateUserAirport(place.icao, place.name, coord.lat, coord.lon);
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                const saved = coord;
                setCoord(null);
                onSaved(place, saved);
              }}
              activeOpacity={0.85}
            >
              <Ionicons name="checkmark-circle" size={18} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Save position</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity style={[s.closeBtn, { top: insets.top + 12 }]} onPress={close} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="close" size={20} color="#fff" />
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  modal: { flex: 1, backgroundColor: '#000' },
  satBtn: {
    position: 'absolute', bottom: 12, right: 16, height: 36,
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12,
    borderRadius: 18, backgroundColor: 'rgba(15,22,38,0.9)',
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.2)',
  },
  bar: {
    paddingTop: 10, paddingHorizontal: 16, gap: 10,
    backgroundColor: 'rgba(10,22,40,0.95)', borderTopWidth: 0.5, borderTopColor: 'rgba(255,255,255,0.1)',
  },
  input: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    color: '#fff', fontSize: 14, fontWeight: '500', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  searchBtn: { backgroundColor: '#2E7D32', borderRadius: 10, paddingHorizontal: 14, justifyContent: 'center' },
  cancel: {
    flex: 1, paddingVertical: 13, borderRadius: 10, alignItems: 'center',
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.elevated,
  },
  save: { flex: 2, paddingVertical: 13, borderRadius: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 6 },
  closeBtn: {
    position: 'absolute', right: 16, width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.65)',
    borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.2)',
  },
});
