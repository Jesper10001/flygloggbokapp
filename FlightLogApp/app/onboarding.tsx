// Onboardingen: den nya (components/onboarding/NewOnboarding, designen "Onboarding redesign") när de nya
// paywallsen är på, alltså i TestFlight-bygget på kanalen preview; annars den gamla (LegacyOnboarding), som
// App Store-bygget fortsätter visa tills NEW_PAYWALLS_LIVE sätts i nästa version.
import { useLocalSearchParams } from 'expo-router';
import { NEW_PAYWALLS } from '../constants/paywalls';
import NewOnboarding from '../components/onboarding/NewOnboarding';
import LegacyOnboarding from '../components/onboarding/LegacyOnboarding';

// ?preview=1 (Inställningar, bara i TestFlight-bygget): den nya onboardingen utan att något sparas.
export default function OnboardingScreen() {
  const { preview } = useLocalSearchParams<{ preview?: string }>();
  if (preview === '1' && NEW_PAYWALLS) return <NewOnboarding preview />;
  return NEW_PAYWALLS ? <NewOnboarding /> : <LegacyOnboarding />;
}
