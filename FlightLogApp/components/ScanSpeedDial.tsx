import { useRef, useState } from 'react';
import { TouchableOpacity, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Colors } from '../constants/colors';
import { GlassMenu, type GlassMenuAnchor, type GlassMenuOption } from './GlassMenu';
import { TourSpot } from './TourSpot';

// Skanningsknappen på dashboarden: ett tryck öppnar valen som glaskapslar (GlassMenu). Finns bara ett val öppnas
// det direkt.

export function ScanSpeedDial({ options, style, accessibilityLabel }: { options: GlassMenuOption[]; style?: StyleProp<ViewStyle>; accessibilityLabel: string }) {
  const ref = useRef<View>(null);
  const [anchor, setAnchor] = useState<GlassMenuAnchor | null>(null);
  const press = () => {
    if (options.length === 1) { options[0].onPress(); return; }
    ref.current?.measureInWindow((x, y, w, h) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setAnchor({ x, y, w, h });
    });
  };
  return (
    <>
      <TouchableOpacity ref={ref as any} style={style} onPress={press} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
        <Ionicons name="scan-outline" size={22} color={Colors.primary} />
        {/* Blades introduction: rundturen lyser upp knappen och visar valen själv (ingen ruta öppnas). */}
        <TourSpot id="dash-scan" radius={14} inset={0} />
      </TouchableOpacity>
      <GlassMenu anchor={anchor} options={options} onClosed={() => setAnchor(null)} />
    </>
  );
}
