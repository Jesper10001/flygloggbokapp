// Fleet-kort per modell: bild + spec, typ-rating, redigerbar perf, registreringar, senast flugen.
// Penna nere till höger. Hämta-knappen (steg 2) berikar spec + bild via AI/Wikipedia.
import { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Image, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import type { AircraftRegistryEntry } from '../../db/flights';
import { getRegistrationHours, updateAircraftFleetFields, persistAircraftFleetLookup } from '../../db/flights';
import { enrichAircraftFleet } from '../../services/aircraftLookup';
import { FONT_SERIF, FONT_MONO } from './tokens';
import { ratingStatus, ratingMeta } from './fleetTypeRating';
import { RatingModal } from './RatingModal';

const pad = (n: number) => String(n).padStart(2, '0');
const fmtTotal = (h: number) => `${Math.floor(h || 0)}:${pad(Math.round(((h || 0) % 1) * 60))}`;
function relMonth(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  const days = Math.round((Date.now() - d.getTime()) / 86400000);
  if (days < 1) return 'today';
  if (days < 30) return `${days}d ago`;
  const mo = Math.round(days / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
}

function StatCell({ label, value, unit, editing, onChange }: {
  label: string; value: string; unit: string; editing: boolean; onChange: (v: string) => void;
}) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ fontFamily: FONT_MONO, fontSize: 7.5, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: Colors.textMuted }}>{label}</Text>
      {editing ? (
        <TextInput value={value} onChangeText={(v) => onChange(v.replace(/[^0-9.]/g, ''))} inputMode="decimal"
          style={{ backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.primary, borderRadius: 5, color: Colors.textPrimary, fontFamily: FONT_MONO, fontSize: 12, fontWeight: '700', paddingHorizontal: 6, paddingVertical: 3 }} />
      ) : (
        <Text style={{ fontFamily: FONT_MONO, fontSize: 12.5, fontWeight: '700', color: Colors.textPrimary }}>
          {value || '—'}<Text style={{ fontSize: 8, color: Colors.textMuted }}> {unit}</Text>
        </Text>
      )}
    </View>
  );
}

