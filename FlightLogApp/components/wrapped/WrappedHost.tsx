import { Modal } from 'react-native';
import { useRouter } from 'expo-router';
import { useWrappedStore } from '../../store/wrappedStore';
import { useFlightStore } from '../../store/flightStore';
import { WrappedStories } from './WrappedStories';

// Global overlay för Wrapped-genomgången. Renderas som en RN Modal (ligger
// ovanpå ev. öppna import-modaler oavsett djup). Vid stängning töms modal-
// stacken tillbaka till dashboarden och datan laddas om.
export function WrappedHost() {
  const visible = useWrappedStore(s => s.visible);
  const router = useRouter();

  const handleClose = () => {
    useWrappedStore.getState().close();
    // Töm ev. kvarvarande import-modaler och garantera dashboard som slutmål.
    try { router.dismissAll(); } catch { /* inga modaler att stänga */ }
    try { router.replace('/(tabs)'); } catch { /* redan på dashboard */ }
    useFlightStore.getState().loadFlights();
    useFlightStore.getState().loadStats();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      statusBarTranslucent
      onRequestClose={handleClose}
    >
      {visible && <WrappedStories onClose={handleClose} />}
    </Modal>
  );
}
