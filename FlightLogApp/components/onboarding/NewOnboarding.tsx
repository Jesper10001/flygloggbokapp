// Den nya onboardingen (designen "Onboarding redesign"): välkomst → farkost → mål och regelverk → om dig →
// profilkortet → betalväggen (OnboardingPaywall) → timmarna, sedan dashboarden med rundturfrågan som förut. Samma
// navy-gradient, typsnitt och kort som appen. Den som lägger till en andra roll får farkost → … → timmar, utan
// välkomst och betalvägg. Initialer, signatur och tidsformat väljs inte här längre (profilsidan har dem).
// Svaren om timmar, mål och pappersbok sparas i settings (onboarding_*) för senare anpassning.
// preview: visas från Inställningar i TestFlight-bygget; sparar ingenting och går tillbaka i slutet.

import { useEffect, useRef, useState } from 'react';
import { View, Text, Image, Pressable, TextInput, ScrollView, Switch, ActivityIndicator, StyleSheet, type ImageSourcePropType } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
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
import { setSetting, getSetting } from '../../db/flights';
import { getOnboardingPlans, type PlanOption } from '../../services/purchases';
import { OnboardingPaywall, type PaywallResult } from './OnboardingPaywall';

const CYAN = '#00C8E8';
const GOLD = '#FFB830';
const INK = '#06101E';
const SUB = '#8FB0CC';
const MUTED = '#6E8FB0';
const SOFT = '#CFE0EE';
const MONO = 'JetBrainsMono';
const SERIF = 'Fraunces';

type Step = 'welcome' | 'aircraft' | 'goal' | 'you' | 'ready' | 'paywall' | 'hours';
type Craft = 'heli' | 'plane' | 'drone';
type Dest = '/import/scan' | '/import/manual' | '/import' | '/drone-import' | '/drone-import/manual';

