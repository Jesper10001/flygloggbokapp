import { useEffect, useRef, useState } from 'react';
import { Animated, Image, StyleSheet } from 'react-native';

// Splash vid varje app-laddning (2s): assets/splashscreen.png, tonar sedan ut.
export function SplashOverlay() {
  const [visible, setVisible] = useState(true);
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const t = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 450, useNativeDriver: true })
        .start(() => setVisible(false));
    }, 2000);
    return () => clearTimeout(t);
  }, [opacity]);

  if (!visible) return null;

  return (
    <Animated.View style={[StyleSheet.absoluteFill, s.wrap, { opacity }]} pointerEvents="none">
      <Image source={require('../assets/splashscreen.png')} style={StyleSheet.absoluteFill} resizeMode="contain" />
    </Animated.View>
  );
}

const s = StyleSheet.create({
  // Svart (= native-splashens bakgrund) så nativ→JS-overlay blir sömlös.
  // Loggan är transparent → byt hit till '#0A1A33' om du vill ha navy splash.
  wrap: { backgroundColor: '#000000', zIndex: 9999 },
});
