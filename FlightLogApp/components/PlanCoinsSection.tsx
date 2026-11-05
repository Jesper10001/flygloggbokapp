// Abonnemang och Blade coins överst i Settings, likadant i pilot- och drönarläget (färgerna kommer från sidan).
// SubscriptionCard: raden under Profile som öppnar hanteringen av abonnemanget, eller paywallen för gratisnivån.
// CoinsCard: EN mätare för månadens och köpta coins. Månadens ligger först och går åt först; köpta (vita) ligger
// efter och används när månadens är slut, som proxyn drar dem (proxy/src/credits.ts splitCharge).
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useFlightStore } from '../store/flightStore';
import { useTokenQuotaStore } from '../store/tokenQuotaStore';
import { presentPaywall, presentManageSubscription } from '../services/purchases';
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

export function SubscriptionCard({ T }: { T: PlanTheme }) {
  const { isPremium, isMax } = useFlightStore();
  const paid = isPremium || isMax;
  const plan = isMax ? 'Blades Max' : isPremium ? 'Blades Premium' : null;
  const showMax = NEW_PAYWALLS && isPremium && !isMax;
  const open = () => {
    if (paid) presentManageSubscription().then((ok) => { if (!ok) router.push('/settings/premium'); });
    else presentPaywall();
  };
  return (
    <View style={[st.card, { backgroundColor: T.card, borderColor: T.border }]}>
      <TouchableOpacity style={st.row} activeOpacity={0.7} onPress={open} accessibilityRole="button"
        accessibilityLabel={plan ? `Manage subscription, ${plan}` : 'Subscription, upgrade'}>
        <Text style={[st.label, { color: T.label }]}>Subscription</Text>
        <Text style={[st.value, { color: plan ? T.text : T.accent }]} numberOfLines={1}>{plan ?? 'Upgrade'}</Text>
        <Ionicons name="chevron-forward" size={16} color={T.accent} />
      </TouchableOpacity>
      {showMax && (
        <>
          <View style={[st.sep, { backgroundColor: T.border }]} />
          <TouchableOpacity style={[st.row, { height: 46 }]} activeOpacity={0.7} accessibilityRole="button"
            accessibilityLabel="Blades Max, 500 coins a month" onPress={() => { presentPaywall('Blades Max', { upgrade: true }); }}>
            <Text style={[st.label, { color: T.label }]}>Blades Max</Text>
            <Text style={[st.hint, { color: T.label }]} numberOfLines={1}>500 coins a month</Text>
            <Ionicons name="chevron-forward" size={16} color={T.accent} />
          </TouchableOpacity>
        </>
      )}
    </View>
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
  row: { height: 54, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 12 },
  sep: { height: 1, marginHorizontal: 18 },
  label: { flex: 1, fontSize: 11, fontWeight: '700', letterSpacing: 2.2, textTransform: 'uppercase' },
  value: { fontSize: 15, fontWeight: '600', textAlign: 'right' },
  hint: { fontSize: 13 },
  coins: { paddingHorizontal: 18, paddingTop: 15, paddingBottom: 14, gap: 11 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  count: { fontFamily: 'Menlo', fontSize: 15, fontWeight: '700' },
  track: { height: 6, borderRadius: 3, flexDirection: 'row', overflow: 'hidden' },
  seg: { height: '100%', borderRadius: 3, minWidth: 3 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  cap: { fontSize: 12 },
});