const IMG: Record<Craft, ImageSourcePropType> = {
  heli: require('../../assets/onboarding/heli.png'),
  plane: require('../../assets/onboarding/plane.png'),
  drone: require('../../assets/onboarding/drone.png'),
};
const HERO = require('../../assets/onboarding/hero-phones.png');
const LOCKUP = require('../../assets/onboarding/blades-lockup.png');
const MARK = require('../../assets/onboarding/b-mark.png');

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
const PROGRESS: Partial<Record<Step, number>> = { aircraft: 1, goal: 2, you: 3, ready: 4, hours: 5 };

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
  const [goal, setGoal] = useState<string | null>(null);
  const [rules, setRules] = useState<RegulationStandard>(() => standardForRegion(useRegulationStandardStore.getState().standard));
  const [name, setName] = useState('');
  const [hours, setHours] = useState<number | null>(null);
  const [paper, setPaper] = useState(false);
  const [readyStep, setReadyStep] = useState(0);
  const [plans, setPlans] = useState<PlanOption[] | null>(null);
  const [bought, setBought] = useState<PaywallResult>(null);
  const [waiting, setWaiting] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const plansPromise = useRef<Promise<PlanOption[]> | null>(null);

  useEffect(() => {
    getSetting('profile_first_name').then((v) => { if (v) setName(v); }).catch(() => {});
    // Planerna hämtas i bakgrunden, så att betalväggen är redo när man kommer dit.
    if (!returning) {
      plansPromise.current = getOnboardingPlans().catch(() => []);
      plansPromise.current.then(setPlans);
    }
    return () => { timers.current.forEach(clearTimeout); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Profilkortet: raderna bockas av en i taget, sedan kommer kortet upp.
  useEffect(() => {
    if (step !== 'ready') return;
    setReadyStep(0);
    const ids = [1, 2, 3, 4, 5].map((n) => setTimeout(() => setReadyStep(n), 430 * n));
    return () => ids.forEach(clearTimeout);
  }, [step]);

  const pilot = craft !== 'drone';
  const sfx = craft === 'plane' ? '(A)' : '(H)';
  const rule = RULES.find((r) => r.k === rules) ?? RULES[0];
  const pilotGoal = pilot ? PILOT_GOALS.find((g) => g.k === goal) ?? null : null;
  const droneGoal = !pilot ? DRONE_GOALS.find((g) => g.k === goal) ?? null : null;
  const lic = pilotGoal?.lic ? pilotGoal.lic + sfx : '';
  const hourList = pilot ? PILOT_HOURS : DRONE_HOURS;
  const first = name.trim();

  const crafts = CRAFTS.filter((c) => !returning
    || (currentProfile?.mainRole === 'pilot-manned' ? c.key === 'drone' : c.key !== 'drone'));

  const tap = () => { Haptics.selectionAsync().catch(() => {}); };
  const go = (s: Step) => setStep(s);
  const back: Partial<Record<Step, Step>> = { aircraft: 'welcome', goal: 'aircraft', you: 'goal', ready: 'you', hours: 'ready' };
  const canBack = step !== 'welcome' && step !== 'paywall' && !(returning && step === 'aircraft');

  const pickCraft = (k: Craft) => {
    tap();
    if (craft && (craft === 'drone') !== (k === 'drone')) { setGoal(null); setHours(null); }
    setCraft(k);
    timers.current.push(setTimeout(() => go('goal'), 320));
  };

  // Efter profilkortet: betalväggen för nya användare som inte redan betalar och när köp går, annars timmarna.
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
  if (!pilot) { pwTitle = 'Every drone flight logged in seconds.'; pwSub = 'VLOS to BVLOS, all your flying in one place.'; }
  else if (paper) { pwTitle = 'Bring your paper logbook with you.'; pwSub = 'Scan your pages and keep every hour in one place.'; }
  else if (hours === 4) { pwTitle = '1 500+ hours deserve a better logbook.'; pwSub = acLine; }
  else if (hours === 3) { pwTitle = 'Every hour you have flown, finally in one place.'; pwSub = acLine; }
  else if (hours === 0 || hours === 1) { pwTitle = 'Start your logbook the right way.'; pwSub = 'Every hour counts. From day one.'; }
  else if (goal === 'log') { pwTitle = 'Logging done in seconds.'; pwSub = 'Log it once. Blades does the rest.'; }
  else { pwTitle = 'Your whole flying life in one logbook.'; pwSub = acLine; }

  const finalize = async (dest?: Dest) => {
    if (preview) { router.back(); return; }
    try {
      if (!craft) { router.replace('/(tabs)'); return; }
      const mainRole: MainRole = pilot ? 'pilot-manned' : 'pilot-unmanned';
      const subRole: SubRole = pilot ? (craft === 'heli' ? 'rotary' : 'fixed') : ((goal as SubRole) || 'commercial');
      const profile: Profile = { mainRole, subRole };
      if (pilot) await useRegulationStandardStore.getState().setStandard(rules);
      else await useTimeFormatStore.getState().setTimeFormat('hhmm');
      await useProfileStore.getState().setProfile(profile);
      if (first) {
        await setSetting('profile_first_name', first);
        const ini = await getSetting('profile_initials');
        if (!ini) await setSetting('profile_initials', first.charAt(0).toUpperCase());
      }
      await setSetting('onboarding_goal', goal ?? '');
      await setSetting('onboarding_hours', hours == null ? '' : hourList[hours]);
      await setSetting('onboarding_paper', paper ? '1' : '0');
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
          <View style={s.segs} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 5, now: prog }}>
            {[1, 2, 3, 4, 5].map((n) => <View key={n} style={[s.seg, n <= prog && s.segOn]} />)}
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

        {step === 'goal' ? (
          <Screen insets={insets} footer={<Cta label="Continue" disabled={!goal} onPress={() => go('you')} />}>
            <Text style={s.eyebrow}>{pilot ? 'YOUR GOAL' : 'YOUR FLYING'}</Text>
            <Text style={s.h1}>{pilot ? 'Where are you headed?' : 'What kind of flying?'}</Text>
            <Text style={s.sub}>{pilot ? 'Blades tracks every requirement and estimates the month you get there.' : 'We tailor categories, certificates and reports to it.'}</Text>
            <View style={{ gap: 10, marginTop: 22 }}>
              {(pilot ? PILOT_GOALS : DRONE_GOALS as { k: string; title: string; sub: string; lic?: string; badge?: string }[]).map((g: { k: string; title: string; sub: string; lic?: string; badge?: string }) => {
                const on = goal === g.k;
                const badge = g.lic ? g.lic + sfx : g.badge ?? '';
                return (
                  <Pressable key={g.k} onPress={() => { tap(); setGoal(g.k); }} style={[s.opt, on && s.optOn]}
                    accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={`${g.title}, ${g.sub}`}>
                    <View style={[s.radio, on && { borderColor: CYAN }]}>{on ? <View style={s.radioDot} /> : null}</View>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <Text style={s.ot}>{g.title}</Text>
                      <Text style={s.os}>{g.sub}</Text>
                    </View>
                    <Text style={[s.badge, on && { color: CYAN, borderColor: 'rgba(0,200,232,0.5)' }]}>{badge}</Text>
                  </Pressable>
                );
              })}
            </View>
            {pilot ? (
              <>
                <View style={[s.glass, { marginTop: 16, paddingVertical: 10, paddingLeft: 16, paddingRight: 10, flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
                  <Text style={s.lbl}>RULES</Text>
                  <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: '#FFFFFF' }}>{rule.name}</Text>
                  <Pressable onPress={() => { tap(); setRules(RULES[(RULES.indexOf(rule) + 1) % RULES.length].k); }} style={s.chg}
                    accessibilityRole="button" accessibilityLabel={`Rules: ${rule.name}. Change`}>
                    <Text style={s.chgText}>Change</Text>
                  </Pressable>
                </View>
                <Text style={[s.note, { paddingHorizontal: 4 }]}>Set from your region. EASA, FAA and UK CAA are all supported.</Text>
              </>
            ) : null}
          </Screen>
        ) : null}

        {step === 'you' ? (
          <Screen insets={insets} footer={<Cta label="Continue" onPress={() => go('ready')} />}>
            <Text style={s.eyebrow}>ABOUT YOU</Text>
            <Text style={s.h1}>What should we call you?</Text>
            <Text style={s.sub}>Your name goes on your logbook pages and exports.</Text>
            <Text style={[s.lbl, { marginTop: 22 }]} nativeID="ob-first-name">FIRST NAME</Text>
            <TextInput value={name} onChangeText={setName} placeholder="First name" placeholderTextColor={MUTED}
              style={s.field} autoCapitalize="words" autoComplete="given-name" textContentType="givenName" returnKeyType="done"
              accessibilityLabelledBy="ob-first-name" accessibilityLabel="First name" />
            <Text style={[s.lbl, { marginTop: 24, marginBottom: 10 }]}>{pilot ? 'HOURS SO FAR' : 'FLIGHT HOURS SO FAR'}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {hourList.map((l, i) => {
                const on = hours === i;
                return (
                  <Pressable key={l} onPress={() => { tap(); setHours(i); }} style={[s.chip, on && s.chipOn]}
                    accessibilityRole="radio" accessibilityState={{ checked: on }}>
                    <Text style={[s.chipText, on && { color: '#FFFFFF' }]}>{l}</Text>
                  </Pressable>
                );
              })}
            </View>
            <View style={[s.glass, { marginTop: 18, padding: 14, paddingLeft: 16, flexDirection: 'row', alignItems: 'center', gap: 14 }]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={s.ot}>{pilot ? 'I have a paper logbook' : 'I have flights in another app'}</Text>
                <Text style={s.os}>{pilot ? 'We help you bring it in, page by page.' : 'Bring them in with a CSV.'}</Text>
              </View>
              <Switch value={paper} onValueChange={(v) => { tap(); setPaper(v); }} trackColor={{ true: CYAN, false: 'rgba(127,168,200,0.25)' }}
                accessibilityLabel={pilot ? 'I have a paper logbook' : 'I have flights in another app'} />
            </View>
          </Screen>
        ) : null}

        {step === 'ready' ? (
          <Screen insets={insets} footer={<Cta label="Continue" disabled={readyStep < 5} busy={waiting} onPress={afterReady} />}>
            <Text style={s.eyebrow}>{readyStep >= 5 ? 'ALL SET' : 'ONE MOMENT'}</Text>
            <Text style={s.h1}>{readyStep >= 5 ? (first ? `Your logbook is ready, ${first}.` : 'Your logbook is ready.') : 'Setting up your logbook…'}</Text>
            <View style={{ gap: 6, marginTop: 16 }}>
              {(pilot
                ? [`${craft === 'plane' ? 'Airplane' : 'Helicopter'} logbook`, `${rule.name} rules`, lic ? `${lic} requirements` : 'Currency and recency', 'Airports worldwide']
                : ['Drone logbook', `${droneGoal?.title ?? 'Open'} category`, 'VLOS, EVLOS and BVLOS time', 'Airports worldwide']
              ).map((t, i) => {
                const done = readyStep > i;
                return (
                  <View key={t} style={s.rline}>
                    <View style={s.rdot}>{done
                      ? <View style={s.chk}><Ionicons name="checkmark" size={13} color={CYAN} /></View>
                      : <ActivityIndicator size="small" color={CYAN} />}</View>
                    <Text style={{ fontSize: 14, color: done ? '#FFFFFF' : SUB }}>{t}</Text>
                  </View>
                );
              })}
            </View>
            {readyStep >= 5 ? (
              <Animated.View entering={FadeInDown.duration(520)}>
                <ProfileCard name={first || 'Your name'} pilot={pilot} craft={craft ?? 'heli'} rule={rule} lic={lic} sfx={sfx}
                  goalKey={goal} droneGoal={droneGoal?.title ?? 'Open'} droneBadge={droneGoal?.badge ?? 'OPEN'}
                  hours={hours == null ? '—' : hourList[Math.min(hours, hourList.length - 1)]} />
              </Animated.View>
            ) : null}
          </Screen>
        ) : null}

        {step === 'paywall' && plans && plans.length ? (
          <OnboardingPaywall plans={plans} pilot={pilot} lic={lic} paper={paper} title={pwTitle} sub={pwSub}
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
            <Text style={s.h1}>Bring in your hours</Text>
            <Text style={s.sub}>So your totals and licence progress are right from day one.</Text>
            <View style={{ gap: 12, marginTop: 24 }}>
              {SCAN_OPEN && pilot ? (
                <HoursRow icon="line-scan" title="Scan your paper logbook" rec={paper}
                  desc={hoursScanDesc(paying, bought)} onPress={() => finalize('/import/scan')} />
              ) : null}
              <HoursRow icon="file-delimited-outline" title="Import a CSV"
                desc={pilot ? 'From ForeFlight, LogTen Pro or any other app' : 'From the app you log in today'}
                onPress={() => finalize(pilot ? '/import' : '/drone-import')} />
              <HoursRow icon="pencil-outline" title="Enter starting totals" desc="Type in the hours you have so far"
                onPress={() => finalize(pilot ? '/import/manual' : '/drone-import/manual')} />
            </View>
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

function Screen({ insets, children, footer }: { insets: { top: number; bottom: number }; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: insets.top + 64, paddingHorizontal: 22, paddingBottom: 20 }}
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

function HoursRow({ icon, title, desc, rec, onPress }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; title: string; desc: string; rec?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.row, rec && s.rowRec]} accessibilityRole="button" accessibilityLabel={`${title}. ${desc}`}>
      {rec ? <View style={s.rtag}><Text style={s.rtagText}>RECOMMENDED</Text></View> : null}
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

// Profilkortet: namnet, farkosten, regelverket och timmarna, och licensstegen med målet tänt.
function ProfileCard({ name, pilot, craft, rule, lic, sfx, goalKey, droneGoal, droneBadge, hours }: {
  name: string; pilot: boolean; craft: Craft; rule: { short: string; name: string }; lic: string; sfx: string;
  goalKey: string | null; droneGoal: string; droneBadge: string; hours: string;
}) {
  const kind = craft === 'plane' ? 'Airplane pilot' : craft === 'heli' ? 'Helicopter pilot' : 'Drone pilot';
  const gi = ['ppl', 'cpl', 'atpl'].indexOf(goalKey ?? '');
  const cells = [
    { l: 'AIRCRAFT', v: craft === 'plane' ? 'Airplane' : craft === 'heli' ? 'Helicopter' : 'Drone' },
    { l: pilot ? 'RULES' : 'CATEGORY', v: pilot ? rule.short : droneBadge },
    { l: 'HOURS', v: hours },
  ];
  return (
    <LinearGradient colors={['rgba(18,40,74,0.95)', 'rgba(10,24,46,0.95)']} start={{ x: 0, y: 0 }} end={{ x: 0.6, y: 1 }} style={s.pcard}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Image source={MARK} style={{ width: 18, height: 20 }} resizeMode="contain" />
        <Text style={[s.lbl, { color: SUB }]}>{pilot ? 'PILOT PROFILE' : 'DRONE PILOT PROFILE'}</Text>
        <Text style={[s.lbl, { marginLeft: 'auto', color: CYAN }]}>{pilot ? rule.short : droneBadge}</Text>
      </View>
      <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontFamily: SERIF, fontSize: 36, fontWeight: '600', color: '#FFFFFF', marginTop: 14 }}>{name}</Text>
      <Text style={[s.os, { fontSize: 13.5, marginTop: 4 }]}>
        {pilot ? `${kind}${lic ? ` · goal ${lic}` : ' · logging and currency'}` : `${kind} · ${droneGoal}`}
      </Text>
      <View style={s.cells}>
        {cells.map((c, i) => (
          <View key={c.l} style={[s.cell, i > 0 && { borderLeftWidth: 1, borderLeftColor: 'rgba(0,200,232,0.18)' }]}>
            <Text style={s.cl}>{c.l}</Text>
            <Text style={s.cv} numberOfLines={1} adjustsFontSizeToFit>{c.v}</Text>
          </View>
        ))}
      </View>
      {pilot && gi >= 0 ? (
        <View style={s.ladder}>
          <View style={s.lline} />
          {['PPL', 'CPL', 'ATPL'].map((l, i) => (
            <View key={l} style={s.ln}>
              <View style={[s.lnode, i < gi && s.lnodePre, i === gi && s.lnodeGoal]} />
              <Text style={[s.llabel, i === gi && { color: '#FFFFFF' }]}>{l}{sfx}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {!pilot ? (
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
          {['VLOS', 'EVLOS', 'BVLOS'].map((m) => <Text key={m} style={s.mode}>{m}</Text>)}
        </View>
      ) : null}
      <Text style={[s.note, { marginTop: 12 }]}>
        {lic ? `Log or import 10 flights and Blades estimates the month you reach ${lic}.`
          : pilot ? 'Currency and stats update with every flight you log.' : 'Hours per flight mode update with every flight you log.'}
      </Text>
    </LinearGradient>
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
  field: { height: 58, marginTop: 8, borderRadius: 16, backgroundColor: 'rgba(15,30,58,0.6)', borderWidth: 1, borderColor: 'rgba(127,168,200,0.22)', paddingHorizontal: 18, fontFamily: SERIF, fontSize: 24, color: '#FFFFFF' },
  chip: { height: 40, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(127,168,200,0.22)', backgroundColor: 'rgba(15,30,58,0.5)', justifyContent: 'center' },
  chipOn: { borderColor: CYAN, backgroundColor: 'rgba(0,200,232,0.14)' },
  chipText: { fontFamily: MONO, fontSize: 12.5, fontWeight: '600', color: SOFT },
  rline: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 26 },
  rdot: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  chk: { width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,200,232,0.16)', alignItems: 'center', justifyContent: 'center' },
  pcard: { marginTop: 16, padding: 18, borderRadius: 22, borderWidth: 1, borderColor: 'rgba(0,200,232,0.35)', shadowColor: CYAN, shadowOpacity: 0.14, shadowRadius: 24, shadowOffset: { width: 0, height: 0 } },
  cells: { flexDirection: 'row', marginTop: 16, borderTopWidth: 1, borderBottomWidth: 1, borderColor: 'rgba(0,200,232,0.18)' },
  cell: { flex: 1, alignItems: 'center', gap: 5, paddingVertical: 10, paddingHorizontal: 4 },
  cl: { fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.5, color: GOLD },
  cv: { fontFamily: MONO, fontSize: 12.5, fontWeight: '600', color: '#FFFFFF' },
  ladder: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 18, marginHorizontal: 6, height: 48 },
  lline: { position: 'absolute', left: 30, right: 30, top: 8, height: 2, backgroundColor: 'rgba(0,200,232,0.4)' },
  ln: { width: 72, alignItems: 'center', gap: 8 },
  lnode: { width: 12, height: 12, marginTop: 3, borderRadius: 6, backgroundColor: '#0A1628', borderWidth: 2, borderColor: 'rgba(127,168,200,0.5)' },
  lnodePre: { backgroundColor: 'rgba(127,168,200,0.5)', borderColor: 'transparent' },
  lnodeGoal: { width: 18, height: 18, marginTop: 0, borderRadius: 9, borderColor: CYAN, shadowColor: CYAN, shadowOpacity: 0.9, shadowRadius: 9, shadowOffset: { width: 0, height: 0 } },
  llabel: { fontFamily: MONO, fontSize: 11, fontWeight: '700', color: MUTED },
  mode: { fontFamily: MONO, fontSize: 11, fontWeight: '700', letterSpacing: 0.9, color: CYAN, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 9, borderWidth: 1, borderColor: 'rgba(0,200,232,0.35)', overflow: 'hidden' },
  cta: { height: 54, borderRadius: 16, backgroundColor: CYAN, alignItems: 'center', justifyContent: 'center', shadowColor: CYAN, shadowOpacity: 0.22, shadowRadius: 14, shadowOffset: { width: 0, height: 8 } },
  ctaText: { fontSize: 16.5, fontWeight: '700', color: INK },
  ghost: { height: 48, alignItems: 'center', justifyContent: 'center' },
  ghostText: { fontSize: 14.5, fontWeight: '600', color: SUB },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 76, padding: 14, borderRadius: 18, backgroundColor: 'rgba(15,30,58,0.55)', borderWidth: 1, borderColor: 'rgba(127,168,200,0.16)' },
  rowRec: { borderColor: 'rgba(0,200,232,0.6)', backgroundColor: 'rgba(0,200,232,0.07)' },
  ricon: { width: 46, height: 46, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  rtag: { position: 'absolute', top: -9, left: 16, backgroundColor: CYAN, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3, zIndex: 2 },
  rtagText: { fontFamily: MONO, fontSize: 9, fontWeight: '800', letterSpacing: 1.1, color: INK },
  toast: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, paddingHorizontal: 14, borderRadius: 14, marginBottom: 16, backgroundColor: 'rgba(25,230,165,0.10)', borderWidth: 1, borderColor: 'rgba(25,230,165,0.35)' },
  toastText: { flex: 1, fontSize: 13.5, fontWeight: '600', color: '#E6FFF6' },
});
