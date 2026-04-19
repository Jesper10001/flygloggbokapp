import { View, Text } from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { Colors } from '../constants/colors';

interface Props {
  category: 'airplane' | 'helicopter' | '';
  engineType: 'se' | 'me' | '';
  label?: string;
  size?: number;
}

function SingleEngineAirplane({ w, h, color }: { w: number; h: number; color: string }) {
  return (
    <Svg width={w} height={h} viewBox="0 0 200 120">
      {/* Fuselage */}
      <Path d="M30 60 L170 55 Q185 57 185 60 Q185 63 170 65 L30 60Z" fill={color} opacity={0.9} />
      {/* Wings */}
      <Path d="M75 60 L65 20 L100 20 L95 60Z" fill={color} opacity={0.7} />
      <Path d="M75 60 L65 100 L100 100 L95 60Z" fill={color} opacity={0.7} />
      {/* Tail */}
      <Path d="M30 60 L15 40 L35 42Z" fill={color} opacity={0.7} />
      <Path d="M30 60 L15 80 L35 78Z" fill={color} opacity={0.7} />
      <Path d="M30 55 L20 35 L35 38Z" fill={color} opacity={0.6} />
      {/* Propeller */}
      <Circle cx="185" cy="60" r="3" fill={color} />
      <Path d="M185 45 Q188 60 185 75" stroke={color} strokeWidth="2" fill="none" opacity={0.5} />
    </Svg>
  );
}

function MultiEngineAirplane({ w, h, color }: { w: number; h: number; color: string }) {
  return (
    <Svg width={w} height={h} viewBox="0 0 200 120">
      {/* Fuselage */}
      <Path d="M25 60 Q25 54 40 54 L170 54 Q185 56 185 60 Q185 64 170 66 L40 66 Q25 66 25 60Z" fill={color} opacity={0.9} />
      {/* Wings — swept */}
      <Path d="M85 54 L55 15 L120 18 L105 54Z" fill={color} opacity={0.7} />
      <Path d="M85 66 L55 105 L120 102 L105 66Z" fill={color} opacity={0.7} />
      {/* Engines */}
      <Path d="M72 28 L68 22 L80 22 L78 28Z" fill={color} opacity={0.8} />
      <Path d="M72 92 L68 98 L80 98 L78 92Z" fill={color} opacity={0.8} />
      {/* Tail */}
      <Path d="M28 54 L15 38 L32 42Z" fill={color} opacity={0.7} />
      <Path d="M28 66 L15 82 L32 78Z" fill={color} opacity={0.7} />
      <Path d="M28 54 L18 34 L33 40Z" fill={color} opacity={0.6} />
      {/* Cockpit windows */}
      <Path d="M172 56 L180 58 L180 62 L172 64Z" fill={color} opacity={0.5} />
    </Svg>
  );
}

function SingleHelicopter({ w, h, color }: { w: number; h: number; color: string }) {
  return (
    <Svg width={w} height={h} viewBox="0 0 200 120">
      {/* Main body */}
      <Path d="M60 50 Q60 40 80 40 L130 40 Q150 40 150 50 L150 70 Q150 80 130 80 L80 80 Q60 80 60 70Z" fill={color} opacity={0.9} />
      {/* Tail boom */}
      <Path d="M60 55 L15 48 L15 52 L60 65Z" fill={color} opacity={0.7} />
      {/* Tail rotor */}
      <Path d="M15 38 L12 50 L18 50Z" fill={color} opacity={0.6} />
      {/* Skids */}
      <Path d="M75 80 L75 90 L70 92 L140 92 L135 90 L135 80" stroke={color} strokeWidth="2.5" fill="none" opacity={0.6} />
      {/* Main rotor mast */}
      <Path d="M105 40 L105 28" stroke={color} strokeWidth="3" opacity={0.8} />
      {/* Main rotor blades */}
      <Path d="M30 26 L180 30" stroke={color} strokeWidth="3" strokeLinecap="round" opacity={0.5} />
      {/* Cockpit */}
      <Path d="M140 45 Q155 48 155 60 Q155 72 140 75" fill={color} opacity={0.5} />
    </Svg>
  );
}

function MultiHelicopter({ w, h, color }: { w: number; h: number; color: string }) {
  return (
    <Svg width={w} height={h} viewBox="0 0 200 120">
      {/* Main body — wider */}
      <Path d="M55 45 Q55 35 75 35 L135 35 Q155 35 155 45 L155 75 Q155 85 135 85 L75 85 Q55 85 55 75Z" fill={color} opacity={0.9} />
      {/* Tail boom */}
      <Path d="M55 52 L12 46 L12 50 L55 68Z" fill={color} opacity={0.7} />
      {/* Tail rotor */}
      <Path d="M12 36 L9 48 L15 48Z" fill={color} opacity={0.6} />
      {/* Wheels */}
      <Circle cx="80" cy="90" r="5" fill={color} opacity={0.6} />
      <Circle cx="130" cy="90" r="5" fill={color} opacity={0.6} />
      <Path d="M80 85 L80 90" stroke={color} strokeWidth="2" opacity={0.5} />
      <Path d="M130 85 L130 90" stroke={color} strokeWidth="2" opacity={0.5} />
      {/* Main rotor */}
      <Path d="M105 35 L105 22" stroke={color} strokeWidth="3" opacity={0.8} />
      <Path d="M25 20 L185 24" stroke={color} strokeWidth="3" strokeLinecap="round" opacity={0.5} />
      {/* Engines on top */}
      <Path d="M85 35 L85 30 L95 30 L95 35" fill={color} opacity={0.6} />
      <Path d="M115 35 L115 30 L125 30 L125 35" fill={color} opacity={0.6} />
      {/* Cockpit */}
      <Path d="M145 40 Q160 45 160 60 Q160 75 145 80" fill={color} opacity={0.5} />
    </Svg>
  );
}

export function AircraftSilhouette({ category, engineType, label, size = 100 }: Props) {
  const w = size * 1.7;
  const h = size;
  const color = Colors.primary;

  const Silhouette = category === 'helicopter'
    ? (engineType === 'me' ? MultiHelicopter : SingleHelicopter)
    : (engineType === 'me' ? MultiEngineAirplane : SingleEngineAirplane);

  return (
    <View style={{ alignItems: 'center', gap: 4, paddingVertical: 8 }}>
      <Silhouette w={w} h={h} color={color} />
      {label ? (
        <Text style={{
          color: Colors.textSecondary, fontSize: 11, fontWeight: '700',
          letterSpacing: 0.5, textTransform: 'uppercase',
        }}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}
