import React, { useRef, useState, useEffect } from 'react';
import {
  View, Text, Image, Modal, Pressable, StyleSheet, Dimensions,
  ActivityIndicator, ScrollView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';

const SERIF = 'Fraunces';
const ITALIC = 'Fraunces-Italic';
const MONO = 'JetBrainsMono';

const SCREEN_W = Dimensions.get('window').width;
const CARD_W = SCREEN_W;             // on-screen preview width
const SCALE = CARD_W / 1080;         // canonical → preview
const sc = (n: number) => n * SCALE; // scale a canonical px value
const scrimRgba = (a: number) => `rgba(6,16,30,${a})`;
const white = (a: number) => `rgba(255,255,255,${a})`;

export interface BWShareData {
  variant: 'bw';
  weekLabel: string;
  hoursLabel: string;
  hrsUnit: string;
  sectorsLabel: string;   // "6 SECTORS"
  days: Array<{ iso: string; dow: string; hours: number }>;
  meta: Array<{ l: string; v: string }>;
}
export interface LXShareData {
  variant: 'lx';
  distanceNm: number;
  distanceKm: number;
  nmUnit: string;
  legs: Array<{ icao: string; city: string }>;
  meta: Array<{ l: string; v: string }>;
}
export type ShareData = BWShareData | LXShareData;

interface Props {
  visible: boolean;
  onClose: () => void;
  data: ShareData | null;
  accent?: string;
  initialPhotoUri?: string | null;
}

export function MilestoneShareCard({ visible, onClose, data, accent = Colors.accent, initialPhotoUri }: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const shotRef = useRef<ViewShot>(null);
  const [photo, setPhoto] = useState<string | null>(initialPhotoUri ?? null);
  const [overlayOpacity, setOverlayOpacity] = useState(1);
  const [sharing, setSharing] = useState(false);
  const SCRIM = 0.5; // fixed legibility recipe; the slider fades the whole overlay

  useEffect(() => { if (visible) setPhoto(initialPhotoUri ?? null); }, [visible, initialPhotoUri]);

  const pickPhoto = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 1 });
    if (!res.canceled && res.assets?.[0]) setPhoto(res.assets[0].uri);
  };

  const share = async () => {
    setSharing(true);
    try {
      if (!shotRef.current?.capture) return;
      const uri = await shotRef.current.capture();
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png', dialogTitle: 'BLADES' });
      }
    } catch (e) {
      console.warn('Milestone share failed', e);
    } finally {
      setSharing(false);
    }
  };

  if (!data) return null;
  const placeholder = data.variant === 'bw' ? t('ms.share_ph_week') : t('ms.share_ph_flight');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={st.backdrop}>
        <ScrollView contentContainerStyle={{ alignItems: 'center', paddingTop: insets.top + 8, paddingBottom: 8 }}>
          <ViewShot ref={shotRef} options={{ format: 'png', quality: 1, width: 1080, height: 1350 }}>
            <View style={[st.card, { width: CARD_W, height: CARD_W * (1350 / 1080) }]}>
              {/* photo */}
              {photo ? (
                <Image source={{ uri: photo }} style={StyleSheet.absoluteFill} resizeMode="cover" />
              ) : (
                <View style={[StyleSheet.absoluteFill, st.empty]}>
                  <Ionicons name="image-outline" size={sc(120)} color={white(0.18)} />
                  <Text style={[st.emptyText, { fontSize: sc(30) }]}>{placeholder}</Text>
                </View>
              )}

              {/* the overlay we built — scrim + accent wash + content; its opacity is the slider */}
              <View style={[StyleSheet.absoluteFill, { opacity: overlayOpacity }]} pointerEvents="none">
                {/* scrim */}
                <LinearGradient
                  style={StyleSheet.absoluteFill}
                  colors={[
                    scrimRgba(SCRIM * 0.9),
                    scrimRgba(SCRIM * 0.15),
                    scrimRgba(SCRIM * 0.25),
                    scrimRgba(Math.min(SCRIM + 0.34, 0.97)),
                  ]}
                  locations={[0, 0.26, 0.55, 1]}
                />
                {/* accent wash from bottom */}
                <LinearGradient
                  style={StyleSheet.absoluteFill}
                  colors={['transparent', 'transparent', accent + '22']}
                  locations={[0, 0.7, 1]}
                />

                {/* brand row */}
                <View style={{ position: 'absolute', top: sc(58), left: sc(64), right: sc(64) }}>
                  <Text style={{ fontFamily: SERIF, fontWeight: '600', fontSize: sc(30), letterSpacing: sc(8.4), color: accent }}>BLADES</Text>
                  <Text style={{ fontFamily: SERIF, fontWeight: '500', fontSize: sc(17), letterSpacing: sc(2), color: '#fff', marginTop: sc(6) }}>Pilot Logbook</Text>
                </View>

                {/* content */}
                <View style={{ position: 'absolute', left: sc(64), right: sc(64), bottom: sc(60) }}>
                  {data.variant === 'bw'
                    ? <BWContent data={data} accent={accent} />
                    : <LXContent data={data} accent={accent} />}
                </View>
              </View>
            </View>
          </ViewShot>

          {/* overlay opacity */}
          <View style={st.scrimRow}>
            <Ionicons name="image-outline" size={16} color={white(0.4)} />
            <Slider
              style={{ flex: 1, height: 30 }}
              minimumValue={0.25}
              maximumValue={1}
              value={overlayOpacity}
              onValueChange={setOverlayOpacity}
              minimumTrackTintColor={white(0.15)}
              maximumTrackTintColor={accent}
              thumbTintColor="#fff"
            />
            <Ionicons name="contrast-outline" size={16} color={white(0.4)} />
          </View>
        </ScrollView>

        {/* actions */}
        <View style={[st.actions, { paddingBottom: insets.bottom + 16 }]}>
          <Pressable style={st.ghostBtn} onPress={onClose}>
            <Ionicons name="close" size={18} color="#fff" />
          </Pressable>
          <Pressable style={st.ghostBtn} onPress={pickPhoto}>
            <Ionicons name="image-outline" size={18} color="#fff" />
            <Text style={st.ghostLabel}>{t('ms.share_choose_photo')}</Text>
          </Pressable>
          <Pressable style={[st.shareBtn, { backgroundColor: accent }]} onPress={share} disabled={sharing}>
            {sharing ? <ActivityIndicator color={Colors.textInverse} /> : (
              <>
                <Ionicons name="share-outline" size={18} color={Colors.textInverse} />
                <Text style={[st.shareLabel, { color: Colors.textInverse }]}>{t('ms.share_share')}</Text>
              </>
            )}
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ── Best Week content ──
function BWContent({ data, accent }: { data: BWShareData; accent: string }) {
  const max = Math.max(...data.days.map(d => d.hours), 1);
  return (
    <>
      <Text style={{ fontFamily: MONO, fontSize: sc(19), fontWeight: '700', letterSpacing: sc(4.9), color: accent }}>
        {data.weekLabel.toUpperCase()}
      </Text>

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: sc(12) }}>
        <Text style={{ fontFamily: SERIF, fontWeight: '500', fontSize: sc(220), lineHeight: sc(228), letterSpacing: sc(-11), color: '#fff', fontVariant: ['tabular-nums'] }}>
          {data.hoursLabel}<Text style={{ fontFamily: SERIF, fontWeight: '500', fontSize: sc(120), color: accent, letterSpacing: 0 }}>{data.hrsUnit}</Text>
        </Text>
        <View style={{ paddingBottom: sc(40), marginLeft: sc(20) }}>
          <Text style={{ fontFamily: MONO, fontSize: sc(19), fontWeight: '600', color: white(0.82), letterSpacing: sc(1.9) }}>{data.sectorsLabel.toUpperCase()}</Text>
        </View>
      </View>

      {/* day bars glass strip */}
      <View style={[st.glass, { marginTop: sc(26), paddingVertical: sc(20), paddingHorizontal: sc(24), height: sc(132), flexDirection: 'row', alignItems: 'flex-end', gap: sc(12) }]}>
        {data.days.map(d => {
          const empty = d.hours <= 0;
          const pct = empty ? 0 : (d.hours / max) * 100;
          const peak = d.hours === max && !empty;
          return (
            <View key={d.iso} style={{ flex: 1, alignItems: 'center', gap: sc(8), height: '100%', justifyContent: 'flex-end' }}>
              <View style={{ width: '100%', flex: 1, justifyContent: 'flex-end' }}>
                {empty ? (
                  <View style={{ width: '100%', height: '0%' }} />
                ) : (
                  <LinearGradient
                    colors={peak ? [accent, accent + '99'] : [accent + 'cc', accent + '55']}
                    style={{ width: '100%', height: `${Math.max(pct, 6)}%`, borderRadius: sc(5) }}
                  />
                )}
              </View>
              <Text style={{ fontFamily: MONO, fontSize: sc(13), fontWeight: '700', letterSpacing: sc(1.8), color: empty ? white(0.4) : white(0.8) }}>
                {d.dow.toUpperCase()}
              </Text>
            </View>
          );
        })}
      </View>

      <MetaRow items={data.meta} />
    </>
  );
}

