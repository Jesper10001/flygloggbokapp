// Bara TestFlight (TEST_BUILD), tillfälligt: onboardingens betalvägg (components/onboarding/OnboardingPaywall) som en
// ny användare ser den, med gratisveckan, för skärmdumpen som App Review vill ha på provveckans produkter. Öppnas
// genom att hålla inne ABOUT i Settings. Tas bort före bygget 1.0.1.
import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { OnboardingPaywall } from '../components/onboarding/OnboardingPaywall';
import { getOnboardingPlans, type PlanOption } from '../services/purchases';
import { useAppModeStore } from '../store/appModeStore';
import { TEST_BUILD } from '../store/scanStore';

export default function PaywallPreviewScreen() {
  const router = useRouter();
  const pilot = useAppModeStore((s) => s.mode) !== 'drone';
  const [plans, setPlans] = useState<PlanOption[] | null>(null);
  useEffect(() => { getOnboardingPlans({ asNewUser: true }).then(setPlans).catch(() => setPlans([])); }, []);
  const close = () => router.back();
  if (!TEST_BUILD || (plans && !plans.length)) {
    return (
      <View style={{ flex: 1, backgroundColor: '#0A1628', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32 }}>
        <Text style={{ color: '#FFFFFF', fontSize: 16, textAlign: 'center' }}>The onboarding paywall has no plans in this build.</Text>
        <Pressable onPress={close} accessibilityRole="button"><Text style={{ color: '#00C8E8', fontSize: 16, fontWeight: '700' }}>Close</Text></Pressable>
      </View>
    );
  }
  if (!plans) {
    return <View style={{ flex: 1, backgroundColor: '#0A1628', alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#00C8E8" /></View>;
  }
  return (
    <View style={{ flex: 1, backgroundColor: '#0A1628' }}>
      <OnboardingPaywall
        plans={plans}
        pilot={pilot}
        lic=""
        paper={false}
        title={pilot ? 'Your whole flying life in one logbook.' : 'Every drone flight logged in seconds.'}
        sub={pilot ? 'From local circuits to long cross-countries.' : 'VLOS to BVLOS, all your flying in one place.'}
        onDone={close}
      />
    </View>
  );
}
