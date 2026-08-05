import React, { useRef, useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Dimensions, Animated, FlatList,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Line, Rect, G, Text as SvgText, Path } from 'react-native-svg';
import { useFlightStore } from '../../store/flightStore';
import type { SubscriptionTier } from '../../store/flightStore';

// ── Navy palette (premium screen is ALWAYS dark) ─────────────────────────
const N = {
  bg: '#0A1628',
  surface: '#0F1E3A',
  card: '#0F1E3A',
  cardBorder: '#1A3A5A',
  elevated: '#152338',
  primary: '#00C8E8',
  gold: '#FFB830',
  goldDeep: '#E89C12',
  goldSoft: 'rgba(255, 184, 48, 0.10)',
  goldEdge: 'rgba(255, 184, 48, 0.35)',
  text: '#FFFFFF',
  text2: '#B5C8D8',
  text3: '#7FA8C8',
  text4: '#3A5A7A',
  separator: '#1A3A5A',
  success: '#00E8A0',
  danger: '#FF4D6A',
};

const { width: SCREEN_W } = Dimensions.get('window');

// ── Hero slide shell ─────────────────────────────────────────────────────
function HeroSlide({ pill, titleA, titleB, sub, children }: {
  pill: string; titleA: string; titleB: string; sub: string; children: React.ReactNode;
}) {
  return (
    <View style={{ width: SCREEN_W, paddingHorizontal: 24, paddingTop: 20, paddingBottom: 14 }}>
      <View style={{
        flexDirection: 'row', alignItems: 'center', gap: 6,
        paddingHorizontal: 10, paddingVertical: 5, borderRadius: 100,
        backgroundColor: N.goldSoft, borderWidth: 1, borderColor: N.goldEdge,
        alignSelf: 'flex-start', marginBottom: 12,
      }}>
        <Ionicons name="sparkles-outline" size={12} color={N.gold} />
        <Text style={{ fontSize: 10, fontWeight: '700', letterSpacing: 1.4, color: N.gold, textTransform: 'uppercase' }}>
          {pill}
        </Text>
      </View>
      <Text style={{ fontFamily: 'Georgia', fontSize: 26, fontWeight: '400', letterSpacing: -0.5, lineHeight: 29, color: N.text, marginBottom: 8 }}>
        {titleA}
        {'\n'}
        <Text style={{ fontStyle: 'italic', color: N.gold }}>{titleB}</Text>
      </Text>
      <Text style={{ fontSize: 13, color: N.text2, lineHeight: 19, marginBottom: 14, minHeight: 36 }}>
        {sub}
      </Text>
      <View style={{ height: 132 }}>
        {children}
      </View>
    </View>
  );
}

// ── Slide 1: Flight import ───────────────────────────────────────────────
function SlideFlightImport() {
  const caretAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(caretAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
      Animated.timing(caretAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
    ])).start();
  }, []);

  const fields = [['DEP', 'ESSA'], ['ARR', 'ESGG'], ['TIME', '01:24'], ['A/C', 'AS350'], ['ALT', '2400 ft']];
  return (
    <HeroSlide pill="The hero feature" titleA="Log a flight in" titleB="15 seconds." sub="Photograph your instruments — AI extracts time, route, altitude, aircraft.">
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {/* Instrument */}
        <View style={{ flex: 1, aspectRatio: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: '#0A1628', borderWidth: 1, borderColor: N.cardBorder }}>
          <Svg viewBox="0 0 100 100" style={{ width: '100%', height: '100%' }}>
            <Circle cx={50} cy={50} r={38} fill="#000" stroke={N.cardBorder} strokeWidth={2} />
            <Circle cx={50} cy={50} r={28} fill="none" stroke={N.cardBorder} strokeWidth={0.5} />
            {Array.from({ length: 12 }).map((_, i) => {
              const a = (i * 30 - 90) * Math.PI / 180;
              return <Line key={i} x1={50 + Math.cos(a) * 32} y1={50 + Math.sin(a) * 32} x2={50 + Math.cos(a) * 36} y2={50 + Math.sin(a) * 36} stroke={N.text3} strokeWidth={1} />;
            })}
            <SvgText x={50} y={42} fontSize={6} fill={N.text3} textAnchor="middle" fontFamily="monospace">UTC</SvgText>
            <SvgText x={50} y={56} fontSize={11} fill={N.gold} textAnchor="middle" fontFamily="monospace" fontWeight="700">09:41</SvgText>
            <SvgText x={50} y={68} fontSize={5} fill={N.text3} textAnchor="middle" fontFamily="monospace">ALT 2400</SvgText>
            <Line x1={50} y1={50} x2={50} y2={32} stroke={N.gold} strokeWidth={1.5} strokeLinecap="round" />
          </Svg>
          <View style={{ position: 'absolute', top: 6, right: 6, width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="camera-outline" size={10} color="#FFF" />
          </View>
        </View>
        {/* Arrow */}
        <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: N.gold, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="flash" size={13} color={N.bg} />
        </View>
        {/* Form */}
        <View style={{ flex: 1, aspectRatio: 1, borderRadius: 12, padding: 9, backgroundColor: N.elevated, borderWidth: 1, borderColor: N.cardBorder, justifyContent: 'space-between' }}>
          {fields.map(([k, v]) => (
            <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 7.5, letterSpacing: 0.8, color: N.text4, fontWeight: '700', fontFamily: 'Menlo' }}>{k}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ fontSize: 9.5, color: N.gold, fontFamily: 'Menlo', fontWeight: '600' }}>{v}</Text>
                <Animated.View style={{ width: 3, height: 9, backgroundColor: N.gold, marginLeft: 2, opacity: caretAnim }} />
              </View>
            </View>
          ))}
        </View>
      </View>
    </HeroSlide>
  );
}

