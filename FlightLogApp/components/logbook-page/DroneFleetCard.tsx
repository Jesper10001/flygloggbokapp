// Drönar-Fleet-kort (per MODELL) — VISUELL TVILLING till FleetCard (pilot logbook):
// fotobanner med VisionKit-urklipp som spiller över kortkanten, modell-header, "Total
// flight time" över alla registreringar, spec-grupper (airframe/prestanda/vikt) och en
// lista med registreringar + timmar. Navy via DR + accent. Foto väljs ur biblioteket
// eller hämtas online (Wikipedia via AI, token-styrt).
//
// Redigering (= pilot FleetCard): pennan nere till höger → inline-läge där modellnamn,
// tillverkare och specar blir redigerbara, registreringar byter namn i fritext (kaskaderar
// till flygningarna) och registreringar UTAN flygningar kan raderas. Hela modellen kan tas
// bort om den saknar loggade flygningar. Bocken sparar.
import { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Image, Alert, Dimensions, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { DR } from '../../constants/droneTheme';
import {
  type DroneModelFleet, getDroneModelRegistrations, updateDroneModelImage, persistDroneModelLookup,
  updateDroneModelFields, renameDroneModel, renameDroneRegistration, deleteDroneRegistration, deleteDroneModel,
} from '../../db/drones';
import { ensureAircraftCutout } from '../../services/aircraftCutout';
import { enrichDroneFleet } from '../../services/droneLookup';
import { PremiumModal } from '../PremiumModal';
import { useFlightStore } from '../../store/flightStore';
import { hasTokenQuota, showMonthlyTokenLimitAlert, isTokenQuotaError } from '../../utils/tokenGate';
import { FONT_SERIF, FONT_MONO } from './tokens';

const pad = (n: number) => String(n).padStart(2, '0');
const fmtTotal = (h: number) => `${Math.floor(h || 0)}:${pad(Math.round(((h || 0) % 1) * 60))}`;
const TYPE_LABEL: Record<string, string> = { multirotor: 'Multirotor', fixedwing: 'Fixed-wing', helicopter: 'Single-rotor', vtol: 'VTOL' };
const AIRFRAME_CYCLE = ['multirotor', 'fixedwing', 'helicopter', 'vtol'];
function mtowParts(g: number): { value: string; unit: string } {
  if (!g) return { value: '—', unit: '' };
  if (g >= 1000) return { value: (g / 1000).toFixed(g % 1000 === 0 ? 0 : 1), unit: 'kg' };
  return { value: String(g), unit: 'g' };
}
const numOr = (n: number) => (n > 0 ? String(n) : '—');

const BANNER_H = 110;

// En spec-cell, hårlinjedelad (första cellen utan vänsterkant). Numerisk redigering i edit-läge.
function Stat({ label, value, unit, first, editing, onChange, accent }: {
  label: string; value: string; unit?: string; first: boolean;
  editing?: boolean; onChange?: (v: string) => void; accent: string;
}) {
  return (
    <View style={{ flex: 1, paddingHorizontal: 11, borderLeftWidth: first ? 0 : 1, borderLeftColor: DR.separator, gap: 3, minWidth: 0 }}>
      <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: DR.muted }}>{label}</Text>
      {editing && onChange ? (
        <TextInput value={value === '—' ? '' : value} onChangeText={(v) => onChange(v.replace(/[^0-9.]/g, ''))} inputMode="decimal"
          style={{ backgroundColor: DR.background, borderWidth: 1, borderColor: accent, borderRadius: 5, color: DR.text, fontFamily: FONT_MONO, fontSize: 14, fontWeight: '700', paddingHorizontal: 5, paddingVertical: 2 }} />
      ) : (
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontFamily: FONT_MONO, fontSize: 15, fontWeight: '700', color: DR.text }}>
          {value || '—'}<Text style={{ fontSize: 9, color: DR.muted, fontWeight: '500' }}>{value && value !== '—' && unit ? ' ' + unit : ''}</Text>
        </Text>
      )}
    </View>
  );
}

