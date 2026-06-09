import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useProfileStore } from '../store/profileStore';
import { WrappedStories } from '../components/wrapped/WrappedStories';

// Wrapped-genomgången som en egen route (fullskärmsmodal, stående). Nås via
// router.replace('/wrapped') från import-flödena — pålitligare än en RN Modal-
// overlay ovanpå en native import-modal. Endast för bemannad pilot.
export default function WrappedScreen() {
  const router = useRouter();
  const role = useProfileStore((s) => s.profile?.mainRole);

  const handleClose = () => {
    // Wrapped nås numera via knappen i Inställningar → gå tillbaka dit.
    try { router.back(); } catch { try { router.replace('/(tabs)'); } catch { /* noop */ } }
  };

  // Säkerhetsspärr: om en icke-pilot på något sätt når hit, stäng direkt.
  useEffect(() => {
    if (role && role !== 'pilot-manned') { try { router.replace('/(tabs)'); } catch { /* noop */ } }
  }, [role, router]);

  if (role && role !== 'pilot-manned') return null;

  return <WrappedStories onClose={handleClose} />;
}
