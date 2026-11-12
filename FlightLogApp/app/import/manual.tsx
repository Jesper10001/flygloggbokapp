// "Block import manually" (pilot) — tidigare erfarenhet som klumpsumma eller år för år.
// Totaltiden är huvudsaken; resten läggs till med knappar och syns först när den lagts till.
// Tiden kan ges ut per flygplanstyp (mätaren visar hur mycket som är kvar). Sparas som:
//   • en summeringsrad (flight_type='summary') per flygplanstyp med typens tid,
//   • en summeringsrad utan typ med resten av tiden + alla nedbrytningar (PIC, IFR, landningar …),
//   • en sim-rad (flight_type='sim', sim_category) per simulatortyp — hålls utanför flygtiden.
// Alla rader har remarks "Blades previous experience" (+ år för summeringsraderna år för år).
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  insertFlight, getFirstFlightDate, dayBefore, getFleetRegistrationTypes, getRecentAircraftTypes,
} from '../../db/flights';
import { useFlightStore } from '../../store/flightStore';
import { Colors } from '../../constants/colors';
import {
  type XPalette, toMin, hm, minToHours, Card, Section, ModeSwitch, HeroTotal, TimeRow, Tile, SplitBar, SumCheck,
  Hint, ChipGroup, AllocationMeter, AddPicker, YearBars, YearHeader, SaveBar, ALLOC_COLORS,
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
const CREW_COLORS = ['#7FE3F3', '#00C8E8'];

interface Ac { id: string; type: string; time: string }
interface Block {
  id: string;
  year: string;
  total: string;
  v: Record<string, string>;
  shown: string[];
  aircraft: Ac[];
  showAircraft: boolean;
}

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const emptyBlock = (year = ''): Block => ({ id: uid(), year, total: '', v: {}, shown: [], aircraft: [], showAircraft: false });
const simMins = (b: Block) => SIMS.reduce((a, s) => a + toMin(b.v[s.key] ?? ''), 0);
const isReady = (b: Block) => toMin(b.total) > 0 || simMins(b) > 0;
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
  const [moreRoles, setMoreRoles] = useState(false);
  const total = toMin(block.total);
  const val = (k: string) => block.v[k] ?? '';
  const setVal = (k: string) => (v: string) => onChange((b) => ({ ...b, v: { ...b.v, [k]: v } }));
  const show = (k: string) => onChange((b) => (b.shown.includes(k) ? b : { ...b, shown: [...b.shown, k] }));
  const has = (k: string) => block.shown.includes(k) || !!val(k);
  const shownOf = (fs: readonly Field[]) => fs.filter((f) => has(f.key));
  const hiddenOf = (fs: readonly Field[]) => fs.filter((f) => !has(f.key));

  const role = shownOf(ROLE), crew = shownOf(CREW), cond = shownOf(COND), land = shownOf(LAND), special = shownOf(SPECIAL);
  const sims = SIMS.filter((s) => has(s.key));
  const hiddenSims = SIMS.filter((s) => !has(s.key));
  const acMins = block.aircraft.map((a) => toMin(a.time));
  const showAircraft = block.showAircraft || block.aircraft.length > 0;
  const nothingShown = !showAircraft && !role.length && !crew.length && !cond.length && !land.length && !special.length && !sims.length;

  const roleMain = ['pic', 'co_pilot', 'dual'].filter((k) => has(k));
  const roleSum = roleMain.reduce((a, k) => a + toMin(val(k)), 0);
  const crewSum = crew.reduce((a, f) => a + toMin(val(f.key)), 0);

  const taken = new Set(block.aircraft.map((a) => a.type.trim().toUpperCase()));
  const suggestions = fleet
    .filter((f) => !taken.has(f.label.toUpperCase()))
    .map((f) => ({ key: f.label, label: f.label, sub: f.regs ? `${f.regs} in Fleet` : undefined }));
  const fleetRegs = (type: string) => fleet.find((f) => f.label.toUpperCase() === type.trim().toUpperCase())?.regs;
  const acSub = (type: string) => {
    const n = fleetRegs(type);
    if (n == null) return 'New type';
    return n ? `${n} ${n === 1 ? 'registration' : 'registrations'} in Fleet` : 'In your logbook';
  };

  const tilesRow = (fs: Field[], integer?: boolean) => (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {fs.map((f) => <Tile key={f.key} P={P} label={f.label} value={val(f.key)} onChange={setVal(f.key)} integer={integer} />)}
    </View>
  );

  return (
    <>
      <HeroTotal
        P={P}
        label={yearly ? `Flight time in ${block.year || 'this year'}` : 'Total flight time'}
        value={block.total}
        onChange={(v) => onChange((b) => ({ ...b, total: v }))}
        hint={yearly ? 'The flight time for the year. Type 214:10 or 214.2.' : 'The "Total to date" line on your last logbook page. Type 1248:30 or 1248.5.'}
      />

      {showAircraft ? (
        <Section P={P} title="Aircraft" note="optional">
          <Card P={P}>
            <AllocationMeter P={P} total={total} parts={acMins} noun="an aircraft" />
            {block.aircraft.map((a, i) => (
              <TimeRow
                key={a.id}
                P={P}
                label={a.type}
                sub={acSub(a.type)}
                dot={ALLOC_COLORS[i % ALLOC_COLORS.length]}
                value={a.time}
                onChange={(v) => onChange((b) => ({ ...b, aircraft: b.aircraft.map((x) => (x.id === a.id ? { ...x, time: v } : x)) }))}
                onRemove={() => onChange((b) => ({ ...b, aircraft: b.aircraft.filter((x) => x.id !== a.id) }))}
              />
            ))}
            <AddPicker
              P={P}
              label="Add aircraft"
              note="Fleet or new type"
              placeholder="Aircraft type, e.g. C172"
              suggestions={suggestions}
              onPick={(_k, text) => {
                const type = text.trim();
                if (!type || taken.has(type.toUpperCase())) return;
                onChange((b) => ({ ...b, aircraft: [...b.aircraft, { id: uid(), type, time: '' }] }));
              }}
            />
          </Card>
          <Hint P={P}>Time you don't give to an aircraft is saved without a type.</Hint>
        </Section>
      ) : null}

      {role.length ? (
        <Section P={P} title="Role" noteLed={roleSum ? hm(roleSum) : undefined}>
          <Card P={P}>
            {role.map((f, i) => (
              <TimeRow key={f.key} P={P} label={f.label} value={val(f.key)} onChange={setVal(f.key)} first={i === 0}
                share={total ? toMin(val(f.key)) / total : 0} />
            ))}
          </Card>
          {roleMain.length >= 2 ? (
            <SumCheck P={P} parts={roleSum} total={total}
              ok="PIC, co-pilot and dual add up to your total"
              over="PIC, co-pilot and dual are more than your total"
              under="PIC, co-pilot and dual" />
          ) : null}
        </Section>
      ) : null}

      {crew.length ? (
        <Section P={P} title="Crew" noteLed={crewSum ? hm(crewSum) : undefined}>
          <Card P={P}>
            <SplitBar P={P} style={{ marginHorizontal: 16, marginTop: 16, marginBottom: 6 }}
              parts={CREW.map((f, i) => ({ v: toMin(val(f.key)), color: CREW_COLORS[i] }))} />
            {crew.map((f, i) => (
              <TimeRow key={f.key} P={P} label={f.label} dot={CREW_COLORS[CREW.indexOf(f)]} value={val(f.key)} onChange={setVal(f.key)} first={i === 0} />
            ))}
          </Card>
          {crew.length === 2 ? (
            <SumCheck P={P} parts={crewSum} total={total}
              ok="Single and multi-pilot add up to your total"
              over="Single and multi-pilot are more than your total"
              under="Single and multi-pilot" />
          ) : null}
        </Section>
      ) : null}

      {cond.length ? <Section P={P} title="Conditions">{tilesRow(cond)}</Section> : null}
      {land.length ? <Section P={P} title="Landings">{tilesRow(land, true)}</Section> : null}

      {special.length ? (
        <Section P={P} title="Special roles">
          <Card P={P}>
            {special.map((f, i) => <TimeRow key={f.key} P={P} label={f.label} value={val(f.key)} onChange={setVal(f.key)} first={i === 0} />)}
          </Card>
        </Section>
      ) : null}

      {sims.length ? (
        <Section P={P} title="Simulator" noteLed={simMins(block) ? hm(simMins(block)) : undefined}>
          <Card P={P}>
            {sims.map((s, i) => <TimeRow key={s.key} P={P} label={s.label} sub={s.sub} value={val(s.key)} onChange={setVal(s.key)} first={i === 0} />)}
            {hiddenSims.length ? (
              <View style={{ padding: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: P.sep }}>
                <ChipGroup P={P} title="Add a simulator type" items={hiddenSims.map((s) => ({ label: s.label, onPress: () => show(s.key) }))} />
              </View>
            ) : null}
          </Card>
          <Hint P={P}>Simulator time is kept apart and not added to your flight time.</Hint>
        </Section>
      ) : null}

      <Section P={P} title={nothingShown ? 'Add detail' : 'Add more'} note={nothingShown ? 'optional' : undefined}>
        <Card P={P} style={{ padding: 16, gap: 16 }}>
          {!showAircraft ? (
            <ChipGroup P={P} title="Aircraft · give your hours to each type"
              items={[{ label: 'Add aircraft', onPress: () => onChange((b) => ({ ...b, showAircraft: true })) }]} />
          ) : null}
          <ChipGroup P={P} title="Role" items={hiddenOf(ROLE).map((f) => ({ label: f.label, onPress: () => show(f.key) }))} />
          <ChipGroup P={P} title="Crew" items={hiddenOf(CREW).map((f) => ({ label: f.label, onPress: () => show(f.key) }))} />
          <ChipGroup P={P} title="Conditions" items={hiddenOf(COND).map((f) => ({ label: f.label, onPress: () => show(f.key) }))} />
          <ChipGroup P={P} title="Landings" items={hiddenOf(LAND).map((f) => ({ label: `${f.label} landings`, onPress: () => show(f.key) }))} />
          {!sims.length ? (
            <ChipGroup P={P} title="Simulator · kept apart from flight time" items={SIMS.map((s) => ({ label: s.label, onPress: () => show(s.key) }))} />
          ) : null}
          {hiddenOf(SPECIAL).length ? (
            moreRoles
              ? <ChipGroup P={P} title="Special roles" items={hiddenOf(SPECIAL).map((f) => ({ label: f.label, onPress: () => show(f.key) }))} />
              : <ChipGroup P={P} title="Less common" items={[{ label: 'Special roles', onPress: () => setMoreRoles(true) }]} />
          ) : null}
        </Card>
        {nothingShown ? <Hint P={P}>Each one you tap becomes a field above. Only what you fill in is saved.</Hint> : null}
      </Section>
    </>
  );
}

