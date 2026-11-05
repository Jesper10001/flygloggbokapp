// Abonnemang och Blade coins. SubscriptionPanel ligger på profilsidan (app/settings/profile.tsx).
// CoinsCard överst i Settings, likadant i pilot- och drönarläget (färgerna kommer från sidan): EN mätare för månadens och köpta coins. Månadens ligger först och går åt först; köpta (vita) ligger
// efter och används när månadens är slut, som proxyn drar dem (proxy/src/credits.ts splitCharge).
import { useState } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useFlightStore } from '../store/flightStore';
import { useTokenQuotaStore } from '../store/tokenQuotaStore';
import { presentPaywall, presentManageSubscription, restorePurchases } from '../services/purchases';
import { useToastStore } from './Toast';
import { Colors } from '../constants/colors';
import { FREE_TIER_LIMIT } from '../constants/easa';
import { coinShopAvailable } from '../services/coinPacks';
import { tokensToCoins, openCoinShop } from '../utils/tokenGate';
import { NEW_PAYWALLS } from '../constants/paywalls';

export interface PlanTheme {
  card: string;   // kortets bakgrund (som Profile)
  border: string;
  text: string;   // värden
  label: string;  // versaletiketter och bildtext
  accent: string; // chevroner, månadens coins
}

const COIN = require('../assets/Blade_coin.PNG');
const EXTRA = 'rgba(255,255,255,0.86)';
const TRACK = '#1A2D45';
const WARN = '#FFB830';

// Abonnemanget på profilsidan: nivå, vad den ger, och hantering. Gratisnivån får paywallen och Restore.
export function SubscriptionPanel() {
  const { isPremium, isMax } = useFlightStore();
  const [restoring, setRestoring] = useState(false);
  const paid = isPremium || isMax;
  const plan = isMax ? 'Blades Max' : isPremium ? 'Blades Premium' : 'Free';
  const perks = isMax ? '500 Blade coins a month · Unlimited flights'
    : isPremium ? '250 Blade coins a month · Unlimited flights'
    : `${FREE_TIER_LIMIT} manual flights · 100 Blade coins once`;
  const showMax = NEW_PAYWALLS && isPremium && !isMax;
  const manage = () => { presentManageSubscription().then((ok) => { if (!ok) router.push('/settings/premium'); }); };
  const restore = async () => {
    if (restoring) return;
    setRestoring(true);
    const r = await restorePurchases();
    setRestoring(false);
    if (r === 'success') useToastStore.getState().show('Purchases restored');
    else if (r === 'nothing') useToastStore.getState().show('No previous purchase found');
    else if (r === 'unavailable') useToastStore.getState().show('Purchases not available yet');
    else if (r === 'error') Alert.alert('Restore failed', 'Could not restore your purchases. Please try again.');
  };
  return (
    <View style={[st.card, { backgroundColor: Colors.card, borderColor: Colors.cardBorder }]}>
      <View style={st.planHead}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={st.planName}>{plan}</Text>
          <Text style={st.perks}>{perks}</Text>
        </View>
        {paid && (
          <View style={st.chip}>
            <View style={[st.dot, { backgroundColor: Colors.success }]} />
            <Text style={st.chipText}>Active</Text>
          </View>
        )}
      </View>
      {paid ? (
        <>
          <PanelRow label="Manage subscription" onPress={manage} />
          {showMax && <PanelRow label="Upgrade to Blades Max" value="500 coins a month" onPress={() => { presentPaywall('Blades Max', { upgrade: true }); }} />}
        </>
      ) : (
        <>
          <TouchableOpacity style={st.cta} activeOpacity={0.85} onPress={() => { presentPaywall(); }} accessibilityRole="button">
            <Text style={st.ctaText}>{NEW_PAYWALLS ? 'See Premium and Max' : 'Get Blades Premium'}</Text>
          </TouchableOpacity>
          <PanelRow label={restoring ? 'Restoring…' : 'Restore purchases'} onPress={restore} />
        </>
      )}
    </View>
  );
}

function PanelRow({ label, value, onPress }: { label: string; value?: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={st.panelRow} activeOpacity={0.7} onPress={onPress} accessibilityRole="button">
      <Text style={st.panelLabel}>{label}</Text>
      {value ? <Text style={st.panelValue} numberOfLines={1}>{value}</Text> : null}
      <Ionicons name="chevron-forward" size={16} color={Colors.primary} />
    </TouchableOpacity>
  );
}

