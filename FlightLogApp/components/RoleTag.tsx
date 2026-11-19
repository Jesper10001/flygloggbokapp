// Rollsymbolen i förbandskortet och Specific-panelen (Air Bases → Specific): mörk ruta med rollens bokstav (JetBrains
// Mono) och farkostens siluett i vitt; bara kanten har rollens färg. På kartan visas baserna i stället som en vanlig
// ICAO-etikett med förbandets flagga + bokstäverna (utils/ruAirbases ruBaseTag). Design: artifact G3JjRFW2NmM3nEkNPsUkaT.
import { View, Text } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { ROLES, type RoleKey } from '../utils/ruAirbases';

const SIZES = {
  map: { h: 24, r: 10, bw: 1.5, font: 13, glyph: 15, pad: 7 },
  mini: { h: 20, r: 7, bw: 1.2, font: 11, glyph: 12, pad: 5 },
};

export function RoleTag({ role, size = 'mini' }: { role: RoleKey | 'unknown'; size?: keyof typeof SIZES }) {
  const s = SIZES[size], R = ROLES[role];
  return (
    <View style={{ height: s.h, paddingHorizontal: s.pad, borderRadius: s.r, borderWidth: s.bw, borderColor: R.color, backgroundColor: 'rgba(15,22,38,0.94)',
      flexDirection: 'row', alignItems: 'center', gap: size === 'map' ? 4 : 3 }}>
      <Text style={{ fontFamily: 'JetBrainsMono', fontWeight: '800', fontSize: s.font - 0.5, lineHeight: s.font + 2, color: '#FFFFFF', letterSpacing: size === 'map' ? 0.5 : 0 }}>{R.letter}</Text>
      <Svg width={s.glyph} height={s.glyph} viewBox="0 0 24 24"><Path d={R.glyph} fill="#FFFFFF" /></Svg>
    </View>
  );
}
