import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, Image, TextInput, KeyboardAvoidingView, Platform, Dimensions, type ImageSourcePropType } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, { FadeIn, useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing, cancelAnimation } from 'react-native-reanimated';
import { useLanguageStore } from '../store/languageStore';
import { useTimeFormatStore, type TimeFormat } from '../store/timeFormatStore';
import { useAppModeStore } from '../store/appModeStore';
import { useProfileStore, type MainRole, type SubRole, type Profile, targetForProfile } from '../store/profileStore';
import { useRegulationStandardStore, type RegulationStandard } from '../store/regulationStandardStore';
import { useOperatorStore } from '../store/operatorStore';
import { setSetting, getSetting } from '../db/flights';
import { SignatureView, SignatureModal, type SignatureData } from '../components/SignaturePad';
import { NavyColors } from '../constants/colors';
import { DashboardGlobe } from '../components/DashboardGlobe';
import { ONBOARDING_AIRPORTS } from '../constants/onboardingAirports';

type Step =
  | 'welcome' | 'intro1' | 'intro2' | 'intro3' | 'intro4' | 'role' | 'subrole'
  | 'framework' | 'timeformat' | 'droneid'
  | 'theme' | 'profile' | 'hours';

type MCI = keyof typeof MaterialCommunityIcons.glyphMap;

// Onboarding ritas alltid på navy-canvasen (appens signaturtema). Accenten
// hintar vald roll: cyan för pilot/operatör, amber för drönare. Ikonerna hålls
// neutralt silver och tonas i accenten först när något är valt.
const C = NavyColors;
// Förenat färgschema: samma accent (navy primary) oavsett roll.
const accentForRole = (_role: MainRole | null): string => C.primary;

const MAIN_ROLES: { key: MainRole; icon: MCI; title_en: string; title_sv: string; desc_en: string; desc_sv: string }[] = [
  { key: 'pilot-manned', icon: 'airplane', title_en: 'Pilot', title_sv: 'Pilot', desc_en: 'Manned aircraft — helicopter or airplane.', desc_sv: 'Bemannat luftfartyg — helikopter eller flygplan.' },
  { key: 'pilot-unmanned', icon: 'quadcopter', title_en: 'Drone Pilot', title_sv: 'Drönaroperatör', desc_en: 'Unmanned aircraft — commercial, military, hobby.', desc_sv: 'Obemannat luftfartyg — kommersiell, militär, hobby.' },
];

const SUB_ROLES: Record<MainRole, { key: SubRole; icon: MCI; title_en: string; title_sv: string; desc_en: string; desc_sv: string }[]> = {
  'pilot-manned': [
    { key: 'rotary', icon: 'helicopter', title_en: 'Helicopter', title_sv: 'Helikopter', desc_en: 'Helicopters and tilt-rotors.', desc_sv: 'Helikoptrar och tiltrotorer.' },
    { key: 'fixed', icon: 'airplane', title_en: 'Airplane', title_sv: 'Flygplan', desc_en: 'Propeller, jet and glider aircraft.', desc_sv: 'Propeller-, jet- och segelflygplan.' },
  ],
  'pilot-unmanned': [
    { key: 'hobby', icon: 'star-four-points', title_en: 'Hobby', title_sv: 'Hobby', desc_en: 'Recreational flying under A1/A3 rules.', desc_sv: 'Hobbyflygning enligt A1/A3-regler.' },
    { key: 'commercial', icon: 'briefcase', title_en: 'Commercial', title_sv: 'Kommersiell', desc_en: 'Paid operations — survey, media, inspection.', desc_sv: 'Betalda uppdrag — mätning, media, inspektion.' },
    { key: 'military', icon: 'shield', title_en: 'Military', title_sv: 'Militär', desc_en: 'Defence and government missions.', desc_sv: 'Försvars- och myndighetsuppdrag.' },
  ],
};

// Bild per roll/underroll (tryck på bilden för att välja). HEMS saknar bild →
// faller tillbaka på det gamla ikon-kortet.
const ROLE_IMG: Record<MainRole, ImageSourcePropType> = {
  'pilot-manned': require('../assets/Pilot-helicopter.PNG'),
  'pilot-unmanned': require('../assets/Drone-military.PNG'),
};
const SUBROLE_IMG: Partial<Record<SubRole, ImageSourcePropType>> = {
  rotary: require('../assets/Pilot-helicopter.PNG'),
  fixed: require('../assets/Pilot-fixedwing.PNG'),
  commercial: require('../assets/Drone-commersial.PNG'),
  military: require('../assets/Drone-military.PNG'),
  hobby: require('../assets/Drone-hobby.PNG'),
};

const STEP_TITLES: Record<MainRole, { en: string; sv: string }> = {
  'pilot-manned': { en: 'What do you fly?', sv: 'Vad flyger du?' },
  'pilot-unmanned': { en: 'How do you fly?', sv: 'Hur flyger du?' },
};

const STEP_SUBS: Record<MainRole, { en: string; sv: string }> = {
  'pilot-manned': { en: 'Pick your primary aircraft category.', sv: 'Välj din primära farkostkategori.' },
  'pilot-unmanned': { en: 'We tailor categories, certificates and reports to your context.', sv: 'Vi anpassar kategorier, certifikat och rapporter efter ditt sammanhang.' },
};

