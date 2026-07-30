import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, Image, TextInput, KeyboardAvoidingView, Platform, type ImageSourcePropType } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useLanguageStore } from '../store/languageStore';
import { useTimeFormatStore, type TimeFormat } from '../store/timeFormatStore';
import { useAppModeStore } from '../store/appModeStore';
import { useProfileStore, type MainRole, type SubRole, type Profile, targetForProfile } from '../store/profileStore';
import { useRegulationStandardStore, type RegulationStandard } from '../store/regulationStandardStore';
import { useOperatorStore } from '../store/operatorStore';
import { useThemeStore, type Theme } from '../store/themeStore';
import { setSetting, getSetting } from '../db/flights';
import { SignatureView, SignatureModal, type SignatureData } from '../components/SignaturePad';
import { NavyColors, BrightColors, DroneIndustrialColors, DroneNeonColors, type ColorPalette } from '../constants/colors';

type Step =
  | 'welcome' | 'role' | 'subrole'
  | 'framework' | 'timeformat' | 'droneid'
  | 'theme' | 'profile' | 'hours';

type MCI = keyof typeof MaterialCommunityIcons.glyphMap;

// Onboarding ritas alltid på navy-canvasen (appens signaturtema). Accenten
// hintar vald roll: cyan för pilot/operatör, amber för drönare. Ikonerna hålls
// neutralt silver och tonas i accenten först när något är valt.
const C = NavyColors;
const AMBER = DroneIndustrialColors.primary; // '#FF8C42'
const accentForRole = (role: MainRole | null): string =>
  role === 'pilot-unmanned' ? AMBER : C.primary;

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
  'pilot-unmanned': require('../assets/Drone-hobby.PNG'),
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
  const mid: Step[] = manned(role) ? ['framework', 'timeformat'] : ['droneid'];
  return [...(returning ? [] : (['welcome'] as Step[])), 'role', 'subrole', ...mid, 'theme', 'profile', 'hours'];
}