export function DroneFleetCard({ m, accent, current, onSaved }: {
  m: DroneModelFleet;
  accent: string;
  current: boolean;
  onSaved: () => void;
}) {
  const [cw, setCw] = useState(Dimensions.get('window').width - 28);
  const [aspect, setAspect] = useState(1.5);
  const [cutout, setCutout] = useState<string | null>(m.cutout_url || null);
  const [fetching, setFetching] = useState(false);
  const [showPremium, setShowPremium] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [regs, setRegs] = useState<{ registration: string; drone_id: number; hours: number; flightCount: number }[]>([]);
  const { isPremium, isMax } = useFlightStore();

  // Redigerbart läge (= pilot FleetCard)
  const [editing, setEditing] = useState(false);
  const [modelName, setModelName] = useState(m.model);          // modellnamn (rename → kaskad)
  const [maker, setMaker] = useState(m.manufacturer || '');     // tillverkare
  const [regEdits, setRegEdits] = useState<Record<number, string>>({}); // drone_id → nytt reg-namn
  const [s, setS] = useState({
    drone_type: m.drone_type || '',
    mtow_g: m.mtow_g ? String(m.mtow_g) : '',
    range_km: m.range_km ? String(m.range_km) : '',
    max_flight_min: m.max_flight_min ? String(m.max_flight_min) : '',
    max_speed_kmh: m.max_speed_kmh ? String(m.max_speed_kmh) : '',
    ceiling_m: m.ceiling_m ? String(m.ceiling_m) : '',
  });
  const set = (k: keyof typeof s) => (v: string) => setS((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    getDroneModelRegistrations(m.model).then(setRegs).catch(() => {});
  }, [m.model]);

  useEffect(() => { if (!editing) setModelName(m.model); }, [m.model, editing]);
  useEffect(() => { if (!editing) setMaker(m.manufacturer || ''); }, [m.manufacturer, editing]);
  // Resynka spec-buffertar när m ändras (t.ex. efter online-hämtning) och vi inte redigerar.
  useEffect(() => {
    if (editing) return;
    setS({
      drone_type: m.drone_type || '',
      mtow_g: m.mtow_g ? String(m.mtow_g) : '',
      range_km: m.range_km ? String(m.range_km) : '',
      max_flight_min: m.max_flight_min ? String(m.max_flight_min) : '',
      max_speed_kmh: m.max_speed_kmh ? String(m.max_speed_kmh) : '',
      ceiling_m: m.ceiling_m ? String(m.ceiling_m) : '',
    });
  }, [m.drone_type, m.mtow_g, m.range_km, m.max_flight_min, m.max_speed_kmh, m.ceiling_m, editing]);

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
        Alert.alert('No image found', 'Fetched specs, but no online image for this drone. Pick one from your library.');
      }
      onSaved();
    } catch (e: any) {
      if (isTokenQuotaError(e)) {
        if (isPremium || isMax) showMonthlyTokenLimitAlert(); else setShowPremium(true);
      } else {
        Alert.alert('Lookup failed', e?.message || 'Could not fetch drone data. Check your connection and try again.');
      }
    } finally {
      setFetching(false);
    }
  };

  const cycleAirframe = () => setS((p) => {
    const i = AIRFRAME_CYCLE.indexOf(p.drone_type);
    return { ...p, drone_type: AIRFRAME_CYCLE[(i + 1) % AIRFRAME_CYCLE.length] };
  });

  // Spara: modellnamn (rename → kaskad) → registrerings-namnbyten → specar.
  const savePerf = async () => {
    const newModel = modelName.trim();
    const renamed = !!newModel && newModel !== m.model;
    if (renamed) await renameDroneModel(m.model, newModel);
    const target = renamed ? newModel : m.model;
    for (const [idStr, val] of Object.entries(regEdits)) {
      const nv = val.trim().toUpperCase();
      const r = regs.find((x) => x.drone_id === Number(idStr));
      if (nv && r && nv !== r.registration.toUpperCase()) await renameDroneRegistration(Number(idStr), nv);
    }
    await updateDroneModelFields(target, {
      drone_type: s.drone_type,
      manufacturer: maker.trim(),
      mtow_g: parseInt(s.mtow_g, 10) || 0,
      range_km: parseFloat(s.range_km) || 0,
      max_flight_min: parseInt(s.max_flight_min, 10) || 0,
      max_speed_kmh: parseFloat(s.max_speed_kmh) || 0,
      ceiling_m: parseInt(s.ceiling_m, 10) || 0,
    });
    setRegEdits({});
    setRegs(await getDroneModelRegistrations(target));
    setEditing(false);
    onSaved();
  };

  // Ta bort en registrering (bara de utan flygningar — gate:as i renderingen).
  const removeReg = (droneId: number, reg: string) => {
    Alert.alert(reg, 'Remove this registration from your fleet?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        await deleteDroneRegistration(droneId);
        setRegs(await getDroneModelRegistrations(m.model));
        onSaved();
      } },
    ]);
  };

  // Ta bort hela modellen (alla registreringar) — bara om inga loggade flygningar finns.
  const removeModel = () => {
    Alert.alert(m.model, 'Remove this drone model and all its registrations from your fleet?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => { await deleteDroneModel(m.model); onSaved(); } },
    ]);
  };

  const mtow = mtowParts(m.mtow_g);
  const shownRegs = showAll ? regs : regs.slice(0, 3);
  const makerLine = m.manufacturer || '';
  // Reload/hämta-knappen visas BARA när kortet är ofullständigt (saknar bild ELLER kärndata) →
  // syftet blir att försöka hämta igen om första hämtningen misslyckades.
  const needsFetch = !m.image_url || !m.manufacturer || !m.mtow_g || !m.max_flight_min || !m.max_speed_kmh || !m.ceiling_m || !m.range_km;

  const ZOOM = 1.05;
  const imgW = cw * ZOOM;
  const imgH = imgW / (aspect || 1.5);
  const imgStyle = { position: 'absolute' as const, left: -(cw * (ZOOM - 1)) / 2, top: -Math.max(0, imgH - BANNER_H) * 0.42, width: imgW, height: imgH };

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
          {/* Välj egen bild ur biblioteket — alltid tillgänglig i övre högra hörnet. */}
          <TouchableOpacity onPress={pickImage} activeOpacity={0.8}
            style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: DR.background + 'CC', borderWidth: 1, borderColor: DR.border, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="image-outline" size={15} color={DR.text} />
          </TouchableOpacity>
          {(needsFetch || fetching) && (
            <TouchableOpacity onPress={fetchOnline} disabled={fetching} activeOpacity={0.8}
              style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: DR.background + 'CC', borderWidth: 1, borderColor: DR.border, alignItems: 'center', justifyContent: 'center' }}>
              {fetching ? <ActivityIndicator size="small" color={accent} /> : <Ionicons name={m.image_url ? 'refresh' : 'cloud-download-outline'} size={15} color={accent} />}
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Innehåll ── */}
      <View style={{ paddingHorizontal: 15, paddingBottom: 14, paddingTop: cutout ? 26 : 13, position: 'relative', zIndex: 1 }}>
        {/* header: modell + tillverkare (redigerbara i edit-läge) */}
        <View style={{ marginBottom: 13 }}>
          {editing ? (
            <TextInput value={modelName} onChangeText={setModelName} autoCorrect={false}
              placeholder={m.model} placeholderTextColor={DR.muted}
              style={{ fontFamily: FONT_SERIF, fontSize: 26, fontWeight: '600', color: DR.text, letterSpacing: -0.3, borderBottomWidth: 1, borderBottomColor: accent, paddingVertical: 2, paddingHorizontal: 0 }} />
          ) : (
            <Text numberOfLines={1} style={{ fontFamily: FONT_SERIF, fontSize: 27, fontWeight: '600', color: DR.text, letterSpacing: -0.3 }}>{m.model || '—'}</Text>
          )}
          {editing ? (
            <>
              <TextInput value={maker} onChangeText={setMaker} autoCapitalize="words" autoCorrect={false}
                placeholder="Manufacturer" placeholderTextColor={DR.muted}
                style={{ fontSize: 12, color: DR.text2, marginTop: 5, borderBottomWidth: 1, borderBottomColor: DR.border, paddingVertical: 1, paddingHorizontal: 0 }} />
              <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, color: DR.muted, marginTop: 4, letterSpacing: 0.3 }}>Renaming updates the logbook & export for all flights on this model</Text>
            </>
          ) : makerLine ? (
            <Text numberOfLines={1} style={{ fontSize: 12, color: DR.muted, marginTop: 3 }}>{makerLine}</Text>
          ) : null}
        </View>

        {/* total flight time (över alla registreringar) */}
        <View style={{ flexDirection: 'row', alignItems: 'baseline', paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: DR.separator }}>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: DR.muted }}>Total flight time</Text>
          <View style={{ flex: 1 }} />
          <Text style={{ fontFamily: FONT_SERIF, fontSize: 30, fontWeight: '600', color: DR.text, letterSpacing: -0.3 }}>
            {fmtTotal(m.total_hours)}<Text style={{ fontFamily: FONT_MONO, fontSize: 11, fontWeight: '700', color: accent }}> h</Text>
          </Text>
        </View>

        {/* spec-grupp 1: Airframe & properties (Type-cellen: tap för att växla i edit-läge) */}
        <View style={{ marginTop: 11 }}>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: accent, marginBottom: 5 }}>Airframe & properties</Text>
          <View style={{ flexDirection: 'row' }}>
            {/* Type */}
            <View style={{ flex: 1, paddingHorizontal: 11, gap: 3, minWidth: 0 }}>
              <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: DR.muted }}>Type</Text>
              {editing ? (
                <TouchableOpacity onPress={cycleAirframe} activeOpacity={0.7}
                  style={{ borderWidth: 1, borderColor: accent, borderRadius: 5, paddingHorizontal: 5, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text numberOfLines={1} style={{ fontFamily: FONT_MONO, fontSize: 11.5, fontWeight: '700', color: DR.text }}>{TYPE_LABEL[s.drone_type] || '—'}</Text>
                  <Ionicons name="swap-horizontal" size={11} color={accent} />
                </TouchableOpacity>
              ) : (
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontFamily: FONT_MONO, fontSize: 15, fontWeight: '700', color: DR.text }}>
                  {TYPE_LABEL[m.drone_type] || (m.drone_type ? m.drone_type : '—')}
                </Text>
              )}
            </View>
            <Stat first={false} accent={accent} editing={editing} label="Range" unit="km"
              value={editing ? s.range_km : (m.range_km > 0 ? String(m.range_km) : '—')} onChange={set('range_km')} />
            <Stat first={false} accent={accent} editing={editing} label="MTOW" unit={editing ? 'g' : mtow.unit}
              value={editing ? s.mtow_g : mtow.value} onChange={set('mtow_g')} />
          </View>
        </View>

        {/* spec-grupp 2: Performance */}
        <View style={{ marginTop: 11 }}>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: accent, marginBottom: 5 }}>Performance</Text>
          <View style={{ flexDirection: 'row' }}>
            <Stat first accent={accent} editing={editing} label="Max flight" unit="min"
              value={editing ? s.max_flight_min : numOr(m.max_flight_min)} onChange={set('max_flight_min')} />
            <Stat first={false} accent={accent} editing={editing} label="Max speed" unit="km/h"
              value={editing ? s.max_speed_kmh : numOr(m.max_speed_kmh)} onChange={set('max_speed_kmh')} />
            <Stat first={false} accent={accent} editing={editing} label="Ceiling" unit="m"
              value={editing ? s.ceiling_m : numOr(m.ceiling_m)} onChange={set('ceiling_m')} />
          </View>
        </View>

        {/* registreringar (= pilot Fleet): reg + timmar; i edit-läge fritext-namnbyte + gate:ad radering */}
        <View style={{ marginTop: 13, paddingTop: 12, borderTopWidth: 1, borderTopColor: DR.separator }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 7 }}>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: DR.muted }}>Registrations</Text>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 9, fontWeight: '700', color: DR.text2 }}>{regs.length}</Text>
          </View>
          {editing ? (
            <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, color: DR.muted, marginBottom: 6, letterSpacing: 0.3 }}>Edit a registration to rename it everywhere · only registrations with no flights can be removed</Text>
          ) : null}
          {shownRegs.length === 0 ? (
            <Text style={{ fontFamily: FONT_MONO, fontSize: 10, color: DR.muted }}>No registrations flown yet</Text>
          ) : shownRegs.map((r) => (
            <View key={r.drone_id} style={{ flexDirection: 'row', alignItems: editing ? 'center' : 'baseline', gap: 8, paddingVertical: 3 }}>
              {editing ? (
                <>
                  <TextInput value={regEdits[r.drone_id] ?? r.registration}
                    onChangeText={(v) => setRegEdits((p) => ({ ...p, [r.drone_id]: v.toUpperCase() }))}
                    autoCapitalize="characters" autoCorrect={false} placeholder={r.registration} placeholderTextColor={DR.muted}
                    style={{ flex: 1, fontFamily: FONT_MONO, fontSize: 13, fontWeight: '700', color: DR.text, letterSpacing: 0.3, borderBottomWidth: 1, borderBottomColor: accent, paddingVertical: 2, paddingHorizontal: 0 }} />
                  {r.flightCount === 0 ? (
                    <TouchableOpacity onPress={() => removeReg(r.drone_id, r.registration)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close-circle" size={16} color={DR.danger} />
                    </TouchableOpacity>
                  ) : (
                    <Text style={{ fontFamily: FONT_MONO, fontSize: 9, color: DR.muted }}>{fmtTotal(r.hours)} h</Text>
                  )}
                </>
              ) : (
                <>
                  <Text style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: '700', color: DR.text2, letterSpacing: 0.3 }}>{r.registration}</Text>
                  <View style={{ flex: 1, borderBottomWidth: 1, borderStyle: 'dotted', borderColor: DR.border, transform: [{ translateY: -3 }] }} />
                  <Text style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: DR.muted }}>{fmtTotal(r.hours)} h</Text>
                </>
              )}
            </View>
          ))}
          {regs.length > 3 ? (
            <TouchableOpacity onPress={() => setShowAll((v) => !v)} activeOpacity={0.7}
              style={{ marginTop: 9, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: DR.border, alignItems: 'center' }}>
              <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 0.6, color: accent }}>{showAll ? 'Show less' : `Show all ${regs.length}`}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* footer: (Remove model om inga flygningar) + penna → redigera/spara */}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 13 }}>
          <View style={{ flex: 1 }} />
          {editing && m.flight_count === 0 ? (
            <TouchableOpacity onPress={removeModel} activeOpacity={0.8}
              style={{ height: 28, paddingHorizontal: 10, borderRadius: 8, backgroundColor: DR.danger + '1A', borderWidth: 1, borderColor: DR.danger + '88', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 5, marginRight: 8 }}>
              <Ionicons name="trash-outline" size={13} color={DR.danger} />
              <Text style={{ fontFamily: FONT_MONO, fontSize: 9, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase', color: DR.danger }}>Remove model</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={() => (editing ? savePerf() : setEditing(true))} activeOpacity={0.8}
            style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: editing ? accent : DR.elevated, borderWidth: 1, borderColor: editing ? accent : DR.border, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={editing ? 'checkmark' : 'create-outline'} size={15} color={editing ? DR.inkOnAccent : DR.text2} />
          </TouchableOpacity>
        </View>
      </View>

      <PremiumModal visible={showPremium} onClose={() => setShowPremium(false)} feature="Drone image lookup" />
    </View>
  );
}
