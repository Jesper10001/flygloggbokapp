// Settings-kortet för loggbok och layout (design C2, 2026-11-11). Kortet visar vad man använder nu
// ("Pilot logbook · Fixed & Rotary wing" + FULL) och knappen "Switch logbook or layout" öppnar ett
// ark med två val: loggbok (Pilot | Drone) och layout (Full = Blades Extensive | Essential). Knappen längst
// ner säger vad som händer ("Switch to Drone logbook" osv.), så ingen extra bekräftelseruta behövs.
// Själva loggboksbytet (switchProfile) sköts av föräldern via onConfirmSwitch; Essential-bytet görs här
// (samma steg som den gamla AppVariantToggle: replace till /essential, sedan setVariant).
// Delad av pilot- och drönar-settings. IntroductionButton = den centrerade pillerknappen under kortet.
import { useState } from 'react';
import { View, Text, Pressable, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Colors } from '../../constants/colors';
import { DR } from '../../constants/droneTheme';
import { useAppVariantStore } from '../../store/appVariantStore';

const SAFE_GREEN = DR.success; // "datan finns kvar" — tydligt grön (cyan-accenten skulle smälta ihop)

type Mode = 'manned' | 'drone';
type Layout = 'full' | 'essential';

const LOGBOOKS: Record<Mode, { title: string; line1: string; icon: keyof typeof Ionicons.glyphMap }> = {
  manned: { title: 'Pilot', line1: 'Fixed & Rotary wing', icon: 'airplane-outline' },
  drone: { title: 'Drone', line1: 'Commercial, military or hobby', icon: 'hardware-chip-outline' },
};

function Radio({ on }: { on: boolean }) {
  return (
    <View style={[st.radio, on && { borderColor: Colors.primary }]}>
      {on ? <View style={st.radioDot} /> : null}
    </View>
  );
}

