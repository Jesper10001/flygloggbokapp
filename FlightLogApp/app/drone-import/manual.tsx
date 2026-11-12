// "Block import manually" (drönare) — historiska drönartimmar som klumpsumma eller år för år.
// Samma upplägg som pilotens /import/manual (components/experience/ExperienceKit). Sparas som
// summeringsrader (source='summary'): räknas i drönar-totalerna (getDroneStats → dashboard/insights)
// och syns som en batch under Imported data, men listas inte som flygningar (droneFlightStore filtrerar).
//   • en rad per drönare (drone_id) med drönarens tid — ny modell läggs till i Fleet vid Save,
//   • en rad utan drönare med resten av tiden + nedbrytningarna: siktläge (h_vlos …), civila
//     kategorier (h_a1 …), militära/NATO-kategorier (h_other_cats, JSON), natt och landningar.
import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DR } from '../../constants/droneTheme';
import { useDroneAccentStore } from '../../store/droneAccentStore';
import { useDroneFlightStore } from '../../store/droneFlightStore';
import { usePilotTypeStore } from '../../store/pilotTypeStore';
import { insertDroneFlight, listDrones, addDrone } from '../../db/drones';
import { NATO_CLASSES } from '../../constants/droneCategories';
import {
  type XPalette, toMin, hm, minToHours, Card, Section, ModeSwitch, HeroTotal, TimeRow, Tile, SplitBar, SumCheck,
  Hint, ChipGroup, GroupLabel, AllocationMeter, AddPicker, YearBars, YearHeader, SaveBar, ALLOC_COLORS,
} from '../../components/experience/ExperienceKit';

// ── Fält ─────────────────────────────────────────────────────────────────────

const OPS = [{ key: 'h_vlos', label: 'VLOS' }, { key: 'h_evlos', label: 'EVLOS' }, { key: 'h_bvlos', label: 'BVLOS' }];
const OPS_COLORS = ['#00C8E8', '#7FE3F3', '#2F7FB0'];
type Cat = { key: string; label: string; sub?: string; col?: string };
// Civila kategorier har egna kolumner (h_a1 …); militära och NATO sparas i h_other_cats med sitt värde som nyckel.
const CIVIL: Cat[] = [
  { key: 'A1', label: 'A1', sub: 'Open · max 120 m', col: 'h_a1' }, { key: 'A2', label: 'A2', sub: 'Open · max 120 m', col: 'h_a2' },
  { key: 'A3', label: 'A3', sub: 'Open · max 120 m', col: 'h_a3' }, { key: 'Specific', label: 'Specific', col: 'h_specific' },
  { key: 'Certified', label: 'Certified', col: 'h_certified' },
];
const MILITARY: Cat[] = [{ key: 'MRPAS', label: 'MRPAS', sub: 'Under 25 kg' }, { key: 'RPAS', label: 'RPAS', sub: 'Over 25 kg' }];
const NATO: Cat[] = NATO_CLASSES.flatMap((g) => g.options.map((o) => ({
  key: o.value, label: `NATO ${o.label.replace(/^Class /, '').replace(' · ', ' ')}`, sub: o.note,
})));
const ALL_CATS = [...CIVIL, ...MILITARY, ...NATO];
const CAT_COLORS = ['#00C8E8', '#7FE3F3', '#2F7FB0', '#C7F4FB', '#5A8FC0', '#1F5A86'];

interface DroneAlloc { id: string; droneId: number | null; label: string; model: string; registration: string; time: string }
interface Block {
  id: string;
  year: string;
  total: string;
  night: string;
  landings_day: string;
  landings_night: string;
  ops: Record<string, string>;
  cats: Record<string, string>;
  shownCats: string[];
  drones: DroneAlloc[];
}

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const emptyBlock = (year = ''): Block => ({
  id: uid(), year, total: '', night: '', landings_day: '', landings_night: '', ops: {}, cats: {}, shownCats: [], drones: [],
});
const opSum = (b: Block) => OPS.reduce((a, o) => a + toMin(b.ops[o.key] ?? ''), 0);
const catSum = (b: Block) => ALL_CATS.reduce((a, c) => a + toMin(b.cats[c.key] ?? ''), 0);
// Total = angiven totaltid, annars den största nedbrytningen (som tidigare).
const blockTotal = (b: Block) => toMin(b.total) || Math.max(opSum(b), catSum(b));
const validYear = (y: string) => { const n = parseInt(y, 10); return n >= 1950 && n <= 2099; };

// ── Ett block ─────────────────────────────────────────────────────────────────