export function CoinsCard({ T, onInfo }: { T: PlanTheme; onInfo: () => void }) {
  const usage = useTokenQuotaStore((s) => s.usage);
  const { isPremium, isMax } = useFlightStore();
  if (!usage) return null;
  const limit = tokensToCoins(usage.limit);
  const monthLeft = Math.max(0, limit - tokensToCoins(usage.used));
  const extra = Math.max(0, tokensToCoins(usage.credits ?? 0)); // negativt = skuld efter återbetalning → 0
  const total = monthLeft + extra;
  const scale = Math.max(1, limit + extra);
  const isFree = usage.month === 'lifetime';
  const low = total > 0 && total <= limit * 0.1;
  const canBuy = (isPremium || isMax) && coinShopAvailable();
  const now = new Date();
  const refill = new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return (
    <View style={[st.card, st.coins, { backgroundColor: T.card, borderColor: T.border }]}>
      <View style={st.top}>
        <Image source={COIN} style={{ width: 18, height: 18 }} resizeMode="contain" />
        <Text style={[st.label, { color: T.label, flex: 0 }]}>Blade coins</Text>
        <TouchableOpacity onPress={onInfo} hitSlop={8} activeOpacity={0.7} accessibilityLabel="About Blade coins">
          <Ionicons name="help-circle-outline" size={15} color={T.label} />
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <Text style={[st.count, { color: total <= 0 ? T.label : low ? WARN : T.text }]}>{total.toLocaleString('en-US')}</Text>
        {canBuy && (
          <TouchableOpacity onPress={() => openCoinShop({ reason: 'browse' })} activeOpacity={0.7} hitSlop={10}
            accessibilityLabel="Buy more Blade coins">
            <Ionicons name="add-circle-outline" size={18} color={T.label} />
          </TouchableOpacity>
        )}
      </View>

      {/* Fyllt = kvar. Månadens först (accent), köpta efter (vit), så det är månadens som krymper först. */}
      <View style={[st.track, { backgroundColor: TRACK }]}>
        {monthLeft > 0 && <View style={[st.seg, { width: `${(monthLeft / scale) * 100}%`, backgroundColor: T.accent }]} />}
        {extra > 0 && <View style={[st.seg, { width: `${(extra / scale) * 100}%`, backgroundColor: EXTRA, marginLeft: monthLeft > 0 ? 2 : 0 }]} />}
      </View>

      <View style={st.legend}>
        <View style={[st.dot, { backgroundColor: T.accent }]} />
        <Text style={[st.cap, { color: T.label }]}>{monthLeft.toLocaleString('en-US')} {isFree ? 'free' : 'this month'}</Text>
        {extra > 0 && (
          <>
            <View style={[st.dot, { backgroundColor: EXTRA, marginLeft: 12 }]} />
            <Text style={[st.cap, { color: T.label }]}>{extra.toLocaleString('en-US')} extra</Text>
          </>
        )}
        <View style={{ flex: 1 }} />
        <Text style={[st.cap, { color: T.label }]}>{isFree ? 'One-time' : `Refills ${refill}`}</Text>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  label: { flex: 1, fontSize: 11, fontWeight: '700', letterSpacing: 2.2, textTransform: 'uppercase' },
  planHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 14 },
  planName: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  perks: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
    backgroundColor: 'rgba(0,232,160,0.10)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,232,160,0.35)',
  },
  chipText: { fontSize: 12, fontWeight: '600', color: Colors.textPrimary },
  panelRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50, paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.cardBorder,
  },
  panelLabel: { flex: 1, fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  panelValue: { fontSize: 13, color: Colors.textSecondary },
  cta: {
    marginHorizontal: 16, marginBottom: 14, height: 48, borderRadius: 12, backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  ctaText: { fontSize: 15, fontWeight: '800', color: Colors.textInverse },
  coins: { paddingHorizontal: 18, paddingTop: 15, paddingBottom: 14, gap: 11 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  count: { fontFamily: 'Menlo', fontSize: 15, fontWeight: '700' },
  track: { height: 6, borderRadius: 3, flexDirection: 'row', overflow: 'hidden' },
  seg: { height: '100%', borderRadius: 3, minWidth: 3 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  cap: { fontSize: 12 },
});
