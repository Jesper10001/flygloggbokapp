import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  TextInput, Modal, Alert, ActivityIndicator, Image, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { PurchasesOffering, PurchasesPackage } from 'react-native-purchases';
import { useFlightStore } from '../../store/flightStore';
import { setSetting } from '../../db/flights';
import { redeemPromo } from '../../services/promo';
import { getPremiumOffering, purchasePackage, restorePurchases } from '../../services/purchases';
import { useToastStore } from '../../components/Toast';
import { FREE_TIER_LIMIT } from '../../constants/easa';

// ── Navy palette (premium screen is ALWAYS dark) ─────────────────────────
const N = {
  bg: '#0A1628',
  surface: '#0F1E3A',
  card: '#0F1E3A',
  cardBorder: '#1A3A5A',
  elevated: '#152338',
  line: '#1A3A5A',
  primary: '#00C8E8',
  gold: '#FFB830',
  goldSoft: 'rgba(255, 184, 48, 0.10)',
  goldEdge: 'rgba(255, 184, 48, 0.35)',
  text: '#FFFFFF',
  text2: '#B5C8D8',
  text3: '#7FA8C8',
  text4: '#5A7A9A',
  success: '#00E8A0',
};

const LOCKUP = require('../../assets/blades-lockup-h.png');
const LOCKUP_AR = 1495 / 334; // horisontell BLADES-lockup

// ── Blade-coin-symbol (guld) — samma bild som i Settings, i ikonstorlek. ──
function CoinIcon() {
  return (
    <Image source={require('../../assets/Gold_blade_coin.PNG')} style={{ width: 18, height: 18 }} resizeMode="contain" />
  );
}

