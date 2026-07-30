import { create } from 'zustand';
import { getSetting, setSetting } from '../db/flights';

export type MainRole = 'pilot-manned' | 'pilot-unmanned';

export type SubRole =
  | 'rotary' | 'fixed'                    // pilot-manned
  | 'commercial' | 'military' | 'hobby';  // pilot-unmanned

export type AppTarget = 'manned' | 'drone';

export interface Profile {
  mainRole: MainRole;
  subRole: SubRole;
}

export function targetForProfile(p: Profile): AppTarget {
  return p.mainRole === 'pilot-unmanned' ? 'drone' : 'manned';
}

// Operator-rollen är borttagen ur appen. Behålls som no-op under utfasningen så inga anropsställen
// kraschar; alla operator-grenar blir därmed alltid falska (död kod som städas bort).
export function isOperator(_p: Profile | null): boolean {
  return false;
}

interface ProfileState {
  profile: Profile | null;
  loaded: boolean;
  load: () => Promise<void>;
  setProfile: (p: Profile) => Promise<void>;
  clearProfile: () => Promise<void>;
}

export const useProfileStore = create<ProfileState>((set) => ({
  profile: null,
  loaded: false,

  load: async () => {
    let main = await getSetting('profile_main_role');
    let sub = await getSetting('profile_sub_role');
    // Operator borttaget → migrera ev. befintlig operator-profil till pilot-manned (rotary).
    if (main === 'operator') {
      main = 'pilot-manned'; sub = 'rotary';
      await setSetting('profile_main_role', main);
      await setSetting('profile_sub_role', sub);
    }
    if (main && sub) {
      set({ profile: { mainRole: main as MainRole, subRole: sub as SubRole }, loaded: true });
    } else {
      set({ loaded: true });
    }
  },

  setProfile: async (p: Profile) => {
    await setSetting('profile_main_role', p.mainRole);
    await setSetting('profile_sub_role', p.subRole);
    set({ profile: p });
  },

  clearProfile: async () => {
    await setSetting('profile_main_role', '');
    await setSetting('profile_sub_role', '');
    set({ profile: null });
  },
}));
