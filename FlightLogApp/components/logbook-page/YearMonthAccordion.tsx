// År→månad→flygningar. Alla år kollapsade som default. Filteretiketter + foto-läge.
import { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
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

export function YearMonthAccordion({ flights, accent, filter, photoMode, forceOpen, onOpenFlight, expandYear, expandMonthKey }: {
  flights: Flight[]; accent: string; filter: string; photoMode: boolean; forceOpen: boolean;
  onOpenFlight: (f: Flight) => void; expandYear?: number | null; expandMonthKey?: string | null;
}) {
  const years = useMemo(() => group(flights), [flights]);
  const [yearOvr, setYearOvr] = useState<Record<number, boolean>>({});
  const [monthOvr, setMonthOvr] = useState<Record<string, boolean>>({});
  const [showAllYears, setShowAllYears] = useState(false);

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
                  {mOpen && !photoMode && grp.flights.map((f) => <FlightCardRow key={f.id} flight={f} accent={accent} onPress={() => onOpenFlight(f)} />)}
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