// ── Skärmen ───────────────────────────────────────────────────────────────────

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

  const [mode, setMode] = useState<'lump' | 'yearly'>('lump');
  const [blocks, setBlocks] = useState<Block[]>([emptyBlock('')]);
  const [selected, setSelected] = useState<string>(blocks[0].id);
  const [fleet, setFleet] = useState<{ label: string; regs: number }[]>([]);
  const [firstFlight, setFirstFlight] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

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

  const block = blocks.find((b) => b.id === selected) ?? blocks[0];
  const update = (id: string) => (fn: (b: Block) => Block) => { setError(null); setBlocks((bs) => bs.map((b) => (b.id === id ? fn(b) : b))); };

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
  const sumTotal = ready.reduce((a, b) => a + toMin(b.total), 0);
  const overGiven = ready.find((b) => b.aircraft.reduce((a, x) => a + toMin(x.time), 0) > toMin(b.total));
  const badYear = mode === 'yearly' && ready.some((b) => !validYear(b.year));
  const lumpDate = firstFlight ? dayBefore(firstFlight) : new Date().toISOString().slice(0, 10);

  let ctaLabel = 'Add';
  let disabled = false;
  if (!ready.length) { ctaLabel = 'Enter your total time'; disabled = true; }
  else if (overGiven) { ctaLabel = 'Aircraft add up to more than the total'; disabled = true; }
  else if (badYear) { ctaLabel = 'Enter a year from 1950 to 2099'; disabled = true; }
  else if (mode === 'yearly') ctaLabel = `Add ${ready.length} ${ready.length === 1 ? 'year' : 'years'}${sumTotal ? ' ·' : ''}`;
  else if (!toMin(block.total)) ctaLabel = 'Add simulator time';
  const ledMins = mode === 'yearly' ? sumTotal : toMin(block.total);
  const anyAircraft = ready.some((b) => b.aircraft.some((a) => toMin(a.time) > 0));
  const info = mode === 'yearly'
    ? `Each year is saved dated 31 Dec of that year${anyAircraft ? ', one entry per aircraft' : ''}.`
    : `Saved ${anyAircraft ? 'as one entry per aircraft' : 'as one entry'} dated ${niceDate(lumpDate)}${firstFlight ? ', the day before your first flight in Blades' : ''}.`;

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
      for (const b of ready) {
        const date = mode === 'yearly' ? `${parseInt(b.year, 10)}-12-31` : lump;
        const remarks = mode === 'yearly' ? `${PREV_EXP_REMARK} ${parseInt(b.year, 10)}` : PREV_EXP_REMARK;
        const v = (k: string) => b.v[k] ?? '';
        const h = (k: string) => minToHours(toMin(v(k)));
        const total = toMin(b.total);
        // 1) En rad per flygplanstyp (bara tiden).
        let given = 0;
        for (const a of b.aircraft) {
          const m = toMin(a.time);
          if (m <= 0 || !a.type.trim()) continue;
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
        for (const s of SIMS) {
          const m = toMin(v(s.key));
          if (m <= 0) continue;
          await insertFlight({ ...base, date, aircraft_type: '', total_time: minToHours(m), remarks: PREV_EXP_REMARK, flight_type: 'sim', sim_category: s.cat } as any, { source: 'import' });
        }
      }
      await Promise.all([loadFlights(), loadStats()]);
      finishNav();
    } catch (e: any) {
      setError(`Could not save: ${e?.message ?? 'unknown error'}`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const idx = sorted.findIndex((b) => b.id === block.id);
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: P.bg }} behavior={Platform.OS === 'android' ? 'height' : undefined}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingTop: 22, paddingBottom: 32, gap: 22 }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
      >
        <View>
          <Text style={{ color: P.text, fontSize: 27, lineHeight: 32, fontWeight: '800', letterSpacing: -0.5 }}>Hours from before Blades</Text>
          <Text style={{ color: P.text2, fontSize: 15, lineHeight: 21, marginTop: 8 }}>
            Copy the totals from your old logbook. They count in all your stats without typing in every flight.
          </Text>
        </View>
        <ModeSwitch P={P} mode={mode} onChange={switchMode} />
        {mode === 'yearly' ? (
          <>
            <YearBars
              P={P}
              years={sorted.map((b) => ({ id: b.id, year: b.year, mins: toMin(b.total) }))}
              selected={block.id}
              onSelect={setSelected}
              onAddEarlier={addEarlier}
              addLabel={String((Math.min(...blocks.map((b) => parseInt(b.year, 10)).filter((y) => !isNaN(y)), parseInt(currentYear, 10) + 1)) - 1)}
            />
            <YearHeader
              P={P}
              year={block.year}
              onYear={(y) => update(block.id)((b) => ({ ...b, year: y }))}
              index={Math.max(0, idx)}
              count={blocks.length}
              onRemove={blocks.length > 1 ? () => removeBlock(block.id) : undefined}
            />
          </>
        ) : null}
        <BlockForm key={block.id} P={P} block={block} yearly={mode === 'yearly'} fleet={fleet} onChange={update(block.id)} />
      </ScrollView>
      <SaveBar
        P={P}
        info={info}
        label={ctaLabel}
        led={!disabled && ledMins > 0 ? hm(ledMins) : undefined}
        disabled={disabled}
        saving={saving}
        onPress={save}
        error={error}
        bottomInset={insets.bottom}
      />
    </KeyboardAvoidingView>
  );
}
