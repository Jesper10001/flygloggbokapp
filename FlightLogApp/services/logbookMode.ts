import { getSetting, setSetting } from '../db/flights';
import { useAppModeStore } from '../store/appModeStore';
import { useProfileStore, type MainRole, type Profile, type SubRole } from '../store/profileStore';

// Byter mellan pilot- och drönarloggbok i Blades Essential, med samma regler som Settings: nuvarande profil sparas
// så att underrollen finns kvar när man byter tillbaka. Ingen data rörs.
export async function switchLogbookMode(target: 'manned' | 'drone'): Promise<void> {
  const mainRole: MainRole = target === 'drone' ? 'pilot-unmanned' : 'pilot-manned';
  const { profile, setProfile } = useProfileStore.getState();
  let saved: Profile[] = [];
  try { saved = JSON.parse((await getSetting('additional_profiles')) || '[]'); } catch { /* trasig inställning = inga sparade */ }
  if (profile) {
    const others = saved.filter((p) => p.mainRole !== profile.mainRole);
    await setSetting('additional_profiles', JSON.stringify([...others, { mainRole: profile.mainRole, subRole: profile.subRole }]));
  }
  const subRole: SubRole = saved.find((p) => p.mainRole === mainRole)?.subRole ?? (target === 'drone' ? 'commercial' : 'fixed');
  await setProfile({ mainRole, subRole });
  await useAppModeStore.getState().setMode(target);
}
