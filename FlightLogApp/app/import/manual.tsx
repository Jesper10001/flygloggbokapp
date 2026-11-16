// "Block import" (pilot) — tidigare erfarenhet som klumpsumma eller år för år.
// Startsidan (som Logbook scan / Import logbook): fota senaste uppslaget (eller ett per årsskifte) så läser
// Claude summaraderna och flygplanen (services/totalsScan.ts) under Blade-myntet (BladeProgress), och formuläret
// fylls i därifrån; "Enter by hand" öppnar det tomt. Fotoflödet följer skanningens spärr (SCAN_OPEN).
// Granskningen (design "Block import, ny granskning" 2026-11-16, samma sida efter foto och för Enter by hand):
// totalen överst med raden som bevisar den, det som inte går ihop först (gult, Use/Keep, Save väntar på det),
// sedan EN lista med loggbokens kolumner där varje tid står i ett eget LED-fält, "Add a time" för det boken saknar
// kolumn för, och "If you want": fördelning per flygplanstyp och simulator, som fälls ut först när man vill.
// Tiden kan ges ut per flygplanstyp (mätaren visar hur mycket som är kvar). Sparas som:
//   • en summeringsrad (flight_type='summary') per flygplanstyp med typens tid,
//   • en summeringsrad utan typ med resten av tiden + alla nedbrytningar (PIC, IFR, landningar …),
//   • en sim-rad (flight_type='sim', sim_category) per simulatortyp — hålls utanför flygtiden.
// Alla rader har remarks "Blades previous experience" (+ år för summeringsraderna år för år).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { HowItWorks } from '../../components/HowItWorks';
import { BladeProgress } from '../../components/BladeProgress';
import { GlassDialog, DialogOption } from '../../components/GlassDialog';
import { isScanCameraAvailable } from '../../modules/scan-camera';
import { SCAN_OPEN, type ScanImage } from '../../store/scanStore';
import { useTotalsScanStore, type TotalsMode } from '../../store/totalsScanStore';
import { askAiConsent } from '../../services/aiConsent';
import { isTokenQuotaError, openCoinShop } from '../../utils/tokenGate';
import { enrichFleetInBackground } from '../../services/fleetEnrich';
import {
  readTotalsPhoto, buildPeriods, periodLabel, COUNT_FIELDS, type TotalsReading, type YearEnd, type FormField,
} from '../../services/totalsScan';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  insertFlight, getFirstFlightDate, dayBefore, getFleetRegistrationTypes, getRecentAircraftTypes, addAircraftTypeToRegistry,
} from '../../db/flights';
import { useFlightStore } from '../../store/flightStore';
import { Colors } from '../../constants/colors';
import {
  type XPalette, toMin, hm, minToHours, Card, Section, ModeSwitch, HeroTotal, TimeRow, SumCheck,
  Hint, ChipGroup, AllocationMeter, AddPicker, YearBars, YearHeader, SaveBar, ALLOC_COLORS, LedText, LedInput,
} from '../../components/experience/ExperienceKit';

const PREV_EXP_REMARK = 'Blades previous experience';

// ── Fält ─────────────────────────────────────────────────────────────────────

type Field = { key: string; label: string };
const ROLE: Field[] = [{ key: 'pic', label: 'PIC' }, { key: 'co_pilot', label: 'Co-pilot' }, { key: 'dual', label: 'Dual' }, { key: 'instructor', label: 'Instructor' }];
const CREW: Field[] = [{ key: 'single_pilot', label: 'Single pilot' }, { key: 'multi_pilot', label: 'Multi-pilot' }];
const COND: Field[] = [{ key: 'ifr', label: 'IFR' }, { key: 'night', label: 'Night' }, { key: 'nvg', label: 'NVG' }];
const LAND: Field[] = [{ key: 'landings_day', label: 'Day' }, { key: 'landings_night', label: 'Night' }];
const SPECIAL: Field[] = [
  { key: 'examiner', label: 'Examiner' }, { key: 'safety_pilot', label: 'Safety pilot' }, { key: 'spic', label: 'SPIC' },
  { key: 'ferry_pic', label: 'Ferry PIC' }, { key: 'observer', label: 'Observer' }, { key: 'relief_crew', label: 'Relief crew' },
];
const SIMS = [
  { key: 'sim_FFS', cat: 'FFS', label: 'FFS', sub: 'Full flight simulator' },
  { key: 'sim_FTD', cat: 'FTD', label: 'FTD', sub: 'Flight training device' },
  { key: 'sim_FNPT_II', cat: 'FNPT_II', label: 'FNPT II', sub: 'Flight and navigation procedures trainer II' },
  { key: 'sim_FNPT_I', cat: 'FNPT_I', label: 'FNPT I', sub: 'Flight and navigation procedures trainer I' },
  { key: 'sim_BITD', cat: 'BITD', label: 'BITD', sub: 'Basic instrument training device' },
  { key: 'sim_CPT_PPT', cat: 'CPT_PPT', label: 'CPT/PPT', sub: 'Cockpit or procedures trainer' },
  { key: 'sim_CBT', cat: 'CBT', label: 'CBT', sub: 'Computer-based training' },
] as const;

interface Ac { id: string; type: string; time: string; found?: boolean }
// Raden under totalen när den lästs ur foto: kontrollen BF + this page, eller hur ett år räknats fram.
type Eq =
  | { kind: 'bf'; bf: number; page: number; ok: boolean }
  | { kind: 'year'; a: number; aLabel: string; b?: number; bLabel?: string };
