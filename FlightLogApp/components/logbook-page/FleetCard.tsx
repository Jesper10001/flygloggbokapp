// Fleet-kort "Ledger": fotobanner där motivet (luftfartyget) lyfts ur bakgrunden
// (VisionKit) och spiller över kortkanten i 3D. Spec i 3 grupper (redigerbara),
// typ-rating i headern, registreringar med prickad ledarlinje. Penna nere till höger.
// Bild: Wikipedia-hämtning (hämta-knapp) eller välj/byt från Foton.
import { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Image, ActivityIndicator, Alert, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { Colors } from '../../constants/colors';
import type { AircraftRegistryEntry } from '../../db/flights';
import { getRegistrationsForType, updateAircraftFleetFields, persistAircraftFleetLookup, deleteRegistrationFromRegistry, deleteAircraftType, renameAircraftType, renameRegistration } from '../../db/flights';
import { enrichAircraftFleet } from '../../services/aircraftLookup';
import { ensureAircraftCutout } from '../../services/aircraftCutout';
import { FONT_SERIF, FONT_MONO } from './tokens';
import { PremiumModal } from '../PremiumModal';
import { useFlightStore } from '../../store/flightStore';
import { hasTokenQuota, showMonthlyTokenLimitAlert, isTokenQuotaError } from '../../utils/tokenGate';

const pad = (n: number) => String(n).padStart(2, '0');
const fmtTotal = (h: number) => `${Math.floor(h || 0)}:${pad(Math.round(((h || 0) % 1) * 60))}`;
const fmtNum = (n: number) => (n ? Number(n).toLocaleString('en-US') : '');

const BANNER_H = 110;

// Ikon per spec-grupp (avionik-känsla i sektionsrubrikerna).
const GROUP_ICON: Record<string, any> = {
  'Performance': 'speedometer-outline',
  'Weights': 'barbell-outline',
  'Range & endurance': 'navigate-outline',
};

// En spec-cell, hårlinjedelad (första cellen utan vänsterkant).
function Stat({ label, value, unit, first, editing, onChange }: {
  label: string; value: string; unit: string; first: boolean; editing: boolean; onChange: (v: string) => void;
}) {
  return (
    <View style={{ flex: 1, paddingHorizontal: 11, borderLeftWidth: first ? 0 : 1, borderLeftColor: Colors.separator, gap: 3, minWidth: 0 }}>
      <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: Colors.textMuted }}>{label}</Text>
      {editing ? (
        <TextInput value={value} onChangeText={(v) => onChange(v.replace(/[^0-9.]/g, ''))} inputMode="decimal"
          style={{ backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.accent, borderRadius: 5, color: Colors.textPrimary, fontFamily: FONT_MONO, fontSize: 14, fontWeight: '700', paddingHorizontal: 5, paddingVertical: 2 }} />
      ) : (
        <Text numberOfLines={1} style={{ fontFamily: FONT_MONO, fontSize: 15, fontWeight: '700', color: Colors.textPrimary }}>
          {value || '—'}<Text style={{ fontSize: 9, color: Colors.textMuted, fontWeight: '500' }}>{value ? ' ' + unit : ''}</Text>
        </Text>
      )}
    </View>
  );
}

