// Drönar-Fleet-kort (per MODELL) — VISUELL TVILLING till FleetCard (pilot logbook):
// fotobanner med VisionKit-urklipp som spiller över kortkanten, modell-header, "Total
// flight time" över alla registreringar, spec-grupper (airframe/prestanda/vikt) och en
// lista med registreringar + timmar. Navy via DR + accent. Foto väljs ur biblioteket
// eller hämtas online (Wikipedia via AI, token-styrt). "Last flown"/antal flygningar
// visas medvetet INTE — det syns per registrering.
import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Image, Alert, Dimensions, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { DR } from '../../constants/droneTheme';
import { type DroneModelFleet, getDroneModelRegistrations, updateDroneModelImage, persistDroneModelLookup } from '../../db/drones';
import { ensureAircraftCutout } from '../../services/aircraftCutout';
import { enrichDroneFleet } from '../../services/droneLookup';
import { PremiumModal } from '../PremiumModal';
import { useFlightStore } from '../../store/flightStore';
import { hasTokenQuota, showMonthlyTokenLimitAlert, isTokenQuotaError } from '../../utils/tokenGate';
import { FONT_SERIF, FONT_MONO } from './tokens';

const pad = (n: number) => String(n).padStart(2, '0');
const fmtTotal = (h: number) => `${Math.floor(h || 0)}:${pad(Math.round(((h || 0) % 1) * 60))}`;
const TYPE_LABEL: Record<string, string> = { multirotor: 'Multirotor', fixedwing: 'Fixed-wing', helicopter: 'Single-rotor', vtol: 'VTOL' };
function mtowParts(g: number): { value: string; unit: string } {
  if (!g) return { value: '—', unit: '' };
  if (g >= 1000) return { value: (g / 1000).toFixed(g % 1000 === 0 ? 0 : 1), unit: 'kg' };
  return { value: String(g), unit: 'g' };
}
const numOr = (n: number) => (n > 0 ? String(n) : '—');

const BANNER_H = 110;

function Stat({ label, value, unit, first }: { label: string; value: string; unit?: string; first: boolean }) {
  return (
    <View style={{ flex: 1, paddingHorizontal: 11, borderLeftWidth: first ? 0 : 1, borderLeftColor: DR.separator, gap: 3, minWidth: 0 }}>
      <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: DR.muted }}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontFamily: FONT_MONO, fontSize: 15, fontWeight: '700', color: DR.text }}>
        {value || '—'}<Text style={{ fontSize: 9, color: DR.muted, fontWeight: '500' }}>{value && value !== '—' && unit ? ' ' + unit : ''}</Text>
      </Text>
    </View>
  );
}

