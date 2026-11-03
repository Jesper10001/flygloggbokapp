import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { GlassDialog, DialogOption } from './GlassDialog';
import { pickScanImage, CHOOSER_CLOSE_MS, type ScanSource } from './AcarsScanChooser';
import { useFlightStore } from '../store/flightStore';
import { getDroneFlightCount } from '../db/drones';
import { FREE_TIER_LIMIT_DRONE } from '../constants/easa';
import { hasTokenQuota, showMonthlyTokenLimitAlert } from '../utils/tokenGate';
import { askAiConsent } from '../services/aiConsent';
import { presentPaywall } from '../services/purchases';

// Instrument scan (drönare): rutan som frågar efter skärmdump eller foto av flygloggen i drönarappen. Oftast en
// skärmdump, så den står först.

export const DENIED_TEXT = 'Camera permission is needed to photograph your flight log.';

export function DroneScanChooser({ visible, onChoose }: { visible: boolean; onChoose: (source: ScanSource | null) => void }) {
  return (
    <GlassDialog
      visible={visible}
      onClose={() => onChoose(null)}
      eyebrow="INSTRUMENT SCAN"
      title="Scan your flight log"
      body="Use the flight list in your drone app, for example DJI Fly → Flight Data Center. Every flight in the image is read, date by date."
      secondary={{ label: 'Cancel', onPress: () => onChoose(null) }}
    >
      <View style={s.options}>
        <DialogOption icon="images-outline" title="Choose a screenshot" sub="From your photos." onPress={() => onChoose('library')} />
        <DialogOption icon="camera-outline" title="Take a photo" sub="Of the screen, with the whole list in view." onPress={() => onChoose('camera')} />
      </View>
    </GlassDialog>
  );
}

/**
 * Start från dashboarden eller Settings: först rutan och bilden, Log Flight öppnas när en bild valts. Avbryter man
 * händer inget. Lägg `chooser` i skärmen och koppla `start` till knappen.
 */
export function useDroneScanStart() {
  const router = useRouter();
  const { isPremium, isMax } = useFlightStore();
  const [open, setOpen] = useState(false);
  const start = async () => {
    const paying = isPremium || isMax;
    // Gratisgränsen nådd: Log Flight visar Premium-uppmaningen.
    if (!paying && (await getDroneFlightCount().catch(() => 0)) >= FREE_TIER_LIMIT_DRONE) { router.push('/drone-flight/add'); return; }
    if (!hasTokenQuota()) {
      if (paying) showMonthlyTokenLimitAlert(); else presentPaywall('Flight log scan');
      return;
    }
    if (await askAiConsent()) setOpen(true);
  };
  const choose = (source: ScanSource | null) => {
    setOpen(false);
    if (!source) return;
    setTimeout(async () => {
      const uri = await pickScanImage(source, DENIED_TEXT).catch(() => null);
      if (uri) router.push({ pathname: '/drone-flight/add', params: { scanImage: uri } });
    }, CHOOSER_CLOSE_MS);
  };
  return { start, chooser: <DroneScanChooser visible={open} onChoose={choose} /> };
}

const s = StyleSheet.create({
  options: { alignSelf: 'stretch', gap: 8, marginTop: 14 },
});
