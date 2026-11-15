// Settings-raden för loggbok och layout (2026-11-13 minimalistisk, ersatte kortet C2). Raden ser ut som
// sektionsrubrikerna: "LOGBOOK" + "Pilot · Full" + pil, och ett tryck öppnar ett
// ark med två val: loggbok (Pilot | Drone) och layout (Full = Blades Extensive | Essential). Knappen längst
// ner säger vad som händer ("Switch to Drone logbook" osv.), så ingen extra bekräftelseruta behövs.
// Själva loggboksbytet (switchProfile) sköts av föräldern via onConfirmSwitch; Essential-bytet görs här
// (samma steg som den gamla AppVariantToggle: replace till /essential, sedan setVariant).
// Delad av pilot- och drönar-settings. IntroductionButton = den centrerade pillerknappen under kortet.
import { useState } from 'react';
import { View, Text, Pressable, TouchableOpacity, Modal, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Colors } from '../../constants/colors';
import { DR, withAlpha } from '../../constants/droneTheme';
import { useDroneAccentStore } from '../../store/droneAccentStore';
import { useAppVariantStore } from '../../store/appVariantStore';

type Mode = 'manned' | 'drone';
type Layout = 'full' | 'essential';

const LOGBOOKS: Record<Mode, { title: string; line1: string; icon: keyof typeof Ionicons.glyphMap }> = {
  manned: { title: 'Pilot', line1: 'Fixed & rotary wing', icon: 'airplane-outline' },
  drone: { title: 'Drone', line1: 'Commercial, military or hobby', icon: 'hardware-chip-outline' },
};

// Bock i accentfärgen för valt alternativ, tom ring annars.
function Tick({ on, accent }: { on: boolean; accent: string }) {
  return (
    <View style={[st.tick, on ? { backgroundColor: accent, borderWidth: 0 } : null]}>
      {on ? <Ionicons name="checkmark" size={14} color={DR.inkOnAccent} /> : null}
    </View>
  );
}

