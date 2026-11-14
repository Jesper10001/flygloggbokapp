// Fleet-kortens urklipp (luftfartyget som spiller ner över statistiken) döljs medan man håller fingret på
// kortet eller drar listan/karusellen, så att siffrorna under går att läsa. Släpper man tonas det tillbaka.
// Delat läge för pilot- och drönarkorten: kortet rapporterar sina egna touch-händelser (cardTouchProps) och
// Fleet-vyernas ScrollView + karusell rapporterar drag/momentum (fleetScrollProps). När en ScrollView tar
// över fingret kommer touchCancel i stället för touchEnd — då håller scroll-läget bilden dold tills
// rörelsen stannat.
import { useEffect, useRef } from 'react';
import { Animated, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';

let touching = false;
let scrolling = false;
let endTimer: ReturnType<typeof setTimeout> | null = null;
const subs = new Set<(hidden: boolean) => void>();
const emit = () => { const h = touching || scrolling; subs.forEach((f) => f(h)); };

const scrollBegin = () => { if (endTimer) clearTimeout(endTimer); endTimer = null; scrolling = true; emit(); };
// Efter släpp kan momentum följa (onMomentumScrollBegin avbryter timern) — vänta en stund innan bilden kommer tillbaka.
const scrollEnd = (delay: number) => {
  if (endTimer) clearTimeout(endTimer);
  endTimer = setTimeout(() => { endTimer = null; scrolling = false; emit(); }, delay);
};

export const cardTouchProps = {
  onTouchStart: () => { touching = true; emit(); },
  onTouchEnd: () => { touching = false; emit(); },
  onTouchCancel: () => { touching = false; emit(); },
};

type ScrollEv = NativeSyntheticEvent<NativeScrollEvent>;
export const fleetScrollProps = {
  onScrollBeginDrag: (_e: ScrollEv) => scrollBegin(),
  onScrollEndDrag: (_e: ScrollEv) => scrollEnd(160),
  onMomentumScrollBegin: (_e: ScrollEv) => scrollBegin(),
  onMomentumScrollEnd: (_e: ScrollEv) => scrollEnd(0),
};

// Opacitet för urklippet: 0 medan man håller/drar, tillbaka till 1 strax efter släpp.
export function useFleetHoldOpacity() {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const f = (hidden: boolean) => {
      opacity.stopAnimation();
      Animated.timing(opacity, hidden
        ? { toValue: 0, duration: 140, useNativeDriver: true }
        : { toValue: 1, duration: 280, delay: 180, useNativeDriver: true }).start();
    };
    subs.add(f);
    return () => { subs.delete(f); };
  }, [opacity]);
  return opacity;
}
