// Insights §3 — Activity. Heatmap/Bars/Line-switch som driver BÅDE "Hours / month"
// och "14-day rolling load". Heatmap-läget = månad×år-rutnät (tappbart) + en
// isometrisk 3D-månadsvy (per-dag-staplar, rekord silver/gold/purple, dag-popup →
// öppna flygningen). Data ur getMonthlyHours-motsv. (insightsData.monthly),
// getDailyHours14/getDailyHours, getStressHours.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import Svg, { Path, Polygon, Line as SvgLine, Circle, Defs, LinearGradient, Stop, Text as SvgText, G } from 'react-native-svg';
import { useInsightsTheme, type InsightsTheme } from './insightsTheme';
import { useInsightsData } from './insightsData';
import { getStressHours } from '../../db/flights';
import { getAirportTzInfo } from '../../db/icao';
import { useFlightStore } from '../../store/flightStore';
import { buildLocalDaily, type TzInfo } from './localDaily';

const MONO = 'JetBrainsMono';
const SERIF = 'Fraunces';
const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
const MONTH3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
const ord = (n: number) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const DOWk = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const fmtDM = (iso: string) => { const d = new Date(iso); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`; };
function isoWeek(d: Date) { const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const dn = (dt.getUTCDay() + 6) % 7; dt.setUTCDate(dt.getUTCDate() - dn + 3); const ft = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4)); return 1 + Math.round((dt.getTime() - ft.getTime()) / (7 * 86400000)); }

export function ActivitySection() {
  const C = useInsightsTheme();
  const D = useInsightsData();
  const flights = useFlightStore((s) => s.flights);
  const [viz, setViz] = useState<'heatmap' | 'bars' | 'line'>('heatmap');
  const [yearAvg14, setYearAvg14] = useState(0);
  const [tz, setTz] = useState<Record<string, TzInfo>>({});
  const now = new Date();
  const [yearShift, setYearShift] = useState(0);
  const [sel, setSel] = useState<{ y: number; m: number }>({ y: now.getFullYear(), m: now.getMonth() });
  const [barsView, setBarsView] = useState<{ atPresent: boolean; curLabel: string }>({ atPresent: true, curLabel: String(now.getFullYear()) });
  const [loadView, setLoadView] = useState<{ atPresent: boolean; curLabel: string; prevLabel: string; sum: number } | null>(null);
  const { width } = useWindowDimensions();
  const pageW = Math.max(180, width - 56);

  useFocusEffect(useCallback(() => {
    getStressHours().then((s) => setYearAvg14(s.yearAvg14)).catch(() => {});
  }, []));

  // tidszons-info för avgångsflygplatser → lokaltids-uppdelning av flyg över midnatt
  useEffect(() => {
    const deps = [...new Set(flights.filter((f) => f.flight_type !== 'sim' && f.dep_place).map((f) => f.dep_place))];
    if (!deps.length) return;
    getAirportTzInfo(deps).then((rows) => {
      const m: Record<string, TzInfo> = {};
      for (const r of rows) m[r.icao] = { country: r.country, region: r.region, lon: r.lon };
      setTz(m);
    }).catch(() => {});
  }, [flights]);

  // per-dag (lokal) timmar + flight-id:n; flyg över midnatt delas på två dagar
  const localDaily = useMemo(() => buildLocalDaily(flights, tz), [flights, tz]);
  const dailyAll = useMemo(() => [...localDaily.hours.entries()].map(([date, hours]) => ({ date, hours })).sort((a, b) => a.date.localeCompare(b.date)), [localDaily]);

  // 126-dagars fönster (9 sidor × 14) noll-fyllt — för load-swipe
  const dailyWin = useMemo(() => {
    const byDate = new Map(dailyAll.map((r) => [r.date, r.hours]));
    const out: { date: string; h: number }[] = [];
    for (let i = 125; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const iso = d.toISOString().slice(0, 10); out.push({ date: iso, h: byDate.get(iso) ?? 0 }); }
    return out;
  }, [dailyAll]);

  // monthly transforms (from full client map)
  const { hist, curArr, prevArr, baseline } = useMemo(() => {
    const curY = now.getFullYear();
    const get = (y: number, m: number) => D.monthly[`${y}-${String(m + 1).padStart(2, '0')}`] ?? 0;
    const hist: { y: number; m: number; h: number }[] = [];
    const keys = Object.keys(D.monthly).sort();
    if (keys.length) {
      const [fy, fmm] = keys[0].split('-').map(Number);
      let yy = fy, mm = fmm, g = 0;
      while ((yy < curY || (yy === curY && mm <= now.getMonth() + 1)) && g++ < 240) { hist.push({ y: yy, m: mm - 1, h: get(yy, mm - 1) }); mm++; if (mm > 12) { mm = 1; yy++; } }
    }
    const histWin = hist.length ? hist.slice(-42) : Array.from({ length: 18 }, (_, i) => { const d = new Date(curY, now.getMonth() - 17 + i, 1); return { y: d.getFullYear(), m: d.getMonth(), h: 0 }; });
    const curArr = Array.from({ length: 12 }, (_, m) => get(curY, m));
    const prevArr = Array.from({ length: 12 }, (_, m) => get(curY - 1, m));
    const flown = histWin.map((h) => h.h).filter((h) => h > 0);
    return { hist: histWin, curArr, prevArr, baseline: flown.length ? flown.reduce((s, h) => s + h, 0) / flown.length : 0 };
  }, [D.monthly]);

  // records from daily history
  const records = useMemo(() => {
    let allTime: { date: string; hours: number } | null = null;
    let yearBest: { date: string; hours: number } | null = null;
    const curY = now.getFullYear();
    for (const r of dailyAll) {
      if (!allTime || r.hours > allTime.hours) allTime = r;
      if (r.date.startsWith(String(curY)) && (!yearBest || r.hours > yearBest.hours)) yearBest = r;
    }
    return { allTime, yearBest };
  }, [dailyAll]);

  const thisMonthH = curArr[now.getMonth()] ?? 0;
  const loadCur = dailyWin.slice(-14);
  const loadPrev = dailyWin.slice(-28, -14);
  const dailyBaseLoad = (() => { const f = dailyWin.map((d) => d.h).filter((h) => h > 0); return f.length ? f.reduce((s, h) => s + h, 0) / f.length : 0; })();
  const loadSum = loadCur.reduce((s, d) => s + d.h, 0);
  const popPct = yearAvg14 > 0 ? Math.round(((loadSum - yearAvg14) / yearAvg14) * 100) : 0;
  const curYtd = curArr.slice(0, now.getMonth() + 1).reduce((s, h) => s + h, 0);
  const prevYtd = prevArr.slice(0, now.getMonth() + 1).reduce((s, h) => s + h, 0);
  const yoy = prevYtd > 0 ? Math.round(((curYtd - prevYtd) / prevYtd) * 100) : 0;
  const lv = loadView ?? { atPresent: true, curLabel: dailyWin.length ? `${fmtDM(dailyWin[112].date)}–${fmtDM(dailyWin[125].date)}` : '', prevLabel: dailyWin.length ? `${fmtDM(dailyWin[98].date)}–${fmtDM(dailyWin[111].date)}` : '', sum: loadSum };

  return (
    <View style={[st.card, { backgroundColor: C.card, borderColor: C.border }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text style={[st.head, { color: C.text2 }]}>HOURS / MONTH</Text>
        <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: C.success }}>{Math.round(thisMonthH)}h this month</Text>
      </View>

      <View style={{ flexDirection: 'row', gap: 3, backgroundColor: C.elevated, borderRadius: 9, padding: 3, marginBottom: 10 }}>
        {(['heatmap', 'bars', 'line'] as const).map((k) => (
          <TouchableOpacity key={k} onPress={() => setViz(k)} style={[st.seg, viz === k && { backgroundColor: C.primary }]}>
            <Text style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: viz === k ? C.deep : C.text3 }}>{k === 'heatmap' ? 'Heatmap' : k === 'bars' ? 'Bars' : 'Line'}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* legend (bars/line) — grå = förra året, cyan = i år / året i vy */}
      {viz !== 'heatmap' && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          {!(viz === 'bars' && !barsView.atPresent) && (
            <>
              <View style={[st.dot, { backgroundColor: C.muted, opacity: 0.6 }]} />
              <Text style={{ fontSize: 11, color: C.text3, marginRight: 8 }}>{now.getFullYear() - 1}</Text>
            </>
          )}
          <View style={[st.dot, { backgroundColor: C.primary }]} />
          <Text style={{ fontSize: 11, color: C.text3 }}>{viz === 'bars' ? barsView.curLabel : now.getFullYear()}</Text>
        </View>
      )}

      {viz === 'heatmap'
        ? <MonthYearHeatmap C={C} monthly={D.monthly} curY={now.getFullYear()} curM={now.getMonth()} yearShift={yearShift} setYearShift={setYearShift} sel={sel} setSel={setSel} records={records} />
        : viz === 'bars' ? <MonthlyBars C={C} months={hist} baseline={baseline} onView={setBarsView} />
          : <MonthlyLine C={C} cur={curArr} prev={prevArr} />}

      {/* monthly footer (bars/line) */}
      {viz !== 'heatmap' && (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 8 }}>
          {viz === 'bars' && (
            <>
              <Text style={{ fontFamily: MONO, fontSize: 8.5, color: C.muted }}>← Swipe to scroll back</Text>
              {prevYtd > 0 && <View style={{ width: 1, height: 11, backgroundColor: C.border }} />}
            </>
          )}
          {prevYtd > 0 && (
            <Text style={{ fontSize: 11, color: C.muted }}>
              <Text style={{ color: yoy >= 0 ? C.success : C.warning, fontWeight: '700', fontFamily: MONO }}>{yoy >= 0 ? '+' : ''}{yoy}%</Text> vs same period last year
            </Text>
          )}
        </View>
      )}

      <View style={{ height: 1, backgroundColor: C.separator, marginVertical: 14 }} />

      {viz === 'heatmap' ? (
        <IsoMonth C={C} sel={sel} setSel={setSel} dailyAll={dailyAll} dayIds={localDaily.ids} records={records} />
      ) : (
        <>
          <Text style={[st.head, { color: C.text2, marginBottom: 8 }]}>14-DAY ROLLING LOAD</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            {lv.atPresent && (
              <>
                <View style={[st.dot, { backgroundColor: C.muted, opacity: 0.6 }]} />
                <Text style={{ fontSize: 11, color: C.text3, marginRight: 8 }}>{lv.prevLabel}</Text>
              </>
            )}
            <View style={[st.dot, { backgroundColor: C.primary }]} />
            <Text style={{ fontSize: 11, color: C.text3 }}>{lv.curLabel}</Text>
            <View style={{ flex: 1 }} />
            <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: C.success }}>{lv.sum.toFixed(1)}h this period</Text>
          </View>
          {viz === 'bars'
            ? <LoadBars C={C} dailyWin={dailyWin} baseline={dailyBaseLoad} pageW={pageW} onView={setLoadView} />
            : <LoadLine C={C} cur={loadCur.map((d) => d.h)} prev={loadPrev.map((d) => d.h)} dates={loadCur.map((d) => d.date)} />}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 8 }}>
            {viz === 'bars' && (
              <>
                <Text style={{ fontFamily: MONO, fontSize: 8.5, color: C.muted }}>← Swipe to scroll back</Text>
                <View style={{ width: 1, height: 11, backgroundColor: C.border }} />
              </>
            )}
            <Text style={{ fontSize: 11, color: C.muted }}>
              <Text style={{ color: popPct >= 0 ? C.success : C.warning, fontWeight: '700', fontFamily: MONO }}>{popPct >= 0 ? '+' : ''}{popPct}%</Text>
              {popPct >= 0 ? ' over' : ' under'} annual baseline
            </Text>
          </View>
        </>
      )}
    </View>
  );
}

// ── Month × year heatmap grid ──
function MonthYearHeatmap({ C, monthly, curY, curM, yearShift, setYearShift, sel, setSel, records }: {
  C: InsightsTheme; monthly: Record<string, number>; curY: number; curM: number;
  yearShift: number; setYearShift: (f: (s: number) => number) => void;
  sel: { y: number; m: number }; setSel: (s: { y: number; m: number }) => void;
  records: { allTime: { date: string; hours: number } | null; yearBest: { date: string; hours: number } | null };
}) {
  const topYear = curY - yearShift;
  const rows = [topYear, topYear - 1];
  const get = (y: number, m: number) => monthly[`${y}-${String(m + 1).padStart(2, '0')}`] ?? 0;
  const max = Math.max(...rows.flatMap((y) => Array.from({ length: 12 }, (_, m) => get(y, m))), 0.1);
  const recPurple = records.allTime ? { y: Number(records.allTime.date.slice(0, 4)), m: Number(records.allTime.date.slice(5, 7)) - 1 } : null;
  const recGold = records.yearBest ? { y: curY, m: Number(records.yearBest.date.slice(5, 7)) - 1 } : null;

  return (
    <View style={{ gap: 5 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <TouchableOpacity onPress={() => setYearShift((s) => Math.min(20, s + 1))} style={[st.yArrow, { borderColor: C.border, backgroundColor: C.elevated }]}><Text style={{ color: C.text2, fontFamily: MONO, fontWeight: '700' }}>‹</Text></TouchableOpacity>
        <Text style={{ fontFamily: MONO, fontSize: 11, color: C.text3 }}>{topYear} / {topYear - 1}</Text>
        {yearShift > 0 && <TouchableOpacity onPress={() => setYearShift((s) => Math.max(0, s - 1))} style={[st.yArrow, { borderColor: C.border, backgroundColor: C.elevated }]}><Text style={{ color: C.text2, fontFamily: MONO, fontWeight: '700' }}>›</Text></TouchableOpacity>}
      </View>
      {rows.map((yr) => (
        <View key={yr} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Text style={{ width: 24, fontFamily: MONO, fontSize: 9, fontWeight: '700', color: yr === sel.y ? C.gold : C.muted }}>{String(yr).slice(2)}</Text>
          <View style={{ flex: 1, flexDirection: 'row', gap: 3 }}>
            {Array.from({ length: 12 }, (_, m) => {
              const v = get(yr, m);
              const intensity = v > 0 ? 0.16 + (v / max) * 0.84 : 0;
              const active = yr === sel.y && m === sel.m;
              const rec = recPurple && recPurple.y === yr && recPurple.m === m ? C.purple : (recGold && recGold.y === yr && recGold.m === m ? C.gold : null);
              return (
                <TouchableOpacity key={m} onPress={() => setSel({ y: yr, m })} activeOpacity={0.7}
                  style={{ flex: 1, aspectRatio: 1, borderRadius: 4, alignItems: 'center', justifyContent: 'center',
                    backgroundColor: v > 0 ? C.primary + Math.round(intensity * 255).toString(16).padStart(2, '0') : C.separator,
                    borderWidth: rec ? 1.5 : (active ? 1.5 : 1), borderColor: rec || (active ? C.gold : 'transparent') }}>
                  {v > 0 && <Text style={{ fontFamily: MONO, fontSize: 8, fontWeight: '700', color: intensity > 0.55 ? C.deep : C.text2 }}>{Math.round(v)}</Text>}
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}
      <View style={{ flexDirection: 'row', gap: 3, paddingLeft: 29 }}>
        {MONTHS.map((m, i) => <Text key={i} style={{ flex: 1, textAlign: 'center', fontFamily: MONO, fontSize: 8.5, fontWeight: '700', color: i === sel.m ? C.gold : (i === curM ? C.primary : C.faint) }}>{m}</Text>)}
      </View>
    </View>
  );
}

// ── Isometric 3D month view ──
function IsoMonth({ C, sel, setSel, dailyAll, dayIds, records }: {
  C: InsightsTheme; sel: { y: number; m: number }; setSel: (s: { y: number; m: number }) => void;
  dailyAll: { date: string; hours: number }[];
  dayIds: Map<string, number[]>;
  records: { allTime: { date: string; hours: number } | null; yearBest: { date: string; hours: number } | null };
}) {
  const router = useRouter();
  const flights = useFlightStore((s) => s.flights);
  const [day, setDay] = useState<number | null>(null);
  const now = new Date();
  const { y, m } = sel;
  const nDays = daysInMonth(y, m);

  const days = useMemo(() => {
    const out = Array(nDays).fill(0);
    for (const r of dailyAll) {
      if (r.date.slice(0, 7) === `${y}-${String(m + 1).padStart(2, '0')}`) out[Number(r.date.slice(8, 10)) - 1] = r.hours;
    }
    return out;
  }, [dailyAll, y, m, nDays]);

  const max = Math.max(...days, 0.1);
  let monthMaxDay = 0, monthMaxV = 0;
  days.forEach((v: number, i: number) => { if (v > monthMaxV) { monthMaxV = v; monthMaxDay = i + 1; } });
  const dateStr = (d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const tierFor = (d: number): 'alltime' | 'year' | 'month' | null => {
    if (d !== monthMaxDay || monthMaxV <= 0) return null;
    if (records.allTime && records.allTime.date === dateStr(d)) return 'alltime';
    if (records.yearBest && y === now.getFullYear() && records.yearBest.date === dateStr(d)) return 'year';
    return 'month';
  };
  const HL = { alltime: C.purple, year: C.gold, month: C.silver };

  // iso projection
  const TW = 38, TH = 19, FW = 16, FH = 8, MAXBAR = 56;
  const isoX = (c: number, r: number) => (c - r) * (TW / 2);
  const isoY = (c: number, r: number) => (c + r) * (TH / 2);
  const rgb = ((): [number, number, number] => { const n = parseInt(C.primary.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; })();
  const shade = (mult: number, a = 1) => `rgba(${Math.round(rgb[0] * mult)},${Math.round(rgb[1] * mult)},${Math.round(rgb[2] * mult)},${a})`;
  const shadeHex = (hex: string, mult: number, a = 1) => { const n = parseInt(hex.replace('#', ''), 16); return `rgba(${Math.min(255, Math.round(((n >> 16) & 255) * mult))},${Math.min(255, Math.round(((n >> 8) & 255) * mult))},${Math.min(255, Math.round((n & 255) * mult))},${a})`; };
  const firstDow = (new Date(y, m, 1).getDay() + 6) % 7;
  const isCur = y === now.getFullYear() && m === now.getMonth();

  const bars = days.map((v: number, d: number) => { const idx = firstDow + d; return { v, day: d + 1, col: idx % 7, row: Math.floor(idx / 7) }; });
  bars.sort((a, b) => (a.row + a.col) - (b.row + b.col));

  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
  const polys: any[] = [];
  bars.forEach((b, k) => {
    const bx = isoX(b.col, b.row), by = isoY(b.col, b.row);
    const intensity = b.v > 0 ? 0.32 + (b.v / max) * 0.68 : 0;
    const bh = b.v > 0 ? 7 + (b.v / max) * MAXBAR : 0;
    const ty = by - bh;
    minX = Math.min(minX, bx - FW); maxX = Math.max(maxX, bx + FW);
    minY = Math.min(minY, ty - FH); maxY = Math.max(maxY, by + FH);
    if (b.v <= 0) {
      const dow = new Date(y, m, b.day).getDay();
      const weekend = dow === 0 || dow === 6;
      polys.push(
        <G key={`e${k}`} opacity={0.78}>
          <Polygon points={`${bx - FW},${by} ${bx},${by - FH} ${bx + FW},${by} ${bx},${by + FH}`} fill={weekend ? 'rgba(255,107,91,0.22)' : 'rgba(255,255,255,0.07)'} stroke={weekend ? 'rgba(255,107,91,0.6)' : 'rgba(255,255,255,0.18)'} strokeWidth={0.6} />
          {/* ordinal-datum roterat så det "ligger platt" på rutans ovansida (övre högra hörnet) */}
          <G transform={`matrix(0.894 0.447 -0.894 0.447 ${bx + 2} ${by - FH + 6})`}>
            <SvgText x={0} y={2} fontSize={5.5} fontFamily={MONO} fontWeight="700" fill="#FFFFFF" textAnchor="middle">{ord(b.day)}</SvgText>
          </G>
        </G>,
      );
      return;
    }
    const tier = tierFor(b.day);
    const isToday = isCur && b.day === now.getDate();
    const topFill = tier ? shadeHex(HL[tier], 1.0) : (isToday ? '#FFFFFF' : shade(0.7 + intensity * 0.55));
    const leftFill = tier ? shadeHex(HL[tier], 0.45) : shade(0.24 + intensity * 0.2);
    const rightFill = tier ? shadeHex(HL[tier], 0.72) : shade(0.46 + intensity * 0.32);
    const hLabel = `${b.v.toFixed(1)}h`;        // en decimal, t.ex. 2.6h / 10.9h
    const hFs = hLabel.length <= 4 ? 7.5 : 6.5;  // krymp så 3 siffror får plats i rutan
    const isSel = day === b.day;
    polys.push(
      <G key={`b${k}`} onPress={() => setDay(b.day)}>
        <Polygon points={`${bx - FW},${by} ${bx},${by + FH} ${bx},${ty + FH} ${bx - FW},${ty}`} fill={leftFill} />
        <Polygon points={`${bx + FW},${by} ${bx},${by + FH} ${bx},${ty + FH} ${bx + FW},${ty}`} fill={rightFill} />
        <Polygon points={`${bx - FW},${ty} ${bx},${ty - FH} ${bx + FW},${ty} ${bx},${ty + FH}`} fill={topFill} stroke={isSel ? C.gold : (tier ? shadeHex(HL[tier], 1.3) : (isToday ? C.primary : shade(1.1)))} strokeWidth={isSel ? 2 : (tier ? 1.2 : (isToday ? 1.4 : 0.5))} />
        {b.v > 0 && (
          <G transform={`matrix(0.894 0.447 -0.894 0.447 ${bx} ${ty})`}>
            <SvgText x={0} y={2} fontSize={hFs} fontFamily={MONO} fontWeight="700" fill={tier || isToday || intensity > 0.55 ? C.deep : shade(0.2)} textAnchor="middle">{hLabel}</SvgText>
          </G>
        )}
      </G>,
    );
  });

  const pad = 8;
  const vbW = Math.max((maxX - minX) + pad * 2, 100);
  const vbH = Math.max((maxY - minY) + pad * 2, 100);

  const dayIdList = day ? (dayIds.get(dateStr(day)) ?? []) : [];
  const dayFlights = flights.filter((f) => dayIdList.includes(f.id));
  const openDay = () => {
    if (dayFlights.length === 1) { router.push(`/flight/${dayFlights[0].id}`); return; }
    const sorted = [...dayFlights].sort((a, b) => (a.dep_utc || '').localeCompare(b.dep_utc || '') || a.id - b.id);
    const last = sorted[sorted.length - 1];
    if (!last) return;
    const [yy, mm] = last.date.split('-');
    router.push({ pathname: '/(tabs)/log', params: { focusFlightId: String(last.id), focusYear: yy, focusMonth: String(Number(mm)), t: String(Date.now()) } } as any);
  };
  const tier = day ? tierFor(day) : null;
  const NOTE = { alltime: 'Most all time', year: 'Most this year', month: 'Most this month' };

  const stepMonth = (delta: number) => { const d = new Date(y, m + delta, 1); if (d.getTime() <= new Date(now.getFullYear(), now.getMonth(), 1).getTime()) { setSel({ y: d.getFullYear(), m: d.getMonth() }); setDay(null); } };

  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <TouchableOpacity onPress={() => stepMonth(-1)} style={[st.mArrow, { backgroundColor: C.elevated, borderColor: C.border }]}><Text style={{ color: C.text2, fontFamily: MONO, fontWeight: '700' }}>‹</Text></TouchableOpacity>
          <Text style={{ fontFamily: MONO, fontSize: 12, fontWeight: '700', letterSpacing: 1.2, color: C.text2 }}>{MONTH3[m]} {y}</Text>
        </View>
        {!(y === now.getFullYear() && m === now.getMonth()) && <TouchableOpacity onPress={() => stepMonth(1)} style={[st.mArrow, { backgroundColor: C.elevated, borderColor: C.border }]}><Text style={{ color: C.text2, fontFamily: MONO, fontWeight: '700' }}>›</Text></TouchableOpacity>}
      </View>

      <Svg width="100%" height={Math.min(300, Math.round((vbH / vbW) * 340))} viewBox={`${minX - pad} ${minY - pad} ${vbW} ${vbH}`}>{polys}</Svg>

      {day && (
        <View style={{ marginTop: 8, backgroundColor: C.deep, borderWidth: 1, borderColor: C.gold, borderRadius: 12, padding: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
            <Text style={{ fontFamily: SERIF, fontSize: 16, fontWeight: '600', color: C.text }}>{MONTH3[m]} {day}</Text>
            <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: C.gold }}>{(days[day - 1] ?? 0).toFixed(1)}h · {dayFlights.length} flight{dayFlights.length !== 1 ? 's' : ''}</Text>
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={() => setDay(null)}><Text style={{ color: C.muted, fontFamily: MONO, fontSize: 12 }}>✕</Text></TouchableOpacity>
          </View>
          {tier && <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '700', color: HL[tier], marginBottom: 6 }}>● {NOTE[tier]}</Text>}
          {dayFlights.slice(0, 6).map((f) => (
            <View key={f.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 }}>
              <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: C.primary, width: 48 }}>{f.aircraft_type || '—'}</Text>
              <Text style={{ flex: 1, fontFamily: MONO, fontSize: 10.5, color: C.text2 }}>{f.dep_place} → {f.arr_place}</Text>
              <Text style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: C.text }}>{(f.total_time || 0).toFixed(1)}h</Text>
            </View>
          ))}
          {dayFlights.length > 0 && (
            <TouchableOpacity onPress={openDay} style={{ marginTop: 10, paddingVertical: 8, borderRadius: 9, borderWidth: 1, borderColor: C.border, backgroundColor: C.elevated, alignItems: 'center' }}>
              <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: C.primary }}>{dayFlights.length === 1 ? 'Open this flight →' : 'Open this day in logbook →'}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
      <Text style={{ fontFamily: MONO, fontSize: 8.5, color: C.muted, textAlign: 'center', marginTop: 6 }}>Tap a bar for the day</Text>
    </View>
  );
}

// ── Monthly bars ──
function MonthlyBars({ C, months, baseline, onView }: { C: InsightsTheme; months: { y: number; m: number; h: number }[]; baseline: number; onView: (v: { atPresent: boolean; curLabel: string }) => void }) {
  const ref = useRef<ScrollView>(null);
  const [atPresent, setAtPresent] = useState(true);
  const BARW = 26, PLOT = 120;
  const n = months.length;
  const max = Math.max(...months.map((m) => m.h), baseline, 0.1);
  const px = (v: number) => Math.max((v / max) * PLOT, v > 0 ? 3 : 0);
  const ghostFor = (i: number) => (i >= n - 12 && i >= 12 ? months[i - 12].h : 0);
  useEffect(() => { const t = setTimeout(() => ref.current?.scrollToEnd({ animated: false }), 60); return () => clearTimeout(t); }, [n]);
  const onScroll = (e: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const present = contentSize.width - layoutMeasurement.width - contentOffset.x < 8;
    const idx = Math.min(n - 1, Math.max(0, Math.round((contentOffset.x + layoutMeasurement.width) / BARW) - 1));
    setAtPresent(present);
    onView({ atPresent: present, curLabel: String(months[idx]?.y ?? new Date().getFullYear()) });
  };
  return (
    <ScrollView horizontal ref={ref} onScroll={onScroll} scrollEventThrottle={16} showsHorizontalScrollIndicator={false}>
      <View style={{ width: n * BARW, height: PLOT + 22 }}>
        {atPresent && baseline > 0 && <View style={{ position: 'absolute', left: 0, right: 0, top: PLOT * (1 - baseline / max), height: 1, backgroundColor: C.gold, opacity: 0.7 }} />}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: PLOT }}>
          {months.map((m, i) => {
            const gh = atPresent ? ghostFor(i) : 0;
            return (
              <View key={i} style={{ width: BARW, height: PLOT, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 1.5 }}>
                {gh > 0 && <View style={{ width: 5, height: px(gh), borderRadius: 2, backgroundColor: C.muted, opacity: 0.55 }} />}
                {m.h > 0 && <View style={{ width: 5, height: px(m.h), borderRadius: 2, backgroundColor: C.primary }} />}
              </View>
            );
          })}
        </View>
        <View style={{ flexDirection: 'row', marginTop: 4 }}>
          {months.map((m, i) => (
            <Text key={i} style={{ width: BARW, textAlign: 'center', fontFamily: MONO, fontSize: m.m === 0 ? 8 : 9, fontWeight: '700', color: i === n - 1 ? C.primary : (m.m === 0 ? C.text3 : C.faint) }}>{m.m === 0 ? `'${String(m.y).slice(2)}` : MONTHS[m.m]}</Text>
          ))}
        </View>
        {atPresent && baseline > 0 && (
          <Text style={{ position: 'absolute', right: 3, top: PLOT * (1 - baseline / max) - 11, fontFamily: MONO, fontSize: 8, fontWeight: '700', color: C.gold, backgroundColor: C.card, paddingHorizontal: 2 }}>{`Ø ${Math.round(baseline)}h`}</Text>
        )}
      </View>
    </ScrollView>
  );
}

