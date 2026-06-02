import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, ScrollView, Image, TextInput, Alert } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useLanguageStore } from '../store/languageStore';
import { useTimeFormatStore, type TimeFormat } from '../store/timeFormatStore';
import { useAppModeStore } from '../store/appModeStore';
import { useProfileStore, type MainRole, type SubRole, type Profile, targetForProfile } from '../store/profileStore';
import { setSetting, getSetting, getFlightCount } from '../db/flights';
import { SignatureView, SignatureModal, type SignatureData } from '../components/SignaturePad';

type Step = 'welcome' | 'role' | 'subrole' | 'timeformat' | 'profile';

// Light palette (always light for onboarding)
const P = {
  bg: '#FFFFFF',
  card: '#FFFFFF',
  cardBorder: '#D6DCE5',
  text: '#1F2A44',
  textSecondary: '#5A6B85',
  textMuted: '#8A96A8',
  accent: '#2FA8A5',
  accentBg: '#2FA8A514',
  accentBorder: '#2FA8A555',
};

const MAIN_ROLES: { key: MainRole; emoji: string; title_en: string; title_sv: string; desc_en: string; desc_sv: string }[] = [
  { key: 'pilot-manned', emoji: '✈️', title_en: 'Pilot', title_sv: 'Pilot', desc_en: 'Manned aircraft — helicopter or airplane.', desc_sv: 'Bemannat luftfartyg — helikopter eller flygplan.' },
  { key: 'operator', emoji: '🎖️', title_en: 'Operator', title_sv: 'Operatör', desc_en: 'Manned aircraft crew — chief, hoist, swimmer, HEMS.', desc_sv: 'Besättning bemannat — uppdragsspecialist, vinsch, ytbärgare, HEMS.' },
  { key: 'pilot-unmanned', emoji: '🎮', title_en: 'Drone Pilot', title_sv: 'Drönaroperatör', desc_en: 'Unmanned aircraft — commercial, military, hobby.', desc_sv: 'Obemannat luftfartyg — kommersiell, militär, hobby.' },
];

const SUB_ROLES: Record<MainRole, { key: SubRole; emoji: string; title_en: string; title_sv: string; desc_en: string; desc_sv: string }[]> = {
  'pilot-manned': [
    { key: 'rotary', emoji: '🚁', title_en: 'Helicopter', title_sv: 'Helikopter', desc_en: 'Helicopters and tilt-rotors.', desc_sv: 'Helikoptrar och tiltrotorer.' },
    { key: 'fixed', emoji: '✈️', title_en: 'Airplane', title_sv: 'Flygplan', desc_en: 'Propeller, jet and glider aircraft.', desc_sv: 'Propeller-, jet- och segelflygplan.' },
  ],
  'operator': [
    { key: 'crew-chief', emoji: '🎖️', title_en: 'Crew Chief / Mission Specialist', title_sv: 'Uppdragsspecialist', desc_en: 'Mission lead, equipment, sensor operator.', desc_sv: 'Uppdragsledare, utrustning, sensoroperatör.' },
    { key: 'swimmer', emoji: '🏊', title_en: 'Rescue Swimmer', title_sv: 'Ytbärgare', desc_en: 'Water-rescue swimmer / diver.', desc_sv: 'Ytbärgare / dykare.' },
    { key: 'hoist', emoji: '⚓', title_en: 'Hoist Operator', title_sv: 'Vinschoperatör', desc_en: 'Winch and hoist operations.', desc_sv: 'Vinsch- och hissoperationer.' },
    { key: 'hems', emoji: '🏥', title_en: 'HEMS Operator', title_sv: 'HEMS-operatör', desc_en: 'Helicopter Emergency Medical Service.', desc_sv: 'Helikopterburen akutsjukvård.' },
    { key: 'loadmaster', emoji: '📦', title_en: 'Loadmaster', title_sv: 'Lastmästare', desc_en: 'Cargo, sling load and air drop operations.', desc_sv: 'Last, hänglast och fällningsoperationer.' },
  ],
  'pilot-unmanned': [
    { key: 'commercial', emoji: '🏢', title_en: 'Commercial', title_sv: 'Kommersiell', desc_en: 'Paid operations — survey, media, inspection.', desc_sv: 'Betalda uppdrag — mätning, media, inspektion.' },
    { key: 'military', emoji: '🛡️', title_en: 'Military', title_sv: 'Militär', desc_en: 'Defence and government missions.', desc_sv: 'Försvars- och myndighetsuppdrag.' },
    { key: 'hobby', emoji: '⭐', title_en: 'Hobby', title_sv: 'Hobby', desc_en: 'Recreational flying under A1/A3 rules.', desc_sv: 'Hobbyflygning enligt A1/A3-regler.' },
  ],
};

