// En flygning i flygalbumet: omslaget överst, en tidslinje med var bilderna togs, bilderna uppdelade före start /
// i luften / efter landning. Select → markera bilder och ta bort dem ur albumet eller gör en till omslag.
import { useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { FONT_SERIF } from '../logbook-page/tokens';
import { AssetImage } from './AssetImage';
import type { AlbumFlight, AlbumPhoto } from '../../services/photoSync';

const LIGHT = '#7FDCEF';
const DANGER = '#FF8A8A';
const pad = (n: number) => String(n).padStart(2, '0');
const utc = (t: number) => { const d = new Date(t); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };

export function routeText(f: { dep_place: string; arr_place: string }): string {
  return f.dep_place === f.arr_place ? `${f.dep_place} · local` : `${f.dep_place} → ${f.arr_place}`;
}
export function phaseText(p: AlbumPhoto): string {
  if (p.uri) return 'Added by hand';
  if (p.phase === 'before') return `${p.rel} min before take-off`;
  if (p.phase === 'after') return `${p.rel} min after landing`;
  if (p.phase === 'air') return `In the air, ${p.rel} min after take-off`;
  return 'Photo';
}
function caption(p: AlbumPhoto): string {
  if (p.phase === 'before') return `−${p.rel} min`;
  if (p.phase === 'after') return `+${p.rel} min`;
  if (p.phase === 'air' && p.takenAt) return utc(p.takenAt);
  return '';
}
function fmtDur(sec: number): string {
  const s = Math.round(sec || 0);
  return `${Math.floor(s / 60)}:${pad(s % 60)}`;
}

export function FlightAlbumView({ af, vis, cover, depName, arrName, onBack, onOpen, onRemove, onSetCover }: {
  af: AlbumFlight; vis: AlbumPhoto[]; cover: AlbumPhoto | null; depName: string; arrName: string;
  onBack: () => void; onOpen: (p: AlbumPhoto) => void; onRemove: (ps: AlbumPhoto[]) => void; onSetCover: (p: AlbumPhoto) => void;
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [selecting, setSelecting] = useState(false);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const f = af.flight;
  const tile = (width - 40 - 6) / 3;
  const selected = vis.filter((p) => sel[p.key]);
  const allSel = vis.length > 0 && selected.length === vis.length;

  const groups = useMemo(() => ([
    ['before', 'BEFORE TAKE-OFF'], ['air', 'IN THE AIR'], ['after', 'AFTER LANDING'], ['unknown', 'MORE PHOTOS'],
  ] as const).map(([ph, label]) => ({ label, items: vis.filter((p) => (p.phase === ph && !p.uri) || (ph === 'unknown' && !!p.uri)) }))
    .filter((g) => g.items.length > 0), [vis]);

  // Tidslinjen: från den tidigaste bilden före start till den sista efter landning (minst 15 min åt varje håll).
  const timed = vis.filter((p) => p.takenAt && p.phase !== 'unknown');
  const TW = width - 40 - 34;
  let befMax = 15, aftMax = 15;
  for (const p of timed) {
    if (p.phase === 'before') befMax = Math.max(befMax, p.rel);
    if (p.phase === 'after') aftMax = Math.max(aftMax, p.rel);
  }
  const block = Math.max(1, (af.arr - af.dep) / 60000);
  const span = befMax + block + aftMax;
  const xOf = (p: AlbumPhoto) => {
    const m = p.phase === 'before' ? befMax - p.rel : p.phase === 'after' ? befMax + block + p.rel : befMax + p.frac * block;
    return Math.max(0, Math.min(TW - 8, (m / span) * TW - 4));
  };

  const toggle = (p: AlbumPhoto) => setSel((cur) => ({ ...cur, [p.key]: !cur[p.key] }));
  const stopSelect = () => { setSelecting(false); setSel({}); };
  const oneSynced = selected.length === 1 && !!selected[0].localId;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ paddingBottom: selecting ? 170 : insets.bottom + 40 }}>
        <View style={{ height: 330 }}>
          {cover
            ? <AssetImage localId={cover.localId} uri={cover.uri} isVideo={cover.isVideo} style={StyleSheet.absoluteFill as any} />
            : <View style={[StyleSheet.absoluteFill, { backgroundColor: Colors.card }]} />}
          <LinearGradient colors={['rgba(6,12,24,0.45)', 'rgba(6,12,24,0)', 'rgba(6,12,24,0)', 'rgba(9,20,36,0.96)']} locations={[0, 0.3, 0.45, 1]} style={StyleSheet.absoluteFill} />
          <View style={{ position: 'absolute', left: 20, right: 20, bottom: 16, gap: 6 }}>
            <Text style={s.route}>{routeText(f)}</Text>
            <Text style={{ fontSize: 14, color: '#E6EEF5' }}>
              {f.dep_place === f.arr_place ? `${depName} local flight` : `${depName} → ${arrName}`} · {f.date}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
              {[[f.aircraft_type, f.registration].filter(Boolean).join(' · '), f.dep_utc && f.arr_utc ? `${f.dep_utc}–${f.arr_utc}` : '', `${vis.length} photo${vis.length === 1 ? '' : 's'}`]
                .filter(Boolean).map((c) => <View key={c} style={s.chip}><Text style={s.chipText}>{c}</Text></View>)}
            </View>
          </View>
        </View>

        <View style={{ paddingHorizontal: 20, paddingTop: 14, gap: 22 }}>
          {timed.length > 0 && (
            <View style={s.card}>
              <View style={{ height: 22, width: TW }}>
                <View style={{ position: 'absolute', left: 0, right: 0, top: 10, height: 2, borderRadius: 1, backgroundColor: '#22344F' }} />
                <View style={{ position: 'absolute', top: 8, height: 6, borderRadius: 3, left: (befMax / span) * TW, width: (block / span) * TW, backgroundColor: 'rgba(0,200,232,0.35)' }} />
                {timed.map((p) => (
                  <View key={p.key} style={[s.dot, { left: xOf(p), backgroundColor: cover?.key === p.key ? Colors.gold : p.phase === 'air' ? Colors.primary : LIGHT }]} />
                ))}
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={s.tl}>−{befMax} min</Text>
                <Text style={[s.tl, { color: '#CFE0EE', fontWeight: '600' }]}>In the air {f.dep_utc}–{f.arr_utc}</Text>
                <Text style={s.tl}>+{aftMax} min</Text>
              </View>
            </View>
          )}

          {groups.map((g) => (
            <View key={g.label} style={{ gap: 10 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', paddingHorizontal: 2 }}>
                <Text style={s.eyebrow}>{g.label}</Text>
                <Text style={{ fontSize: 12.5, color: Colors.textSecondary }}>{g.items.length}</Text>
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3, borderRadius: 14, overflow: 'hidden' }}>
                {g.items.map((p) => {
                  const on = !!sel[p.key];
                  return (
                    <TouchableOpacity key={p.key} activeOpacity={0.85} onPress={() => (selecting ? toggle(p) : onOpen(p))}
                      onLongPress={() => { if (!selecting) { setSelecting(true); setSel({ [p.key]: true }); } }}
                      accessibilityLabel={`Photo, ${phaseText(p)}`} accessibilityState={selecting ? { selected: on } : undefined}
                      style={{ width: tile, height: tile, backgroundColor: '#08111F', overflow: 'hidden' }}>
                      <AssetImage localId={p.localId} uri={p.uri} isVideo={p.isVideo}
                        style={{ width: tile, height: tile, transform: [{ scale: on ? 0.88 : 1 }], borderRadius: on ? 8 : 0 }} />
                      {!!caption(p) && (
                        <LinearGradient colors={['rgba(4,10,20,0)', 'rgba(4,10,20,0.75)']} style={s.cap}>
                          <Text style={s.capText}>{caption(p)}</Text>
                        </LinearGradient>
                      )}
                      {p.isVideo && (
                        <View style={[s.badge, { right: 6 }]}>
                          <Ionicons name="play" size={9} color="#fff" />
                          {p.duration > 0 && <Text style={s.badgeText}>{fmtDur(p.duration)}</Text>}
                        </View>
                      )}
                      {cover?.key === p.key && !selecting && (
                        <View style={[s.badge, { left: 6 }]}>
                          <Ionicons name="star" size={10} color={Colors.gold} />
                          <Text style={[s.badgeText, { color: Colors.gold }]}>Cover</Text>
                        </View>
                      )}
                      {selecting && (
                        <View style={[s.check, on && { backgroundColor: Colors.primary, borderColor: Colors.primary }]}>
                          {on && <Ionicons name="checkmark" size={15} color={Colors.textInverse} />}
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}

          {vis.length === 0 && (
            <View style={s.card}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: Colors.textPrimary }}>No photos on this flight</Text>
              <Text style={{ fontSize: 13.5, lineHeight: 20, color: '#CFE0EE' }}>They’re still in your Photos library. Undo, or widen the window from the album to bring some back.</Text>
            </View>
          )}
          <Text style={s.note}>Removing a photo only takes it out of this album. It stays in your iPhone’s Photos library.</Text>
        </View>
      </ScrollView>

      <View style={[s.top, { top: insets.top + 8 }]}>
        {selecting ? (
          <TouchableOpacity style={s.pill} onPress={stopSelect}><Text style={s.pillText}>Cancel</Text></TouchableOpacity>
        ) : (
          <TouchableOpacity style={s.round} onPress={onBack} accessibilityLabel="Back to the album">
            <Ionicons name="chevron-back" size={22} color="#fff" />
          </TouchableOpacity>
        )}
        {selecting ? (
          <TouchableOpacity style={s.pill} onPress={() => setSel(allSel ? {} : Object.fromEntries(vis.map((p) => [p.key, true])))}>
            <Text style={s.pillText}>{allSel ? 'Deselect all' : 'Select all'}</Text>
          </TouchableOpacity>
        ) : vis.length > 0 ? (
          <TouchableOpacity style={s.pill} onPress={() => { setSelecting(true); setSel({}); }}><Text style={s.pillText}>Select</Text></TouchableOpacity>
        ) : <View />}
      </View>

      {selecting && (
        <View style={[s.selBar, { paddingBottom: insets.bottom + 16 }]}>
          <Text style={{ textAlign: 'center', fontSize: 13, color: '#CFE0EE' }}>
            {selected.length === 0 ? 'Tap photos to select them' : `${selected.length} photo${selected.length === 1 ? '' : 's'} selected`}
          </Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity disabled={!oneSynced} onPress={() => { onSetCover(selected[0]); stopSelect(); }}
              style={[s.selBtn, { opacity: oneSynced ? 1 : 0.4 }]}>
              <Ionicons name="star-outline" size={16} color={Colors.gold} />
              <Text style={{ fontSize: 15, fontWeight: '600', color: Colors.textPrimary }}>Set as cover</Text>
            </TouchableOpacity>
            <TouchableOpacity disabled={!selected.length} onPress={() => { onRemove(selected); stopSelect(); }}
              style={[s.selBtn, s.danger, { opacity: selected.length ? 1 : 0.4 }]}>
              <Ionicons name="trash-outline" size={16} color={DANGER} />
              <Text style={{ fontSize: 15, fontWeight: '700', color: DANGER }}>{selected.length ? `Remove ${selected.length}` : 'Remove'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  route: { fontFamily: FONT_SERIF, fontSize: 32, fontWeight: '600', color: Colors.textPrimary },
  chip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, backgroundColor: 'rgba(6,12,24,0.6)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  chipText: { fontSize: 12, fontWeight: '600', color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  card: { padding: 16, paddingVertical: 14, borderRadius: 16, borderWidth: 1, borderColor: Colors.cardBorder, backgroundColor: 'rgba(15,30,58,0.78)', gap: 10 },
  dot: { position: 'absolute', top: 7, width: 8, height: 8, borderRadius: 4, borderWidth: 2, borderColor: '#0F1E3A' },
  tl: { fontSize: 12, color: Colors.textSecondary, fontVariant: ['tabular-nums'] },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 2.2, color: Colors.textSecondary },
  cap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 16, paddingHorizontal: 7, paddingBottom: 5 },
  capText: { fontSize: 11, fontWeight: '700', color: '#fff', fontVariant: ['tabular-nums'] },
  badge: { position: 'absolute', top: 6, flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, backgroundColor: 'rgba(4,10,20,0.6)' },
  badgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  check: { position: 'absolute', top: 7, right: 7, width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: 'rgba(255,255,255,0.9)', backgroundColor: 'rgba(6,12,24,0.35)', alignItems: 'center', justifyContent: 'center' },
  note: { fontSize: 12.5, lineHeight: 18, color: Colors.textSecondary },
  top: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  round: { width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', backgroundColor: 'rgba(6,12,24,0.55)', alignItems: 'center', justifyContent: 'center' },
  pill: { height: 40, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', backgroundColor: 'rgba(6,12,24,0.6)', justifyContent: 'center' },
  pillText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  selBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 12, paddingHorizontal: 20, backgroundColor: 'rgba(6,12,24,0.96)', borderTopWidth: 1, borderTopColor: Colors.cardBorder, gap: 10 },
  selBtn: { flex: 1, height: 48, borderRadius: 14, borderWidth: 1, borderColor: Colors.cardBorder, backgroundColor: 'rgba(255,255,255,0.05)', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  danger: { borderColor: 'rgba(255,107,107,0.5)', backgroundColor: 'rgba(255,107,107,0.14)' },
});