function MonthlyLine({ C, cur, prev }: { C: InsightsTheme; cur: number[]; prev: number[] }) {
  const W = 320, H = 132, padT = 12, padB = 22;
  const curIdx = new Date().getMonth();
  const cumOf = (arr: number[]) => { let s = 0; return arr.map((v) => (s += v)); };
  const curCum = cumOf(cur), prevCum = cumOf(prev);
  const max = Math.max(...prevCum, curCum[curIdx] || 0, 0.1);
  const x = (i: number) => (i / 11) * W;
  const y = (v: number) => padT + (1 - v / max) * (H - padB - padT);
  const smooth = (arr: number[], upto: number) => { const pts = arr.map((v, i) => [x(i), y(v)] as [number, number]).filter((_, i) => i <= upto); if (pts.length < 2) return ''; let d = `M ${pts[0][0]} ${pts[0][1]}`; for (let i = 1; i < pts.length; i++) { const mx = (pts[i - 1][0] + pts[i][0]) / 2; d += ` C ${mx} ${pts[i - 1][1]} ${mx} ${pts[i][1]} ${pts[i][0]} ${pts[i][1]}`; } return d; };
  const curPath = smooth(curCum, curIdx), prevPath = smooth(prevCum, 11);
  const area = curPath ? `${curPath} L ${x(curIdx)} ${H - padB} L ${x(0)} ${H - padB} Z` : '';
  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
      <Defs><LinearGradient id="inArea" x1="0" x2="0" y1="0" y2="1"><Stop offset="0" stopColor={C.primary} stopOpacity={0.3} /><Stop offset="1" stopColor={C.primary} stopOpacity={0} /></LinearGradient></Defs>
      {area ? <Path d={area} fill="url(#inArea)" /> : null}
      {prevPath ? <Path d={prevPath} fill="none" stroke={C.muted} strokeWidth={1.6} opacity={0.5} /> : null}
      {curPath ? <Path d={curPath} fill="none" stroke={C.primary} strokeWidth={2.4} strokeLinecap="round" /> : null}
      {/* slutmarkörer: i år (cyan) + förra året vid samma punkt (grå) med kopplingslinje + Xh-etiketter */}
      {curCum[curIdx] != null && (() => {
        const cv = curCum[curIdx], pv = prevCum[curIdx] ?? 0, xc = x(curIdx);
        return (
          <G>
            <SvgLine x1={xc} y1={y(cv)} x2={xc} y2={y(pv)} stroke={C.text3} strokeWidth={1} strokeDasharray="2 2" opacity={0.5} />
            <Circle cx={xc} cy={y(pv)} r={3} fill={C.deep} stroke={C.muted} strokeWidth={1.6} />
            <Circle cx={xc} cy={y(cv)} r={3.5} fill={C.primary} />
            <SvgText x={xc - 7} y={y(cv) + (cv >= pv ? -7 : 12)} fontSize={11} fontFamily={MONO} fontWeight="700" fill={C.primary} textAnchor="end">{Math.round(cv)}h</SvgText>
            <SvgText x={xc - 7} y={y(pv) + (pv > cv ? -7 : 12)} fontSize={9} fontFamily={MONO} fontWeight="700" fill={C.text3} textAnchor="end">{Math.round(pv)}h</SvgText>
          </G>
        );
      })()}
      {MONTHS.map((mm, i) => <SvgText key={i} x={x(i)} y={H - 6} fontSize={9} fontFamily={MONO} fontWeight="700" fill={i === curIdx ? C.primary : C.faint} textAnchor="middle">{mm}</SvgText>)}
    </Svg>
  );
}