const STEP_TITLES: Record<MainRole, { en: string; sv: string }> = {
  'pilot-manned': { en: 'What do you fly?', sv: 'Vad flyger du?' },
  'operator': { en: 'Which crew role?', sv: 'Vilken besättningsroll?' },
  'pilot-unmanned': { en: 'How do you fly?', sv: 'Hur flyger du?' },
};

const STEP_SUBS: Record<MainRole, { en: string; sv: string }> = {
  'pilot-manned': { en: 'Pick your primary aircraft category.', sv: 'Välj din primära farkostkategori.' },
  'operator': { en: 'Sets duty-time fields and mission roles in your logbook.', sv: 'Ställer in tjänstetidsfält och uppdragsroller i din loggbok.' },
  'pilot-unmanned': { en: 'We tailor categories, certificates and reports to your context.', sv: 'Vi anpassar kategorier, certifikat och rapporter efter ditt sammanhang.' },
};

function needsTimeFormat(mainRole: MainRole): boolean {
  return mainRole === 'pilot-manned';
}

export default function OnboardingScreen() {
  const router = useRouter();
  const { setLanguage } = useLanguageStore();
  const { setTimeFormat } = useTimeFormatStore();
  const { setMode } = useAppModeStore();
  const { setProfile } = useProfileStore();

  const [step, setStep] = useState<Step>('welcome');
  const [lang, setLang] = useState<'en' | 'sv'>('en');
  const [format, setFormat] = useState<TimeFormat>('hhmm');
  const [mainRole, setMainRole] = useState<MainRole | null>(null);
  const [pendingSub, setPendingSub] = useState<SubRole | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [initials, setInitials] = useState('');
  const [credentials, setCredentials] = useState('');
  const [signature, setSignature] = useState<SignatureData | null>(null);
  const [sigModal, setSigModal] = useState(false);

  const currentProfile = useProfileStore(s => s.profile);

  const sv = lang === 'sv';
  
  // Filter out already selected roles when coming from settings
  const availableMainRoles = currentProfile 
    ? MAIN_ROLES.filter(r => r.key !== currentProfile.mainRole)
    : MAIN_ROLES;

  const finalize = async (sub: SubRole) => {
    try {
      const profile: Profile = { mainRole: mainRole!, subRole: sub };

      // Initial setup - set as primary profile
      await setLanguage(lang);
      if (needsTimeFormat(mainRole!)) {
        await setTimeFormat(format);
      } else {
        await setTimeFormat('hhmm');
      }
      await setProfile(profile);
      // Save profile data
      await setSetting('profile_first_name', firstName);
      await setSetting('profile_last_name', lastName);
      await setSetting('profile_initials', initials);
      await setSetting('profile_credentials', credentials);
      await setSetting('pilot_signature', signature ? JSON.stringify(signature) : '');
      const target = targetForProfile(profile);
      await setMode(target);
      // Set onboarded FIRST before navigating
      await setSetting('has_onboarded', '1');
      // Give a small delay to ensure setting is persisted
      await new Promise(r => setTimeout(r, 100));
      // Navigate to dashboard
      router.replace('/(tabs)');
    } catch (e: any) {
      console.error('Onboarding error:', e);
      // Fallback: navigate to home tabs
      router.replace('/(tabs)');
    }
  };

  const handleSubRoleSelect = (sub: SubRole) => {
    setPendingSub(sub);
    // Always go to profile step next
    setStep('profile');
  };

  const handleProfileComplete = () => {
    if (pendingSub) {
      finalize(pendingSub);
    }
  };

  const steps = needsTimeFormat(mainRole ?? 'operator')
    ? ['welcome', 'role', 'subrole', 'timeformat', 'profile']
    : ['welcome', 'role', 'subrole', 'profile'];
  const stepIdx = steps.indexOf(step);
  const totalSteps = steps.length;

  return (
    <SafeAreaView style={s.container}>
      {/* Progress dots */}
      <View style={s.dotsRow}>
        {Array.from({ length: totalSteps }).map((_, i) => (
          <View key={i} style={[s.dot, i === stepIdx && s.dotActive]} />
        ))}
      </View>

      {/* Back button (step 2+) */}
      {stepIdx > 0 && (
        <TouchableOpacity
          style={s.backRow}
          onPress={() => {
            if (step === 'profile') setStep(needsTimeFormat(mainRole ?? 'operator') ? 'timeformat' : 'subrole');
            else if (step === 'timeformat') setStep('subrole');
            else if (step === 'subrole') setStep('role');
            else if (step === 'role') setStep('welcome');
          }}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={18} color={P.textSecondary} />
          <Text style={s.backText}>{sv ? 'Tillbaka' : 'Back'}</Text>
        </TouchableOpacity>
      )}

      {/* ── Welcome ── */}
      {step === 'welcome' && (
        <View style={s.stepContent}>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
            <Image source={require('../assets/blades-logo.png')} style={{ width: 286, height: 112 }} resizeMode="contain" />
            <Text style={s.welcomeTitle}>{sv ? 'Välkommen till BLADES' : 'Welcome to BLADES'}</Text>
            <Text style={s.welcomeSub}>
              {sv
                ? 'Din gemensamma loggbok för bemannat, obemannat och besättning.'
                : 'Your joint logbook for manned, unmanned and crew.'}
            </Text>
          </View>

          {/* Language selector */}
          <View style={s.langRow}>
            <TouchableOpacity
              style={[s.langBtn, lang === 'en' && s.langBtnActive]}
              onPress={() => setLang('en')}
              activeOpacity={0.75}
            >
              <Text style={{ fontSize: 18 }}>🇬🇧</Text>
              <Text style={[s.langBtnText, lang === 'en' && s.langBtnTextActive]}>English</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[s.langBtn, lang === 'sv' && s.langBtnActive]}
              onPress={() => setLang('sv')}
              activeOpacity={0.75}
            >
              <Text style={{ fontSize: 18 }}>🇸🇪</Text>
              <Text style={[s.langBtnText, lang === 'sv' && s.langBtnTextActive]}>Svenska</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={s.nextBtn} onPress={() => setStep('role')} activeOpacity={0.85}>
            <Text style={s.nextBtnText}>{sv ? 'Kom igång' : 'Get started'}</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      {/* ── Role ── */}
      {step === 'role' && (
        <View style={s.stepContent}>
          <Text style={s.title}>{sv ? 'Välj din profil' : 'Choose your profile'}</Text>
          <Text style={s.subtitle}>
            {sv ? 'Anpassar loggboksfält, export och certifikat efter din roll.' : 'Tailors the logbook fields, exports and certifications to your role.'}
          </Text>
          <View style={s.optionsCol}>
            {availableMainRoles.map(r => (
              <TouchableOpacity
                key={r.key}
                style={s.card}
                onPress={() => { setMainRole(r.key); setStep('subrole'); }}
                activeOpacity={0.8}
              >
                <View style={s.emojiCircle}>
                  <Text style={{ fontSize: 26 }}>{r.emoji}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.cardTitle}>{sv ? r.title_sv : r.title_en}</Text>
                  <Text style={s.cardDesc}>{sv ? r.desc_sv : r.desc_en}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={P.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
          <View style={{ flex: 1 }} />
        </View>
      )}

      {/* ── Sub-role ── */}
      {step === 'subrole' && mainRole && (
        <View style={s.stepContent}>
          <Text style={s.eyebrow}>
            {sv ? `Steg ${stepIdx + 1} av ${totalSteps} · Specialisering` : `Step ${stepIdx + 1} of ${totalSteps} · Specialise`}
          </Text>
          <Text style={s.title}>{sv ? STEP_TITLES[mainRole].sv : STEP_TITLES[mainRole].en}</Text>
          <Text style={s.subtitle}>{sv ? STEP_SUBS[mainRole].sv : STEP_SUBS[mainRole].en}</Text>
          <ScrollView style={{ flex: 1, alignSelf: 'stretch' }} contentContainerStyle={{ gap: mainRole === 'operator' ? 8 : 10, paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
            {SUB_ROLES[mainRole].map(r => (
              <TouchableOpacity
                key={r.key}
                style={[s.card, { paddingVertical: mainRole === 'operator' ? 13 : 16 }]}
                onPress={() => handleSubRoleSelect(r.key)}
                activeOpacity={0.8}
              >
                <View style={[s.emojiCircle, mainRole === 'operator' && { width: 46, height: 46 }]}>
                  <Text style={{ fontSize: mainRole === 'operator' ? 22 : 26 }}>{r.emoji}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.cardTitle}>{sv ? r.title_sv : r.title_en}</Text>
                  <Text style={s.cardDesc}>{sv ? r.desc_sv : r.desc_en}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={P.textMuted} />
              </TouchableOpacity>
            ))}
          </ScrollView>
          <Text style={s.footerNote}>
            {sv ? 'Du kan ändra detta senare i Inställningar.' : 'You can change this later in Settings.'}
          </Text>
        </View>
      )}

      {/* ── Time format (only for pilot-manned) ── */}
      {step === 'timeformat' && (
        <View style={s.stepContent}>
          <Text style={s.title}>{sv ? 'Tidsformat' : 'Time format'}</Text>
          <Text style={s.subtitle}>{sv ? 'Hur loggar du flygtider?' : 'How do you log flight times?'}</Text>
          <View style={s.optionsCol}>
            {[
              { key: 'decimal' as TimeFormat, example: '1.5', label: 'Decimal', sub: sv ? 'T.ex. 1.5h' : 'e.g. 1.5h' },
              { key: 'hhmm' as TimeFormat, example: '1:30', label: 'HH:MM', sub: sv ? 'T.ex. 1:30' : 'e.g. 1:30' },
            ].map(opt => (
              <TouchableOpacity key={opt.key} style={[s.card, format === opt.key && s.cardActive]} onPress={() => setFormat(opt.key)} activeOpacity={0.8}>
                <View style={s.formatBox}>
                  <Text style={s.formatText}>{opt.example}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.cardTitle, format === opt.key && { color: P.accent }]}>{opt.label}</Text>
                  <Text style={s.cardDesc}>{opt.sub}</Text>
                </View>
                {format === opt.key && <Ionicons name="checkmark-circle" size={22} color={P.accent} />}
              </TouchableOpacity>
            ))}
          </View>
          <View style={{ flex: 1 }} />
          <TouchableOpacity style={s.nextBtn} onPress={() => setStep('profile')} activeOpacity={0.85}>
            <Text style={s.nextBtnText}>{sv ? 'Nästa' : 'Next'}</Text>
            <Ionicons name="chevron-forward" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      {/* ── Profile setup ── */}
      {step === 'profile' && (
        <View style={s.stepContent}>
          <Text style={s.eyebrow}>
            {sv ? `Steg ${stepIdx + 1} av ${totalSteps} · Profil` : `Step ${stepIdx + 1} of ${totalSteps} · Profile`}
          </Text>
          <Text style={s.title}>{sv ? 'Sätt upp din profil' : 'Set up your profile'}</Text>
          <Text style={s.subtitle}>{sv ? 'Lägg till ditt namn och inledande för din loggbok' : 'Add your name and credentials for your logbook'}</Text>

          <ScrollView style={{ alignSelf: 'stretch', flex: 1 }} contentContainerStyle={{ gap: 12, paddingBottom: 16 }} showsVerticalScrollIndicator={false}>
            <View>
              <Text style={s.inputLabel}>{sv ? 'Förnamn' : 'First name'}</Text>
              <TextInput
                style={s.input}
                placeholder={sv ? 'T.ex. Jesper' : 'e.g. John'}
                value={firstName}
                onChangeText={setFirstName}
                placeholderTextColor={P.textMuted}
              />
            </View>

            <View>
              <Text style={s.inputLabel}>{sv ? 'Efternamn' : 'Last name'}</Text>
              <TextInput
                style={s.input}
                placeholder={sv ? 'T.ex. Toreld' : 'e.g. Doe'}
                value={lastName}
                onChangeText={setLastName}
                placeholderTextColor={P.textMuted}
              />
            </View>

            <View>
              <Text style={s.inputLabel}>{sv ? 'Initialer' : 'Initials'}</Text>
              <TextInput
                style={s.input}
                placeholder={sv ? 'T.ex. JT' : 'e.g. JD'}
                value={initials}
                onChangeText={setInitials}
                placeholderTextColor={P.textMuted}
                maxLength={3}
              />
            </View>

            <View>
              <Text style={s.inputLabel}>{sv ? 'Legitimation (valfritt)' : 'Credentials (optional)'}</Text>
              <TextInput
                style={s.input}
                placeholder={sv ? 'T.ex. CPL(H), ATPL, FI' : 'e.g. CPL(H), ATPL, FI'}
                value={credentials}
                onChangeText={setCredentials}
                placeholderTextColor={P.textMuted}
              />
            </View>

            <View>
              <Text style={s.inputLabel}>{sv ? 'Pilotsignatur (valfritt)' : 'Pilot signature (optional)'}</Text>
              <TouchableOpacity
                style={[s.input, { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 46 }]}
                onPress={() => setSigModal(true)}
                activeOpacity={0.7}
              >
                {signature
                  ? <SignatureView data={signature} height={28} color={P.text} />
                  : <Text style={{ color: P.textMuted, fontSize: 14 }}>{sv ? 'Skapa signatur' : 'Add signature'}</Text>}
                <Ionicons name="create-outline" size={18} color={P.accent} />
              </TouchableOpacity>
            </View>
          </ScrollView>

          <View style={{ alignSelf: 'stretch', gap: 8 }}>
            <TouchableOpacity style={s.nextBtn} onPress={handleProfileComplete} activeOpacity={0.85}>
              <Text style={s.nextBtnText}>{sv ? 'Kom igång' : 'Get started'}</Text>
              <Ionicons name="checkmark" size={18} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => handleProfileComplete()} activeOpacity={0.7}>
              <Text style={s.skipText}>{sv ? 'Hoppa över' : 'Skip'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <SignatureModal
        visible={sigModal}
        initial={signature}
        onClose={() => setSigModal(false)}
        onSave={(sg) => setSignature(sg)}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: P.bg, paddingHorizontal: 22, paddingTop: 10 },
  dotsRow: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginBottom: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: P.cardBorder },
  dotActive: { width: 24, backgroundColor: P.accent },

  backRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  backText: { color: P.textSecondary, fontSize: 14, fontWeight: '600' },

  stepContent: { flex: 1, alignItems: 'center', gap: 6 },

  welcomeTitle: { fontSize: 26, fontWeight: '800', color: P.text, letterSpacing: -0.5, textAlign: 'center' },
  welcomeSub: { fontSize: 14, color: P.textSecondary, textAlign: 'center', lineHeight: 20, paddingHorizontal: 16 },

  langRow: { flexDirection: 'row', gap: 10, alignSelf: 'stretch', marginBottom: 16 },
  langBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 12, borderRadius: 12,
    backgroundColor: P.card, borderWidth: 1.5, borderColor: P.cardBorder,
  },
  langBtnActive: { borderColor: P.accent, backgroundColor: P.accentBg },
  langBtnText: { fontSize: 14, fontWeight: '600', color: P.textSecondary },
  langBtnTextActive: { color: P.accent },

  eyebrow: {
    fontFamily: 'Menlo', fontSize: 10, fontWeight: '700', letterSpacing: 1.6,
    color: P.accent, textTransform: 'uppercase', marginBottom: 4, alignSelf: 'flex-start',
  },
  title: { fontSize: 20, fontWeight: '800', color: P.text, letterSpacing: -0.3, textAlign: 'center' },
  subtitle: { fontSize: 13, color: P.textSecondary, textAlign: 'center', lineHeight: 18, paddingHorizontal: 8, marginBottom: 8 },

  optionsCol: { alignSelf: 'stretch', gap: 10 },
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: P.card, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: P.cardBorder,
    shadowColor: '#1F2A44', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8,
  },
  cardActive: { borderColor: P.accent, backgroundColor: P.accentBg },
  cardTitle: { fontSize: 16, fontWeight: '800', color: P.text, letterSpacing: -0.2 },
  cardDesc: { fontSize: 12.5, color: P.textSecondary, lineHeight: 17, marginTop: 2 },

  emojiCircle: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: P.accentBg, borderWidth: 1, borderColor: P.accentBorder,
    alignItems: 'center', justifyContent: 'center',
  },

  formatBox: {
    width: 52, height: 52, borderRadius: 10,
    backgroundColor: '#F0F2F6', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: P.cardBorder,
  },
  formatText: { color: P.accent, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },

  nextBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    alignSelf: 'stretch', backgroundColor: P.accent, borderRadius: 12, paddingVertical: 15,
  },
  nextBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },

  footerNote: { color: P.textMuted, fontSize: 12, textAlign: 'center', paddingBottom: 8 },

  inputLabel: { fontSize: 12, fontWeight: '700', color: P.text, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 },
  input: {
    paddingVertical: 12, paddingHorizontal: 14,
    borderRadius: 10, borderWidth: 1, borderColor: P.cardBorder,
    backgroundColor: P.card, fontSize: 14, color: P.text,
  },
  skipText: { color: P.textMuted, fontSize: 14, fontWeight: '600', textAlign: 'center' },
});
