// En sida i Fleet-karusellen för en flygplansfamilj (services/aircraftFamily.ts): varianter av samma modell
// (EC135T1, EC135T2) som egna typer med egna specifikationer och timmar. Överst familjens namn och en väljare:
// "All" visar familjens totala tid, en stapel per variant och registreringarna märkta med sin variant; en
// variant visar dagens Fleet-kort för den typen. Under kortet: "Not a variant" (egen typ) och, om flygningar
// slagits ihop hit från en annan variant, "Split into variants". En typ utan familj visas som förut, men med
// "Split into variants" om den har sammanslagna flygningar (FleetTypeFooter).
import { useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../../constants/colors';
import type { AircraftRegistryEntry } from '../../db/flights';
import { getRegistrationsForType, setAircraftFamily, splitMergedFlights } from '../../db/flights';
import { typeKey } from '../../services/scanTypes';
import { FONT_SERIF, FONT_MONO } from './tokens';
import { FleetCard } from './FleetCard';
import { GlassDialog, DialogIcon } from '../GlassDialog';

const pad = (n: number) => String(n).padStart(2, '0');
const fmtTotal = (h: number) => `${Math.floor(h || 0)}:${pad(Math.round(((h || 0) % 1) * 60))}`;
// Variantens etikett i väljaren: det som skiljer den från familjen (T1, LUH), annars hela namnet.
const shortName = (type: string, family: string) => {
  const t = typeKey(type), f = typeKey(family);
  return t.startsWith(f) && t.length > f.length ? t.slice(f.length) : type;
};

export function FleetFamilyPage({ family, members, accent, onSaved }: {
  family: string; members: AircraftRegistryEntry[]; accent: string; onSaved: () => void;
}) {
  const [sel, setSel] = useState<string>('all');
  // Mest flugen först.
  const vs = useMemo(() => [...members].sort((a, b) => (b.total_hours || 0) - (a.total_hours || 0)), [members]);
  const total = vs.reduce((s, v) => s + (v.total_hours || 0), 0);
  const cur = sel === 'all' ? null : vs.find((v) => v.aircraft_type === sel) ?? null;
  const shades = [accent, '#3E7FD8', Colors.textSecondary, Colors.gold];

  return (
    <View style={{ gap: 10 }}>
      <View style={{ gap: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 10, fontWeight: '700', letterSpacing: 1.4, color: accent }}>{family} FAMILY</Text>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 10, color: Colors.textMuted }}>{vs.length} variants</Text>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }} accessibilityRole="tablist">
          {[{ key: 'all', label: 'All', hours: total }, ...vs.map((v) => ({ key: v.aircraft_type, label: shortName(v.aircraft_type, family), hours: v.total_hours || 0 }))].map((p) => {
            const on = sel === p.key;
            return (
              <TouchableOpacity key={p.key} onPress={() => setSel(p.key)} activeOpacity={0.8} accessibilityRole="tab" accessibilityState={{ selected: on }}
                accessibilityLabel={`${p.key === 'all' ? `All ${family}` : p.key}, ${fmtTotal(p.hours)} hours`}
                style={{ paddingVertical: 6, paddingHorizontal: 11, borderRadius: 11, borderWidth: on ? 2 : 1, borderColor: on ? accent : Colors.border, backgroundColor: on ? accent + '1F' : Colors.surface, minWidth: 60 }}>
                <Text style={{ fontFamily: FONT_MONO, fontSize: 12, fontWeight: '700', color: Colors.textPrimary }}>{p.label}</Text>
                <Text style={{ fontFamily: FONT_MONO, fontSize: 10, color: Colors.textSecondary }}>{fmtTotal(p.hours)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {cur ? (
        <>
          <FleetCard key={cur.aircraft_type} ac={cur} accent={accent} onSaved={onSaved} />
          <FleetTypeFooter ac={cur} family={family} onSaved={onSaved} />
        </>
      ) : (
        <FamilySummary family={family} members={vs} total={total} shades={shades} accent={accent} />
      )}
    </View>
  );
}

function FamilySummary({ family, members, total, shades, accent }: {
  family: string; members: AircraftRegistryEntry[]; total: number; shades: string[]; accent: string;
}) {
  const [regs, setRegs] = useState<{ reg: string; tag: string; hours: number }[]>([]);
  const memberKey = members.map((m) => `${m.aircraft_type}:${m.total_hours}`).join('|');
  useEffect(() => {
    let alive = true;
    Promise.all(members.map(async (m) => (await getRegistrationsForType(m.aircraft_type)).map((r) => ({ reg: r.registration, tag: shortName(m.aircraft_type, family), hours: r.hours }))))
      .then((lists) => { if (alive) setRegs(lists.flat().sort((a, b) => b.hours - a.hours)); })
      .catch(() => {});
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberKey, family]);
  const top = members[0];
  const img = top?.image_url || '';
  const last = members.map((m) => m.last_flown).filter(Boolean).sort().pop() ?? '';
  const rating = members.map((m) => m.rating_class).find(Boolean) ?? family;

  return (
    <View style={{ borderRadius: 18, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' }}>
      <View style={{ height: 96, backgroundColor: Colors.elevated }}>
        {img ? <Image source={{ uri: img }} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} resizeMode="cover" /> : null}
        <LinearGradient colors={[Colors.card + '00', Colors.card + '99', Colors.card]} locations={[0.3, 0.75, 1]}
          style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} pointerEvents="none" />
      </View>
      <View style={{ paddingHorizontal: 15, paddingBottom: 15, gap: 12, marginTop: -18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10 }}>
          <Text style={{ flex: 1, fontFamily: FONT_SERIF, fontSize: 28, fontWeight: '600', color: Colors.textPrimary }}>{family}</Text>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 21, fontWeight: '700', color: Colors.textPrimary }}>
            {fmtTotal(total)}<Text style={{ fontSize: 10.5, color: accent }}> h</Text>
          </Text>
        </View>
        <Text style={{ marginTop: -8, fontFamily: FONT_MONO, fontSize: 10.5, color: Colors.textSecondary }}>
          {members.length} variants · {regs.length} registrations{last ? ` · last flown ${last}` : ''}
        </Text>

        <View style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', gap: 2, backgroundColor: Colors.surface }}
          accessible accessibilityLabel={members.map((m) => `${m.aircraft_type} ${fmtTotal(m.total_hours || 0)} hours`).join(', ')}>
          {members.map((m, i) => (
            <View key={m.aircraft_type} style={{ flex: Math.max(0.0001, m.total_hours || 0), backgroundColor: shades[i % shades.length] }} />
          ))}
        </View>
        <View style={{ gap: 6 }}>
          {members.map((m, i) => (
            <View key={m.aircraft_type} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{ width: 9, height: 9, borderRadius: 3, backgroundColor: shades[i % shades.length] }} />
              <Text style={{ flex: 1, fontFamily: FONT_MONO, fontSize: 12, color: Colors.textPrimary }}>{m.aircraft_type}</Text>
              <Text style={{ fontFamily: FONT_MONO, fontSize: 12, color: Colors.textPrimary }}>{fmtTotal(m.total_hours || 0)}</Text>
              <Text style={{ width: 38, textAlign: 'right', fontFamily: FONT_MONO, fontSize: 11, color: Colors.textMuted }}>
                {total > 0 ? `${Math.round(((m.total_hours || 0) / total) * 100)}%` : '—'}
              </Text>
            </View>
          ))}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.3, color: Colors.gold }}>TYPE RATING</Text>
          <Text style={{ fontFamily: FONT_MONO, fontSize: 12, fontWeight: '700', color: Colors.textPrimary }}>{rating}</Text>
        </View>

        {regs.length > 0 && (
          <View style={{ gap: 7 }}>
            <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.3, color: Colors.textMuted }}>REGISTRATIONS</Text>
            {regs.map((r) => (
              <View key={`${r.tag}:${r.reg}`} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
                <Text style={{ fontFamily: FONT_MONO, fontSize: 12.5, color: Colors.textPrimary }}>{r.reg}</Text>
                <Text style={{ fontFamily: FONT_MONO, fontSize: 9.5, fontWeight: '700', color: accent, borderWidth: 1, borderColor: accent + '66', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1, overflow: 'hidden' }}>{r.tag}</Text>
                <View style={{ flex: 1, borderBottomWidth: 1, borderStyle: 'dotted', borderBottomColor: Colors.border, marginBottom: 4 }} />
                <Text style={{ fontFamily: FONT_MONO, fontSize: 12.5, color: Colors.textPrimary }}>{fmtTotal(r.hours)}</Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

/** Under en typs Fleet-kort: vilken familj den hör till, "Not a variant", och "Split into variants". */
export function FleetTypeFooter({ ac, family, onSaved }: { ac: AircraftRegistryEntry; family?: string; onSaved: () => void }) {
  const merged = ac.merged_count || 0;
  const [ask, setAsk] = useState<'own' | 'split' | null>(null);
  if (!family && !merged) return null;
  const confirm = async () => {
    const what = ask;
    setAsk(null);
    if (what === 'own') await setAircraftFamily(ac.aircraft_type, '', true);
    if (what === 'split') await splitMergedFlights(ac.aircraft_type);
    onSaved();
  };
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 14, paddingHorizontal: 4 }}>
      <GlassDialog
        visible={!!ask}
        onClose={() => setAsk(null)}
        icon={<DialogIcon name={ask === 'split' ? 'git-branch-outline' : 'airplane-outline'} />}
        eyebrow={ask === 'split' ? 'SPLIT INTO VARIANTS' : 'OWN TYPE'}
        title={ask === 'split' ? `Split ${ac.aircraft_type} into variants?` : `Make ${ac.aircraft_type} its own type?`}
        body={ask === 'split'
          ? `${merged === 1 ? '1 flight was' : `${merged} flights were`} merged into ${ac.aircraft_type} from another variant. They get their own variant back, in the same family.`
          : `It leaves the ${family} family and gets its own total. Its flights don't change.`}
        primary={{ label: ask === 'split' ? 'Split' : 'Own type', onPress: confirm }}
        secondary={{ label: 'Cancel', onPress: () => setAsk(null) }}
      />
      {family ? <Text style={{ flex: 1, fontFamily: FONT_MONO, fontSize: 10.5, color: Colors.textSecondary }}>Variant of {family}</Text> : <View style={{ flex: 1 }} />}
      {merged > 0 && (
        <TouchableOpacity onPress={() => setAsk('split')} hitSlop={8} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="git-branch-outline" size={13} color={Colors.primary} />
          <Text style={{ fontSize: 12.5, fontWeight: '700', color: Colors.primary }}>Split into variants</Text>
        </TouchableOpacity>
      )}
      {family ? (
        <TouchableOpacity onPress={() => setAsk('own')} hitSlop={8} accessibilityRole="button">
          <Text style={{ fontSize: 12.5, fontWeight: '700', color: Colors.textSecondary }}>Not a variant</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}
