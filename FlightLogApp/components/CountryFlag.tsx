// Riktig SVG-flagga (flag-icons) istället för emoji. Fyller hela rutan utan vit ram
// (preserveAspectRatio 'slice' + overflow hidden). ISO2-kod, t.ex. "SE", "GB".
import { View, Image } from 'react-native';
import type { ViewStyle } from 'react-native';
import { SvgUri } from 'react-native-svg';
import { Colors } from '../constants/colors';
import { FLAG_ASSETS } from './flags/flagAssets';

export function CountryFlag({ code, height = 16, radius = 2, style }: {
  code?: string;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}) {
  const c = (code || '').trim().toLowerCase();
  const w = Math.round((height * 4) / 3);
  const mod = FLAG_ASSETS[c];
  const box: ViewStyle = { width: w, height, borderRadius: radius, overflow: 'hidden', backgroundColor: Colors.elevated };
  if (!mod) {
    // Okänd/saknad kod → neutral platta (ingen vit ram).
    return <View style={[box, style]} />;
  }
  const uri = Image.resolveAssetSource(mod).uri;
  return (
    <View style={[box, style]}>
      <SvgUri uri={uri} width={w} height={height} preserveAspectRatio="xMidYMid slice" />
    </View>
  );
}
