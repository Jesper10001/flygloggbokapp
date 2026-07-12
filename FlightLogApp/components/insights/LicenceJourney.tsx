// Insights §5 — Licence journey. Nästa licens stort (krav-barer + prognosdatum),
// List/Chart-toggle. Klara licenser fälls in; tryck för att se uppfyllda krav +
// DATUM de uppfylldes, samt samma chart. Data: licenceSetFor + haveFor/rateFor/metDateFor.

import { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useInsightsTheme, type InsightsTheme } from './insightsTheme';
import { useInsightsData, forecastFwd, type InsightsData } from './insightsData';
import { LicenceChart } from './LicenceChart';
import { licenceSetFor, type WLicenceSet } from '../EASAProgressChart';
import { useProfileStore } from '../../store/profileStore';
import { useRegulationStandardStore } from '../../store/regulationStandardStore';

const MONO = 'JetBrainsMono';
const SERIF = 'Fraunces';
const M3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (iso: string | null): string => {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${M3[(m || 1) - 1]} ${y}`;
};

function ReqRow({ C, r, haveFor, rateFor }: { C: InsightsTheme; r: { label: string; key: string; required: number }; haveFor: (k: string) => number; rateFor: (k: string) => number }) {
  const have = haveFor(r.key);
  const met = have >= r.required;
  const pct = Math.min(100, (have / r.required) * 100);
  const rate = rateFor(r.key);
  const fc = met ? null : forecastFwd(r.required - have, rate);
  const barColor = met ? C.success : pct > 70 ? C.primary : C.warning;
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 12.5, color: C.text, fontWeight: '500' }}>{r.label}</Text>
        <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: met ? C.success : C.text }}>
          {Math.round(have)}<Text style={{ color: C.muted, fontWeight: '400' }}>/{r.required}h</Text>
        </Text>
      </View>
      <View style={{ height: 6, borderRadius: 99, backgroundColor: C.separator, overflow: 'hidden' }}>
        <View style={{ width: `${pct}%`, height: '100%', borderRadius: 99, backgroundColor: barColor }} />
      </View>
      {!met && fc && <Text style={{ fontFamily: MONO, fontSize: 9, color: C.muted }}>📅 {fc.label} · {Math.round(rate)}h/mo</Text>}
    </View>
  );
}

// Uppfyllt krav i en klar licens: full grön bar + datum det uppfylldes.
function MetReqRow({ C, r, have, metDate }: { C: InsightsTheme; r: { label: string; key: string; required: number }; have: number; metDate: string | null }) {
  return (
    <View style={{ gap: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 12.5, color: C.text, fontWeight: '500' }}>{r.label}</Text>
        <Text style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: C.success }}>
          {Math.round(have)}<Text style={{ color: C.muted, fontWeight: '400' }}>/{r.required}h</Text>
        </Text>
      </View>
      <View style={{ height: 6, borderRadius: 99, backgroundColor: C.separator, overflow: 'hidden' }}>
        <View style={{ width: '100%', height: '100%', borderRadius: 99, backgroundColor: C.success }} />
      </View>
      <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: C.success }}>✓ Met {fmtDate(metDate)}</Text>
    </View>
  );
}

// Klar licens — tryckbar; visar uppfyllda krav (+ datum) och samma chart.
function CompletedLicence({ C, lic, D }: { C: InsightsTheme; lic: WLicenceSet; D: InsightsData }) {
  const [open, setOpen] = useState(false);
  const [chart, setChart] = useState(false);
  const reqs = lic.reqs.filter((r) => r.required > 0);
  return (
    <View style={{ backgroundColor: C.card, borderWidth: 1, borderColor: open ? C.success + '66' : C.border, borderRadius: 16, overflow: 'hidden' }}>
      <TouchableOpacity onPress={() => setOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
        <View style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: C.success + '22', borderWidth: 1, borderColor: C.success + '66', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="checkmark" size={17} color={C.success} />
        </View>
        <Text style={{ flex: 1, fontSize: 14, fontWeight: '600', color: C.text }}>{lic.code}</Text>
        <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: C.success, letterSpacing: 0.5 }}>✓ COMPLETE</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={15} color={C.text3} />
      </TouchableOpacity>
      {open && (
        <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1.2, color: C.muted }}>REQUIREMENTS MET</Text>
            <View style={{ flex: 1 }} />
            <TouchableOpacity onPress={() => setChart((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 7, borderWidth: 1, borderColor: chart ? C.primary : C.border, backgroundColor: chart ? C.primary + '22' : C.elevated }}>
              <Ionicons name={chart ? 'list' : 'analytics-outline'} size={12} color={chart ? C.primary : C.text3} />
              <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: chart ? C.primary : C.text3 }}>{chart ? 'List' : 'Chart'}</Text>
            </TouchableOpacity>
          </View>
          {chart
            ? <LicenceChart C={C} reqs={lic.reqs} journey={D.journey} haveFor={D.haveFor} rateFor={D.rateFor} metDateFor={D.metDateFor} />
            : <View style={{ gap: 11 }}>{reqs.map((r, i) => <MetReqRow key={i} C={C} r={r} have={D.haveFor(r.key)} metDate={D.metDateFor(r.key, r.required)} />)}</View>}
        </View>
      )}
    </View>
  );
}

export function LicenceJourney() {
  const C = useInsightsTheme();
  const D = useInsightsData();
  const subRole = useProfileStore((s) => s.profile?.subRole);
  const standard = useRegulationStandardStore((s) => s.standard);
  const [chart, setChart] = useState(false);
  const [open, setOpen] = useState(false);

  const set = licenceSetFor(subRole, standard);
  const list: WLicenceSet[] = [set.ppl, set.cpl, set.atpl];
  const isMet = (lic: WLicenceSet) => lic.reqs.every((r) => D.haveFor(r.key) >= r.required);
  const next = list.find((l) => !isMet(l)) ?? set.atpl;
  const done = list.filter(isMet);
  const metCount = next.reqs.filter((r) => D.haveFor(r.key) >= r.required).length;
  const overall = Math.round(next.reqs.reduce((s, r) => s + Math.min(1, D.haveFor(r.key) / r.required), 0) / next.reqs.length * 100);

  return (
    <View style={{ gap: 10 }}>
      <View style={{ backgroundColor: C.card, borderWidth: 1, borderColor: C.primary + '55', borderRadius: 16, padding: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 6 }}>
          <Ionicons name="ribbon-outline" size={17} color={C.primary} />
          <Text style={{ fontFamily: SERIF, fontSize: 18, fontWeight: '500', color: C.text }}>Next licence</Text>
          <View style={{ flex: 1 }} />
          <TouchableOpacity onPress={() => setChart((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 4, paddingHorizontal: 9, borderRadius: 7, borderWidth: 1, borderColor: chart ? C.primary : C.border, backgroundColor: chart ? C.primary + '22' : C.elevated }}>
            <Ionicons name={chart ? 'list' : 'analytics-outline'} size={12} color={chart ? C.primary : C.text3} />
            <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', color: chart ? C.primary : C.text3 }}>{chart ? 'List' : 'Chart'}</Text>
          </TouchableOpacity>
          <Text style={{ fontFamily: MONO, fontSize: 10, fontWeight: '700', color: C.muted }}>{metCount}/{next.reqs.length} met</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, marginBottom: 14 }}>
          <Text style={{ fontFamily: SERIF, fontSize: 30, fontWeight: '500', color: C.text }}>{next.code}</Text>
          <View style={{ flex: 1 }} />
          <Text style={{ fontFamily: SERIF, fontSize: 26, fontWeight: '600', color: C.primary }}>{overall}%</Text>
        </View>
        {chart
          ? <LicenceChart C={C} reqs={next.reqs} journey={D.journey} haveFor={D.haveFor} rateFor={D.rateFor} metDateFor={D.metDateFor} />
          : <View style={{ gap: 11 }}>{next.reqs.map((r, i) => <ReqRow key={i} C={C} r={r} haveFor={D.haveFor} rateFor={D.rateFor} />)}</View>}
      </View>

      {done.length > 0 && (
        <TouchableOpacity onPress={() => setOpen((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 11, borderWidth: 1, borderColor: C.border, backgroundColor: C.elevated }}>
          <Text style={{ fontSize: 12.5, fontWeight: '600', color: C.text2 }}>{open ? 'Hide' : 'Show'} completed licences ({done.length})</Text>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={C.text2} />
        </TouchableOpacity>
      )}
      {open && done.map((l) => <CompletedLicence key={l.code} C={C} lic={l} D={D} />)}
    </View>
  );
}