function BlockForm({
  P, block, yearly, fleet, military, onChange,
}: {
  P: XPalette; block: Block; yearly: boolean; military: boolean;
  fleet: { id: number; label: string; model: string; registration: string }[];
  onChange: (fn: (b: Block) => Block) => void;
}) {
  const total = blockTotal(block);
  const typed = toMin(block.total);
  const setField = (k: 'night' | 'landings_day' | 'landings_night') => (v: string) => onChange((b) => ({ ...b, [k]: v }));
  const setOp = (k: string) => (v: string) => onChange((b) => ({ ...b, ops: { ...b.ops, [k]: v } }));
  const setCat = (k: string) => (v: string) => onChange((b) => ({ ...b, cats: { ...b.cats, [k]: v } }));
  const showCat = (k: string) => onChange((b) => (b.shownCats.includes(k) ? b : { ...b, shownCats: [...b.shownCats, k] }));
  const hasCat = (k: string) => block.shownCats.includes(k) || !!block.cats[k];

  // Militär pilottyp → Military och NATO först (som kategorivalet i Log flight).
  const groups: { title: string; cats: Cat[] }[] = military
    ? [{ title: 'Military', cats: MILITARY }, { title: 'NATO', cats: NATO }, { title: 'Civil · EASA', cats: CIVIL }]
    : [{ title: 'Civil · EASA', cats: CIVIL }, { title: 'Military', cats: MILITARY }, { title: 'NATO', cats: NATO }];
  const shownGroups = groups.map((g) => ({ ...g, cats: g.cats.filter((c) => hasCat(c.key)) })).filter((g) => g.cats.length);
  const shownCats = shownGroups.flatMap((g) => g.cats);
  const colorOf = (k: string) => CAT_COLORS[Math.max(0, shownCats.findIndex((c) => c.key === k)) % CAT_COLORS.length];
  const cs = catSum(block);
  const os = opSum(block);

  const taken = new Set(block.drones.map((d) => (d.droneId != null ? `id:${d.droneId}` : `new:${d.model.toUpperCase()}`)));
  const suggestions = fleet
    .filter((f) => !taken.has(`id:${f.id}`))
    .map((f) => ({ key: String(f.id), label: f.label }));

  return (
    <>
      <HeroTotal
        P={P}
        label={yearly ? `Flight time in ${block.year || 'this year'}` : 'Total flight time'}
        value={block.total}
        onChange={(v) => onChange((b) => ({ ...b, total: v }))}
        hint={typed ? 'Type 86:40 or 86.7' : 'Left empty, Blades uses the larger of the line of sight and category splits'}
      />

      <Section P={P} title="Drones" note="optional">
        <Card P={P}>
          <AllocationMeter P={P} total={total} parts={block.drones.map((d) => toMin(d.time))} noun="a drone" />
          {block.drones.map((d, i) => (
            <TimeRow
              key={d.id}
              P={P}
              label={d.label}
              sub={d.droneId != null ? (d.registration ? `In Fleet · ${d.registration}` : 'In Fleet') : 'New drone · added to Fleet when you save'}
              dot={ALLOC_COLORS[i % ALLOC_COLORS.length]}
              value={d.time}
              onChange={(v) => onChange((b) => ({ ...b, drones: b.drones.map((x) => (x.id === d.id ? { ...x, time: v } : x)) }))}
              onRemove={() => onChange((b) => ({ ...b, drones: b.drones.filter((x) => x.id !== d.id) }))}
            />
          ))}
          <AddPicker
            P={P}
            label="Add drone"
            note="Fleet or new model"
            placeholder="Drone model, e.g. Mavic 3"
            suggestions={suggestions}
            onPick={(key, text) => {
              const hit = key != null ? fleet.find((f) => String(f.id) === key) : undefined;
              const model = text.trim();
              if (!hit && (!model || taken.has(`new:${model.toUpperCase()}`))) return;
              onChange((b) => ({
                ...b,
                drones: [...b.drones, hit
                  ? { id: uid(), droneId: hit.id, label: hit.label, model: hit.model, registration: hit.registration, time: '' }
                  : { id: uid(), droneId: null, label: model, model, registration: '', time: '' }],
              }));
            }}
          />
        </Card>
        <Hint P={P}>Time you don't give to a drone is saved without one.</Hint>
      </Section>

      <Section P={P} title="Line of sight" noteLed={os ? hm(os) : undefined}>
        <Card P={P}>
          <SplitBar P={P} style={{ marginHorizontal: 16, marginTop: 16, marginBottom: 6 }}
            parts={OPS.map((o, i) => ({ v: toMin(block.ops[o.key] ?? ''), color: OPS_COLORS[i] }))} />
          {OPS.map((o, i) => (
            <TimeRow key={o.key} P={P} label={o.label} dot={OPS_COLORS[i]} value={block.ops[o.key] ?? ''} onChange={setOp(o.key)} first={i === 0} />
          ))}
        </Card>
        <SumCheck P={P} parts={os} total={typed} ok="VLOS, EVLOS and BVLOS add up to your total"
          over="Line of sight is more than your total" under="Line of sight" />
      </Section>

      <Section P={P} title="Category" noteLed={cs ? hm(cs) : undefined}>
        <Card P={P}>
          {shownCats.length ? (
            <SplitBar P={P} style={{ marginHorizontal: 16, marginTop: 16, marginBottom: 2 }}
              parts={shownCats.map((c) => ({ v: toMin(block.cats[c.key] ?? ''), color: colorOf(c.key) }))} />
          ) : null}
          {shownGroups.map((g, gi) => (
            <View key={g.title}>
              <GroupLabel P={P} title={g.title} first={gi === 0} />
              {g.cats.map((c, i) => (
                <TimeRow key={c.key} P={P} label={c.label} sub={c.sub} dot={colorOf(c.key)} value={block.cats[c.key] ?? ''} onChange={setCat(c.key)} first={i === 0} />
              ))}
            </View>
          ))}
          <View style={{ padding: 16, paddingTop: 12, gap: 14, borderTopWidth: shownCats.length ? 1 : 0, borderTopColor: P.sep }}>
            <Text style={{ color: P.text, fontSize: 14, fontWeight: '600' }}>Add a category</Text>
            {groups.map((g) => (
              <ChipGroup key={g.title} P={P} title={g.title} items={g.cats.filter((c) => !hasCat(c.key)).map((c) => ({ label: c.label, onPress: () => showCat(c.key) }))} />
            ))}
          </View>
        </Card>
        <SumCheck P={P} parts={cs} total={typed} ok="Categories add up to your total"
          over="Categories are more than your total" under="Categories" />
      </Section>

      <Section P={P} title="Night and landings">
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Tile P={P} label="Night" value={block.night} onChange={setField('night')} />
          <Tile P={P} label="Day ldg" value={block.landings_day} onChange={setField('landings_day')} integer />
          <Tile P={P} label="Night ldg" value={block.landings_night} onChange={setField('landings_night')} integer />
        </View>
      </Section>
    </>
  );
}