function LoadBars({ C, dailyWin, baseline, pageW, onView }: { C: InsightsTheme; dailyWin: { date: string; h: number }[]; baseline: number; pageW: number; onView: (v: { atPresent: boolean; curLabel: string; prevLabel: string; sum: number }) => void }) {
  const ref = useRef<ScrollView>(null);
  const PAGES = 9, PLOT = 84;
  const n = dailyWin.length;
  const windowFor = (p: number) => dailyWin.slice(n - 14 * (p + 1), n - 14 * p);
  const report = (p: number) => {
    const win = windowFor(p); if (!win.length) return;
    const present = p === 0; const pwin = windowFor(p + 1);
    onView({
      atPresent: present,
      curLabel: present ? `${fmtDM(win[0].date)}–${fmtDM(win[win.length - 1].date)}` : `Week ${isoWeek(new Date(win[0].date))}–${isoWeek(new Date(win[win.length - 1].date))}`,
      prevLabel: pwin.length ? `${fmtDM(pwin[0].date)}–${fmtDM(pwin[pwin.length - 1].date)}` : '',
      sum: win.reduce((s, d) => s + d.h, 0),
    });
  };
  useEffect(() => { const t = setTimeout(() => { ref.current?.scrollToEnd({ animated: false }); report(0); }, 60); return () => clearTimeout(t); }, [n, pageW]);
  const onScroll = (e: any) => { const idx = Math.round(e.nativeEvent.contentOffset.x / pageW); report(Math.max(0, (PAGES - 1) - idx)); };
  if (n < 14) return <View style={{ height: PLOT + 20 }} />;
  return (
    <ScrollView horizontal ref={ref} pagingEnabled onScroll={onScroll} scrollEventThrottle={16} showsHorizontalScrollIndicator={false}>
      {Array.from({ length: PAGES }, (_, j) => {
        const p = (PAGES - 1) - j;
        const present = p === 0;
        const win = windowFor(p);
        const ghost = present ? windowFor(1) : [];
        const pageMax = Math.max(...win.map((d) => d.h), ...(present ? ghost.map((d) => d.h) : []), present ? baseline : 0, 0.1);
        const px = (v: number) => Math.max((v / pageMax) * PLOT, v > 0 ? 3 : 0);
        return (
          <View key={j} style={{ width: pageW, height: PLOT + 20 }}>
            {present && baseline > 0 && <View style={{ position: 'absolute', left: 0, right: 0, top: PLOT * (1 - baseline / pageMax), height: 1, backgroundColor: C.gold, opacity: 0.7 }} />}
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: PLOT, gap: 4 }}>
              {win.map((d, i) => {
                const gh = present && ghost[i] ? ghost[i].h : 0;
                return (
                  <View key={i} style={{ flex: 1, height: PLOT, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 1 }}>
                    {gh > 0 && <View style={{ width: 4, height: px(gh), borderRadius: 1.5, backgroundColor: C.muted, opacity: 0.5 }} />}
                    {d.h > 0 && <View style={{ width: 4, height: px(d.h), borderRadius: 1.5, backgroundColor: C.primary }} />}
                    {d.h === 0 && gh === 0 && <View style={{ width: 4, height: 2, borderRadius: 1, backgroundColor: C.separator }} />}
                  </View>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', gap: 4, marginTop: 4 }}>
              {win.map((d, i) => <Text key={i} style={{ flex: 1, textAlign: 'center', fontFamily: MONO, fontSize: 8, fontWeight: '700', color: present && i === win.length - 1 ? C.primary : C.faint }}>{DOWk[new Date(d.date).getDay()]}</Text>)}
            </View>
            {present && baseline > 0 && (
              <Text style={{ position: 'absolute', right: 3, top: PLOT * (1 - baseline / pageMax) - 11, fontFamily: MONO, fontSize: 8, fontWeight: '700', color: C.gold, backgroundColor: C.card, paddingHorizontal: 2 }}>{`Ø ${baseline.toFixed(1)}h`}</Text>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

function LoadLine({ C, cur, prev, dates }: { C: InsightsTheme; cur: number[]; prev: number[]; dates: string[] }) {
  const W = 320, H = 110, padT = 10, padB = 22;
  const n = Math.max(cur.length, 2);
  const cumOf = (arr: number[]) => { let s = 0; return arr.map((v) => (s += v)); };
  const curCum = cumOf(cur), prevCum = cumOf(prev.length ? prev : cur.map(() => 0));
  const max = Math.max(...curCum, ...prevCum, 0.1);
  const x = (i: number) => (i / (n - 1)) * W;
  const y = (v: number) => padT + (1 - v / max) * (H - padB - padT);
  const smooth = (arr: number[]) => { if (arr.length < 2) return ''; let d = `M ${x(0)} ${y(arr[0])}`; for (let i = 1; i < arr.length; i++) { const mx = (x(i - 1) + x(i)) / 2; d += ` C ${mx} ${y(arr[i - 1])} ${mx} ${y(arr[i])} ${x(i)} ${y(arr[i])}`; } return d; };
  return (
    <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`}>
      <Defs><LinearGradient id="inLoadArea" x1="0" x2="0" y1="0" y2="1"><Stop offset="0" stopColor={C.primary} stopOpacity={0.28} /><Stop offset="1" stopColor={C.primary} stopOpacity={0} /></LinearGradient></Defs>
      {curCum.length >= 2 ? <Path d={`${smooth(curCum)} L ${x(n - 1)} ${H - padB} L ${x(0)} ${H - padB} Z`} fill="url(#inLoadArea)" /> : null}
      {prevCum.length >= 2 ? <Path d={smooth(prevCum)} fill="none" stroke={C.muted} strokeWidth={1.4} opacity={0.45} /> : null}
      {curCum.length >= 2 ? <Path d={smooth(curCum)} fill="none" stroke={C.primary} strokeWidth={2.2} strokeLinecap="round" /> : null}
      {curCum.length >= 2 ? <Circle cx={x(n - 1)} cy={y(curCum[curCum.length - 1])} r={3.4} fill={C.primary} /> : null}
      {dates.map((iso, i) => <SvgText key={i} x={x(i)} y={H - 6} fontSize={7.5} fontFamily={MONO} fontWeight="700" fill={i === n - 1 ? C.primary : C.faint} textAnchor="middle">{DOWk[new Date(iso).getDay()]}</SvgText>)}
    </Svg>
  );
}

const st = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 16 },
  head: { fontFamily: MONO, fontSize: 11, fontWeight: '700', letterSpacing: 1.4 },
  seg: { flex: 1, paddingVertical: 6, borderRadius: 7, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  yArrow: { width: 16, height: 16, borderRadius: 5, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  mArrow: { width: 30, height: 30, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
