// Designens digitala jordglob (route-kortets sol-knapp). Cyan rutnät + nattsida som
// skuggas efter dag-andelen (lit). Ingen ring runt om. Ren SVG, ingen data.
import { View } from 'react-native';
import Svg, { Circle, Ellipse, Line, Rect, Defs, RadialGradient, LinearGradient, Stop, ClipPath, G } from 'react-native-svg';
import { Colors } from '../../constants/colors';

export function SunGlobe({ size = 60, lit = 1 }: { size?: number; lit?: number; isNight?: boolean }) {
  const f = Math.max(0, Math.min(1, lit));
  const litPct = f * 100;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Defs>
          <RadialGradient id="lfDigi" cx="36%" cy="30%" r="78%">
            <Stop offset="0%" stopColor="#16324F" />
            <Stop offset="60%" stopColor="#0E2238" />
            <Stop offset="100%" stopColor="#091726" />
          </RadialGradient>
          <LinearGradient id="lfNight" x1="0" y1="0" x2="1" y2="0">
            <Stop offset={`${litPct}%`} stopColor="#060C1C" stopOpacity={0} />
            <Stop offset={`${Math.min(100, litPct + 5)}%`} stopColor="#060C1C" stopOpacity={0.72} />
            <Stop offset="100%" stopColor="#03070F" stopOpacity={0.85} />
          </LinearGradient>
          <ClipPath id="lfGlobe"><Circle cx="50" cy="50" r="48" /></ClipPath>
        </Defs>
        <G clipPath="url(#lfGlobe)">
          <Circle cx="50" cy="50" r="48" fill="url(#lfDigi)" />
          {/* latituder (cyan) */}
          <G fill="none" stroke={Colors.primary} strokeOpacity={0.55} strokeWidth={0.7}>
            <Line x1="3" y1="50" x2="97" y2="50" />
            <Ellipse cx="50" cy="50" rx="48" ry="14" />
            <Ellipse cx="50" cy="50" rx="48" ry="31" />
          </G>
          {/* longituder (grå) */}
          <G fill="none" stroke="#5A7FA0" strokeOpacity={0.45} strokeWidth={0.6}>
            <Line x1="50" y1="2" x2="50" y2="98" />
            <Ellipse cx="50" cy="50" rx="16" ry="48" />
            <Ellipse cx="50" cy="50" rx="33" ry="48" />
          </G>
          {/* nod-prickar */}
          <G fill={Colors.primary}>
            <Circle cx="50" cy="18" r={1.3} />
            <Circle cx="50" cy="82" r={1.3} />
            <Circle cx="33" cy="36" r={1} fillOpacity={0.7} />
            <Circle cx="67" cy="64" r={1} fillOpacity={0.7} />
          </G>
          {/* nattsida */}
          <Rect x="0" y="0" width="100" height="100" fill="url(#lfNight)" />
          {/* kant */}
          <Circle cx="50" cy="50" r="48" fill="none" stroke={Colors.primary} strokeOpacity={0.35} strokeWidth={1} />
        </G>
      </Svg>
    </View>
  );
}