export function FleetCard({ ac, accent, current, onSaved }: {
  ac: AircraftRegistryEntry; accent: string; current: boolean; big?: boolean; onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [typeName, setTypeName] = useState(ac.aircraft_type); // redigerbart typnamn (styr loggbok + export)
  const [showAll, setShowAll] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [showPremium, setShowPremium] = useState(false);
  const { isPremium, isMax } = useFlightStore();
  const [regs, setRegs] = useState<{ registration: string; hours: number; flightCount: number }[]>([]);
  // Namnbyten på registreringar i redigeringsläge: gammalt namn → nytt fritextvärde.
  const [regEdits, setRegEdits] = useState<Record<string, string>>({});
  const [cw, setCw] = useState(Dimensions.get('window').width - 28);
  const [aspect, setAspect] = useState(1.5);
  const [cutout, setCutout] = useState<string | null>(ac.cutout_url || null);
  const [s, setS] = useState({
    vne: ac.vne ? String(ac.vne) : '', cruise: ac.cruise_speed_kts ? String(ac.cruise_speed_kts) : '',
    ceiling: ac.ceiling_ft ? String(ac.ceiling_ft) : '', mtow: ac.mtow ? String(ac.mtow) : '',
    empty: ac.empty_weight_kg ? String(ac.empty_weight_kg) : '', fuel: ac.fuel_capacity_l ? String(ac.fuel_capacity_l) : '',
    range: ac.range_nm ? String(ac.range_nm) : '', endur: ac.endurance_h ? String(ac.endurance_h) : '',
    consum: ac.fuel_burn ? String(ac.fuel_burn) : '',
  });
  const set = (k: keyof typeof s) => (v: string) => setS((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    getRegistrationsForType(ac.aircraft_type).then(setRegs);
  }, [ac.aircraft_type]);

  useEffect(() => { if (!editing) setTypeName(ac.aircraft_type); }, [ac.aircraft_type, editing]);

  // Resynka redigerbara fält när ac ändras (t.ex. efter "hämta") — kortet remountas inte.
  useEffect(() => {
    if (editing) return;
    setS({
      vne: ac.vne ? String(ac.vne) : '', cruise: ac.cruise_speed_kts ? String(ac.cruise_speed_kts) : '',
      ceiling: ac.ceiling_ft ? String(ac.ceiling_ft) : '', mtow: ac.mtow ? String(ac.mtow) : '',
      empty: ac.empty_weight_kg ? String(ac.empty_weight_kg) : '', fuel: ac.fuel_capacity_l ? String(ac.fuel_capacity_l) : '',
      range: ac.range_nm ? String(ac.range_nm) : '', endur: ac.endurance_h ? String(ac.endurance_h) : '',
      consum: ac.fuel_burn ? String(ac.fuel_burn) : '',
    });
  }, [ac.vne, ac.cruise_speed_kts, ac.ceiling_ft, ac.mtow, ac.empty_weight_kg, ac.fuel_capacity_l, ac.range_nm, ac.endurance_h, ac.fuel_burn, editing]);

  // Bildaspekt (för banner-/cutout-skalning) + subject-lift-urklipp (cachas).
  useEffect(() => {
    let alive = true;
    if (!ac.image_url) { setCutout(null); return; }
    Image.getSize(ac.image_url, (w, h) => { if (alive && h > 0) setAspect(w / h); }, () => {});
    (async () => {
      const r = await ensureAircraftCutout(ac.image_url);
      if (!alive) return;
      setCutout(r.cutout);
      if (r.cutout && r.cutout !== ac.cutout_url) {
        updateAircraftFleetFields(ac.aircraft_type, { cutout_url: r.cutout }).catch(() => {});
      }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ac.image_url, ac.aircraft_type]);

  const savePerf = async () => {
    // Namnbyte: uppdaterar registret OCH alla flighter (loggbok/export följer med).
    const newType = typeName.trim().toUpperCase();
    const renamed = !!newType && newType !== ac.aircraft_type;
    if (renamed) await renameAircraftType(ac.aircraft_type, newType);
    const target = renamed ? newType : ac.aircraft_type;
    // Registrerings-namnbyten (fritext): uppdaterar flighter + registret överallt.
    for (const [oldReg, val] of Object.entries(regEdits)) {
      const nv = val.trim().toUpperCase();
      if (nv && nv !== oldReg.toUpperCase()) await renameRegistration(oldReg, nv);
    }
    await updateAircraftFleetFields(target, {
      vne: parseFloat(s.vne) || 0, cruise_speed_kts: parseInt(s.cruise) || 0, ceiling_ft: parseInt(s.ceiling) || 0,
      mtow: parseFloat(s.mtow) || 0, empty_weight_kg: parseFloat(s.empty) || 0, fuel_capacity_l: parseFloat(s.fuel) || 0,
      range_nm: parseFloat(s.range) || 0, endurance_h: parseFloat(s.endur) || 0, fuel_burn: parseFloat(s.consum) || 0,
    });
    setRegEdits({});
    setRegs(await getRegistrationsForType(target));
    setEditing(false);
    onSaved();
  };

  // Ta bort en registrering ur registret (registrering hanteras här i Fleet, inte i Log Flight).
  const removeReg = (reg: string) => {
    Alert.alert(reg, 'Remove this registration from your fleet?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        await deleteRegistrationFromRegistry(reg);
        setRegs(await getRegistrationsForType(ac.aircraft_type));
        onSaved();
      } },
    ]);
  };

  // Ta bort hela farkosttypen (alla dess registreringar) ur registret.
  const removeType = () => {
    Alert.alert(ac.aircraft_type, 'Remove this aircraft type and all its registrations from your fleet?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => { await deleteAircraftType(ac.aircraft_type); onSaved(); } },
    ]);
  };

  // Hämta full spec + bild (Wikipedia/AI) på begäran.
  const fetchData = async () => {
    if (fetching) return;
    // Token-styrt, inte premium-låst: fri nivå får hämta tills engångspotten tar slut.
    if (!hasTokenQuota()) {
      if (isPremium || isMax) { showMonthlyTokenLimitAlert(); } else { setShowPremium(true); }
      return;
    }
    setFetching(true);
    try {
      const r = await enrichAircraftFleet(ac.aircraft_type);
      await persistAircraftFleetLookup(ac.aircraft_type, r);
      onSaved();
    } catch (e: any) {
      if (isTokenQuotaError(e)) {
        if (isPremium || isMax) showMonthlyTokenLimitAlert(); else setShowPremium(true);
      } else {
        Alert.alert('Lookup failed', e?.message || 'Could not fetch aircraft data. Check your connection and try again.');
      }
    } finally {
      setFetching(false);
    }
  };

  // Välj/byt bild från Foton → spara som image_url, nollställ cutout (regenereras).
  const pickImage = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, exif: false });
      if (res.canceled || !res.assets?.[0]) return;
      await updateAircraftFleetFields(ac.aircraft_type, { image_url: res.assets[0].uri, cutout_url: '' });
      onSaved();
    } catch (e: any) {
      Alert.alert('Could not set photo', e?.message || 'Try again.');
    }
  };

  const shownRegs = showAll ? regs : regs.slice(0, 3);
  const makerLine = ac.maker || '';
  // Reload/hämta-knappen visas BARA när kortet är ofullständigt (saknar bild ELLER kärndata) →
  // syftet blir att försöka hämta igen om första hämtningen misslyckades.
  const needsFetch = !ac.image_url || !ac.maker || !ac.vne || !ac.cruise_speed_kts || !ac.mtow || !ac.ceiling_ft || !ac.range_nm;

  // Lätt utzoomning (1.05×) så hela farkosten syns; vertikalt centrerad med liten
  // uppåt-bias så motivet (cutout) ändå spiller något nedåt över kortkanten.
  const ZOOM = 1.05;
  const imgW = cw * ZOOM;
  const imgH = imgW / (aspect || 1.5);
  const imgStyle = { position: 'absolute' as const, left: -(cw * (ZOOM - 1)) / 2, top: -Math.max(0, imgH - BANNER_H) * 0.42, width: imgW, height: imgH };

  const SPEC_GROUPS = [
    { g: 'Performance', items: [
      { k: 'vne' as const, label: 'VNE', value: s.vne, unit: ac.vne_unit || 'kt' },
      { k: 'cruise' as const, label: 'Cruise', value: s.cruise, unit: 'kt' },
      { k: 'ceiling' as const, label: 'Ceiling', value: editing ? s.ceiling : fmtNum(ac.ceiling_ft), unit: 'ft' },
    ] },
    { g: 'Weights', items: [
      { k: 'mtow' as const, label: 'MTOW', value: editing ? s.mtow : fmtNum(ac.mtow), unit: ac.mtow_unit || 'kg' },
      { k: 'empty' as const, label: 'Empty', value: editing ? s.empty : fmtNum(ac.empty_weight_kg), unit: 'kg' },
      { k: 'fuel' as const, label: 'Fuel', value: editing ? s.fuel : fmtNum(ac.fuel_capacity_l), unit: 'L' },
    ] },
    { g: 'Range & endurance', items: [
      { k: 'range' as const, label: 'Range', value: editing ? s.range : fmtNum(ac.range_nm), unit: 'NM' },
      { k: 'endur' as const, label: 'Endurance', value: s.endur, unit: 'h' },
      { k: 'consum' as const, label: 'Consumption', value: s.consum, unit: ac.fuel_burn_unit || 'l/h' },
    ] },
  ];

  return (
    <View
      onLayout={(e) => setCw(e.nativeEvent.layout.width)}
      style={{ backgroundColor: Colors.card, borderWidth: 1, borderColor: current ? accent : Colors.border, borderRadius: 18, overflow: 'hidden',
        ...(current ? { shadowColor: accent, shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 8 }, elevation: 6 } : null) }}>

      {/* ── Banner: foto (Layer A) + urklipp som spiller över (Layer B) ── */}
      <View style={{ position: 'relative' }}>
        <View style={{ height: BANNER_H, overflow: 'hidden', backgroundColor: Colors.elevated }}>
          {ac.image_url ? <Image source={{ uri: ac.image_url }} style={imgStyle} /> : null}
          <LinearGradient colors={[Colors.card + '00', Colors.card + '88', Colors.card]} locations={[0.38, 0.78, 1]}
            style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} pointerEvents="none" />
          {!ac.image_url ? (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="airplane-outline" size={26} color={Colors.textMuted} />
            </View>
          ) : null}
        </View>
        {/* cutout (iOS 17+) — samma skala/position, tillåts spilla nedåt */}
        {cutout ? (
          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 3, overflow: 'visible' }} pointerEvents="none">
            <Image source={{ uri: cutout }} style={[imgStyle, { shadowColor: Colors.background, shadowOpacity: 0.55, shadowRadius: 8, shadowOffset: { width: 0, height: 8 } }]} />
          </View>
        ) : null}

        {current ? (
          <View style={{ position: 'absolute', top: 10, left: 14, zIndex: 4, backgroundColor: accent, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4 }}>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 8, fontWeight: '700', letterSpacing: 1, color: Colors.card }}>NOW</Text>
          </View>
        ) : null}

        {/* bild-knappar uppe till höger: hämta (alltid) + bibliotek-väljare
            (visas FÖRST efter en hämtning utan träff online). */}
        <View style={{ position: 'absolute', top: 10, right: 12, zIndex: 4, flexDirection: 'row', gap: 6 }}>
          {/* Välj egen bild ur biblioteket — alltid tillgänglig i övre högra hörnet. */}
          <TouchableOpacity onPress={pickImage} activeOpacity={0.8}
            style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: Colors.background + 'CC', borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="image-outline" size={15} color={Colors.textPrimary} />
          </TouchableOpacity>
          {(needsFetch || fetching) && (
            <TouchableOpacity onPress={fetchData} disabled={fetching} activeOpacity={0.8}
              style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: Colors.background + 'CC', borderWidth: 1, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' }}>
              {fetching ? <ActivityIndicator size="small" color={accent} /> : <Ionicons name={ac.image_url ? 'refresh' : 'cloud-download-outline'} size={15} color={accent} />}
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Innehåll ── */}
      <View style={{ paddingHorizontal: 15, paddingBottom: 14, paddingTop: cutout ? 26 : 13, position: 'relative', zIndex: 1 }}>
        {/* header: modell + total på type (samma rad, tiden i höjd med modellen) + maker */}
        <View style={{ marginBottom: 3, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: Colors.separator }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
            {editing ? (
              <TextInput value={typeName} onChangeText={(v) => setTypeName(v.toUpperCase())} autoCapitalize="characters" autoCorrect={false}
                placeholder={ac.aircraft_type} placeholderTextColor={Colors.textMuted}
                style={{ flex: 1, fontFamily: FONT_SERIF, fontSize: 27, fontWeight: '600', color: Colors.textPrimary, letterSpacing: -0.3, borderBottomWidth: 1, borderBottomColor: accent, paddingVertical: 2, paddingHorizontal: 0 }} />
            ) : (
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: FONT_SERIF, fontSize: 27, fontWeight: '600', color: Colors.textPrimary, letterSpacing: -0.3 }}>{ac.aircraft_type}</Text>
            )}
            <Text style={{ fontFamily: FONT_SERIF, fontSize: 24, fontWeight: '600', color: Colors.textPrimary, letterSpacing: -0.3 }}>
              {fmtTotal(ac.total_hours)}<Text style={{ fontFamily: FONT_MONO, fontSize: 10.5, fontWeight: '700', color: accent }}> h</Text>
            </Text>
          </View>
          {editing ? (
            <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, color: Colors.textMuted, marginTop: 4, letterSpacing: 0.3 }}>Renaming updates the logbook & export for all flights on this type</Text>
          ) : makerLine ? (
            <Text numberOfLines={1} style={{ fontSize: 12, color: Colors.textMuted, marginTop: 3 }}>{makerLine}</Text>
          ) : null}
        </View>

        {/* spec-grupper (ikon + rubrik till vänster, hårlinjedelad rad — som förut) */}
        {SPEC_GROUPS.map((group) => (
          <View key={group.g} style={{ marginTop: 11 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 5 }}>
              <Ionicons name={GROUP_ICON[group.g] ?? 'stats-chart-outline'} size={11} color={accent} />
              <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: accent }}>{group.g}</Text>
            </View>
            <View style={{ flexDirection: 'row' }}>
              {group.items.map((it, i) => (
                <Stat key={it.k} first={i === 0} label={it.label} value={it.value} unit={it.unit} editing={editing} onChange={set(it.k)} />
              ))}
            </View>
          </View>
        ))}

        {/* registreringar */}
        <View style={{ marginTop: 13, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.separator }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 7 }}>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: Colors.textMuted }}>Registrations</Text>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 9, fontWeight: '700', color: Colors.textSecondary }}>{regs.length}</Text>
          </View>
          {editing ? (
            <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, color: Colors.textMuted, marginBottom: 6, letterSpacing: 0.3 }}>Edit a registration to rename it everywhere · only registrations with no flights can be removed</Text>
          ) : null}
          {shownRegs.length === 0 ? (
            <Text style={{ fontFamily: FONT_MONO, fontSize: 10, color: Colors.textMuted }}>No registrations flown yet</Text>
          ) : shownRegs.map((r) => (
            <View key={r.registration} style={{ flexDirection: 'row', alignItems: editing ? 'center' : 'baseline', gap: 8, paddingVertical: 3 }}>
              {editing ? (
                <>
                  <TextInput value={regEdits[r.registration] ?? r.registration}
                    onChangeText={(v) => setRegEdits((p) => ({ ...p, [r.registration]: v.toUpperCase() }))}
                    autoCapitalize="characters" autoCorrect={false} placeholder={r.registration} placeholderTextColor={Colors.textMuted}
                    style={{ flex: 1, fontFamily: FONT_MONO, fontSize: 13, fontWeight: '700', color: Colors.textPrimary, letterSpacing: 0.3, borderBottomWidth: 1, borderBottomColor: accent, paddingVertical: 2, paddingHorizontal: 0 }} />
                  {r.flightCount === 0 ? (
                    <TouchableOpacity onPress={() => removeReg(r.registration)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Ionicons name="close-circle" size={16} color={Colors.danger} />
                    </TouchableOpacity>
                  ) : (
                    <Text style={{ fontFamily: FONT_MONO, fontSize: 9, color: Colors.textMuted }}>{fmtTotal(r.hours)} h</Text>
                  )}
                </>
              ) : (
                <>
                  <Text style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.3 }}>{r.registration}</Text>
                  <View style={{ flex: 1, borderBottomWidth: 1, borderStyle: 'dotted', borderColor: Colors.border, transform: [{ translateY: -3 }] }} />
                  <Text style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: Colors.textMuted }}>{fmtTotal(r.hours)} h</Text>
                </>
              )}
            </View>
          ))}
          {regs.length > 3 ? (
            <TouchableOpacity onPress={() => setShowAll((v) => !v)} activeOpacity={0.7}
              style={{ marginTop: 9, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' }}>
              <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 0.6, color: accent }}>{showAll ? 'Show less' : `Show all ${regs.length}`}</Text>
            </TouchableOpacity>
          ) : null}
        </View>

        {/* footer: first flight + last flown (nere till vänster) + penna (nere till höger) */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 11 }}>
          <View style={{ marginRight: 18 }}>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: Colors.textMuted }}>First flight</Text>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 11, fontWeight: '700', color: Colors.textSecondary, marginTop: 2 }}>{ac.first_flown || '—'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: Colors.textMuted }}>Last flown</Text>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 11, fontWeight: '700', color: Colors.textSecondary, marginTop: 2 }}>{ac.last_flown || '—'}</Text>
          </View>
          {/* Remove type visas BARA om inga loggade flighter finns (annars skulle det påverka loggboken). */}
          {editing && ac.flight_count === 0 ? (
            <TouchableOpacity onPress={removeType} activeOpacity={0.8}
              style={{ height: 28, paddingHorizontal: 10, borderRadius: 8, backgroundColor: Colors.danger + '1A', borderWidth: 1, borderColor: Colors.danger + '88', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 5, marginRight: 8 }}>
              <Ionicons name="trash-outline" size={13} color={Colors.danger} />
              <Text style={{ fontFamily: FONT_MONO, fontSize: 9, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase', color: Colors.danger }}>Remove type</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={() => (editing ? savePerf() : setEditing(true))} activeOpacity={0.8}
            style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: editing ? accent : Colors.elevated, borderWidth: 1, borderColor: editing ? accent : Colors.border, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={editing ? 'checkmark' : 'create-outline'} size={15} color={editing ? Colors.background : Colors.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      <PremiumModal visible={showPremium} onClose={() => setShowPremium(false)} feature="Aircraft data lookup" />
    </View>
  );
}
