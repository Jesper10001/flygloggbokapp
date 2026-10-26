// Flytande glas-flikrad i iOS 26-stil: en kapsel som svävar strax ovanför hemindikatorn. Innehållet rullar under
// den och syns igenom. iOS 26 → riktig Liquid Glass (expo-glass-effect); äldre iOS eller ett bygge utan
// native-modulen → systemets blur (expo-blur). Aktiv flik markeras med en ljus kapsel som glider mellan flikarna.
// Flikskärmarnas rullistor lägger useTabBarSpace() i botten, så sista raden går att rulla fram ovanför baren.
import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { View, Text, Pressable, StyleSheet, type LayoutChangeEvent } from 'react-native';
import type { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import Animated, { useSharedValue, useAnimatedStyle, withSpring, withTiming } from 'react-native-reanimated';

// expo-router har en egen kopia av bottom-tabs → ta typen från Tabs-komponentens tabBar-prop.
type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

export const TAB_BAR_HEIGHT = 62;
const SIDE = 16;
const RADIUS = TAB_BAR_HEIGHT / 2;
const PILL_INSET = 5;
const PILL_RADIUS = RADIUS - PILL_INSET;
const SPRING = { damping: 18, stiffness: 210, mass: 0.7 };
const ICON = 22;
const LABEL_GAP = 2;
const LABEL_AIR = 6;          // luft mellan etikettens hörn och kapselns rundade kant
const MIN_PILL = 64;
const LABEL_MAX_SCALE = 1.15; // som systemets flikrad: etiketterna växer inte fritt med textstorleken

// Kapselns avstånd från skärmens nederkant: strax ovanför hemindikatorn, annars en liten marginal.
function barBottom(insetBottom: number): number {
  return insetBottom > 0 ? Math.max(insetBottom - 12, 10) : 12;
}

/** Höjden som den flytande baren täcker i skärmens botten. Flikskärmarnas rullistor lägger den + sin egen
 *  marginal som paddingBottom, så sista raden går att rulla fram ovanför baren. */
export function useTabBarSpace(): number {
  const insets = useSafeAreaInsets();
  return barBottom(insets.bottom) + TAB_BAR_HEIGHT;
}

// Liquid Glass bara när både iOS 26+ och native-modulen finns. Modulen kräver ett bygge där den är länkad —
// saknas den kastar kontrollen, och då används blur i stället (ingen krasch).
let liquidGlass: boolean | null = null;
function canUseLiquidGlass(): boolean {
  if (liquidGlass === null) {
    try {
      const glass = require('expo-glass-effect');
      liquidGlass = !!glass.isLiquidGlassAvailable() && !!glass.isGlassEffectAPIAvailable();
    } catch {
      liquidGlass = false;
    }
  }
  return liquidGlass;
}

function GlassSurface() {
  if (canUseLiquidGlass()) {
    const { GlassView } = require('expo-glass-effect');
    return (
      <GlassView pointerEvents="none" glassEffectStyle="regular" colorScheme="dark" tintColor="rgba(10,22,40,0.32)"
        style={[StyleSheet.absoluteFill, { borderRadius: RADIUS }]} />
    );
  }
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, s.fallbackClip]}>
      <BlurView tint="systemThinMaterialDark" intensity={90} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(10,22,40,0.28)' }]} />
      <View style={[StyleSheet.absoluteFill, s.fallbackEdge]} />
    </View>
  );
}

type Props = BottomTabBarProps & { activeTint: string; inactiveTint: string };
type Slot = { width: number; pl: number; pr: number };
type Geometry = { barW: number; centers: number[]; wEdge: number; wMid: number; slots: Slot[] };

