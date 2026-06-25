// 3-(eller 4-)vägs ikon-väljare (List / Book / Fleet [/ Weapons]).
import { View, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Colors } from '../../constants/colors';

export type ToggleOption<T extends string> = { key: T; icon: keyof typeof Ionicons.glyphMap };

export function SegmentedToggle<T extends string>({ options, value, onChange, accent }: {
  options: ToggleOption<T>[]; value: T; onChange: (v: T) => void; accent: string;
}) {
  return (
    <View style={{ flexDirection: 'row', gap: 3, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: 9, padding: 3 }}>
      {options.map((o) => {
        const sel = value === o.key;
        return (
          <TouchableOpacity
            key={o.key}
            onPress={() => { Haptics.selectionAsync(); onChange(o.key); }}
            activeOpacity={0.8}
            style={{ width: 32, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: sel ? accent : 'transparent' }}
          >
            <Ionicons name={o.icon} size={15} color={sel ? Colors.background : Colors.textSecondary} />
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
