// Global fallback-paywall. Visas när RevenueCats egen paywall (react-native-purchases-ui) inte är
// tillgänglig/konfigurerad (t.ex. innan native-rebuild eller utan RC-nyckel). presentPaywall() i
// services/purchases.ts öppnar den här som reserv, så premium-upsellen alltid funkar.
import { create } from 'zustand';

interface PaywallStore {
  visible: boolean;
  feature?: string;
  open: (feature?: string) => void;
  close: () => void;
}

export const usePaywallStore = create<PaywallStore>((set) => ({
  visible: false,
  feature: undefined,
  open: (feature) => set({ visible: true, feature }),
  close: () => set({ visible: false, feature: undefined }),
}));
