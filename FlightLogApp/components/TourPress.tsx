// Blades introduction — "tryck-markering". Släpps in i en knapp/rad som rundturen trycker på.
// Ligger som en absolut overlay OVANPÅ knappens innehåll (pointerEvents none → rör aldrig trycket)
// och är helt osynlig tills rundturen pekar ut just detta id (pressTarget). Då tänds en cyan ram +
// en kort mörk "tryck"-dimning, så användaren ser vilken knapp rundturen öppnar nästa sida med.

import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, withSequence, Easing } from 'react-native-reanimated';
import { useTourStore } from '../store/tourStore';

export function TourPress({ id, radius = 10 }: { id: string; radius?: number }) {
  const active = useTourStore((s) => s.pressTarget === id);
  const ring = useSharedValue(0);  // cyan-ramens synlighet
  const press = useSharedValue(0); // mörk tryck-dimning (tänds → släpps lite → kvar svagt)

  useEffect(() => {
    if (active) {
      ring.value = withTiming(1, { duration: 150, easing: Easing.out(Easing.quad) });
      press.value = withSequence(
        withTiming(0.26, { duration: 150, easing: Easing.out(Easing.quad) }),
        withTiming(0.12, { duration: 230, easing: Easing.inOut(Easing.quad) }),
      );
    } else {
      ring.value = withTiming(0, { duration: 200 });
      press.value = withTiming(0, { duration: 200 });
    }
  }, [active, ring, press]);

  const ringStyle = useAnimatedStyle(() => ({ opacity: ring.value }));
  const pressStyle = useAnimatedStyle(() => ({ opacity: press.value }));

  return (
    <>
      <Animated.View pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderRadius: radius, backgroundColor: '#000000' }, pressStyle]} />
      <Animated.View pointerEvents="none"
        style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: 2, borderColor: '#00C8E8' }, ringStyle]} />
    </>
  );
}
