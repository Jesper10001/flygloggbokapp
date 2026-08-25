// År→månad→flygningar. Alla år kollapsade som default. Filteretiketter + foto-läge.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { View, Text, TouchableOpacity, Animated, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import type { Flight } from '../../types/flight';
import { FONT_SERIF, FONT_MONO } from './tokens';
import { FlightCardRow } from './FlightCardRow';
import { PhotoCard } from './PhotoCard';

const MONTH_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];

type MonthGrp = { m: number; label: string; flights: Flight[]; hours: number; count: number };
type YearGrp = { year: number; hours: number; count: number; months: MonthGrp[] };

function group(flights: Flight[]): YearGrp[] {
  const years: Record<number, Record<number, Flight[]>> = {};
  for (const f of flights) {
    const [y, m] = (f.date || '').split('-').map(Number);
    if (!y || !m) continue;
    (years[y] = years[y] || {});
    (years[y][m - 1] = years[y][m - 1] || []).push(f);
  }
  return Object.keys(years).map(Number).sort((a, b) => b - a).map((y) => {
    const months = Object.keys(years[y]).map(Number).sort((a, b) => b - a).map((m) => {
      const fl = years[y][m];
      return { m, label: MONTH_FULL[m], flights: fl, hours: fl.reduce((s, f) => s + (f.total_time ?? 0), 0), count: fl.length };
    });
    const all = months.flatMap((mm) => mm.flights);
    return { year: y, hours: all.reduce((s, f) => s + (f.total_time ?? 0), 0), count: all.length, months };
  });
}

// Fokus-dagens flighter: ihopsamlade i en ruta som (1) scrollas till mitten av listan och
// (2) får en cyan border som pulsar in och tonar ut — när man kommer från almanackans
// "Open this day in logbook". Bordern ligger som overlay (pointerEvents none) → raderna är kvar tappbara.
function FocusGroup({ flights, accent, onOpenFlight, scrollRef, viewportH, nonce }: {
  flights: Flight[]; accent: string; onOpenFlight: (f: Flight) => void;
  scrollRef?: React.RefObject<any>; viewportH?: number; nonce?: string | null;
}) {
  const ref = useRef<View>(null);
  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const timer = setTimeout(() => {
      const sv = scrollRef?.current;
      // measureLayout kräver en ref till en NATIV komponent → använd scrollens inre native-nod.
      const scrollNode = sv?.getNativeScrollRef?.() ?? sv;
      if (ref.current && scrollNode && typeof ref.current.measureLayout === 'function') {
        ref.current.measureLayout(scrollNode, (_x: number, y: number, _w: number, h: number) => {
          const vh = viewportH && viewportH > 0 ? viewportH : Dimensions.get('window').height;
          sv?.scrollTo({ y: Math.max(0, y - vh / 2 + h / 2), animated: true }); // centrera dagens rutor
        }, () => {});
      }
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 350, useNativeDriver: true }),
        Animated.delay(1500),
        Animated.timing(glow, { toValue: 0, duration: 700, useNativeDriver: true }),
      ]).start();
    }, 520); // låt accordionen expandera + layouta innan mätning/scroll
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);
  return (
    <View ref={ref} style={{ position: 'relative', marginHorizontal: 6, marginVertical: 2, borderRadius: 10 }}>
      {flights.map((f) => <FlightCardRow key={f.id} flight={f} accent={accent} onPress={() => onOpenFlight(f)} />)}
      <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderWidth: 2, borderColor: accent, borderRadius: 10, opacity: glow }} />
    </View>
  );
}

