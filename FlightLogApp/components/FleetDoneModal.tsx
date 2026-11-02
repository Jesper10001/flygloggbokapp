// Popup när Fleet-datan (spec + bild) hämtats i bakgrunden efter en import: CSV, skanning av pappersboken
// eller drönarimport. GLOBAL (renderas i _layout, som ToastHost) eftersom importskärmen ofta hunnit stängas
// när bakgrundshämtningen blir klar. Samma stil som appens övriga popup-rutor (GlassDialog).
import { router } from 'expo-router';
import { create } from 'zustand';
import { GlassDialog, DialogIcon } from './GlassDialog';
import { useFlightStore } from '../store/flightStore';

// Info om hämtningen (för delvis hämtat / slut på coins). null = enkel "klart"-variant.
export interface FleetDoneInfo { enriched: number; total: number; remaining: number; stoppedForQuota: boolean; }
export type FleetSource = 'csv' | 'scan' | 'drone';

interface FleetDoneStore {
  visible: boolean;
  info: FleetDoneInfo | null;
  fleetRoute: string | null; // vart "Navigate to fleet" går (drönare vs pilot). null = pilotens loggbok-flik.
  source: FleetSource;
  show: (info?: FleetDoneInfo, fleetRoute?: string, source?: FleetSource) => void;
  hide: () => void;
}

export const useFleetDoneStore = create<FleetDoneStore>((set) => ({
  visible: false,
  info: null,
  fleetRoute: null,
  source: 'csv',
  show: (info, fleetRoute, source) => set({ visible: true, info: info ?? null, fleetRoute: fleetRoute ?? null, source: source ?? (fleetRoute ? 'drone' : 'csv') }),
  hide: () => set({ visible: false }),
}));

const FROM: Record<FleetSource, string> = { csv: 'your import', scan: 'your logbook scan', drone: 'your import' };

export function FleetDoneHost() {
  const { visible, info, fleetRoute, source, hide } = useFleetDoneStore();
  const premium = useFlightStore((s) => s.isPremium);

  const goFleet = () => {
    hide();
    // Drönarimporten skickar egen rutt (drönarloggbokens Fleet-flik); annars pilotens loggbok-flik.
    setTimeout(() => {
      if (fleetRoute) router.push({ pathname: fleetRoute, params: { view: 'fleet', t: String(Date.now()) } } as any);
      else router.push({ pathname: '/(tabs)/log', params: { view: 'fleet', t: String(Date.now()) } } as any);
    }, 180);
  };
  const goUpgrade = () => { hide(); setTimeout(() => router.push('/settings/premium' as any), 180); };

  // Slut på Blade coins mitt i hämtningen: hur många som hämtades, och vad som gäller för resten.
  const partial = !!info?.stoppedForQuota && info.remaining > 0;
  const n = info?.enriched ?? 0;
  const aircraft = n === 1 ? '1 aircraft' : `${n} aircraft`;

  if (partial) {
    return (
      <GlassDialog
        visible={visible}
        onClose={hide}
        icon={<DialogIcon name="airplane" />}
        eyebrow="Fleet partly updated"
        title={`${info!.enriched} of ${info!.total} aircraft`}
        body={premium
          ? `Specs and photos are in for ${info!.enriched} of the aircraft from ${FROM[source]}. You're out of Blade coins this month, so the remaining ${info!.remaining} are fetched when your coins refill, or open one in your fleet to fetch it.`
          : `Specs and photos are in for ${info!.enriched} of the aircraft from ${FROM[source]}. You're out of Blade coins. Blades Premium fetches the remaining ${info!.remaining}.`}
        primary={premium ? { label: 'Navigate to fleet', onPress: goFleet } : { label: 'Upgrade to Blades Premium', onPress: goUpgrade }}
        secondary={premium ? { label: 'Not now', onPress: hide } : { label: 'Navigate to fleet', onPress: goFleet }}
      />
    );
  }
  return (
    <GlassDialog
      visible={visible}
      onClose={hide}
      icon={<DialogIcon name="airplane" />}
      eyebrow="Fleet updated"
      title="Your fleet is ready"
      body={n > 0 ? `Specs and photos for ${aircraft} from ${FROM[source]} are now in your fleet.` : `Your fleet has been updated after ${FROM[source]}.`}
      primary={{ label: 'Navigate to fleet', onPress: goFleet }}
      secondary={{ label: 'Not now', onPress: hide }}
    />
  );
}
