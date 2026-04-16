import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { BladesLogo } from '../components/BladesLogo';
import { useTranslation } from '../hooks/useTranslation';
import { useLanguageStore } from '../store/languageStore';
import { useThemeStore } from '../store/themeStore';
import { useAppModeStore } from '../store/appModeStore';
import { seedMannedPilot1, seedMannedPilot2, clearMannedTestUser } from '../services/testUserSeed';
import { setSetting, getSetting } from '../db/flights';

type Persona = 'airline' | 'bush' | null;

const TOTAL_STEPS = 11;

// Light palette (Blades) — används fram till att persona är vald
const NEUTRAL = {
  bg: '#FFFFFF', card: '#FFFFFF', cardBorder: '#D6DCE5', elevated: '#F5F8FC',
  text: '#1F2A44', textSecondary: '#5A6B85', textMuted: '#8A96A8',
  accent: '#2FA8A5', accentBg: '#2FA8A514', accentBorder: '#2FA8A555',
  primary: '#1F2A44', primaryBtn: '#1F2A44', primaryBtnText: '#FFFFFF',
  border: '#D6DCE5',
};

export default function MannedPreviewScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { setLanguage } = useLanguageStore();
  const { setTheme } = useThemeStore();
  const { setMode } = useAppModeStore();
  const [step, setStep] = useState(0);
  const [persona, setPersona] = useState<Persona>(null);
  const [loading, setLoading] = useState(false);

  const isNeutral = step < 3;
  const styles = isNeutral ? makeStylesNeutral() : makeStyles();

  const finishWithImport = async () => {
    setLoading(true);
    try {
      await clearMannedTestUser();
      await setSetting('manned_preview_done', '1');
      await setSetting('manned_onboarded', '1');
      router.replace('/(tabs)');
      setTimeout(() => router.push('/import'), 200);
    } finally { setLoading(false); }
  };

  const finishSkip = async () => {
    setLoading(true);
    try {
      await clearMannedTestUser();
      await setSetting('manned_preview_done', '1');
      await setSetting('manned_onboarded', '1');
      router.replace('/(tabs)');
    } finally { setLoading(false); }
  };

  const skip = () => {
    Alert.alert(t('preview_skip_title'), t('preview_skip_body'),
      [
        { text: t('cancel'), style: 'cancel' },
        { text: t('preview_skip_confirm'), onPress: () => finishSkip() },
      ]);
  };

  const applyPersona = async (p: Persona) => {
    setPersona(p);
    await setMode('manned');
    if (p === 'airline') await seedMannedPilot1();
    else if (p === 'bush') await seedMannedPilot2();
    await setTheme('navy');
    setStep(step + 1);
  };

  const next = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.stepLabel}>{step + 1} / {TOTAL_STEPS}</Text>
        <TouchableOpacity onPress={skip} disabled={loading}>
          <Text style={styles.skipText}>{t('preview_skip')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${((step + 1) / TOTAL_STEPS) * 100}%` }]} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {step === 0 && <StepWelcome styles={styles} t={t} />}
        {step === 1 && <StepLanguage styles={styles} t={t} onPick={async (lang) => { await setLanguage(lang); next(); }} />}
        {step === 2 && <StepPersona styles={styles} t={t} onPick={applyPersona} />}
        {step === 3 && <StepDashboard styles={styles} t={t} persona={persona} />}
        {step === 4 && <StepLogbook styles={styles} t={t} persona={persona} />}
        {step === 5 && <StepAddFlight styles={styles} t={t} persona={persona} />}
        {step === 6 && <StepScan styles={styles} t={t} />}
        {step === 7 && <StepImport styles={styles} t={t} />}
        {step === 8 && <StepAircraft styles={styles} t={t} persona={persona} />}
        {step === 9 && <StepAirports styles={styles} t={t} />}
        {step === 10 && <StepFinish styles={styles} t={t} onImport={finishWithImport} onSkip={finishSkip} loading={loading} />}
      </ScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.navBtn, step === 0 && styles.navBtnDisabled]}
          onPress={back}
          disabled={step === 0 || loading}
        >
          <Ionicons name="arrow-back" size={16} color={step === 0 ? (isNeutral ? NEUTRAL.textMuted : Colors.textMuted) : (isNeutral ? NEUTRAL.text : Colors.textPrimary)} />
          <Text style={[styles.navText, step === 0 && { color: isNeutral ? NEUTRAL.textMuted : Colors.textMuted }]}>{t('preview_back')}</Text>
        </TouchableOpacity>

        {step === TOTAL_STEPS - 1 ? (
          <View style={{ width: 80 }} />
        ) : step === 1 || step === 2 ? (
          <View style={{ width: 80 }} />
        ) : (
          <TouchableOpacity style={styles.primaryBtn} onPress={next} disabled={loading}>
            <Text style={styles.primaryBtnText}>{t('preview_next')}</Text>
            <Ionicons name="arrow-forward" size={16} color={isNeutral ? NEUTRAL.primaryBtnText : Colors.textInverse} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// ── Steg ────────────────────────────────────────────────────────────────────

function StepWelcome({ styles, t }: any) {
  return (
    <View style={styles.step}>
      <BladesLogo size="large" />
      <View style={{ height: 3, width: 140, borderRadius: 2, backgroundColor: NEUTRAL.accent, opacity: 0.8, marginTop: -6, marginBottom: 10 }} />
      <Text style={styles.stepTitle}>{t('mpreview_welcome_title')}</Text>
      <Text style={styles.stepBody}>{t('mpreview_welcome_body')}</Text>
      <View style={styles.infoList}>
        <InfoRow icon="language" text={t('preview_welcome_info_lang')} />
        <InfoRow icon="person-circle-outline" text={t('preview_welcome_info_persona')} />
        <InfoRow icon="scan-outline" text={t('mpreview_welcome_info_scan')} />
        <InfoRow icon="cloud-upload-outline" text={t('mpreview_welcome_info_import')} />
      </View>
    </View>
  );
}

function StepLanguage({ styles, t, onPick }: any) {
  return (
    <View style={styles.step}>
      <View style={styles.iconBig}><Ionicons name="language" size={56} color={NEUTRAL.accent} /></View>
      <Text style={styles.stepTitle}>{t('preview_lang_title')}</Text>
      <Text style={styles.stepBody}>{t('preview_lang_body')}</Text>
      <View style={{ gap: 10, width: '100%' }}>
        <TouchableOpacity style={styles.choiceCard} onPress={() => onPick('en')} activeOpacity={0.85}>
          <Text style={styles.choiceFlag}>🇬🇧</Text>
          <View style={{ flex: 1 }}><Text style={styles.choiceTitle}>English</Text><Text style={styles.choiceSub}>Default</Text></View>
          <Ionicons name="chevron-forward" size={16} color={NEUTRAL.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.choiceCard} onPress={() => onPick('sv')} activeOpacity={0.85}>
          <Text style={styles.choiceFlag}>🇸🇪</Text>
          <View style={{ flex: 1 }}><Text style={styles.choiceTitle}>Svenska</Text><Text style={styles.choiceSub}>Swedish</Text></View>
          <Ionicons name="chevron-forward" size={16} color={NEUTRAL.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function StepPersona({ styles, t, onPick }: any) {
  return (
    <View style={styles.step}>
      <View style={styles.iconBig}><Ionicons name="person-circle" size={56} color={NEUTRAL.accent} /></View>
      <Text style={styles.stepTitle}>{t('preview_persona_title')}</Text>
      <Text style={styles.stepBody}>{t('mpreview_persona_body')}</Text>
      <View style={{ gap: 10, width: '100%' }}>
        <TouchableOpacity style={styles.choiceCard} onPress={() => onPick('airline')} activeOpacity={0.85}>
          <View style={styles.personaIcon}><Ionicons name="airplane-outline" size={28} color={NEUTRAL.accent} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.choiceTitle}>{t('mpreview_persona_airline')}</Text>
            <Text style={styles.choiceSub}>{t('mpreview_persona_airline_sub')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={NEUTRAL.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.choiceCard} onPress={() => onPick('bush')} activeOpacity={0.85}>
          <View style={styles.personaIcon}><Ionicons name="leaf-outline" size={28} color={NEUTRAL.accent} /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.choiceTitle}>{t('mpreview_persona_bush')}</Text>
            <Text style={styles.choiceSub}>{t('mpreview_persona_bush_sub')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={NEUTRAL.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function StepDashboard({ styles, t, persona }: any) {
  const total = persona === 'bush' ? '3210:50' : '5522:15';
  const pic = persona === 'bush' ? '3160:30' : '2925:45';
  const thirdLabel = persona === 'bush' ? 'NVG' : 'IFR';
  const thirdValue = persona === 'bush' ? '85:20' : '5424:00';
  const stress = persona === 'bush'
    ? { title: t('stress_3_desc'), action: t('stress_3_action'), color: Colors.success }
    : { title: t('stress_4_desc'), action: t('stress_4_action'), color: Colors.success };

  return (
    <View style={styles.step}>
      <ScreenFrame title={t('tab_dashboard')} tab="dashboard">
        <Text style={styles.fakeSectionReal}>{t('totals')}</Text>
        <View style={styles.realStatsGrid}>
          <RealStatCard value={total} label={t('total_flight_time')} sub={t('tap_to_switch')} />
          <RealStatCard value={pic} label="PIC" sub={t('tap_to_switch')} />
          <RealStatCard value={thirdValue} label={thirdLabel} sub={t('tap_to_switch')} />
        </View>

        <View style={styles.realSpotlightRow}>
          <RealSpotlight icon="trophy" iconColor={Colors.gold} label={t('best_week')} value={persona === 'bush' ? '18:45h' : '24:30h'} sub="2024-W28 · Jul 8–14" />
          <RealSpotlight icon="navigate" iconColor={Colors.primary} label={t('longest_xc')} value={persona === 'bush' ? '420 NM' : '1280 NM'} sub={persona === 'bush' ? 'ESSA→ESPA · 2024-06-12' : 'ESSA→LEBL · 2024-02-18'} />
        </View>

        <RealStressCard color={stress.color} title={stress.title} action={stress.action} pct={persona === 'bush' ? 48 : 60} />
      </ScreenFrame>
      <Text style={styles.stepTitle}>{t('mpreview_db_title')}</Text>
      <Text style={styles.stepBody}>{t('mpreview_db_body')}</Text>
    </View>
  );
}

function RealStatCard({ value, label, sub }: { value: string; label: string; sub?: string }) {
  return (
    <View style={{
      backgroundColor: Colors.card, borderRadius: 10, padding: 14,
      flex: 1, borderWidth: 0.5, borderColor: Colors.primary + '55', alignItems: 'center',
    }}>
      <Text style={{ color: Colors.primary, fontSize: 22, fontWeight: '800', fontFamily: 'Menlo', fontVariant: ['tabular-nums'] }}>{value}</Text>
      <Text style={{ color: Colors.textSecondary, fontSize: 11, marginTop: 3, textAlign: 'center' }}>{label}</Text>
      {sub ? <Text style={{ color: Colors.textMuted, fontSize: 10 }}>{sub}</Text> : null}
    </View>
  );
}

function RealSpotlight({ icon, iconColor, label, value, sub }: { icon: any; iconColor: string; label: string; value: string; sub: string }) {
  return (
    <View style={{
      flex: 1, backgroundColor: Colors.card, borderRadius: 10, padding: 14, gap: 6,
      borderWidth: 0.5, borderColor: Colors.primary + '55',
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <Ionicons name={icon} size={14} color={iconColor} />
        <Text style={{ color: Colors.textMuted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, flex: 1 }}>{label}</Text>
        <Ionicons name="chevron-forward" size={11} color={Colors.textMuted} />
      </View>
      <Text style={{ color: Colors.textPrimary, fontSize: 22, fontWeight: '800', fontFamily: 'Menlo', fontVariant: ['tabular-nums'], marginTop: 2 }}>{value}</Text>
      <Text style={{ color: Colors.textSecondary, fontSize: 10 }}>{sub}</Text>
    </View>
  );
}

function RealStressCard({ color, title, action, pct }: { color: string; title: string; action: string; pct: number }) {
  return (
    <View style={{
      backgroundColor: Colors.card, borderRadius: 12, padding: 12,
      borderWidth: 2, borderColor: color, gap: 6,
    }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: Colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' }}>Flight load</Text>
        <Text style={{ color, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] }}>+{pct - 50}%</Text>
      </View>
      <View style={{ height: 8, backgroundColor: Colors.separator, borderRadius: 4, overflow: 'hidden' }}>
        <View style={{ height: '100%', width: `${pct}%`, backgroundColor: color, borderRadius: 4 }} />
      </View>
      <Text style={{ color: Colors.textPrimary, fontSize: 12, fontWeight: '600' }}>{title}</Text>
      <Text style={{ color: Colors.textSecondary, fontSize: 11 }}>{action}</Text>
    </View>
  );
}

function StepLogbook({ styles, t, persona }: any) {
  const flights = persona === 'bush'
    ? [
        { route: 'SJON → BKFJ', date: '2026-03-12', aircraft: 'B407 · SE-JMB', tags: [
          { label: '1:42h', color: Colors.primary },
          { label: 'PIC 1:42h', color: Colors.success },
        ]},
        { route: 'ESNG → LAPN', date: '2026-02-18', aircraft: 'B407 · SE-JMB', tags: [
          { label: '2:18h', color: Colors.primary },
          { label: 'PIC 2:18h', color: Colors.success },
          { label: 'Hot refuel', color: Colors.warning },
        ]},
        { route: 'ESSA → BKFJ', date: '2025-11-05', aircraft: 'B407 · SE-JMB', tags: [
          { label: '2:06h', color: Colors.primary },
          { label: 'PIC 2:06h', color: Colors.success },
          { label: 'Night 2:06h', color: Colors.textMuted },
          { label: 'NVG 1:48h', color: Colors.gold },
        ]},
      ]
    : [
        { route: 'ESSA → EKCH', date: '2026-03-12', aircraft: 'A320 · SE-DOZ', tags: [
          { label: '1:30h', color: Colors.primary },
          { label: 'Copilot 1:30h', color: Colors.primaryLight },
          { label: 'IFR 1:30h', color: Colors.primaryLight },
        ]},
        { route: 'EDDF → ESSA', date: '2026-02-18', aircraft: 'A320 · SE-RJE', tags: [
          { label: '2:42h', color: Colors.primary },
          { label: 'Copilot 2:42h', color: Colors.primaryLight },
          { label: 'IFR 2:42h', color: Colors.primaryLight },
          { label: 'Night 1:12h', color: Colors.textMuted },
        ]},
        { route: 'ESSA → LFPG', date: '2025-11-05', aircraft: 'A320 · SE-DOZ', tags: [
          { label: '2:42h', color: Colors.primary },
          { label: 'PIC 2:42h', color: Colors.success },
          { label: 'IFR 2:42h', color: Colors.primaryLight },
        ]},
      ];
  return (
    <View style={styles.step}>
      <ScreenFrame title={t('tab_logbook')} tab="log">
        <FakeTabs options={['Flights', t('saved_airframes')]} active="Flights" />
        <FakeSearch />
        <FakeMonth title="MARCH 2026" hours={persona === 'bush' ? '8:12' : '14:36'} count={persona === 'bush' ? 4 : 6} />
        {flights.map((f, i) => (
          <FakeFlight key={f.route + f.date} route={f.route} date={f.date} aircraft={f.aircraft} tags={f.tags} odd={i % 2 === 1} />
        ))}
        <FakeFab />
      </ScreenFrame>
      <Text style={styles.stepTitle}>{t('mpreview_log_title')}</Text>
      <Text style={styles.stepBody}>{t('mpreview_log_body')}</Text>
    </View>
  );
}

function StepAddFlight({ styles, t, persona }: any) {
  const rules = persona === 'bush' ? 'VFR' : 'IFR';
  const dep = 'ESSA';
  const arr = persona === 'bush' ? 'BKFJ' : 'EDDF';
  const role = persona === 'bush' ? 'PIC' : 'Copilot';
  const totalTime = persona === 'bush' ? '1:42' : '2:35';
  return (
    <View style={styles.step}>
      <ScreenFrame title={t('log_new_flight')} tab="log">
        <Text style={styles.fakeSection}>{t('basic_info')}</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <FakeField label={t('date')} value="2026-04-15" />
          </View>
          <View style={{ flex: 1.4 }}>
            <FakeField label={t('aircraft_type')} value={persona === 'bush' ? 'B407' : 'A320'} />
          </View>
        </View>
        <FakeField label={t('registration')} value={persona === 'bush' ? 'SE-JMB' : 'SE-DOZ'} />

        <Text style={styles.fakeSection}>{t('route_utc')}</Text>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <View style={{ flex: 1 }}>
            <FakeTabs options={['ICAO', 'Temporary']} active="ICAO" />
          </View>
          <View style={{ width: 120 }}>
            <FakeTabs options={['DEP', 'ARR']} active="DEP" />
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <View style={{ flex: 1 }}>
            <FakeIcaoField value={dep} />
          </View>
          <View style={{ width: 120 }}>
            <FakeTimeField value="08:30" />
          </View>
        </View>

        <Text style={styles.fakeSection}>{t('flight_time_section')}</Text>
        <View style={styles.fakeTimeCard}>
          <Text style={{ color: Colors.gold, fontSize: 40, fontWeight: '900', fontFamily: 'Menlo', textAlign: 'center' }}>{totalTime}</Text>
          <FakeChips options={['VFR', 'IFR', 'Y', 'Z']} active={rules} />
          <View style={{ marginTop: 6 }}>
            <View style={{ flexDirection: 'row', gap: 4, marginBottom: 4 }}>
              <FakeRoleBtn label="PIC" active={role === 'PIC'} />
              <FakeRoleBtn label="Copilot" active={role === 'Copilot'} />
            </View>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              <FakeRoleBtn label="FI" active={false} />
              <FakeRoleBtn label="DUAL" active={false} />
              <FakeRoleBtn label="PICUS" active={false} />
            </View>
          </View>
        </View>
      </ScreenFrame>
      <Text style={styles.stepTitle}>{t('mpreview_addf_title')}</Text>
      <Text style={styles.stepBody}>{t('mpreview_addf_body')}</Text>
    </View>
  );
}

function FakeIcaoField({ value }: { value: string }) {
  return (
    <View style={{ backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, paddingVertical: 12, paddingHorizontal: 12 }}>
      <Text style={{ color: Colors.textPrimary, fontSize: 18, fontWeight: '800', fontFamily: 'Menlo', letterSpacing: 1, textAlign: 'center' }}>{value}</Text>
    </View>
  );
}

function FakeTimeField({ value }: { value: string }) {
  return (
    <View style={{ backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, paddingVertical: 12, paddingHorizontal: 12 }}>
      <Text style={{ color: Colors.textPrimary, fontSize: 18, fontWeight: '700', fontFamily: 'Menlo', letterSpacing: 1, textAlign: 'center' }}>{value}</Text>
    </View>
  );
}

function FakeRoleBtn({ label, active }: { label: string; active: boolean }) {
  return (
    <View style={{
      flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 7,
      backgroundColor: active ? Colors.primary : Colors.elevated,
      borderWidth: 1, borderColor: active ? Colors.primary : Colors.border,
    }}>
      <Text style={{ color: active ? Colors.textInverse : Colors.textMuted, fontSize: 11, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}

function StepScan({ styles, t }: any) {
  return (
    <View style={styles.step}>
      <ScreenFrame title={t('tab_scan')} tab="scan">
        <View style={styles.scanHeroBig}>
          <View style={styles.scanCamIcon}>
            <Ionicons name="camera" size={42} color={Colors.primary} />
          </View>
          <Text style={styles.scanHeroText}>Scan logbook page</Text>
          <Text style={styles.scanHeroSub}>Claude reads handwritten entries</Text>
          <View style={styles.scanCTA}>
            <Ionicons name="camera-outline" size={16} color={Colors.textInverse} />
            <Text style={{ color: Colors.textInverse, fontSize: 13, fontWeight: '800' }}>Take photo</Text>
          </View>
        </View>

        <Text style={styles.fakeSection}>Recently scanned</Text>
        <FakeRow icon="document-text-outline" title="Page 47 · 2024-08-12" sub="12 flights extracted · ready to review" />
        <FakeRow icon="document-text-outline" title="Page 46 · 2024-06-03" sub="14 flights extracted · saved" />
      </ScreenFrame>
      <Text style={styles.stepTitle}>{t('mpreview_scan_title')}</Text>
      <Text style={styles.stepBody}>{t('mpreview_scan_body')}</Text>
    </View>
  );
}

function StepImport({ styles, t }: any) {
  return (
    <View style={styles.step}>
      <ScreenFrame title={t('import_logbook')} tab="settings">
        <View style={styles.importHero}>
          <Ionicons name="cloud-upload-outline" size={42} color={Colors.primary} />
          <Text style={styles.scanHeroText}>Choose a file</Text>
          <Text style={styles.scanHeroSub}>CSV / Excel from your existing logbook</Text>
        </View>

        <Text style={styles.fakeSection}>AI column mapping</Text>
        <View style={styles.fakeMap}>
          <FakeMapLine from="Datum" to="date" />
          <FakeMapLine from="Luftfartygstyp" to="aircraft_type" />
          <FakeMapLine from="Flygtid" to="total_time" />
          <FakeMapLine from="PIC" to="pic" />
          <FakeMapLine from="Landningar dag" to="landings_day" />
          <FakeMapLine from="Anmärkningar" to="remarks" />
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.success + '14', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: Colors.success + '55' }}>
          <Ionicons name="checkmark-circle" size={18} color={Colors.success} />
          <Text style={{ color: Colors.success, fontSize: 13, fontWeight: '700', flex: 1 }}>1247 flights ready to import</Text>
        </View>
      </ScreenFrame>
      <Text style={styles.stepTitle}>{t('mpreview_import_title')}</Text>
      <Text style={styles.stepBody}>{t('mpreview_import_body')}</Text>
    </View>
  );
}

function FakeMapLine({ from, to }: { from: string; to: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 }}>
      <Text style={{ color: Colors.textPrimary, fontSize: 11, fontFamily: 'Menlo', flex: 1 }}>{from}</Text>
      <Ionicons name="arrow-forward" size={11} color={Colors.primary} />
      <Text style={{ color: Colors.primary, fontSize: 11, fontFamily: 'Menlo', flex: 1 }}>{to}</Text>
      <Ionicons name="checkmark-circle" size={13} color={Colors.success} />
    </View>
  );
}

function StepAircraft({ styles, t, persona }: any) {
  const list = persona === 'bush'
    ? [
        { t: 'Bell 407', r: 'SE-JMB · 133kt · 2.8h · SP · SE' },
        { t: 'Airbus H125', r: 'SE-JPO · 140kt · 3.0h · SP · SE' },
      ]
    : [
        { t: 'Airbus A320', r: 'SE-DOZ · 447kt · 5.5h · MP · ME' },
        { t: 'Airbus A320', r: 'SE-DOY · 447kt · 5.5h · MP · ME' },
        { t: 'Airbus A320', r: 'SE-RJE · 447kt · 5.5h · MP · ME' },
      ];
  return (
    <View style={styles.step}>
      <ScreenFrame title={t('saved_airframes')} tab="log">
        <FakeTabs options={['Flights', t('saved_airframes')]} active={t('saved_airframes')} />
        {list.map((ac) => (
          <FakeRow key={ac.r} icon="airplane-outline" title={ac.t} sub={ac.r} />
        ))}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 11, marginTop: 4 }}>
          <Ionicons name="add-circle" size={15} color={Colors.textInverse} />
          <Text style={{ color: Colors.textInverse, fontSize: 13, fontWeight: '700' }}>Add aircraft</Text>
        </View>
      </ScreenFrame>
      <Text style={styles.stepTitle}>{t('mpreview_ac_title')}</Text>
      <Text style={styles.stepBody}>{t('mpreview_ac_body')}</Text>
    </View>
  );
}

function StepAirports({ styles, t }: any) {
  return (
    <View style={styles.step}>
      <ScreenFrame title={t('manage_airports')} tab="settings">
        <FakeTabs options={['Custom', 'Temporary']} active="Custom" />
        <FakeSearch />
        <FakeRow icon="location" title="ESSA" sub="Stockholm Arlanda · Sweden · ES" />
        <FakeRow icon="location" title="LEBL" sub="Barcelona El Prat · Spain · LE" />
        <FakeRow icon="location" title="EDDF" sub="Frankfurt am Main · Germany · ED" />
        <FakeRow icon="location-outline" title="SJON" sub="Sjöbotten camp · Temporary" />
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: Colors.accent, borderRadius: 10, paddingVertical: 11, marginTop: 4 }}>
          <Ionicons name="add" size={15} color={Colors.textInverse} />
          <Text style={{ color: Colors.textInverse, fontSize: 13, fontWeight: '700' }}>{t('add_airport')}</Text>
        </View>
      </ScreenFrame>
      <Text style={styles.stepTitle}>{t('mpreview_apt_title')}</Text>
      <Text style={styles.stepBody}>{t('mpreview_apt_body')}</Text>
    </View>
  );
}

function StepFinish({ styles, t, onImport, onSkip, loading }: any) {
  return (
    <View style={styles.step}>
      <View style={styles.iconBig}><Ionicons name="rocket" size={64} color={Colors.primary} /></View>
      <Text style={styles.stepTitle}>{t('mpreview_finish_title')}</Text>
      <Text style={styles.stepBody}>{t('mpreview_finish_body')}</Text>
      <View style={{ width: '100%', gap: 10, marginTop: 14 }}>
        <TouchableOpacity style={styles.finishPrimaryBtn} onPress={onImport} disabled={loading} activeOpacity={0.85}>
          <Ionicons name="cloud-upload-outline" size={16} color={Colors.textInverse} />
          <Text style={styles.finishPrimaryText}>{t('manned_onb_import')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.finishSecondaryBtn} onPress={onSkip} disabled={loading} activeOpacity={0.7}>
          <Text style={styles.finishSecondaryText}>{t('manned_onb_skip')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── Hjälpkomponenter ────────────────────────────────────────────────────────

function InfoRow({ icon, text }: any) {
  const styles = makeStylesNeutral();
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={16} color={NEUTRAL.accent} />
      <Text style={styles.infoText}>{text}</Text>
    </View>
  );
}

type ActiveTab = 'dashboard' | 'log' | 'scan' | 'settings';

function ScreenFrame({ title, children, tab }: { title: string; children: any; tab: ActiveTab }) {
  const styles = makeStyles();
  return (
    <View style={styles.frame}>
      <View style={styles.framePhoneTop}><View style={styles.phoneNotch} /></View>
      <View style={styles.frameHeader}>
        <Ionicons name="ellipse" size={6} color={Colors.primary} />
        <Text style={styles.frameTitle}>{title}</Text>
      </View>
      <View style={styles.frameBody}>{children}</View>
      <View style={styles.frameTabBar}>
        <View style={styles.frameTabItem}><Ionicons name="bar-chart" size={16} color={tab === 'dashboard' ? Colors.primary : Colors.textMuted} /></View>
        <View style={styles.frameTabItem}><Ionicons name="list" size={16} color={tab === 'log' ? Colors.primary : Colors.textMuted} /></View>
        <View style={styles.frameTabItem}><Ionicons name="camera" size={16} color={tab === 'scan' ? Colors.primary : Colors.textMuted} /></View>
        <View style={styles.frameTabItem}><Ionicons name="settings-outline" size={16} color={tab === 'settings' ? Colors.primary : Colors.textMuted} /></View>
      </View>
    </View>
  );
}

function Highlight({ label }: any) {
  const styles = makeStyles();
  return (
    <View style={styles.highlight}>
      <Ionicons name="arrow-up" size={12} color={Colors.gold} />
      <Text style={styles.highlightText}>{label}</Text>
    </View>
  );
}

function FakeWidgets({ items }: { items: { v: string; l: string; sub?: string }[] }) {
  const styles = makeStyles();
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {items.map((w) => (
        <View key={w.l} style={styles.fakeWidget}>
          <Text style={styles.fakeWidgetValue}>{w.v}</Text>
          <Text style={styles.fakeWidgetLabel} numberOfLines={1}>{w.l}</Text>
          {w.sub ? <Text style={styles.fakeWidgetSub} numberOfLines={1}>{w.sub}</Text> : null}
        </View>
      ))}
    </View>
  );
}

function FakeSpotlight({ icon, label, value, sub }: { icon: any; label: string; value: string; sub: string }) {
  const styles = makeStyles();
  return (
    <View style={[styles.fakeCard, { flex: 1, borderColor: Colors.primary + '55', gap: 4 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <Ionicons name={icon} size={14} color={Colors.gold} />
        <Text style={styles.fakeCardLabel}>{label}</Text>
      </View>
      <Text style={{ color: Colors.textPrimary, fontSize: 20, fontWeight: '800', fontFamily: 'Menlo', marginTop: 2 }}>{value}</Text>
      <Text style={{ color: Colors.textSecondary, fontSize: 11 }}>{sub}</Text>
    </View>
  );
}

function FakeStress({ color, title, action }: { color: string; title: string; action: string }) {
  const styles = makeStyles();
  return (
    <View style={[styles.fakeCard, { borderColor: color + '88', borderWidth: 1.5 }]}>
      <Text style={styles.fakeCardLabel}>Flight load</Text>
      <Text style={{ color: Colors.textPrimary, fontSize: 12, fontWeight: '700' }}>{title}</Text>
      <Text style={{ color: Colors.textSecondary, fontSize: 11 }}>{action}</Text>
    </View>
  );
}

function FakeRow({ icon, title, sub }: any) {
  const styles = makeStyles();
  return (
    <View style={styles.fakeRow}>
      <Ionicons name={icon} size={15} color={Colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.fakeRowTitle} numberOfLines={1}>{title}</Text>
        <Text style={styles.fakeRowSub} numberOfLines={1}>{sub}</Text>
      </View>
    </View>
  );
}

function FakeTabs({ options, active }: { options: string[]; active: string }) {
  const styles = makeStyles();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: Colors.elevated, borderRadius: 8, padding: 3, borderWidth: 0.5, borderColor: Colors.border }}>
      {options.map((o) => (
        <View key={o} style={[
          { flex: 1, alignItems: 'center', paddingVertical: 6, borderRadius: 6 },
          o === active && { backgroundColor: Colors.primary },
        ]}>
          <Text style={{ color: o === active ? Colors.textInverse : Colors.textMuted, fontSize: 11, fontWeight: '700' }}>{o}</Text>
        </View>
      ))}
    </View>
  );
}

function FakeSearch() {
  const styles = makeStyles();
  return (
    <View style={[styles.fakeRow, { borderColor: Colors.border }]}>
      <Ionicons name="search" size={13} color={Colors.textMuted} />
      <Text style={{ color: Colors.textMuted, fontSize: 12, flex: 1 }}>Search…</Text>
    </View>
  );
}

function FakeMonth({ title, hours, count }: any) {
  const styles = makeStyles();
  return (
    <View style={styles.fakeMonth}>
      <Text style={styles.fakeMonthTitle}>{title}</Text>
      <Text style={styles.fakeMonthMeta}>{hours}h · {count} flt.</Text>
    </View>
  );
}

function FakeFlight({ route, date, aircraft, tags, odd }: { route: string; date: string; aircraft: string; tags: { label: string; color: string }[]; odd?: boolean }) {
  const styles = makeStyles();
  return (
    <View style={[styles.fakeFlight, odd && { backgroundColor: Colors.elevated }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={styles.fakeFlightRoute}>{route}</Text>
        <Text style={{ color: Colors.textMuted, fontSize: 11, fontFamily: 'Menlo' }}>{date}</Text>
      </View>
      <Text style={styles.fakeFlightMeta}>{aircraft}</Text>
      <View style={styles.fakeFlightTags}>
        {tags.map((tg) => (
          <View key={tg.label} style={[styles.fakeFlightTag, { borderColor: tg.color + '66', backgroundColor: tg.color + '14' }]}>
            <Text style={[styles.fakeFlightTagText, { color: tg.color }]}>{tg.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function FakeFab() {
  const styles = makeStyles();
  return (
    <View style={{ alignItems: 'flex-end', marginTop: 6 }}>
      <View style={styles.fakeFabBtn}><Ionicons name="add" size={20} color={Colors.textInverse} /></View>
    </View>
  );
}

function FakeField({ label, value }: any) {
  const styles = makeStyles();
  return (
    <View style={styles.fakeField}>
      <Text style={styles.fakeFieldLabel}>{label}</Text>
      <Text style={styles.fakeFieldValue}>{value}</Text>
    </View>
  );
}

function FakeRouteRow({ dep, arr }: any) {
  const styles = makeStyles();
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      <View style={[styles.fakeField, { flex: 1 }]}>
        <Text style={styles.fakeFieldLabel}>DEP</Text>
        <Text style={styles.fakeFieldValue}>{dep}</Text>
      </View>
      <View style={[styles.fakeField, { flex: 1 }]}>
        <Text style={styles.fakeFieldLabel}>ARR</Text>
        <Text style={styles.fakeFieldValue}>{arr}</Text>
      </View>
    </View>
  );
}

function FakeChips({ options, active }: { options: string[]; active: string }) {
  const styles = makeStyles();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginVertical: 4 }}>
      {options.map((o) => (
        <View key={o} style={[styles.fakeChip, o === active && styles.fakeChipActive]}>
          <Text style={[styles.fakeChipText, o === active && { color: Colors.textInverse }]}>{o}</Text>
        </View>
      ))}
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

function makeStylesNeutral() {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: NEUTRAL.bg },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 8 },
    stepLabel: { color: NEUTRAL.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
    skipText: { color: NEUTRAL.textSecondary, fontSize: 13, fontWeight: '600' },
    progressTrack: { height: 3, backgroundColor: NEUTRAL.elevated, marginHorizontal: 20, borderRadius: 2 },
    progressFill: { height: '100%', backgroundColor: NEUTRAL.accent, borderRadius: 2 },
    content: { padding: 16, paddingBottom: 40, gap: 14 },
    step: { alignItems: 'center', gap: 12 },
    iconBig: { width: 96, height: 96, borderRadius: 48, backgroundColor: NEUTRAL.accentBg, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: NEUTRAL.accentBorder, marginBottom: 4 },
    stepTitle: { color: NEUTRAL.text, fontSize: 22, fontWeight: '800', textAlign: 'center' },
    stepBody: { color: NEUTRAL.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: 6 },
    infoList: { gap: 10, marginTop: 10, width: '100%' },
    infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    infoText: { color: '#000000', fontSize: 13, lineHeight: 18, flex: 1, fontWeight: '600' },
    choiceCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: NEUTRAL.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: NEUTRAL.cardBorder },
    choiceFlag: { fontSize: 32 },
    choiceTitle: { color: NEUTRAL.text, fontSize: 15, fontWeight: '700' },
    choiceSub: { color: NEUTRAL.textSecondary, fontSize: 12, marginTop: 2 },
    personaIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: NEUTRAL.accentBg, alignItems: 'center', justifyContent: 'center' },
    frame: {}, framePhoneTop: {}, phoneNotch: {}, frameHeader: {}, frameTitle: {}, frameBody: {}, frameTabBar: {}, frameTabItem: {},
    fakeWidget: {}, fakeWidgetValue: {}, fakeWidgetLabel: {}, fakeCard: {}, fakeCardLabel: {}, fakeRow: {}, fakeRowTitle: {}, fakeRowSub: {},
    fakeMonth: {}, fakeMonthTitle: {}, fakeMonthMeta: {}, fakeFlight: {}, fakeFlightLoc: {}, fakeFlightMeta: {}, fakeFabBtn: {}, fakeField: {}, fakeFieldLabel: {}, fakeFieldValue: {},
    fakeChip: {}, fakeChipActive: {}, fakeChipText: {}, highlight: {}, highlightText: {}, scanHero: {}, scanHeroText: {}, fakeMap: {}, fakeMapRow: {},
    footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 0.5, borderTopColor: NEUTRAL.border, backgroundColor: NEUTRAL.card },
    navBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, backgroundColor: NEUTRAL.elevated },
    navBtnDisabled: { opacity: 0.35 },
    navText: { color: NEUTRAL.text, fontSize: 13, fontWeight: '700' },
    primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8, backgroundColor: NEUTRAL.primaryBtn },
    primaryBtnText: { color: NEUTRAL.primaryBtnText, fontSize: 13, fontWeight: '800' },
    finishPrimaryBtn: {}, finishPrimaryText: {}, finishSecondaryBtn: {}, finishSecondaryText: {},
  });
}

function makeStyles() {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 60, paddingBottom: 8 },
    stepLabel: { color: Colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
    skipText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
    progressTrack: { height: 3, backgroundColor: Colors.elevated, marginHorizontal: 20, borderRadius: 2 },
    progressFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: 2 },
    content: { padding: 16, paddingBottom: 40, gap: 14 },
    step: { alignItems: 'center', gap: 12 },
    iconBig: { width: 96, height: 96, borderRadius: 48, backgroundColor: Colors.primary + '18', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.primary + '44', marginBottom: 4 },
    stepTitle: { color: Colors.textPrimary, fontSize: 22, fontWeight: '800', textAlign: 'center' },
    stepBody: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: 6 },
    infoList: { gap: 10, marginTop: 10, width: '100%' },
    infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    infoText: { color: Colors.textPrimary, fontSize: 13, lineHeight: 18, flex: 1 },
    choiceCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.card, borderRadius: 12, padding: 16, borderWidth: 1, borderColor: Colors.cardBorder },
    choiceFlag: { fontSize: 32 },
    choiceTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
    choiceSub: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
    personaIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.primary + '18', alignItems: 'center', justifyContent: 'center' },

    frame: { width: '100%', backgroundColor: Colors.background, borderRadius: 24, borderWidth: 3, borderColor: Colors.primary + '66', overflow: 'hidden', marginVertical: 6 },
    framePhoneTop: { backgroundColor: Colors.surface, paddingVertical: 6, alignItems: 'center', justifyContent: 'center' },
    phoneNotch: { width: 60, height: 4, borderRadius: 3, backgroundColor: Colors.border },
    frameHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.surface, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: Colors.border },
    frameTitle: { color: Colors.textPrimary, fontSize: 17, fontWeight: '800', letterSpacing: 0.3 },
    frameBody: { padding: 14, gap: 10, height: 520 },
    frameTabBar: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', backgroundColor: Colors.surface, paddingVertical: 8, borderTopWidth: 0.5, borderTopColor: Colors.border },
    frameTabItem: { padding: 6 },

    fakeWidget: { flex: 1, backgroundColor: Colors.card, borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: Colors.primary + '55', alignItems: 'center' },
    fakeWidgetValue: { color: Colors.primary, fontSize: 20, fontWeight: '800', fontFamily: 'Menlo', fontVariant: ['tabular-nums'] },
    fakeWidgetLabel: { color: Colors.textSecondary, fontSize: 11, marginTop: 4, fontWeight: '600' },
    fakeWidgetSub: { color: Colors.textMuted, fontSize: 9, marginTop: 2 },
    fakeSection: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginTop: 2, marginBottom: 2 },
    fakeSectionReal: { color: Colors.textMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1.5, textTransform: 'uppercase', marginTop: 2, marginBottom: 4 },
    realStatsGrid: { flexDirection: 'row', gap: 8 },
    realSpotlightRow: { flexDirection: 'row', gap: 8 },
    fakeTimeCard: { backgroundColor: Colors.card, borderRadius: 12, padding: 12, borderWidth: 0.5, borderColor: Colors.border, gap: 8 },

    fakeCard: { backgroundColor: Colors.card, borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: Colors.border, gap: 6 },
    fakeCardLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },

    fakeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: Colors.card, borderRadius: 12, padding: 14, borderWidth: 0.5, borderColor: Colors.cardBorder },
    fakeRowTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
    fakeRowSub: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },

    fakeMonth: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: Colors.elevated, borderBottomWidth: 0.5, borderBottomColor: Colors.separator, marginHorizontal: -14 },
    fakeMonthTitle: { flex: 1, color: Colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 1 },
    fakeMonthMeta: { color: Colors.textMuted, fontSize: 12, fontWeight: '700', fontFamily: 'Menlo' },
    fakeFlight: { padding: 12, paddingHorizontal: 14, backgroundColor: Colors.card, marginHorizontal: -14, borderBottomWidth: 0.5, borderBottomColor: Colors.separator, gap: 4 },
    fakeFlightRoute: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700', letterSpacing: 1, fontFamily: 'Menlo' },
    fakeFlightMeta: { color: Colors.textSecondary, fontSize: 12 },
    fakeFlightTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
    fakeFlightTag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3, borderWidth: 0.5 },
    fakeFlightTagText: { fontSize: 10, fontWeight: '600', fontFamily: 'Menlo' },

    fakeFabBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },

    fakeField: { backgroundColor: Colors.card, borderRadius: 8, padding: 10, borderWidth: 0.5, borderColor: Colors.cardBorder },
    fakeFieldLabel: { color: Colors.textSecondary, fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
    fakeFieldValue: { color: Colors.textPrimary, fontSize: 13, fontWeight: '600', marginTop: 2 },

    fakeChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: Colors.elevated, borderWidth: 0.5, borderColor: Colors.border },
    fakeChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
    fakeChipText: { color: Colors.textMuted, fontSize: 10, fontWeight: '700' },

    highlight: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.gold + '22', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 5, borderWidth: 0.5, borderColor: Colors.gold + '66' },
    highlightText: { color: Colors.gold, fontSize: 11, fontWeight: '700', flex: 1 },

    scanHero: { alignItems: 'center', paddingVertical: 16, gap: 6, backgroundColor: Colors.primary + '18', borderRadius: 12, borderWidth: 1, borderColor: Colors.primary + '44' },
    scanHeroText: { color: Colors.primary, fontSize: 14, fontWeight: '800', letterSpacing: 0.5 },
    scanHeroBig: { alignItems: 'center', paddingVertical: 22, gap: 8, backgroundColor: Colors.primary + '14', borderRadius: 14, borderWidth: 1, borderColor: Colors.primary + '44' },
    scanCamIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: Colors.primary + '22', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.primary + '55' },
    scanHeroSub: { color: Colors.textSecondary, fontSize: 12 },
    scanCTA: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: Colors.primary, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, marginTop: 4 },

    fakeMap: { backgroundColor: Colors.card, borderRadius: 10, padding: 10, borderWidth: 0.5, borderColor: Colors.border, gap: 2 },
    fakeMapRow: { color: Colors.textPrimary, fontSize: 11, fontFamily: 'Menlo' },
    importHero: { alignItems: 'center', paddingVertical: 18, gap: 6, backgroundColor: Colors.primary + '14', borderRadius: 12, borderWidth: 1, borderColor: Colors.primary + '44' },

    footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderTopWidth: 0.5, borderTopColor: Colors.border, backgroundColor: Colors.surface },
    navBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, backgroundColor: Colors.elevated },
    navBtnDisabled: { opacity: 0.35 },
    navText: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700' },
    primaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8, backgroundColor: Colors.primary },
    primaryBtnText: { color: Colors.textInverse, fontSize: 13, fontWeight: '800' },

    finishPrimaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14 },
    finishPrimaryText: { color: Colors.textInverse, fontSize: 15, fontWeight: '800' },
    finishSecondaryBtn: { alignItems: 'center', paddingVertical: 12 },
    finishSecondaryText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  });
}