// ── Slide 2: Logbook scan ────────────────────────────────────────────────
function SlideLogbookScan() {
  const scanAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(Animated.sequence([
      Animated.timing(scanAnim, { toValue: 1, duration: 1200, useNativeDriver: false }),
      Animated.timing(scanAnim, { toValue: 0, duration: 1200, useNativeDriver: false }),
    ])).start();
  }, []);
  const scanTop = scanAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 96] });

  const rows = [
    ['14/03', 'ESSA', 'ESGG', 'AS350', '1:24', 'PIC'],
    ['15/03', 'ESGG', 'ESSA', 'R44', '0:48', 'PIC'],
    ['17/03', 'ESSA', 'ESGG', 'EC120', '2:10', 'PIC'],
    ['20/03', 'ESGG', 'ESSA', 'AS350', '1:36', 'PIC'],
    ['22/03', 'ESSA', 'ESGG', 'R44', '0:52', 'PIC'],
    ['24/03', 'ESGG', 'ESSA', 'AS350', '1:18', 'PIC'],
  ];
  return (
    <HeroSlide pill="AI logbook scan" titleA="Never type from" titleB="paper again." sub="Snap a page — handwritten or printed. AI reads every column, every flight.">
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 260, height: 124, borderRadius: 10, overflow: 'hidden', backgroundColor: '#F1E9D5', borderWidth: 1, borderColor: N.cardBorder }}>
          <Svg viewBox="0 0 260 124" style={{ width: 260, height: 124 }}>
            <Line x1={8} y1={14} x2={252} y2={14} stroke="#6B5430" strokeWidth={1} />
            <SvgText x={14} y={11} fontSize={4} fill="#6B5430" fontFamily="sans-serif" fontWeight="700">DATE</SvgText>
            <SvgText x={50} y={11} fontSize={4} fill="#6B5430" fontFamily="sans-serif" fontWeight="700">FROM</SvgText>
            <SvgText x={84} y={11} fontSize={4} fill="#6B5430" fontFamily="sans-serif" fontWeight="700">TO</SvgText>
            <SvgText x={116} y={11} fontSize={4} fill="#6B5430" fontFamily="sans-serif" fontWeight="700">A/C</SvgText>
            <SvgText x={156} y={11} fontSize={4} fill="#6B5430" fontFamily="sans-serif" fontWeight="700">TIME</SvgText>
            <SvgText x={184} y={11} fontSize={4} fill="#6B5430" fontFamily="sans-serif" fontWeight="700">ROLE</SvgText>
            {rows.map((r, i) => {
              const y = 20 + i * 16;
              return (
                <G key={i}>
                  <Line x1={8} y1={y} x2={252} y2={y} stroke="#C9B98B" strokeWidth={0.5} />
                  <SvgText x={14} y={y - 4} fontSize={6} fill="#3A2E1C" fontFamily="Georgia" fontStyle="italic">{r[0]}</SvgText>
                  <SvgText x={50} y={y - 4} fontSize={6} fill="#3A2E1C" fontFamily="Georgia" fontStyle="italic">{r[1]}</SvgText>
                  <SvgText x={84} y={y - 4} fontSize={6} fill="#3A2E1C" fontFamily="Georgia" fontStyle="italic">{r[2]}</SvgText>
                  <SvgText x={116} y={y - 4} fontSize={6} fill="#3A2E1C" fontFamily="Georgia" fontStyle="italic">{r[3]}</SvgText>
                  <SvgText x={156} y={y - 4} fontSize={6} fill="#3A2E1C" fontFamily="Georgia" fontStyle="italic">{r[4]}</SvgText>
                  <SvgText x={184} y={y - 4} fontSize={6} fill="#3A2E1C" fontFamily="Georgia" fontStyle="italic">{r[5]}</SvgText>
                </G>
              );
            })}
          </Svg>
          {/* Scan beam */}
          <Animated.View style={{
            position: 'absolute', left: 0, right: 0, height: 28, top: scanTop,
            backgroundColor: N.gold + '30',
            borderTopWidth: 1, borderBottomWidth: 1, borderColor: N.gold,
          }} />
          {/* Badge */}
          <View style={{
            position: 'absolute', bottom: 8, right: 8, flexDirection: 'row', alignItems: 'center', gap: 4,
            paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4,
            backgroundColor: N.bg, borderWidth: 1, borderColor: N.gold,
          }}>
            <Ionicons name="checkmark" size={9} color={N.gold} />
            <Text style={{ fontSize: 9, fontWeight: '700', color: N.gold, fontFamily: 'Menlo', letterSpacing: 0.4 }}>6 / 6 ROWS</Text>
          </View>
        </View>
      </View>
    </HeroSlide>
  );
}