// ── Longest XC content ──
function LXContent({ data, accent }: { data: LXShareData; accent: string }) {
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
        <Text style={{ fontFamily: SERIF, fontWeight: '500', fontSize: sc(214), lineHeight: sc(222), letterSpacing: sc(-10.7), color: '#fff', fontVariant: ['tabular-nums'] }}>
          {data.distanceNm.toLocaleString('en-US')}
        </Text>
        <View style={{ paddingBottom: sc(34), marginLeft: sc(20) }}>
          <Text style={{ fontFamily: MONO, fontSize: sc(34), fontWeight: '700', color: accent, letterSpacing: sc(5.4) }}>{data.nmUnit}</Text>
          <Text style={{ fontFamily: MONO, fontSize: sc(19), fontWeight: '600', color: white(0.82), marginTop: sc(8), letterSpacing: sc(1.9) }}>{data.distanceKm.toLocaleString('en-US')} KM</Text>
        </View>
      </View>

      <RouteStrip legs={data.legs} accent={accent} />

      <MetaRow items={data.meta} />
    </>
  );
}

function RouteStrip({ legs, accent }: { legs: Array<{ icao: string; city: string }>; accent: string }) {
  if (legs.length < 2) return null;
  const last = legs.length - 1;
  const mids = legs.slice(1, -1);
  const n = mids.length;
  const interSize = n <= 1 ? 30 : n === 2 ? 25 : n === 3 ? 21 : n === 4 ? 18 : 15;
  const dotSize = n <= 2 ? 13 : n <= 4 ? 11 : 9;
  const citySize = n <= 1 ? 16 : n <= 3 ? 14 : 0;

  const ROW_H = sc(104);
  const END_W = sc(220);

  return (
    <View style={[st.glass, { marginTop: sc(26), paddingVertical: sc(26), paddingHorizontal: sc(28) }]}>
      <View style={{ height: ROW_H, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', position: 'relative' }}>
        {/* one continuous dashed line, from departure dot to arrival dot */}
        <View style={{ position: 'absolute', left: END_W / 2, right: END_W / 2, top: '50%', borderTopWidth: sc(2), borderColor: accent, borderStyle: 'dashed' }} />

        {/* direct-flight plane glyph on the line */}
        {n === 0 && (
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: '50%', marginTop: -sc(20), alignItems: 'center' }}>
            <View style={{ width: sc(40), height: sc(40), borderRadius: sc(20), backgroundColor: accent, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="airplane" size={sc(22)} color="#06101E" />
            </View>
          </View>
        )}

        {legs.map((p, i) => {
          const isEnd = i === 0 || i === last;
          const size = isEnd ? 44 : interSize;
          const ds = isEnd ? 16 : dotSize;
          const cs = isEnd ? 20 : citySize;
          const w = isEnd ? END_W : sc(interSize * 3.6);
          return (
            <View key={p.icao + i} style={{ width: w, height: ROW_H, alignItems: 'center', justifyContent: 'center' }}>
              <Text numberOfLines={1} style={{ position: 'absolute', bottom: '56%', left: 0, right: 0, textAlign: 'center', fontFamily: MONO, fontWeight: '700', fontSize: sc(size), color: '#fff', letterSpacing: sc(isEnd ? 1.8 : 0.5) }}>{p.icao}</Text>
              <View style={{ width: sc(ds), height: sc(ds), borderRadius: sc(ds / 2), backgroundColor: accent, borderWidth: sc(2.5), borderColor: '#06101E' }} />
              {cs > 0 && !!p.city && (
                <Text numberOfLines={1} style={{ position: 'absolute', top: '56%', left: 0, right: 0, textAlign: 'center', fontFamily: ITALIC, fontStyle: 'italic', fontSize: sc(cs), color: white(0.62) }}>{p.city}</Text>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function MetaRow({ items }: { items: Array<{ l: string; v: string }> }) {
  return (
    <View style={{ marginTop: sc(22), flexDirection: 'row', gap: sc(40) }}>
      {items.map(s => (
        <View key={s.l} style={{ gap: sc(6) }}>
          <Text style={{ fontFamily: MONO, fontSize: sc(13), fontWeight: '700', letterSpacing: sc(2.6), color: white(0.55) }}>{s.l.toUpperCase()}</Text>
          <Text style={{ fontFamily: MONO, fontSize: sc(19), fontWeight: '700', letterSpacing: sc(0.76), color: '#fff' }}>{s.v}</Text>
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000' },
  card: { overflow: 'hidden', backgroundColor: '#0A1628', borderRadius: 16 },
  empty: { backgroundColor: '#0A1628', alignItems: 'center', justifyContent: 'center', gap: 16 },
  emptyText: { fontFamily: SERIF, color: 'rgba(255,255,255,0.35)' },
  glass: { borderRadius: sc(18), backgroundColor: 'rgba(6,16,30,0.40)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  scrimRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, width: CARD_W, paddingHorizontal: 12 },
  actions: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 10, alignItems: 'center' },
  ghostBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  ghostLabel: { color: '#fff', fontSize: 14, fontWeight: '600' },
  shareBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12 },
  shareLabel: { fontSize: 15, fontWeight: '700' },
});
