import { useEffect, useState } from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { create } from 'zustand';
import { getVisitedAirportIcaos } from '../db/flights';
import { getAirportCoordinates, getUnlocatedTemporaryPlaces } from '../db/icao';
import type { IcaoAirport } from '../types/flight';
import { Colors } from '../constants/colors';
import { useFlightStore } from '../store/flightStore';
import { GlassDialog, DialogIcon } from './GlassDialog';
import { PlacePinModal } from './PlacePinModal';

// Platser utan position (off-airport, t.ex. en landningsplats i fält): en liten notis bredvid globen i stället
// för en lång lista i globmenyn (som sköt undan menyns stängknapp). Notisen öppnar en ruta med en plats i
// taget: placera den på kartan eller ta nästa. Efter varje sparad plats kommer nästa.

// Räknas upp när en plats fått position, så att kartorna (AirportMapWidget) läser om sina flygplatser.
export const usePlacedPlaces = create<{ version: number; bump: () => void }>((set) => ({
  version: 0,
  bump: () => set((st) => ({ version: st.version + 1 })),
}));

export function PlacesToPinNotice({ style }: { style?: any }) {
  const flightCount = useFlightStore((st) => st.flightCount);
  const version = usePlacedPlaces((st) => st.version);
  const bump = usePlacedPlaces((st) => st.bump);
  const [places, setPlaces] = useState<IcaoAirport[]>([]);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [placing, setPlacing] = useState<IcaoAirport | null>(null);
  const [center, setCenter] = useState<{ lat: number; lon: number } | null>(null);

  useEffect(() => {
    getUnlocatedTemporaryPlaces().then(setPlaces).catch(() => {});
  }, [flightCount, version]);

  // Kartan börjar vid den senaste flygplatsen med position: platserna ligger oftast nära där man flugit.
  useEffect(() => {
    if (!places.length || center) return;
    (async () => {
      const icaos = (await getVisitedAirportIcaos()).slice(0, 25);
      const byIcao = new Map((await getAirportCoordinates(icaos)).filter((a) => a.lat && a.lon).map((a) => [a.icao, a]));
      const first = icaos.map((i) => byIcao.get(i)).find(Boolean);
      if (first) setCenter({ lat: first.lat, lon: first.lon });
    })().catch(() => {});
  }, [places.length, center]);

  if (!places.length) return null;
  const i = Math.min(index, places.length - 1);
  const place = places[i];
  const named = place.name && place.name.toUpperCase() !== place.icao.toUpperCase();

  return (
    <>
      <TouchableOpacity
        style={[s.chip, style]}
        onPress={() => { setIndex(0); setOpen(true); }}
        activeOpacity={0.8}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`${places.length} ${places.length === 1 ? 'place' : 'places'} without a position on the map`}
      >
        <Ionicons name="location-outline" size={13} color={Colors.warning} />
        <Text style={s.chipTxt}>{places.length} {places.length === 1 ? 'place' : 'places'} to pin</Text>
      </TouchableOpacity>

      <GlassDialog
        visible={open}
        onClose={() => setOpen(false)}
        icon={<DialogIcon name="location" color={Colors.warning} />}
        eyebrow={places.length > 1 ? `Place ${i + 1} of ${places.length}` : 'Place to pin'}
        title={place.icao}
        body={`${named ? `${place.name}. ` : ''}You logged a flight here, but it has no position yet, so it's missing from your maps. Pin it on the map.`}
        // iOS visar inte en modal medan en annan stängs: rutan stängs först, sedan kommer kartan.
        primary={{ label: 'Place on map', onPress: () => { setOpen(false); setTimeout(() => setPlacing(place), 350); } }}
        secondary={places.length > 1
          ? { label: 'Next place', onPress: () => setIndex((i + 1) % places.length) }
          : { label: 'Later', onPress: () => setOpen(false) }}
      />

      <PlacePinModal
        place={placing}
        center={center}
        // Avbrutet → tillbaka till rutan med samma plats (kartan glider undan först).
        onClose={() => { setPlacing(null); setTimeout(() => setOpen(true), 500); }}
        onSaved={(saved) => {
          const rest = places.filter((p) => p.icao !== saved.icao);
          setPlaces(rest);
          setPlacing(null);
          bump();
          // Nästa plats i samma ruta, tills alla har position.
          if (rest.length) {
            setIndex(Math.min(i, rest.length - 1));
            setTimeout(() => setOpen(true), 500);
          }
        }}
      />
    </>
  );
}

const s = StyleSheet.create({
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 9, paddingVertical: 5, borderRadius: 12,
    backgroundColor: 'rgba(6,11,22,0.72)', borderWidth: 1, borderColor: Colors.warning + '55',
  },
  chipTxt: { color: Colors.textSecondary, fontSize: 10.5, fontWeight: '700' },
});
