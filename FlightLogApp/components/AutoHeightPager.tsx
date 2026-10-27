// Horisontell sid-karusell vars höjd FÖLJER kortet som visas: i vila är karusellen exakt lika hög som det synliga
// kortet, och medan man sveper glider höjden mjukt mellan korten. Ett högre (eller lägre) kort längre bort påverkar
// alltså inte avståndet till det som ligger under (sidprickar, knappar). Används av dashboardens senaste
// flygningar och Fleet-karusellerna (pilot + drönare). Barnen = en sida var; de läggs i en ruta med pageWidth.
import { Children, forwardRef, isValidElement, useMemo, useRef, useState, type ReactNode } from 'react';
import { Animated, View, type LayoutChangeEvent, type ScrollView, type ScrollViewProps } from 'react-native';

type Props = Omit<ScrollViewProps, 'horizontal' | 'children'> & { pageWidth: number; children: ReactNode };

export const AutoHeightPager = forwardRef<ScrollView, Props>(function AutoHeightPager(
  { pageWidth, children, onScroll, style, contentContainerStyle, ...rest }, ref,
) {
  const pages = Children.toArray(children);
  const scrollX = useRef(new Animated.Value(0)).current;
  // Varje sidas naturliga höjd (sidorna sträcks INTE till det högsta kortet: alignItems flex-start).
  const [heights, setHeights] = useState<number[]>([]);
  const onPageLayout = (i: number) => (e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    setHeights((prev) => {
      if (prev[i] === h) return prev;
      const next = [...prev];
      next[i] = h;
      return next;
    });
  };

  const count = pages.length;
  const ready = count > 1 && pages.every((_, i) => (heights[i] ?? 0) > 0);
  const height = useMemo(
    () => (ready
      ? scrollX.interpolate({
        inputRange: pages.map((_, i) => i * pageWidth),
        outputRange: pages.map((_, i) => heights[i]),
        extrapolate: 'clamp',
      })
      : undefined),
    [ready, heights, pageWidth, count], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const handleScroll = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: false, listener: onScroll as any }),
    [onScroll, scrollX],
  );

  return (
    <Animated.ScrollView
      ref={ref as any}
      horizontal
      showsHorizontalScrollIndicator={false}
      scrollEventThrottle={16}
      {...rest}
      onScroll={handleScroll}
      style={[style, height !== undefined && { height }]}
      contentContainerStyle={[{ alignItems: 'flex-start' }, contentContainerStyle]}
    >
      {pages.map((child, i) => (
        <View key={isValidElement(child) && child.key != null ? child.key : i} style={{ width: pageWidth }} onLayout={onPageLayout(i)}>
          {child}
        </View>
      ))}
    </Animated.ScrollView>
  );
});