export function ModeToggleRow({ mode, onConfirmSwitch }: {
  mode: Mode;
  onConfirmSwitch: (target: Mode) => void;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [pickMode, setPickMode] = useState<Mode>(mode);
  const [pickLayout, setPickLayout] = useState<Layout>('full');
  const cur = LOGBOOKS[mode];

  // Inställningarna visas bara i Full (Essential har egna skärmar), så nuvarande layout är alltid Full.
  const openSheet = () => { setPickMode(mode); setPickLayout('full'); setOpen(true); };
  const close = () => setOpen(false);

  const modeChanged = pickMode !== mode;
  const toEssential = pickLayout === 'essential';
  const cta = modeChanged && toEssential ? `Switch to ${LOGBOOKS[pickMode].title} · Essential`
    : modeChanged ? `Switch to ${LOGBOOKS[pickMode].title} logbook`
    : toEssential ? 'Use the Essential layout'
    : 'Done';

  const apply = () => {
    close();
    if (!modeChanged && !toEssential) return;
    try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch { /* haptik valfri */ }
    // Låt arket glida ut innan bytet (som byter skärm) — en Modal som stängs mitt i en navigering kan hänga sig.
    setTimeout(() => {
      if (modeChanged) onConfirmSwitch(pickMode);
      if (toEssential) {
        // Efter ett loggboksbyte byggs flikarna om (key={mode}); vänta in det innan Essential tar över.
        setTimeout(() => {
          router.replace('/essential');
          // Efter övergången: flikarna skickar vidare till Essential så fort varianten ändras och skulle bli tomma under den.
          setTimeout(() => { useAppVariantStore.getState().setVariant('essential').catch(() => {}); }, 500);
        }, modeChanged ? 600 : 0);
      }
    }, 280);
  };

  return (
    <>
      <View style={st.card}>
        <View style={st.cardTop}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={st.cardTitle}>{cur.title} logbook</Text>
            <Text style={st.cardSub}>{cur.line1}</Text>
          </View>
          <View style={st.tag}><Text style={st.tagText}>FULL</Text></View>
        </View>
        <TouchableOpacity onPress={openSheet} activeOpacity={0.7} style={st.cardBtn}
          accessibilityRole="button" accessibilityLabel={`${cur.title} logbook, full layout. Switch logbook or layout`}>
          <Ionicons name="swap-horizontal" size={18} color={Colors.primary} />
          <Text style={st.cardBtnText}>Switch logbook or layout</Text>
          <Ionicons name="chevron-forward" size={17} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <Pressable style={st.backdrop} onPress={close}>
          <Pressable style={[st.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
            <BlurView pointerEvents="none" tint="systemThickMaterialDark" intensity={80} style={StyleSheet.absoluteFill} />
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(12,26,48,0.55)' }]} />
            <View style={st.grabber} />
            <View style={st.head}>
              <Text style={st.title}>Logbook and layout</Text>
              <TouchableOpacity onPress={close} hitSlop={10} accessibilityLabel="Close" style={st.closeBtn}>
                <Ionicons name="close" size={22} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <Text style={st.label}>LOGBOOK</Text>
            {(['manned', 'drone'] as Mode[]).map((m) => {
              const on = pickMode === m;
              const lb = LOGBOOKS[m];
              return (
                <TouchableOpacity key={m} onPress={() => setPickMode(m)} activeOpacity={0.8}
                  style={[st.option, on && st.optionOn]}
                  accessibilityRole="radio" accessibilityState={{ selected: on }}
                  accessibilityLabel={`${lb.title} logbook. ${lb.line1}`}>
                  <View style={[st.optIcon, { backgroundColor: on ? Colors.primary + '24' : 'rgba(255,255,255,0.06)' }]}>
                    <Ionicons name={lb.icon} size={19} color={on ? Colors.primary : Colors.textSecondary} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={st.optTitle}>{lb.title}</Text>
                    <Text style={st.optSub}>{lb.line1}</Text>
                  </View>
                  <Radio on={on} />
                </TouchableOpacity>
              );
            })}

            <Text style={[st.label, { marginTop: 4 }]}>LAYOUT</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {([
                ['full', 'Full', 'Dashboard, Logbook, Insights and every tool'],
                ['essential', 'Essential', 'One screen: totals, log a flight, import and export'],
              ] as [Layout, string, string][]).map(([k, t, d]) => {
                const on = pickLayout === k;
                return (
                  <TouchableOpacity key={k} onPress={() => setPickLayout(k)} activeOpacity={0.8}
                    style={[st.option, st.layoutOpt, on && st.optionOn]}
                    accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${t} layout. ${d}`}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Text style={st.optTitle}>{t}</Text>
                      <Radio on={on} />
                    </View>
                    <Text style={st.optSub}>{d}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={st.safe}>
              <View style={st.safeIcon}><Ionicons name="shield-checkmark-outline" size={24} color={SAFE_GREEN} /></View>
              <View style={{ flex: 1, gap: 3 }}>
                <Text style={st.safeTitle}>All your data is kept</Text>
                <Text style={st.safeText}>Switching only changes which logbook you see. Nothing is deleted.</Text>
              </View>
            </View>

            <TouchableOpacity onPress={apply} activeOpacity={0.85} style={st.cta} accessibilityRole="button">
              <Text style={st.ctaText}>{cta}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

// Den centrerade pillerknappen "Take the Blades introduction" (stil 2 i designen).
export function IntroductionButton({ onPress }: { onPress: () => void }) {
  return (
    <View style={{ marginTop: 22, alignItems: 'center' }}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={st.pill}
        accessibilityRole="button" accessibilityLabel="Take the Blades introduction">
        <View style={st.pillPlay}>
          <Ionicons name="play" size={15} color={Colors.textInverse} style={{ marginLeft: 2 }} />
        </View>
        <Text style={st.pillText}>Take the Blades introduction</Text>
      </TouchableOpacity>
    </View>
  );
}

const st = StyleSheet.create({
  card: {
    marginHorizontal: 20, marginTop: 24, borderRadius: 20, overflow: 'hidden',
    backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.cardBorder,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 15 },
  iconTile: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: 17.5, fontWeight: '600', color: Colors.textPrimary, letterSpacing: -0.2 },
  cardSub: { fontSize: 13, color: Colors.textSecondary },
  tag: { borderWidth: 1, borderColor: Colors.cardBorder, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  tagText: { fontSize: 10.5, fontWeight: '700', letterSpacing: 1.4, color: Colors.textSecondary },
  cardBtn: {
    minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16,
    borderTopWidth: 1, borderTopColor: Colors.cardBorder,
  },
  cardBtnText: { flex: 1, fontSize: 15, fontWeight: '600', color: Colors.primary },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingHorizontal: 18, paddingTop: 8, gap: 10, overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)',
  },
  grabber: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.18)', marginBottom: 2 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 21, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.3 },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 2, color: Colors.textSecondary },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.09)', backgroundColor: 'rgba(255,255,255,0.04)',
  },
  optionOn: { borderColor: Colors.primary + 'B3', backgroundColor: Colors.primary + '12' },
  layoutOpt: { flex: 1, flexDirection: 'column', alignItems: 'stretch', gap: 6 },
  optIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  optTitle: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  optSub: { fontSize: 12.5, lineHeight: 16, color: '#9DB6CC' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#4D6884', alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.primary },
  safe: {
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 18, marginTop: 6,
    backgroundColor: 'rgba(111,214,143,0.08)', borderWidth: 1, borderColor: 'rgba(111,214,143,0.28)',
  },
  safeIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: 'rgba(111,214,143,0.14)', alignItems: 'center', justifyContent: 'center' },
  safeTitle: { fontSize: 17, fontWeight: '700', color: '#FFFFFF' },
  safeText: { fontSize: 14, lineHeight: 19, color: '#B4C9DD' },
  cta: { height: 54, borderRadius: 16, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  ctaText: { fontSize: 16.5, fontWeight: '700', color: Colors.textInverse },

  pill: {
    height: 50, borderRadius: 25, flexDirection: 'row', alignItems: 'center', gap: 11, paddingLeft: 7, paddingRight: 20,
    borderWidth: 1, borderColor: Colors.primary + '66', backgroundColor: Colors.primary + '14',
  },
  pillPlay: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
});
