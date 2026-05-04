import { create } from 'zustand';
import { getSetting, setSetting } from '../db/flights';

export type MainRole = 'pilot-manned' | 'operator' | 'pilot-unmanned';

export type SubRole =
  | 'rotary' | 'fixed'                                          // pilot-manned
  | 'crew-chief' | 'swimmer' | 'hoist' | 'hems' | 'loadmaster' // operator
  | 'commercial' | 'military' | 'hobby';                        // pilot-unmanned

export type AppTarget = 'manned' | 'drone';

export interface Profile {
  mainRole: MainRole;
  subRole: SubRole;
}

export function targetForProfile(p: Profile): AppTarget {
  return p.mainRole === 'pilot-unmanned' ? 'drone' : 'manned';
}

export function isOperator(p: Profile | null): boolean {
  return p?.mainRole === 'operator';
}

interface ProfileState {
  profile: Profile | null;
  loaded: boolean;
  load: () => Promise<void>;
  setProfile: (p: Profile) => Promise<void>;
}

export const useProfileStore = create<ProfileState>((set) => ({
  profile: null,
  loaded: false,

  load: async () => {
    const main = await getSetting('profile_main_role');
    const sub = await getSetting('profile_sub_role');
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
}));