// ── Slide 3: EASA progress ───────────────────────────────────────────────
function SlideEASA() {
  const rows = [
    { l: 'PIC time', cur: 142, req: 200 },
    { l: 'Night', cur: 28, req: 50 },
    { l: 'Cross-country', cur: 168, req: 200 },
  ];
  return (
    <HeroSlide pill="Live tracking" titleA="Know when you'll" titleB="reach CPL." sub="Live PPL/CPL/ATPL progress with forecast dates from your own pace.">
      <View style={{ flex: 1, backgroundColor: N.elevated, borderWidth: 1, borderColor: N.cardBorder, borderRadius: 12, padding: 12, gap: 9 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: N.text3, letterSpacing: 1.2, textTransform: 'uppercase' }}>CPL · FCL.515</Text>
          <Text style={{ fontSize: 10, color: N.gold, fontFamily: 'Menlo', fontWeight: '700' }}>ETA Oct 2026</Text>
        </View>
        {rows.map((r, i) => {
          const pct = (r.cur / r.req) * 100;
          return (
            <View key={i}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 3 }}>
                <Text style={{ fontSize: 11, color: N.text, fontWeight: '600' }}>{r.l}</Text>
                <Text style={{ fontSize: 10, fontFamily: 'Menlo', color: N.text3 }}>
                  <Text style={{ color: N.text }}>{r.cur}</Text>
                  <Text style={{ color: N.text4 }}> / {r.req}h</Text>
                </Text>
              </View>
              <View style={{ height: 4, backgroundColor: N.separator, borderRadius: 2, overflow: 'hidden' }}>
                <View style={{ width: `${pct}%`, height: 4, backgroundColor: N.gold, borderRadius: 2 }} />
              </View>
            </View>
          );
        })}
      </View>
    </HeroSlide>
  );
}