const FRAMEWORKS: { key: RegulationStandard; region: string; title: string; desc_en: string; desc_sv: string }[] = [
  { key: 'easa', region: 'EU', title: 'EASA', desc_en: 'EU — Part-FCL. The European standard.', desc_sv: 'EU — Part-FCL. Europeisk standard.' },
  { key: 'faa', region: 'USA', title: 'FAA', desc_en: 'USA — US regulatory framework.', desc_sv: 'USA — amerikanskt regelverk.' },
  { key: 'caa', region: 'UK', title: 'CAA', desc_en: 'United Kingdom — mirrors EASA.', desc_sv: 'Storbritannien — speglar EASA.' },
];

const manned = (role: MainRole | null) => role !== 'pilot-unmanned';

function buildSteps(role: MainRole | null, returning: boolean): Step[] {
  // Manned: bara subroll-steget (fixed/rotary). Regelverk + tidsformat väljs numera via dropdowns
  // på profilsidan (under Pilot signature), inte som egna steg. Drönare: inget subroll-steg.
  const mid: Step[] = manned(role) ? ['subrole'] : [];
  // Intro-skärmarna (2–4) visas bara för nya användare, mellan welcome och role.
  return [...(returning ? [] : (['welcome', 'intro1', 'intro2', 'intro3', 'intro4'] as Step[])), 'role', ...mid, 'profile', 'hours'];
}

