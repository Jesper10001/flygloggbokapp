// "Vad är Blade coins?" (?-knappen vid saldot i Settings, pilot och drönare). Samma stil som appens övriga
// popup-rutor (GlassDialog).
import { View, Text, Image, StyleSheet } from 'react-native';
import { GlassDialog, dialogStyles } from './GlassDialog';
import { Colors } from '../constants/colors';

const COIN = require('../assets/Blade_coin.PNG');

export function CoinInfoDialog({ visible, onClose, shopHint }: { visible: boolean; onClose: () => void; shopHint?: boolean }) {
  return (
    <GlassDialog
      visible={visible}
      onClose={onClose}
      icon={<Image source={COIN} style={s.coin} resizeMode="contain" accessibilityIgnoresInvertColors />}
      eyebrow="Blade coins"
      title="Coins power the smart features"
      primary={{ label: 'Got it', onPress: onClose }}
    >
      <View style={dialogStyles.divider} />
      <View style={s.points}>
        <Text style={s.p}>
          Aircraft and drone look-ups (specs and photos), scanning your paper logbook, reading data from images and other assisted
          tasks that do the typing for you.
        </Text>
        <Text style={s.p}>
          Each smart action spends a few coins. Free accounts get a one-time batch to try them out; Premium refills your coins every month.
        </Text>
        <Text style={s.muted}>
          When your coins run out, these features pause until your next refill. Everything else in the app keeps working as normal.
        </Text>
        {shopHint ? (
          <Text style={s.muted}>Need more? Tap + next to your balance to buy extra coins. They never expire and are used after your monthly coins.</Text>
        ) : null}
      </View>
    </GlassDialog>
  );
}

const s = StyleSheet.create({
  coin: { width: 64, height: 64, marginBottom: 12 },
  points: { alignSelf: 'stretch', gap: 10 },
  p: { color: Colors.textPrimary, opacity: 0.92, fontSize: 14, lineHeight: 20 },
  muted: { color: Colors.textSecondary, fontSize: 13, lineHeight: 19 },
});
