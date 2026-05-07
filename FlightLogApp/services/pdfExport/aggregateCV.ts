import { getFlights, getFlightStats, getSetting } from '../../db/flights';
import { listCertificates } from '../../db/drones';
import type { Flight } from '../../types/flight';

export type PilotCV = {
  pilot: {
    name: string;
    title: string;
    license: string;
    email: string;
    phone: string;
    base: string;
    dob: string;
  };
  summary: {
    total_time: number;
    pic: number;
    dual: number;
    ifr: number;
    vfr: number;
    night: number;
    nvg: number;
    multi_engine: number;
    single_engine: number;
    landings_day: number;
    landings_night: number;
    total_flights: number;
    total_landings: number;
  };
  types: Array<{
    type: string;
    hours: number;
    flights: number;
    pic: number;
    dual: number;
    ifr: number;
    night: number;
    last_flight: string;
  }>;
  last12: {
    hours: number;
    pic: number;
    ifr: number;
    night: number;
    flights: number;
    landings: number;
  };
  months_bar: Array<{
    ym: string;
    label: string;
    hours: number;
  }>;
  certificates: Array<{
    name: string;
    issuer: string;
    issued: string;
    expires: string | null;
    status: 'valid' | 'expiring' | 'expired';
    detail: string;
  }>;
  timeline: Array<{
    year: number;
    label: string;
    detail: string;
  }>;
  languages: Array<{ name: string; level: string }>;
};

const MONTH_LABELS_SV = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

function pdfCertStatus(expires: string | null): 'valid' | 'expiring' | 'expired' {
  if (!expires) return 'valid';
  const days = (new Date(expires).getTime() - Date.now()) / 86400000;
  if (days < 0) return 'expired';
  if (days < 60) return 'expiring';
  return 'valid';
}

export async function aggregateCV(): Promise<PilotCV> {
  const [flights, stats, certs] = await Promise.all([
    getFlights(99999),
    getFlightStats(),
    listCertificates(),
  ]);

  const firstName = (await getSetting('profile_first_name')) ?? '';
  const lastName = (await getSetting('profile_last_name')) ?? '';
  const email = (await getSetting('profile_email')) ?? '';
  const phone = (await getSetting('profile_phone')) ?? '';
  const base = (await getSetting('profile_base')) ?? '';
  const dob = (await getSetting('profile_dob')) ?? '';
  const license = (await getSetting('profile_license')) ?? '';
  const title = (await getSetting('profile_title')) ?? '';

  const pilotName = `${firstName} ${lastName}`.trim() || 'Pilot';

  const realFlights = flights.filter((f: Flight) => f.flight_type !== 'sim');

  const sum = (key: keyof Flight, arr: Flight[] = realFlights) =>
    arr.reduce((acc, f) => acc + (Number(f[key]) || 0), 0);

  const totalTime = sum('total_time');
  const pic = sum('pic');
  const dual = sum('dual') + sum('co_pilot');
  const ifr = sum('ifr');
  const night = sum('night');
  const nvg = sum('nvg');
  const se = sum('se_time');
  const me = sum('me_time');
  const ldgDay = sum('landings_day');
  const ldgNight = sum('landings_night');
  const vfr = Math.max(totalTime - ifr - night, 0);

  // Per type
  const byType = new Map<string, { hours: number; flights: number; pic: number; dual: number; ifr: number; night: number; last_flight: string }>();
  for (const f of realFlights) {
    const t = f.aircraft_type;
    if (!t) continue;
    const cur = byType.get(t) ?? { hours: 0, flights: 0, pic: 0, dual: 0, ifr: 0, night: 0, last_flight: '0000-00-00' };
    cur.hours += f.total_time || 0;
    cur.flights++;
    cur.pic += f.pic || 0;
    cur.dual += (f.dual || 0) + (f.co_pilot || 0);
    cur.ifr += f.ifr || 0;
    cur.night += f.night || 0;
    if (f.date > cur.last_flight) cur.last_flight = f.date;
    byType.set(t, cur);
  }
  const types = Array.from(byType.entries())
    .map(([type, v]) => ({ type, ...v }))
    .sort((a, b) => b.hours - a.hours);

  // Last 12 months
  const today = new Date();
  const oneYearAgo = new Date(today);
  oneYearAgo.setFullYear(today.getFullYear() - 1);
  const isoOneYearAgo = oneYearAgo.toISOString().slice(0, 10);
  const last12Flights = realFlights.filter(f => f.date >= isoOneYearAgo);
  const l12sum = (key: keyof Flight) => last12Flights.reduce((a, f) => a + (Number(f[key]) || 0), 0);

  // Monthly bar chart (last 12 months)
  const monthsBar: PilotCV['months_bar'] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(today);
    d.setMonth(d.getMonth() - i);
    d.setDate(1);
    const ym = d.toISOString().slice(0, 7);
    const hours = realFlights.filter(f => f.date.slice(0, 7) === ym).reduce((a, f) => a + (f.total_time || 0), 0);
    monthsBar.push({ ym, label: MONTH_LABELS_SV[d.getMonth()], hours });
  }

  // Certificates
  const certificates: PilotCV['certificates'] = certs.map((c: any) => ({
    name: c.cert_type,
    issuer: c.label || '',
    issued: c.issued_date || '',
    expires: c.expires_date || null,
    status: pdfCertStatus(c.expires_date || null),
    detail: c.notes || '',
  }));

  // Timeline from certificates (sorted by issued date)
  const timeline: PilotCV['timeline'] = certs
    .filter((c: any) => c.issued_date)
    .map((c: any) => ({
      year: parseInt(c.issued_date.slice(0, 4)) || 0,
      label: c.cert_type,
      detail: c.notes || c.label || '',
    }))
    .sort((a, b) => a.year - b.year)
    .filter((t, i, arr) => i === 0 || t.year !== arr[i - 1].year || t.label !== arr[i - 1].label);

  // Languages from settings
  const langStr = (await getSetting('profile_languages')) ?? '';
  const languages = langStr
    ? langStr.split(',').map(l => {
        const [name, level] = l.trim().split(':');
        return { name: name?.trim() || '', level: level?.trim() || '' };
      }).filter(l => l.name)
    : [{ name: 'English', level: 'Proficient' }];

  const exportDate = today.toISOString().slice(0, 10);

  return {
    pilot: {
      name: pilotName,
      title: title || (certificates.length > 0 ? certificates[0].name : 'Pilot'),
      license: license || '',
      email,
      phone,
      base,
      dob,
    },
    summary: {
      total_time: totalTime,
      pic,
      dual,
      ifr,
      vfr,
      night,
      nvg,
      multi_engine: me,
      single_engine: se,
      landings_day: ldgDay,
      landings_night: ldgNight,
      total_flights: realFlights.length,
      total_landings: ldgDay + ldgNight,
    },
    types,
    last12: {
      hours: l12sum('total_time'),
      pic: l12sum('pic'),
      ifr: l12sum('ifr'),
      night: l12sum('night'),
      flights: last12Flights.length,
      landings: l12sum('landings_day') + l12sum('landings_night'),
    },
    months_bar: monthsBar,
    certificates,
    timeline,
    languages,
  };
}