// ── Förmånsrad med jämförelse-chips ──────────────────────────────────────
function BenefitRow({ icon, title, desc, chips, last }: {
  icon: React.ReactNode; title: string; desc: string;
  chips: { label: string; premium?: boolean }[]; last?: boolean;
}) {
  return (
    <View style={[s.feat, last && s.featLast]}>
      <View style={s.fi}>{icon}</View>
      <View style={s.fb}>
        <Text style={s.ft}>{title}</Text>
        <Text style={s.fd}>{desc}</Text>
        <View style={s.cmp}>
          {chips.map((c, i) => (
            <Text key={i} style={[s.chip, c.premium && s.chipGold]} numberOfLines={1}>{c.label}</Text>
          ))}
        </View>
      </View>
    </View>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────
export default function PremiumScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { setIsPremium, isPremium } = useFlightStore();
  const [purchasing, setPurchasing] = useState(false);
  const [promoOpen, setPromoOpen] = useState(false);
  const [promoCode, setPromoCode] = useState('');
  const [promoBusy, setPromoBusy] = useState(false);
  const [offering, setOffering] = useState<PurchasesOffering | null>(null);

  // Hämta aktuellt RevenueCat-offering för att visa riktigt (lokaliserat) pris. Null = ännu
  // inte konfigurerat (ingen nyckel/native-modul) → vi faller tillbaka på hårdkodad 39 kr-text.
  useEffect(() => { getPremiumOffering().then(setOffering).catch(() => {}); }, []);
  const pkg: PurchasesPackage | null = offering?.monthly ?? offering?.availablePackages?.[0] ?? null;
  const priceString = pkg?.product?.priceString ?? null;

  const handleSubscribe = async () => {
    if (purchasing) return;
    if (isPremium) { useToastStore.getState().show('Premium is already active'); return; }
    if (!pkg) {
      Alert.alert('Not available yet', 'In-app purchases aren’t available on this build yet. Please try again after the next update.');
      return;
    }
    setPurchasing(true);
    const outcome = await purchasePackage(pkg); // sätter premium i storen vid success
    setPurchasing(false);
    if (outcome === 'success') {
      useToastStore.getState().show('Welcome to Premium');
      router.back();
    } else if (outcome === 'cancelled') {
      /* användaren avbröt — tyst */
    } else if (outcome === 'unavailable') {
      Alert.alert('Not available yet', 'In-app purchases aren’t available on this build yet.');
    } else {
      Alert.alert('Purchase failed', 'Something went wrong and you have not been charged. Please try again.');
    }
  };

  const handleRestore = async () => {
    const outcome = await restorePurchases();
    if (outcome === 'success') {
      useToastStore.getState().show('Premium restored');
      router.back();
    } else if (outcome === 'nothing') {
      useToastStore.getState().show('No previous purchase found');
    } else if (outcome === 'unavailable') {
      useToastStore.getState().show('Purchases not available yet');
    } else if (outcome === 'error') {
      Alert.alert('Restore failed', 'Could not restore your purchases. Please try again.');
    }
    /* cancelled → tyst */
  };

  // Promo-kod → verifieras SERVER-SIDE (proxyn). Giltig → gratis Blades Premium (obegränsad tid);
  // en lokal flagga cachas för offline och laddas + verifieras vid appstart (app/_layout.tsx).
  const applyPromo = async () => {
    if (promoBusy) return;
    setPromoBusy(true);
    const ok = await redeemPromo(promoCode);
    setPromoBusy(false);
    if (!ok) { Alert.alert('Invalid code', 'That promo code is not valid.'); return; }
    await setSetting('promo_premium', '1').catch(() => {});
    setIsPremium(true);
    setPromoOpen(false);
    setPromoCode('');
    Alert.alert('Blades Premium unlocked', 'Your promo access is now active.', [{ text: 'OK', onPress: () => router.back() }]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: N.bg }}>
      {/* Top bar */}
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Image source={LOCKUP} style={{ height: 20, width: 20 * LOCKUP_AR }} resizeMode="contain" />
        <TouchableOpacity style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: N.elevated, alignItems: 'center', justifyContent: 'center' }} onPress={() => router.back()}>
          <Ionicons name="close" size={16} color={N.text2} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 18, paddingBottom: 28, gap: 22 }}>
        {/* Premium card */}
        <View style={s.card}>
          <Text style={s.name}>BLADES <Text style={s.nameGold}>Premium</Text></Text>
          <View style={s.priceRow}>
            {priceString ? (
              <>
                <Text style={s.priceN}>{priceString}</Text>
                <Text style={s.priceP}> / month</Text>
              </>
            ) : (
              <>
                <Text style={s.priceN}>39</Text>
                <Text style={s.priceP}>kr / month</Text>
              </>
            )}
          </View>

          <BenefitRow
            icon={<CoinIcon />}
            title="250 Blade-coins every month"
            desc="Used by the AI features: logbook scans, logging from a photo, aircraft lookups and CSV import. Refilled every month."
            chips={[{ label: 'Free · 100 once' }, { label: 'Premium · 250 / month', premium: true }]}
          />
          <BenefitRow
            icon={<Ionicons name="infinite-outline" size={18} color={N.gold} />}
            title="Unlimited manual flights"
            desc="Log as many flights as you fly. No cap on your logbook."
            chips={[{ label: `Free · ${FREE_TIER_LIMIT} flights` }, { label: 'Premium · unlimited', premium: true }]}
            last
          />

          <TouchableOpacity
            style={[s.cta, isPremium && s.ctaDone]}
            onPress={handleSubscribe}
            activeOpacity={0.85}
            disabled={purchasing}
          >
            {purchasing
              ? <ActivityIndicator size="small" color={N.bg} />
              : <Text style={s.ctaText}>{isPremium ? 'Premium active' : `Subscribe · ${priceString ?? '39 kr'} / month`}</Text>}
          </TouchableOpacity>
        </View>

        {/* Creator note */}
        <View style={{ paddingHorizontal: 4, gap: 10 }}>
          <Text style={s.noteBody}>
            I built BLADES for my own flying. Premium pays for the AI behind the scans and lookups, and keeps the app free of ads.
          </Text>
          <View style={s.sigRow}>
            <View style={s.sigLine} />
            <Text style={s.sigText}>Creator of BLADES</Text>
          </View>
        </View>

        {/* Fine print */}
        <View style={{ alignItems: 'center', gap: 8 }}>
          <TouchableOpacity onPress={handleRestore} hitSlop={8}>
            <Text style={s.linkCyan}>Restore purchase</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setPromoOpen(true)} hitSlop={8}>
            <Text style={[s.linkCyan, { color: N.text3 }]}>Promo code</Text>
          </TouchableOpacity>
          <Text style={s.fine}>
            Billed monthly through your Apple ID. Renews automatically until you cancel in App Store settings.
          </Text>
          <View style={{ flexDirection: 'row', gap: 14 }}>
            <TouchableOpacity onPress={() => Linking.openURL('https://blades-app.com/terms')} hitSlop={8}>
              <Text style={s.linkSmall}>Terms</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => Linking.openURL('https://blades-app.com/privacy')} hitSlop={8}>
              <Text style={s.linkSmall}>Privacy</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Promo code → låser upp Blades Premium gratis (obegränsad tid) */}
      <Modal visible={promoOpen} transparent animationType="fade" onRequestClose={() => setPromoOpen(false)}>
        <View style={{ flex: 1, backgroundColor: '#000000AA', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <View style={{ width: '100%', maxWidth: 380, backgroundColor: N.surface, borderRadius: 18, padding: 20, gap: 14, borderWidth: 1, borderColor: N.cardBorder }}>
            <Text style={{ fontFamily: 'Georgia', fontSize: 19, color: N.text }}>Promo code</Text>
            <Text style={{ fontSize: 13, color: N.text3, lineHeight: 18 }}>Enter your code to unlock Blades Premium.</Text>
            <TextInput
              value={promoCode}
              onChangeText={setPromoCode}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="Code"
              placeholderTextColor={N.text4}
              style={{ backgroundColor: N.elevated, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, color: N.text, fontSize: 16, fontWeight: '700', letterSpacing: 1, borderWidth: 1, borderColor: N.cardBorder }}
              returnKeyType="done"
              onSubmitEditing={applyPromo}
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 2 }}>
              <TouchableOpacity style={{ flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: N.cardBorder }} activeOpacity={0.8} onPress={() => { setPromoOpen(false); setPromoCode(''); }}>
                <Text style={{ color: N.text2, fontSize: 14, fontWeight: '700' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center', backgroundColor: N.gold, opacity: promoBusy ? 0.7 : 1 }} activeOpacity={0.85} onPress={applyPromo} disabled={promoBusy}>
                {promoBusy ? <ActivityIndicator size="small" color={N.bg} /> : <Text style={{ color: N.bg, fontSize: 14, fontWeight: '800' }}>Apply</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  card: {
    backgroundColor: N.card,
    borderWidth: 1,
    borderColor: N.goldEdge,
    borderRadius: 18,
    paddingTop: 22,
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  name: { fontFamily: 'Georgia', fontSize: 21, fontWeight: '400', letterSpacing: 0.3, color: N.text },
  nameGold: { color: N.gold },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 14, marginBottom: 20 },
  priceN: { fontFamily: 'Georgia', fontSize: 48, letterSpacing: -1.5, lineHeight: 48, color: N.text },
  priceP: { fontSize: 13, color: N.text3 },

  feat: { flexDirection: 'row', gap: 14, paddingVertical: 16, borderTopWidth: 1, borderTopColor: N.line },
  featLast: { borderBottomWidth: 1, borderBottomColor: N.line },
  fi: {
    width: 36, height: 36, borderRadius: 10, backgroundColor: N.goldSoft,
    borderWidth: 1, borderColor: N.goldEdge, alignItems: 'center', justifyContent: 'center',
  },
  fb: { flex: 1, minWidth: 0, gap: 4 },
  ft: { fontSize: 15, fontWeight: '600', lineHeight: 19.5, color: N.text },
  fd: { fontSize: 12.5, color: N.text3, lineHeight: 18, marginTop: 4 },
  cmp: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  chip: {
    fontFamily: 'Menlo', fontSize: 11, color: N.text3,
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6,
    borderWidth: 1, borderColor: N.line, overflow: 'hidden',
  },
  chipGold: { borderColor: N.goldEdge, backgroundColor: N.goldSoft, color: N.gold, fontWeight: '700' },

  cta: {
    marginTop: 22, height: 52, borderRadius: 14, backgroundColor: N.gold,
    alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8,
  },
  ctaDone: { backgroundColor: N.success },
  ctaText: { fontSize: 15.5, fontWeight: '800', letterSpacing: 0.2, color: N.bg },

  noteBody: { fontFamily: 'Georgia', fontSize: 16, lineHeight: 24, color: N.text2 },
  sigRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  sigLine: { width: 22, height: 1, backgroundColor: N.gold },
  sigText: { fontFamily: 'Menlo', fontSize: 10.5, fontWeight: '700', letterSpacing: 1.6, textTransform: 'uppercase', color: N.gold },

  linkCyan: { color: N.primary, fontSize: 13, fontWeight: '600', paddingVertical: 4 },
  fine: { fontSize: 10.5, color: N.text4, textAlign: 'center', lineHeight: 17, paddingHorizontal: 8 },
  linkSmall: { color: N.primary, fontSize: 11, fontWeight: '600' },
});