export function FleetCard({ ac, accent, current, big, onSaved }: {
  ac: AircraftRegistryEntry; accent: string; current: boolean; big: boolean; onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showRating, setShowRating] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [regs, setRegs] = useState<{ registration: string; hours: number }[]>([]);
  const [s, setS] = useState({
    vne: ac.vne ? String(ac.vne) : '', cruise: ac.cruise_speed_kts ? String(ac.cruise_speed_kts) : '',
    endur: ac.endurance_h ? String(ac.endurance_h) : '', mtow: ac.mtow ? String(ac.mtow) : '',
    consum: ac.fuel_burn ? String(ac.fuel_burn) : '', power: ac.power_hp ? String(ac.power_hp) : '',
    ceiling: ac.ceiling_ft ? String(ac.ceiling_ft) : '', span: ac.wingspan_m ? String(ac.wingspan_m) : '',
    maker: ac.maker || '',
  });
  const set = (k: keyof typeof s) => (v: string) => setS((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    getRegistrationHours(ac.aircraft_type).then(setRegs);
  }, [ac.aircraft_type]);

  const savePerf = async () => {
    await updateAircraftFleetFields(ac.aircraft_type, {
      maker: s.maker.trim(), vne: parseFloat(s.vne) || 0, cruise_speed_kts: parseInt(s.cruise) || 0,
      endurance_h: parseFloat(s.endur) || 0, mtow: parseFloat(s.mtow) || 0,
      fuel_burn: parseFloat(s.consum) || 0, power_hp: parseInt(s.power) || 0,
      ceiling_ft: parseInt(s.ceiling) || 0, wingspan_m: parseFloat(s.span) || 0,
    });
    setEditing(false);
    onSaved();
  };

  // Steg 2: hämta full spec + bild på begäran.
  const fetchData = async () => {
    if (fetching) return;
    setFetching(true);
    try {
      const r = await enrichAircraftFleet(ac.aircraft_type);
      await persistAircraftFleetLookup(ac.aircraft_type, r);
      onSaved();
    } catch (e: any) {
      Alert.alert('Lookup failed', e?.message || 'Could not fetch aircraft data. Check your connection and try again.');
    } finally {
      setFetching(false);
    }
  };

  const hasRating = !!(ac.rating_class || ac.rating_expiry);
  const rt = ratingMeta(ratingStatus(ac.rating_expiry), Colors);
  const shownRegs = showAll ? regs : regs.slice(0, 3);

  return (
    <View style={{ backgroundColor: Colors.card, borderWidth: 1, borderColor: current ? accent + '88' : Colors.border, borderRadius: 16, padding: 13, gap: 11,
      ...(current ? { shadowColor: accent, shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 6 } : null) }}>
      {/* bild (öppen källa, hämtas via hämta-knappen) */}
      {ac.image_url ? (
        <Image source={{ uri: ac.image_url }} resizeMode="cover"
          style={{ width: '100%', height: big ? 190 : 130, borderRadius: 12, backgroundColor: Colors.elevated }} />
      ) : null}

      {/* header: modell + tillverkare + hämta-knapp */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontFamily: FONT_SERIF, fontSize: big ? 30 : 20, fontWeight: '600', color: Colors.textPrimary }}>{ac.aircraft_type}</Text>
            {current ? <View style={{ backgroundColor: accent, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 }}><Text style={{ fontFamily: FONT_MONO, fontSize: 7, fontWeight: '700', letterSpacing: 1, color: Colors.background }}>NOW</Text></View> : null}
          </View>
          {editing ? (
            <TextInput value={s.maker} onChangeText={set('maker')} placeholder="Manufacturer" placeholderTextColor={Colors.textMuted}
              style={{ fontSize: 11, color: Colors.textSecondary, marginTop: 2, padding: 0 }} />
          ) : (
            ac.maker ? <Text numberOfLines={1} style={{ fontSize: 10.5, color: Colors.textMuted, marginTop: 1 }}>{ac.maker}</Text> : null
          )}
        </View>
        <TouchableOpacity onPress={fetchData} disabled={fetching} activeOpacity={0.8}
          style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: accent + '18', borderWidth: 1, borderColor: accent + '55', alignItems: 'center', justifyContent: 'center' }}>
          {fetching ? <ActivityIndicator size="small" color={accent} /> : <Ionicons name={ac.image_url ? 'refresh' : 'cloud-download-outline'} size={16} color={accent} />}
        </TouchableOpacity>
      </View>

      {/* total + rating (rating tappbar → popup) */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 7.5, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: Colors.textMuted }}>Total time</Text>
          <Text style={{ fontFamily: FONT_MONO, fontSize: big ? 28 : 17, fontWeight: '700', color: accent }}>{fmtTotal(ac.total_hours)}</Text>
        </View>
        <TouchableOpacity onPress={() => setShowRating(true)} activeOpacity={0.7} style={{ alignItems: 'flex-end', maxWidth: '60%' }}>
          {hasRating ? (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: rt.color }} />
                <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, fontWeight: '700', color: rt.color }}>{rt.label}</Text>
              </View>
              <Text numberOfLines={1} style={{ fontFamily: FONT_MONO, fontSize: 8.5, color: Colors.textMuted, marginTop: 1, textAlign: 'right' }}>{[ac.rating_class, ac.rating_expiry ? ac.rating_expiry.slice(0, 7) : ''].filter(Boolean).join(' · ')}</Text>
            </>
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, borderWidth: 1, borderColor: accent + '66', borderRadius: 999, paddingLeft: 5, paddingRight: 7, paddingVertical: 2.5 }}>
              <Ionicons name="add" size={9} color={accent} />
              <Text style={{ fontFamily: FONT_MONO, fontSize: 8, fontWeight: '700', color: accent }}>Add rating</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* perf grid */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: 1, borderBottomWidth: 1, borderColor: Colors.separator, paddingVertical: 10 }}>
        <View style={{ width: '50%', paddingRight: 6, paddingBottom: 9 }}><StatCell label="VNE" value={s.vne} unit={ac.vne_unit || 'kt'} editing={editing} onChange={set('vne')} /></View>
        <View style={{ width: '50%', paddingLeft: 6, paddingBottom: 9 }}><StatCell label="Cruise" value={s.cruise} unit="kt" editing={editing} onChange={set('cruise')} /></View>
        <View style={{ width: '50%', paddingRight: 6, paddingBottom: 9 }}><StatCell label="Ceiling" value={s.ceiling} unit="ft" editing={editing} onChange={set('ceiling')} /></View>
        <View style={{ width: '50%', paddingLeft: 6, paddingBottom: 9 }}><StatCell label="Endurance" value={s.endur} unit="h" editing={editing} onChange={set('endur')} /></View>
        <View style={{ width: '50%', paddingRight: 6, paddingBottom: 9 }}><StatCell label="Consumption" value={s.consum} unit={ac.fuel_burn_unit || 'l/h'} editing={editing} onChange={set('consum')} /></View>
        <View style={{ width: '50%', paddingLeft: 6, paddingBottom: 9 }}><StatCell label="Horsepower" value={s.power} unit="hp" editing={editing} onChange={set('power')} /></View>
        <View style={{ width: '50%', paddingRight: 6 }}><StatCell label="MTOW" value={s.mtow} unit={ac.mtow_unit || 'kg'} editing={editing} onChange={set('mtow')} /></View>
        <View style={{ width: '50%', paddingLeft: 6 }}><StatCell label="Width" value={s.span} unit="m" editing={editing} onChange={set('span')} /></View>
      </View>

      {/* registreringar (mest timmar först) */}
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 7.5, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: Colors.textMuted }}>Registrations</Text>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 9, fontWeight: '700', color: Colors.textSecondary }}>{regs.length}</Text>
        </View>
        {shownRegs.length === 0 ? (
          <Text style={{ fontFamily: FONT_MONO, fontSize: 10, color: Colors.textMuted }}>No registrations flown yet</Text>
        ) : shownRegs.map((r) => (
          <View key={r.registration} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 2 }}>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 11, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.3 }}>{r.registration}</Text>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 10, color: Colors.textMuted }}>{fmtTotal(r.hours)}</Text>
          </View>
        ))}
        {regs.length > 3 ? (
          <TouchableOpacity onPress={() => setShowAll((v) => !v)} activeOpacity={0.7}
            style={{ marginTop: 7, paddingVertical: 5, borderRadius: 7, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' }}>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 9, fontWeight: '700', letterSpacing: 0.6, color: accent }}>{showAll ? 'Show less' : `Show all ${regs.length}`}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* senast flugen + redigera-penna (nere till höger) */}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Ionicons name="time-outline" size={10} color={Colors.textMuted} />
        <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, color: Colors.textMuted, marginLeft: 5, flex: 1 }}>Last flown {relMonth(ac.last_flown)}</Text>
        <TouchableOpacity onPress={() => (editing ? savePerf() : setEditing(true))} activeOpacity={0.8}
          style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: editing ? accent : Colors.elevated, borderWidth: 1, borderColor: editing ? accent : Colors.border, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={editing ? 'checkmark' : 'create-outline'} size={15} color={editing ? Colors.background : Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <RatingModal
        visible={showRating}
        title={`${ac.aircraft_type} rating`}
        initialName={ac.rating_class || `${ac.aircraft_type} type rating`}
        initialExpiry={ac.rating_expiry || ''}
        accent={accent}
        onSave={async (name, expiry) => { await updateAircraftFleetFields(ac.aircraft_type, { rating_class: name, rating_expiry: expiry }); setShowRating(false); onSaved(); }}
        onClose={() => setShowRating(false)}
      />
    </View>
  );
}