// ── Slide 4: Share card ──────────────────────────────────────────────────
function SlideShare() {
  return (
    <HeroSlide pill="Share-ready" titleA="Share your" titleB="flights." sub="Photo, stats, and the runway diagram — every airport, ready to post.">
      <View style={{ flex: 1, alignItems: 'center' }}>
        <View style={{
          width: 220, height: '100%', borderRadius: 14, overflow: 'hidden', padding: 12,
          backgroundColor: N.elevated, borderWidth: 1, borderColor: N.goldEdge, gap: 6,
        }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Text style={{ fontFamily: 'Georgia', fontSize: 9, letterSpacing: 2.4, color: N.text, fontWeight: '700' }}>BLADES</Text>
            <Text style={{ fontSize: 8, fontFamily: 'Menlo', color: N.text3, letterSpacing: 0.5 }}>14/03/26</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <Text style={{ fontFamily: 'Georgia', fontSize: 18, color: N.text, fontWeight: '700', letterSpacing: -0.3 }}>ESSA</Text>
            <View style={{ flex: 1, height: 1, backgroundColor: N.gold }} />
            <Text style={{ fontFamily: 'Georgia', fontSize: 18, color: N.text, fontWeight: '700', letterSpacing: -0.3 }}>ESGG</Text>
          </View>
          {/* Runway */}
          <Svg viewBox="0 0 200 38" style={{ width: '100%', height: 38, marginTop: 2 }}>
            <Rect x={0} y={14} width={200} height={10} fill={N.cardBorder} stroke={N.gold} strokeWidth={0.5} />
            <Line x1={22} y1={19} x2={194} y2={19} stroke="#FFFFFF80" strokeWidth={0.6} strokeDasharray="6,4" />
            <SvgText x={6} y={12} fontSize={6} fill={N.text3} fontFamily="monospace" fontWeight="700">14</SvgText>
            <SvgText x={192} y={12} fontSize={6} fill={N.text3} fontFamily="monospace" fontWeight="700">32</SvgText>
            <SvgText x={100} y={34} fontSize={6} fill={N.text3} fontFamily="monospace" textAnchor="middle">RWY 03/21 · 3301m</SvgText>
          </Svg>
          <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
            {[['TIME', '1:24', N.text], ['A/C', 'AS350', N.text], ['ROLE', 'PIC', N.gold]].map(([k, v, c]) => (
              <View key={k}>
                <Text style={{ fontSize: 7.5, color: N.text4, letterSpacing: 0.6, fontFamily: 'Menlo', fontWeight: '700' }}>{k}</Text>
                <Text style={{ fontFamily: 'Georgia', fontSize: 14, color: c, fontWeight: '700' }}>{v}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    </HeroSlide>
  );
}

// ── Feature group ────────────────────────────────────────────────────────
const ICON_MAP: Record<string, keyof typeof Ionicons.glyphMap> = {
  instrument: 'speedometer-outline',
  progress: 'trending-up-outline',
  pdf: 'document-outline',
  globe: 'globe-outline',
};

function FeatureGroup({ icon, label, items }: {
  icon: string; label: string;
  items: { t: string; q?: string; d?: string }[];
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
        <Ionicons name={ICON_MAP[icon] ?? 'sparkles-outline'} size={12} color={N.gold} />
        <Text style={{ fontSize: 9.5, fontWeight: '700', letterSpacing: 1.5, color: N.gold, textTransform: 'uppercase' }}>{label}</Text>
      </View>
      {items.map((it, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 8 }}>
          <Ionicons name="checkmark" size={14} color={N.gold} style={{ marginTop: 1 }} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, color: N.text, fontWeight: '500', lineHeight: 18 }}>
              {it.t}{it.q && <Text style={{ color: N.gold, fontWeight: '700' }}> · {it.q}</Text>}
            </Text>
            {it.d && <Text style={{ fontSize: 11.5, color: N.text3, marginTop: 2, lineHeight: 16 }}>{it.d}</Text>}
          </View>
        </View>
      ))}
    </View>
  );
}

// ── Premium card ─────────────────────────────────────────────────────────
function PremiumCard({ onSubscribe }: { onSubscribe: () => void }) {
  return (
    <View style={[s.tierCard, { borderColor: N.goldEdge }]}>
      <View style={{ position: 'absolute', top: -10, right: 16, backgroundColor: N.gold, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4 }}>
        <Text style={{ fontSize: 9, fontWeight: '800', letterSpacing: 1.4, color: N.bg, textTransform: 'uppercase' }}>Most popular</Text>
      </View>
      <Text style={{ fontFamily: 'Georgia', fontSize: 19, letterSpacing: 0.4, color: N.text, marginBottom: 4 }}>
        BLADES <Text style={{ color: N.gold }}>Premium</Text>
      </Text>
      <Text style={{ fontSize: 12, color: N.text3, marginBottom: 12, lineHeight: 17 }}>
        Everything you need to fly professionally.
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, marginBottom: 14 }}>
        <Text style={{ fontFamily: 'Georgia', fontSize: 36, color: N.text, letterSpacing: -1 }}>49</Text>
        <Text style={{ fontSize: 12, color: N.text3 }}>kr / month</Text>
      </View>

      <FeatureGroup icon="instrument" label="AI · in your cockpit" items={[
        { t: 'Flight imports', q: '30 / mo', d: 'Photograph instruments — AI fills the form.' },
        { t: 'Logbook scans', q: '10 / mo', d: 'Photograph paper pages, every column read.' },
        { t: 'Aircraft lookups', q: '20 / mo', d: 'Identify type & specs from a photo.' },
        { t: 'Page summaries', q: '10 / mo' },
      ]} />
      <FeatureGroup icon="progress" label="Tracking" items={[
        { t: 'EASA progress', d: 'Live PPL/CPL/ATPL tracking with forecast dates.' },
        { t: 'Unlimited manual logging', d: 'No 200-flight cap.' },
        { t: 'Currency & milestone alerts' },
      ]} />
      <FeatureGroup icon="pdf" label="Export & share" items={[
        { t: 'EASA-format PDF', d: 'Pilot CV / experience summary.' },
        { t: 'Flight share cards', d: 'Photo + stats + runway diagram.' },
      ]} />
      <FeatureGroup icon="globe" label="Database" items={[
        { t: 'Full ICAO airport database', q: '13 000+', d: 'With runway diagrams for every airport.' },
      ]} />

      <TouchableOpacity style={s.ctaGold} onPress={onSubscribe} activeOpacity={0.85}>
        <Text style={s.ctaGoldText}>Subscribe — 49 kr/month</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── MAX card ─────────────────────────────────────────────────────────────
