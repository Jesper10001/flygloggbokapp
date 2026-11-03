import { useState } from 'react';
import { View, Text, Image, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useFlightStore } from '../store/flightStore';
import { getManualFlightCount } from '../db/flights';
import { FREE_TIER_LIMIT } from '../constants/easa';
import { hasTokenQuota, showMonthlyTokenLimitAlert } from '../utils/tokenGate';
import { askAiConsent } from '../services/aiConsent';
import { presentPaywall } from '../services/purchases';
import * as ImagePicker from 'expo-image-picker';
import { Colors } from '../constants/colors';
import { GlassDialog, DialogOption } from './GlassDialog';

// "ACARS/Instrument scan": rutan som frågar efter kamera eller fotoalbum, med exempelbilder på vad man kan fota.
// Öppnas från dashboarden (Log Flight kommer upp först när en bild valts) och från knappen i Log Flight.

export type ScanSource = 'camera' | 'library';

export function AcarsScanChooser({ visible, onChoose }: { visible: boolean; onChoose: (source: ScanSource | null) => void }) {
  return (
    <GlassDialog
      visible={visible}
      onClose={() => onChoose(null)}
      eyebrow="ACARS/INSTRUMENT SCAN"
      title="Photograph your flight log"
      body="The ACARS flight log (OUT · OFF · ON · IN) or your instruments."
      secondary={{ label: 'Cancel', onPress: () => onChoose(null) }}
    >
      {/* Fast höjd (INTE aspectRatio): en liten ruta som aldrig kan svälla ut och täcka skärmen. */}
      <View style={s.examples}>
        <View style={s.example}>
          <Image source={require('../assets/Flightdata_AW109.jpg')} style={s.img} resizeMode="contain" />
          <Text style={s.caption}>Leonardo AW109{'\n'}helicopter flight log</Text>
        </View>
        <View style={s.example}>
          <Image source={require('../assets/ACARS.JPG')} style={s.img} resizeMode="contain" />
          <Text style={s.caption}>Airbus ACARS{'\n'}flight log (MCDU)</Text>
        </View>
      </View>
      <View style={s.options}>
        <DialogOption icon="camera-outline" title="Take a photo" sub="Hold the phone steady, with the whole screen in view." onPress={() => onChoose('camera')} />
        <DialogOption icon="images-outline" title="Choose from your photos" sub="Blades reads the times and the route from the image." onPress={() => onChoose('library')} />
      </View>
    </GlassDialog>
  );
}

// iOS visar inte kameran eller fotoväljaren medan rutan fortfarande stängs.
export const CHOOSER_CLOSE_MS = 350;

/** Tar eller väljer bilden. Filens adress, eller null om man avbröt eller nekade kameran. */
export async function pickScanImage(source: ScanSource, deniedText = 'Camera permission is needed to scan the ACARS or your instruments.'): Promise<string | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera', deniedText);
      return null;
    }
  }
  const picked = source === 'camera'
    ? await ImagePicker.launchCameraAsync({ quality: 1 })
    : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, exif: false });
  return picked.canceled ? null : picked.assets[0]?.uri ?? null;
}

/**
 * Start från dashboarden eller Essential: först rutan och bilden, Log Flight öppnas när en bild valts. Avbryter man
 * händer inget. Lägg `chooser` i skärmen och koppla `start` till knappen.
 */
export function useAcarsScanStart() {
  const router = useRouter();
  const { isPremium, isMax } = useFlightStore();
  const [open, setOpen] = useState(false);
  const start = async () => {
    const paying = isPremium || isMax;
    // Gratisgränsen nådd: Log Flight visar Premium-uppmaningen.
    if (!paying && (await getManualFlightCount().catch(() => 0)) >= FREE_TIER_LIMIT) { router.push('/flight/add'); return; }
    if (!hasTokenQuota()) {
      if (paying) showMonthlyTokenLimitAlert(); else presentPaywall('ACARS/Instrument scan');
      return;
    }
    if (await askAiConsent()) setOpen(true);
  };
  const choose = (source: ScanSource | null) => {
    setOpen(false);
    if (!source) return;
    setTimeout(async () => {
      const uri = await pickScanImage(source).catch(() => null);
      if (uri) router.push({ pathname: '/flight/add', params: { scanImage: uri } });
    }, CHOOSER_CLOSE_MS);
  };
  return { start, chooser: <AcarsScanChooser visible={open} onChoose={choose} /> };
}

const s = StyleSheet.create({
  examples: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginTop: 14 },
  example: { flex: 1, alignItems: 'center' },
  img: { width: '100%', height: 120, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(255,255,255,0.06)' },
  caption: { color: Colors.textSecondary, fontSize: 11, textAlign: 'center', marginTop: 6, lineHeight: 15 },
  options: { alignSelf: 'stretch', gap: 8, marginTop: 14 },
});
