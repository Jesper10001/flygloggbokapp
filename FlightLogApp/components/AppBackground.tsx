// Appens bakgrund bakom flikarna: i stället för en platt navy-yta en svag gradient i samma navy-familj —
// ljus som faller in uppifrån (blått sken bakom headern), ett svagt sken i accentfärgen nere till vänster och
// en djupare botten. Ritas EN gång bakom flik-navigatorn (app/(tabs)/_layout.tsx); flikskärmarnas rötter och
// header är genomskinliga så den syns igenom. Statisk SVG → ingen kostnad per bildruta.
import { memo } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { Colors } from '../constants/colors';

function AppBackgroundImpl({ accent = Colors.primary }: { accent?: string }) {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: Colors.background }]}>
      <Svg width="100%" height="100%">
        <Defs>
          {/* Grundton: lite lyft topp → appens navy → djupare botten (glasbaren vilar mot det mörkaste). */}
          <LinearGradient id="bgBase" x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0" stopColor="#0C1C35" />
            <Stop offset="0.4" stopColor="#0A1628" />
            <Stop offset="0.7" stopColor="#091424" />
            <Stop offset="1" stopColor="#060C18" />
          </LinearGradient>
          {/* Ljus uppifrån: brett blått sken bakom statusraden/headern som tonar ut mot mitten. */}
          <RadialGradient id="bgTop" cx="70%" cy="0%" rx="100%" ry="40%" fx="70%" fy="0%">
            <Stop offset="0" stopColor="#346EC8" stopOpacity={0.32} />
            <Stop offset="1" stopColor="#346EC8" stopOpacity={0} />
          </RadialGradient>
          {/* Svag indigo-ton till höger på mitten → djup utan att korten tappar kontrast. */}
          <RadialGradient id="bgSide" cx="100%" cy="55%" rx="70%" ry="30%" fx="100%" fy="55%">
            <Stop offset="0" stopColor="#3C46AA" stopOpacity={0.1} />
            <Stop offset="1" stopColor="#3C46AA" stopOpacity={0} />
          </RadialGradient>
          {/* Accentsken nere till vänster (cyan för pilot, drönarens accentfärg i drönarläge). */}
          <RadialGradient id="bgAccent" cx="0%" cy="88%" rx="85%" ry="40%" fx="0%" fy="88%">
            <Stop offset="0" stopColor={accent} stopOpacity={0.1} />
            <Stop offset="1" stopColor={accent} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#bgBase)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#bgTop)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#bgSide)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#bgAccent)" />
      </Svg>
    </View>
  );
}

export const AppBackground = memo(AppBackgroundImpl);
