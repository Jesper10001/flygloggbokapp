import { create } from 'zustand';
import { getSetting, setSetting } from '../db/flights';

interface OperatorStore {
  operatorId: string;
  setOperatorId: (id: string) => Promise<void>;
  loadOperatorId: () => Promise<void>;
}

export const useOperatorStore = create<OperatorStore>((set) => ({
  operatorId: '',
  setOperatorId: async (id: string) => {
    set({ operatorId: id });
    await setSetting('drone_operator_id', id);
  },
  loadOperatorId: async () => {
    const saved = await getSetting('drone_operator_id');
    if (saved) set({ operatorId: saved });
  },
}));