export default function OnboardingScreen() {
  const router = useRouter();
  const { setLanguage } = useLanguageStore();
  const { setTimeFormat } = useTimeFormatStore();
  const { setMode } = useAppModeStore();
  const { setProfile } = useProfileStore();
  const { setStandard } = useRegulationStandardStore();
  const { setOperatorId } = useOperatorStore();

  const currentProfile = useProfileStore(s => s.profile);
  const returning = !!currentProfile;

  const [step, setStep] = useState<Step>(returning ? 'role' : 'welcome');
  const [lang, setLang] = useState<'en' | 'sv'>(() => useLanguageStore.getState().language);
  const [format, setFormat] = useState<TimeFormat>(() => useTimeFormatStore.getState().timeFormat);
  const [standard, setStandardSel] = useState<RegulationStandard>(() => useRegulationStandardStore.getState().standard);
  const [mainRole, setMainRole] = useState<MainRole | null>(null);
  const [pendingSub, setPendingSub] = useState<SubRole | null>(null);
  const [droneId, setDroneId] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [initials, setInitials] = useState('');
  const [credentials, setCredentials] = useState('');
  const [signature, setSignature] = useState<SignatureData | null>(null);
  const [sigModal, setSigModal] = useState(false);

  // Förifyll från befintlig profil (gör replay/lägg-till-roll mjukare).
  useEffect(() => {
    (async () => {
      const [fn, ln, ini, cr, sig, did] = await Promise.all([
        getSetting('profile_first_name'), getSetting('profile_last_name'),
        getSetting('profile_initials'), getSetting('profile_credentials'),
        getSetting('pilot_signature'), getSetting('drone_operator_id'),
      ]);
      if (fn) setFirstName(fn); if (ln) setLastName(ln); if (ini) setInitials(ini);
      if (cr) setCredentials(cr); if (did) setDroneId(did);
      if (sig) { try { setSignature(JSON.parse(sig)); } catch { /* ignore */ } }
    })();
  }, []);

  const sv = lang === 'sv';
  const accent = accentForRole(mainRole);
  const autoInitials = (initials || `${(firstName[0] ?? '')}${(lastName[0] ?? '')}`).toUpperCase();
  const fullName = `${firstName} ${lastName}`.trim();

  const availableMainRoles = currentProfile
    ? MAIN_ROLES.filter(r => r.key !== currentProfile.mainRole)
    : MAIN_ROLES;

  const steps = buildSteps(mainRole, returning);
  const stepIdx = Math.max(0, steps.indexOf(step));
  const totalSteps = steps.length;

  const finalize = async (dest?: '/import/scan' | '/import/manual' | '/import' | '/drone-import' | '/drone-import/manual' | '/(tabs)', push = false) => {
    try {
      if (!mainRole || !pendingSub) { router.replace('/(tabs)'); return; }
      const profile: Profile = { mainRole, subRole: pendingSub };
      await setLanguage(lang);
      await setTimeFormat(manned(mainRole) ? format : 'hhmm');
      if (manned(mainRole)) await setStandard(standard);
      await setProfile(profile);
      if (mainRole === 'pilot-unmanned' && droneId.trim()) await setOperatorId(droneId.trim());
      await setSetting('profile_first_name', firstName);
      await setSetting('profile_last_name', lastName);
      await setSetting('profile_initials', autoInitials);
      await setSetting('profile_credentials', credentials);
      await setSetting('pilot_signature', signature ? JSON.stringify(signature) : '');
      await setMode(targetForProfile(profile));
      await setSetting('has_onboarded', '1');
      await new Promise(r => setTimeout(r, 100));
      // push: lämnar onboarding kvar i stacken så import-vyn kan svepas tillbaka hit. Vi skickar
      // from=onboarding så import-vyn efter lyckad import går DIREKT till dashboarden (inte tillbaka hit).
      // replace: lämnar onboarding (gör det senare → dashboard).
      if (push && dest) router.push(`${dest}?from=onboarding` as any); else router.replace(dest ?? '/(tabs)');
    } catch (e: any) {
      console.error('Onboarding error:', e);
      router.replace('/(tabs)');
    }
  };

  return (
    <SafeAreaView style={s.container}>
      {/* Progress */}
      <View style={s.dotsRow}>
        {Array.from({ length: totalSteps }).map((_, i) => (
          <View key={i} style={[s.dot, i === stepIdx && [s.dotActive, { backgroundColor: accent }]]} />
        ))}
      </View>

      {/* Back */}
      {stepIdx > 0 && (
        <TouchableOpacity style={s.backRow} onPress={() => setStep(steps[stepIdx - 1])} activeOpacity={0.7} hitSlop={8}>
          <Ionicons name="chevron-back" size={18} color={C.textSecondary} />
          <Text style={s.backText}>{sv ? 'Tillbaka' : 'Back'}</Text>
        </TouchableOpacity>
      )}

      {/* Ingen keyboard-push: Continue/Skip stannar nere (täcks av tangentbordet) istället för
          att flyta ovanför det. Inmatningsfälten justeras istället via ScrollViewens keyboard-insets. */}
      <KeyboardAvoidingView style={{ flex: 1, alignSelf: 'stretch' }} behavior={undefined}>
        <Animated.View key={step} entering={FadeIn.duration(220)} style={s.stepContent}>
          {/* ── Welcome (stor logga, ingen text) ── */}
          {step === 'welcome' && (
            <View style={{ flex: 1, alignSelf: 'stretch' }}>
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Image source={require('../assets/logo-splashscreen.png')} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
              </View>
              <View style={{ gap: 12, alignSelf: 'stretch' }}>
                <PrimaryButton label="Get started" accent={accent} onPress={() => setStep('intro1')} />
              </View>
            </View>
          )}

          {/* ── Intro 1 (screen 2): Every aircraft — cyan. Radar-svepet är nyckelrörelsen. ── */}
          {step === 'intro1' && (
            <IntroStage
              accent="#00C8E8" duration={6}
              eyebrow={sv ? 'Alla typer av piloter' : 'Every type of pilot'}
              line1={sv ? 'En loggbok.' : 'One logbook.'}
              line2={sv ? 'Alla luftfartyg.' : 'Every aircraft.'}
              body={sv ? 'Din allt-i-ett, säkert krypterade loggbok — enkel och intuitiv.' : 'Your all-in-one securely encrypted logbook for easy and intuitive use.'}
              sv={sv} onContinue={() => setStep('intro2')} onSkip={() => setStep('role')}
            />
          )}

          {/* ── Intro 2 (screen 3): Paper logbook — gold ── */}
          {step === 'intro2' && (
            <IntroStage
              accent="#FFB830" duration={7}
              eyebrow={sv ? 'Din pappersloggbok' : 'Your paper logbook'}
              line1={sv ? 'Logga här.' : 'Log it here.'}
              line2={sv ? 'Kopiera där.' : 'Copy it there.'}
              body={sv ? 'Sida för sida och rad för rad, med varje summa framförd.' : 'Page for page and row for row, with every total carried forward.'}
              sv={sv} onContinue={() => setStep('intro3')} onSkip={() => setStep('role')}
              extras={(
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 22 }}>
                  <View style={s.introFreeBadge}><Text style={s.introFreeBadgeText}>FREE</Text></View>
                  <Text style={s.introFreeLabel}>{sv ? 'Importera valfri CSV, från valfri app' : 'Import any CSV, from any app'}</Text>
                </View>
              )}
            />
          )}

          {/* ── Intro 3 (screen 4): Security — green ── */}
          {step === 'intro3' && (
            <IntroStage
              accent="#00E8A0" duration={8}
              eyebrow={sv ? 'Säkerhet' : 'Security'}
              line1={sv ? 'Inget konto.' : 'No account.'}
              line2={sv ? 'Bara du.' : 'Only you.'}
              body={sv ? 'Dina flygningar bor i din telefon i en AES-256-krypterad databas. Vi ser dem aldrig.' : 'Your flights live on your phone in an AES-256 encrypted database. We never see them.'}
              sv={sv} onContinue={() => setStep('intro4')} onSkip={() => setStep('role')}
              extras={(
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 22 }}>
                  {['AES-256', sv ? 'Ingen registrering' : 'No sign-up', sv ? 'Inga servrar' : 'No servers'].map((t) => (
                    <View key={t} style={[s.introPill, { borderColor: 'rgba(0,232,160,0.35)' }]}>
                      <Text style={[s.introPillText, { color: '#00E8A0' }]}>{t}</Text>
                    </View>
                  ))}
                </View>
              )}
            />
          )}

          {/* ── Intro 4 (screen 5): Airport globe — cyan. Globen (auto-rotation + drag) är rörelsen. ── */}
          {step === 'intro4' && (
            <View style={{ flex: 1, alignSelf: 'stretch' }}>
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24 }}>
                {/* Fast höjd + overflow:hidden → globens WebView-canvas (som bleeder uppåt) klipps
                    och kan inte längre fånga touch över "Tillbaka"-knappen. demoAirports = 70 riktiga
                    flygplatser som pulserande ringar. */}
                <View style={{ marginHorizontal: -22, height: Math.round(Dimensions.get('window').width * 1.06), overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
                  <DashboardGlobe showHint={false} demoAirports={ONBOARDING_AIRPORTS} />
                </View>
                <View style={{ maxWidth: 300, alignItems: 'center' }}>
                  <Text style={[s.introEyebrow, { color: '#00C8E8' }]}>{(sv ? 'Din värld' : 'Your world').toUpperCase()}</Text>
                  <Text style={[s.introHeadline, { fontSize: 36, lineHeight: 36 * 1.02 }]}>{sv ? 'Alla flygplatser.' : 'Every airport.'}</Text>
                  <Text style={[s.introHeadline, { fontSize: 36, lineHeight: 36 * 1.02, color: '#00C8E8' }]}>{sv ? 'En karta.' : 'One map.'}</Text>
                  <Text style={s.introBody}>{sv ? 'Quicklog, fotologgning, väder och mycket mer — allt i en app.' : 'Quicklog, photo logging, weather and much more, all in one app.'}</Text>
                </View>
              </View>
              <View style={{ gap: 10, alignSelf: 'stretch' }}>
                <PrimaryButton label={sv ? 'Sätt upp min loggbok' : 'Set up my logbook'} accent="#00C8E8" onPress={() => setStep('role')} />
              </View>
            </View>
          )}

          {/* ── Role ── */}
          {step === 'role' && (() => {
            // Tryck på FARKOSTEN för att välja. Två stora bilder, inga knappar: helikoptern överst
            // lite till vänster (text till höger), drönaren under lite till höger (text till vänster).
            const pilot = availableMainRoles.find((r) => r.key === 'pilot-manned');
            const drone = availableMainRoles.find((r) => r.key === 'pilot-unmanned');
            const IMG = Math.round(Dimensions.get('window').width * 0.46);
            const choosePilot = () => { setMainRole('pilot-manned'); setStep('subrole'); };
            const chooseDrone = () => { setMainRole('pilot-unmanned'); setPendingSub('commercial'); setStep('profile'); };
            return (
              <View style={{ flex: 1, alignSelf: 'stretch' }}>
                <StepHeader eyebrow={sv ? 'Din profil' : 'Your profile'} accent={accent}
                  title={sv ? 'Vad gör du?' : 'What do you do?'}
                  subtitle={sv ? 'Välj loggboken du behöver — senare kan du välja att ha båda.' : 'Choose the logbook of your needs, later you can choose to have both'} />
                <View style={{ flex: 1, justifyContent: 'center', gap: 24 }}>
                  {pilot && (
                    <TouchableOpacity onPress={choosePilot} activeOpacity={0.75}
                      style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 12, maxWidth: '94%' }}>
                      <Image source={ROLE_IMG['pilot-manned']} style={[{ width: IMG, height: IMG }, s.roleGlow, { shadowColor: '#00C8E8' }]} resizeMode="contain" />
                      <View style={{ flexShrink: 1 }}>
                        <Text style={s.roleChoiceTitle}>{sv ? pilot.title_sv : pilot.title_en}</Text>
                        <Text style={s.roleChoiceDesc}>{sv ? pilot.desc_sv : pilot.desc_en}</Text>
                      </View>
                    </TouchableOpacity>
                  )}
                  {drone && (
                    <TouchableOpacity onPress={chooseDrone} activeOpacity={0.75}
                      style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-end', gap: 12, maxWidth: '94%' }}>
                      <View style={{ flexShrink: 1 }}>
                        <Text style={[s.roleChoiceTitle, { textAlign: 'right' }]}>{sv ? drone.title_sv : drone.title_en}</Text>
                        <Text style={[s.roleChoiceDesc, { textAlign: 'right' }]}>{sv ? drone.desc_sv : drone.desc_en}</Text>
                      </View>
                      <Image source={ROLE_IMG['pilot-unmanned']} style={[{ width: IMG, height: IMG }, s.roleGlow, { shadowColor: '#FFB830' }]} resizeMode="contain" />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            );
          })()}

          {/* ── Sub-role ── */}
          {step === 'subrole' && mainRole && (() => {
            // Samma lösning som roll-valet: stora farkostbilder (helikopter/flygplan), ingen knapp-chrome,
            // diagonal placering, tryck på farkosten för att välja, glödande halo bakom.
            const subs = SUB_ROLES[mainRole];
            const IMG = Math.round(Dimensions.get('window').width * 0.46);
            const pick = (key: SubRole) => { setPendingSub(key); setStep('profile'); }; // regelverk/tidsformat väljs på profilsidan
            return (
              <View style={{ flex: 1, alignSelf: 'stretch' }}>
                <StepHeader eyebrow={sv ? 'Specialisering' : 'Specialise'} accent={accent}
                  title={sv ? STEP_TITLES[mainRole].sv : STEP_TITLES[mainRole].en}
                  subtitle={sv ? STEP_SUBS[mainRole].sv : STEP_SUBS[mainRole].en} />
                <View style={{ flex: 1, justifyContent: 'center', gap: 24 }}>
                  {subs.map((r, i) => {
                    const img = SUBROLE_IMG[r.key];
                    if (!img) {
                      return <OptionCard key={r.key} mci={r.icon} accent={accent}
                        title={sv ? r.title_sv : r.title_en} desc={sv ? r.desc_sv : r.desc_en} onPress={() => pick(r.key)} />;
                    }
                    const left = i % 2 === 0; // första farkosten till vänster (topp), andra till höger (under)
                    return (
                      <TouchableOpacity key={r.key} onPress={() => pick(r.key)} activeOpacity={0.75}
                        style={{ flexDirection: 'row', alignItems: 'center', alignSelf: left ? 'flex-start' : 'flex-end', gap: 12, maxWidth: '94%' }}>
                        {left ? (
                          <>
                            <Image source={img} style={[{ width: IMG, height: IMG }, s.roleGlow, { shadowColor: '#00C8E8' }]} resizeMode="contain" />
                            <View style={{ flexShrink: 1 }}>
                              <Text style={s.roleChoiceTitle}>{sv ? r.title_sv : r.title_en}</Text>
                              <Text style={s.roleChoiceDesc}>{sv ? r.desc_sv : r.desc_en}</Text>
                            </View>
                          </>
                        ) : (
                          <>
                            <View style={{ flexShrink: 1 }}>
                              <Text style={[s.roleChoiceTitle, { textAlign: 'right' }]}>{sv ? r.title_sv : r.title_en}</Text>
                              <Text style={[s.roleChoiceDesc, { textAlign: 'right' }]}>{sv ? r.desc_sv : r.desc_en}</Text>
                            </View>
                            <Image source={img} style={[{ width: IMG, height: IMG }, s.roleGlow, { shadowColor: '#00C8E8' }]} resizeMode="contain" />
                          </>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            );
          })()}

          {/* Regelverk + tidsformat är inte längre egna steg → väljs via dropdowns på profilsidan
              (manned only, under Pilot signature). Operatörs-ID ligger också i profilsteget. */}

          {/* ── Profile ── */}
          {step === 'profile' && (
            <>
              <StepHeader eyebrow={sv ? 'Profil' : 'Profile'} accent={accent}
                title={sv ? 'Sätt upp din profil' : 'Set up your profile'}
                subtitle={sv ? 'Namn för din loggbok och export.' : 'Name for your logbook and exports.'} />

              <AvatarPreview initials={autoInitials || '?'} name={fullName || (sv ? 'Ditt namn' : 'Your name')} creds="" accent={accent} />

              <ScrollView style={{ alignSelf: 'stretch', flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: 12 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
                <Field label={sv ? 'Förnamn' : 'First name'} value={firstName} onChangeText={setFirstName} placeholder={sv ? 'T.ex. Jesper' : 'e.g. John'} />
                <Field label={sv ? 'Efternamn' : 'Last name'} value={lastName} onChangeText={setLastName} placeholder={sv ? 'T.ex. Toreld' : 'e.g. Doe'} />
                <Field label={sv ? 'Initialer' : 'Initials'} value={initials} onChangeText={setInitials} placeholder={sv ? 'T.ex. JT' : 'e.g. JD'} maxLength={3} autoCapitalize="characters" />
                {/* Legitimation/credentials-fält borttaget inför lansering. */}
                {/* Operatörs-ID (drönare) — flyttat hit från eget steg, ovanför Pilot signature. */}
                {mainRole === 'pilot-unmanned' && (
                  <Field label={sv ? 'Operatörs-ID (valfritt)' : 'Operator ID (optional)'} value={droneId} onChangeText={setDroneId} placeholder="e.g. SWE87astrdg12k8" autoCapitalize="characters" />
                )}
                <View>
                  <Text style={s.inputLabel}>{sv ? 'Pilotsignatur (valfritt)' : 'Pilot signature (optional)'}</Text>
                  <TouchableOpacity
                    style={[s.input, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 46 }]}
                    onPress={() => setSigModal(true)} activeOpacity={0.7}
                  >
                    {signature
                      ? <SignatureView data={signature} height={28} color={C.textPrimary} />
                      : <Text style={{ color: C.textMuted, fontSize: 14 }}>{sv ? 'Skapa signatur' : 'Add signature'}</Text>}
                    <Ionicons name="create-outline" size={18} color={accent} />
                  </TouchableOpacity>
                </View>
                {/* Regelverk + tidsformat (endast pilot) — dropdowns i stället för egna steg. */}
                {manned(mainRole) && (
                  <>
                    <ProfileDropdown label={sv ? 'Regelverk' : 'Framework'} value={standard} accent={accent}
                      options={FRAMEWORKS.map((f) => ({ key: f.key, label: `${f.title} · ${f.region}` }))}
                      onSelect={setStandardSel} />
                    <ProfileDropdown label={sv ? 'Tidsformat' : 'Time format'} value={format} accent={accent}
                      options={[
                        { key: 'decimal' as TimeFormat, label: 'Decimal (1.5)' },
                        { key: 'hhmm' as TimeFormat, label: sv ? 'Timmar:Minuter (1:30)' : 'Hours:Minutes (1:30)' },
                      ]}
                      onSelect={setFormat} />
                  </>
                )}
              </ScrollView>

              <View style={{ alignSelf: 'stretch', gap: 10 }}>
                <PrimaryButton label={sv ? 'Fortsätt' : 'Continue'} accent={accent} onPress={() => setStep('hours')} />
                <SecondaryButton label={sv ? 'Hoppa över' : 'Skip'} onPress={() => setStep('hours')} />
              </View>
            </>
          )}

          {/* ── Existing hours ── */}
          {step === 'hours' && (
            <>
              <StepHeader eyebrow={sv ? 'Nästan klar' : 'Almost done'} accent={accent}
                title={sv ? 'Har du redan flygtimmar?' : 'Do you already have flight hours?'}
                subtitle={sv ? 'Få in dina tidigare timmar så att statistiken stämmer från dag ett.' : 'Bring in your previous hours so your stats are right from day one.'} />
              <View style={{ gap: 12, alignSelf: 'stretch' }}>
                {/* "Scan paper logbook" borttaget (väntande projekt). */}
                <OptionCard mci="pencil-outline" accent={accent}
                  title={sv ? 'Ange starttotal' : 'Enter starting total'}
                  desc={sv ? 'Skriv in dina totala timmar manuellt' : 'Type in your total hours manually'}
                  onPress={() => finalize(mainRole === 'pilot-unmanned' ? '/drone-import/manual' : '/import/manual', true)} />
                <OptionCard mci="file-delimited-outline" accent={accent}
                  title={sv ? 'Importera CSV' : 'Import CSV'}
                  desc={mainRole === 'pilot-unmanned' ? (sv ? 'Från din drönarlogg (CSV)' : 'From your drone log (CSV)') : (sv ? 'Från ForeFlight, LogTen Pro, m.fl.' : 'From ForeFlight, LogTen Pro, etc.')}
                  onPress={() => finalize(mainRole === 'pilot-unmanned' ? '/drone-import' : '/import', true)} />
              </View>
              <View style={{ flex: 1 }} />
              <SecondaryButton label={sv ? 'Gör det senare' : "I'll do it later"} onPress={() => finalize()} />
            </>
          )}
        </Animated.View>
      </KeyboardAvoidingView>

      <SignatureModal visible={sigModal} initial={signature} onClose={() => setSigModal(false)} onSave={(sg) => setSignature(sg)} />
    </SafeAreaView>
  );
}

// ── Reusable bits ────────────────────────────────────────────────────────────

function StepHeader({ eyebrow, title, subtitle, accent }: { eyebrow: string; title: string; subtitle?: string; accent: string }) {
  return (
    <View style={{ alignSelf: 'stretch', marginBottom: 18 }}>
      <Text style={[s.eyebrow, { color: accent }]}>{eyebrow}</Text>
      <Text style={s.title}>{title}</Text>
      {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

function OptionCard({ mci, leading, title, desc, accent, onPress, right, selected }: {
  mci?: MCI; leading?: React.ReactNode;
  title: string; desc?: string; accent: string; onPress: () => void; right?: React.ReactNode; selected?: boolean;
}) {
  const lead = leading ?? (
    <View style={[s.leadBox, { backgroundColor: selected ? accent + '1A' : 'rgba(255,255,255,0.05)' }]}>
      <MaterialCommunityIcons name={mci!} size={24} color={selected ? accent : C.silver} />
    </View>
  );
  return (
    <TouchableOpacity style={[s.card, selected && { borderColor: accent }]} onPress={onPress} activeOpacity={0.7}>
      {lead}
      <View style={{ flex: 1 }}>
        <Text style={s.cardTitle}>{title}</Text>
        {desc ? <Text style={s.cardDesc}>{desc}</Text> : null}
      </View>
      {right ?? <Ionicons name="chevron-forward" size={18} color={C.textMuted} />}
    </TouchableOpacity>
  );
}

// Genomskinligt val: stor bild till vänster, beskrivande text till höger.
// Hela raden (inkl. bilden) är tryckbar för att välja. Raden flexar så att
// alla val får plats på samma skärm.
function ImageRow({ image, title, desc, onPress }: { image: ImageSourcePropType; title: string; desc: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={s.imgRow} onPress={onPress} activeOpacity={0.7}>
      <Image source={image} style={s.imgRowImg} resizeMode="contain" />
      <View style={s.imgRowText}>
        <Text style={s.imgRowTitle}>{title}</Text>
        <Text style={s.imgRowDesc}>{desc}</Text>
      </View>
    </TouchableOpacity>
  );
}

function PrimaryButton({ label, accent, onPress, icon = 'arrow-forward' }: { label: string; accent: string; onPress: () => void; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <TouchableOpacity style={[s.primaryBtn, { backgroundColor: accent }]} onPress={onPress} activeOpacity={0.88}>
      <Text style={s.primaryBtnText}>{label}</Text>
      <Ionicons name={icon} size={18} color={C.textInverse} />
    </TouchableOpacity>
  );
}

function SecondaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={s.secondaryBtn} onPress={onPress} activeOpacity={0.75}>
      <Text style={s.secondaryBtnText}>{label}</Text>
    </TouchableOpacity>
  );
}

// Radar-ringar: statiska koncentriska cirklar + ett roterande svep (top-kanten i accentfärgen).
// Intro-skärmarnas nyckelrörelse. Reanimated driver en linjär, oändlig 0→360°-rotation.
function RadarRings({ accent, duration, rings, sweep }: {
  accent: string; duration: number; rings: { d: number; o: number }[]; sweep: number;
}) {
  const rot = useSharedValue(0);
  useEffect(() => {
    rot.value = withRepeat(withTiming(360, { duration: duration * 1000, easing: Easing.linear }), -1);
    return () => cancelAnimation(rot);
  }, [duration, rot]);
  const sweepStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rot.value}deg` }] }));
  const withAlpha = (o: number) => accent + Math.round(Math.max(0, Math.min(1, o)) * 255).toString(16).padStart(2, '0');
  const circle = (d: number) => ({ position: 'absolute' as const, left: '50%' as const, top: '50%' as const, width: d, height: d, marginLeft: -d / 2, marginTop: -d / 2, borderRadius: d / 2 });
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {rings.map((r) => (
        <View key={r.d} style={[circle(r.d), { borderWidth: 1, borderColor: withAlpha(r.o) }]} />
      ))}
      <Animated.View style={[circle(sweep), { borderWidth: 1.5, borderColor: 'transparent', borderTopColor: accent }, sweepStyle]} />
    </View>
  );
}

// Delad layout för intro-skärmarna 2–4: radar-ringar bakom ett centrerat textblock, knappar i botten.
function IntroStage({ accent, duration, eyebrow, line1, line2, body, extras, onContinue, onSkip, sv }: {
  accent: string; duration: number; eyebrow: string; line1: string; line2: string; body: string;
  extras?: React.ReactNode; onContinue: () => void; onSkip: () => void; sv: boolean;
}) {
  return (
    <View style={{ flex: 1, alignSelf: 'stretch' }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <RadarRings accent={accent} duration={duration}
          rings={[{ d: 420, o: 0.06 }, { d: 340, o: 0.10 }, { d: 250, o: 0.16 }]} sweep={340} />
        <View style={{ maxWidth: 300, alignItems: 'center', zIndex: 2 }}>
          <Text style={[s.introEyebrow, { color: accent }]}>{eyebrow.toUpperCase()}</Text>
          <Text style={[s.introHeadline, { fontSize: 40, lineHeight: 40 * 1.02 }]}>{line1}</Text>
          <Text style={[s.introHeadline, { fontSize: 40, lineHeight: 40 * 1.02, color: accent }]}>{line2}</Text>
          <Text style={s.introBody}>{body}</Text>
          {extras}
        </View>
      </View>
      {/* "Skip intro" = subtil textlänk (inte knapp); Continue hamnar då något längre ner. */}
      <View style={{ alignSelf: 'stretch', alignItems: 'center', gap: 14 }}>
        <PrimaryButton label={sv ? 'Fortsätt' : 'Continue'} accent="#00C8E8" onPress={onContinue} />
        <TouchableOpacity onPress={onSkip} hitSlop={10} style={{ height: 30, justifyContent: 'center' }} activeOpacity={0.6}>
          <Text style={s.introSkipText}>{sv ? 'Hoppa över introt' : 'Skip intro'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function AvatarPreview({ initials, name, creds, accent }: { initials: string; name: string; creds: string; accent: string }) {
  return (
    <View style={s.avatarWrap}>
      <View style={[s.avatar, { backgroundColor: accent }]}>
        <Text style={s.avatarText}>{initials}</Text>
      </View>
      <Text style={s.avatarName}>{name}</Text>
      {creds ? <Text style={s.avatarCreds}>{creds}</Text> : null}
    </View>
  );
}

function Field(props: { label: string; value: string; onChangeText: (v: string) => void; placeholder: string; maxLength?: number; autoCapitalize?: 'none' | 'characters' | 'words' }) {
  return (
    <View>
      <Text style={s.inputLabel}>{props.label}</Text>
      <TextInput
        style={s.input}
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={C.textMuted}
        maxLength={props.maxLength}
        autoCapitalize={props.autoCapitalize}
      />
    </View>
  );
}

// Enkel dropdown-flik (label + vald post; expanderar en lista under sig). Används på profilsidan
// för regelverk + tidsformat (tidigare egna steg).
function ProfileDropdown<T extends string>({ label, value, options, onSelect, accent }: {
  label: string; value: T; options: { key: T; label: string }[]; onSelect: (k: T) => void; accent: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.key === value);
  return (
    <View>
      <Text style={s.inputLabel}>{label}</Text>
      <TouchableOpacity style={[s.input, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 46 }]}
        onPress={() => setOpen((o) => !o)} activeOpacity={0.7}>
        <Text style={{ color: C.textPrimary, fontSize: 15, fontWeight: '600' }}>{current?.label ?? ''}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={accent} />
      </TouchableOpacity>
      {open && (
        <View style={{ marginTop: 6, backgroundColor: C.elevated, borderRadius: 12, borderWidth: 1, borderColor: C.cardBorder, overflow: 'hidden' }}>
          {options.map((o, i) => (
            <TouchableOpacity key={o.key} onPress={() => { onSelect(o.key); setOpen(false); }} activeOpacity={0.7}
              style={{ paddingVertical: 12, paddingHorizontal: 14, borderTopWidth: i ? 1 : 0, borderTopColor: C.separator, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: value === o.key ? accent : C.textPrimary, fontSize: 15, fontWeight: value === o.key ? '700' : '500' }}>{o.label}</Text>
              {value === o.key ? <Ionicons name="checkmark" size={18} color={accent} /> : null}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000', paddingHorizontal: 22, paddingTop: 10 },
  dotsRow: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginBottom: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.cardBorder },
  dotActive: { width: 24 },

  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6, zIndex: 20 },
  backText: { color: C.textSecondary, fontSize: 14, fontWeight: '600' },

  stepContent: { flex: 1, alignItems: 'flex-start' },

  langHint: { fontSize: 12, color: C.textMuted, textAlign: 'center', letterSpacing: 0.3, marginBottom: 2 },
  langRow: { flexDirection: 'row', gap: 10, alignSelf: 'stretch' },
  langBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 14, backgroundColor: C.card, borderWidth: 1.5, borderColor: C.gold,
  },
  langBtnText: { fontSize: 14, fontWeight: '700', color: C.textPrimary },

  pickList: { flexGrow: 1, justifyContent: 'center', gap: 12, paddingVertical: 8 },

  eyebrow: { fontFamily: 'Menlo', fontSize: 10, fontWeight: '700', letterSpacing: 1.6, textTransform: 'uppercase', marginBottom: 6 },
  title: { fontSize: 23, fontWeight: '800', color: C.textPrimary, letterSpacing: -0.4 },
  subtitle: { fontSize: 13.5, color: C.textSecondary, lineHeight: 19, marginTop: 6 },

  // Intro-skärmarnas (2–5) centrerade textblock + taggar (radar-designen).
  introEyebrow: { fontFamily: 'Menlo', fontSize: 10, fontWeight: '700', letterSpacing: 1.6, textAlign: 'center', marginBottom: 10 },
  introHeadline: { fontWeight: '800', letterSpacing: -1.2, color: '#FFFFFF', textAlign: 'center' },
  introBody: { fontSize: 15, color: '#7FA8C8', lineHeight: 21, maxWidth: 270, marginTop: 16, textAlign: 'center' },
  introFreeBadge: { backgroundColor: '#00E8A0', paddingVertical: 4, paddingHorizontal: 7, borderRadius: 5 },
  introFreeBadgeText: { fontFamily: 'Menlo', fontSize: 10, fontWeight: '800', letterSpacing: 1, color: '#0A1628' },
  introFreeLabel: { fontSize: 13.5, fontWeight: '600', color: '#FFFFFF' },
  introPill: { borderWidth: 1, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10 },
  introPillText: { fontFamily: 'Menlo', fontSize: 10.5, fontWeight: '700', letterSpacing: 0.8 },
  introSkipText: { fontSize: 13.5, fontWeight: '600', color: '#7FA8C8' },

  // Roll-val: text bredvid farkostbilden (ingen knapp-chrome).
  roleChoiceTitle: { fontSize: 24, fontWeight: '800', color: C.textPrimary, letterSpacing: -0.5 },
  roleChoiceDesc: { fontSize: 13.5, color: C.textSecondary, lineHeight: 18, marginTop: 4 },
  // Glödande halo bakom de nästan svarta farkostbilderna → syns mot svart bakgrund.
  // iOS-skuggan följer PNG:ns alfa (siluetten); shadowColor sätts per bild.
  roleGlow: { shadowOpacity: 0.95, shadowRadius: 34, shadowOffset: { width: 0, height: 0 } },

  // Navy ruta med guldig kantlinje på svart bakgrund (vald → accent-ring).
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: C.card, borderRadius: 18, padding: 16,
    borderWidth: 1.5, borderColor: C.gold,
    shadowColor: '#000', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 4,
  },
  // Navy ruta med guldkant. Bild ~40% till vänster, text ~60% till höger.
  // Rutans mått behålls; bredare bildkolumn ger ~20% större bild (contain).
  imgRow: {
    flexDirection: 'row', alignItems: 'stretch', gap: 8, height: 136,
    padding: 8,
    backgroundColor: C.card, borderColor: C.gold, borderWidth: 1.5, borderRadius: 16,
  },
  // Kvadratisk bildyta som fyller höjden → lika avstånd (8px) till över-/
  // underkant, vänsterkant och text. Texten tar resten av bredden.
  imgRowImg: { aspectRatio: 1, borderRadius: 10, transform: [{ scale: 1.15 }] },
  imgRowText: { flex: 1, justifyContent: 'center' },
  imgRowTitle: { fontSize: 17, fontWeight: '800', color: C.textPrimary, letterSpacing: -0.2 },
  imgRowDesc: { fontSize: 12.5, color: C.textSecondary, lineHeight: 17, marginTop: 4 },

  cardTitle: { fontSize: 16, fontWeight: '800', color: C.textPrimary, letterSpacing: -0.2 },
  cardDesc: { fontSize: 12.5, color: C.textSecondary, lineHeight: 17, marginTop: 2 },

  leadBox: { width: 50, height: 50, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  regionText: { fontFamily: 'Menlo', fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  fmtText: { fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },

  swatch: { width: 50, height: 50, borderRadius: 15, borderWidth: 1, padding: 8, justifyContent: 'space-between' },
  swatchDot: { width: 11, height: 11, borderRadius: 6 },
  swatchBar: { height: 6, borderRadius: 3, alignSelf: 'stretch' },

  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, alignSelf: 'stretch', borderRadius: 14, paddingVertical: 16 },
  primaryBtnText: { color: C.textInverse, fontSize: 16, fontWeight: '800' },

  secondaryBtn: {
    alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center',
    borderRadius: 14, paddingVertical: 15, backgroundColor: C.elevated,
    borderWidth: 1, borderColor: C.cardBorder,
  },
  secondaryBtnText: { color: C.textSecondary, fontSize: 15, fontWeight: '700' },

  avatarWrap: { alignItems: 'center', alignSelf: 'stretch', marginBottom: 16 },
  avatar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  avatarText: { fontSize: 24, fontWeight: '800', color: C.textInverse, letterSpacing: -0.5 },
  avatarName: { fontSize: 17, fontWeight: '700', color: C.textPrimary, letterSpacing: -0.2 },
  avatarCreds: { fontSize: 12, color: C.textMuted, marginTop: 3 },

  inputLabel: { fontSize: 12, fontWeight: '700', color: C.textPrimary, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: C.cardBorder, backgroundColor: C.elevated, fontSize: 15, color: C.textPrimary },

});
