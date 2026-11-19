// Rollsymbolen för Air Bases → Specific: samma form som kartans ICAO-etikett (mörk, rundade hörn), men med rollens
// bokstav (Black Ops One) och farkostens siluett i vitt; bara kanten har rollens färg. RoleTagStack staplar en bas
// övriga roller snett bakom huvudrollen (design 2026-11-19, artifact G3JjRFW2NmM3nEkNPsUkaT).
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
      <Text style={{ fontFamily: 'BlackOpsOne', fontSize: s.font, lineHeight: s.font + 2, color: '#FFFFFF', letterSpacing: size === 'map' ? 0.5 : 0 }}>{R.letter}</Text>
      <Svg width={s.glyph} height={s.glyph} viewBox="0 0 24 24"><Path d={R.glyph} fill="#FFFFFF" /></Svg>
    </View>
  );
}

const STEP = 4; // px snett uppåt höger per bakomliggande etikett
export function RoleTagStack({ roles, selected = false }: { roles: RoleKey[]; selected?: boolean }) {
  const main: RoleKey | 'unknown' = roles[0] ?? 'unknown';
  const w = ROLES[main].letter.length > 1 ? 50 : 42;
  const under = roles.slice(1, 3);   // högst två lager bakom, annars blir stapeln rörig
  const n = under.length;
  return (
    <View style={{ width: w + n * STEP, height: 24 + n * STEP }}>
      {under.map((r, i) => i).reverse().map((i) => (
        <View key={i} style={{ position: 'absolute', left: (i + 1) * STEP, top: (n - i - 1) * STEP, width: w, height: 24, borderRadius: 10,
          borderWidth: 1.5, borderColor: ROLES[under[i]].color, backgroundColor: 'rgba(15,22,38,0.92)' }} />
      ))}
      <View style={[{ position: 'absolute', left: 0, top: n * STEP, width: w, alignItems: 'center' },
        selected && { shadowColor: '#FFFFFF', shadowOpacity: 0.9, shadowRadius: 7, shadowOffset: { width: 0, height: 0 } }]}>
        <View style={{ width: w }}><RoleTagInner role={main} w={w} /></View>
      </View>
    </View>
  );
}

function RoleTagInner({ role, w }: { role: RoleKey | 'unknown'; w: number }) {
  const R = ROLES[role];
  return (
    <View style={{ width: w, height: 24, borderRadius: 10, borderWidth: 1.5, borderColor: R.color, backgroundColor: 'rgba(15,22,38,0.96)',
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
      <Text style={{ fontFamily: 'BlackOpsOne', fontSize: 13, lineHeight: 15, color: '#FFFFFF', letterSpacing: 0.5 }}>{R.letter}</Text>
      <Svg width={15} height={15} viewBox="0 0 24 24"><Path d={R.glyph} fill="#FFFFFF" /></Svg>
    </View>
  );
}
