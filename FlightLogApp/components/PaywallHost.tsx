// Renderar fallback-paywallen (egen PremiumModal) i app-roten, styrd av usePaywallStore. Visas bara
// när RevenueCats egen paywall inte kunde presenteras (se services/purchases.ts → presentPaywall).
import { PremiumModal } from './PremiumModal';
import { usePaywallStore } from '../store/paywallStore';

export function PaywallHost() {
  const { visible, feature, close } = usePaywallStore();
  return <PremiumModal visible={visible} onClose={close} feature={feature} />;
}