function MaxCard({ onSubscribe }: { onSubscribe: () => void }) {
  const quotas = [
    ['Logbook scans', '50 / mo', '5×'],
    ['Flight imports', '100 / mo', '3×'],
    ['Aircraft lookups', '60 / mo', '3×'],
    ['Page summaries', '20 / mo', '2×'],
  ];
  return (
    <View style={[s.tierCard, { borderColor: N.cardBorder }]}>
      <View style={{ position: 'absolute', top: -10, right: 16, backgroundColor: N.text, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4 }}>
        <Text style={{ fontSize: 9, fontWeight: '800', letterSpacing: 1.4, color: N.bg, textTransform: 'uppercase' }}>For schools & high-volume</Text>
      </View>
      <Text style={{ fontFamily: 'Georgia', fontSize: 19, letterSpacing: 0.4, color: N.text, marginBottom: 4 }}>
        BLADES <Text style={{ fontStyle: 'italic', color: N.text2 }}>MAX</Text>
      </Text>
      <Text style={{ fontSize: 12, color: N.text3, marginBottom: 12, lineHeight: 17 }}>
        Everything in Premium, scaled up — and three CV-grade PDF templates.
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, marginBottom: 14 }}>
        <Text style={{ fontFamily: 'Georgia', fontSize: 36, color: N.text, letterSpacing: -1 }}>149</Text>
        <Text style={{ fontSize: 12, color: N.text3 }}>kr / month</Text>
      </View>

      {/* Quota grid */}
      <View style={{ padding: 12, backgroundColor: N.elevated, borderRadius: 10, borderWidth: 1, borderColor: N.separator, marginBottom: 12 }}>
        <Text style={{ fontSize: 10, letterSpacing: 1.4, color: N.text3, fontWeight: '700', textTransform: 'uppercase', marginBottom: 8 }}>
          Quotas, multiplied
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {quotas.map(([k, v, mult]) => (
            <View key={k} style={{ width: '50%', marginBottom: 8 }}>
              <Text style={{ fontSize: 10.5, color: N.text3, letterSpacing: 0.2 }}>{k}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 1 }}>
                <Text style={{ fontFamily: 'Menlo', fontSize: 14, fontWeight: '700', color: N.text }}>{v}</Text>
                <Text style={{ fontSize: 9.5, fontWeight: '800', color: N.gold, letterSpacing: 0.6 }}>{mult}</Text>
              </View>
            </View>
          ))}
        </View>
      </View>

      {/* PDF templates */}
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginBottom: 12 }}>
        <Ionicons name="document-outline" size={16} color={N.gold} style={{ marginTop: 1 }} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, color: N.text, fontWeight: '600' }}>3 PDF templates</Text>
          <Text style={{ fontSize: 11.5, color: N.text3, marginTop: 2, lineHeight: 16 }}>
            EASA formal · Modern (navy/teal) · Editorial (magazine).
          </Text>
        </View>
      </View>

      <TouchableOpacity style={s.ctaOutline} onPress={onSubscribe} activeOpacity={0.85}>
        <Text style={s.ctaOutlineText}>Subscribe — 149 kr/month</Text>
      </TouchableOpacity>
    </View>
  );
}

