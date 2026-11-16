// Onboardingen, förenklad (2026-11-16, Claude design "Blades onboarding, förenklad"): tre skärmar.
//   1. What do you fly?  Välkomsten och farkostvalet på samma skärm; ett tryck på en farkost går vidare.
//   2. Where are your hours today?  Den enda frågan som ändrar vad appen gör härnäst (pappersbok, annan app eller
//      kalkylblad, skriva in totaler, precis börjat). Drönarpiloter väljer först sorts flygning (behövs för
//      loggboken). Regelverket gissas ur regionen och går att byta på en stillsam rad.
//   3. Betalväggen (OnboardingPaywall, oförändrad design: användarens val 2026-11-16) med en rubrik som följer svaret.
// Sedan direkt till det man valde: skanningen, importen, starttotalerna eller dashboarden, med rundturen som förut.
// Den som lägger till en andra roll (returning) eller redan betalar hoppar över betalväggen.
// Svaren sparas i settings: onboarding_hours/onboarding_paper läses av rundturens "nästa steg" (TourHost),
// onboarding_source och onboarding_goal för senare anpassning.
// preview: öppnas från Inställningar i TestFlight-bygget (kanalen preview); sparar ingenting, och knapparna på
// sista steget öppnar de riktiga sidorna så att hela vägen går att prova.

import { useEffect, useRef, useState } from 'react';
import { View, Text, Image, Pressable, ScrollView, ActivityIndicator, StyleSheet, type ImageSourcePropType } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, { FadeIn } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { AppBackground } from '../AppBackground';
import { useTimeFormatStore } from '../../store/timeFormatStore';
import { useAppModeStore } from '../../store/appModeStore';
import { useProfileStore, type MainRole, type SubRole, type Profile, targetForProfile } from '../../store/profileStore';
import { useRegulationStandardStore, type RegulationStandard } from '../../store/regulationStandardStore';
import { useFlightStore } from '../../store/flightStore';
import { markIntroTourPending } from '../../store/tourStore';
import { SCAN_OPEN } from '../../store/scanStore';
import { setSetting } from '../../db/flights';
import { getOnboardingPlans, type PlanOption } from '../../services/purchases';
import { OnboardingPaywall, type PaywallResult } from './OnboardingPaywall';

const CYAN = '#00C8E8';
const SUB = '#8FB0CC';
const MUTED = '#6E8FB0';
const SOFT = '#CFE0EE';
const SERIF = 'Fraunces';

type Step = 'craft' | 'hours' | 'paywall';
type Craft = 'heli' | 'plane' | 'drone';
type Where = 'paper' | 'digital' | 'totals' | 'start';
type Dest = '/import/scan' | '/import/manual' | '/import' | '/drone-import' | '/drone-import/manual';

const IMG: Record<Craft, ImageSourcePropType> = {
  heli: require('../../assets/onboarding/heli.png'),
  plane: require('../../assets/onboarding/plane.png'),
  drone: require('../../assets/onboarding/drone.png'),
};
const LOCKUP = require('../../assets/onboarding/blades-lockup.png');

const CRAFTS: { key: Craft; title: string; desc: string }[] = [
  { key: 'heli', title: 'Helicopter', desc: 'Single and multi engine, HEMS, offshore.' },
  { key: 'plane', title: 'Airplane', desc: 'Piston, turboprop and jet.' },
  { key: 'drone', title: 'Drone', desc: 'Hobby, commercial or military.' },
];
const DRONE_KINDS: { k: SubRole; title: string }[] = [
  { k: 'hobby', title: 'Hobby' },
  { k: 'commercial', title: 'Commercial' },
  { k: 'military', title: 'Military' },
];
const RULES: { k: RegulationStandard; name: string }[] = [
  { k: 'easa', name: 'EASA · Part-FCL' },
  { k: 'faa', name: 'FAA · Part 61' },
  { k: 'caa', name: 'UK CAA' },
  { k: 'other', name: 'Other or none' },
];
const PROGRESS: Record<Step, number> = { craft: 1, hours: 2, paywall: 3 };   // betalväggen visar inget förlopp (egen design)

