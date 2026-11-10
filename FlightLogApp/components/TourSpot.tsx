// Blades introduction — "ljuset". Släpps in i det som ett stopp ska visa (en knapp, ett kort, en rad) och
// ligger som en osynlig overlay över det. När rundturen pekar ut id:t mäter den sin ruta i fönstret och
// rapporterar den till tourStore; TourHost dämpar då resten av skärmen och ritar en cyan ram runt rutan.
// Rutan mäts om några gånger i sekunden medan stoppet visas, så ljuset följer med när sidan rullar eller
// innehållet laddas in — rundturen behöver inte gissa med fasta pauser när något är "klart".

import { useEffect, useRef } from 'react';
import { View, StyleSheet, type LayoutChangeEvent, type ScrollView } from 'react-native';
import { useTourStore } from '../store/tourStore';

export function TourSpot({ id, radius = 16, inset = 4 }: { id: string; radius?: number; inset?: number }) {
  const on = useTourStore((s) => s.active && s.spots.includes(id));
  const ref = useRef<View>(null);
  useEffect(() => {
    if (!on) return;
    let dead = false;
    const measure = () => {
      ref.current?.measureInWindow((x, y, w, h) => {
        if (dead || !(w > 0 && h > 0)) return;
        useTourStore.getState().setSpotRect(id, { x: x - inset, y: y - inset, w: w + inset * 2, h: h + inset * 2, r: radius });
      });
    };
    measure();
    const t = setInterval(measure, 200);
    return () => { dead = true; clearInterval(t); useTourStore.getState().setSpotRect(id, null); };
  }, [on, id, inset, radius]);
  return <View ref={ref} collapsable={false} pointerEvents="none" style={StyleSheet.absoluteFill} />;
}

/**
 * Rullar fram det som ska lysas upp. Lägg onLayout-hanteraren på ett element som ligger DIREKT i
 * rullistans innehåll; när rundturen pekar ut id:t rullas listan så att elementet hamnar `above` px under
 * listans överkant (0 = högst upp).
 */
export function useTourScrollTo(id: string, scrollRef: { current: ScrollView | null }, above = 12) {
  const y = useRef(0);
  const on = useTourStore((s) => s.active && s.spots.includes(id));
  useEffect(() => {
    if (!on) return;
    const t = setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, y.current - above), animated: true }), 60);
    return () => clearTimeout(t);
  }, [on]); // eslint-disable-line react-hooks/exhaustive-deps
  return (e: LayoutChangeEvent) => { y.current = e.nativeEvent.layout.y; };
}