// Färger som matchar respektive settings-skärms sektionsrubriker.
const TONES = {
  manned: { bg: Colors.card, border: Colors.cardBorder, text: Colors.textPrimary, muted: Colors.textMuted, chevron: Colors.primary },
  drone: { bg: DR.surface, border: DR.border, text: DR.text, muted: DR.muted, chevron: DR.text3 },
};

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
  const tone = TONES[mode];

  // Inställningarna visas bara i Full (Essential har egna skärmar), så nuvarande layout är alltid Full.
  const openSheet = () => { setPickMode(mode); setPickLayout('full'); setOpen(true); };
  const close = () => setOpen(false);

  const droneAccent = useDroneAccentStore((s) => s.color);
  const accent = pickMode === 'drone' ? droneAccent : Colors.primary;
  const modeChanged = pickMode !== mode;
  const toEssential = pickLayout === 'essential';
  const cta = modeChanged && toEssential ? `Switch to ${LOGBOOKS[pickMode].title} · Essential`
    : modeChanged ? `Switch to ${LOGBOOKS[pickMode].title} logbook`
    : toEssential ? 'Switch to Essential'
    : 'Done';
  const changed = modeChanged || toEssential;

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
      {/* Minimalistisk rad i samma stil som sektionsrubrikerna (GENERAL, ABOUT …): LOGBOOK + "Pilot · Full" + pil. */}
      <TouchableOpacity onPress={openSheet} activeOpacity={0.7}
        style={[st.row, { backgroundColor: tone.bg, borderColor: tone.border }]}
        accessibilityRole="button" accessibilityLabel={`Logbook: ${cur.title}, full layout. Switch logbook or layout`}>
        <Text style={[st.rowLabel, { color: tone.text }]}>Logbook</Text>
        <Text style={[st.rowValue, { color: tone.muted }]}>{cur.title} · Full</Text>
        <Ionicons name="chevron-forward" size={16} color={tone.chevron} style={{ marginLeft: 8 }} />
      </TouchableOpacity>

      {/* Arket (design: Claude design "Logbook and layout"): navy som resten av Blades, rubrik i Georgia, mono-etiketter,
          accenten följer loggboken man pekar på (Pilot = Blades cyan, Drone = drönarlägets valda accent). */}
      <Modal visible={open} transparent animationType="slide" onRequestClose={close}>
        <Pressable style={st.backdrop} onPress={close}>
          <Pressable style={[st.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
            <View style={st.grabber} />
            <View style={st.head}>
              <Text style={st.title}>Logbook and layout</Text>
              <TouchableOpacity onPress={close} hitSlop={10} accessibilityLabel="Close" style={st.closeBtn}>
                <Ionicons name="close" size={16} color={DR.text2} />
              </TouchableOpacity>
            </View>

            <Text style={st.label}>LOGBOOK</Text>
            {(['manned', 'drone'] as Mode[]).map((m) => {
              const on = pickMode === m;
              const lb = LOGBOOKS[m];
              return (
                <TouchableOpacity key={m} onPress={() => setPickMode(m)} activeOpacity={0.8}
                  style={[st.option, on && { borderColor: accent, borderWidth: 1.5, backgroundColor: withAlpha(accent, 0.1) }]}
                  accessibilityRole="radio" accessibilityState={{ selected: on }}
                  accessibilityLabel={`${lb.title} logbook. ${lb.line1}`}>
                  <View style={[st.optIcon, { backgroundColor: on ? withAlpha(accent, 0.18) : DR.elevated }]}>
                    <Ionicons name={lb.icon} size={20} color={on ? accent : DR.text3} />
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={st.optTitle}>{lb.title}</Text>
                    <Text style={st.optSub}>{lb.line1}</Text>
                  </View>
                  <Tick on={on} accent={accent} />
                </TouchableOpacity>
              );
            })}

            <Text style={[st.label, { marginTop: 6 }]}>LAYOUT</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {([
                ['full', 'Full', 'Dashboard, Logbook, Insights and every tool'],
                ['essential', 'Essential', 'One screen: totals, log, import and export'],
              ] as [Layout, string, string][]).map(([k, t, d]) => {
                const on = pickLayout === k;
                const c = on ? accent : DR.text3;
                return (
                  <TouchableOpacity key={k} onPress={() => setPickLayout(k)} activeOpacity={0.8}
                    style={[st.option, st.layoutOpt, on && { borderColor: accent, borderWidth: 1.5, backgroundColor: withAlpha(accent, 0.1) }]}
                    accessibilityRole="radio" accessibilityState={{ selected: on }} accessibilityLabel={`${t} layout. ${d}`}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                      {/* Liten skiss: flikar (Full) eller en enda skärm (Essential). */}
                      <View style={[st.sketch, { borderColor: c }]}>
                        {k === 'full' ? (
                          <>
                            <View style={{ gap: 3 }}>
                              <View style={{ height: 3, borderRadius: 2, backgroundColor: c }} />
                              <View style={{ height: 3, width: '60%', borderRadius: 2, backgroundColor: c, opacity: 0.6 }} />
                            </View>
                            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                              {[0, 1, 2, 3].map((i) => <View key={i} style={{ width: 3, height: 3, borderRadius: 2, backgroundColor: c }} />)}
                            </View>
                          </>
                        ) : (
                          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                            <View style={{ width: 14, height: 3, borderRadius: 2, backgroundColor: c }} />
                            <View style={{ width: 10, height: 3, borderRadius: 2, backgroundColor: c, opacity: 0.6 }} />
                          </View>
                        )}
                      </View>
                      <Tick on={on} accent={accent} />
                    </View>
                    <View style={{ gap: 3 }}>
                      <Text style={st.optTitle}>{t}</Text>
                      <Text style={st.optSub}>{d}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={st.safe}>
              <Ionicons name="shield-checkmark-outline" size={18} color={DR.good} />
              <Text style={st.safeText}><Text style={{ color: DR.text, fontWeight: '600' }}>All your data is kept.</Text> Switching only changes which logbook you see.</Text>
            </View>

            {/* "Done" i glas när inget ändrats; en ändring gör knappen accentfylld och säger vad som händer. */}
            <TouchableOpacity onPress={apply} activeOpacity={0.85} accessibilityRole="button"
              style={[st.cta, changed ? { backgroundColor: accent } : st.ctaGlass]}>
              <Text style={[st.ctaText, { color: changed ? DR.inkOnAccent : DR.text }]}>{cta}</Text>
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
  row: {
    flexDirection: 'row', alignItems: 'center', marginHorizontal: 20, marginTop: 16,
    paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, borderWidth: 1,
  },
  rowLabel: { flex: 1, fontSize: 12, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  rowValue: { fontSize: 13, marginLeft: 8 },

  backdrop: { flex: 1, backgroundColor: 'rgba(4,10,20,0.62)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 18, paddingTop: 8, gap: 10,
    backgroundColor: DR.surface, borderTopWidth: 1, borderColor: DR.border,
    shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 20, shadowOffset: { width: 0, height: -10 },
  },
  grabber: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: '#2A4664', marginBottom: 2 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 },
  title: { fontFamily: 'Georgia', fontSize: 24, fontWeight: '700', color: DR.text },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: DR.elevated, alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: 'JetBrainsMono', fontSize: 9.5, fontWeight: '700', letterSpacing: 1.4, color: DR.text3, marginTop: 4 },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 16,
    borderWidth: 1, borderColor: DR.border, backgroundColor: DR.surface2,
  },
  layoutOpt: { flex: 1, flexDirection: 'column', alignItems: 'stretch', gap: 10, paddingHorizontal: 14 },
  optIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  optTitle: { fontSize: 16.5, fontWeight: '700', color: DR.text },
  optSub: { fontSize: 13, lineHeight: 17, color: DR.text2 },
  tick: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: DR.faint, alignItems: 'center', justifyContent: 'center' },
  sketch: { width: 30, height: 40, borderRadius: 7, borderWidth: 1.5, paddingTop: 5, paddingHorizontal: 4, paddingBottom: 4, justifyContent: 'space-between' },
  safe: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, paddingHorizontal: 2 },
  safeText: { flex: 1, fontSize: 13, lineHeight: 18, color: DR.text2 },
  cta: { height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  ctaGlass: { backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  ctaText: { fontSize: 16.5, fontWeight: '700' },
  pill: {
    height: 50, borderRadius: 25, flexDirection: 'row', alignItems: 'center', gap: 11, paddingLeft: 7, paddingRight: 20,
    borderWidth: 1, borderColor: Colors.primary + '66', backgroundColor: Colors.primary + '14',
  },
  pillPlay: { width: 36, height: 36, borderRadius: 18, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  pillText: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
});
