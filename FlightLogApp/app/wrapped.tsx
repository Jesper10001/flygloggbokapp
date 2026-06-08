import { useRouter } from 'expo-router';
import { useFlightStore } from '../store/flightStore';
import { WrappedStories } from '../components/wrapped/WrappedStories';

// Wrapped-genomgången som en egen route (fullskärmsmodal, stående). Nås via
// router.replace('/wrapped') från import-flödena — pålitligare än en RN Modal-
// overlay ovanpå en native import-modal.
export default function WrappedScreen() {
  const router = useRouter();

  const handleClose = () => {
    // Töm ev. kvarvarande modaler och garantera dashboard som slutmål.
    try { router.dismissAll(); } catch { /* inga modaler */ }
    try { router.replace('/(tabs)'); } catch { /* redan på dashboard */ }
    useFlightStore.getState().loadFlights();
    useFlightStore.getState().loadStats();
  };

  return <WrappedStories onClose={handleClose} />;
}