// ── Skärmen ───────────────────────────────────────────────────────────────────

export default function DroneManualExperienceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const accent = useDroneAccentStore((s) => s.color);
  const pilotType = usePilotTypeStore((s) => s.pilotType);
  const { loadFlights, loadStats } = useDroneFlightStore();
  const P: XPalette = {
    bg: DR.background, card: DR.surface, elevated: DR.elevated, border: DR.border, sep: DR.separator,
    text: DR.text, text2: DR.text2, muted: DR.muted, accent, onAccent: DR.inkOnAccent,
    success: DR.good, warning: DR.warning, danger: DR.danger,
  };
  const currentYear = String(new Date().getFullYear());

  const [mode, setMode] = useState<'lump' | 'yearly'>('lump');
  const [blocks, setBlocks] = useState<Block[]>([emptyBlock('')]);
  const [selected, setSelected] = useState<string>(blocks[0].id);
  const [fleet, setFleet] = useState<{ id: number; label: string; model: string; registration: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    listDrones().then((ds) => setFleet(ds.map((d) => ({
      id: d.id, model: d.model, registration: d.registration,
      label: d.registration ? `${d.model} · ${d.registration}` : d.model,
    })))).catch(() => {});
  }, []);

  const block = blocks.find((b) => b.id === selected) ?? blocks[0];
  const update = (id: string) => (fn: (b: Block) => Block) => { setError(null); setBlocks((bs) => bs.map((b) => (b.id === id ? fn(b) : b))); };
  const switchMode = (m: 'lump' | 'yearly') => {
    if (m === mode) return;
    setError(null);
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
  const ready = blocks.filter((b) => blockTotal(b) > 0);
  const sumTotal = ready.reduce((a, b) => a + blockTotal(b), 0);
  const overGiven = ready.find((b) => b.drones.reduce((a, d) => a + toMin(d.time), 0) > blockTotal(b));
  const badYear = mode === 'yearly' && ready.some((b) => !validYear(b.year));

  let ctaLabel = 'Add';
  let disabled = false;
  if (!ready.length) { ctaLabel = 'Enter your total time'; disabled = true; }
  else if (overGiven) { ctaLabel = 'Drones add up to more than the total'; disabled = true; }
  else if (badYear) { ctaLabel = 'Enter a year from 1950 to 2099'; disabled = true; }
  else if (mode === 'yearly') ctaLabel = `Add ${ready.length} ${ready.length === 1 ? 'year' : 'years'} ·`;
  const info = mode === 'yearly'
    ? 'Each year is saved as a summary dated 31 Dec. It counts in your totals and is not listed as flights.'
    : 'Saved as a summary. It counts in your totals and is not listed as a flight.';

  const save = async () => {
    if (disabled || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const created = new Map<string, number>(); // ny modell → drone_id (en gång även över flera år)
      const base = {
        location: '', mission_type: '', category: '', flight_mode: '', max_altitude_m: '', is_night: false,
        has_observer: false, observer_name: '', source: 'summary',
      };
      for (const b of ready) {
        const date = mode === 'yearly' ? `${parseInt(b.year, 10)}-12-31` : today;
        const remarks = mode === 'yearly' ? `Experience summary ${parseInt(b.year, 10)}` : 'Experience summary';
        const total = blockTotal(b);
        // 1) En rad per drönare.
        let given = 0;
        for (const d of b.drones) {
          const m = toMin(d.time);
          if (m <= 0) continue;
          let droneId = d.droneId;
          if (droneId == null) {
            const k = d.model.trim().toUpperCase();
            droneId = created.get(k) ?? await addDrone({ drone_type: '', model: d.model.trim(), registration: '', mtow_g: 0, category: '', drone_class: '', notes: '' });
            created.set(k, droneId);
          }
          given += m;
          await insertDroneFlight({
            ...base, date, drone_id: droneId, registration: d.registration, total_time: minToHours(m),
            night_time: '0', landings_day: '0', landings_night: '0', remarks,
          } as any);
        }
        // 2) Resten + nedbrytningarna på en rad utan drönare.
        const h = (v: string | undefined) => minToHours(toMin(v ?? ''));
        const night = toMin(b.night);
        const other: Record<string, number> = {};
        for (const c of [...MILITARY, ...NATO]) {
          const m = toMin(b.cats[c.key] ?? '');
          if (m > 0) other[c.key] = Math.round((m / 60) * 10000) / 10000;
        }
        const rest = Math.max(0, total - given);
        const breakdown = OPS.some((o) => toMin(b.ops[o.key] ?? '') > 0) || catSum(b) > 0 || night > 0
          || (parseInt(b.landings_day, 10) || 0) > 0 || (parseInt(b.landings_night, 10) || 0) > 0;
        if (rest > 0 || breakdown) {
          await insertDroneFlight({
            ...base, date, drone_id: null, total_time: minToHours(rest),
            night_time: minToHours(night), h_night: minToHours(night),
            landings_day: String(parseInt(b.landings_day, 10) || 0), landings_night: String(parseInt(b.landings_night, 10) || 0),
            remarks,
            h_vlos: h(b.ops.h_vlos), h_evlos: h(b.ops.h_evlos), h_bvlos: h(b.ops.h_bvlos),
            h_a1: h(b.cats.A1), h_a2: h(b.cats.A2), h_a3: h(b.cats.A3), h_specific: h(b.cats.Specific), h_certified: h(b.cats.Certified),
            h_other_cats: Object.keys(other).length ? JSON.stringify(other) : '',
          } as any);
        }
      }
      await Promise.all([loadFlights(), loadStats()]);
      router.back();
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
          <Text style={{ color: P.text, fontSize: 27, lineHeight: 32, fontWeight: '800', letterSpacing: -0.5 }}>Drone hours from before Blades</Text>
          <Text style={{ color: P.text2, fontSize: 15, lineHeight: 21, marginTop: 8 }}>
            Add what you flew before the app. It counts in your totals without filling your logbook with old flights.
          </Text>
        </View>
        <ModeSwitch P={P} mode={mode} onChange={switchMode} />
        {mode === 'yearly' ? (
          <>
            <YearBars
              P={P}
              years={sorted.map((b) => ({ id: b.id, year: b.year, mins: blockTotal(b) }))}
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
        <BlockForm key={block.id} P={P} block={block} yearly={mode === 'yearly'} fleet={fleet} military={pilotType === 'military'} onChange={update(block.id)} />
      </ScrollView>
      <SaveBar
        P={P}
        info={info}
        label={ctaLabel}
        led={!disabled ? hm(mode === 'yearly' ? sumTotal : blockTotal(block)) : undefined}
        disabled={disabled}
        saving={saving}
        onPress={save}
        error={error}
        bottomInset={insets.bottom}
      />
    </KeyboardAvoidingView>
  );
}