export function GlassTabBar({ state, descriptors, navigation, activeTint, inactiveTint }: Props) {
  const insets = useSafeAreaInsets();

  // Dolda flikar (href: null i expo-router) har display: 'none'.
  const visible = state.routes.filter((r) => StyleSheet.flatten(descriptors[r.key].options.tabBarItemStyle)?.display !== 'none');
  const isTab = (key: string) => !descriptors[key].options.tabBarButton; // mittknappen (B) är ingen flik
  const labelOf = (key: string, name: string) => {
    const o = descriptors[key].options;
    return typeof o.tabBarLabel === 'string' ? o.tabBarLabel : (o.title ?? name);
  };
  const focusedKey = state.routes[state.index]?.key;
  const focusedIsTab = visible.some((r) => r.key === focusedKey && isTab(r.key));

  // Mått: barens bredd + etiketternas naturliga bredd (osynlig mätrad, inte begränsad av flikens bredd).
  const [barW, setBarW] = useState(0);
  const [labelW, setLabelW] = useState<Record<string, number>>({});
  const [labelH, setLabelH] = useState(0);
  const onMeasureLabel = (key: string) => (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setLabelW((prev) => (prev[key] === width ? prev : { ...prev, [key]: width }));
    setLabelH((h) => (h === height ? h : height));
  };

  // Geometri: kapseln vid de yttre flikarna (Dashboard/Settings) ligger koncentriskt mot barens rundade ände och är
  // så bred att den längsta av de två etiketterna ryms även där kapseln rundar av — båda lika breda (symmetri).
  // Flikarna fördelas sedan jämnt mellan de yttre kapslarnas mitt, med B-loggan i mitten.
  const shapeKey = visible.map((r) => `${r.key}:${isTab(r.key) ? labelOf(r.key, r.name) : '*'}`).join('|');
  const geom = useMemo<Geometry | null>(() => {
    const n = visible.length;
    if (!barW || n < 2 || !labelH) return null;
    const tabs = visible.filter((r) => isTab(r.key));
    if (tabs.some((r) => labelW[r.key] == null)) return null;
    // Etikettens nederkant ligger contentH/2 under kapselns mitt; där är kapseln smalare (rundad ände).
    const dy = (ICON + LABEL_GAP + labelH) / 2;
    const roundLoss = PILL_RADIUS - Math.sqrt(Math.max(0, PILL_RADIUS * PILL_RADIUS - dy * dy));
    const need = (key: string) => labelW[key] + 2 * (LABEL_AIR + roundLoss);
    const first = visible[0].key;
    const last = visible[n - 1].key;
    const wEdge = Math.max(MIN_PILL, ...[first, last].filter(isTab).map(need));
    const wMid = Math.max(MIN_PILL, ...visible.slice(1, -1).filter((r) => isTab(r.key)).map((r) => need(r.key)));
    const c0 = PILL_INSET + wEdge / 2;
    const step = (barW - 2 * c0) / (n - 1);
    const centers = visible.map((_, i) => c0 + i * step);
    // Smala skärmar: en vald inre flik får inte nå in över den yttre grannens etikett → skjut de inre flikarna
    // (Logbook/Insights) lika mycket in mot mitten.
    if (n >= 4) {
      const lw = (i: number) => (isTab(visible[i].key) ? labelW[visible[i].key] : 0);
      const pushL = isTab(visible[1].key) ? centers[0] + lw(0) / 2 + 3 + wMid / 2 - centers[1] : 0;
      const pushR = isTab(visible[n - 2].key) ? centers[n - 2] - (centers[n - 1] - lw(n - 1) / 2 - 3 - wMid / 2) : 0;
      const push = Math.max(0, pushL, pushR);
      centers[1] += push;
      centers[n - 2] -= push;
    }
    // Tryckytor: från mittpunkt till mittpunkt; de yttre går ut till kanten med innehållet centrerat i kapseln.
    const bounds = [0, ...centers.slice(1).map((c, i) => (centers[i] + c) / 2), barW];
    const slots = centers.map((c, i) => {
      const a = bounds[i];
      const b = bounds[i + 1];
      const shift = 2 * c - a - b; // pl - pr så att innehållet hamnar på c
      return { width: b - a, pl: Math.max(0, shift), pr: Math.max(0, -shift) };
    });
    return { barW, centers, wEdge, wMid, slots };
  }, [barW, labelW, labelH, shapeKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reserv innan geometrin är klar: flikarnas uppmätta läge.
  const layouts = useRef<Record<string, { x: number; width: number }>>({});
  const [layoutTick, setLayoutTick] = useState(0);
  const onItemLayout = (key: string) => (e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    const prev = layouts.current[key];
    if (prev && prev.x === x && prev.width === width) return;
    layouts.current[key] = { x, width };
    setLayoutTick((n) => n + 1);
  };

  const pillX = useSharedValue(0);
  const pillW = useSharedValue(0);
  const pillO = useSharedValue(0);
  const placed = useRef(false);
  const placedWithGeom = useRef(false);
  useEffect(() => {
    const i = visible.findIndex((r) => r.key === focusedKey);
    let rect: { x: number; w: number } | null = null;
    if (i >= 0 && focusedIsTab) {
      if (geom) {
        if (i === 0) rect = { x: PILL_INSET, w: geom.wEdge };
        else if (i === visible.length - 1) rect = { x: geom.barW - PILL_INSET - geom.wEdge, w: geom.wEdge };
        else rect = { x: geom.centers[i] - geom.wMid / 2, w: geom.wMid };
      } else {
        const l = layouts.current[focusedKey!];
        if (l) rect = { x: l.x + 3, w: l.width - 6 };
      }
    }
    if (!rect) {
      pillO.value = withTiming(0, { duration: 150 });
      placed.current = false;
      return;
    }
    // Första placeringen, efter att den varit dold, eller när den slutliga geometrin just blivit klar:
    // ställ dit direkt (ingen glidning vid start).
    const instant = !placed.current || (!!geom && !placedWithGeom.current);
    placedWithGeom.current = !!geom;
    if (instant) {
      pillX.value = rect.x;
      pillW.value = rect.w;
      if (!placed.current) pillO.value = withTiming(1, { duration: 180 });
      placed.current = true;
    } else {
      pillX.value = withSpring(rect.x, SPRING);
      pillW.value = withSpring(rect.w, SPRING);
    }
  }, [focusedKey, focusedIsTab, layoutTick, geom]); // eslint-disable-line react-hooks/exhaustive-deps

  const pillStyle = useAnimatedStyle(() => ({
    opacity: pillO.value,
    width: pillW.value,
    transform: [{ translateX: pillX.value }],
  }));

  return (
    <View pointerEvents="box-none"
      style={[s.wrap, { bottom: barBottom(insets.bottom), left: SIDE + insets.left, right: SIDE + insets.right }]}>
      <GlassSurface />
      <View pointerEvents="none" style={s.measure} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {visible.filter((r) => isTab(r.key)).map((r) => (
          <Text key={r.key} style={s.label} maxFontSizeMultiplier={LABEL_MAX_SCALE} onLayout={onMeasureLabel(r.key)}>
            {labelOf(r.key, r.name)}
          </Text>
        ))}
      </View>
      <Animated.View pointerEvents="none" style={[s.pill, pillStyle]} />
      <View style={s.row} onLayout={(e) => setBarW(e.nativeEvent.layout.width)}>
        {visible.map((route, i) => {
          const { options } = descriptors[route.key];
          const focused = route.key === focusedKey;
          const slot = geom?.slots[i];
          const slotStyle = slot ? { flex: 0, width: slot.width, paddingLeft: slot.pl, paddingRight: slot.pr } : null;

          // Mittknappen (B-loggan) ritar sig själv och öppnar Log flight — ingen flik att markera.
          if (options.tabBarButton) {
            return (
              <View key={route.key} style={[s.item, slotStyle]} onLayout={onItemLayout(route.key)}>
                {options.tabBarButton({ children: null, onPress: undefined } as any)}
              </View>
            );
          }

          const label = labelOf(route.key, route.name);
          const color = focused ? activeTint : inactiveTint;
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
          };
          const onLongPress = () => navigation.emit({ type: 'tabLongPress', target: route.key });

          return (
            <Pressable key={route.key} onLayout={onItemLayout(route.key)} onPress={onPress} onLongPress={onLongPress}
              accessibilityRole="tab" accessibilityState={{ selected: focused }}
              accessibilityLabel={options.tabBarAccessibilityLabel ?? label} testID={options.tabBarButtonTestID}
              style={({ pressed }) => [s.item, slotStyle, pressed && { opacity: 0.6 }]}>
              {options.tabBarIcon?.({ focused, color, size: ICON })}
              <Text numberOfLines={1} maxFontSizeMultiplier={LABEL_MAX_SCALE} style={[s.label, { color }]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', height: TAB_BAR_HEIGHT, borderRadius: RADIUS },
  fallbackClip: { borderRadius: RADIUS, overflow: 'hidden' },
  fallbackEdge: { borderRadius: RADIUS, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)' },
  measure: { position: 'absolute', left: 0, top: 0, width: 2000, flexDirection: 'row', alignItems: 'flex-start', opacity: 0 },
  pill: {
    position: 'absolute', left: 0, top: PILL_INSET, bottom: PILL_INSET, borderRadius: PILL_RADIUS,
    backgroundColor: 'rgba(255,255,255,0.11)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)',
  },
  row: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'stretch' },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: LABEL_GAP },
  label: { fontSize: 10.5, fontWeight: '600', letterSpacing: 0.2 },
});
