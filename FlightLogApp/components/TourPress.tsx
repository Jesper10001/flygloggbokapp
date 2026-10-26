// Blades introduction — "tryck-markering". Släpps in i en knapp/rad som rundturen trycker på.
// Ligger som en absolut overlay OVANPÅ knappens innehåll (pointerEvents none → rör aldrig trycket)
// och är helt osynlig tills rundturen pekar ut just detta id (pressTarget). Då tänds en cyan ram +
// en kort mörk "tryck"-dimning, så användaren ser vilken knapp rundturen öppnar nästa sida med.
// variant="focus": för fält som loggningsdemon fyller i — cyan ram + svag cyan ton, ingen dimning
// (innehållet ska synas medan det skrivs). inset > 0 lägger ramen en bit utanför elementet.

import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSequence, withRepeat, Easing } from 'react-native-reanimated';
import { useTourStore } from '../store/tourStore';

export function TourPress({ id, radius = 10, variant = 'press', inset = 0 }: { id: string; radius?: number; variant?: 'press' | 'focus'; inset?: number }) {
  const active = useTourStore((s) => s.pressTarget === id);
  const ring = useSharedValue(0);  // cyan-ramens synlighet
  const press = useSharedValue(0); // mörk tryck-dimning (tänds → släpps lite → kvar svagt)
  const tint = useSharedValue(0);  // focus: svag cyan ton som andas långsamt

  useEffect(() => {
    if (active) {
      ring.value = withTiming(1, { duration: 150, easing: Easing.out(Easing.quad) });
      if (variant === 'focus') {
        tint.value = withRepeat(withSequence(
          withTiming(0.13, { duration: 520, easing: Easing.inOut(Easing.quad) }),
          withTiming(0.05, { duration: 520, easing: Easing.inOut(Easing.quad) }),
        ), -1, false);
      } else {
        press.value = withSequence(
          withTiming(0.26, { duration: 150, easing: Easing.out(Easing.quad) }),
          withTiming(0.12, { duration: 230, easing: Easing.inOut(Easing.quad) }),
        );
      }
    } else {
      ring.value = withTiming(0, { duration: 200 });
      press.value = withTiming(0, { duration: 200 });
      tint.value = withTiming(0, { duration: 200 });
    }
  }, [active, variant, ring, press, tint]);

  const fill = inset ? [StyleSheet.absoluteFill, { top: -inset, left: -inset, right: -inset, bottom: -inset }] : StyleSheet.absoluteFill;
  const ringStyle = useAnimatedStyle(() => ({ opacity: ring.value }));
  const pressStyle = useAnimatedStyle(() => ({ opacity: press.value }));
  const tintStyle = useAnimatedStyle(() => ({ opacity: tint.value }));

  return (
    <>
      {variant === 'focus' ? (
        <Animated.View pointerEvents="none"
          style={[fill, { borderRadius: radius, backgroundColor: '#00C8E8' }, tintStyle]} />
      ) : (
        <Animated.View pointerEvents="none"
          style={[fill, { borderRadius: radius, backgroundColor: '#000000' }, pressStyle]} />
      )}
      <Animated.View pointerEvents="none"
        style={[fill, { borderRadius: radius, borderWidth: 2, borderColor: '#00C8E8' }, ringStyle]} />
    </>
  );
}