// ── Free miss card ───────────────────────────────────────────────────────
function FreeMissCard() {
  const missing = [
    'No flight data imports',
    'No PDF export',
    'No EASA progress tracking',
    'Only 1 logbook scan (one-time)',
    'Limited to 200 manual flights',
    'Basic ICAO search (10 / mo)',
  ];
  return (
    <View style={[s.tierCard, { borderColor: N.cardBorder }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Ionicons name="lock-closed-outline" size={14} color={N.text3} />
        <Text style={{ fontSize: 10, letterSpacing: 1.6, color: N.text3, fontWeight: '700', textTransform: 'uppercase' }}>
          What you're missing on Free
        </Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {missing.map((m, i) => (
          <View key={i} style={{ width: '50%', flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 8 }}>
            <Ionicons name="close-circle-outline" size={13} color={N.danger} style={{ marginTop: 1 }} />
            <Text style={{ fontSize: 11.5, color: N.text2, lineHeight: 16, flex: 1 }}>{m}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────
export default function PremiumScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { setTier } = useFlightStore();
  const [heroIdx, setHeroIdx] = useState(0);
  const slides = [SlideFlightImport, SlideLogbookScan, SlideEASA];

  const handleSubscribe = (tier: SubscriptionTier) => {
    // TODO: Replace with RevenueCat purchase flow
    setTier(tier);
    router.back();
  };

  return (
    <View style={{ flex: 1, backgroundColor: N.bg }}>
      {/* Top bar */}
      <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ width: 28, height: 28, borderRadius: 6, backgroundColor: N.gold, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontWeight: '800', fontSize: 13, color: N.bg }}>B</Text>
          </View>
          <View>
            <Text style={{ fontFamily: 'Georgia', fontSize: 12, fontWeight: '700', letterSpacing: 3, color: N.text, lineHeight: 14 }}>BLADES</Text>
            <Text style={{ fontFamily: 'Georgia', fontStyle: 'italic', fontSize: 10, color: N.text3, marginTop: 1 }}>Pilot Logbook</Text>
          </View>
        </View>
        <TouchableOpacity style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: N.elevated, alignItems: 'center', justifyContent: 'center' }} onPress={() => router.back()}>
          <Ionicons name="close" size={16} color={N.text2} />
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Hero carousel */}
        <View style={{ borderBottomWidth: 1, borderBottomColor: N.separator }}>
          <FlatList
            data={slides}
            keyExtractor={(_, i) => String(i)}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setHeroIdx(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W))}
            renderItem={({ item: Slide }) => <Slide />}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 7, paddingBottom: 18, paddingTop: 4 }}>
            {slides.map((_, i) => (
              <View key={i} style={{
                width: i === heroIdx ? 22 : 6, height: 6, borderRadius: 3,
                backgroundColor: i === heroIdx ? N.gold : N.text4,
              }} />
            ))}
          </View>
        </View>

        {/* Tier cards */}
        <View style={{ padding: 18, gap: 14, paddingBottom: 28 }}>
          <PremiumCard onSubscribe={() => handleSubscribe('premium')} />
          <MaxCard onSubscribe={() => handleSubscribe('max')} />
          <FreeMissCard />

          {/* Restore + fine print */}
          <View style={{ alignItems: 'center', gap: 6, marginTop: 4, paddingHorizontal: 8 }}>
            <TouchableOpacity>
              <Text style={{ color: N.primary, fontSize: 13, fontWeight: '600' }}>Restore purchase</Text>
            </TouchableOpacity>
            <Text style={{ fontSize: 10.5, color: N.text4, textAlign: 'center', lineHeight: 16 }}>
              Cancel anytime in App Store settings. No hidden fees.{'\n'}
              Subscription auto-renews monthly until cancelled.
            </Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  tierCard: {
    backgroundColor: N.card,
    borderWidth: 1,
    borderRadius: 16,
    padding: 20,
    paddingHorizontal: 18,
    position: 'relative',
  },
  ctaGold: {
    width: '100%', marginTop: 8, paddingVertical: 14,
    backgroundColor: N.gold, borderRadius: 12, alignItems: 'center',
  },
  ctaGoldText: { fontSize: 14, fontWeight: '800', letterSpacing: 0.3, color: N.bg },
  ctaOutline: {
    width: '100%', marginTop: 4, paddingVertical: 14,
    backgroundColor: 'transparent', borderWidth: 1, borderColor: N.cardBorder,
    borderRadius: 12, alignItems: 'center',
  },
  ctaOutlineText: { fontSize: 14, fontWeight: '700', letterSpacing: 0.3, color: N.text },
});
