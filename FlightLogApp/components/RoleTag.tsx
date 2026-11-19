// Rollsymbolen i förbandskortet och Specific-panelen (Air Bases → Specific): mörk ruta med rollens bokstav (JetBrains
// Mono) och farkostens siluett i vitt; bara kanten har rollens färg. På kartan samma symbol 20 % mindre, staplad vid
// flera roller (RoleTagStack). Design: artifact G3JjRFW2NmM3nEkNPsUkaT.
import { View, Text } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { ROLES, type RoleKey } from '../utils/milAirbases';

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

// Kartan: samma symbol, 20 % mindre än den tidigare kartetiketten (24 → 19 px). Flera roller staplas snett bakom
// huvudrollen (högst två lager bakom). Vald bas får ett guldsken, som en vald flygplats.
const PIN = { h: 19, r: 8, bw: 1.2, font: 10, glyph: 12, step: 3 };
export function RoleTagStack({ roles, selected = false }: { roles: RoleKey[]; selected?: boolean }) {
  const main: RoleKey | 'unknown' = roles[0] ?? 'unknown';
  const R = ROLES[main];
  const w = R.letter.length > 1 ? 40 : 34;
  const under = roles.slice(1, 3);
  const n = under.length;
  return (
    <View style={{ width: w + n * PIN.step, height: PIN.h + n * PIN.step }}>
      {under.map((_, i) => i).reverse().map((i) => (
        <View key={i} style={{ position: 'absolute', left: (i + 1) * PIN.step, top: (n - i - 1) * PIN.step, width: w, height: PIN.h, borderRadius: PIN.r,
          borderWidth: PIN.bw, borderColor: ROLES[under[i]].color, backgroundColor: 'rgba(15,22,38,0.92)' }} />
      ))}
      <View style={[{ position: 'absolute', left: 0, top: n * PIN.step, width: w, height: PIN.h, borderRadius: PIN.r, borderWidth: selected ? 1.5 : PIN.bw,
        borderColor: R.color, backgroundColor: 'rgba(15,22,38,0.96)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
        selected && { shadowColor: '#F5C84B', shadowOpacity: 0.95, shadowRadius: 7, shadowOffset: { width: 0, height: 0 } }]}>
        <Text style={{ fontFamily: 'JetBrainsMono', fontWeight: '800', fontSize: PIN.font, lineHeight: PIN.font + 2, color: '#FFFFFF' }}>{R.letter}</Text>
        <Svg width={PIN.glyph} height={PIN.glyph} viewBox="0 0 24 24"><Path d={R.glyph} fill="#FFFFFF" /></Svg>
      </View>
    </View>
  );
}