export default function OnboardingScreen() {
  const router = useRouter();
  const { setLanguage } = useLanguageStore();
  const { setTimeFormat } = useTimeFormatStore();
  const { setMode } = useAppModeStore();
  const { setProfile } = useProfileStore();
  const { setStandard } = useRegulationStandardStore();
  const { setOperatorId } = useOperatorStore();
  const { setTheme } = useThemeStore();

  const currentProfile = useProfileStore(s => s.profile);
  const returning = !!currentProfile;

  const [step, setStep] = useState<Step>(returning ? 'role' : 'welcome');
  const [lang, setLang] = useState<'en' | 'sv'>(() => useLanguageStore.getState().language);
  const [format, setFormat] = useState<TimeFormat>(() => useTimeFormatStore.getState().timeFormat);
  const [standard, setStandardSel] = useState<RegulationStandard>(() => useRegulationStandardStore.getState().standard);
  const [themeSel, setThemeSel] = useState<Theme | null>(null);
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

  const themeOptions: { key: Theme; label_en: string; label_sv: string; palette: ColorPalette }[] =
    mainRole === 'pilot-unmanned'
      ? [
          { key: 'drone-industrial', label_en: 'Dark · Industrial', label_sv: 'Mörkt · Industrial', palette: DroneIndustrialColors },
          { key: 'drone-neon', label_en: 'Neon', label_sv: 'Neon', palette: DroneNeonColors },
        ]
      : [
          { key: 'navy', label_en: 'Dark', label_sv: 'Mörkt', palette: NavyColors },
          { key: 'bright', label_en: 'Light', label_sv: 'Ljust', palette: BrightColors },
        ];

  const finalize = async (dest?: '/import/scan' | '/import/manual' | '/import' | '/(tabs)', push = false) => {
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
      if (themeSel) await setTheme(themeSel); // före setMode → applyForMode plockar upp valet
      await setMode(targetForProfile(profile));
      await setSetting('has_onboarded', '1');
      await new Promise(r => setTimeout(r, 100));
      // push: lämnar onboarding kvar i stacken så import-modalen kan svepas
      // tillbaka hit. replace: lämnar onboarding (gör det senare → dashboard).
      if (push && dest) router.push(dest); else router.replace(dest ?? '/(tabs)');
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
                <PrimaryButton label="Get started" accent={accent} onPress={() => setStep('role')} />
              </View>
            </View>
          )}

          {/* ── Role ── */}
          {step === 'role' && (
            <>
              <StepHeader eyebrow={sv ? 'Din profil' : 'Your profile'} accent={accent}
                title={sv ? 'Vad gör du?' : 'What do you do?'}
                subtitle={sv ? 'Vi skräddarsyr loggbok, export och certifikat efter din roll.' : 'We tailor the logbook, exports and certificates to your role.'} />
              <ScrollView style={{ flex: 1, alignSelf: 'stretch' }} contentContainerStyle={s.pickList} showsVerticalScrollIndicator={false}>
                {availableMainRoles.map(r => (
                  <ImageRow key={r.key} image={ROLE_IMG[r.key]}
                    title={sv ? r.title_sv : r.title_en} desc={sv ? r.desc_sv : r.desc_en}
                    onPress={() => { setMainRole(r.key); setStep('subrole'); }} />
                ))}
              </ScrollView>
            </>
          )}

          {/* ── Sub-role ── */}
          {step === 'subrole' && mainRole && (
            <>
              <StepHeader eyebrow={sv ? 'Specialisering' : 'Specialise'} accent={accent}
                title={sv ? STEP_TITLES[mainRole].sv : STEP_TITLES[mainRole].en}
                subtitle={sv ? STEP_SUBS[mainRole].sv : STEP_SUBS[mainRole].en} />
              <ScrollView style={{ flex: 1, alignSelf: 'stretch' }} contentContainerStyle={s.pickList} showsVerticalScrollIndicator={false}>
                {SUB_ROLES[mainRole].map(r => {
                  const onPick = () => { setPendingSub(r.key); setStep(manned(mainRole) ? 'framework' : 'droneid'); };
                  const img = SUBROLE_IMG[r.key];
                  return img
                    ? <ImageRow key={r.key} image={img}
                        title={sv ? r.title_sv : r.title_en} desc={sv ? r.desc_sv : r.desc_en} onPress={onPick} />
                    : <OptionCard key={r.key} mci={r.icon} accent={accent}
                        title={sv ? r.title_sv : r.title_en} desc={sv ? r.desc_sv : r.desc_en} onPress={onPick} />;
                })}
              </ScrollView>
            </>
          )}

          {/* ── Framework (manned) ── */}
          {step === 'framework' && (
            <>
              <StepHeader eyebrow={sv ? 'Regelverk' : 'Framework'} accent={accent}
                title={sv ? 'Vilket regelverk följer du?' : 'Which framework do you follow?'}
                subtitle={sv ? 'Påverkar progresskartor, certifikat och export.' : 'Affects progress charts, certificates and exports.'} />
              <View style={{ gap: 12, alignSelf: 'stretch' }}>
                {FRAMEWORKS.map(f => {
                  const selected = standard === f.key;
                  return (
                    <OptionCard key={f.key} accent={accent} selected={selected}
                      title={f.title} desc={sv ? f.desc_sv : f.desc_en}
                      leading={<View style={[s.leadBox, { backgroundColor: selected ? accent + '1A' : 'rgba(255,255,255,0.05)' }]}>
                        <Text style={[s.regionText, { color: selected ? accent : C.silver }]}>{f.region}</Text>
                      </View>}
                      right={selected ? <Ionicons name="checkmark-circle" size={22} color={accent} /> : undefined}
                      onPress={() => { setStandardSel(f.key); setStep('timeformat'); }} />
                  );
                })}
              </View>
            </>
          )}

          {/* ── Time format (manned) ── */}
          {step === 'timeformat' && (
            <>
              <StepHeader eyebrow={sv ? 'Tidsformat' : 'Time format'} accent={accent}
                title={sv ? 'Hur vill du se flygtider?' : 'How do you log flight times?'}
                subtitle={sv ? 'Viktigt om du ska skanna eller importera din loggbok.' : 'Important if you scan or import your logbook.'} />
              <View style={{ gap: 12, alignSelf: 'stretch' }}>
                {([
                  { key: 'decimal' as TimeFormat, ex: '1.5', label: 'Decimal', sub: sv ? 'T.ex. 1.5 h' : 'e.g. 1.5h' },
                  { key: 'hhmm' as TimeFormat, ex: '1:30', label: sv ? 'Timmar:Minuter' : 'Hours:Minutes', sub: sv ? 'T.ex. 1:30' : 'e.g. 1:30' },
                ]).map(opt => {
                  const selected = format === opt.key;
                  return (
                    <OptionCard key={opt.key} accent={accent} selected={selected} title={opt.label} desc={opt.sub}
                      leading={<View style={[s.leadBox, { backgroundColor: selected ? accent + '1A' : 'rgba(255,255,255,0.05)' }]}>
                        <Text style={[s.fmtText, { color: selected ? accent : C.silver }]}>{opt.ex}</Text>
                      </View>}
                      right={selected ? <Ionicons name="checkmark-circle" size={22} color={accent} /> : undefined}
                      onPress={() => { setFormat(opt.key); setStep('theme'); }} />
                  );
                })}
              </View>
            </>
          )}

          {/* ── Drone operator ID (drone) ── */}
          {step === 'droneid' && (
            <>
              <StepHeader eyebrow={sv ? 'Drönare' : 'Drone'} accent={accent}
                title={sv ? 'Operatörs-ID' : 'Operator ID'}
                subtitle={sv ? 'Ditt EU-registrerings-ID som drönaroperatör. Valfritt — kan läggas till senare.' : 'Your EU drone operator registration ID. Optional — you can add it later.'} />
              <View style={{ alignSelf: 'stretch' }}>
                <Text style={s.inputLabel}>{sv ? 'Operatörs-ID' : 'Operator ID'}</Text>
                <TextInput
                  style={s.input}
                  placeholder="e.g. SWE87astrdg12k8"
                  value={droneId}
                  onChangeText={setDroneId}
                  placeholderTextColor={C.textMuted}
                  autoCapitalize="characters"
                  autoCorrect={false}
                />
              </View>
              <View style={{ flex: 1 }} />
              <PrimaryButton label={sv ? 'Nästa' : 'Next'} accent={accent} onPress={() => setStep('theme')} />
            </>
          )}

          {/* ── Theme ── */}
          {step === 'theme' && (
            <>
              <StepHeader eyebrow={sv ? 'Utseende' : 'Appearance'} accent={accent}
                title={sv ? 'Välj ditt tema' : 'Pick your theme'}
                subtitle={sv ? 'Kan ändras när som helst i Inställningar.' : 'You can change this anytime in Settings.'} />
              <View style={{ gap: 12, alignSelf: 'stretch' }}>
                {themeOptions.map(o => {
                  const selected = themeSel === o.key;
                  return (
                    <OptionCard key={o.key} accent={accent} selected={selected} title={sv ? o.label_sv : o.label_en}
                      leading={<ThemeSwatch palette={o.palette} />}
                      right={selected ? <Ionicons name="checkmark-circle" size={22} color={accent} /> : undefined}
                      onPress={() => { setThemeSel(o.key); setStep('profile'); }} />
                  );
                })}
              </View>
            </>
          )}

          {/* ── Profile ── */}
          {step === 'profile' && (
            <>
              <StepHeader eyebrow={sv ? 'Profil' : 'Profile'} accent={accent}
                title={sv ? 'Sätt upp din profil' : 'Set up your profile'}
                subtitle={sv ? 'Namn och behörigheter för din loggbok och export.' : 'Name and credentials for your logbook and exports.'} />

              <AvatarPreview initials={autoInitials || '?'} name={fullName || (sv ? 'Ditt namn' : 'Your name')} creds={credentials} accent={accent} />

              <ScrollView style={{ alignSelf: 'stretch', flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: 12 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
                <Field label={sv ? 'Förnamn' : 'First name'} value={firstName} onChangeText={setFirstName} placeholder={sv ? 'T.ex. Jesper' : 'e.g. John'} />
                <Field label={sv ? 'Efternamn' : 'Last name'} value={lastName} onChangeText={setLastName} placeholder={sv ? 'T.ex. Toreld' : 'e.g. Doe'} />
                <Field label={sv ? 'Initialer' : 'Initials'} value={initials} onChangeText={setInitials} placeholder={sv ? 'T.ex. JT' : 'e.g. JD'} maxLength={3} autoCapitalize="characters" />
                <Field label={sv ? 'Legitimation (valfritt)' : 'Credentials (optional)'} value={credentials} onChangeText={setCredentials} placeholder="CPL(H) · IR · NVG" />
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
                <OptionCard mci="camera" accent={accent}
                  title={sv ? 'Skanna pappersbok' : 'Scan paper logbook'}
                  desc={sv ? 'Fota uppslagen — vi läser in dem' : 'Photograph the pages — we read them'}
                  onPress={() => finalize('/import/scan', true)} />
                <OptionCard mci="pencil-outline" accent={accent}
                  title={sv ? 'Ange starttotal' : 'Enter starting total'}
                  desc={sv ? 'Skriv in dina totala timmar manuellt' : 'Type in your total hours manually'}
                  onPress={() => finalize('/import/manual', true)} />
                <OptionCard mci="file-delimited-outline" accent={accent}
                  title={sv ? 'Importera CSV' : 'Import CSV'}
                  desc={sv ? 'Från ForeFlight, LogTen Pro, m.fl.' : 'From ForeFlight, LogTen Pro, etc.'}
                  onPress={() => finalize('/import', true)} />
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

function ThemeSwatch({ palette }: { palette: ColorPalette }) {
  return (
    <View style={[s.swatch, { backgroundColor: palette.background, borderColor: C.cardBorder }]}>
      <View style={{ flexDirection: 'row', gap: 4 }}>
        <View style={[s.swatchDot, { backgroundColor: palette.primary }]} />
        <View style={[s.swatchDot, { backgroundColor: palette.accent }]} />
      </View>
      <View style={[s.swatchBar, { backgroundColor: palette.cardBorder }]} />
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

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000000', paddingHorizontal: 22, paddingTop: 10 },
  dotsRow: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginBottom: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.cardBorder },
  dotActive: { width: 24 },

  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
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
