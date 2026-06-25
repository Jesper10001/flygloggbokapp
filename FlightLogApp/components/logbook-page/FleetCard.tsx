// Fleet-kort per modell: total tid, typ-rating, redigerbar perf (VNE/Cruise/Endurance/MTOW),
// registreringar (top-3 + show all), senast flugen.
import { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import type { AircraftRegistryEntry } from '../../db/flights';
import { getRegistrationHours, updateAircraftFleetFields } from '../../db/flights';
import { FONT_SERIF, FONT_MONO } from './tokens';
import { ratingStatus, ratingMeta } from './fleetTypeRating';

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
  const [regs, setRegs] = useState<{ registration: string; hours: number }[]>([]);
  const [s, setS] = useState({
    vne: ac.vne ? String(ac.vne) : '', cruise: ac.cruise_speed_kts ? String(ac.cruise_speed_kts) : '',
    endur: ac.endurance_h ? String(ac.endurance_h) : '', mtow: ac.mtow ? String(ac.mtow) : '',
    maker: ac.maker || '', ratingClass: ac.rating_class || '', ratingExpiry: ac.rating_expiry || '',
  });
  const set = (k: keyof typeof s) => (v: string) => setS((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    getRegistrationHours(ac.aircraft_type).then(setRegs);
  }, [ac.aircraft_type]);

  const save = async () => {
    await updateAircraftFleetFields(ac.aircraft_type, {
      maker: s.maker.trim(), vne: parseFloat(s.vne) || 0, cruise_speed_kts: parseInt(s.cruise) || 0,
      endurance_h: parseFloat(s.endur) || 0, mtow: parseFloat(s.mtow) || 0,
      rating_class: s.ratingClass.trim(), rating_expiry: /^\d{4}-\d{2}-\d{2}$/.test(s.ratingExpiry.trim()) ? s.ratingExpiry.trim() : '',
    });
    setEditing(false);
    onSaved();
  };

  const rt = ratingMeta(ratingStatus(s.ratingExpiry || ac.rating_expiry), Colors);
  const shownRegs = showAll ? regs : regs.slice(0, 3);

  return (
    <View style={{ backgroundColor: Colors.card, borderWidth: 1, borderColor: current ? accent + '88' : Colors.border, borderRadius: 16, padding: 13, gap: 11,
      ...(current ? { shadowColor: accent, shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 6 } : null) }}>
      {/* header */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={{ fontFamily: FONT_SERIF, fontSize: big ? 30 : 20, fontWeight: '600', color: Colors.textPrimary }}>{ac.aircraft_type}</Text>
            {current ? <View style={{ backgroundColor: accent, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 }}><Text style={{ fontFamily: FONT_MONO, fontSize: 7, fontWeight: '700', letterSpacing: 1, color: Colors.background }}>NOW</Text></View> : null}
          </View>
          {editing ? (
            <TextInput value={s.maker} onChangeText={set('maker')} placeholder="Manufacturer" placeholderTextColor={Colors.textMuted}
              style={{ fontSize: 11, color: Colors.textSecondary, marginTop: 2, padding: 0 }} />
          ) : (
            <Text numberOfLines={1} style={{ fontSize: 10.5, color: Colors.textMuted, marginTop: 1 }}>{ac.maker || 'Tap pencil to add details'}</Text>
          )}
        </View>
        <TouchableOpacity onPress={() => (editing ? save() : setEditing(true))} activeOpacity={0.8}
          style={{ width: 26, height: 26, borderRadius: 7, backgroundColor: editing ? accent : Colors.elevated, borderWidth: 1, borderColor: editing ? accent : Colors.border, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={editing ? 'checkmark' : 'create-outline'} size={14} color={editing ? Colors.background : Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* total + rating */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 7.5, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: Colors.textMuted }}>Total time</Text>
          <Text style={{ fontFamily: FONT_MONO, fontSize: big ? 28 : 17, fontWeight: '700', color: accent }}>{fmtTotal(ac.total_hours)}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: rt.color }} />
            <Text style={{ fontFamily: FONT_MONO, fontSize: 9, fontWeight: '700', color: rt.color }}>{rt.label}</Text>
          </View>
          {editing ? (
            <View style={{ alignItems: 'flex-end', gap: 3, marginTop: 4 }}>
              <TextInput value={s.ratingClass} onChangeText={set('ratingClass')} placeholder="Class/rating" placeholderTextColor={Colors.textMuted}
                style={{ fontFamily: FONT_MONO, fontSize: 9, color: Colors.textPrimary, textAlign: 'right', padding: 0, minWidth: 90 }} />
              <TextInput value={s.ratingExpiry} onChangeText={set('ratingExpiry')} placeholder="YYYY-MM-DD" placeholderTextColor={Colors.textMuted}
                style={{ fontFamily: FONT_MONO, fontSize: 9, color: Colors.textPrimary, textAlign: 'right', padding: 0, minWidth: 90 }} />
            </View>
          ) : (
            (ac.rating_class || ac.rating_expiry) ? (
              <Text style={{ fontFamily: FONT_MONO, fontSize: 9, color: Colors.textMuted, marginTop: 1 }}>{[ac.rating_class, ac.rating_expiry ? ac.rating_expiry.slice(0, 7) : ''].filter(Boolean).join(' · ')}</Text>
            ) : null
          )}
        </View>
      </View>

      {/* perf grid */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', borderTopWidth: 1, borderBottomWidth: 1, borderColor: Colors.separator, paddingVertical: 10 }}>
        <View style={{ width: '50%', paddingRight: 6, paddingBottom: 9 }}><StatCell label="VNE" value={s.vne} unit={ac.vne_unit || 'kt'} editing={editing} onChange={set('vne')} /></View>
        <View style={{ width: '50%', paddingLeft: 6, paddingBottom: 9 }}><StatCell label="Cruise" value={s.cruise} unit="kt" editing={editing} onChange={set('cruise')} /></View>
        <View style={{ width: '50%', paddingRight: 6 }}><StatCell label="Endurance" value={s.endur} unit="h" editing={editing} onChange={set('endur')} /></View>
        <View style={{ width: '50%', paddingLeft: 6 }}><StatCell label="MTOW" value={s.mtow} unit={ac.mtow_unit || 'kg'} editing={editing} onChange={set('mtow')} /></View>
      </View>

      {/* registreringar */}
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

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
        <Ionicons name="time-outline" size={10} color={Colors.textMuted} />
        <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, color: Colors.textMuted }}>Last flown {relMonth(ac.last_flown)}</Text>
      </View>
    </View>
  );
}
