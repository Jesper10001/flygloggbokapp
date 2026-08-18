// Rullande text (ticker): texten flyter från höger till vänster i loop så långa strängar hinner läsas.
//
// Mätningen är det kluriga: en <Text> i en vanlig <View> med bestämd bredd mäts med "AtMost(bredd)",
// så numberOfLines={1} kapar texten vid container-bredden ("ESSA Stockholm Arlan…") och inget scrollar.
// Lösningen: lägg texten i en HORISONTELL ScrollView — den mäter sitt innehåll med OBEGRÄNSAD bredd
// (så scroll-innehåll kan bli bredare än ramen), vilket ger textens fulla naturliga bredd via onLayout.
// En yttre View klipper (overflow:'hidden') och ger höjd; själva rörelsen är translateX på texten.
import { useEffect, useRef, useState } from 'react';
import { Animated, View, ScrollView, Easing, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

export function Marquee({ text, textStyle, containerStyle, speed = 65 }: {
  text: string;
  textStyle?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  speed?: number; // pixlar per sekund
}) {
  const [cw, setCw] = useState(0);                  // container-bredd (ramen)
  const [size, setSize] = useState({ w: 0, h: 0 }); // textens naturliga mått
  const x = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!cw || !size.w) return;
    const distance = size.w + cw; // från off-höger till off-vänster
    x.setValue(cw);
    const anim = Animated.loop(
      Animated.timing(x, {
        toValue: -size.w,
        duration: (distance / speed) * 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    anim.start();
    return () => { anim.stop(); };
  }, [cw, size.w, speed, text, x]);

  return (
    <View
      pointerEvents="none"
      style={[{ overflow: 'hidden', height: size.h || undefined }, containerStyle]}
      onLayout={(e) => setCw(e.nativeEvent.layout.width)}
    >
      <ScrollView horizontal scrollEnabled={false} showsHorizontalScrollIndicator={false}>
        <Animated.Text
          numberOfLines={1}
          onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
          style={[textStyle, { transform: [{ translateX: x }] }]}
        >
          {text}
        </Animated.Text>
      </ScrollView>
    </View>
  );
}
