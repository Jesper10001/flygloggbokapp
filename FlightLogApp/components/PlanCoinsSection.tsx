// Abonnemang och Blade coins. SubscriptionPanel ligger på profilsidan (app/settings/profile.tsx).
// UpgradeCard direkt under Profile i Settings: alltid nästa nivå uppåt (gratis → Premium, Premium → Max).
// CoinsCard under den i Settings, likadant i pilot- och drönarläget (färgerna kommer från sidan): en lugn rad med
// myntet i en ring. Månadens (guld) ligger först och går åt först; köpta (sidans accent) ligger efter och används
// när månadens är slut, som proxyn drar dem (proxy/src/credits.ts splitCharge). Tryck på raden = detaljerna.
import { useState } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet, Alert, LayoutAnimation } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
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
const TRACK = '#1A2D45';
const WARN = '#FFB830';
const GOLD = '#FFB830';

// Paywall-knappen under Profile. Gratis: Premium (paywallen visar även Max i TestFlight). Premium: Max, bara med
// de nya paywallsen. Max: ingen knapp, det finns inget högre.
export function UpgradeCard({ T }: { T: PlanTheme }) {
  const { isPremium, isMax } = useFlightStore();
  if (isMax || (isPremium && !NEW_PAYWALLS)) return null;
  const toMax = isPremium;
  return (
    <TouchableOpacity style={[st.card, st.upgrade]} activeOpacity={0.7} accessibilityRole="button"
      accessibilityLabel={toMax ? 'Upgrade to Max, 500 coins a month' : 'Upgrade to Premium, unlimited flights'}
      onPress={() => { if (toMax) presentPaywall('Blades Max', { upgrade: true }); else presentPaywall(); }}>
      <Text style={[st.label, { color: GOLD }]}>{toMax ? 'Upgrade to Max' : 'Upgrade to Premium'}</Text>
      <Text style={[st.upgradeHint, { color: T.label }]} numberOfLines={1}>{toMax ? '500 coins a month' : 'Unlimited flights'}</Text>
      <Ionicons name="chevron-forward" size={16} color={GOLD} />
    </TouchableOpacity>
  );
}

