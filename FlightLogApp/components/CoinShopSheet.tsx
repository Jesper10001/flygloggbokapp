import { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, Pressable, Image, ActivityIndicator, Alert, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { canUseLiquidGlass } from '../utils/liquidGlass';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { useCoinShopStore } from '../store/coinShopStore';
import { useTokenQuotaStore } from '../store/tokenQuotaStore';
import { useFlightStore } from '../store/flightStore';
import { tokensToCoins } from '../utils/tokenGate';
import { COIN_PACKS, COIN_PACKS_ENABLED, type CoinPack } from '../services/coinPacks';
import { getCoinPackages, purchaseCoinPackage, presentPaywall } from '../services/purchases';

// Köpbladet för fler Blade coins. Bara Premium kan köpa; en gratisanvändare får se Premium i stället.
// Efter köpet väntar bladet in coinsen från proxyn (RevenueCat-webhooken krediterar dem) och kör sedan
// onDone — t.ex. fortsätter skanningen där den stannade.

const COIN_IMG = require('../assets/Blade_coin.PNG');

type Phase = { kind: 'idle' } | { kind: 'buying'; productId: string } | { kind: 'waiting'; coins: number } | { kind: 'done'; coins: number } | { kind: 'pending' } | { kind: 'error'; text: string };

function SheetGlass() {
  if (canUseLiquidGlass()) {
    const { GlassView } = require('expo-glass-effect');
    return <GlassView pointerEvents="none" glassEffectStyle="regular" colorScheme="dark" tintColor="rgba(10,22,40,0.45)" style={StyleSheet.absoluteFill} />;
  }
  return (
    <>
      <BlurView pointerEvents="none" tint="systemThickMaterialDark" intensity={80} style={StyleSheet.absoluteFill} />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(12,26,48,0.5)' }]} />
    </>
  );
}

export function CoinShopHost() {
  const { visible, reason, note, onDone, close } = useCoinShopStore();
  const isPremium = useFlightStore((s) => s.isPremium || s.isMax);
  const usage = useTokenQuotaStore((s) => s.usage);
  const insets = useSafeAreaInsets();
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [selected, setSelected] = useState('blades_coins_250');

  useEffect(() => {
    if (!visible) return;
    setPhase({ kind: 'idle' });
    setSelected('blades_coins_250');
    useTokenQuotaStore.getState().load().catch(() => {});
    getCoinPackages().then((list) => setPrices(Object.fromEntries(list.map((p) => [p.productId, p.priceString])))).catch(() => {});
  }, [visible]);

  const monthlyLeft = usage ? tokensToCoins(Math.max(0, usage.limit - usage.used)) : null;
  const extra = usage ? tokensToCoins(usage.credits) : 0;

  // Väntar in köpta coins från proxyn (webhooken brukar komma inom några sekunder).
  const waitForCredits = async (before: number, coins: number): Promise<boolean> => {
    const target = before + coins * 200 * 0.9;
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      await useTokenQuotaStore.getState().load().catch(() => {});
      if ((useTokenQuotaStore.getState().usage?.credits ?? 0) >= target) return true;
    }
    return false;
  };

  const buy = async (pack: CoinPack) => {
    if (!COIN_PACKS_ENABLED) {
      Alert.alert('Coming soon', 'Coin packs open with the next app update.');
      return;
    }
    setPhase({ kind: 'buying', productId: pack.productId });
    const pkg = (await getCoinPackages()).find((p) => p.productId === pack.productId)?.pkg;
    if (!pkg) { setPhase({ kind: 'error', text: 'The App Store couldn’t be reached. Try again in a moment.' }); return; }
    const before = useTokenQuotaStore.getState().usage?.credits ?? 0;
    const outcome = await purchaseCoinPackage(pkg);
    if (outcome === 'cancelled') { setPhase({ kind: 'idle' }); return; }
    if (outcome !== 'success') { setPhase({ kind: 'error', text: 'The purchase didn’t go through. You haven’t been charged.' }); return; }
    setPhase({ kind: 'waiting', coins: pack.coins });
    if (await waitForCredits(before, pack.coins)) {
      setPhase({ kind: 'done', coins: pack.coins });
      setTimeout(() => { const cb = onDone; close(); cb?.(); }, 1200);
    } else {
      setPhase({ kind: 'pending' });
    }
  };

  const title = reason === 'scan' ? 'Out of coins mid-scan' : reason === 'out' ? 'You’re out of Blade coins' : 'Get more Blade coins';
  const busy = phase.kind === 'buying' || phase.kind === 'waiting';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => !busy && close()}>
      <Pressable style={s.backdrop} onPress={() => !busy && close()}>
        <Pressable style={[s.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
          <SheetGlass />
          <View style={s.grabber} />
          <View style={s.head}>
            <Image source={COIN_IMG} style={{ width: 40, height: 40 }} resizeMode="contain" />
            <View style={{ flex: 1 }}>
              <Text style={s.title}>{title}</Text>
              {monthlyLeft != null && (
                <Text style={s.balance}>
                  {monthlyLeft} left this month{extra > 0 ? ` · ${extra} extra` : ''}
                </Text>
              )}
            </View>
            {!busy && (
              <TouchableOpacity onPress={close} hitSlop={10} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={Colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
          {note ? <Text style={s.note}>{note}</Text> : null}

          {!isPremium ? (
            <View style={{ gap: 12 }}>
              <Text style={s.body}>Extra coin packs are part of Blades Premium. Premium also refills 250 coins every month.</Text>
              <TouchableOpacity style={s.primary} onPress={() => { close(); presentPaywall('Blade coins'); }}>
                <Text style={s.primaryText}>See Premium</Text>
              </TouchableOpacity>
            </View>
          ) : phase.kind === 'waiting' || phase.kind === 'done' ? (
            <View style={s.status}>
              {phase.kind === 'waiting'
                ? <ActivityIndicator color={Colors.textSecondary} />
                : <Ionicons name="checkmark-circle" size={30} color={Colors.success} />}
              <Text style={s.statusText}>{phase.kind === 'waiting' ? `Adding ${phase.coins} coins…` : `${phase.coins} coins added`}</Text>
            </View>
          ) : phase.kind === 'pending' ? (
            <View style={{ gap: 12 }}>
              <Text style={s.body}>Your purchase went through. The coins are on their way and will show up in a moment.</Text>
              <TouchableOpacity style={s.primary} onPress={close}><Text style={s.primaryText}>OK</Text></TouchableOpacity>
            </View>
          ) : (
            <View style={{ gap: 14 }}>
              {/* Välj ett paket … */}
              <View style={s.list}>
                {COIN_PACKS.map((pack, i) => {
                  const on = selected === pack.productId;
                  return (
                    <TouchableOpacity key={pack.productId} style={[s.option, i > 0 && s.optionLine, on && s.optionOn]} disabled={busy}
                      onPress={() => setSelected(pack.productId)} activeOpacity={0.8}
                      accessibilityRole="radio" accessibilityState={{ selected: on }}
                      accessibilityLabel={`${pack.coins} coins, ${prices[pack.productId] ?? pack.fallbackPrice}`}>
                      <View style={[s.radio, on && s.radioOn]}>{on && <View style={s.radioDot} />}</View>
                      <Text style={s.optionCoins}>{pack.coins} coins</Text>
                      {pack.badge ? <Text style={s.optionBadge}>{pack.badge}</Text> : null}
                      <View style={{ flex: 1 }} />
                      <Text style={[s.optionPrice, on && s.optionPriceOn]}>{prices[pack.productId] ?? pack.fallbackPrice}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              {/* … och köp det */}
              {(() => {
                const pack = COIN_PACKS.find((p) => p.productId === selected) ?? COIN_PACKS[1];
                return (
                  <TouchableOpacity style={s.buy} disabled={busy} onPress={() => buy(pack)} activeOpacity={0.85}>
                    {phase.kind === 'buying'
                      ? <ActivityIndicator color={Colors.textInverse} />
                      : <Text style={s.buyText}>Buy {pack.coins} coins · {prices[pack.productId] ?? pack.fallbackPrice}</Text>}
                  </TouchableOpacity>
                );
              })()}
              {phase.kind === 'error' && <Text style={s.error}>{phase.text}</Text>}
              <Text style={s.foot}>Extra coins never expire and are used after your monthly coins.</Text>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 8, gap: 14, overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)',
  },
  grabber: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.18)', marginBottom: 4 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { color: Colors.textPrimary, fontSize: 18, fontWeight: '800' },
  balance: { color: Colors.textSecondary, fontSize: 13, marginTop: 2 },
  note: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20 },
  body: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20 },
  list: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)', backgroundColor: 'rgba(255,255,255,0.04)', overflow: 'hidden' },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, height: 54 },
  optionLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.12)' },
  optionOn: { backgroundColor: 'rgba(255,255,255,0.06)' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.28)', alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: '#fff' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#fff' },
  optionCoins: { color: Colors.textPrimary, fontSize: 16, fontWeight: '600' },
  optionBadge: { color: Colors.textMuted, fontSize: 12, fontWeight: '600' },
  optionPrice: { color: Colors.textSecondary, fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
  optionPriceOn: { color: Colors.textPrimary },
  buy: { height: 52, borderRadius: 14, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  buyText: { color: Colors.textInverse, fontSize: 16, fontWeight: '800' },
  primary: { height: 50, borderRadius: 13, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: Colors.textInverse, fontSize: 16, fontWeight: '800' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 18, justifyContent: 'center' },
  statusText: { color: Colors.textPrimary, fontSize: 16, fontWeight: '700' },
  error: { color: Colors.dangerLight, fontSize: 13, lineHeight: 18 },
  foot: { color: Colors.textMuted, fontSize: 12, lineHeight: 17 },
});