export function YearMonthAccordion({ flights, accent, filter, photoMode, forceOpen, onOpenFlight, expandYear, expandMonthKey, focusDate, focusNonce, scrollRef, viewportH }: {
  flights: Flight[]; accent: string; filter: string; photoMode: boolean; forceOpen: boolean;
  onOpenFlight: (f: Flight) => void; expandYear?: number | null; expandMonthKey?: string | null;
  focusDate?: string | null; focusNonce?: string | null; scrollRef?: React.RefObject<any>; viewportH?: number;
}) {
  // Månad-nyckel (år-monthIndex) för fokus-dagen → bara den månaden splittas i en FocusGroup.
  const fParts = focusDate ? focusDate.split('-').map(Number) : null;
  const focusMonthKey = fParts && fParts.length === 3 && fParts[0] && fParts[1] ? `${fParts[0]}-${fParts[1] - 1}` : null;
  // Rendera månadens rader; i fokus-månaden samlas dagens (sammanhängande) flighter i en FocusGroup.
  const renderRows = (fls: Flight[], monthKey: string): ReactNode => {
    if (!focusDate || monthKey !== focusMonthKey) {
      return fls.map((f) => <FlightCardRow key={f.id} flight={f} accent={accent} onPress={() => onOpenFlight(f)} />);
    }
    const out: ReactNode[] = [];
    let run: Flight[] = [];
    const flush = () => { if (run.length) { const rr = run; out.push(<FocusGroup key={`fg-${rr[0].id}`} flights={rr} accent={accent} onOpenFlight={onOpenFlight} scrollRef={scrollRef} viewportH={viewportH} nonce={focusNonce} />); run = []; } };
    for (const f of fls) {
      if (f.date === focusDate) run.push(f);
      else { flush(); out.push(<FlightCardRow key={f.id} flight={f} accent={accent} onPress={() => onOpenFlight(f)} />); }
    }
    flush();
    return out;
  };
  const years = useMemo(() => group(flights), [flights]);
  const [yearOvr, setYearOvr] = useState<Record<number, boolean>>({});
  const [monthOvr, setMonthOvr] = useState<Record<string, boolean>>({});
  const [showAllYears, setShowAllYears] = useState(false);

  // Ny fokus-navigation (focusNonce ändras) → tvinga upp målårets + målmånadens sektion, även om
  // användaren fällt ihop dem manuellt, så "Open this day" alltid expanderar + navigerar dit.
  useEffect(() => {
    if (!focusDate || !focusMonthKey) return;
    const fy = Number(focusDate.split('-')[0]);
    if (fy) setYearOvr((c) => ({ ...c, [fy]: true }));
    setMonthOvr((c) => ({ ...c, [focusMonthKey]: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusNonce]);

  const yearOpen = (yr: number) => forceOpen || (yearOvr[yr] !== undefined ? yearOvr[yr] : yr === expandYear);
  const monthOpen = (key: string) => forceOpen || (monthOvr[key] !== undefined ? monthOvr[key] : key === expandMonthKey);

  if (years.length === 0) return null;

  // Max 3 år normalt; "Previous years" expanderar resten. Sök/filter (forceOpen) och
  // djuplänk till ett äldre år visar alla år.
  const expandNeedsAll = expandYear != null
    && !years.slice(0, 3).some((y) => y.year === expandYear)
    && years.some((y) => y.year === expandYear);
  const showAll = forceOpen || showAllYears || expandNeedsAll;
  const visibleYears = showAll ? years : years.slice(0, 3);

  return (
    <View>
      {visibleYears.map((yr) => {
        const yOpen = yearOpen(yr.year);
        const filterLabel = filter !== 'all' && filter !== 'photo' ? ` ${filter.toUpperCase()}` : '';
        return (
          <View key={yr.year}>
            <TouchableOpacity onPress={() => setYearOvr((c) => ({ ...c, [yr.year]: !yOpen }))} activeOpacity={0.7}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 14, paddingBottom: 7 }}>
              <Ionicons name={yOpen ? 'chevron-down' : 'chevron-forward'} size={15} color={accent} />
              <Text style={{ fontFamily: FONT_SERIF, fontSize: 21, fontWeight: '600', color: Colors.textPrimary }}>{yr.year}</Text>
              <View style={{ flex: 1, height: 1, backgroundColor: Colors.separator }} />
              <Text style={{ fontFamily: FONT_MONO, fontSize: 11, fontWeight: '700', color: accent }}>{photoMode ? `${yr.count} photos` : `${Math.round(yr.hours)}h${filterLabel}`}</Text>
              {!photoMode ? <Text style={{ fontFamily: FONT_MONO, fontSize: 11, color: Colors.textMuted }}>{yr.count} flights</Text> : null}
            </TouchableOpacity>

            {yOpen && yr.months.map((grp) => {
              const key = `${yr.year}-${grp.m}`;
              const mOpen = monthOpen(key);
              return (
                <View key={key} style={{ marginHorizontal: 14, marginBottom: 10, borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.card }}>
                  <TouchableOpacity onPress={() => setMonthOvr((c) => ({ ...c, [key]: !mOpen }))} activeOpacity={0.7}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, paddingHorizontal: 14, borderBottomWidth: mOpen ? 1 : 0, borderBottomColor: Colors.separator }}>
                    <Ionicons name={mOpen ? 'chevron-down' : 'chevron-forward'} size={15} color={accent} />
                    <Text style={{ fontFamily: FONT_SERIF, fontSize: 16, fontWeight: '600', color: Colors.textPrimary }}>{grp.label}</Text>
                    <View style={{ flex: 1 }} />
                    {photoMode
                      ? <Text style={{ fontFamily: FONT_MONO, fontSize: 10, fontWeight: '700', color: accent }}>{grp.count} photo{grp.count > 1 ? 's' : ''}</Text>
                      : <>
                          <Text style={{ fontFamily: FONT_MONO, fontSize: 10, fontWeight: '700', color: accent }}>{Math.round(grp.hours)}h</Text>
                          <Text style={{ fontFamily: FONT_MONO, fontSize: 10, color: Colors.textMuted }}> · {grp.count} flt</Text>
                        </>}
                  </TouchableOpacity>
                  {mOpen && !photoMode && renderRows(grp.flights, key)}
                  {mOpen && photoMode && <View style={{ paddingBottom: 12 }}>{grp.flights.map((f) => <PhotoCard key={f.id} flight={f} accent={accent} onPress={() => onOpenFlight(f)} />)}</View>}
                </View>
              );
            })}
          </View>
        );
      })}
      {/* Max 3 år visas; resten bakom "Previous years". Diskret rad i samma stil som
          års-/månads-togglarna (chevron i accent + serif), döljs vid sök/filter. */}
      {!forceOpen && years.length > 3 && (
        <TouchableOpacity onPress={() => setShowAllYears((v) => !v)} activeOpacity={0.7}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12 }}>
          <Ionicons name={showAll ? 'chevron-down' : 'chevron-forward'} size={15} color={accent} />
          <Text style={{ fontFamily: FONT_SERIF, fontSize: 15, fontWeight: '600', color: Colors.textMuted }}>
            {showAll ? 'Fewer years' : `Previous years (${years.length - 3})`}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
