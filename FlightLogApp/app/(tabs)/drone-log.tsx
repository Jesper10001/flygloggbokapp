// Drönar-Log — två sub-flikar: Flights (månadsgrupperat) + Fleet (drönare + batterier).
// Navy bas + trådbar accent. Per-flygning visas i MM:SS, totaler i H:MM.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import Svg, { Polygon, Text as SvgText, G } from 'react-native-svg';

import { DR, accentSoft, accentLine } from '../../constants/droneTheme';
import { useDroneAccentStore } from '../../store/droneAccentStore';
import { useDroneFlightStore } from '../../store/droneFlightStore';
import { decimalToHHMM, decimalToMMSS } from '../../hooks/useTimeFormat';
import {
  listDrones, listBatteries, getDroneUsage,
  type DroneFlight, type DroneRegistryEntry, type DroneBattery,
} from '../../db/drones';
import { categoryLabel } from '../../constants/droneCategories';
import { batteryCondition, DEFAULT_RATED_CYCLES, type BatteryConditionKey } from '../../constants/droneBattery';
import { DroneBookView } from '../../components/logbook-page/DroneBookView';

const SERIF = 'Fraunces';
const MONO = 'JetBrainsMono';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function relDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  const now = new Date();
  const days = Math.round((now.setHours(0, 0, 0, 0) - d.getTime()) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} d ago`;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}
// Datumchip-helpers (= manned FlightCardRow)
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function dayOfMonth(iso: string): string { const p = (iso || '').split('-'); return p[2] ? String(parseInt(p[2], 10)) : '—'; }
function weekdayShort(iso: string): string { const d = new Date((iso || '') + 'T00:00:00'); return isNaN(d.getTime()) ? '' : WD[d.getDay()]; }

export default function DroneLog() {
  const router = useRouter();
  const accent = useDroneAccentStore((s) => s.color);
  const loadAccent = useDroneAccentStore((s) => s.load);
  const { flights, loadFlights } = useDroneFlightStore();
  const [tab, setTab] = useState<'flights' | 'book' | 'fleet'>('flights');

  useFocusEffect(useCallback(() => { loadAccent(); loadFlights(); }, [loadAccent, loadFlights]));

  // Kompakt ikon-toggle till höger (= manned SegmentedToggle: List/Book/Fleet).
  const TABS: [typeof tab, any][] = [['flights', 'list'], ['book', 'book-outline'], ['fleet', 'grid-outline']];
  const toggle = (
    <View style={s.segToggle}>
      {TABS.map(([k, icon]) => (
        <TouchableOpacity
          key={k}
          style={[s.segBtn, tab === k && { backgroundColor: accent }]}
          onPress={() => setTab(k)}
          activeOpacity={0.8}
        >
          <Ionicons name={icon} size={16} color={tab === k ? DR.inkOnAccent : DR.text3} />
        </TouchableOpacity>
      ))}
    </View>
  );

  // Book-vyn har sin egen header (titel + väljare) → toggeln ligger där (headerRight),
  // precis som manned. Övriga vyer får den delade header-raden.
  if (tab === 'book') {
    return (
      <View style={s.container}>
        <DroneBookView accent={accent} headerRight={toggle} />
      </View>
    );
  }

  return (
    <View style={s.container}>
      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: DR.separator }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={[s.screenTitle, { flex: 1, marginBottom: 0 }]}>Logbook</Text>
          {toggle}
        </View>
      </View>

      {tab === 'flights'
        ? <FlightsTab flights={flights} accent={accent} onOpen={(id) => router.push(`/drone-flight/${id}`)} />
        : <FleetTab accent={accent} onManage={() => router.push('/settings/drones')} />}
    </View>
  );
}

const FILTERS: [string, string][] = [['all', 'All'], ['vlos', 'VLOS'], ['bvlos', 'BVLOS'], ['night', 'Night']];

function FlightsTab({ flights, accent, onOpen }: {
  flights: DroneFlight[]; accent: string; onOpen: (id: number) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return flights.filter((f) => {
      if (filter === 'vlos' && f.flight_mode !== 'VLOS') return false;
      if (filter === 'bvlos' && f.flight_mode !== 'BVLOS') return false;
      if (filter === 'night' && !f.is_night) return false;
      if (q) {
        const hay = `${f.location ?? ''} ${f.drone_type ?? ''} ${f.registration ?? ''} ${f.mission_type ?? ''} ${f.category ?? ''} ${f.flight_mode ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [flights, query, filter]);

  const forceOpen = !!query.trim() || filter !== 'all';

  return (
    <View style={{ flex: 1 }}>
      {/* Sticky header: sök + filterchips (= manned ListView) */}
      <View style={{ paddingHorizontal: 14, paddingTop: 4, paddingBottom: 10, backgroundColor: DR.background, borderBottomWidth: 1, borderBottomColor: DR.separator }}>
        <View style={s.searchRow}>
          <Ionicons name="search" size={16} color={DR.muted} />
          <TextInput style={s.searchInput} value={query} onChangeText={setQuery} placeholder="Search site, drone, mission…" placeholderTextColor={DR.muted} autoCapitalize="characters" />
          {query.length > 0 && <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}><Ionicons name="close" size={15} color={DR.muted} /></TouchableOpacity>}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, marginTop: 10 }}>
          {FILTERS.map(([k, label]) => {
            const sel = filter === k;
            return (
              <TouchableOpacity key={k} onPress={() => setFilter(k)} activeOpacity={0.8}
                style={{ paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: sel ? accent : DR.border, backgroundColor: sel ? accent : DR.surface }}>
                <Text style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.6, color: sel ? DR.inkOnAccent : DR.text3 }}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 100 }} keyboardShouldPersistTaps="handled">
        {filtered.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="hardware-chip-outline" size={44} color={DR.muted} />
            <Text style={s.emptyText}>{query.trim() ? `No flights match "${query.trim()}"` : 'No drone flights yet'}</Text>
          </View>
        ) : (
          <DroneYearMonthAccordion flights={filtered} accent={accent} forceOpen={forceOpen} onOpen={onOpen} />
        )}
        {/* Aktivitetskalender längst ner (= manned), bara i ofiltrerad vy */}
        {filter === 'all' && !query.trim() && flights.length > 0 && (
          <View style={{ paddingHorizontal: 14, marginTop: 14 }}>
            <DroneActivityCalendar flights={flights} accent={accent} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// En flygningsrad (serif-datumchip = manned FlightCardRow).
function DroneFlightRow({ f, accent, onOpen, first }: { f: DroneFlight; accent: string; onOpen: (id: number) => void; first?: boolean }) {
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={() => onOpen(f.id)}
      style={[s.row, !first && { borderTopWidth: 1, borderTopColor: DR.separator }]}>
      <View style={{ width: 34, alignItems: 'center' }}>
        <Text style={s.dateDay}>{dayOfMonth(f.date)}</Text>
        <Text style={s.dateWd}>{weekdayShort(f.date)}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={s.mission} numberOfLines={1}>{f.mission_type || 'Flight'}</Text>
          <Chip text={f.flight_mode} tone={f.flight_mode === 'BVLOS' ? 'warn' : 'muted'} accent={accent} />
          {f.category ? <Chip text={categoryLabel(f.category)} tone="acc" accent={accent} /> : null}
        </View>
        <Text style={s.rowMeta} numberOfLines={1}>{f.registration || f.drone_type || '—'} · {f.location || '—'}</Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={s.rowTime}>{decimalToMMSS(f.total_time || 0)}</Text>
        <Text style={s.rowDate}>{relDate(f.date)}</Text>
      </View>
      <Ionicons name="chevron-forward" size={15} color={DR.muted} />
    </TouchableOpacity>
  );
}

// År→månad-accordion (klon av manned YearMonthAccordion) — år kollapsade default,
// månads-dropdowns, max 3 år + "Previous years".
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function DroneYearMonthAccordion({ flights, accent, forceOpen, onOpen }: {
  flights: DroneFlight[]; accent: string; forceOpen: boolean; onOpen: (id: number) => void;
}) {
  const years = useMemo(() => {
    const yy: Record<number, Record<number, DroneFlight[]>> = {};
    for (const f of flights) {
      const [y, m] = (f.date || '').split('-').map(Number);
      if (!y || !m) continue;
      (yy[y] = yy[y] || {}); (yy[y][m - 1] = yy[y][m - 1] || []).push(f);
    }
    return Object.keys(yy).map(Number).sort((a, b) => b - a).map((y) => {
      const months = Object.keys(yy[y]).map(Number).sort((a, b) => b - a).map((m) => {
        const fl = yy[y][m];
        return { m, label: MONTH_FULL[m], flights: fl, hours: fl.reduce((s2, f) => s2 + (f.total_time ?? 0), 0), count: fl.length };
      });
      const all = months.flatMap((mm) => mm.flights);
      return { year: y, hours: all.reduce((s2, f) => s2 + (f.total_time ?? 0), 0), count: all.length, months };
    });
  }, [flights]);

  const [yearOvr, setYearOvr] = useState<Record<number, boolean>>({});
  const [monthOvr, setMonthOvr] = useState<Record<string, boolean>>({});
  const [showAllYears, setShowAllYears] = useState(false);
  if (years.length === 0) return null;

  // Alla år kollapsade som default (= manned) — visa bara årtal tills man expanderar.
  const yearOpen = (yr: number) => forceOpen || !!yearOvr[yr];
  const monthOpen = (key: string) => forceOpen || !!monthOvr[key];
  const showAll = forceOpen || showAllYears;
  const visibleYears = showAll ? years : years.slice(0, 3);

  return (
    <View>
      {visibleYears.map((yr) => {
        const yOpen = yearOpen(yr.year);
        return (
          <View key={yr.year}>
            <TouchableOpacity onPress={() => setYearOvr((c) => ({ ...c, [yr.year]: !yOpen }))} activeOpacity={0.7}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 7 }}>
              <Ionicons name={yOpen ? 'chevron-down' : 'chevron-forward'} size={15} color={accent} />
              <Text style={{ fontFamily: SERIF, fontSize: 21, fontWeight: '600', color: DR.text }}>{yr.year}</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: DR.separator }} />
              <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: accent }}>{decimalToHHMM(yr.hours)}</Text>
              <Text style={{ fontFamily: MONO, fontSize: 11, color: DR.muted }}>{yr.count} flt</Text>
            </TouchableOpacity>
            {yOpen && yr.months.map((grp) => {
              const key = `${yr.year}-${grp.m}`;
              const mOpen = monthOpen(key);
              return (
                <View key={key} style={{ marginHorizontal: 14, marginBottom: 10, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: DR.border, backgroundColor: DR.surface }}>
                  <TouchableOpacity onPress={() => setMonthOvr((c) => ({ ...c, [key]: !mOpen }))} activeOpacity={0.7}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 14, borderBottomWidth: mOpen ? 1 : 0, borderBottomColor: DR.separator }}>
                    <Ionicons name={mOpen ? 'chevron-down' : 'chevron-forward'} size={15} color={accent} />
                    <Text style={{ fontFamily: SERIF, fontSize: 16, fontWeight: '600', color: DR.text }}>{grp.label}</Text>
                    <View style={{ flex: 1 }} />
                    <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: accent }}>{decimalToHHMM(grp.hours)}</Text>
                    <Text style={{ fontFamily: MONO, fontSize: 10, color: DR.muted }}> · {grp.count} flt</Text>
                  </TouchableOpacity>
                  {mOpen && grp.flights.map((f, i) => <DroneFlightRow key={f.id} f={f} accent={accent} onOpen={onOpen} first={i === 0} />)}
                </View>
              );
            })}
          </View>
        );
      })}
      {!forceOpen && years.length > 3 && (
        <TouchableOpacity onPress={() => setShowAllYears((v) => !v)} activeOpacity={0.7}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12 }}>
          <Ionicons name={showAll ? 'chevron-down' : 'chevron-forward'} size={15} color={accent} />
          <Text style={{ fontFamily: SERIF, fontSize: 15, fontWeight: '600', color: DR.muted }}>{showAll ? 'Fewer years' : `Previous years (${years.length - 3})`}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// Aktivitetskalender (= manned HeatmapCalendar): månad×år-heatmap (tappbar) + iso-almanacka.
