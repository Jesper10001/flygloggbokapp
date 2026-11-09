// Onboardingens betalvägg (designen "Onboarding redesign", steg 6). En egen skärm i stället för RevenueCats färdiga
// paywall, så att rubriken och ordningen på funktionerna kan följa svaren i onboardingen. Priserna och provperioden
// kommer från App Store via RevenueCat (getOnboardingPlans); utan provperiod (finns inte i App Store Connect, eller
// redan använd) visas samma sida med vanligt pris. Under provveckan har man Premiums funktioner men bara
// gratispottens 100 coins; månadens coins kommer när den betalda perioden börjar.

import { useState } from 'react';
import { View, Text, Pressable, ScrollView, ActivityIndicator, Linking, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { purchasePackage, restorePurchases, type PlanOption } from '../../services/purchases';
import { useFlightStore } from '../../store/flightStore';
import { SCAN_COINS_PER_SPREAD } from '../../utils/tokenGate';

const CYAN = '#00C8E8';
const GOLD = '#FFB830';
const INK = '#06101E';
const SUB = '#8FB0CC';
const MUTED = '#6E8FB0';
const MONO = 'JetBrainsMono';
const SERIF = 'Fraunces';
// Coins i månaden per plan, och gratispotten som provveckan har (utils/tokenGate: 1 coin = 200 tokens).
const PLAN_COINS = { premium: 250, max: 500 };
const FREE_COINS = 100;

export type PaywallResult = { tier: 'premium' | 'max'; trialDays: number } | null;

type Feature = { key: string; icon: 'scan' | 'eta' | 'inf' | 'map'; title: string; sub: string };

export function OnboardingPaywall({ plans, pilot, lic, paper, title, sub, onDone }: {
  plans: PlanOption[];
  pilot: boolean;
  lic: string;       // målets licens, t.ex. "CPL(H)", eller tom
  paper: boolean;    // har en pappersloggbok
  title: string;
  sub: string;
  onDone: (r: PaywallResult) => void;
}) {
  const insets = useSafeAreaInsets();
  const premium = plans.find((p) => p.tier === 'premium') ?? null;
  const max = plans.find((p) => p.tier === 'max') ?? null;
  const [sel, setSel] = useState<'premium' | 'max'>(premium ? 'premium' : 'max');
  const [busy, setBusy] = useState<'buy' | 'restore' | null>(null);
  const [note, setNote] = useState('');

  const plan = (sel === 'max' ? max : premium) ?? premium ?? max!;
  const planName = plan.tier === 'max' ? 'Blades Max' : 'Premium';
  const coins = PLAN_COINS[plan.tier];
  const spreads = Math.floor(coins / SCAN_COINS_PER_SPREAD);
  const trial = plan.trialDays > 0;
  const trialName = plan.trialDays === 7 ? 'trial week' : `${plan.trialDays}-day trial`;
  const price = plan.priceString;

  // Funktionerna i den ordning som passar svaren: pappersboken först för den som har en.
  const scan: Feature = { key: 'scan', icon: 'scan', title: pilot ? 'Scan your paper logbook' : 'Scan your flight screens',
    sub: pilot ? (trial ? `About ${spreads} spreads a month after the trial` : `${coins} coins a month, about ${spreads} spreads`)
      : (trial ? `${coins} coins a month after the trial` : `${coins} coins a month for AI scans`) };
  const eta: Feature = { key: 'eta', icon: 'eta', title: `Your ${lic} date`, sub: 'Next licence and projections' };
  const inf: Feature = { key: 'inf', icon: 'inf', title: 'Unlimited flights', sub: 'Free covers 20 flights logged by hand' };
  const map: Feature = { key: 'map', icon: 'map', title: 'Best week and Longest XC', sub: 'Your biggest flying, replayed on the map' };
  const feats: Feature[] = [];
  if (paper) feats.push(scan);
  if (lic) feats.push(eta);
  feats.push(inf);
  if (!paper) feats.push(scan);
  if (pilot) feats.push(map);

  const pick = (t: 'premium' | 'max') => { Haptics.selectionAsync().catch(() => {}); setSel(t); setNote(''); };

  const buy = async () => {
    if (busy) return;
    setBusy('buy'); setNote('');
    const r = await purchasePackage(plan.pkg);
    setBusy(null);
    if (r === 'success') onDone({ tier: plan.tier, trialDays: plan.trialDays });
    else if (r === 'unavailable') setNote('Purchases are not available right now. You can start with Free.');
    else if (r === 'error') setNote('The purchase did not go through. Try again.');
  };
  const restore = async () => {
    if (busy) return;
    setBusy('restore'); setNote('');
    const r = await restorePurchases();
    setBusy(null);
    if (r === 'success') onDone({ tier: useFlightStore.getState().isMax ? 'max' : 'premium', trialDays: 0 });
    else setNote(r === 'nothing' ? 'No purchases to restore on this Apple ID.' : 'Could not restore right now. Try again.');
  };

  return (
    <View style={{ flex: 1, paddingTop: insets.top + 6 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 22 }}>
        <Pressable onPress={() => onDone(null)} style={s.close} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close, continue with Free">
          <Ionicons name="close" size={18} color="#CFE0EE" />
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 22, paddingBottom: 18 }} showsVerticalScrollIndicator={false}>
        <Text style={[s.eyebrow, { color: GOLD }]}>BLADES PREMIUM</Text>
        <Text style={s.title}>{title}</Text>
        <Text style={s.sub}>{sub}</Text>

        <View style={{ gap: 12, marginTop: 18 }}>
          {feats.slice(0, 4).map((f) => (
            <View key={f.key} style={s.feat}>
              <View style={s.ficon}>
                {f.icon === 'scan' ? <MaterialCommunityIcons name="line-scan" size={19} color={CYAN} />
                  : f.icon === 'eta' ? <Ionicons name="trending-up" size={19} color={CYAN} />
                  : f.icon === 'inf' ? <Ionicons name="infinite" size={21} color={CYAN} />
                  : <MaterialCommunityIcons name="map-marker-path" size={19} color={CYAN} />}
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={s.ft}>{f.title}</Text>
                <Text style={s.fs}>{f.sub}</Text>
              </View>
            </View>
          ))}
        </View>

        {trial ? (
          <View style={{ marginTop: 20 }}>
            <View style={s.tlLine} />
            <View style={{ flexDirection: 'row' }}>
              {[['TODAY', `Premium features, ${FREE_COINS} coins`, true], [`DAY ${plan.trialDays}`, `${price} a month, ${coins} coins`, false], ['ANY TIME', 'Cancel in iOS Settings', false]].map(([l, t, on]) => (
                <View key={String(l)} style={{ flex: 1, gap: 4, paddingRight: 6 }}>
                  <View style={[s.tlDot, on ? s.tlDotOn : null]} />
                  <Text style={[s.lbl, { color: '#CFE0EE' }]}>{l}</Text>
                  <Text style={s.tlt}>{t}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 22 }}>
          {premium ? (
            <Pressable onPress={() => pick('premium')} style={[s.plan, sel === 'premium' && s.planOn]}
              accessibilityRole="button" accessibilityState={{ selected: sel === 'premium' }}
              accessibilityLabel={`Premium, ${premium.priceString} a month, ${PLAN_COINS.premium} coins a month`}>
              <Text style={[s.lbl, { color: '#CFE0EE' }]}>PREMIUM</Text>
              <Text style={s.pp}>{premium.priceString}<Text style={s.pper}> /month</Text></Text>
              <Text style={s.fs}>{PLAN_COINS.premium} coins a month</Text>
            </Pressable>
          ) : null}
          {max ? (
            <Pressable onPress={() => pick('max')} style={[s.plan, sel === 'max' && s.planOn]}
              accessibilityRole="button" accessibilityState={{ selected: sel === 'max' }}
              accessibilityLabel={`Blades Max, ${max.priceString} a month, ${PLAN_COINS.max} coins a month`}>
              <View style={s.ptag}><Text style={s.ptagText}>DOUBLE USAGE</Text></View>
              <Text style={[s.lbl, { color: '#CFE0EE' }]}>BLADES MAX</Text>
              <Text style={s.pp}>{max.priceString}<Text style={s.pper}> /month</Text></Text>
              <Text style={s.fs}>{PLAN_COINS.max} coins a month</Text>
            </Pressable>
          ) : null}
        </View>
      </ScrollView>

      <View style={{ paddingHorizontal: 22, paddingTop: 8, paddingBottom: insets.bottom + 6 }}>
        <Pressable onPress={buy} disabled={!!busy} style={({ pressed }) => [s.cta, pressed && { transform: [{ scale: 0.985 }] }]}
          accessibilityRole="button" accessibilityLabel={trial ? `Start my ${trialName}, then ${price} a month` : `Get ${planName}, ${price} a month`}>
          {busy === 'buy' ? <ActivityIndicator color={INK} />
            : <Text style={s.ctaText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
              {trial ? `Start my ${trialName}, then ${price}/month` : `Get ${planName} · ${price}/month`}
            </Text>}
        </Pressable>
        {note ? <Text style={s.note}>{note}</Text> : null}
        <Pressable onPress={() => onDone(null)} style={s.ghost} accessibilityRole="button">
          <Text style={s.ghostText}>Not now, continue with Free</Text>
        </Pressable>
        {/* Priset, provveckan och coinsen står redan på skärmen; Apple kräver att det också framgår att den förnyas. */}
        <Text style={s.fine}>Renews monthly until you cancel.</Text>
        <View style={s.links}>
          <Pressable onPress={restore} hitSlop={6} disabled={!!busy} accessibilityRole="button">
            {busy === 'restore' ? <ActivityIndicator size="small" color={SUB} /> : <Text style={s.link}>Restore</Text>}
          </Pressable>
          <Pressable onPress={() => Linking.openURL('https://blades-app.com/terms')} hitSlop={6} accessibilityRole="link">
            <Text style={s.link}>Terms</Text>
          </Pressable>
          <Pressable onPress={() => Linking.openURL('https://blades-app.com/privacy')} hitSlop={6} accessibilityRole="link">
            <Text style={s.link}>Privacy</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  close: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(127,168,200,0.2)', backgroundColor: 'rgba(15,30,58,0.6)', alignItems: 'center', justifyContent: 'center' },
  eyebrow: { fontFamily: MONO, fontSize: 10.5, fontWeight: '700', letterSpacing: 1.9, marginTop: 4 },
  title: { fontFamily: SERIF, fontSize: 28, fontWeight: '600', lineHeight: 31, color: '#FFFFFF', marginTop: 8 },
  sub: { fontSize: 14.5, lineHeight: 21, color: SUB, marginTop: 8 },
  feat: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  ficon: { width: 38, height: 38, borderRadius: 11, backgroundColor: 'rgba(0,200,232,0.10)', borderWidth: 1, borderColor: 'rgba(0,200,232,0.22)', alignItems: 'center', justifyContent: 'center' },
  ft: { fontSize: 15.5, fontWeight: '600', color: '#FFFFFF' },
  fs: { fontSize: 12.5, lineHeight: 17, color: SUB },
  lbl: { fontFamily: MONO, fontSize: 9.5, fontWeight: '600', letterSpacing: 1.6, color: MUTED },
  tlLine: { position: 'absolute', left: 6, right: 6, top: 5, height: 2, borderRadius: 1, backgroundColor: 'rgba(0,200,232,0.45)' },
  tlDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#0A1628', borderWidth: 2, borderColor: 'rgba(127,168,200,0.5)', marginBottom: 4 },
  tlDotOn: { backgroundColor: CYAN, borderColor: CYAN, shadowColor: CYAN, shadowOpacity: 0.8, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
  tlt: { fontSize: 12.5, lineHeight: 16, color: '#CFE0EE' },
  plan: { flex: 1, gap: 3, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: 'rgba(127,168,200,0.22)', backgroundColor: 'rgba(15,30,58,0.55)' },
  planOn: { borderWidth: 2, borderColor: CYAN, backgroundColor: 'rgba(0,200,232,0.08)', paddingVertical: 11, paddingHorizontal: 13 },
  pp: { fontFamily: SERIF, fontSize: 22, fontWeight: '600', color: '#FFFFFF' },
  pper: { fontFamily: undefined, fontSize: 12.5, fontWeight: '400', color: SUB },
  ptag: { position: 'absolute', top: -10, right: 10, backgroundColor: GOLD, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  ptagText: { fontFamily: MONO, fontSize: 9, fontWeight: '800', letterSpacing: 1.1, color: INK },
  cta: { height: 54, borderRadius: 16, backgroundColor: CYAN, alignItems: 'center', justifyContent: 'center', shadowColor: CYAN, shadowOpacity: 0.25, shadowRadius: 14, shadowOffset: { width: 0, height: 8 } },
  ctaText: { fontSize: 16.5, fontWeight: '700', color: INK, paddingHorizontal: 16 },
  note: { fontSize: 12.5, color: '#FFB4A8', textAlign: 'center', marginTop: 8 },
  ghost: { height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  ghostText: { fontSize: 14.5, fontWeight: '600', color: SUB },
  fine: { fontSize: 11, lineHeight: 15, color: MUTED, textAlign: 'center' },
  links: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 22, marginTop: 8, minHeight: 24 },
  link: { fontSize: 11.5, fontWeight: '600', color: SUB, textDecorationLine: 'underline' },
});