// Regelverket gissas ur telefonens region (USA → FAA, Storbritannien → UK CAA, EASA-länderna → EASA), annars det
// som redan är valt. Användaren kan byta på timmarskärmen.
const EASA_REGIONS = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO', 'CH']);
function standardForRegion(fallback: RegulationStandard): RegulationStandard {
  try {
    const parts = (Intl.DateTimeFormat().resolvedOptions().locale || '').split(/[-_]/);
    const region = (parts.slice(1).find((p) => /^[A-Za-z]{2}$/.test(p)) || '').toUpperCase();
    if (region === 'US') return 'faa';
    if (region === 'GB') return 'caa';
    if (EASA_REGIONS.has(region)) return 'easa';
  } catch { /* okänd region */ }
  return fallback;
}

export default function NewOnboarding({ preview = false }: { preview?: boolean }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const currentProfile = useProfileStore((s) => s.profile);
  const returning = !preview && !!currentProfile;
  const isPaying = useFlightStore((s) => s.isPremium || s.isMax);
  const paying = !preview && isPaying;

  const [step, setStep] = useState<Step>('craft');
  const [craft, setCraft] = useState<Craft | null>(null);
  const [droneKind, setDroneKind] = useState<SubRole | null>(null);
  const [where, setWhere] = useState<Where | null>(null);
  const [rules, setRules] = useState<RegulationStandard>(() => standardForRegion(useRegulationStandardStore.getState().standard));
  const [plans, setPlans] = useState<PlanOption[] | null>(null);
  const [waiting, setWaiting] = useState(false);
  const plansPromise = useRef<Promise<PlanOption[]> | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    // Planerna hämtas i bakgrunden, så att betalväggen är redo när man kommer dit.
    if (!returning && !paying) {
      plansPromise.current = getOnboardingPlans().catch(() => []);
      plansPromise.current.then(setPlans);
    }
    return () => { timers.current.forEach(clearTimeout); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pilot = craft !== 'drone';
  const rule = RULES.find((r) => r.k === rules) ?? RULES[0];
  const crafts = CRAFTS.filter((c) => !returning
    || (currentProfile?.mainRole === 'pilot-manned' ? c.key === 'drone' : c.key !== 'drone'));
  const tap = () => { Haptics.selectionAsync().catch(() => {}); };

  // Vart svaret leder efter betalväggen. Pappersboken utan skanning → starttotalerna.
  const destFor = (w: Where | null): Dest | undefined => {
    if (w === 'paper') return pilot && SCAN_OPEN ? '/import/scan' : pilot ? '/import/manual' : '/drone-import/manual';
    if (w === 'digital') return pilot ? '/import' : '/drone-import';
    if (w === 'totals') return pilot ? '/import/manual' : '/drone-import/manual';
    return undefined;   // precis börjat eller senare → dashboarden
  };

  const pickCraft = (k: Craft) => {
    tap();
    if (craft && (craft === 'drone') !== (k === 'drone')) { setDroneKind(null); setWhere(null); }
    setCraft(k);
    timers.current.push(setTimeout(() => setStep('hours'), 260));
  };

  // Efter timmarna: betalväggen för nya användare som inte redan betalar och när köp går, annars vidare direkt.
  const pickWhere = async (w: Where | null) => {
    tap();
    setWhere(w);
    if (returning || paying) { finalize(w); return; }
    let list = plans;
    if (list === null && plansPromise.current) {
      setWaiting(true);
      list = await Promise.race([plansPromise.current, new Promise<PlanOption[]>((r) => setTimeout(() => r([]), 3000))]);
      setWaiting(false);
    }
    if (list && list.length) setStep('paywall'); else finalize(w);
  };

  const finalize = async (w: Where | null, _bought?: PaywallResult) => {
    const dest = destFor(w);
    // Förhandsvisningen sparar ingenting, men öppnar de riktiga sidorna (skanning, import, starttotaler).
    if (preview) { if (dest) router.replace(dest as any); else router.back(); return; }
    try {
      if (!craft) { router.replace('/(tabs)'); return; }
      const mainRole: MainRole = pilot ? 'pilot-manned' : 'pilot-unmanned';
      const subRole: SubRole = pilot ? (craft === 'heli' ? 'rotary' : 'fixed') : (droneKind || 'commercial');
      const profile: Profile = { mainRole, subRole };
      if (pilot) await useRegulationStandardStore.getState().setStandard(rules);
      else await useTimeFormatStore.getState().setTimeFormat('hhmm');
      await useProfileStore.getState().setProfile(profile);
      await setSetting('onboarding_goal', pilot ? '' : subRole);
      // Rundturens "nästa steg" läser dessa två: timmar att föra in, och om de finns i en pappersbok.
      await setSetting('onboarding_hours', w === 'start' ? 'Just starting' : w ? 'Has hours' : '');
      await setSetting('onboarding_paper', w === 'paper' ? '1' : '0');
      await setSetting('onboarding_source', w && w !== 'start' ? w : '');
      await useAppModeStore.getState().setMode(targetForProfile(profile));
      await setSetting('has_onboarded', '1');
      // Blades introduction startar som förut när dashboarden visas (efter en eventuell import).
      await markIntroTourPending(pilot ? 'pilot' : 'drone');
      await new Promise((r) => setTimeout(r, 100));
      // Importen pushas med from=onboarding: efter Save går den direkt till dashboarden.
      if (dest) router.push(`${dest}?from=onboarding` as any); else router.replace('/(tabs)');
    } catch (e) {
      console.error('Onboarding error:', e);
      router.replace('/(tabs)');
    }
  };

  // Betalväggens rubrik och underrad säger vad Blades gör med svaret.
  const [pwTitle, pwSub] = !pilot ? ['Every drone flight logged in seconds.', 'VLOS to BVLOS, all your flying in one place.']
    : where === 'paper' && SCAN_OPEN ? ['Your whole paper logbook, in Blades.', 'Scan it once. Log every flight after that in about 20 seconds.']
    : where === 'digital' ? ['Bring your logbook over.', 'Keep all your flying in one place from here on.']
    : where === 'start' ? ['Start your logbook the right way.', 'Every hour counts. From day one.']
    : ['Your whole flying life in one logbook.', craft === 'plane' ? 'From short hops to long cross-countries.' : 'From local circuits to long cross-countries.'];

  const canGo = pilot || !!droneKind;
  const showBack = step === 'hours';

  return (
    <View style={{ flex: 1, backgroundColor: '#0A1628' }}>
      <AppBackground />
      {step === 'hours' ? (
        <View style={[s.top, { paddingTop: insets.top + 6 }]}>
          {showBack ? (
            <Pressable onPress={() => setStep('craft')} style={s.icon} hitSlop={6} accessibilityRole="button" accessibilityLabel="Back">
              <Ionicons name="chevron-back" size={22} color={SOFT} />
            </Pressable>
          ) : <View style={s.icon} />}
          <View style={s.segs} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 3, now: PROGRESS[step] }}>
            {[1, 2, 3].map((n) => <View key={n} style={[s.seg, n <= PROGRESS[step] && s.segOn]} />)}
          </View>
          {preview
            ? <Pressable onPress={() => router.back()} style={s.icon} hitSlop={6} accessibilityRole="button" accessibilityLabel="Close the preview">
                <Ionicons name="close" size={22} color={SOFT} />
              </Pressable>
            : <View style={s.icon} />}
        </View>
      ) : null}

      <Animated.View key={step} entering={FadeIn.duration(240)} style={{ flex: 1 }}>
        {step === 'craft' ? (
          <View style={{ flex: 1, paddingTop: insets.top + 22, paddingHorizontal: 22, paddingBottom: insets.bottom + 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Image source={LOCKUP} style={{ width: 150, height: 34 }} resizeMode="contain" accessibilityLabel="Blades pilot logbook" />
              {preview ? (
                <Pressable onPress={() => router.back()} style={s.icon} hitSlop={6} accessibilityRole="button" accessibilityLabel="Close the preview">
                  <Ionicons name="close" size={22} color={SOFT} />
                </Pressable>
              ) : null}
            </View>
            <Text style={[s.h1, { marginTop: 40 }]}>{returning ? 'Add another logbook.' : 'One logbook for every pilot.'}</Text>
            <Text style={s.sub}>{returning ? 'Your other logbook stays as it is.' : 'What do you fly? Blades sets up the right logbook for it.'}</Text>
            <View style={{ gap: 12, marginTop: 26 }}>
              {crafts.map((c) => (
                <Pressable key={c.key} onPress={() => pickCraft(c.key)} style={({ pressed }) => [s.tile, (craft === c.key || pressed) && s.tileOn]}
                  accessibilityRole="button" accessibilityLabel={`${c.title}. ${c.desc}`}>
                  <Image source={IMG[c.key]} style={s.tileImg} resizeMode="contain" />
                  <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                    <Text style={s.tileTitle}>{c.title}</Text>
                    <Text style={s.tileDesc}>{c.desc}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={MUTED} />
                </Pressable>
              ))}
            </View>
            <View style={{ flex: 1 }} />
            {!returning ? (
              <Text style={s.fine}>No account needed. Private by design.{'\n'}You can add a second logbook later.</Text>
            ) : null}
          </View>
        ) : null}

        {step === 'hours' ? (
          <View style={{ flex: 1 }}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: insets.top + 64, paddingHorizontal: 22, paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
              {!pilot ? (
                <View style={{ marginBottom: 30 }}>
                  <Text style={s.h1}>What kind of flying?</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }} accessibilityRole="radiogroup">
                    {DRONE_KINDS.map((d) => {
                      const on = droneKind === d.k;
                      return (
                        <Pressable key={d.k} onPress={() => { tap(); setDroneKind(d.k); }} style={[s.pill, on && s.pillOn]}
                          accessibilityRole="radio" accessibilityState={{ checked: on }}>
                          <Text style={s.pillText}>{d.title}</Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ) : null}
              <Text style={pilot ? s.h1 : s.h2}>Where are your hours today?</Text>
              <Text style={s.sub}>Blades brings them in, so your totals are right from the first day.</Text>
              <View style={{ gap: 10, marginTop: 22, opacity: canGo ? 1 : 0.4 }} pointerEvents={canGo && !waiting ? 'auto' : 'none'}>
                {pilot ? (
                  <Row icon="book-open-variant" title="In a paper logbook"
                    desc={SCAN_OPEN ? 'Photograph the pages and Blades types them in.' : 'Enter the totals from your last page.'}
                    onPress={() => pickWhere('paper')} />
                ) : null}
                <Row icon="file-document-outline" title="In another app or a spreadsheet" desc="Import the file and check it before it is saved." onPress={() => pickWhere('digital')} />
                <Row icon="pencil-outline" title="I'll type in my totals" desc="Enter the hours you have so far." onPress={() => pickWhere('totals')} />
                <Row icon="plus-circle-outline" title="I'm just starting" desc="Your logbook starts at zero." onPress={() => pickWhere('start')} />
              </View>
            </ScrollView>
            <View style={{ paddingHorizontal: 22, paddingBottom: insets.bottom + 10, gap: 6 }}>
              {pilot ? (
                <View style={s.rules}>
                  <Text style={{ fontSize: 13, color: SUB }}>Rules</Text>
                  <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: '#FFFFFF' }}>{rule.name}</Text>
                  <Pressable onPress={() => { tap(); setRules(RULES[(RULES.indexOf(rule) + 1) % RULES.length].k); }} style={s.change}
                    accessibilityRole="button" accessibilityLabel={`Rules: ${rule.name}. Change`}>
                    <Text style={{ fontSize: 14, fontWeight: '600', color: CYAN }}>Change</Text>
                  </Pressable>
                </View>
              ) : null}
              <Pressable onPress={() => pickWhere(null)} disabled={!canGo || waiting} style={s.ghost} accessibilityRole="button">
                {waiting ? <ActivityIndicator color={SUB} /> : <Text style={[s.ghostText, !canGo && { opacity: 0.4 }]}>I'll do this later</Text>}
              </Pressable>
            </View>
          </View>
        ) : null}

        {step === 'paywall' && plans && plans.length ? (
          <OnboardingPaywall plans={plans} pilot={pilot} lic="" paper={where === 'paper' && pilot && SCAN_OPEN} title={pwTitle} sub={pwSub}
            onDone={(r) => finalize(where, r)} />
        ) : null}
      </Animated.View>
    </View>
  );
}

// Ett svar som leder vidare direkt: ikon, rubrik, en rad och en pil.
function Row({ icon, title, desc, onPress }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; title: string; desc: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [s.row, pressed && s.rowOn]} accessibilityRole="button" accessibilityLabel={`${title}. ${desc}`}>
      <View style={s.ricon}><MaterialCommunityIcons name={icon} size={21} color={CYAN} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={s.rt}>{title}</Text>
        <Text style={s.rs}>{desc}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={MUTED} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  top: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 5, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  segs: { flex: 1, flexDirection: 'row', gap: 5, paddingHorizontal: 6 },
  seg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(127,168,200,0.2)' },
  segOn: { backgroundColor: CYAN },
  h1: { fontFamily: SERIF, fontSize: 31, fontWeight: '600', lineHeight: 35, color: '#FFFFFF' },
  h2: { fontFamily: SERIF, fontSize: 23, fontWeight: '600', lineHeight: 28, color: '#FFFFFF' },
  sub: { fontSize: 15, lineHeight: 21, color: SUB, marginTop: 10 },
  fine: { textAlign: 'center', fontSize: 13, lineHeight: 19, color: MUTED },
  tile: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 112, paddingRight: 16, borderRadius: 20, backgroundColor: 'rgba(15,30,58,0.6)', borderWidth: 1, borderColor: 'rgba(127,168,200,0.18)', overflow: 'hidden' },
  tileOn: { borderColor: CYAN, backgroundColor: 'rgba(0,200,232,0.08)' },
  tileImg: { width: 124, height: 124, marginLeft: -8 },
  tileTitle: { fontFamily: SERIF, fontSize: 22, fontWeight: '600', color: '#FFFFFF' },
  tileDesc: { fontSize: 13, lineHeight: 18, color: SUB },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 72, paddingVertical: 12, paddingLeft: 16, paddingRight: 14, borderRadius: 16, backgroundColor: 'rgba(15,30,58,0.6)', borderWidth: 1, borderColor: 'rgba(127,168,200,0.18)' },
  rowOn: { borderColor: CYAN, backgroundColor: 'rgba(0,200,232,0.08)' },
  ricon: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(0,200,232,0.10)', alignItems: 'center', justifyContent: 'center' },
  rt: { fontSize: 15.5, fontWeight: '600', color: '#FFFFFF' },
  rs: { fontSize: 12.5, lineHeight: 17, color: SUB },
  pill: { flex: 1, height: 46, borderRadius: 23, borderWidth: 1, borderColor: 'rgba(127,168,200,0.25)', backgroundColor: 'rgba(15,30,58,0.6)', alignItems: 'center', justifyContent: 'center' },
  pillOn: { borderWidth: 2, borderColor: CYAN, backgroundColor: 'rgba(0,200,232,0.10)' },
  pillText: { fontSize: 14.5, fontWeight: '600', color: '#FFFFFF' },
  rules: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingLeft: 16, paddingRight: 4, borderRadius: 14, borderWidth: 1, borderColor: 'rgba(127,168,200,0.14)' },
  change: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
  ghost: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 14.5, fontWeight: '600', color: SUB },
});
