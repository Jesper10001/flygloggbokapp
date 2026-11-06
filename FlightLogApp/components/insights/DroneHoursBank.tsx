// Drönar-Insights — Hours bank. Samma kort som pilotläget (HoursBankView: Your/All fields, tidsintervall, två
// kolumner) med drönarens grupper: roller, kategori, siktläge, villkor, typ av uppdrag, flygningar och landningar.
// Siffrorna räknas i SQL över alla drönarflygningar (getDroneHoursBank); All time tar med backfill som stats gör.

import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { DR } from '../../constants/droneTheme';
import { getDroneHoursBank, type DroneHoursBank as Bank } from '../../db/drones';
import { HoursBankView, rangeCut, type BankGroup, type BankTheme } from './HoursBank';
import type { BankRange } from './insightsData';

export function DroneHoursBank({ accent }: { accent: string }) {
  const [range, setRange] = useState<BankRange>('all');
  const [b, setB] = useState<Bank | null>(null);

  // Läses om när fliken visas och när intervallet byts.
  useFocusEffect(useCallback(() => {
    let alive = true;
    getDroneHoursBank(range === 'all' ? undefined : rangeCut(range)).then((x) => { if (alive) setB(x); }).catch(() => {});
    return () => { alive = false; };
  }, [range]));

  const C: BankTheme = {
    card: DR.surface, border: DR.border, separator: DR.separator, primary: accent,
    text: DR.text, text2: DR.text2, text3: DR.text3, muted: DR.muted, faint: DR.faint,
  };
  const groups: BankGroup[] = b ? [
    { title: 'Roles', unit: 'h', items: [
      { label: 'PIC', v: b.pic }, { label: 'FPV / 2nd pilot', v: b.sic }, { label: 'Dual', v: b.dual }, { label: 'Instructor', v: b.instructor },
    ] },
    { title: 'Category', unit: 'h', items: b.cats },
    { title: 'Line of sight', unit: 'h', items: [
      { label: 'VLOS', v: b.vlos }, { label: 'EVLOS', v: b.evlos }, { label: 'BVLOS', v: b.bvlos },
    ] },
    { title: 'Conditions', unit: 'h', items: [
      // VFR = total flygtid − IFR (= pilotläget).
      { label: 'Night', v: b.night }, { label: 'VFR', v: Math.max(0, b.total - b.ifr) }, { label: 'IFR', v: b.ifr },
    ] },
    { title: 'Mission', unit: 'h', items: [
      { label: 'Commercial', v: b.com }, { label: 'Private', v: b.pri },
    ] },
    { title: 'Flights', unit: '', items: [
      { label: 'All', v: b.flights }, { label: 'Night', v: b.night_flights },
    ] },
    { title: 'Landings', unit: '', items: [
      { label: 'Day', v: b.landings_day }, { label: 'Night', v: b.landings_night },
    ] },
  ] : [];

  return <HoursBankView C={C} total={b?.total ?? 0} groups={groups} range={range} onRange={setRange} />;
}