function DroneActivityCalendar({ flights, accent }: { flights: DroneFlight[]; accent: string }) {
  const now = new Date();
  const [sel, setSel] = useState<{ y: number; m: number }>({ y: now.getFullYear(), m: now.getMonth() });
  return (
    <View>
      <Text style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: '700', letterSpacing: 1.8, color: DR.text3, marginBottom: 10 }}>ACTIVITY CALENDAR</Text>
      <DroneMonthYearHeatmap flights={flights} accent={accent} sel={sel} setSel={setSel} />
      <View style={{ height: 1, backgroundColor: DR.separator, marginVertical: 8 }} />
      <DroneIsoMonth flights={flights} accent={accent} sel={sel} />
    </View>
  );
}

// Månad×år-heatmap — tappbar (väljer månad för almanackan).
function DroneMonthYearHeatmap({ flights, accent, sel, setSel }: {
  flights: DroneFlight[]; accent: string; sel: { y: number; m: number }; setSel: (s: { y: number; m: number }) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const monthly = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of flights) { const k = (f.date || '').slice(0, 7); if (k.length === 7) m[k] = (m[k] || 0) + 1; }
    return m;
  }, [flights]);
  const curY = new Date().getFullYear();
  const dataYears = Object.keys(monthly).map((k) => Number(k.slice(0, 4)));
  const minYear = dataYears.length ? Math.min(...dataYears, curY - 1) : curY - 1;
  const allYears: number[] = [];
  for (let y = curY; y >= minYear; y--) allYears.push(y);
  const rows = expanded ? allYears : allYears.slice(0, 2);
  const get = (y: number, m: number) => monthly[`${y}-${String(m + 1).padStart(2, '0')}`] ?? 0;
  const max = Math.max(...rows.flatMap((y) => Array.from({ length: 12 }, (_, m) => get(y, m))), 1);
  return (
    <View style={{ gap: 5 }}>
      <View style={{ flexDirection: 'row', gap: 3, paddingLeft: 29 }}>
        {MONTHS.map((mn) => <Text key={mn} style={{ flex: 1, textAlign: 'center', fontFamily: MONO, fontSize: 7, color: DR.faint }}>{mn[0]}</Text>)}
      </View>
      {rows.map((yr) => (
        <View key={yr} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Text style={{ width: 24, fontFamily: MONO, fontSize: 9, fontWeight: '700', color: yr === sel.y ? accent : DR.muted }}>{String(yr).slice(2)}</Text>
          <View style={{ flex: 1, flexDirection: 'row', gap: 3 }}>
            {Array.from({ length: 12 }, (_, m) => {
              const v = get(yr, m);
              const intensity = v > 0 ? 0.16 + (v / max) * 0.84 : 0;
              const active = yr === sel.y && m === sel.m;
              return (
                <TouchableOpacity key={m} onPress={() => setSel({ y: yr, m })} activeOpacity={0.7}
                  style={{ flex: 1, aspectRatio: 1, borderRadius: 4, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: v > 0 ? accent + Math.round(intensity * 255).toString(16).padStart(2, '0') : DR.separator,
                    borderWidth: active ? 1.5 : 0, borderColor: active ? DR.text : 'transparent' }}>
                  {v > 0 ? <Text style={{ fontFamily: MONO, fontSize: 8, fontWeight: '700', color: intensity > 0.5 ? DR.inkOnAccent : DR.text2 }}>{v}</Text> : null}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}
      {allYears.length > 2 && (
        <TouchableOpacity onPress={() => setExpanded((v) => !v)} activeOpacity={0.7} style={{ marginTop: 4 }}>
          <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: accent }}>{expanded ? 'Fewer years' : 'All years'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// Isometrisk almanacka (klon av manned IsoMonth) — 3D-dagstaplar för vald månad,
// stapelhöjd = antal flygningar den dagen. Tap på en dag → detaljpanel.
const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
const ordDay = (n: number) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };
function DroneIsoMonth({ flights, accent, sel }: { flights: DroneFlight[]; accent: string; sel: { y: number; m: number } }) {
  const [day, setDay] = useState<number | null>(null);
  const { y, m } = sel;
  useEffect(() => { setDay(null); }, [y, m]);
  const nDays = daysInMonth(y, m);

  // Flugna MINUTER per dag i vald månad (stapelhöjd + etikett = min/dag).
  const counts = useMemo(() => {
    const out = Array(nDays).fill(0);
    const prefix = `${y}-${String(m + 1).padStart(2, '0')}`;
    for (const f of flights) {
      if ((f.date || '').slice(0, 7) === prefix) { const d = Number((f.date || '').slice(8, 10)); if (d >= 1 && d <= nDays) out[d - 1] += (f.total_time || 0) * 60; }
    }
    return out.map((v) => Math.round(v));
  }, [flights, y, m, nDays]);
  const max = Math.max(...counts, 1);
  let maxDay = 0, maxV = 0;
  counts.forEach((v: number, i: number) => { if (v > maxV) { maxV = v; maxDay = i + 1; } });

  // iso-projektion (= manned)
  const TW = 38, TH = 19, FW = 16, FH = 8, MAXBAR = 28;
  const isoX = (c: number, r: number) => (c - r) * (TW / 2);
  const isoY = (c: number, r: number) => (c + r) * (TH / 2);
  const rgb = ((): [number, number, number] => { const n = parseInt(accent.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; })();
  const shade = (mult: number, a = 1) => `rgba(${Math.min(255, Math.round(rgb[0] * mult))},${Math.min(255, Math.round(rgb[1] * mult))},${Math.min(255, Math.round(rgb[2] * mult))},${a})`;
  const firstDow = (new Date(y, m, 1).getDay() + 6) % 7;

  const bars = counts.map((v: number, d: number) => { const idx = firstDow + d; return { v, day: d + 1, col: idx % 7, row: Math.floor(idx / 7) }; });
  bars.sort((a, b) => (a.row + a.col) - (b.row + b.col));

  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  const polys: any[] = [];
  bars.forEach((b, k) => {
    const bx = isoX(b.col, b.row), by = isoY(b.col, b.row);
    const intensity = b.v > 0 ? 0.32 + (b.v / max) * 0.68 : 0;
    const bh = b.v > 0 ? 3.5 + (b.v / max) * MAXBAR : 0;
    const ty = by - bh;
    minX = Math.min(minX, bx - FW); maxX = Math.max(maxX, bx + FW);
    minY = Math.min(minY, ty - FH); maxY = Math.max(maxY, by + FH);
    if (b.v <= 0) {
      const dow = new Date(y, m, b.day).getDay();
      const weekend = dow === 0 || dow === 6;
      polys.push(
        <G key={`e${k}`} opacity={0.78}>
          <Polygon points={`${bx - FW},${by} ${bx},${by - FH} ${bx + FW},${by} ${bx},${by + FH}`} fill={weekend ? 'rgba(255,107,91,0.22)' : 'rgba(255,255,255,0.07)'} stroke={weekend ? 'rgba(255,107,91,0.6)' : 'rgba(255,255,255,0.18)'} strokeWidth={0.6} />
          <G transform={`matrix(0.894 0.447 -0.894 0.447 ${bx + 2} ${by - FH + 6})`}>
            <SvgText x={0} y={2} fontSize={5.5} fontFamily={MONO} fontWeight="700" fill="#FFFFFF" textAnchor="middle">{ordDay(b.day)}</SvgText>
          </G>
        </G>,
      );
      return;
    }
    const isBest = b.day === maxDay && maxV > 0;
    const topFill = isBest ? DR.warning : shade(0.7 + intensity * 0.55);
    const leftFill = isBest ? shade(0.45) : shade(0.24 + intensity * 0.2);
    const rightFill = isBest ? shade(0.72) : shade(0.46 + intensity * 0.32);
    const isSel = day === b.day;
    polys.push(
      <G key={`b${k}`} onPress={() => setDay(b.day)}>
        <Polygon points={`${bx - FW},${by} ${bx},${by + FH} ${bx},${ty + FH} ${bx - FW},${ty}`} fill={leftFill} />
        <Polygon points={`${bx + FW},${by} ${bx},${by + FH} ${bx},${ty + FH} ${bx + FW},${ty}`} fill={rightFill} />
        <Polygon points={`${bx - FW},${ty} ${bx},${ty - FH} ${bx + FW},${ty} ${bx},${ty + FH}`} fill={topFill} stroke={isSel ? DR.text : shade(1.1)} strokeWidth={isSel ? 2 : 0.5} />
        <G transform={`matrix(0.894 0.447 -0.894 0.447 ${bx} ${ty})`}>
          <SvgText x={0} y={2} fontSize={7.5} fontFamily={MONO} fontWeight="700" fill={intensity > 0.55 || isBest ? DR.inkOnAccent : shade(0.2)} textAnchor="middle">{b.v}</SvgText>
        </G>
      </G>,
    );
  });

  const pad = 8;
  const titleH = 22;
  const vbW = Math.max((maxX - minX) + pad * 2, 100);
  const vbH = Math.max((maxY - minY) + pad * 2, 100);
  const dayFlights = day ? flights.filter((f) => Number((f.date || '').slice(8, 10)) === day && (f.date || '').slice(0, 7) === `${y}-${String(m + 1).padStart(2, '0')}`) : [];
  const lastRow = Math.floor((firstDow + nDays - 1) / 7);
  const titleStr = `${MONTH_FULL[m]} ${y}`;
  const titleLen = titleStr.length * 5.8;
  const titleY = isoY(0, lastRow) + FH + 10;
  const titleXmax = maxX + pad - titleLen * 0.894;
  const titleX = Math.max(minX - pad + 2, Math.min(isoX(0, lastRow) - FW * 0.5, titleXmax));

  return (
    <View>
      <Svg width="100%" height={Math.min(320, Math.round(((vbH + titleH) / vbW) * 340))} viewBox={`${minX - pad} ${minY - pad} ${vbW} ${vbH + titleH}`}>
        {polys}
        <G transform={`matrix(0.894 0.447 -0.894 0.447 ${titleX} ${titleY})`}>
          <SvgText x={0} y={0} fontSize={10} fontFamily={MONO} fontWeight="700" letterSpacing={0.5} fill="#FFFFFF">{titleStr}</SvgText>
        </G>
      </Svg>
      {day && (
        <View style={{ marginTop: 4, backgroundColor: DR.bgDeep, borderWidth: 1, borderColor: accent, borderRadius: 12, padding: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
            <Text style={{ fontFamily: SERIF, fontSize: 16, fontWeight: '600', color: DR.text }}>{MONTHS[m]} {day}</Text>
            <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: accent }}>{Math.round(dayFlights.reduce((sm, f) => sm + (f.total_time || 0) * 60, 0))} min · {dayFlights.length} flight{dayFlights.length !== 1 ? 's' : ''}</Text>
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={() => setDay(null)}><Text style={{ color: DR.muted, fontFamily: MONO, fontSize: 12 }}>✕</Text></TouchableOpacity>
          </View>
          {dayFlights.slice(0, 6).map((f) => (
            <View key={f.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 }}>
              <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: accent, width: 60 }} numberOfLines={1}>{f.registration || f.drone_type || '—'}</Text>
              <Text style={{ flex: 1, fontFamily: MONO, fontSize: 10.5, color: DR.text2 }} numberOfLines={1}>{f.mission_type || f.location || '—'}</Text>
              <Text style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: DR.text }}>{decimalToMMSS(f.total_time || 0)}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

function FleetTab({ accent, onManage }: { accent: string; onManage: () => void }) {
  const [drones, setDrones] = useState<DroneRegistryEntry[]>([]);
  const [usage, setUsage] = useState<Record<number, { h: number; c: number }>>({});
  const [batteries, setBatteries] = useState<{ b: DroneBattery; droneLabel: string }[]>([]);

  useFocusEffect(useCallback(() => {
    (async () => {
      const ds = await listDrones();
      setDrones(ds);
      const u = await getDroneUsage();
      const um: Record<number, { h: number; c: number }> = {};
      for (const row of u as any[]) um[row.id] = { h: row.total_time || 0, c: row.flight_count || 0 };
      setUsage(um);
      const bats: { b: DroneBattery; droneLabel: string }[] = [];
      for (const d of ds) {
        const list = await listBatteries(d.id);
        for (const b of list) bats.push({ b, droneLabel: d.registration || d.model || `#${d.id}` });
      }
      setBatteries(bats);
    })().catch(() => {});
  }, []));

  // Kondition härleds ur cykler (självuppdaterande), inte det statiska health-fältet.
  const condColor = (k: BatteryConditionKey) =>
    k === 'good' ? DR.success : k === 'ageing' ? DR.warning : DR.danger;
  const attention = batteries.filter(({ b }) => batteryCondition(b.cycle_count).needsAttention).length;

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingTop: 4, paddingBottom: 40, gap: 18 }}>
      {/* Drönare */}
      <View>
        <SectionLabel accent={accent} action="+ ADD" onAction={onManage}>DRONES · {drones.length}</SectionLabel>
        <View style={{ gap: 10 }}>
          {drones.length === 0 ? (
            <View style={s.empty}><Ionicons name="hardware-chip-outline" size={40} color={DR.muted} /><Text style={s.emptyText}>No drones yet</Text></View>
          ) : drones.map((d) => {
            const u = usage[d.id] ?? { h: 0, c: 0 };
            const batCount = batteries.filter((x) => x.b.drone_id === d.id).length;
            return (
              <TouchableOpacity key={d.id} activeOpacity={0.7} onPress={onManage} style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 13 }]}>
                <View style={[s.fleetIcon, { backgroundColor: DR.elevated }]}><Ionicons name="hardware-chip-outline" size={22} color={accent} /></View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.droneTitle} numberOfLines={1}>{d.model || d.registration || '—'}</Text>
                  <Text style={s.droneMeta} numberOfLines={1}>
                    {d.registration ? `${d.registration} · ` : ''}{u.c} flt · {decimalToHHMM(u.h)} h{batCount ? ` · ${batCount} batt` : ''}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={DR.muted} />
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Batterier — kondition ur cykler (självuppdaterande), pension nära ~200 cykler */}
      <View>
        <SectionLabel accent={accent} action="+ ADD" onAction={onManage}>BATTERIES · {batteries.length}</SectionLabel>
        {attention > 0 && (
          <View style={s.attnBanner}>
            <Ionicons name="warning-outline" size={14} color={DR.warning} />
            <Text style={s.attnText}>{attention} {attention === 1 ? 'battery is' : 'batteries are'} near end of life — consider retiring</Text>
          </View>
        )}
        {batteries.length === 0 ? (
          <View style={s.empty}><Ionicons name="battery-half-outline" size={36} color={DR.muted} /><Text style={s.emptyText}>No batteries yet</Text></View>
        ) : (
          <View style={[s.card, { padding: 0, overflow: 'hidden' }]}>
            {batteries.map(({ b, droneLabel }, i) => {
              const cond = batteryCondition(b.cycle_count);
              const col = condColor(cond.key);
              return (
                <View key={b.id} style={[s.batRow, i ? { borderTopWidth: 1, borderTopColor: DR.separator } : null]}>
                  <Ionicons name={cond.key === 'good' ? 'battery-full-outline' : cond.key === 'retire' ? 'battery-dead-outline' : 'battery-half-outline'} size={20} color={col} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.batLabel} numberOfLines={1}>{b.label || b.serial || `#${b.id}`}</Text>
                    <Text style={s.batMeta} numberOfLines={1}>{droneLabel} · {b.cycle_count}/{DEFAULT_RATED_CYCLES} cycles</Text>
                  </View>
                  <View style={{ width: 104 }}>
                    <View style={{ alignItems: 'flex-end', marginBottom: 5 }}>
                      <View style={[s.cycChip, { borderColor: col + '66', backgroundColor: col + '1F' }]}>
                        <Text style={[s.cycChipText, { color: col }]}>{cond.label}</Text>
                      </View>
                    </View>
                    <View style={s.track}>
                      <View style={{ width: `${cond.usedPct}%`, height: '100%', borderRadius: 99, backgroundColor: col }} />
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

function Chip({ text, tone, accent }: { text: string; tone: 'acc' | 'warn' | 'muted'; accent: string }) {
  const c = tone === 'acc' ? accent : tone === 'warn' ? DR.warning : DR.text3;
  const bg = tone === 'acc' ? accentSoft(accent) : tone === 'warn' ? 'rgba(255,200,87,0.12)' : 'rgba(127,168,200,0.08)';
  const bd = tone === 'acc' ? accentLine(accent) : tone === 'warn' ? 'rgba(255,200,87,0.4)' : DR.border;
  return (
    <View style={[s.chip, { backgroundColor: bg, borderColor: bd }]}>
      <Text style={[s.chipText, { color: c }]}>{text}</Text>
    </View>
  );
}

function SectionLabel({ children, accent, action, onAction }: { children: React.ReactNode; accent: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
      <Text style={s.label}>{children}</Text>
      {action ? <TouchableOpacity onPress={onAction} hitSlop={8}><Text style={[s.action, { color: accent }]}>{action}</Text></TouchableOpacity> : null}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: DR.background },
  screenTitle: { fontFamily: SERIF, fontSize: 26, fontWeight: '600', color: DR.text, marginBottom: 14 },

  // Kompakt ikon-toggle (= manned SegmentedToggle): container radius 9, 32x28-segment
  segToggle: { flexDirection: 'row', gap: 3, backgroundColor: DR.surface, borderWidth: 1, borderColor: DR.border, borderRadius: 9, padding: 3 },
  segBtn: { width: 32, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 7 },

  card: { backgroundColor: DR.surface, borderWidth: 1, borderColor: DR.border, borderRadius: 16, padding: 16 },
  label: { fontFamily: MONO, fontSize: 10.5, fontWeight: '700', letterSpacing: 1.8, color: DR.text3 },
  action: { fontFamily: MONO, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.8 },

  trioVal: { fontFamily: MONO, fontSize: 17, fontWeight: '700', color: DR.text, fontVariant: ['tabular-nums'] },
  trioKey: { fontFamily: MONO, fontSize: 8, fontWeight: '700', letterSpacing: 1, color: DR.muted, marginTop: 4 },

  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: DR.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: DR.border },
  searchInput: { flex: 1, color: DR.text, fontSize: 14, paddingVertical: 4 },

  empty: { alignItems: 'center', gap: 10, paddingVertical: 60 },
  emptyText: { color: DR.text2, fontSize: 13, textAlign: 'center' },

  row: { flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 12, paddingHorizontal: 14 },
  // Serif-datumchip (= manned FlightCardRow)
  dateDay: { fontFamily: SERIF, fontSize: 20, fontWeight: '600', color: DR.text, lineHeight: 22 },
  dateWd: { fontFamily: MONO, fontSize: 8, fontWeight: '700', letterSpacing: 0.7, color: DR.muted, textTransform: 'uppercase', marginTop: 2 },
  mission: { fontFamily: MONO, fontSize: 14, fontWeight: '700', color: DR.text, letterSpacing: 0.3, flexShrink: 1 },
  rowMeta: { fontFamily: MONO, fontSize: 10, color: DR.text3, marginTop: 3 },
  rowTime: { fontFamily: MONO, fontSize: 14, fontWeight: '700', color: DR.text, fontVariant: ['tabular-nums'] },
  rowDate: { fontFamily: MONO, fontSize: 9, color: DR.muted, marginTop: 2 },

  chip: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  chipText: { fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },

  fleetIcon: { width: 44, height: 44, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  droneTitle: { fontSize: 14, fontWeight: '600', color: DR.text },
  droneMeta: { fontFamily: MONO, fontSize: 10, color: DR.text3, marginTop: 3 },

  attnBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: DR.warning + '55', backgroundColor: DR.warning + '14' },
  attnText: { flex: 1, color: DR.warning, fontSize: 11.5, fontWeight: '600', lineHeight: 15 },
  batRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 },
  batLabel: { fontFamily: MONO, fontSize: 12, fontWeight: '700', color: DR.text },
  batMeta: { fontFamily: MONO, fontSize: 9.5, color: DR.muted, marginTop: 2 },
  cycChip: { borderWidth: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  cycChipText: { fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 0.5 },
  track: { height: 4, borderRadius: 99, backgroundColor: DR.separator, overflow: 'hidden' },

  fab: { position: 'absolute', right: 20, bottom: 28, width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
});