// Abonnemanget på profilsidan: nivå, vad den ger, och hantering. Gratisnivån får paywallen och Restore.
// closeFirst: profilsidan är en modal, och RevenueCats fönster syns inte ovanpå en modal → stäng den först.
export function SubscriptionPanel({ closeFirst }: { closeFirst?: () => Promise<void> } = {}) {
  const { isPremium, isMax } = useFlightStore();
  const [restoring, setRestoring] = useState(false);
  const paid = isPremium || isMax;
  const plan = isMax ? 'Blades Max' : isPremium ? 'Blades Premium' : 'Free';
  const perks = isMax ? '500 Blade coins a month · Unlimited flights'
    : isPremium ? '250 Blade coins a month · Unlimited flights'
    : `${FREE_TIER_LIMIT} manual flights · 100 Blade coins once`;
  const showMax = NEW_PAYWALLS && isPremium && !isMax;
  const run = async (open: () => unknown) => { if (closeFirst) await closeFirst(); open(); };
  const manage = () => run(() => presentManageSubscription().then((ok) => { if (!ok) router.push('/settings/premium'); }));
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
          {showMax && <PanelRow label="Upgrade to Max" value="500 coins a month" onPress={() => run(() => presentPaywall('Blades Max', { upgrade: true }))} />}
        </>
      ) : (
        <>
          <TouchableOpacity style={st.cta} activeOpacity={0.85} onPress={() => run(() => presentPaywall())} accessibilityRole="button">
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

const RING = 56, RING_R = 26.5, RING_C = 2 * Math.PI * RING_R;

export function CoinsCard({ T, onInfo }: { T: PlanTheme; onInfo: () => void }) {
  const usage = useTokenQuotaStore((s) => s.usage);
  const { isPremium, isMax } = useFlightStore();
  const [open, setOpen] = useState(false);
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
  // Ringen: månadens båge från toppen medurs, köpta direkt efter med ett litet glapp.
  const mLen = (monthLeft / scale) * RING_C;
  const gap = monthLeft > 0 && extra > 0 ? 6 : 0;
  const bLen = Math.max(0, (extra / scale) * RING_C - gap);
  const subline = isFree ? 'one-time' : low ? 'running low' : `refills ${refill}`;
  const toggle = () => { LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); setOpen((o) => !o); };
  return (
    <View style={[st.card, { backgroundColor: T.card, borderColor: low ? WARN + '73' : T.border }]}>
      <View style={st.coinRow}>
        <TouchableOpacity style={st.coinMain} onPress={toggle} activeOpacity={0.7} accessibilityRole="button"
          accessibilityState={{ expanded: open }} accessibilityLabel={`Blade coins, ${total} left`}>
          <View style={st.ring}>
            <Image source={COIN} style={st.ringCoin} resizeMode="contain" />
            <Svg width={RING} height={RING} style={StyleSheet.absoluteFill}>
              <G rotation={-90} origin={`${RING / 2}, ${RING / 2}`}>
                <Circle cx={RING / 2} cy={RING / 2} r={RING_R} fill="none" stroke={TRACK} strokeWidth={3} />
                {monthLeft > 0 && (
                  <Circle cx={RING / 2} cy={RING / 2} r={RING_R} fill="none" stroke={GOLD} strokeWidth={3} strokeLinecap="round"
                    strokeDasharray={`${mLen} ${RING_C}`} />
                )}
                {bLen > 0 && (
                  <Circle cx={RING / 2} cy={RING / 2} r={RING_R} fill="none" stroke={T.accent} strokeWidth={3} strokeLinecap="round"
                    strokeDasharray={`${bLen} ${RING_C}`} strokeDashoffset={-(mLen + gap)} />
                )}
              </G>
            </Svg>
          </View>
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            <Text style={[st.label, { color: T.label, flex: 0 }]}>Blade coins</Text>
            <Text style={[st.coinLine, { color: T.text }]} numberOfLines={1}>
              <Text style={{ color: total <= 0 ? T.label : low ? WARN : T.text, fontVariant: ['tabular-nums'] }}>{total.toLocaleString('en-US')}</Text>
              {' left'}
              <Text style={{ color: T.label, fontWeight: '400' }}>{` · ${subline}`}</Text>
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={T.accent} style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }} />
        </TouchableOpacity>
        {canBuy && (
          <TouchableOpacity style={[st.buyBtn, { borderColor: T.accent + '73', backgroundColor: T.accent + '1A' }]}
            onPress={() => openCoinShop({ reason: 'browse' })} activeOpacity={0.7} accessibilityLabel="Buy more Blade coins">
            <Ionicons name="add" size={20} color={T.accent} />
          </TouchableOpacity>
        )}
      </View>

      {open && (
        <View style={[st.detail, { borderTopColor: T.border }]}>
          <View>
            <View style={st.detailRow}>
              <View style={[st.dot, { backgroundColor: GOLD }]} />
              <Text style={[st.detailName, { color: T.text }]}>{isFree ? 'Free coins' : 'Monthly'}</Text>
              <Text style={[st.detailVal, { color: T.text }]}>
                {monthLeft.toLocaleString('en-US')}<Text style={{ color: T.label, fontWeight: '400' }}>{` of ${limit.toLocaleString('en-US')}`}</Text>
              </Text>
            </View>
            <Text style={[st.detailFoot, { color: T.label }]}>
              {isFree ? 'One-time. Premium gives 250 a month.' : `Used first. Refills ${refill}.`}
            </Text>
          </View>
          {!isFree && (
            <View>
              <View style={st.detailRow}>
                <View style={[st.dot, { backgroundColor: T.accent }]} />
                <Text style={[st.detailName, { color: T.text }]}>Bought</Text>
                <Text style={[st.detailVal, { color: T.text }]}>{extra.toLocaleString('en-US')}</Text>
              </View>
              <Text style={[st.detailFoot, { color: T.label }]}>Used when monthly coins run out</Text>
            </View>
          )}
          <View style={st.detailBtns}>
            {canBuy && (
              <TouchableOpacity style={[st.detailBtn, { backgroundColor: T.accent, borderColor: T.accent }]} activeOpacity={0.8}
                onPress={() => openCoinShop({ reason: 'browse' })} accessibilityRole="button">
                <Text style={[st.detailBtnText, { color: Colors.textInverse, fontWeight: '800' }]}>Buy coins</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[st.detailBtn, { borderColor: T.border }]} activeOpacity={0.7} onPress={onInfo} accessibilityRole="button">
              <Text style={[st.detailBtnText, { color: T.text }]}>How coins work</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  label: { flex: 1, fontSize: 11, fontWeight: '700', letterSpacing: 2.2, textTransform: 'uppercase' },
  upgrade: {
    height: 52, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(255,184,48,0.07)', borderColor: 'rgba(255,184,48,0.32)',
  },
  upgradeHint: { fontSize: 13 },
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
  coinRow: { flexDirection: 'row', alignItems: 'center' },
  coinMain: { flex: 1, minWidth: 0, height: 76, flexDirection: 'row', alignItems: 'center', gap: 13, paddingLeft: 12, paddingRight: 8 },
  ring: { width: RING, height: RING },
  // Myntet fyller nästan hela bilden → 50 pt inuti en 56 pt-ring ger ringen tätt intill kanten.
  ringCoin: { position: 'absolute', left: 3.5, top: 3.5, width: 50, height: 50 },
  coinLine: { fontSize: 15, fontWeight: '600' },
  buyBtn: { width: 44, height: 44, marginRight: 12, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  detail: { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14, gap: 10 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  detailName: { flex: 1, fontSize: 14 },
  detailVal: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  detailFoot: { fontSize: 12, marginTop: 3, marginLeft: 18 },
  detailBtns: { flexDirection: 'row', gap: 8, marginTop: 4 },
  detailBtn: { flex: 1, height: 44, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  detailBtnText: { fontSize: 15, fontWeight: '600' },
});
