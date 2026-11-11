// Kort notis överst efter att en flygning sparats om: "Saved flight" och vad som ändrades, med + eller −
// och tiden per kategori. Försvinner av sig själv, eller när man trycker på den.
// `inline`: notisen ligger inne i en skärm (flight detail är en modal, så rotlayoutens notis syns inte där).
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { FONT_MONO } from './logbook-page/tokens';
import { useTimeFormat } from '../hooks/useTimeFormat';
import { useSavedFlightStore } from '../store/savedFlightStore';

const MAX_LINES = 6;

export function SavedFlightNotice({ inline = false }: { inline?: boolean }) {
  const insets = useSafeAreaInsets();
  const { formatTime } = useTimeFormat();
  const notice = useSavedFlightStore((s) => s.notice);
  const inlineCount = useSavedFlightStore((s) => s.inline);
  const hide = useSavedFlightStore((s) => s.hide);
  const mountInline = useSavedFlightStore((s) => s.mountInline);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => (inline ? mountInline() : undefined), [inline, mountInline]);
  useEffect(() => {
    if (!notice) return;
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [notice?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!notice || (!inline && inlineCount > 0)) return null;

  const numbers = notice.lines.filter((l) => l.kind !== 'text');
  const names = notice.lines.filter((l) => l.kind === 'text').map((l) => l.label);
  const shown = numbers.slice(0, MAX_LINES);
  const more = numbers.length - shown.length;
  const amount = (l: (typeof numbers)[number]) => (l.kind === 'time' ? formatTime(Math.abs(l.delta)) : String(Math.abs(l.delta)));
  const spoken = ['Saved flight', ...numbers.map((l) => `${l.delta > 0 ? 'plus' : 'minus'} ${amount(l)} ${l.label}`), names.length ? `Changed: ${names.join(', ')}` : '']
    .filter(Boolean).join('. ');

  return (
    <Animated.View pointerEvents="box-none"
      style={[s.wrap, { top: inline ? 8 : insets.top + 8, opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }] }]}>
      <TouchableOpacity onPress={hide} activeOpacity={0.9} style={s.card} accessibilityRole="alert" accessibilityLabel={spoken}>
        <View style={s.head}>
          <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
          <Text style={s.title}>Saved flight</Text>
        </View>
        {notice.lines.length === 0 && <Text style={s.sub}>No changes.</Text>}
        {shown.map((l) => (
          <View key={l.label} style={s.line}>
            <Text style={[s.amount, { color: l.delta > 0 ? Colors.success : Colors.warning }]}>{l.delta > 0 ? '+' : '−'} {amount(l)}</Text>
            <Text style={s.label} numberOfLines={1}>{l.label}</Text>
          </View>
        ))}
        {more > 0 && <Text style={s.sub}>And {more} more.</Text>}
        {names.length > 0 && <Text style={s.sub} numberOfLines={2}>{numbers.length ? 'Also changed' : 'Changed'}: {names.join(', ')}</Text>}
      </TouchableOpacity>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: { position: 'absolute', left: 16, right: 16, alignItems: 'center', zIndex: 9999 },
  card: {
    minWidth: 220, maxWidth: 340, gap: 5, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 16,
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.success + '77',
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 1 },
  title: { fontSize: 15, fontWeight: '800', color: Colors.textPrimary },
  line: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
  amount: { fontFamily: FONT_MONO, fontSize: 14, fontWeight: '700', minWidth: 74 },
  label: { flex: 1, fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  sub: { fontSize: 12.5, lineHeight: 17, color: Colors.textSecondary },
});
