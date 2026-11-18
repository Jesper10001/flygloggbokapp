// Kartknapparna nere till höger på Global map, i Apple Kartor-stil (design 2026-11-18, artifact
// BZeSBM6qZVe53pHAoznFhd): kompass överst (bara när kartan är vriden; tryck = norr uppåt), News som egen
// rund knapp, och en kapsel med kartlager (ikonen visar lagret man tittar på: grön-cyan jordglob på satellit,
// gråvit karta på det mörka lagret) och min position (Apples pil; fylld cyan när kartan står på dig).
import { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, ActivityIndicator, type ViewStyle, type StyleProp } from 'react-native';
import Svg, { Path, Circle, G, Text as SvgText } from 'react-native-svg';
import { Colors } from '../constants/colors';

const GLASS = 'rgba(28,34,46,0.86)';

function Compass({ heading }: { heading: number }) {
  return (
    <Svg width={44} height={44} viewBox="0 0 44 44" style={{ transform: [{ rotate: `${-heading}deg` }] }}>
      <G stroke="rgba(255,255,255,0.55)" strokeWidth={1.2} strokeLinecap="round">
        <Path d="M22 4.5v3" /><Path d="M39.5 22h-3" /><Path d="M22 39.5v-3" /><Path d="M4.5 22h3" />
        <Path d="M34.4 9.6l-1.6 1.6" /><Path d="M34.4 34.4l-1.6-1.6" /><Path d="M9.6 34.4l1.6-1.6" /><Path d="M9.6 9.6l1.6 1.6" />
      </G>
      <Path d="M22 3.2l3 4.6h-6z" fill="#FF453A" />
      <SvgText x={22} y={27.5} textAnchor="middle" fontSize={15} fontWeight="600" fill="#FFFFFF">N</SvgText>
    </Svg>
  );
}

function NewsIcon() {
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth={1.8} strokeLinejoin="round">
      <Path d="M4 5h13v14H6a2 2 0 0 1-2-2V5z" /><Path d="M17 9h3v8a2 2 0 0 1-2 2" /><Path d="M7 9h7M7 12.5h7M7 16h4" />
    </Svg>
  );
}

function LayerIcon({ satellite }: { satellite: boolean }) {
  return satellite ? (
    <Svg width={23} height={23} viewBox="0 0 24 24" fill="none" strokeWidth={1.8} strokeLinecap="round">
      <Circle cx={12} cy={12} r={9} stroke={Colors.primary} />
      <Path d="M7.5 6.5c1.5 1 1.2 2.6 2.8 3.1 1.4.4 1.1 2.2 0 2.8-1.2.7-.6 2.4-1.8 3.4" stroke="#7FD99A" />
      <Path d="M15.5 4.6c-.6 1.5.4 2.4 1.6 2.6 1.3.2 1.6 1.6 1 2.6" stroke="#7FD99A" />
      <Path d="M14 14.5c1 .3 1.4 1.4 2.6 1.3" stroke="#7FD99A" />
    </Svg>
  ) : (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" strokeWidth={1.8} strokeLinejoin="round">
      <Path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6z" stroke="#C9D6E6" fill="rgba(201,214,230,0.12)" />
      <Path d="M9 4v14M15 6v14" stroke="#C9D6E6" />
    </Svg>
  );
}

function ArrowIcon({ active, off }: { active: boolean; off: boolean }) {
  const c = off ? 'rgba(255,255,255,0.4)' : active ? Colors.primary : '#FFFFFF';
  return (
    <Svg width={21} height={21} viewBox="0 0 24 24" fill={active ? c : 'none'} stroke={c} strokeWidth={1.8} strokeLinejoin="round">
      <Path d="M20.5 3.5L3.8 10.6l7.1 2.5 2.5 7.1z" />
    </Svg>
  );
}

export function MapControlStack({ style, heading, onNorth, onNews, satellite, onToggleLayer, meActive, meBusy, locOff, onMe, onOpenSettings }: {
  style?: StyleProp<ViewStyle>;
  heading: number;          // kartans vridning i grader
  onNorth: () => void;
  onNews: () => void;
  satellite: boolean;
  onToggleLayer: () => void;
  meActive: boolean;
  meBusy: boolean;
  locOff: boolean;          // platstjänster nekade → ruta med "Open Settings"
  onMe: () => void;
  onOpenSettings: () => void;
}) {
  const h = ((heading % 360) + 360) % 360;
  const turned = h > 2 && h < 358;
  // Kompassen tonar in/ut i stället för att hoppa.
  const fade = useRef(new Animated.Value(turned ? 1 : 0)).current;
  useEffect(() => { Animated.timing(fade, { toValue: turned ? 1 : 0, duration: 220, useNativeDriver: true }).start(); }, [turned, fade]);

  return (
    <View style={[{ alignItems: 'flex-end', gap: 10 }, style]} pointerEvents="box-none">
      {locOff && (
        <View style={s.toast}>
          <Text style={s.toastTxt}>Location is off for Blades.</Text>
          <TouchableOpacity onPress={onOpenSettings} hitSlop={8} accessibilityRole="button">
            <Text style={s.toastLink}>Open Settings</Text>
          </TouchableOpacity>
        </View>
      )}
      <View style={{ alignItems: 'center', gap: 10 }} pointerEvents="box-none">
        <Animated.View style={{ opacity: fade, transform: [{ scale: fade.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }] }} pointerEvents={turned ? 'auto' : 'none'}>
          <TouchableOpacity onPress={onNorth} activeOpacity={0.8} style={s.round} accessibilityRole="button" accessibilityLabel="Turn map to north">
            <Compass heading={h} />
          </TouchableOpacity>
        </Animated.View>
        <TouchableOpacity onPress={onNews} activeOpacity={0.8} style={s.round} accessibilityRole="button" accessibilityLabel="News">
          <NewsIcon />
        </TouchableOpacity>
        <View style={s.capsule}>
          <TouchableOpacity onPress={onToggleLayer} activeOpacity={0.7} style={s.cell} accessibilityRole="button"
            accessibilityLabel={satellite ? 'Map layer: satellite. Tap for dark map' : 'Map layer: dark map. Tap for satellite'}>
            <LayerIcon satellite={satellite} />
          </TouchableOpacity>
          <View style={s.divider} />
          <TouchableOpacity onPress={onMe} activeOpacity={0.7} style={s.cell} accessibilityRole="button"
            accessibilityLabel="Show my position" accessibilityState={{ selected: meActive, busy: meBusy }}>
            {meBusy ? <ActivityIndicator size="small" color="#FFFFFF" /> : <ArrowIcon active={meActive} off={locOff} />}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  round: { width: 48, height: 48, borderRadius: 24, backgroundColor: GLASS, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  capsule: { width: 48, borderRadius: 24, backgroundColor: GLASS, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.22)',
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
  cell: { height: 50, alignItems: 'center', justifyContent: 'center' },
  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 9, backgroundColor: 'rgba(255,255,255,0.25)' },
  toast: { maxWidth: 260, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 14,
    backgroundColor: GLASS, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.22)' },
  toastTxt: { color: '#FFFFFF', fontSize: 12.5, flexShrink: 1 },
  toastLink: { color: Colors.primary, fontSize: 12.5, fontWeight: '700' },
});