export function DroneFleetCard({ m, accent, current, onSaved, onManage }: {
  m: DroneModelFleet;
  accent: string;
  current: boolean;
  onSaved: () => void;
  onManage: () => void;
}) {
  const [cw, setCw] = useState(Dimensions.get('window').width - 28);
  const [aspect, setAspect] = useState(1.5);
  const [cutout, setCutout] = useState<string | null>(m.cutout_url || null);
  const [fetching, setFetching] = useState(false);
  const [showPremium, setShowPremium] = useState(false);
  const [triedFetch, setTriedFetch] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [regs, setRegs] = useState<{ registration: string; drone_id: number; hours: number }[]>([]);
  const { isPremium, isMax } = useFlightStore();

  useEffect(() => {
    getDroneModelRegistrations(m.model).then(setRegs).catch(() => {});
  }, [m.model]);

  // Bildaspekt + subject-lift-urklipp (cachas) — samma som pilot FleetCard.
  useEffect(() => {
    let alive = true;
    if (!m.image_url) { setCutout(null); return; }
    Image.getSize(m.image_url, (w, h) => { if (alive && h > 0) setAspect(w / h); }, () => {});
    (async () => {
      const r = await ensureAircraftCutout(m.image_url);
      if (!alive) return;
      setCutout(r.cutout);
      if (r.cutout && r.cutout !== m.cutout_url) {
        updateDroneModelImage(m.model, { cutout_url: r.cutout }).catch(() => {});
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.image_url, m.model]);

  const pickImage = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, exif: false });
      if (res.canceled || !res.assets?.[0]) return;
      await updateDroneModelImage(m.model, { image_url: res.assets[0].uri, cutout_url: '' });
      onSaved();
    } catch (e: any) {
      Alert.alert('Could not set photo', e?.message || 'Try again.');
    }
  };

  // Hämta bild + specar online (AI-identifierad modell → Wikipedia-bild) — token-styrt.
  const fetchOnline = async () => {
    if (fetching) return;
    if (!hasTokenQuota()) {
      if (isPremium || isMax) showMonthlyTokenLimitAlert(); else setShowPremium(true);
      return;
    }
    setFetching(true);
    try {
      const r = await enrichDroneFleet(m.model || '');
      await persistDroneModelLookup(m.model, {
        manufacturer: r.manufacturer, drone_type: r.drone_type, mtow_g: r.mtow_g, c_class: r.c_class,
        max_flight_min: r.max_flight_min, max_speed_kmh: r.max_speed_kmh, ceiling_m: r.ceiling_m, range_km: r.range_km,
        ...(r.image_url ? { image_url: r.image_url, cutout_url: '' } : {}),
      });
      if (!r.image_url) {
        setTriedFetch(true); // ingen bild online → visa bibliotek-väljaren som reserv
        Alert.alert('No image found', 'Fetched specs, but no online image for this drone. Pick one from your library.');
      }
      onSaved();
    } catch (e: any) {
      if (isTokenQuotaError(e)) {
        if (isPremium || isMax) showMonthlyTokenLimitAlert(); else setShowPremium(true);
      } else {
        setTriedFetch(true);
        Alert.alert('Lookup failed', e?.message || 'Could not fetch drone data. Check your connection and try again.');
      }
    } finally {
      setFetching(false);
    }
  };

  const mtow = mtowParts(m.mtow_g);
  const shownRegs = showAll ? regs : regs.slice(0, 3);
  const makerLine = m.manufacturer || '';

  const ZOOM = 1.05;
  const imgW = cw * ZOOM;
  const imgH = imgW / (aspect || 1.5);
  const imgStyle = { position: 'absolute' as const, left: -(cw * (ZOOM - 1)) / 2, top: -Math.max(0, imgH - BANNER_H) * 0.42, width: imgW, height: imgH };

  const SPEC_GROUPS = [
    { g: 'Airframe & properties', items: [
      { label: 'Type', value: TYPE_LABEL[m.drone_type] || (m.drone_type ? m.drone_type : '—'), unit: '' },
      { label: 'Range', value: m.range_km > 0 ? String(m.range_km) : '—', unit: 'km' },
      { label: 'MTOW', value: mtow.value, unit: mtow.unit },
    ] },
    { g: 'Performance', items: [
      { label: 'Max flight', value: numOr(m.max_flight_min), unit: 'min' },
      { label: 'Max speed', value: numOr(m.max_speed_kmh), unit: 'km/h' },
      { label: 'Ceiling', value: numOr(m.ceiling_m), unit: 'm' },
    ] },
  ];

  return (
    <View
      onLayout={(e) => setCw(e.nativeEvent.layout.width)}
      style={{ backgroundColor: DR.surface, borderWidth: 1, borderColor: current ? accent : DR.border, borderRadius: 18, overflow: 'hidden',
        ...(current ? { shadowColor: accent, shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 6 } : null) }}>

      {/* ── Banner: foto + urklipp som spiller över ── */}
      <View style={{ position: 'relative' }}>
        <View style={{ height: BANNER_H, overflow: 'hidden', backgroundColor: DR.elevated }}>
          {m.image_url ? <Image source={{ uri: m.image_url }} style={imgStyle} /> : null}
          <LinearGradient colors={[DR.surface + '00', DR.surface + '88', DR.surface]} locations={[0.38, 0.78, 1]}
            style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} pointerEvents="none" />
          {!m.image_url ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="hardware-chip-outline" size={26} color={DR.muted} />
            </View>
          ) : null}
        </View>
        {cutout ? (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 3, overflow: 'visible' }} pointerEvents="none">
            <Image source={{ uri: cutout }} style={[imgStyle, { shadowColor: DR.background, shadowOpacity: 0.55, shadowRadius: 8, shadowOffset: { width: 0, height: 8 } }]} />
          </View>
        ) : null}

        {current ? (
          <View style={{ position: 'absolute', top: 10, left: 14, zIndex: 4, backgroundColor: accent, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4 }}>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 8, fontWeight: '700', letterSpacing: 1, color: DR.inkOnAccent }}>NOW</Text>
          </View>
        ) : null}

        {/* bild-knappar: hämta online (alltid) + bibliotek-väljare (först efter miss online) */}
        <View style={{ position: 'absolute', top: 10, right: 12, zIndex: 4, flexDirection: 'row', gap: 6 }}>
          {triedFetch && !m.image_url ? (
            <TouchableOpacity onPress={pickImage} activeOpacity={0.8}
              style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: DR.background + 'CC', borderWidth: 1, borderColor: DR.border, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="image-outline" size={15} color={DR.text} />
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={fetchOnline} disabled={fetching} activeOpacity={0.8}
            style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: DR.background + 'CC', borderWidth: 1, borderColor: DR.border, alignItems: 'center', justifyContent: 'center' }}>
            {fetching ? <ActivityIndicator size="small" color={accent} /> : <Ionicons name={m.image_url ? 'refresh' : 'cloud-download-outline'} size={15} color={accent} />}
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Innehåll ── */}
      <View style={{ paddingHorizontal: 15, paddingBottom: 14, paddingTop: cutout ? 26 : 13, position: 'relative', zIndex: 1 }}>
        {/* header: modell + tillverkare */}
        <View style={{ marginBottom: 13 }}>
          <Text numberOfLines={1} style={{ fontFamily: FONT_SERIF, fontSize: 27, fontWeight: '600', color: DR.text, letterSpacing: -0.3 }}>{m.model || '—'}</Text>
          {makerLine ? <Text numberOfLines={1} style={{ fontSize: 12, color: DR.muted, marginTop: 3 }}>{makerLine}</Text> : null}
        </View>

        {/* total flight time (över alla registreringar) */}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: DR.separator }}>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: DR.muted }}>Total flight time</Text>
          <View style={{ flex: 1 }} />
          <Text style={{ fontFamily: FONT_SERIF, fontSize: 30, fontWeight: '600', color: DR.text, letterSpacing: -0.3 }}>
            {fmtTotal(m.total_hours)}<Text style={{ fontFamily: FONT_MONO, fontSize: 11, fontWeight: '700', color: accent }}> h</Text>
          </Text>
        </View>

        {/* spec-grupper */}
        {SPEC_GROUPS.map((group) => (
          <View key={group.g} style={{ marginTop: 11 }}>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: accent, marginBottom: 5 }}>{group.g}</Text>
            <View style={{ flexDirection: 'row' }}>
              {group.items.map((it, i) => (
                <Stat key={it.label} first={i === 0} label={it.label} value={it.value} unit={it.unit} />
              ))}
            </View>
          </View>
        ))}

        {/* registreringar (= pilot Fleet): reg + timmar med prickad ledarlinje */}
        <View style={{ marginTop: 13, paddingTop: 12, borderTopWidth: 1, borderTopColor: DR.separator }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 7 }}>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: DR.muted }}>Registrations</Text>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 9, fontWeight: '700', color: DR.text2 }}>{regs.length}</Text>
          </View>
          {shownRegs.length === 0 ? (
            <Text style={{ fontFamily: FONT_MONO, fontSize: 10, color: DR.muted }}>No registrations flown yet</Text>
          ) : shownRegs.map((r) => (
            <View key={r.drone_id} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, paddingVertical: 3 }}>
              <Text style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: '700', color: DR.text2, letterSpacing: 0.3 }}>{r.registration}</Text>
              <View style={{ flex: 1, borderBottomWidth: 1, borderStyle: 'dotted', borderColor: DR.border, transform: [{ translateY: -3 }] }} />
              <Text style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: DR.muted }}>{fmtTotal(r.hours)} h</Text>
            </View>
          ))}
          {regs.length > 3 ? (
            <TouchableOpacity onPress={() => setShowAll((v) => !v)} activeOpacity={0.7}
              style={{ marginTop: 9, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: DR.border, alignItems: 'center' }}>
              <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 0.6, color: accent }}>{showAll ? 'Show less' : `Show all ${regs.length}`}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* footer: penna → Manage drones */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', marginTop: 13 }}>
          <TouchableOpacity onPress={onManage} activeOpacity={0.8}
            style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: DR.elevated, borderWidth: 1, borderColor: DR.border, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="create-outline" size={15} color={DR.text2} />
          </TouchableOpacity>
        </View>
      </View>

      <PremiumModal visible={showPremium} onClose={() => setShowPremium(false)} feature="Drone image lookup" />
    </View>
  );
}
