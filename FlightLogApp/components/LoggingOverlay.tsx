import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import { useLoggingOverlayStore } from '../store/loggingOverlayStore';
import { useFlightStore } from '../store/flightStore';

// Liten snurrande "loggar flygning"-indikator som placeras i dashboardens
// header (till höger om välkomsttexten). Premium → guld, annars cyan. Visas
// medan en ny flygning loggas och dashboarden uppdateras.
export function LoggingSpinner({ size = 28 }: { size?: number }) {
  const visible = useLoggingOverlayStore(s => s.visible);
  const isPremium = useFlightStore(s => s.isPremium);
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    spin.setValue(0);
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 850, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, spin]);

  if (!visible) return null;

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const src = isPremium
    ? require('../assets/refresh-gold.PNG')
    : require('../assets/refresh-cyan.PNG');

  return (
    <Animated.Image
      source={src}
      style={{ width: size, height: size, transform: [{ rotate }] }}
      resizeMode="contain"
    />
  );
}