interface Block {
  id: string;
  year: string;
  total: string;
  v: Record<string, string>;
  shown: string[];
  aircraft: Ac[];
  showAircraft: boolean;
  photo: string[];          // fält som lästs ur fotot ('total' = totaltiden)
  flags: string[];          // fält att kontrollera (gula)
  eq?: Eq;
  simRead?: number;         // simulatortid i loggboken (typen väljs av användaren)
  checks?: Record<string, { bf: number; page: number }>;   // gula fält med BF + this page ur fotot (Use-knappen)
  fromYear?: number | null; // år för år från foto: perioden from–year (null = från början); undefined = ett år
}

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const emptyBlock = (year = ''): Block => ({ id: uid(), year, total: '', v: {}, shown: [], aircraft: [], showAircraft: false, photo: [], flags: [] });
// Loggbokens vanliga kolumner: visas alltid i listan när man skriver in för hand.
const LOGBOOK_KEYS = ['pic', 'co_pilot', 'dual', 'multi_pilot', 'single_pilot', 'ifr', 'night', 'landings_day', 'landings_night'];
const blockLabel = (b: Block) => (b.fromYear === undefined ? b.year : periodLabel({ from: b.fromYear, to: parseInt(b.year, 10) || 0 }));
const simMins = (b: Block) => SIMS.reduce((a, s) => a + toMin(b.v[s.key] ?? ''), 0);
const isReady = (b: Block) => toMin(b.total) > 0 || simMins(b) > 0 || (b.simRead ?? 0) > 0;
const validYear = (y: string) => { const n = parseInt(y, 10); return n >= 1950 && n <= 2099; };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const niceDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${parseInt(m[3], 10)} ${MONTHS[parseInt(m[2], 10) - 1]} ${m[1]}` : iso;
};

// ── Ett block (hela formuläret för klumpsumman eller ett år) ──────────────────

function BlockForm({
  P, block, yearly, fleet, onChange,
}: {
  P: XPalette; block: Block; yearly: boolean;
  fleet: { label: string; regs: number }[];
  onChange: (fn: (b: Block) => Block) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [showSim, setShowSim] = useState(false);
  const total = toMin(block.total);
  const fromPhoto = block.photo.length > 0;
  const val = (k: string) => block.v[k] ?? '';
  // Att skriva i ett gult fält räknas som att man kontrollerat det.
  const setVal = (k: string) => (v: string) => onChange((b) => ({ ...b, v: { ...b.v, [k]: v }, flags: b.flags.filter((f) => f !== k) }));
  const has = (k: string) => block.shown.includes(k) || !!val(k);
  const ALL: Field[] = [...ROLE, ...CREW, ...COND, ...LAND, ...SPECIAL];
  const integer = (k: string) => k === 'landings_day' || k === 'landings_night';
  const labelOf = (f: Field) => (LAND.includes(f) ? `${f.label} landings` : f.label);
  const open = block.flags.filter((k) => k !== 'total' && ALL.some((f) => f.key === k));
  // Listan: det fotot läste (eller bokens vanliga kolumner för hand) + det man lagt till, i loggbokens ordning.
  const base = (k: string) => (fromPhoto ? block.photo.includes(k) : LOGBOOK_KEYS.includes(k));
  const rows = ALL.filter((f) => !open.includes(f.key) && (base(f.key) || has(f.key)));
  const extra = (k: string) => !base(k);
  const addable = ALL.filter((f) => !rows.includes(f) && !open.includes(f.key));
  const add = (k: string) => { setAdding(false); onChange((b) => ({ ...b, shown: b.shown.includes(k) ? b.shown : [...b.shown, k] })); };
  const remove = (k: string) => onChange((b) => ({ ...b, shown: b.shown.filter((x) => x !== k), v: { ...b.v, [k]: '' } }));

  const sims = SIMS.filter((s) => has(s.key));
  const hiddenSims = SIMS.filter((s) => !has(s.key));
  const acMins = block.aircraft.map((a) => toMin(a.time));
  const showAircraft = block.showAircraft;
  const roleMain = ['pic', 'co_pilot', 'dual'].filter((k) => !!val(k));
  const roleSum = roleMain.reduce((a, k) => a + toMin(val(k)), 0);
  const crewKeys = ['single_pilot', 'multi_pilot'].filter((k) => !!val(k));
  const crewSum = crewKeys.reduce((a, k) => a + toMin(val(k)), 0);

  const taken = new Set(block.aircraft.map((a) => a.type.trim().toUpperCase()));
  const suggestions = fleet
    .filter((f) => !taken.has(f.label.toUpperCase()))
    .map((f) => ({ key: f.label, label: f.label, sub: f.regs ? `${f.regs} in Fleet` : undefined }));
  const fleetRegs = (type: string) => fleet.find((f) => f.label.toUpperCase() === type.trim().toUpperCase())?.regs;
  const acSub = (type: string) => {
    const n = fleetRegs(type);
    if (n == null) return 'New type, added to Fleet';
    return n ? `${n} in Fleet` : 'In your logbook';
  };
  const found = block.aircraft.filter((a) => a.found).map((a) => a.type);
  const simTotal = block.simRead ?? simMins(block);

  return (
    <>
      <HeroTotal
        P={P}
        label={yearly ? `Flight time in ${blockLabel(block) || 'this year'}` : 'Total flight time'}
        value={block.total}
        onChange={(v) => onChange((b) => ({ ...b, total: v }))}
        hint={block.eq ? undefined : yearly ? 'The flight time for the year. Type 214:10 or 214.2.' : 'The "Total to date" line on your last logbook page. Type 1248:30 or 1248.5.'}
        footer={block.eq ? <EqLine P={P} eq={block.eq} /> : null}
      />

      {/* Det som inte går ihop: först, gult. Use = summan av Brought forward och sidan, Keep = det som står. */}
      {open.length ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: P.warning, fontSize: 13, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', paddingHorizontal: 4 }}>
            {open.length} to check
          </Text>
          {open.map((k) => {
            const f = ALL.find((x) => x.key === k)!;
            const c = block.checks?.[k];
            const fmtv = (m: number) => (integer(k) ? String(m) : hm(m));
            const sum = c ? c.bf + c.page : null;
            const resolve = (v?: string) => onChange((b) => ({ ...b, v: v != null ? { ...b.v, [k]: v } : b.v, flags: b.flags.filter((x) => x !== k) }));
            return (
              <View key={k} style={{ borderRadius: 16, borderWidth: 1, borderColor: P.warning + '73', backgroundColor: P.warning + '12', padding: 14, paddingHorizontal: 16, gap: 12 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Text style={{ flex: 1, color: P.text, fontSize: 16, fontWeight: '600' }}>{labelOf(f)}</Text>
                  <LedInput P={P} value={val(k)} onChangeText={setVal(k)} width={128} integer={integer(k)} label={labelOf(f)} />
                  {!integer(k) ? <Text style={{ color: P.text2, fontSize: 13, width: 9 }}>h</Text> : null}
                </View>
                <Text style={{ color: '#CFE0EE', fontSize: 13, lineHeight: 19 }}>
                  {c && sum != null
                    ? `Brought forward ${fmtv(c.bf)} + this page ${fmtv(c.page)} makes ${fmtv(sum)}. Your page says ${val(k) || '—'}.`
                    : 'Check this against your logbook. Change it above if it is wrong.'}
                </Text>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {c && sum != null && fmtv(sum) !== val(k) ? (
                    <TouchableOpacity onPress={() => resolve(fmtv(sum))} accessibilityRole="button"
                      style={{ flex: 1, height: 44, borderRadius: 12, backgroundColor: P.warning, alignItems: 'center', justifyContent: 'center' }}>
                      <Text style={{ color: '#2A1D00', fontSize: 14.5, fontWeight: '700' }}>Use {fmtv(sum)}</Text>
                    </TouchableOpacity>
                  ) : null}
                  <TouchableOpacity onPress={() => resolve()} accessibilityRole="button"
                    style={{ flex: 1, height: 44, borderRadius: 12, borderWidth: 1, borderColor: P.warning + '73', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: P.text, fontSize: 14.5, fontWeight: '600' }}>{val(k) ? `Keep ${val(k)}` : 'Leave it empty'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

      {/* En lista: varje tid i ett eget fält, Add a time längst ner. */}
      <Section P={P} title={fromPhoto ? 'From your logbook' : 'Your totals'}>
        <Card P={P}>
          {rows.map((f, i) => (
            <TimeRow key={f.key} P={P} label={labelOf(f)} value={val(f.key)} onChange={setVal(f.key)} first={i === 0}
              integer={integer(f.key)} sub={extra(f.key) ? 'Added by you' : undefined}
              onRemove={extra(f.key) ? () => remove(f.key) : undefined} />
          ))}
          {addable.length ? (
            <TouchableOpacity onPress={() => setAdding((a) => !a)} accessibilityRole="button" accessibilityState={{ expanded: adding }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 16, borderTopWidth: rows.length ? 1 : 0, borderTopColor: P.sep }}>
              <Ionicons name="add" size={18} color={P.accent} />
              <Text style={{ color: P.accent, fontSize: 15, fontWeight: '600' }}>Add a time</Text>
            </TouchableOpacity>
          ) : null}
          {adding ? (
            <View style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 10 }}>
              <Text style={{ color: P.text2, fontSize: 13, lineHeight: 18 }}>
                {fromPhoto ? 'For what your logbook has no column for.' : 'Add the times your logbook keeps.'}
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {addable.map((f) => (
                  <TouchableOpacity key={f.key} onPress={() => add(f.key)} activeOpacity={0.75} accessibilityRole="button" accessibilityLabel={`Add ${labelOf(f)}`}
                    style={{ height: 40, paddingHorizontal: 14, borderRadius: 20, borderWidth: 1, borderColor: P.border, backgroundColor: P.elevated, justifyContent: 'center' }}>
                    <Text style={{ color: P.text, fontSize: 14, fontWeight: '600' }}>{labelOf(f)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ) : null}
        </Card>
        {roleMain.length >= 2 ? (
          <SumCheck P={P} parts={roleSum} total={total}
            ok="PIC, co-pilot and dual add up to your total"
            over="PIC, co-pilot and dual are more than your total"
            under="PIC, co-pilot and dual" />
        ) : null}
        {crewKeys.length === 2 ? (
          <SumCheck P={P} parts={crewSum} total={total}
            ok="Single and multi-pilot add up to your total"
            over="Single and multi-pilot are more than your total"
            under="Single and multi-pilot" />
        ) : null}
        <Hint P={P}>Type 812:20 or 812.3. Only what you fill in is saved.</Hint>
      </Section>

      {/* Om man vill: per flygplanstyp och simulator. Fälls ut först när man trycker. */}
      <Section P={P} title="If you want">
        <Card P={P}>
          <TouchableOpacity onPress={() => onChange((b) => ({ ...b, showAircraft: !b.showAircraft }))} accessibilityRole="button" accessibilityState={{ expanded: showAircraft }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 10, paddingHorizontal: 16 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: P.text, fontSize: 15 }}>Split by aircraft</Text>
              <Text style={{ color: P.text2, fontSize: 12.5 }} numberOfLines={1}>
                {found.length ? `${found.slice(0, 3).join(found.length === 2 ? ' and ' : ', ')} on your page` : 'Give your hours to each type'}
              </Text>
            </View>
            <Ionicons name={showAircraft ? 'chevron-up' : 'chevron-down'} size={16} color={P.muted} />
          </TouchableOpacity>
          {showAircraft ? (
            <View style={{ borderTopWidth: 1, borderTopColor: P.sep }}>
              <AllocationMeter P={P} total={total} parts={acMins} noun="an aircraft" />
              {block.aircraft.map((a, i) => (
                <TimeRow
                  key={a.id}
                  P={P}
                  label={a.type}
                  sub={a.found ? `On your page · ${acSub(a.type)}` : acSub(a.type)}
                  dot={ALLOC_COLORS[i % ALLOC_COLORS.length]}
                  value={a.time}
                  onChange={(v) => onChange((b) => ({ ...b, aircraft: b.aircraft.map((x) => (x.id === a.id ? { ...x, time: v } : x)) }))}
                  onRemove={() => onChange((b) => ({ ...b, aircraft: b.aircraft.filter((x) => x.id !== a.id) }))}
                />
              ))}
              <AddPicker
                P={P}
                label="Add an aircraft"
                note="Fleet or new type"
                placeholder="Aircraft type, e.g. C172"
                suggestions={suggestions}
                onPick={(_k, text) => {
                  const type = text.trim();
                  if (!type || taken.has(type.toUpperCase())) return;
                  onChange((b) => ({ ...b, aircraft: [...b.aircraft, { id: uid(), type, time: '' }] }));
                }}
              />
            </View>
          ) : null}
          <TouchableOpacity onPress={() => setShowSim((v) => !v)} accessibilityRole="button" accessibilityState={{ expanded: showSim }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 60, paddingVertical: 10, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: P.sep }}>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ color: P.text, fontSize: 15 }}>Simulator</Text>
                {simTotal > 0 ? <LedText size={13} color={P.text}>{hm(simTotal)}</LedText> : null}
              </View>
              <Text style={{ color: P.text2, fontSize: 12.5 }}>{block.simRead && !sims.length ? 'Choose the type · kept apart from flight time' : 'Kept apart from flight time'}</Text>
            </View>
            <Ionicons name={showSim ? 'chevron-up' : 'chevron-down'} size={16} color={P.muted} />
          </TouchableOpacity>
          {showSim ? (
            <View style={{ borderTopWidth: 1, borderTopColor: P.sep }}>
              {block.simRead ? <AllocationMeter P={P} total={block.simRead} parts={sims.map((x) => toMin(val(x.key)))} noun="a simulator type" /> : null}
              {sims.map((x, i) => (
                <TimeRow key={x.key} P={P} label={x.label} sub={x.sub} dot={block.simRead ? ALLOC_COLORS[i % ALLOC_COLORS.length] : undefined}
                  value={val(x.key)} onChange={setVal(x.key)} first={!block.simRead && i === 0}
                  onRemove={() => onChange((b) => ({ ...b, shown: b.shown.filter((k) => k !== x.key), v: { ...b.v, [x.key]: '' } }))} />
              ))}
              {hiddenSims.length ? (
                <View style={{ padding: 16, paddingTop: 12, borderTopWidth: sims.length || block.simRead ? 1 : 0, borderTopColor: P.sep }}>
                  <ChipGroup
                    P={P}
                    title={sims.length ? 'Another type' : 'What type of simulator?'}
                    items={hiddenSims.map((x) => ({
                      label: x.label,
                      // Den nya typen får det som är kvar av simulatortiden ur fotot; ändra tiden om den ska delas.
                      onPress: () => onChange((b) => {
                        const left = (b.simRead ?? 0) - SIMS.reduce((a, y) => a + toMin(b.v[y.key] ?? ''), 0);
                        return { ...b, shown: [...b.shown, x.key], v: { ...b.v, [x.key]: left > 0 ? hm(left) : '' } };
                      }),
                    }))}
                  />
                </View>
              ) : null}
            </View>
          ) : null}
        </Card>
      </Section>
    </>
  );
}

// ── Från foto till formulär ───────────────────────────────────────────────────

const FORM_KEYS: FormField[] = ['pic', 'co_pilot', 'dual', 'instructor', 'ifr', 'night', 'multi_pilot', 'single_pilot', 'nvg', 'landings_day', 'landings_night'];
const fmt = (k: string, v: number) => (COUNT_FIELDS.has(k) ? String(v) : hm(v));

/** Ett block ifyllt med värden (minuter/antal) ur fotot. */
function blockFromValues(
  values: Partial<Record<FormField, number>>, flags: string[], aircraft: string[], fleet: { label: string }[], extra: Partial<Block>,
): Block {
  const b = { ...emptyBlock(''), ...extra };
  const photo: string[] = [];
  if (values.total_time != null) { b.total = hm(values.total_time); photo.push('total'); }
  for (const k of FORM_KEYS) {
    const v = values[k];
    if (v == null || v <= 0) continue;
    b.v[k] = fmt(k, v);
    b.shown.push(k);
    photo.push(k);
  }
  if (values.sim) b.simRead = values.sim;
  const seen = new Set<string>();
  for (const t of aircraft) {
    const label = fleet.find((f) => f.label.toUpperCase() === t.toUpperCase())?.label ?? t;
    if (seen.has(label.toUpperCase())) continue;
    seen.add(label.toUpperCase());
    b.aircraft.push({ id: uid(), type: label, time: '', found: true });
  }
  b.photo = photo;
  b.flags = flags.map((f) => (f === 'total_time' ? 'total' : f));
  return b;
}

const readingValues = (r: TotalsReading) => {
  const values: Partial<Record<FormField, number>> = {};
  const flags: string[] = [];
  const checks: Record<string, { bf: number; page: number }> = {};
  for (const [k, v] of Object.entries(r.fields) as [FormField, NonNullable<TotalsReading['fields'][FormField]>][]) {
    values[k] = v.value;
    if (v.check) flags.push(k);
    if (v.check && v.bf != null && v.page != null) checks[k] = { bf: v.bf, page: v.page };
  }
  return { values, flags, checks };
};

/** Raden under totalen: hur värdet kontrollerats eller räknats fram. */
function EqLine({ P, eq }: { P: XPalette; eq: Eq }) {
  const Led = ({ m }: { m: number }) => <LedText size={11} color={P.text}>{hm(m)}</LedText>;
  if (eq.kind === 'bf') {
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingTop: 4 }}>
        <Text style={{ color: P.text2, fontSize: 12 }}>Brought forward</Text><Led m={eq.bf} />
        <Text style={{ color: P.text2, fontSize: 12 }}>+ this page</Text><Led m={eq.page} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name={eq.ok ? 'checkmark-circle-outline' : 'alert-circle-outline'} size={14} color={eq.ok ? P.success : P.warning} />
          <Text style={{ color: eq.ok ? P.success : P.warning, fontSize: 12, fontWeight: '600' }}>{eq.ok ? 'adds up' : "doesn't add up, check it"}</Text>
        </View>
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingTop: 4 }}>
      <Text style={{ color: P.text2, fontSize: 12 }}>{eq.aLabel}</Text><Led m={eq.a} />
      {eq.b != null ? <><Text style={{ color: P.text2, fontSize: 12 }}>− {eq.bLabel}</Text><Led m={eq.b} /></> : null}
    </View>
  );
}

// ── Startsidan ────────────────────────────────────────────────────────────────

function StartPage({ P, onPhoto, onYears, onHand }: {
  P: XPalette; onPhoto: () => void; onYears: () => void; onHand: () => void;
}) {
  const line = (icon: keyof typeof Ionicons.glyphMap, title: string, status: string, onPress: () => void, a11y: string) => (
    <TouchableOpacity style={st.line} onPress={onPress} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel={a11y}>
      <Ionicons name={icon} size={18} color={P.text2} />
      <Text style={[st.lineTitle, { color: P.text }]} numberOfLines={1}>{title}</Text>
      <Text style={[st.lineStatus, { color: P.text2 }]} numberOfLines={1}>{status}</Text>
      <Ionicons name="chevron-forward" size={15} color={P.muted} />
    </TouchableOpacity>
  );
  return (
    <>
      <View style={{ gap: 4, marginBottom: 2 }}>
        <Text style={{ color: P.text, fontSize: 24, fontWeight: '800' }}>Block import</Text>
        <Text style={{ color: P.text2, fontSize: 14, lineHeight: 20 }}>
          Start Blades with the totals you already have. Photograph the last page you filled in, and Blades reads your totals and the aircraft on it.
        </Text>
      </View>
      <TouchableOpacity style={[st.upload, { borderColor: P.accent + '80', backgroundColor: P.accent + '0D' }]} onPress={onPhoto} activeOpacity={0.9} accessibilityRole="button">
        <View style={[st.uploadIcon, { backgroundColor: P.accent + '1A', borderColor: P.accent + '33' }]}>
          <Ionicons name="camera-outline" size={30} color={P.accent} />
        </View>
        <Text style={{ color: P.text, fontSize: 17, fontWeight: '800', marginTop: 2 }}>Photograph your latest page</Text>
        <Text style={{ color: P.text2, fontSize: 12.5, textAlign: 'center', lineHeight: 17 }}>
          Take a photo of the last spread you filled in, or choose one from your camera roll. The Total to date line must be in it.
        </Text>
      </TouchableOpacity>
      <View style={[st.lines, { borderColor: P.border, backgroundColor: P.card }]}>
        {line('calendar-outline', 'Year by year', 'One photo per new year', onYears, 'Year by year: photograph your latest page and every spread where a new year starts')}
        {line('create-outline', 'Enter by hand', 'No photo', onHand, 'Enter your totals by hand')}
      </View>
      <HowItWorks steps={[
        { t: 'Photograph your latest page', d: 'Use the camera, or choose a photo you have already taken.' },
        { t: 'Blades reads your totals', d: 'Claude reads the bottom lines and the aircraft on the page. It takes about 20 seconds.' },
        { t: 'Check and add the rest', d: "Fix anything that looks wrong, and add what your logbook doesn't have, like NVG or aircraft from earlier pages. Nothing is saved until you tap Add." },
      ]} />
      <View style={[st.info, { borderColor: P.border, backgroundColor: P.card }]}>
        <Text style={[st.infoTitle, { color: P.text2 }]}>Works best with</Text>
        {([
          ['scan-outline', 'The bottom lines', 'Total to date must be in the photo'],
          ['book-outline', 'Your latest spread', 'the last page you have written on'],
          ['sunny-outline', 'Even light', 'no shadows or glare'],
        ] as const).map(([icon, term, desc]) => (
          <View key={term} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name={icon} size={15} color={P.accent} />
            <Text style={{ color: P.text, fontSize: 13, fontWeight: '700' }}>{term}</Text>
            <Text style={{ color: P.text2, fontSize: 12.5, lineHeight: 17, flex: 1 }}>{desc}</Text>
          </View>
        ))}
      </View>
    </>
  );
}

const st = StyleSheet.create({
  upload: { alignItems: 'center', gap: 8, paddingVertical: 26, paddingHorizontal: 18, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed' },
  uploadIcon: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  lines: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  line: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.cardBorder, marginBottom: -StyleSheet.hairlineWidth },
  lineTitle: { flex: 1, fontSize: 14.5, fontWeight: '600' },
  lineStatus: { fontSize: 13 },
  info: { borderRadius: 12, borderWidth: 1, padding: 14, gap: 12 },
  infoTitle: { fontSize: 10.5, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
});

// ── Skärmen ───────────────────────────────────────────────────────────────────

type Reading = {
  status: 'busy' | 'done' | 'error';
  total: number;
  done: number;
  startedAt: number;
  error?: string;
  outOfCoins?: boolean;
  retry?: TotalsMode;
};

export default function ManualExperienceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Från onboarding → efter sparad starttotal gå DIREKT till dashboarden (inte tillbaka till onboarding).
  const { from } = useLocalSearchParams<{ from?: string }>();
  const finishNav = () => (from === 'onboarding' ? router.replace('/(tabs)') : router.back());
  const { loadFlights, loadStats } = useFlightStore();
  const P: XPalette = {
    bg: Colors.background, card: Colors.card, elevated: Colors.elevated, border: Colors.border, sep: Colors.separator,
    text: Colors.textPrimary, text2: Colors.textSecondary, muted: Colors.textMuted, accent: Colors.primary,
    onAccent: Colors.textInverse, success: Colors.success, warning: Colors.warning, danger: Colors.danger,
  };
  const currentYear = String(new Date().getFullYear());

  // Startsidan bara när fotoflödet är öppet (testbyggen); annars direkt till formuläret.
  const [stage, setStage] = useState<'start' | 'reading' | 'form'>(SCAN_OPEN ? 'start' : 'form');
  const [mode, setMode] = useState<'lump' | 'yearly'>('lump');
  const [blocks, setBlocks] = useState<Block[]>([emptyBlock('')]);
  const [selected, setSelected] = useState<string>(blocks[0].id);
  const [fleet, setFleet] = useState<{ label: string; regs: number }[]>([]);
  const [firstFlight, setFirstFlight] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  // Fotoflödet: senaste uppslaget, årsslut ur årsskiftena, och vad som hände med fotona.
  const [reading, setReading] = useState<Reading | null>(null);
  const [photoSource, setPhotoSource] = useState<{ years: boolean; photos: number; noYear: number } | null>(null);
  const latestRef = useRef<TotalsReading | null>(null);
  const endsRef = useRef<YearEnd[]>([]);
  const fleetRef = useRef(fleet);
  fleetRef.current = fleet;

  useEffect(() => {
    (async () => {
      const [regs, recent, first] = await Promise.all([
        getFleetRegistrationTypes().catch(() => []),
        getRecentAircraftTypes().catch(() => [] as string[]),
        getFirstFlightDate().catch(() => null),
      ]);
      setFirstFlight(first);
      // Typer ur Fleet (antal registreringar) + typer som bara finns i loggboken.
      const map = new Map<string, { label: string; regs: number }>();
      for (const r of regs) {
        const k = r.aircraft_type.trim().toUpperCase();
        if (!k) continue;
        const cur = map.get(k) ?? { label: r.aircraft_type.trim(), regs: 0 };
        cur.regs += 1;
        map.set(k, cur);
      }
      for (const t of recent) {
        const k = (t || '').trim().toUpperCase();
        if (k && !map.has(k)) map.set(k, { label: t.trim(), regs: 0 });
      }
      setFleet([...map.values()].sort((a, b) => b.regs - a.regs || a.label.localeCompare(b.label)));
    })();
  }, []);

  // ── Foto → läsning → formulär ──
  const showReadings = useCallback((years: boolean, photos: number, noYear: number) => {
    const latest = latestRef.current;
    if (!latest) return;
    const { values, flags, checks } = readingValues(latest);
    const tot = latest.fields.total_time;
    if (!years) {
      const b = blockFromValues(values, flags, latest.aircraft.map((a) => a.type), fleetRef.current, {
        checks,
        eq: tot && tot.bf != null && tot.page != null ? { kind: 'bf', bf: tot.bf, page: tot.page, ok: !tot.check } : undefined,
      });
      setMode('lump');
      setBlocks([b]);
      setSelected(b.id);
    } else {
      const lastYear = latest.latestYear ?? parseInt(currentYear, 10);
      const ends = endsRef.current;
      const periods = buildPeriods({ year: lastYear, fields: values, aircraft: latest.aircraft.map((a) => a.type) }, ends);
      const endOf = (y: number | null) => (y == null ? undefined : ends.find((e) => e.year === y)?.fields.total_time);
      const bs = periods.map((p) => {
        const a = p.to === lastYear ? values.total_time : endOf(p.to);
        const bYear = p.from == null ? null : p.from - 1;
        const eq: Eq | undefined = a == null ? undefined : {
          kind: 'year', a, aLabel: p.to === lastYear ? 'Total to date now' : `Total to date at the end of ${p.to}`,
          b: bYear != null ? endOf(bYear) : undefined, bLabel: bYear != null ? `end of ${bYear}` : undefined,
        };
        const pflags = [...Object.keys(p.check), ...(p.to === lastYear ? flags : [])];
        return blockFromValues(p.fields, pflags, p.aircraft, fleetRef.current, { year: String(p.to), fromYear: p.from, eq });
      });
      setMode('yearly');
      setBlocks(bs);
      setSelected(bs[bs.length - 1].id);
    }
    setPhotoSource({ years, photos, noYear });
    setError(null);
    setStage('form');
  }, [currentYear]);

  const readPhotos = useCallback(async (pending: { mode: TotalsMode; images: ScanImage[] }) => {
    const { mode: m, images } = pending;
    setStage('reading');
    setReading({ status: 'busy', total: images.length, done: 0, startedAt: Date.now(), retry: m });
    const results: TotalsReading[] = [];
    try {
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        // Kameran: första fotot i år för år är senaste uppslaget, resten årsskiften.
        const yearChange = m === 'more' || (m === 'years' && i > 0);
        results.push(await readTotalsPhoto(img.base64, img.mediaType, { yearChange }));
        setReading((r) => (r ? { ...r, done: i + 1 } : r));
      }
    } catch (e: any) {
      setReading((r) => r && {
        ...r, status: 'error', outOfCoins: isTokenQuotaError(e),
        error: isTokenQuotaError(e) ? undefined : (e?.message || 'Something went wrong while reading the page.'),
      });
      return;
    }
    let noYear = 0;
    if (m === 'one') {
      latestRef.current = results[0];
      endsRef.current = [];
    } else {
      // Senaste uppslaget = störst Total to date (fotoordningen spelar ingen roll, även från biblioteket).
      const pool = m === 'more' && latestRef.current ? [latestRef.current, ...results] : results;
      const tt = (r: TotalsReading) => r.fields.total_time?.value ?? -1;
      const latest = pool.reduce((a, b) => (tt(b) > tt(a) ? b : a), pool[0]);
      latestRef.current = latest;
      const ends = m === 'more' ? [...endsRef.current] : [];
      for (const r of results) {
        if (r.yearEnd) ends.push(r.yearEnd);
        else if (r !== latest) noYear++;
      }
      if (latest.yearEnd && !ends.includes(latest.yearEnd)) ends.push(latest.yearEnd);
      endsRef.current = ends;
    }
    const latest = latestRef.current;
    if (!latest || !latest.found || latest.fields.total_time == null) {
      setReading((r) => r && {
        ...r, status: 'error',
        error: "Couldn't find the Total to date line. Take the photo again with the bottom lines of both pages in the frame.",
      });
      return;
    }
    setReading((r) => (r ? { ...r, status: 'done' } : r));
    const photos = (m === 'more' ? (photoSource?.photos ?? 0) : 0) + results.length;
    setTimeout(() => showReadings(m !== 'one', photos, (m === 'more' ? (photoSource?.noYear ?? 0) : 0) + noYear), 900);
  }, [photoSource, showReadings]);

  // Kameran lägger fotona i totalsScanStore och går tillbaka hit.
  useFocusEffect(useCallback(() => {
    const pending = useTotalsScanStore.getState().take();
    if (pending) readPhotos(pending);
  }, [readPhotos]));

  const openCamera = async (m: TotalsMode) => {
    if (!(await askAiConsent())) return;
    if (!isScanCameraAvailable()) { pickLibrary(m); return; }
    router.push(`/import/scan-camera?totals=${m}` as any);
  };
  const pickLibrary = async (m: TotalsMode) => {
    if (!(await askAiConsent())) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsMultipleSelection: m !== 'one', selectionLimit: m === 'one' ? 1 : 20, quality: 1,
    });
    if (res.canceled || !res.assets?.length) return;
    const images: ScanImage[] = [];
    for (const a of res.assets) {
      // Kamerarullens bilder kan vara 12 MP (HEIC): alltid ner till högst 2000 px bred JPEG, som skanningen.
      const actions: ImageManipulator.Action[] = (a.width ?? 9999) > 2000 ? [{ resize: { width: 2000 } }] : [];
      const out = await ImageManipulator.manipulateAsync(a.uri, actions, { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true });
      if (out.base64) images.push({ base64: out.base64, mediaType: 'image/jpeg', width: out.width, height: out.height });
    }
    if (images.length) readPhotos({ mode: m, images });
  };

  // Kamera eller kamerarulle (som Logbook scan). Valet stängs först; kameran/bildväljaren öppnas när rutan är borta.
  const [sourceFor, setSourceFor] = useState<TotalsMode | null>(null);
  const cameraAvailable = isScanCameraAvailable();
  const choosePhoto = (m: TotalsMode) => setSourceFor(m);
  const pickSource = (key: 'camera' | 'library') => {
    const m = sourceFor;
    setSourceFor(null);
    if (!m) return;
    setTimeout(() => { if (key === 'camera') openCamera(m); else pickLibrary(m); }, 350);
  };
  const SOURCE_TEXT: Record<TotalsMode, { eyebrow: string; title: string; body: string; lib: string }> = {
    one: { eyebrow: 'BLOCK IMPORT', title: 'Your latest page', body: 'The last spread you filled in, with the Total to date line at the bottom.', lib: 'A photo of your latest spread, with the bottom lines in it.' },
    years: { eyebrow: 'YEAR BY YEAR', title: 'Your latest page and each new year', body: 'Your latest spread and every spread where a new year starts.', lib: 'Choose them all at once, in any order. Blades finds which is which.' },
    more: { eyebrow: 'YEAR BY YEAR', title: 'Another new year', body: 'A spread where a new year starts.', lib: 'Choose one or more spreads where a new year starts.' },
  };
  const sourceDialog = (
    <GlassDialog
      visible={sourceFor != null}
      onClose={() => setSourceFor(null)}
      eyebrow={sourceFor ? SOURCE_TEXT[sourceFor].eyebrow : ''}
      title={sourceFor ? SOURCE_TEXT[sourceFor].title : ''}
      body={sourceFor ? SOURCE_TEXT[sourceFor].body : ''}
      secondary={{ label: 'Cancel', onPress: () => setSourceFor(null) }}
    >
      <View style={{ alignSelf: 'stretch', gap: 8, marginTop: 14 }}>
        {cameraAvailable ? (
          <DialogOption icon="camera-outline" title="Take a photo" sub="The camera finds the spread, straightens it and takes the photo when it is sharp." onPress={() => pickSource('camera')} />
        ) : null}
        <DialogOption icon="images-outline" title="Choose from your camera roll" sub={sourceFor ? SOURCE_TEXT[sourceFor].lib : ''} onPress={() => pickSource('library')} />
      </View>
    </GlassDialog>
  );

  const block = blocks.find((b) => b.id === selected) ?? blocks[0];
  const update = (id: string) => (fn: (b: Block) => Block) => { setError(null); setBlocks((bs) => bs.map((b) => (b.id === id ? fn(b) : b))); };
  const fromPhotos = !!photoSource;

  const switchMode = (m: 'lump' | 'yearly') => {
    if (m === mode) return;
    setError(null);
    // Det man redan skrivit följer med: klumpsumman blir årets block, och tvärtom det valda året.
    const keep = { ...block, year: m === 'yearly' ? (block.year || currentYear) : '' };
    setBlocks([keep]);
    setSelected(keep.id);
    setMode(m);
  };
  const addEarlier = () => {
    if (fromPhotos) { choosePhoto('more'); return; }
    const years = blocks.map((b) => parseInt(b.year, 10)).filter((y) => !isNaN(y));
    const nb = emptyBlock(String(years.length ? Math.min(...years) - 1 : parseInt(currentYear, 10)));
    setBlocks((bs) => [nb, ...bs]);
    setSelected(nb.id);
  };
  const removeBlock = (id: string) => {
    const rest = blocks.filter((b) => b.id !== id);
    if (!rest.length) return;
    setBlocks(rest);
    setSelected(rest[rest.length - 1].id);
  };

  const sorted = useMemo(
    () => [...blocks].sort((a, b) => (parseInt(a.year, 10) || 9999) - (parseInt(b.year, 10) || 9999)),
    [blocks],
  );
  const ready = blocks.filter(isReady);
  const overGiven = ready.find((b) => b.aircraft.reduce((a, x) => a + toMin(x.time), 0) > toMin(b.total));
  const badYear = mode === 'yearly' && ready.some((b) => !validYear(b.year));
  const lumpDate = firstFlight ? dayBefore(firstFlight) : new Date().toISOString().slice(0, 10);
  const merged = blocks.filter((b) => b.fromYear != null && parseInt(b.year, 10) > b.fromYear);

  // Knappen säger bara Save; varför den är grå står i raden ovanför.
  const FIELD_LABEL: Record<string, string> = Object.fromEntries([...ROLE, ...CREW, ...COND, ...SPECIAL].map((f) => [f.key, f.label]).concat(LAND.map((f) => [f.key, `${f.label} landings`])));
  const toCheck = blocks.flatMap((b) => b.flags.filter((k) => k !== 'total' && FIELD_LABEL[k]).map((k) => FIELD_LABEL[k]));
  const blocked = toCheck.length ? `Check ${toCheck.slice(0, 2).join(' and ')}${toCheck.length > 2 ? ` and ${toCheck.length - 2} more` : ''} to save.`
    : !ready.length ? 'Enter your total time to save.'
    : overGiven ? 'Your aircraft add up to more than the total. Lower one of them to save.'
      : badYear ? 'Enter a year from 1950 to 2099 to save.' : null;
  const disabled = !!blocked;
  const anyAircraft = ready.some((b) => b.aircraft.some((a) => toMin(a.time) > 0));
  const firstPeriod = blocks.find((b) => b.fromYear === null);
  const info = blocked ?? (mode === 'yearly'
    ? `Each year is saved dated 31 Dec${anyAircraft ? ', one entry per aircraft' : ''}.${firstPeriod ? ` Everything up to ${firstPeriod.year} is saved as one entry.` : ''}`
    : `Saved ${anyAircraft ? 'as one entry per aircraft' : 'as one entry'} dated ${niceDate(lumpDate)}${firstFlight ? ', the day before your first flight in Blades' : ''}.`);

  const save = async () => {
    if (disabled || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const firstNow = await getFirstFlightDate();
      const lump = firstNow ? dayBefore(firstNow) : new Date().toISOString().slice(0, 10);
      const base = {
        registration: '', dep_place: '', arr_place: '', dep_utc: '', arr_utc: '', flight_rules: 'VFR', second_pilot: '', tng_count: '0',
        ifr: '0', night: '0', pic: '0', co_pilot: '0', dual: '0', instructor: '0', multi_pilot: '0', single_pilot: '0',
        landings_day: '0', landings_night: '0', nvg: '0', examiner: '0', safety_pilot: '0', spic: '0', ferry_pic: '0', observer: '0', relief_crew: '0',
      };
      const newTypes = new Set<string>();
      for (const b of ready) {
        const date = mode === 'yearly' ? `${parseInt(b.year, 10)}-12-31` : lump;
        const period = b.fromYear === undefined ? String(parseInt(b.year, 10))
          : b.fromYear === null ? `up to ${parseInt(b.year, 10)}`
            : b.fromYear === parseInt(b.year, 10) ? String(b.fromYear) : `${b.fromYear}-${parseInt(b.year, 10)}`;
        const remarks = mode === 'yearly' ? `${PREV_EXP_REMARK} ${period}` : PREV_EXP_REMARK;
        const v = (k: string) => b.v[k] ?? '';
        const h = (k: string) => minToHours(toMin(v(k)));
        const total = toMin(b.total);
        // 1) En rad per flygplanstyp (bara tiden).
        let given = 0;
        for (const a of b.aircraft) {
          const m = toMin(a.time);
          if (!a.type.trim()) continue;
          // Typer från fotot som inte finns i Fleet läggs till där (även utan tid).
          if (a.found && !fleet.some((f) => f.label.toUpperCase() === a.type.trim().toUpperCase())) newTypes.add(a.type.trim());
          if (m <= 0) continue;
          given += m;
          await insertFlight({ ...base, date, aircraft_type: a.type.trim(), total_time: minToHours(m), remarks, flight_type: 'summary' } as any, { source: 'import' });
        }
        // 2) Resten + alla nedbrytningar på en rad utan typ.
        const breakdown = {
          pic: h('pic'), co_pilot: h('co_pilot'), dual: h('dual'), instructor: h('instructor'),
          multi_pilot: h('multi_pilot'), single_pilot: h('single_pilot'), ifr: h('ifr'), night: h('night'), nvg: h('nvg'),
          examiner: h('examiner'), safety_pilot: h('safety_pilot'), spic: h('spic'), ferry_pic: h('ferry_pic'),
          observer: h('observer'), relief_crew: h('relief_crew'),
          landings_day: String(parseInt(v('landings_day'), 10) || 0), landings_night: String(parseInt(v('landings_night'), 10) || 0),
        };
        const rest = Math.max(0, total - given);
        const hasBreakdown = Object.values(breakdown).some((x) => parseFloat(x) > 0);
        if (rest > 0 || hasBreakdown) {
          await insertFlight({ ...base, ...breakdown, date, aircraft_type: '', total_time: minToHours(rest), remarks, flight_type: 'summary' } as any, { source: 'import' });
        }
        // 3) Simulatortid: en sim-rad per typ (exakt remarks → räknas som tidigare erfarenhet, inte bokrad).
        let simGiven = 0;
        for (const s of SIMS) {
          const m = toMin(v(s.key));
          if (m <= 0) continue;
          simGiven += m;
          await insertFlight({ ...base, date, aircraft_type: '', total_time: minToHours(m), remarks: PREV_EXP_REMARK, flight_type: 'sim', sim_category: s.cat } as any, { source: 'import' });
        }
        // Simulatortid från fotot som inte fått någon typ: sparas ändå, utan typ.
        const simLeft = (b.simRead ?? 0) - simGiven;
        if (simLeft > 0) {
          await insertFlight({ ...base, date, aircraft_type: '', total_time: minToHours(simLeft), remarks: PREV_EXP_REMARK, flight_type: 'sim', sim_category: '' } as any, { source: 'import' });
        }
      }
      for (const t of newTypes) await addAircraftTypeToRegistry(t).catch(() => {});
      await Promise.all([loadFlights(), loadStats()]);
      // Nya typer från fotot får fakta och bild i Fleet i bakgrunden (som efter en skanning).
      if (newTypes.size) enrichFleetInBackground([...newTypes]).catch(() => {});
      finishNav();
    } catch (e: any) {
      setError(`Could not save: ${e?.message ?? 'unknown error'}`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  // ── Läsningen (Blade-myntet, som Logbook scan och Import logbook) ──
  if (stage === 'reading' && reading) {
    const many = reading.total > 1;
    const eyebrow = reading.status === 'error' && reading.outOfCoins ? 'OUT OF BLADE COINS'
      : reading.status === 'error' ? 'READING STOPPED' : reading.status === 'done' ? 'READING COMPLETE'
        : many ? `READING · PHOTO ${Math.min(reading.done + 1, reading.total)} OF ${reading.total}` : 'READING';
    const title = reading.status === 'error' && reading.outOfCoins ? 'You’re out of Blade coins'
      : reading.status === 'error' ? "Couldn't read the page" : reading.status === 'done' ? 'Totals read' : 'Reading your totals';
    const body = reading.status === 'error' ? (reading.outOfCoins ? 'Get more coins and take the photo again.' : reading.error ?? '')
      : reading.status === 'done' ? 'Opening the page…'
        : `Claude reads the bottom lines and the aircraft on ${many ? 'each page' : 'the page'}. It takes about ${many ? `20 seconds a photo` : '20 seconds'}.`;
    const done = reading.status === 'done';
    return (
      <View style={{ flex: 1, backgroundColor: P.bg }}>
        <BladeProgress
          status={reading.status}
          eyebrow={eyebrow}
          title={title}
          body={body}
          steps={[
            { label: many ? `${reading.total} photos ready` : 'Photo ready', state: 'done' },
            { label: many ? `Read the totals · ${reading.done} of ${reading.total}` : 'Read the totals', state: done ? 'done' : 'active' },
            { label: 'Find the aircraft on the page', state: done ? 'done' : 'todo' },
          ]}
          progress={Math.min(0.95, (reading.done + 0.85) / reading.total)}
          progressMs={20000}
          startedAt={reading.startedAt}
          footnote="Nothing is saved until you tap Add."
          safeTop={false}
          onClose={() => { setReading(null); setStage(photoSource ? 'form' : 'start'); }}
          closeLabel="Cancel"
          onRetry={reading.retry ? () => { setReading(null); setStage(photoSource ? 'form' : 'start'); choosePhoto(reading.retry!); } : undefined}
          action={reading.status === 'error' && reading.outOfCoins ? {
            label: 'Get more coins',
            // Betalväggen visas inte över en modal: stäng Block import först.
            onPress: () => { router.back(); setTimeout(() => openCoinShop({ reason: 'out' }), 600); },
          } : undefined}
        />
        {sourceDialog}
      </View>
    );
  }

  const idx = sorted.findIndex((b) => b.id === block.id);
  const missingCard: ReactNode = merged.length ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: P.warning + '66', backgroundColor: P.warning + '12' }}>
      <Ionicons name="warning-outline" size={20} color={P.warning} />
      <Text style={{ flex: 1, color: P.text, fontSize: 13, lineHeight: 18 }}>
        {merged.length === 1 && parseInt(merged[0].year, 10) - (merged[0].fromYear as number) === 1
          ? `${merged[0].fromYear} and ${merged[0].year} are together. Photograph the spread where ${merged[0].year} starts to split them.`
          : `${merged.map(blockLabel).join(', ')} hold more than one year. Photograph the spreads where each new year starts to split them.`}
      </Text>
      <TouchableOpacity onPress={() => choosePhoto('more')} accessibilityRole="button"
        style={{ height: 36, paddingHorizontal: 12, borderRadius: 10, backgroundColor: P.warning, justifyContent: 'center' }}>
        <Text style={{ color: '#2A1D00', fontSize: 13, fontWeight: '700' }}>Photograph</Text>
      </TouchableOpacity>
    </View>
  ) : null;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: P.bg }} behavior={Platform.OS === 'android' ? 'height' : undefined}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingTop: stage === 'start' ? 16 : 22, paddingBottom: 32, gap: stage === 'start' ? 12 : 22 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        {stage === 'start' ? (
          <StartPage
            P={P}
            onPhoto={() => choosePhoto('one')}
            onYears={() => choosePhoto('years')}
            onHand={() => setStage('form')}
          />
        ) : (
          <>
            {photoSource ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: P.border, backgroundColor: P.card }}>
                <View style={{ width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: P.accent + '1A' }}>
                  <Ionicons name="camera-outline" size={22} color={P.accent} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: P.text, fontSize: 14, fontWeight: '700' }}>{photoSource.photos > 1 ? 'From your photos' : 'From your photo'}</Text>
                  <Text style={{ color: P.text2, fontSize: 12, lineHeight: 16 }}>
                    {photoSource.years
                      ? `Latest page and ${Math.max(0, endsRef.current.length)} new ${endsRef.current.length === 1 ? 'year' : 'years'}`
                      : 'Your latest page'} · tap any time to change it
                    {photoSource.noYear ? `. ${photoSource.noYear} ${photoSource.noYear === 1 ? 'photo had' : 'photos had'} no new year on it` : ''}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => choosePhoto(photoSource.years ? 'more' : 'one')} accessibilityRole="button" style={{ height: 44, justifyContent: 'center', paddingHorizontal: 4 }}>
                  <Text style={{ color: P.accent, fontSize: 14, fontWeight: '600' }}>{photoSource.years ? 'Add photo' : 'Retake'}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <View>
                  <Text style={{ color: P.text, fontSize: 27, lineHeight: 32, fontWeight: '800', letterSpacing: -0.5 }}>Hours from before Blades</Text>
                  <Text style={{ color: P.text2, fontSize: 15, lineHeight: 21, marginTop: 8 }}>
                    Copy the totals from your old logbook. They count in all your stats without typing in every flight.
                  </Text>
                </View>
                <ModeSwitch P={P} mode={mode} onChange={switchMode} />
              </>
            )}
            {mode === 'yearly' ? (
              <>
                <YearBars
                  P={P}
                  years={sorted.map((b) => ({
                    id: b.id, year: b.year, mins: toMin(b.total), label: b.fromYear !== undefined ? blockLabel(b) : undefined,
                    merged: b.fromYear != null && parseInt(b.year, 10) > b.fromYear,
                  }))}
                  selected={block.id}
                  onSelect={setSelected}
                  onAddEarlier={addEarlier}
                  addLabel={fromPhotos ? 'Photo' : String((Math.min(...blocks.map((b) => parseInt(b.year, 10)).filter((y) => !isNaN(y)), parseInt(currentYear, 10) + 1)) - 1)}
                  addIcon={fromPhotos ? 'camera-outline' : 'add'}
                  eyebrow={fromPhotos ? `From ${photoSource!.photos} ${photoSource!.photos === 1 ? 'photo' : 'photos'}` : undefined}
                />
                {missingCard}
                {block.fromYear !== undefined ? (
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, marginBottom: -10 }}>
                    <Text style={{ color: P.text, fontSize: 22, fontWeight: '800' }}>{blockLabel(block)}</Text>
                    <Text style={{ color: P.text2, fontSize: 13, fontWeight: '600' }}>{Math.max(0, idx) + 1} of {blocks.length}</Text>
                  </View>
                ) : (
                  <YearHeader
                    P={P}
                    year={block.year}
                    onYear={(y) => update(block.id)((b) => ({ ...b, year: y }))}
                    index={Math.max(0, idx)}
                    count={blocks.length}
                    onRemove={blocks.length > 1 ? () => removeBlock(block.id) : undefined}
                  />
                )}
              </>
            ) : null}
            <BlockForm key={block.id} P={P} block={block} yearly={mode === 'yearly'} fleet={fleet} onChange={update(block.id)} />
          </>
        )}
      </ScrollView>
      {stage === 'form' ? (
        <SaveBar
          P={P}
          info={info}
          label="Save"
          disabled={disabled}
          saving={saving}
          onPress={save}
          error={error}
          bottomInset={insets.bottom}
        />
      ) : null}
      {sourceDialog}
    </KeyboardAvoidingView>
  );
}
