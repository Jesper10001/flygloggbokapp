import { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet } from 'react-native';

// Välkomst-splash vid varje app-laddning: SAMMA logga (logo-splashscreen.png), navy-bakgrund och
// storlek som native-splashen (expo-splash-screen, imageWidth 380 på #0A1628) → sömlös övergång
// native→JS, ingen svart blink och ingen utzoomad/beskuren bild. Tonar ut efter ~1,2 s.
export function SplashOverlay() {
  const [visible, setVisible] = useState(true);
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 450, useNativeDriver: true })
        .start(() => setVisible(false));
    }, 1200);
    return () => clearTimeout(t);
  }, [opacity]);

  if (!visible) return null;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, s.wrap, { opacity }]} pointerEvents="none">
      <Image source={require('../assets/logo-splashscreen.png')} style={s.logo} resizeMode="contain" />
    </Animated.View>
  );
}

const s = StyleSheet.create({
  // Navy = samma som native-splashens backgroundColor i app.json → sömlös native→JS-övergång.
  wrap: { backgroundColor: '#0A1628', alignItems: 'center', justifyContent: 'center', zIndex: 9999 },
  logo: { width: 380, height: 380 }, // matchar native-splashens imageWidth 380
});
