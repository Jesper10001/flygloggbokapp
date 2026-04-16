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
import { seedTestUser1, seedTestUser2, clearTestUser } from '../services/testUserSeed';
import { setSetting, getSetting } from '../db/flights';

type Persona = 'inspection' | 'military' | null;

const TOTAL_STEPS = 11;

// Ljus palett (Blades) — används för welcome/lang/profile tills persona är vald
const NEUTRAL = {
  bg: '#FFFFFF',
  card: '#FFFFFF',
  cardBorder: '#D6DCE5',
  elevated: '#F5F8FC',
  text: '#1F2A44',
  textSecondary: '#5A6B85',
  textMuted: '#8A96A8',
  accent: '#2FA8A5',
  accentBg: '#2FA8A514',
  accentBorder: '#2FA8A555',
  primary: '#1F2A44',
  primaryBtn: '#1F2A44',
  primaryBtnText: '#FFFFFF',
  border: '#D6DCE5',
};

export default function PreviewScreen() {
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

  const finishAddDrone = async () => {
    setLoading(true);
    try {
      await clearTestUser();
      await setSetting('preview_done', '1');
      await setSetting('drone_onboarded', '1');
      router.replace('/(tabs)');
      setTimeout(() => router.push('/settings/drones'), 200);
    } finally {
      setLoading(false);
    }
  };

  const finishSkip = async () => {
    setLoading(true);
    try {
      await clearTestUser();
      await setSetting('preview_done', '1');
      await setSetting('drone_onboarded', '1');
      router.replace('/(tabs)');
    } finally {
      setLoading(false);
    }
  };

  const skip = () => {
    Alert.alert(
      t('preview_skip_title'),
      t('preview_skip_body'),
      [
        { text: t('cancel'), style: 'cancel' },
        { text: t('preview_skip_confirm'), onPress: () => finishSkip() },
      ]
    );
  };

  const applyPersona = async (p: Persona) => {
    setPersona(p);
    await setMode('drone');
    if (p === 'inspection') {
      await seedTestUser1();
      await setTheme('drone-industrial');
    } else if (p === 'military') {
      await seedTestUser2();
      await setTheme('drone-neon');
    }
    setStep(step + 1);
  };

  const next = () => setStep((s) => Math.min(s + 1, TOTAL_STEPS - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.stepLabel}>{step + 1} / {TOTAL_STEPS}</Text>
        <TouchableOpacity onPress={skip} disabled={loading}>
          <Text style={styles.skipText}>{t('preview_skip')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${((step + 1) / TOTAL_STEPS) * 100}%` }]} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {step === 0 && <StepWelcome styles={styles} t={t} />}
        {step === 1 && <StepLanguage styles={styles} t={t} onPick={async (lang) => { await setLanguage(lang); next(); }} />}
        {step === 2 && <StepPersona styles={styles} t={t} onPick={applyPersona} />}
        {step === 3 && <StepDashboard styles={styles} t={t} persona={persona} />}
        {step === 4 && <StepPrep styles={styles} t={t} persona={persona} />}
        {step === 5 && <StepLogbook styles={styles} t={t} persona={persona} />}
        {step === 6 && <StepAddFlight styles={styles} t={t} persona={persona} />}
        {step === 7 && <StepAddDrone styles={styles} t={t} persona={persona} />}
        {step === 8 && <StepDroneList styles={styles} t={t} persona={persona} />}
        {step === 9 && <StepCertificates styles={styles} t={t} persona={persona} />}
        {step === 10 && (
          <StepFinish
            styles={styles}
            t={t}
            onAddDrone={finishAddDrone}
            onSkip={finishSkip}
            loading={loading}
          />
        )}
      </ScrollView>

      {/* Footer-nav */}
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

// ── Steg-komponenter ────────────────────────────────────────────────────────

function StepWelcome({ styles, t }: any) {
  return (
    <View style={styles.step}>
      <BladesLogo size="large" />
      <View style={{ height: 3, width: 140, borderRadius: 2, backgroundColor: NEUTRAL.accent, opacity: 0.8, marginTop: -6, marginBottom: 10 }} />
      <Text style={styles.stepTitle}>{t('preview_welcome_title')}</Text>
      <Text style={styles.stepBody}>{t('preview_welcome_body')}</Text>
      <View style={styles.infoList}>
        <InfoRow icon="language" text={t('preview_welcome_info_lang')} />
        <InfoRow icon="person-circle-outline" text={t('preview_welcome_info_persona')} />
        <InfoRow icon="eye-outline" text={t('preview_welcome_info_obs')} />
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
          <View style={{ flex: 1 }}>
            <Text style={styles.choiceTitle}>English</Text>
            <Text style={styles.choiceSub}>Default</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.choiceCard} onPress={() => onPick('sv')} activeOpacity={0.85}>
          <Text style={styles.choiceFlag}>🇸🇪</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.choiceTitle}>Svenska</Text>
            <Text style={styles.choiceSub}>Swedish</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
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
      <Text style={styles.stepBody}>{t('preview_persona_body')}</Text>
      <View style={{ gap: 10, width: '100%' }}>
        <TouchableOpacity style={styles.choiceCard} onPress={() => onPick('inspection')} activeOpacity={0.85}>
          <View style={styles.personaIcon}>
            <Ionicons name="hardware-chip-outline" size={28} color={NEUTRAL.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.choiceTitle}>{t('preview_persona_inspection')}</Text>
            <Text style={styles.choiceSub}>{t('preview_persona_inspection_sub')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.choiceCard} onPress={() => onPick('military')} activeOpacity={0.85}>
          <View style={styles.personaIcon}>
            <Ionicons name="shield-outline" size={28} color={NEUTRAL.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.choiceTitle}>{t('preview_persona_military')}</Text>
            <Text style={styles.choiceSub}>{t('preview_persona_military_sub')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function StepDashboard({ styles, t, persona }: any) {
  const widgets = persona === 'military'
    ? [{ v: '37:30', l: 'Total' }, { v: '15:45', l: 'BVLOS' }, { v: '32:10', l: 'Specific' }]
    : [{ v: '26:55', l: 'Total' }, { v: '9:15', l: 'Specific' }, { v: '12:20', l: 'A2' }];
  const bars = persona === 'military'
    ? [{ l: 'Specific', w: 100 }, { l: 'BVLOS', w: 62 }, { l: 'Night', w: 32 }]
    : [{ l: 'A2', w: 70 }, { l: 'Specific', w: 100 }, { l: 'A1', w: 28 }];
  const batteries = persona === 'military'
    ? { title: 'Puma AE — Battery health', bats: [
        { l: 'Battery #1', pct: 62, color: Colors.warning },
        { l: 'Battery #2', pct: 58, color: Colors.success },
        { l: 'Battery #3', pct: 51, color: Colors.success },
      ]}
    : { title: 'DJI Mavic 3 — Battery health', bats: [
        { l: 'Battery #1', pct: 71, color: Colors.warning },
        { l: 'Battery #2', pct: 69, color: Colors.warning },
        { l: 'Battery #3', pct: 45, color: Colors.success },
      ]};
  return (
    <View style={styles.step}>
      <ScreenFrame title={t('tab_dashboard')} tab="dashboard">
        <Text style={styles.fakeSection ?? { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>{t('totals')}</Text>
        <FakeWidgets items={widgets} />
        <Text style={styles.fakeSection ?? { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>{t('category_breakdown')}</Text>
        <FakeBar label="" bars={bars} />
        <Text style={styles.fakeSection ?? { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>{t('battery_health')}</Text>
        <FakeBattery title={batteries.title} bats={batteries.bats} />
      </ScreenFrame>
      <Text style={styles.stepTitle}>{t('preview_db_title')}</Text>
      <Text style={styles.stepBody}>{t('preview_db_body')}</Text>
    </View>
  );
}

function StepPrep({ styles, t, persona }: any) {
  const loc = persona === 'military' ? '67.8295, 20.2242' : '59.3293, 18.0686';
  const locName = persona === 'military' ? 'Kiruna övningsfält' : 'Västerås';
  return (
    <View style={styles.step}>
      <ScreenFrame title={t('tab_prep_flight')} tab="prep">
        <FakeRow icon="location" title={locName} sub={loc} />
        <FakeRow icon="map" title="TS drönarkarta" sub={t('country_pill_se')} />
        <FakeRow icon="cloud-outline" title={t('prep_weather')} sub={t('prep_weather_sub')} />
      </ScreenFrame>
      <Text style={styles.stepTitle}>{t('preview_prep_title')}</Text>
      <Text style={styles.stepBody}>{t('preview_prep_body')}</Text>
    </View>
  );
}

function StepLogbook({ styles, t, persona }: any) {
  const flights = persona === 'military'
    ? [
        { route: 'Revingehed övningsfält', date: '2026-03-12', aircraft: 'Puma AE · FMV-UAS-103', tags: [
          { label: '1:50h', color: Colors.primary },
          { label: 'BVLOS', color: Colors.gold },
          { label: 'Specific', color: Colors.textSecondary },
          { label: 'Night', color: Colors.textMuted },
        ]},
        { route: 'Vidsel Test Range', date: '2026-02-18', aircraft: 'Switchblade 300 · FMV-SB-07', tags: [
          { label: '0:55h', color: Colors.primary },
          { label: 'BVLOS', color: Colors.gold },
          { label: 'Specific', color: Colors.textSecondary },
        ]},
        { route: 'MOUT Kvarn', date: '2026-01-05', aircraft: 'Black Hornet · FMV-NANO-22', tags: [
          { label: '0:28h', color: Colors.primary },
          { label: 'VLOS', color: Colors.primaryLight },
          { label: 'Specific', color: Colors.textSecondary },
          { label: 'Obs', color: Colors.success },
        ]},
      ]
    : [
        { route: 'Västerås solpark', date: '2026-03-12', aircraft: 'DJI Mavic 3E · SWE-RP-2241', tags: [
          { label: '0:45h', color: Colors.primary },
          { label: 'VLOS', color: Colors.primaryLight },
          { label: 'A2', color: Colors.textSecondary },
        ]},
        { route: 'Uppsala vindkraftverk', date: '2026-02-18', aircraft: 'DJI Matrice 30T · SWE-RP-8877', tags: [
          { label: '1:12h', color: Colors.primary },
          { label: 'EVLOS', color: Colors.primaryLight },
          { label: 'Specific', color: Colors.textSecondary },
          { label: 'Obs', color: Colors.success },
        ]},
        { route: 'Stockholm stadion', date: '2026-01-05', aircraft: 'DJI Mini 4 Pro · SWE-RP-1102', tags: [
          { label: '0:22h', color: Colors.primary },
          { label: 'VLOS', color: Colors.primaryLight },
          { label: 'A1', color: Colors.textSecondary },
        ]},
      ];
  const monthTitle = persona === 'military' ? 'MARCH 2026' : 'APRIL 2026';
  const monthHours = persona === 'military' ? '12:15' : '4:30';
  const monthCount = persona === 'military' ? 9 : 7;
  return (
    <View style={styles.step}>
      <ScreenFrame title={t('tab_logbook')} tab="log">
        <FakeTabsDrone active="Flights" />
        <FakeSearch />
        <FakeMonth title={monthTitle} hours={monthHours} count={monthCount} />
        {flights.map((f) => (
          <FakeFlightDrone key={f.route + f.date} route={f.route} date={f.date} aircraft={f.aircraft} tags={f.tags} />
        ))}
        <FakeFab />
      </ScreenFrame>
      <Text style={styles.stepTitle}>{t('preview_log_title')}</Text>
      <Text style={styles.stepBody}>{t('preview_log_body')}</Text>
    </View>
  );
}

function FakeTabsDrone({ active }: { active: string }) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: Colors.elevated, borderRadius: 8, padding: 3, borderWidth: 0.5, borderColor: Colors.border }}>
      {['Flights', 'Manage drones'].map((o) => (
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

function FakeFlightDrone({ route, date, aircraft, tags }: { route: string; date: string; aircraft: string; tags: { label: string; color: string }[] }) {
  return (
    <View style={{ backgroundColor: Colors.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: Colors.cardBorder, gap: 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <Text style={{ color: Colors.textPrimary, fontSize: 14, fontWeight: '800', flex: 1 }} numberOfLines={1}>{route}</Text>
        <Text style={{ color: Colors.textMuted, fontSize: 11, fontFamily: 'Menlo', marginLeft: 8 }}>{date}</Text>
      </View>
      <Text style={{ color: Colors.textSecondary, fontSize: 11 }}>{aircraft}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 2 }}>
        {tags.map((tg) => (
          <View key={tg.label} style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, borderWidth: 1, borderColor: tg.color + '66', backgroundColor: tg.color + '14' }}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: tg.color }}>{tg.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function StepAddFlight({ styles, t, persona }: any) {
  const droneText = persona === 'military'
    ? 'AeroVironment Puma 3 AE · FMV-UAS-103'
    : 'DJI Mavic 3 Enterprise · SWE-RP-2241';
  const activeCat = persona === 'military' ? 'Specific' : 'A2';
  const activeMode = persona === 'military' ? 'BVLOS' : 'VLOS';
  const time = persona === 'military' ? '1:50' : '0:45';
  const battery = persona === 'military' ? 'Battery #1 · 62 cycles' : 'Battery #2 · 138 cycles';
  return (
    <View style={styles.step}>
      <ScreenFrame title={t('log_drone_flight')} tab="log">
        <FakeField label={t('date')} value="2026-04-15" />
        <FakeField label={t('drone')} value={droneText} />
        <FakeChips options={['A1', 'A2', 'A3', 'Specific']} active={activeCat} />
        <FakeChips options={['VLOS', 'EVLOS', 'BVLOS']} active={activeMode} />
        <FakeField label={t('total_flight_time')} value={time} />
        <FakeField label={t('battery')} value={battery} />
      </ScreenFrame>
      <Text style={styles.stepTitle}>{t('preview_addf_title')}</Text>
      <Text style={styles.stepBody}>{t('preview_addf_body')}</Text>
    </View>
  );
}

function StepAddDrone({ styles, t, persona }: any) {
  const model = persona === 'military' ? 'AeroVironment Puma 3 AE' : 'DJI Matrice 30T';
  const reg = persona === 'military' ? 'FMV-UAS-103' : 'SWE-RP-8877';
  const mtow = persona === 'military' ? '6300 g' : '3770 g';
  const bat1 = persona === 'military' ? 'Battery #1 · 62 cycles' : 'Battery #1 · 97 cycles';
  const bat2 = persona === 'military' ? 'Battery #2 · 58 cycles' : 'Battery #2 · 92 cycles';
  return (
    <View style={styles.step}>
      <ScreenFrame title={t('add_drone')} tab="settings">
        <FakeField label={t('drone_model')} value={model} />
        <FakeField label={t('drone_reg')} value={reg} />
        <FakeField label={t('drone_mtow')} value={mtow} />
        <FakeChips options={['A1', 'A2', 'A3', 'Specific']} active="Specific" />
        <FakeSmallRow text={bat1} />
        <FakeSmallRow text={bat2} />
      </ScreenFrame>
      <Text style={styles.stepTitle}>{t('preview_drone_title')}</Text>
      <Text style={styles.stepBody}>{t('preview_drone_body')}</Text>
    </View>
  );
}

function StepDroneList({ styles, t, persona }: any) {
  const fleet = persona === 'military'
    ? [
        { model: 'AeroVironment Puma 3 AE', meta: 'FMV-UAS-103 · 6300g · Specific', hours: '128:20', flights: 42 },
        { model: 'Teledyne Black Hornet 4',  meta: 'FMV-UAS-207 · 33g · Specific',  hours: '37:15',  flights: 58 },
        { model: 'Skydio X10D',              meta: 'FMV-UAS-312 · 2000g · Specific', hours: '22:40', flights: 18 },
      ]
    : [
        { model: 'DJI Matrice 30T',  meta: 'SWE-RP-8877 · 3770g · Specific', hours: '84:30',  flights: 61 },
        { model: 'DJI Mavic 3 Enterprise', meta: 'SWE-RP-2241 · 915g · A2',   hours: '46:12', flights: 38 },
        { model: 'DJI Mini 4 Pro',   meta: 'SWE-RP-1102 · 249g · A1',        hours: '9:45',  flights: 14 },
      ];
  return (
    <View style={styles.step}>
      <ScreenFrame title={t('manage_drones')} tab="settings">
        {fleet.map((d, i) => (
          <FakeDroneListRow key={i} model={d.model} meta={d.meta} hours={d.hours} flights={d.flights} />
        ))}
        <View style={{
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
          backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 11, marginTop: 4,
        }}>
          <Ionicons name="add" size={15} color={Colors.textInverse} />
          <Text style={{ color: Colors.textInverse, fontSize: 13, fontWeight: '700' }}>{t('add_drone')}</Text>
        </View>
      </ScreenFrame>
      <Text style={styles.stepTitle}>{t('preview_dronelist_title')}</Text>
      <Text style={styles.stepBody}>{t('preview_dronelist_body')}</Text>
    </View>
  );
}

function FakeDroneListRow({ model, meta, hours, flights }: { model: string; meta: string; hours: string; flights: number }) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: Colors.card, borderRadius: 12, padding: 12,
      borderWidth: 0.5, borderColor: Colors.cardBorder,
    }}>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ color: Colors.textPrimary, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>{model}</Text>
        <Text style={{ color: Colors.textSecondary, fontSize: 11 }} numberOfLines={1}>{meta}</Text>
      </View>
      <View style={{ alignItems: 'flex-end', marginRight: 4 }}>
        <Text style={{
          color: Colors.primary, fontSize: 15, fontWeight: '800',
          fontFamily: 'Menlo', letterSpacing: 1, fontVariant: ['tabular-nums'],
        }}>
          {hours}h
        </Text>
        <Text style={{ color: Colors.textMuted, fontSize: 10, marginTop: 1 }}>{flights} flt.</Text>
      </View>
      <Ionicons name="chevron-forward" size={13} color={Colors.textMuted} />
    </View>
  );
}

function StepCertificates({ styles, t, persona }: any) {
  const certs = persona === 'military'
    ? [
        { type: 'STS-02', label: 'SWEAF STS-02 Lvl2', days: 1495, severity: 'valid' },
        { type: 'OA', label: 'OA-MIL-2024-031', days: 25, severity: 'warning' },
        { type: 'Night Ops', label: 'Night Operations', days: 5, severity: 'critical' },
      ]
    : [
        { type: 'A2', label: 'TFS exam 2024', days: 1515, severity: 'valid' },
        { type: 'STS-01', label: 'Uppsala STS-01', days: 45, severity: 'warning' },
        { type: 'OA', label: 'OA-2024-087', days: 10, severity: 'critical' },
      ];
  return (
    <View style={styles.step}>
      <ScreenFrame title={t('certificates')} tab="settings">
        <FakeCert type={certs[0].type} label={certs[0].label} days={certs[0].days} severity={certs[0].severity} />
        <FakeCert type={certs[1].type} label={certs[1].label} days={certs[1].days} severity={certs[1].severity} />
        <FakeCert type={certs[2].type} label={certs[2].label} days={certs[2].days} severity={certs[2].severity} />
      </ScreenFrame>
      <Text style={styles.stepTitle}>{t('preview_cert_title')}</Text>
      <Text style={styles.stepBody}>{t('preview_cert_body')}</Text>
    </View>
  );
}

function StepFinish({ styles, t, onAddDrone, onSkip, loading }: any) {
  return (
    <View style={styles.step}>
      <View style={styles.iconBig}><Ionicons name="rocket" size={64} color={Colors.primary} /></View>
      <Text style={styles.stepTitle}>{t('preview_finish_title')}</Text>
      <Text style={styles.stepBody}>{t('preview_finish_body')}</Text>
      <View style={{ width: '100%', gap: 10, marginTop: 14 }}>
        <TouchableOpacity style={styles.finishPrimaryBtn} onPress={onAddDrone} disabled={loading} activeOpacity={0.85}>
          <Ionicons name="hardware-chip-outline" size={16} color={Colors.textInverse} />
          <Text style={styles.finishPrimaryText}>{t('drone_onb_add_first')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.finishSecondaryBtn} onPress={onSkip} disabled={loading} activeOpacity={0.7}>
          <Text style={styles.finishSecondaryText}>{t('drone_onb_skip')}</Text>
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

type ActiveTab = 'dashboard' | 'prep' | 'log' | 'settings';

function ScreenFrame({ title, children, tab }: { title: string; children: any; tab: ActiveTab }) {
  const styles = makeStyles();
  return (
    <View style={styles.frame}>
      <View style={styles.framePhoneTop}>
        <View style={styles.phoneNotch} />
      </View>
      <View style={styles.frameHeader}>
        <Ionicons name="ellipse" size={6} color={Colors.primary} />
        <Text style={styles.frameTitle}>{title}</Text>
      </View>
      <View style={styles.frameBody}>{children}</View>
      <View style={styles.frameTabBar}>
        <View style={styles.frameTabItem}>
          <Ionicons name="bar-chart" size={16} color={tab === 'dashboard' ? Colors.primary : Colors.textMuted} />
        </View>
        <View style={styles.frameTabItem}>
          <Ionicons name="compass" size={16} color={tab === 'prep' ? Colors.primary : Colors.textMuted} />
        </View>
        <View style={styles.frameTabItem}>
          <Ionicons name="list" size={16} color={tab === 'log' ? Colors.primary : Colors.textMuted} />
        </View>
        <View style={styles.frameTabItem}>
          <Ionicons name="settings-outline" size={16} color={tab === 'settings' ? Colors.primary : Colors.textMuted} />
        </View>
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

function FakeWidgets({ items }: { items: { v: string; l: string }[] }) {
  const styles = makeStyles();
  return (
    <View style={{ flexDirection: 'row', gap: 6 }}>
      {items.map((w) => (
        <View key={w.l} style={styles.fakeWidget}>
          <Text style={styles.fakeWidgetValue}>{w.v}</Text>
          <Text style={styles.fakeWidgetLabel}>{w.l}</Text>
        </View>
      ))}
    </View>
  );
}

function FakeBar({ label, bars }: { label: string; bars: { l: string; w: number }[] }) {
  const styles = makeStyles();
  return (
    <View style={styles.fakeCard}>
      <Text style={styles.fakeCardLabel}>{label}</Text>
      {bars.map((b) => (
        <View key={b.l} style={styles.fakeBarRow}>
          <Text style={styles.fakeBarLabel}>{b.l}</Text>
          <View style={styles.fakeBarTrack}>
            <View style={[styles.fakeBarFill, { width: `${b.w}%` }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

function FakeBattery({ title, bats }: { title: string; bats: { l: string; pct: number; color: string }[] }) {
  const styles = makeStyles();
  return (
    <View style={styles.fakeCard}>
      <Text style={styles.fakeCardLabel}>{title}</Text>
      {bats.map((b) => (
        <View key={b.l} style={styles.fakeBarRow}>
          <Text style={styles.fakeBarLabel}>{b.l}</Text>
          <View style={styles.fakeBarTrack}>
            <View style={[styles.fakeBarFill, { width: `${b.pct}%`, backgroundColor: b.color }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

function FakeRow({ icon, title, sub }: any) {
  const styles = makeStyles();
  return (
    <View style={styles.fakeRow}>
      <Ionicons name={icon} size={15} color={Colors.primary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.fakeRowTitle}>{title}</Text>
        <Text style={styles.fakeRowSub}>{sub}</Text>
      </View>
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

function FakeFlight({ location, meta }: any) {
  const styles = makeStyles();
  return (
    <View style={styles.fakeFlight}>
      <Text style={styles.fakeFlightLoc}>{location}</Text>
      <Text style={styles.fakeFlightMeta}>{meta}</Text>
    </View>
  );
}

function FakeFab() {
  const styles = makeStyles();
  return (
    <View style={{ alignItems: 'flex-end', marginTop: 6 }}>
      <View style={styles.fakeFabBtn}>
        <Ionicons name="add" size={20} color={Colors.textInverse} />
      </View>
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

function FakeSmallRow({ text }: any) {
  const styles = makeStyles();
  return (
    <View style={styles.fakeSmallRow}>
      <Ionicons name="battery-half-outline" size={14} color={Colors.textSecondary} />
      <Text style={{ color: Colors.textPrimary, fontSize: 12 }}>{text}</Text>
    </View>
  );
}

function FakeCert({ type, label, days, severity }: any) {
  const styles = makeStyles();
  const color = severity === 'critical' ? Colors.danger : severity === 'warning' ? Colors.warning : Colors.success;
  return (
    <View style={[styles.fakeCert, { borderLeftColor: color, borderLeftWidth: 3 }]}>
      <Text style={styles.fakeCertTitle}>{type} · {label}</Text>
      <Text style={[styles.fakeCertDays, { color }]}>{days} days left</Text>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

function makeStylesNeutral() {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: NEUTRAL.bg },
    header: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: 20, paddingTop: 60, paddingBottom: 8,
    },
    stepLabel: {
      color: NEUTRAL.textMuted, fontSize: 11, fontWeight: '700',
      letterSpacing: 1, textTransform: 'uppercase',
    },
    skipText: { color: NEUTRAL.textSecondary, fontSize: 13, fontWeight: '600' },
    progressTrack: {
      height: 3, backgroundColor: NEUTRAL.elevated, marginHorizontal: 20, borderRadius: 2,
    },
    progressFill: { height: '100%', backgroundColor: NEUTRAL.accent, borderRadius: 2 },

    content: { padding: 16, paddingBottom: 40, gap: 14 },
    step: { alignItems: 'center', gap: 12 },
    iconBig: {
      width: 96, height: 96, borderRadius: 48,
      backgroundColor: NEUTRAL.accentBg,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: NEUTRAL.accentBorder,
      marginBottom: 4,
    },
    stepTitle: { color: NEUTRAL.text, fontSize: 22, fontWeight: '800', textAlign: 'center' },
    stepBody: { color: NEUTRAL.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: 6 },

    infoList: { gap: 10, marginTop: 10, width: '100%' },
    infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    infoText: { color: '#000000', fontSize: 13, lineHeight: 18, flex: 1, fontWeight: '600' },

    choiceCard: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: NEUTRAL.card, borderRadius: 12, padding: 16,
      borderWidth: 1, borderColor: NEUTRAL.cardBorder,
    },
    choiceFlag: { fontSize: 32 },
    choiceTitle: { color: NEUTRAL.text, fontSize: 15, fontWeight: '700' },
    choiceSub: { color: NEUTRAL.textSecondary, fontSize: 12, marginTop: 2 },
    personaIcon: {
      width: 44, height: 44, borderRadius: 22,
      backgroundColor: NEUTRAL.accentBg,
      alignItems: 'center', justifyContent: 'center',
    },

    // Oanvända i neutral-stegen men måste finnas för typ-kompabilitet
    frame: {}, framePhoneTop: {}, phoneNotch: {}, frameHeader: {}, frameTitle: {}, frameBody: {}, frameTabBar: {}, frameTabItem: {},
    fakeWidget: {}, fakeWidgetValue: {}, fakeWidgetLabel: {}, fakeCard: {}, fakeCardLabel: {}, fakeBarRow: {}, fakeBarLabel: {}, fakeBarTrack: {}, fakeBarFill: {},
    fakeRow: {}, fakeRowTitle: {}, fakeRowSub: {}, fakeMonth: {}, fakeMonthTitle: {}, fakeMonthMeta: {}, fakeFlight: {}, fakeFlightLoc: {}, fakeFlightMeta: {},
    fakeFabBtn: {}, fakeField: {}, fakeFieldLabel: {}, fakeFieldValue: {}, fakeChip: {}, fakeChipActive: {}, fakeChipText: {}, fakeSmallRow: {},
    fakeCert: {}, fakeCertTitle: {}, fakeCertDays: {}, highlight: {}, highlightText: {},

    footer: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: 20, paddingVertical: 14,
      borderTopWidth: 0.5, borderTopColor: NEUTRAL.border,
      backgroundColor: NEUTRAL.card,
    },
    navBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8,
      backgroundColor: NEUTRAL.elevated,
    },
    navBtnDisabled: { opacity: 0.35 },
    navText: { color: NEUTRAL.text, fontSize: 13, fontWeight: '700' },
    primaryBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8,
      backgroundColor: NEUTRAL.primaryBtn,
    },
    primaryBtnText: { color: NEUTRAL.primaryBtnText, fontSize: 13, fontWeight: '800' },
    finishPrimaryBtn: {}, finishPrimaryText: {}, finishSecondaryBtn: {}, finishSecondaryText: {},
  });
}

function makeStyles() {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    header: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: 20, paddingTop: 60, paddingBottom: 8,
    },
    stepLabel: {
      color: Colors.textMuted, fontSize: 11, fontWeight: '700',
      letterSpacing: 1, textTransform: 'uppercase',
    },
    skipText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
    progressTrack: {
      height: 3, backgroundColor: Colors.elevated, marginHorizontal: 20, borderRadius: 2,
    },
    progressFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: 2 },

    content: { padding: 16, paddingBottom: 40, gap: 14 },
    step: { alignItems: 'center', gap: 12 },
    iconBig: {
      width: 96, height: 96, borderRadius: 48,
      backgroundColor: Colors.primary + '18',
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 1, borderColor: Colors.primary + '44',
      marginBottom: 4,
    },
    stepTitle: { color: Colors.textPrimary, fontSize: 22, fontWeight: '800', textAlign: 'center' },
    stepBody: { color: Colors.textSecondary, fontSize: 14, textAlign: 'center', lineHeight: 20, paddingHorizontal: 6 },

    infoList: { gap: 10, marginTop: 10, width: '100%' },
    infoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    infoText: { color: Colors.textPrimary, fontSize: 13, lineHeight: 18, flex: 1 },

    choiceCard: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      backgroundColor: Colors.card, borderRadius: 12, padding: 16,
      borderWidth: 1, borderColor: Colors.cardBorder,
    },
    choiceFlag: { fontSize: 32 },
    choiceTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
    choiceSub: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
    personaIcon: {
      width: 44, height: 44, borderRadius: 22,
      backgroundColor: Colors.primary + '18',
      alignItems: 'center', justifyContent: 'center',
    },

    // Fake screen frame — liknar en iPhone-rams
    frame: {
      width: '100%',
      backgroundColor: Colors.background,
      borderRadius: 24, padding: 0,
      borderWidth: 3, borderColor: Colors.primary + '66',
      overflow: 'hidden',
      marginVertical: 6,
    },
    framePhoneTop: {
      backgroundColor: Colors.surface, paddingVertical: 6,
      alignItems: 'center', justifyContent: 'center',
    },
    phoneNotch: {
      width: 60, height: 4, borderRadius: 3,
      backgroundColor: Colors.border,
    },
    frameHeader: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: Colors.surface, paddingHorizontal: 16, paddingVertical: 14,
      borderBottomWidth: 0.5, borderBottomColor: Colors.border,
    },
    frameTitle: {
      color: Colors.textPrimary, fontSize: 17, fontWeight: '800',
      letterSpacing: 0.3,
    },
    frameBody: { padding: 14, gap: 10, height: 520 },
    frameTabBar: {
      flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center',
      backgroundColor: Colors.surface,
      paddingVertical: 8,
      borderTopWidth: 0.5, borderTopColor: Colors.border,
    },
    frameTabItem: { padding: 6 },

    fakeWidget: {
      flex: 1, backgroundColor: Colors.card, borderRadius: 10, padding: 12,
      borderWidth: 0.5, borderColor: Colors.primary + '55', alignItems: 'center',
    },
    fakeWidgetValue: { color: Colors.primary, fontSize: 20, fontWeight: '800', fontFamily: 'Menlo' },
    fakeWidgetLabel: { color: Colors.textSecondary, fontSize: 11, marginTop: 4, fontWeight: '600' },

    fakeCard: {
      backgroundColor: Colors.card, borderRadius: 10, padding: 12,
      borderWidth: 0.5, borderColor: Colors.border, gap: 8,
    },
    fakeCardLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
    fakeBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    fakeBarLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: '600', width: 80 },
    fakeBarTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: Colors.elevated },
    fakeBarFill: { height: '100%', borderRadius: 4, backgroundColor: Colors.primary },

    fakeRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: Colors.card, borderRadius: 10, padding: 12,
      borderWidth: 0.5, borderColor: Colors.cardBorder,
    },
    fakeRowTitle: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700' },
    fakeRowSub: { color: Colors.textSecondary, fontSize: 11, marginTop: 2 },

    fakeMonth: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2, marginTop: 6 },
    fakeMonthTitle: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.6 },
    fakeMonthMeta: { color: Colors.textMuted, fontSize: 11 },
    fakeFlight: {
      backgroundColor: Colors.card, borderRadius: 10, padding: 12,
      borderWidth: 0.5, borderColor: Colors.cardBorder,
    },
    fakeFlightLoc: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700' },
    fakeFlightMeta: { color: Colors.textSecondary, fontSize: 11, marginTop: 2 },

    fakeFabBtn: {
      width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.primary,
      alignItems: 'center', justifyContent: 'center',
    },

    fakeField: {
      backgroundColor: Colors.card, borderRadius: 8, padding: 10,
      borderWidth: 0.5, borderColor: Colors.cardBorder,
    },
    fakeFieldLabel: { color: Colors.textSecondary, fontSize: 9, fontWeight: '700', textTransform: 'uppercase' },
    fakeFieldValue: { color: Colors.textPrimary, fontSize: 13, fontWeight: '600', marginTop: 2 },

    fakeChip: {
      paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
      backgroundColor: Colors.elevated, borderWidth: 0.5, borderColor: Colors.border,
    },
    fakeChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
    fakeChipText: { color: Colors.textMuted, fontSize: 10, fontWeight: '700' },

    fakeSmallRow: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingVertical: 4,
    },

    fakeCert: {
      backgroundColor: Colors.card, borderRadius: 8, padding: 10,
      borderWidth: 0.5, borderColor: Colors.cardBorder,
    },
    fakeCertTitle: { color: Colors.textPrimary, fontSize: 12, fontWeight: '700' },
    fakeCertDays: { fontSize: 11, fontWeight: '700', marginTop: 2 },

    highlight: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: Colors.gold + '22', borderRadius: 6,
      paddingHorizontal: 8, paddingVertical: 5,
      borderWidth: 0.5, borderColor: Colors.gold + '66',
    },
    highlightText: { color: Colors.gold, fontSize: 11, fontWeight: '700', flex: 1 },

    footer: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingHorizontal: 20, paddingVertical: 14,
      borderTopWidth: 0.5, borderTopColor: Colors.border,
      backgroundColor: Colors.surface,
    },
    navBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8,
      backgroundColor: Colors.elevated,
    },
    navBtnDisabled: { opacity: 0.35 },
    navText: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700' },
    primaryBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      paddingHorizontal: 18, paddingVertical: 10, borderRadius: 8,
      backgroundColor: Colors.primary,
    },
    primaryBtnText: { color: Colors.textInverse, fontSize: 13, fontWeight: '800' },

    finishPrimaryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 14,
    },
    finishPrimaryText: { color: Colors.textInverse, fontSize: 15, fontWeight: '800' },
    finishSecondaryBtn: { alignItems: 'center', paddingVertical: 12 },
    finishSecondaryText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },
  });
}
