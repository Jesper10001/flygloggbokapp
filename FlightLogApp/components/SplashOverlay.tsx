import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useProfileStore } from '../store/profileStore';

// Rotation som gör att nosen pekar NEDÅT. Justera om symbolens nos pekar åt
// annat håll i källbilden (90 = sidovy höger→ner, 270 = sidovy vänster→ner).
const PLANE_ROTATE = '180deg';

// Splash vid varje app-laddning (2s): logo-splashscreen i bakgrunden och en stor
// flygplanssymbol som flyger förbi uppifrån och ner (kortsida → kortsida).
export function SplashOverlay() {
  const { width: W, height: H } = useWindowDimensions();
  // Flygplanet visas bara för bemannad pilot (helikopter/flygplan); andra
  // användare ser bara splash-loggan.
  const showPlane = useProfileStore(s => s.profile?.mainRole) === 'pilot-manned';
  const [visible, setVisible] = useState(true);
  const opacity = useRef(new Animated.Value(1)).current;
  const fly = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(fly, { toValue: 1, duration: 1800, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    const t = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 450, useNativeDriver: true })
        .start(() => setVisible(false));
    }, 2000);
    return () => { clearTimeout(t); loop.stop(); };
  }, [opacity, fly]);

  if (!visible) return null;

  const planeSize = Math.max(W, H) * 1.15; // stor — täcker skärmen
  const travel = H / 2 + planeSize / 2;    // helt ovanför → helt nedanför
  const translateY = fly.interpolate({ inputRange: [0, 1], outputRange: [-travel, travel] });

  return (
    <Animated.View style={[StyleSheet.absoluteFill, s.wrap, { opacity }]} pointerEvents="none">
      <Image source={require('../assets/logo-splashscreen.PNG')} style={StyleSheet.absoluteFill} resizeMode="cover" />
      {showPlane && (
        <View style={s.flyLayer}>
          <Animated.Image
            source={require('../assets/Pilot-fixedwing.PNG')}
            style={{ width: planeSize, height: planeSize, transform: [{ translateY }, { rotate: PLANE_ROTATE }] }}
            resizeMode="contain"
          />
        </View>
      )}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { backgroundColor: '#000000', zIndex: 9999 },
  flyLayer: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
