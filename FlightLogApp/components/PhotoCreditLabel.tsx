// Fotokredit för Wikimedia-bilder (CC BY/BY-SA kräver upphovsperson + licens + källa). overlay = liten text
// uppe till vänster på en bild-banner (knapparna sitter till höger); inline = centrerad rad under en bild.
// Tryck öppnar filens sida på Wikimedia Commons (där licenstexten länkas).
import { Linking, Text, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import { Colors } from '../constants/colors';
import { parseCredit, type PhotoCredit } from '../utils/photoCredit';

export function PhotoCreditLabel({ credit, variant = 'overlay', style }: {
  credit: PhotoCredit | string | null | undefined;
  variant?: 'overlay' | 'inline';
  style?: StyleProp<ViewStyle>;
}) {
  const c = typeof credit === 'string' ? parseCredit(credit) : credit;
  if (!c) return null;
  const overlay = variant === 'overlay';
  return (
    <TouchableOpacity
      disabled={!c.url}
      onPress={() => { Linking.openURL(c.url).catch(() => {}); }}
      hitSlop={8}
      activeOpacity={0.7}
      accessibilityRole={c.url ? 'link' : 'text'}
      accessibilityLabel={c.text}
      style={[overlay
        ? { position: 'absolute', top: 9, left: 10, maxWidth: '62%', zIndex: 5 }
        : { alignSelf: 'center', maxWidth: '90%', marginTop: 6 }, style]}
    >
      <Text
        numberOfLines={1}
        style={overlay
          ? { fontSize: 9, color: 'rgba(255,255,255,0.78)', textShadowColor: 'rgba(0,0,0,0.75)', textShadowRadius: 3, textShadowOffset: { width: 0, height: 1 } }
          : { fontSize: 10, color: Colors.textMuted, textAlign: 'center' }}
      >
        {c.text}
      </Text>
    </TouchableOpacity>
  );
}
