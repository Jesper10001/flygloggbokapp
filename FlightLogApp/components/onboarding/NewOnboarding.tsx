// Den nya onboardingen: välkomst → farkost → EN sida med alla frågor (vad som är viktigt, vad man vill få ut,
// timmar, var de finns i dag och, för digital loggbok, var och vad den kostar; nästa fråga kommer fram när den
// förra är besvarad) → EN sida med hela lösningen, vävd av svaren (onboardingPitch.ts) → betalväggen
// (OnboardingPaywall) → timmarna med ett förvalt förslag, sedan dashboarden med rundturfrågan som förut.
// Förnamnet frågas inte efter, och det finns ingen "sätter upp din loggbok"-sida. Samma
// navy-gradient, typsnitt och kort som appen. Den som lägger till en andra roll får farkost → … → timmar, utan
// välkomst och betalvägg. Initialer, signatur och tidsformat väljs inte här längre (profilsidan har dem).
// Svaren sparas i settings (onboarding_*) för senare anpassning.
// preview: visas från Inställningar i TestFlight-bygget; sparar ingenting och går tillbaka i slutet.

import { useEffect, useRef, useState } from 'react';
import { View, Text, Image, Pressable, ScrollView, ActivityIndicator, StyleSheet, type ImageSourcePropType } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Defs, RadialGradient, Stop, Circle } from 'react-native-svg';
import Animated, { FadeIn, FadeInDown, useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, cancelAnimation } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { AppBackground } from '../AppBackground';
import { useTimeFormatStore } from '../../store/timeFormatStore';
import { useAppModeStore } from '../../store/appModeStore';
import { useProfileStore, type MainRole, type SubRole, type Profile, targetForProfile } from '../../store/profileStore';
import { useRegulationStandardStore, type RegulationStandard } from '../../store/regulationStandardStore';
import { useFlightStore } from '../../store/flightStore';
import { markIntroTourPending } from '../../store/tourStore';
import { SCAN_OPEN, FREE_SPREADS } from '../../store/scanStore';
import { SCAN_COINS_PER_SPREAD } from '../../utils/tokenGate';
import { setSetting } from '../../db/flights';
import { getOnboardingPlans, getCoinPackages, type PlanOption } from '../../services/purchases';
import { COIN_PACKS, COIN_PACKS_ENABLED } from '../../services/coinPacks';
import {
  buildSolution, bookCost, costChoices, PILOT_PRIOS, DRONE_PRIOS, PILOT_WANTS, DRONE_WANTS, PILOT_APPS,
  type Prio, type Want, type Where, type Src, type PitchPath, type PitchRow, type Prices,
} from './onboardingPitch';
import { SolutionHero } from './SolutionHero';
import { OnboardingPaywall, type PaywallResult } from './OnboardingPaywall';

const CYAN = '#00C8E8';
const GOLD = '#FFB830';
const GREEN = '#19E6A5';
const INK = '#06101E';
const SUB = '#8FB0CC';
const MUTED = '#6E8FB0';
const SOFT = '#CFE0EE';
const MONO = 'JetBrainsMono';
const SERIF = 'Fraunces';

type Step = 'welcome' | 'aircraft' | 'questions' | 'solution' | 'paywall' | 'hours';
type Craft = 'heli' | 'plane' | 'drone';
type Dest = '/import/scan' | '/import/manual' | '/import' | '/drone-import' | '/drone-import/manual';

const IMG: Record<Craft, ImageSourcePropType> = {
  heli: require('../../assets/onboarding/heli.png'),
  plane: require('../../assets/onboarding/plane.png'),
  drone: require('../../assets/onboarding/drone.png'),
};
const HERO = require('../../assets/onboarding/hero-phones.png');
const LOCKUP = require('../../assets/onboarding/blades-lockup.png');

const CRAFTS: { key: Craft; title: string; desc: string; tag: string }[] = [
  { key: 'heli', title: 'Helicopter', desc: 'Single and multi engine, HEMS, offshore.', tag: 'PPL · CPL · ATPL (H)' },
  { key: 'plane', title: 'Airplane', desc: 'Piston, turboprop and jet.', tag: 'PPL · CPL · ATPL (A)' },
  { key: 'drone', title: 'Drone', desc: 'Hobby, commercial or military.', tag: 'Open · Specific' },
];
const PILOT_GOALS = [
  { k: 'ppl', title: 'My first licence', sub: 'Training towards a PPL', lic: 'PPL' },
  { k: 'cpl', title: 'Commercial pilot', sub: 'Building hours for a CPL', lic: 'CPL' },
  { k: 'atpl', title: 'Airline transport', sub: 'On the way to an ATPL', lic: 'ATPL' },
  { k: 'log', title: 'Already licensed', sub: 'Logging, currency and stats', badge: 'LOG' },
];
const DRONE_GOALS: { k: SubRole; title: string; sub: string; badge: string }[] = [
  { k: 'hobby', title: 'Hobby', sub: 'Open category, A1 to A3', badge: 'OPEN' },
  { k: 'commercial', title: 'Commercial', sub: 'Specific category, paid work', badge: 'SPECIFIC' },
  { k: 'military', title: 'Military', sub: 'Defence and state missions', badge: 'STATE' },
];
const RULES: { k: RegulationStandard; name: string; short: string }[] = [
  { k: 'easa', name: 'EASA · Part-FCL', short: 'EASA' },
  { k: 'faa', name: 'FAA · Part 61', short: 'FAA' },
  { k: 'caa', name: 'UK CAA', short: 'UK CAA' },
  { k: 'other', name: 'Other or none', short: 'OTHER' },
];
const PILOT_HOURS = ['Just starting', 'Under 100 h', '100–500 h', '500–1 500 h', '1 500 h +'];
const DRONE_HOURS = ['Just starting', 'Under 50 h', '50–200 h', '200 h +'];
const PROGRESS: Partial<Record<Step, number>> = { aircraft: 1, questions: 2, solution: 3, hours: 4 };
const SEGMENTS = [1, 2, 3, 4];
// Skanning av drönarloggboken (pappersboken) finns inte än. När den finns: sätt vägen hit, så får drönarläget
// samma "skanna din bok" som pilotläget i rutan och i sista steget.
const DRONE_BOOK_SCAN: Dest | null = null;

