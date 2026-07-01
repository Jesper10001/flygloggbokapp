// Andre pilot / cabin crew-väljare i samma stil som aircraft type/registration:
// [roll-pill (svart, vit figur)] [namn-ruta (svart) + chevron + "+"] [+figur / ✕].
// Namn-rutan fäller ner en dropdownflik med sparade namn i vertikala kolumner.
// Att välja ett sparat namn fyller även i den roll namnet senast hade (om känd).
import { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';

export type RoleOpt = { key: string; short: string; label: string };
export type SavedPerson = { name: string; role?: string };

const ROWS = 8;

export function PersonPicker({
  name, roleKey, roleOptions, saved, placeholder,
  onPick, onChangeRole, onAddNew, onAddMore, onRemove, onToggle,
}: {
  name: string;
  roleKey: string;
  roleOptions: RoleOpt[];
  saved: SavedPerson[];
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
  const openName = (v: boolean) => { setNameOpen(v); setRoleOpen(false); onToggle?.(v); };
  const openRole = (v: boolean) => { setRoleOpen(v); setNameOpen(false); onToggle?.(v); };
  const roleShort = roleOptions.find((r) => r.key === roleKey)?.short;

  const cols: SavedPerson[][] = [];
  for (let i = 0; i < saved.length; i += ROWS) cols.push(saved.slice(i, i + ROWS));

  return (
    <View style={{ position: 'relative', zIndex: (nameOpen || roleOpen) ? 30 : undefined }}>
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'stretch' }}>
        {/* roll-pill: svart bakgrund, vit figur (eller roll-kod i cyan) */}
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

        {/* namn-ruta: svart, värde + chevron + "+" (lägg till ny) */}
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

        {/* +figur (lägg till fler) eller ✕ (ta bort raden) */}
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

      {/* namn-dropdownflik: sparade namn i vertikala kolumner (8 per kolumn) */}
      {nameOpen && (
        <View style={[styles.flyout, { left: 0, right: 0 }]}>
          {name ? (
            <TouchableOpacity onPress={() => { onPick(''); openName(false); }} activeOpacity={0.7}
              style={{ paddingVertical: 6, marginBottom: 6, alignItems: 'center', borderRadius: 7, borderWidth: 1, borderColor: Colors.border }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: Colors.textMuted }}>— Clear</Text>
            </TouchableOpacity>
          ) : null}
          {saved.length === 0 ? (
            <Text style={{ fontFamily: 'JetBrainsMono', fontSize: 10, color: Colors.textMuted, padding: 2 }}>No saved names</Text>
          ) : (
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {cols.map((col, ci) => (
                <View key={ci} style={{ flex: 1, gap: 4 }}>
                  {col.map((p) => {
                    const active = name === p.name;
                    return (
                      <TouchableOpacity key={p.name} onPress={() => { onPick(p.name, p.role); openName(false); }} activeOpacity={0.75}
                        style={{ backgroundColor: active ? Colors.primary + '24' : Colors.card, borderWidth: 1, borderColor: active ? Colors.primary : Colors.border, borderRadius: 7, paddingVertical: 7, paddingHorizontal: 6, alignItems: 'center' }}>
                        <Text numberOfLines={1} style={{ fontSize: 12, fontWeight: '700', color: active ? Colors.primary : Colors.textSecondary }}>{p.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* roll-picker dropdown (under roll-pillen) */}
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
};
