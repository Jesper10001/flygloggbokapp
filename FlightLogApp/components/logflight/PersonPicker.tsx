// Andre pilot / cabin crew-väljare. Rutan är INTE sökbar — ett tryck öppnar direkt
// förslagslistan. För second pilot (byAircraft satt): topp = de 12 senast flugna piloterna
// (3 kolumner), sedan en collapsible rad per flygfarkosttyp. Vald aktuell aircraft_type visar
// sina RESTERANDE piloter; övriga visar alla sina piloter.
// Förslagsknapparna (chipsen) VISAR förkortat namn: "Johan Johansson" → "J. Johansson", men när
// man valt en pilot skrivs HELA namnet ut i rutan. Datan lagras alltid fullständig (export orörd).
import { useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';

export type RoleOpt = { key: string; short: string; label: string };
export type SavedPerson = { name: string; role?: string };
export type AircraftPilots = { aircraft: string; pilots: string[]; isHeli?: boolean };

const HELI_GLYPH = require('../../assets/Pilot-helicopter.PNG');
const FIXED_GLYPH = require('../../assets/Pilot-fixedwing.PNG');

const ROWS = 8;         // kolumnhöjd i det enkla (cabin crew) läget
const RECENT_TOP = 12;  // 3 kolumner × 4 rader

// Endast för CHIPSEN: förkortar "Johan Johansson" → "J. Johansson". Ett-ords-namn/callsign lämnas.
const abbrev = (s: string) => {
  const parts = s.trim().split(/\s+/).filter(Boolean);
  return parts.length >= 2 && parts[0] ? `${parts[0][0].toUpperCase()}. ${parts.slice(1).join(' ')}` : s;
};

export function PersonPicker({
  name, roleKey, roleOptions, saved, byAircraft, currentAircraft, placeholder,
  onPick, onChangeRole, onAddNew, onAddMore, onRemove, onToggle,
}: {
  name: string;
  roleKey: string;
  roleOptions: RoleOpt[];
  saved: SavedPerson[];
  byAircraft?: AircraftPilots[];
  currentAircraft?: string;
  placeholder: string;
  onPick: (name: string, role?: string) => void;
  onChangeRole: (key: string) => void;
  onAddNew: () => void;
  onAddMore?: () => void;
  onRemove?: () => void;
  onToggle?: (open: boolean) => void;
}) {
  const [nameOpen, setNameOpen] = useState(false);
  const [roleOpen, setRoleOpen] = useState(false);
  const [openAc, setOpenAc] = useState<Set<string>>(new Set());
  const advanced = !!byAircraft;
  const disp = (n: string) => (advanced ? abbrev(n) : n); // förkortning bara på chipsen

  const openName = (v: boolean) => { setNameOpen(v); setRoleOpen(false); onToggle?.(v); };
  const openRole = (v: boolean) => { setRoleOpen(v); setNameOpen(false); onToggle?.(v); };
  const roleShort = roleOptions.find((r) => r.key === roleKey)?.short;

  const roleOf = (n: string) => saved.find((s) => s.name === n)?.role;
  const pick = (n: string, r?: string) => { onPick(n, r); openName(false); };

  // 3-kolumnsrutnät (radordning = listordning); chipsen visar förkortat namn.
  const grid3 = (people: SavedPerson[]) => {
    const cols: SavedPerson[][] = [[], [], []];
    people.forEach((p, i) => cols[i % 3].push(p));
    return (
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {cols.map((col, ci) => (
          <View key={ci} style={{ flex: 1, gap: 4 }}>
            {col.map((p) => {
              const active = name === p.name;
              return (
                <TouchableOpacity key={p.name} onPress={() => pick(p.name, p.role)} activeOpacity={0.75}
                  style={{ backgroundColor: active ? Colors.primary + '24' : Colors.card, borderWidth: 1, borderColor: active ? Colors.primary : Colors.border, borderRadius: 7, paddingVertical: 7, paddingHorizontal: 6, alignItems: 'center' }}>
                  <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: '700', color: active ? Colors.primary : Colors.textSecondary }}>{disp(p.name)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ))}
      </View>
    );
  };

  const simpleCols: SavedPerson[][] = [];
  for (let i = 0; i < saved.length; i += ROWS) simpleCols.push(saved.slice(i, i + ROWS));

  const top12Names = new Set(saved.slice(0, RECENT_TOP).map((s) => s.name));
  const orderedAircraft = advanced
    ? [...byAircraft!].sort((a, b) => (a.aircraft === currentAircraft ? -1 : 0) - (b.aircraft === currentAircraft ? -1 : 0))
    : [];
  const pilotsFor = (ac: AircraftPilots): SavedPerson[] => {
    const names = ac.aircraft === currentAircraft ? ac.pilots.filter((n) => !top12Names.has(n)) : ac.pilots;
    return names.map((n) => ({ name: n, role: roleOf(n) }));
  };
  const toggleAc = (a: string) => setOpenAc((prev) => { const next = new Set(prev); next.has(a) ? next.delete(a) : next.add(a); return next; });

  return (
    <View style={{ position: 'relative', zIndex: (nameOpen || roleOpen) ? 30 : undefined }}>
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'stretch' }}>
        {/* roll-pill */}
        <TouchableOpacity
          onPress={() => openRole(!roleOpen)}
          activeOpacity={0.75}
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, minWidth: 48, paddingHorizontal: 8, height: 44,
            backgroundColor: Colors.elevated, borderWidth: 1, borderColor: roleKey ? Colors.primary : Colors.border, borderRadius: 10 }}
        >
          {roleShort
            ? <Text style={{ fontFamily: 'JetBrainsMono', fontSize: 11, fontWeight: '800', color: Colors.primary }} numberOfLines={1}>{roleShort}</Text>
            : <Ionicons name="person" size={15} color="#FFFFFF" />}
          <Ionicons name="chevron-down" size={10} color={Colors.textMuted} />
        </TouchableOpacity>

        {/* namn-ruta: tryck öppnar listan direkt (ingen sökning). Visar HELA valda namnet. */}
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', height: 44, paddingHorizontal: 11, backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border, borderRadius: 10 }}>
          <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, height: '100%' }} onPress={() => openName(!nameOpen)} activeOpacity={0.7}>
            <Text style={{ flex: 1, fontSize: 14, fontWeight: '700', color: name ? Colors.textPrimary : Colors.textMuted }} numberOfLines={1}>{name || placeholder}</Text>
            <Ionicons name={nameOpen ? 'chevron-up' : 'chevron-down'} size={15} color={Colors.textSecondary} />
          </TouchableOpacity>
          <View style={{ width: 1, height: 20, backgroundColor: Colors.border, marginHorizontal: 6 }} />
          <TouchableOpacity onPress={() => { openName(false); onAddNew(); }} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }} activeOpacity={0.7}>
            <Ionicons name="add" size={18} color={Colors.primary} />
          </TouchableOpacity>
        </View>

        {/* +figur (fler) eller ✕ (ta bort) */}
        {onAddMore ? (
          <TouchableOpacity onPress={onAddMore} activeOpacity={0.75}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 1, width: 48, height: 44,
              backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border, borderRadius: 10 }}>
            <Ionicons name="add" size={13} color={Colors.primary} />
            <Ionicons name="person" size={15} color={Colors.primary} />
          </TouchableOpacity>
        ) : onRemove ? (
          <TouchableOpacity onPress={onRemove} activeOpacity={0.75} style={{ width: 30, height: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* namn-dropdown */}
      {nameOpen && (
        <View style={[styles.flyout, { left: 0, right: 0 }]}>
          <ScrollView style={{ maxHeight: 300 }} keyboardShouldPersistTaps="handled" nestedScrollEnabled showsVerticalScrollIndicator>
            {name ? (
              <TouchableOpacity onPress={() => { onPick(''); openName(false); }} activeOpacity={0.7}
                style={{ paddingVertical: 6, marginBottom: 6, alignItems: 'center', borderRadius: 7, borderWidth: 1, borderColor: Colors.border }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.textMuted }}>— Clear</Text>
              </TouchableOpacity>
            ) : null}
            {advanced ? (
              (saved.length === 0 && orderedAircraft.length === 0) ? (
                <Text style={{ fontFamily: 'JetBrainsMono', fontSize: 10, color: Colors.textMuted, padding: 2 }}>No saved pilots yet</Text>
              ) : (
              <>
                {saved.length > 0 && (
                  <>
                    <Text style={styles.section}>RECENT</Text>
                    {grid3(saved.slice(0, RECENT_TOP))}
                  </>
                )}
                {orderedAircraft.map((ac) => {
                  const isOpen = openAc.has(ac.aircraft);
                  return (
                    <View key={ac.aircraft} style={{ marginTop: 8 }}>
                      <TouchableOpacity onPress={() => toggleAc(ac.aircraft)} activeOpacity={0.7}
                        style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 8, backgroundColor: ac.aircraft === currentAircraft ? Colors.primary + '14' : Colors.card, borderWidth: 1, borderColor: ac.aircraft === currentAircraft ? Colors.primary : Colors.border, borderRadius: 7 }}>
                        <Image source={ac.isHeli ? HELI_GLYPH : FIXED_GLYPH} style={{ width: 20, height: 20, tintColor: Colors.primary }} resizeMode="contain" />
                        <Text style={{ flex: 1, fontSize: 12, fontWeight: '700', color: Colors.textPrimary, fontFamily: 'JetBrainsMono' }}>{ac.aircraft}</Text>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: Colors.textMuted, fontFamily: 'JetBrainsMono' }}>({ac.pilots.length})</Text>
                        <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={13} color={Colors.textMuted} />
                      </TouchableOpacity>
                      {isOpen && (
                        <View style={{ marginTop: 4 }}>
                          {(() => { const ps = pilotsFor(ac); return ps.length ? grid3(ps) : <Text style={{ fontFamily: 'JetBrainsMono', fontSize: 10, color: Colors.textMuted, padding: 4 }}>All already shown above</Text>; })()}
                        </View>
                      )}
                    </View>
                  );
                })}
              </>
              )
            ) : (
              saved.length === 0
                ? <Text style={{ fontFamily: 'JetBrainsMono', fontSize: 10, color: Colors.textMuted, padding: 2 }}>No saved names</Text>
                : (
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {simpleCols.map((col, ci) => (
                      <View key={ci} style={{ flex: 1, gap: 4 }}>
                        {col.map((p) => {
                          const active = name === p.name;
                          return (
                            <TouchableOpacity key={p.name} onPress={() => pick(p.name, p.role)} activeOpacity={0.75}
                              style={{ backgroundColor: active ? Colors.primary + '24' : Colors.card, borderWidth: 1, borderColor: active ? Colors.primary : Colors.border, borderRadius: 7, paddingVertical: 7, paddingHorizontal: 6, alignItems: 'center' }}>
                              <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: '700', color: active ? Colors.primary : Colors.textSecondary }}>{p.name}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    ))}
                  </View>
                )
            )}
          </ScrollView>
        </View>
      )}

      {/* roll-picker dropdown */}
      {roleOpen && (
        <View style={[styles.flyout, { left: 0, width: 170 }]}>
          {[{ key: '', short: '', label: '— Clear' }, ...roleOptions].map((opt) => (
            <TouchableOpacity key={opt.key || 'clear'} onPress={() => { onChangeRole(opt.key); openRole(false); }} activeOpacity={0.7}
              style={{ paddingHorizontal: 10, paddingVertical: 9, borderRadius: 6, backgroundColor: roleKey === opt.key ? Colors.primary + '14' : undefined }}>
              <Text style={{ color: roleKey === opt.key ? Colors.primary : Colors.textPrimary, fontSize: 13, fontWeight: '600' }}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = {
  flyout: {
    position: 'absolute' as const, top: '100%' as const, marginTop: 4, zIndex: 50, elevation: 8,
    backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, padding: 8,
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 6 },
  },
  section: { fontFamily: 'JetBrainsMono' as const, fontSize: 8.5, fontWeight: '700' as const, letterSpacing: 1, color: Colors.textMuted, marginBottom: 5 },
};