// Regelverket gissas ur telefonens region (USA → FAA, Storbritannien → UK CAA, EASA-länderna → EASA), annars det
// som redan är valt. Användaren kan byta på målsidan.
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

  const [step, setStep] = useState<Step>(returning ? 'aircraft' : 'welcome');
  const [craft, setCraft] = useState<Craft | null>(null);
  const [prio, setPrio] = useState<Prio | null>(null);       // "What matters most to you?"
  const [want, setWant] = useState<Want | null>(null);       // "What do you want out of your logbook?"
  const [licGoal, setLicGoal] = useState<string | null>(null);   // ppl/cpl/atpl, bara när målet är nästa licens
  const [droneKind, setDroneKind] = useState<SubRole | null>(null);
  const [where, setWhere] = useState<Where | null>(null);    // var timmarna finns i dag
  const [src, setSrc] = useState<Src | null>(null);          // digital loggbok: app eller eget kalkylblad
  const [app, setApp] = useState<string | null>(null);
  const [cost, setCost] = useState<number | null>(null);     // index i costChoices().labels
  const [prices, setPrices] = useState<Prices | null>(null);
  const [rules, setRules] = useState<RegulationStandard>(() => standardForRegion(useRegulationStandardStore.getState().standard));
  const [hours, setHours] = useState<number | null>(null);
  const qScroll = useRef<ScrollView>(null);
  const [plans, setPlans] = useState<PlanOption[] | null>(null);
  const [bought, setBought] = useState<PaywallResult>(null);
  const [waiting, setWaiting] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const plansPromise = useRef<Promise<PlanOption[]> | null>(null);

  useEffect(() => {
    // Planerna hämtas i bakgrunden, så att betalväggen är redo när man kommer dit.
    if (!returning) {
      plansPromise.current = getOnboardingPlans().catch(() => []);
      plansPromise.current.then(setPlans);
      // Priserna bakom "vad kostar en hel loggbok" och prisjämförelsen: App Stores, för den här användaren.
      Promise.all([plansPromise.current, COIN_PACKS_ENABLED ? getCoinPackages().catch(() => []) : Promise.resolve([])]).then(([pl, packs]) => {
        const prem = pl.find((x) => x.tier === 'premium') ?? null, mx = pl.find((x) => x.tier === 'max') ?? null;
        const ref = prem ?? mx;
        if (!ref) return;
        setPrices({
          currency: ref.pkg.product.currencyCode, sample: ref.priceString, premiumString: prem ? prem.priceString : null,
          premium: prem ? prem.pkg.product.price : null, max: mx ? mx.pkg.product.price : null,
          packs: packs.map((x) => ({ coins: COIN_PACKS.find((c) => c.productId === x.productId)?.coins ?? 0, price: x.pkg.product.price })).filter((x) => x.coins > 0),
        });
      }).catch(() => {});
    }
    return () => { timers.current.forEach(clearTimeout); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pilot = craft !== 'drone';
  const sfx = craft === 'plane' ? '(A)' : '(H)';
  const rule = RULES.find((r) => r.k === rules) ?? RULES[0];
  // Målet som resten av appen känner det: licensen (bara när nästa licens är det viktiga) eller "log"; drönare: typ av flygning.
  const goal: string | null = pilot ? (prio === 'licence' ? licGoal : prio ? 'log' : null) : droneKind;
  const pilotGoal = pilot ? PILOT_GOALS.find((g) => g.k === goal) ?? null : null;
  const droneGoal = !pilot ? DRONE_GOALS.find((g) => g.k === goal) ?? null : null;
  const lic = pilotGoal?.lic ? pilotGoal.lic + sfx : '';
  const hourList = pilot ? PILOT_HOURS : DRONE_HOURS;

  const crafts = CRAFTS.filter((c) => !returning
    || (currentProfile?.mainRole === 'pilot-manned' ? c.key === 'drone' : c.key !== 'drone'));

  const tap = () => { Haptics.selectionAsync().catch(() => {}); };
  const go = (s: Step) => setStep(s);
  // Vägen genom rutorna efter svaren.
  const starting = hours === 0;
  const paper = !starting && where === 'paper';
  const canScan = pilot ? SCAN_OPEN : !!DRONE_BOOK_SCAN;
  const choices = costChoices(prices);
  // Betalar man mer än Premium i dag (enligt eget svar) visas vad man sparar per månad och på ett år.
  const deal = choices && cost != null && !starting && where === 'digital' && src === 'app' ? choices.deals[cost] ?? null : null;
  const path: PitchPath = starting || !where ? 'start'
    : where === 'paper' ? (canScan ? 'paper' : 'paperNoScan')
    : src === 'sheet' ? 'sheet'
    : deal ? 'appPricey' : choices && cost === 2 ? 'appMid' : 'app';
  const book = path === 'paper' ? bookCost(prices, SCAN_COINS_PER_SPREAD) : null;
  const solution = prio && want ? buildSolution({ pilot, prio, want, path, deal, scanBook: canScan, drone: pilot ? null : (droneKind as 'hobby' | 'commercial' | 'military' | null), bookShort: book?.short ?? null, freeSpreads: FREE_SPREADS }) : null;
  const back: Partial<Record<Step, Step>> = { aircraft: 'welcome', questions: 'aircraft', solution: 'questions', hours: 'solution' };
  // Frågesidan: allt som måste vara besvarat innan man går vidare.
  const sourceDone = !!src && (src === 'sheet' || !pilot || !!app);
  const answered = !!prio && !!want && !!goal && hours != null && (starting || where === 'paper' || (where === 'digital' && sourceDone));
  // När en ny fråga kommer fram rullas sidan dit.
  const reveal = () => { timers.current.push(setTimeout(() => qScroll.current?.scrollToEnd({ animated: true }), 140)); };
  const canBack = step !== 'welcome' && step !== 'paywall' && !(returning && step === 'aircraft');

  const pickCraft = (k: Craft) => {
    tap();
    if (craft && (craft === 'drone') !== (k === 'drone')) { setPrio(null); setWant(null); setLicGoal(null); setDroneKind(null); setHours(null); setWhere(null); setSrc(null); setApp(null); setCost(null); }
    setCraft(k);
    timers.current.push(setTimeout(() => go('questions'), 320));
  };

  // Efter lösningssidan: betalväggen för nya användare som inte redan betalar och när köp går, annars timmarna.
  const afterReady = async () => {
    if (returning || paying) { go('hours'); return; }
    let list = plans;
    if (list === null && plansPromise.current) {
      setWaiting(true);
      list = await Promise.race([plansPromise.current, new Promise<PlanOption[]>((r) => setTimeout(() => r([]), 3000))]);
      setWaiting(false);
    }
    go(list && list.length ? 'paywall' : 'hours');
  };

  // Betalväggens rubrik säger vad Blades gör, vald ur svaren i ordningen pappersbok, timmar, mål och farkost;
  // underraden kommer från nästa svar. Inget namn i texterna.
  const acLine = craft === 'plane' ? 'From short hops to long cross-countries.' : 'From local circuits to long cross-countries.';
  let pwTitle: string, pwSub: string;
  if (path === 'paper') { pwTitle = 'Your whole paper logbook, in Blades.'; pwSub = 'Scan it once. Log every flight after that in about 20 seconds.'; }
  else if (path === 'appPricey') { pwTitle = 'Your logbook, for less than you pay today.'; pwSub = 'Bring your flights over and keep going.'; }
  else if (!pilot) { pwTitle = 'Every drone flight logged in seconds.'; pwSub = 'VLOS to BVLOS, all your flying in one place.'; }
  else if (hours === 4) { pwTitle = '1 500+ hours deserve a better logbook.'; pwSub = acLine; }
  else if (hours === 3) { pwTitle = 'Every hour you have flown, finally in one place.'; pwSub = acLine; }
  else if (hours === 0 || hours === 1) { pwTitle = 'Start your logbook the right way.'; pwSub = 'Every hour counts. From day one.'; }
  else if (goal === 'log') { pwTitle = 'Logging done in seconds.'; pwSub = 'Log it once. Blades does the rest.'; }
  else { pwTitle = 'Your whole flying life in one logbook.'; pwSub = acLine; }

  const finalize = async (dest?: Dest) => {
    // Förhandsvisningen sparar ingenting, men knapparna på sista steget öppnar de riktiga sidorna (skanning,
    // import, starttotaler) så att hela vägen går att prova. Tillbaka därifrån leder till Inställningar.
    if (preview) { if (dest) router.replace(dest as any); else router.back(); return; }
    try {
      if (!craft) { router.replace('/(tabs)'); return; }
      const mainRole: MainRole = pilot ? 'pilot-manned' : 'pilot-unmanned';
      const subRole: SubRole = pilot ? (craft === 'heli' ? 'rotary' : 'fixed') : ((goal as SubRole) || 'commercial');
      const profile: Profile = { mainRole, subRole };
      if (pilot) await useRegulationStandardStore.getState().setStandard(rules);
      else await useTimeFormatStore.getState().setTimeFormat('hhmm');
      await useProfileStore.getState().setProfile(profile);
      await setSetting('onboarding_goal', goal ?? '');
      await setSetting('onboarding_hours', hours == null ? '' : hourList[hours]);
      await setSetting('onboarding_paper', paper ? '1' : '0');
      await setSetting('onboarding_priority', prio ?? '');
      await setSetting('onboarding_want', want ?? '');
      await setSetting('onboarding_source', starting || !where ? '' : where === 'paper' ? 'paper' : src ?? 'digital');
      await setSetting('onboarding_app', where === 'digital' && src === 'app' ? app ?? '' : '');
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

  const prog = PROGRESS[step] ?? 0;
  const showTop = prog > 0;

  return (
    <View style={{ flex: 1, backgroundColor: '#0A1628' }}>
      <AppBackground />
      {showTop ? (
        <View style={[s.top, { paddingTop: insets.top + 6 }]}>
          {canBack ? (
            <Pressable onPress={() => { const b = back[step]; if (b) go(b); }} style={s.back} hitSlop={6} accessibilityRole="button" accessibilityLabel="Back">
              <Ionicons name="chevron-back" size={22} color={SOFT} />
            </Pressable>
          ) : <View style={s.back} />}
          <View style={s.segs} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: SEGMENTS.length, now: prog }}>
            {SEGMENTS.map((n) => <View key={n} style={[s.seg, n <= prog && s.segOn]} />)}
          </View>
          {preview ? <CloseBtn onPress={() => router.back()} /> : <View style={s.back} />}
        </View>
      ) : null}

      <Animated.View key={step} entering={FadeIn.duration(260)} style={{ flex: 1 }}>
        {step === 'welcome' ? <Welcome insets={insets} onStart={() => go('aircraft')} onClose={preview ? () => router.back() : undefined} /> : null}

        {step === 'aircraft' ? (
          <Screen insets={insets}>
            <Text style={s.eyebrow}>YOUR AIRCRAFT</Text>
            <Text style={s.h1}>What do you fly?</Text>
            <Text style={s.sub}>We set up the right logbook, rules and stats for it.</Text>
            <View style={{ gap: 12, marginTop: 22 }}>
              {crafts.map((c) => {
                const on = craft === c.key;
                return (
                  <Pressable key={c.key} onPress={() => pickCraft(c.key)} style={[s.tile, on && s.tileOn]}
                    accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${c.title}. ${c.desc}`}>
                    <Image source={IMG[c.key]} style={s.tileImg} resizeMode="contain" />
                    <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                      <Text style={s.tileTitle}>{c.title}</Text>
                      <Text style={s.tileDesc}>{c.desc}</Text>
                      <Text style={s.tileTag}>{c.tag.toUpperCase()}</Text>
                    </View>
                    {on ? <View style={s.tick}><Ionicons name="checkmark" size={15} color={INK} /></View> : null}
                  </Pressable>
                );
              })}
            </View>
            <Text style={[s.note, { textAlign: 'center', marginTop: 22, fontFamily: MONO, fontSize: 10.5, color: MUTED }]}>
              {returning ? 'Your other logbook stays as it is.' : 'You can add a second logbook later.'}
            </Text>
          </Screen>
        ) : null}

        {step === 'questions' ? (
          <Screen insets={insets} scrollRef={qScroll} footer={(
            <View style={{ gap: 4 }}>
              <Cta label="See what Blades does for you" disabled={!answered} onPress={() => go('solution')} />
              {/* Diskret genväg förbi frågorna och lösningssidan, direkt till betalväggen med provveckan
                  (afterReady: timmarna i stället för den som redan betalar eller när köp inte går). */}
              <Pressable onPress={() => { tap(); afterReady(); }} disabled={waiting} accessibilityRole="button" accessibilityLabel="Skip the questions"
                hitSlop={8} style={{ alignSelf: 'center', minHeight: 40, justifyContent: 'center', paddingHorizontal: 16 }}>
                {waiting ? <ActivityIndicator color="#7FA8C8" size="small" /> : <Text style={{ fontSize: 14, fontWeight: '600', color: '#7FA8C8' }}>Skip</Text>}
              </Pressable>
            </View>
          )}>
            <Text style={s.eyebrow}>ABOUT YOUR FLYING</Text>
            <Text style={s.h1}>A few quick questions.</Text>
            <Text style={s.sub}>So we can show you what Blades does for you.</Text>

            <Text style={s.q}>What matters most to you?</Text>
            <View style={s.qBody} accessibilityRole="radiogroup">
              {(pilot ? PILOT_PRIOS : DRONE_PRIOS).map((o) => (
                <Choice key={o.k} title={o.title} on={prio === o.k} onPress={() => { tap(); if (!prio) reveal(); setPrio(o.k); }} />
              ))}
            </View>
            {pilot && prio === 'licence' ? (
              <Animated.View entering={FadeInDown.duration(260)} style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                {PILOT_GOALS.filter((g) => g.lic).map((g) => (
                  <Chip key={g.k} label={`${g.lic}${sfx}`} on={licGoal === g.k} onPress={() => { tap(); setLicGoal(g.k); }} />
                ))}
              </Animated.View>
            ) : null}

            {prio ? (
              <Animated.View entering={FadeInDown.duration(280)}>
                <Text style={s.q}>What do you want out of your logbook?</Text>
                <View style={s.qBody} accessibilityRole="radiogroup">
                  {(pilot ? PILOT_WANTS : DRONE_WANTS).map((o) => (
                    <Choice key={o.k} title={o.title} on={want === o.k} onPress={() => { tap(); if (!want) reveal(); setWant(o.k); }} />
                  ))}
                </View>
              </Animated.View>
            ) : null}

            {prio && want && !pilot ? (
              <Animated.View entering={FadeInDown.duration(280)}>
                <Text style={s.q}>What kind of flying?</Text>
                <View style={s.chips}>
                  {DRONE_GOALS.map((g) => (
                    <Chip key={g.k} label={g.title} on={droneKind === g.k} onPress={() => { tap(); if (!droneKind) reveal(); setDroneKind(g.k); }} />
                  ))}
                </View>
              </Animated.View>
            ) : null}

            {prio && want && (pilot || droneKind) ? (
              <Animated.View entering={FadeInDown.duration(280)}>
                <Text style={s.q}>How much have you flown?</Text>
                <View style={s.chips}>
                  {hourList.map((l, i) => (
                    <Chip key={l} label={l} on={hours === i} onPress={() => { tap(); if (hours == null) reveal(); setHours(i); }} />
                  ))}
                </View>
              </Animated.View>
            ) : null}

            {prio && want && hours != null && !starting ? (
              <Animated.View entering={FadeInDown.duration(280)}>
                <Text style={s.q}>Where are those hours today?</Text>
                <View style={[s.qBody, { gap: 10 }]} accessibilityRole="radiogroup">
                  <Choice icon="book-outline" title="Only in my paper logbook" on={where === 'paper'} onPress={() => { tap(); setWhere('paper'); }} />
                  <Choice icon="phone-portrait-outline" title="In a digital logbook too" on={where === 'digital'} onPress={() => { tap(); if (where !== 'digital') reveal(); setWhere('digital'); }} />
                </View>
              </Animated.View>
            ) : null}

            {prio && want && hours != null && !starting && where === 'digital' ? (
              <Animated.View entering={FadeInDown.duration(280)}>
                <Text style={s.q}>Tell us about your digital logbook.</Text>
                <View style={s.chips}>
                  {([['app', 'A logbook app'], ['sheet', 'My own spreadsheet']] as [Src, string][]).map(([k, l]) => (
                    <Chip key={k} label={l} on={src === k} onPress={() => { tap(); if (!src) reveal(); setSrc(k); }} />
                  ))}
                </View>
                {src === 'app' && pilot ? (
                  <Animated.View entering={FadeInDown.duration(260)}>
                    <Text style={[s.lbl, s.qSub]}>WHICH APP?</Text>
                    <View style={[s.chips, { marginTop: 0 }]}>
                      {PILOT_APPS.map((l) => <Chip key={l} label={l} on={app === l} onPress={() => { tap(); if (!app) reveal(); setApp(l); }} />)}
                    </View>
                  </Animated.View>
                ) : null}
                {src === 'app' && choices && (!pilot || app) ? (
                  <Animated.View entering={FadeInDown.duration(260)}>
                    <Text style={[s.lbl, s.qSub]}>WHAT DOES IT COST YOU A MONTH?</Text>
                    <View style={[s.chips, { marginTop: 0 }]}>
                      {choices.labels.map((l, i) => <Chip key={l} label={l} on={cost === i} onPress={() => { tap(); setCost(i); }} />)}
                    </View>
                  </Animated.View>
                ) : null}
              </Animated.View>
            ) : null}

            {pilot ? (
              <View style={[s.glass, { marginTop: 30, paddingVertical: 8, paddingLeft: 16, paddingRight: 10, flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
                <Text style={s.lbl}>RULES</Text>
                <Text style={{ flex: 1, fontSize: 14.5, fontWeight: '600', color: '#FFFFFF' }}>{rule.name}</Text>
                <Pressable onPress={() => { tap(); setRules(RULES[(RULES.indexOf(rule) + 1) % RULES.length].k); }} style={s.chg}
                  accessibilityRole="button" accessibilityLabel={`Rules: ${rule.name}. Change`}>
                  <Text style={s.chgText}>Change</Text>
                </Pressable>
              </View>
            ) : null}
          </Screen>
        ) : null}

        {step === 'solution' && solution ? (
          <Screen insets={insets} top={78} footer={<Cta label="Continue" busy={waiting} onPress={afterReady} />}>
            <SolutionHero kind={solution.hero} drone={(droneKind as 'hobby' | 'commercial' | 'military' | null) ?? undefined} />
            <Text style={[s.eyebrow, { marginTop: 14 }]}>{solution.kicker}</Text>
            <Text style={s.hBig}>{solution.title}</Text>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
              {solution.tiles.map((t) => (
                <View key={t.label} style={[s.tileS, t.good && s.tileGood]} accessible accessibilityLabel={`${t.value} ${t.label}`}>
                  <Text style={[s.tileN, t.good && { color: GREEN }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.55}>{t.value}</Text>
                  <Text style={[s.tileL, t.good && { color: '#D6FFF0' }]}>{t.label}</Text>
                </View>
              ))}
            </View>
            <View style={{ gap: 9, marginTop: 20 }}>
              {solution.rows.map((r) => (
                <View key={r.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} accessible accessibilityLabel={`${r.title}. ${r.sub}`}>
                  <Ionicons name="checkmark" size={18} color={CYAN} />
                  <Text style={{ flex: 1, fontSize: 14.5, fontWeight: '600', color: '#FFFFFF' }}>{r.title}</Text>
                </View>
              ))}
            </View>
          </Screen>
        ) : null}

        {step === 'paywall' && plans && plans.length ? (
          <OnboardingPaywall plans={plans} pilot={pilot} lic={lic} paper={path === 'paper'} overview={want === 'overview'} title={pwTitle} sub={pwSub}
            onDone={(r) => { setBought(r); go('hours'); }} />
        ) : null}

        {step === 'hours' ? (
          <Screen insets={insets} footer={(
            <Pressable onPress={() => finalize()} style={s.ghost} accessibilityRole="button">
              <Text style={s.ghostText}>I'll do it later</Text>
            </Pressable>
          )}>
            {bought ? (
              <View style={s.toast}>
                <Ionicons name="checkmark" size={18} color="#19E6A5" />
                <Text style={s.toastText}>
                  {bought.trialDays > 0
                    ? `Your ${bought.tier === 'max' ? 'Blades Max' : 'Premium'} ${bought.trialDays === 7 ? 'trial week' : 'trial'} starts today.`
                    : `${bought.tier === 'max' ? 'Blades Max' : 'Premium'} is on.`}
                </Text>
              </View>
            ) : null}
            <Text style={s.eyebrow}>LAST STEP</Text>
            {(() => {
              // Ett förvalt förslag efter vägen: skanna boken, eller importera från appen eller filen man har.
              const scanDest: Dest | null = pilot ? (SCAN_OPEN ? '/import/scan' : null) : DRONE_BOOK_SCAN;
              const importDest: Dest = pilot ? '/import' : '/drone-import';
              const totalsDest: Dest = pilot ? '/import/manual' : '/drone-import/manual';
              const named = app && app !== 'Another app' ? app : null;
              const scanRow = scanDest ? (
                <HoursRow key="scan" icon="line-scan" title="Scan your paper logbook" rec={path === 'paper'}
                  desc={hoursScanDesc(paying, bought)} onPress={() => finalize(scanDest)} />
              ) : null;
              const importRow = (
                <HoursRow key="import" icon="file-delimited-outline" rec={where === 'digital' && !starting}
                  title={path === 'sheet' ? 'Import your spreadsheet' : named ? `Import from ${named}` : pilot || where === 'digital' ? 'Import a file' : 'Import a CSV'}
                  desc={where === 'digital' && !starting ? 'You review everything before it is saved.'
                    : pilot ? 'From ForeFlight, LogTen Pro or any other app' : 'From the app you log in today'}
                  onPress={() => finalize(importDest)} />
              );
              const totalsRow = (
                <HoursRow key="totals" icon="pencil-outline" title="Enter starting totals" desc="Type in the hours you have so far"
                  onPress={() => finalize(totalsDest)} />
              );
              const lead = path === 'paper' && scanRow ? scanRow : where === 'digital' && !starting ? importRow : null;
              const rest = [scanRow, importRow, totalsRow].filter((r) => r && r !== lead);
              const title = lead === scanRow && scanRow ? `Start with your first ${FREE_SPREADS} spreads.`
                : lead === importRow ? (path === 'sheet' ? 'Bring your spreadsheet over.' : named ? `Bring your ${named} logbook over.` : 'Bring your logbook over.')
                : 'Bring in your hours';
              const sub = lead === scanRow && scanRow ? 'See how it reads your handwriting before you scan the rest.'
                : lead === importRow ? (path === 'sheet' ? 'Save it as CSV, then pick the file here.' : 'Export it there, then pick the file here.')
                : 'So your totals and licence progress are right from day one.';
              return (
                <>
                  <Text style={s.h1}>{title}</Text>
                  <Text style={s.sub}>{sub}</Text>
                  <View style={{ gap: 12, marginTop: 24 }}>
                    {lead}
                    {lead ? <Text style={[s.lbl, { marginTop: 8 }]}>OR</Text> : null}
                    {rest}
                  </View>
                </>
              );
            })()}
          </Screen>
        ) : null}
      </Animated.View>
    </View>
  );
}

// Hur många uppslag man kan skanna: betalande ser månadens, provveckan och gratis ser gratispotten.
function hoursScanDesc(paying: boolean, bought: PaywallResult): string {
  const spreads = (coins: number) => Math.floor(coins / SCAN_COINS_PER_SPREAD);
  if (bought && bought.trialDays > 0) return `${FREE_SPREADS} spreads in your trial, ${spreads(bought.tier === 'max' ? 500 : 250)} a month after`;
  if (bought) return `About ${spreads(bought.tier === 'max' ? 500 : 250)} spreads this month`;
  if (paying) return 'Photograph your paper logbook';
  return `${FREE_SPREADS} spreads free, more with Blade coins`;
}

function Screen({ insets, children, footer, scrollRef, top = 64 }: { insets: { top: number; bottom: number }; children: React.ReactNode; footer?: React.ReactNode; scrollRef?: React.RefObject<ScrollView | null>; top?: number }) {
  return (
    <View style={{ flex: 1 }}>
      <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={{ paddingTop: insets.top + top, paddingHorizontal: 22, paddingBottom: 20 }}
        showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
        {children}
      </ScrollView>
      {footer ? <View style={{ paddingHorizontal: 22, paddingTop: 6, paddingBottom: insets.bottom + 10 }}>{footer}</View> : null}
    </View>
  );
}

function CloseBtn({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={s.back} hitSlop={6} accessibilityRole="button" accessibilityLabel="Close the preview">
      <Ionicons name="close" size={22} color={SOFT} />
    </Pressable>
  );
}

function Cta({ label, onPress, disabled, busy }: { label: string; onPress: () => void; disabled?: boolean; busy?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled || busy} accessibilityRole="button" accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [s.cta, disabled && { opacity: 0.32, shadowOpacity: 0 }, pressed && { transform: [{ scale: 0.985 }] }]}>
      {busy ? <ActivityIndicator color={INK} /> : <Text style={s.ctaText}>{label}</Text>}
    </Pressable>
  );
}

// Ett kort svar som en bricka (timmar, app, pris).
function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, s.chipTall, on && s.chipOn]} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={label}>
      <Text style={[s.chipText, on && { color: '#FFFFFF' }]}>{label}</Text>
    </Pressable>
  );
}

// Ett svar på en fråga: radioknapp och text, med ikon och underrad där det behövs.
function Choice({ title, sub, icon, on, onPress }: { title: string; sub?: string; icon?: keyof typeof Ionicons.glyphMap; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.opt, !sub && { minHeight: 52, paddingVertical: 8 }, on && s.optOn]}
      accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={sub ? `${title}. ${sub}` : title}>
      {icon ? <View style={s.cicon}><Ionicons name={icon} size={20} color={CYAN} /></View> : null}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={s.ot}>{title}</Text>
        {sub ? <Text style={s.os}>{sub}</Text> : null}
      </View>
      <View style={[s.radio, on && { borderColor: CYAN }]}>{on ? <View style={s.radioDot} /> : null}</View>
    </Pressable>
  );
}

function HoursRow({ icon, title, desc, rec, onPress }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; title: string; desc: string; rec?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.row, rec && s.rowRec]} accessibilityRole="button" accessibilityLabel={`${title}. ${desc}`}>
      <View style={s.ricon}><MaterialCommunityIcons name={icon} size={24} color={CYAN} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={s.ot}>{title}</Text>
        <Text style={s.os}>{desc}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={MUTED} />
    </Pressable>
  );
}

// Välkomstskärmen: Blades-loggan överst, hemsidans bild med två telefoner, en rubrik och Get started.
function Welcome({ insets, onStart, onClose }: { insets: { top: number; bottom: number }; onStart: () => void; onClose?: () => void }) {
  const y = useSharedValue(0);
  const glow = useSharedValue(0);
  useEffect(() => {
    y.value = withRepeat(withTiming(-7, { duration: 3500, easing: Easing.inOut(Easing.sin) }), -1, true);
    glow.value = withRepeat(withTiming(1, { duration: 3500, easing: Easing.inOut(Easing.sin) }), -1, true);
    return () => { cancelAnimation(y); cancelAnimation(glow); };
  }, [y, glow]);
  const floatStyle = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  const glowStyle = useAnimatedStyle(() => ({ opacity: 0.75 + 0.25 * glow.value, transform: [{ scale: 0.96 + 0.09 * glow.value }] }));
  return (
    <View style={{ flex: 1, paddingTop: insets.top + 14, paddingHorizontal: 22, paddingBottom: insets.bottom + 12 }}>
      {onClose ? <View style={{ position: 'absolute', top: insets.top + 6, right: 10, zIndex: 5 }}><CloseBtn onPress={onClose} /></View> : null}
      <View style={{ alignItems: 'center' }}>
        <Image source={LOCKUP} style={{ width: 228, height: 51 }} resizeMode="contain" accessibilityLabel="Blades pilot logbook" />
      </View>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 220 }}>
        <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: 420, height: 420 }, glowStyle]}>
          <Svg width={420} height={420}>
            <Defs>
              <RadialGradient id="obGlow" cx="50%" cy="50%" r="50%">
                <Stop offset="0" stopColor={CYAN} stopOpacity={0.2} />
                <Stop offset="0.55" stopColor="#346EC8" stopOpacity={0.07} />
                <Stop offset="1" stopColor={CYAN} stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={210} cy={210} r={210} fill="url(#obGlow)" />
          </Svg>
        </Animated.View>
        <Animated.View style={[{ width: '86%', height: '100%', maxHeight: 420 }, floatStyle]}>
          <Image source={HERO} style={{ width: '100%', height: '100%' }} resizeMode="contain" accessibilityLabel="Blades on iPhone: the dashboard and the logbook" />
        </Animated.View>
      </View>
      <Text style={[s.h1, { fontSize: 34, lineHeight: 37, textAlign: 'center', marginTop: 6 }]}>One logbook for every pilot.</Text>
      <Text style={[s.sub, { textAlign: 'center', fontSize: 15.5, lineHeight: 22, marginTop: 12 }]}>
        Helicopter, airplane or drone. In training, flying for work or just for fun.
      </Text>
      <View style={{ marginTop: 28, gap: 12, alignItems: 'center' }}>
        <Pressable onPress={onStart} accessibilityRole="button" style={({ pressed }) => [s.cta, { alignSelf: 'stretch', flexDirection: 'row', gap: 8 }, pressed && { transform: [{ scale: 0.985 }] }]}>
          <Text style={s.ctaText}>Get started</Text>
          <Ionicons name="arrow-forward" size={18} color={INK} />
        </Pressable>
        <Text style={{ fontFamily: MONO, fontSize: 10, letterSpacing: 1.4, color: MUTED }}>NO ACCOUNT NEEDED · PRIVATE BY DESIGN</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  top: { position: 'absolute', left: 0, right: 0, top: 0, zIndex: 5, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  segs: { flex: 1, flexDirection: 'row', gap: 5, paddingHorizontal: 6 },
  seg: { flex: 1, height: 4, borderRadius: 2, backgroundColor: 'rgba(127,168,200,0.18)' },
  segOn: { backgroundColor: CYAN },
  eyebrow: { fontFamily: MONO, fontSize: 10.5, fontWeight: '700', letterSpacing: 1.9, color: CYAN },
  h1: { fontFamily: SERIF, fontSize: 31, fontWeight: '600', lineHeight: 34, color: '#FFFFFF', marginTop: 8 },
  sub: { fontSize: 14.5, lineHeight: 21, color: SUB, marginTop: 10 },
  lbl: { fontFamily: MONO, fontSize: 10.5, fontWeight: '600', letterSpacing: 1.9, color: MUTED },
  note: { fontSize: 12.5, lineHeight: 18, color: SUB, marginTop: 8 },
  glass: { backgroundColor: 'rgba(15,30,58,0.62)', borderWidth: 1, borderColor: 'rgba(0,200,232,0.16)', borderRadius: 16 },
  tile: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 140, paddingRight: 18, borderRadius: 22, backgroundColor: 'rgba(15,30,58,0.55)', borderWidth: 1, borderColor: 'rgba(127,168,200,0.16)', overflow: 'hidden' },
  tileOn: { borderWidth: 2, borderColor: CYAN, backgroundColor: 'rgba(0,200,232,0.08)' },
  tileImg: { width: 150, height: 150, marginLeft: -10 },
  tileTitle: { fontFamily: SERIF, fontSize: 23, fontWeight: '600', color: '#FFFFFF' },
  tileDesc: { fontSize: 13, lineHeight: 17.5, color: SUB },
  tileTag: { fontFamily: MONO, fontSize: 10, fontWeight: '600', letterSpacing: 1.2, color: CYAN, marginTop: 4 },
  tick: { position: 'absolute', top: 12, right: 12, width: 24, height: 24, borderRadius: 12, backgroundColor: CYAN, alignItems: 'center', justifyContent: 'center' },
  opt: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 66, paddingVertical: 12, paddingLeft: 16, paddingRight: 14, borderRadius: 16, backgroundColor: 'rgba(15,30,58,0.55)', borderWidth: 1, borderColor: 'rgba(127,168,200,0.16)' },
  optOn: { borderWidth: 2, borderColor: CYAN, backgroundColor: 'rgba(0,200,232,0.08)', paddingLeft: 15, paddingRight: 13 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: 'rgba(127,168,200,0.45)', alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: CYAN },
  ot: { fontSize: 15.5, fontWeight: '600', color: '#FFFFFF' },
  os: { fontSize: 12.5, lineHeight: 17, color: SUB },
  badge: { fontFamily: MONO, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.6, color: SOFT, paddingVertical: 5, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(127,168,200,0.25)', overflow: 'hidden' },
  chg: { height: 34, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: 'rgba(0,200,232,0.4)', backgroundColor: 'rgba(0,200,232,0.08)', alignItems: 'center', justifyContent: 'center' },
  chgText: { fontFamily: MONO, fontSize: 11, fontWeight: '700', letterSpacing: 0.6, color: CYAN },
  chip: { height: 40, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(127,168,200,0.22)', backgroundColor: 'rgba(15,30,58,0.5)', justifyContent: 'center' },
  chipTall: { height: 44 },
  hBig: { fontFamily: SERIF, fontSize: 35, fontWeight: '700', lineHeight: 38, letterSpacing: -0.7, color: '#FFFFFF', marginTop: 6 },
  tileS: { flex: 1, gap: 3, paddingVertical: 12, paddingHorizontal: 10, borderRadius: 16, backgroundColor: 'rgba(15,30,58,0.7)', borderWidth: 1, borderColor: 'rgba(127,168,200,0.3)' },
  tileGood: { backgroundColor: 'rgba(25,230,165,0.1)', borderColor: 'rgba(25,230,165,0.55)' },
  tileN: { fontFamily: SERIF, fontSize: 25, fontWeight: '700', lineHeight: 29, color: '#FFFFFF' },
  tileL: { fontSize: 12, lineHeight: 16, color: '#B4C9DD' },
  q: { fontFamily: SERIF, fontSize: 21, fontWeight: '600', lineHeight: 26, color: '#FFFFFF', marginTop: 30 },
  qBody: { gap: 8, marginTop: 12 },
  qSub: { marginTop: 18, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  h2: { fontFamily: SERIF, fontSize: 23, fontWeight: '600', lineHeight: 27, color: '#FFFFFF' },
  cicon: { width: 38, height: 38, borderRadius: 11, backgroundColor: 'rgba(0,200,232,0.1)', alignItems: 'center', justifyContent: 'center' },
  chipOn: { borderColor: CYAN, backgroundColor: 'rgba(0,200,232,0.14)' },
  chipText: { fontFamily: MONO, fontSize: 12.5, fontWeight: '600', color: SOFT },
  cta: { height: 54, borderRadius: 16, backgroundColor: CYAN, alignItems: 'center', justifyContent: 'center', shadowColor: CYAN, shadowOpacity: 0.22, shadowRadius: 14, shadowOffset: { width: 0, height: 8 } },
  ctaText: { fontSize: 16.5, fontWeight: '700', color: INK },
  ghost: { height: 48, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 14.5, fontWeight: '600', color: SUB },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 76, padding: 14, borderRadius: 18, backgroundColor: 'rgba(15,30,58,0.55)', borderWidth: 1, borderColor: 'rgba(127,168,200,0.16)' },
  rowRec: { borderColor: 'rgba(0,200,232,0.6)', backgroundColor: 'rgba(0,200,232,0.07)' },
  ricon: { width: 46, height: 46, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, paddingHorizontal: 14, borderRadius: 14, marginBottom: 16, backgroundColor: 'rgba(25,230,165,0.10)', borderWidth: 1, borderColor: 'rgba(25,230,165,0.35)' },
  toastText: { flex: 1, fontSize: 13.5, fontWeight: '600', color: '#E6FFF6' },
});
