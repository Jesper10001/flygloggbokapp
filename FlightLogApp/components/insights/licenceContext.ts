// Laddar det licenskraven behöver utöver loggboken: positionen för varje plats i loggboken (FAA räknar
// cross-country på avståndet fågelvägen) och farkostkategorin per typ (vissa FAA-krav gäller bara helikopter).
// Laddas en gång per flights-lista och delas av alla Insights-sektioner.

import { useEffect } from 'react';
import { create } from 'zustand';
import { getDatabase } from '../../db/database';
import { getAirportCoordinates } from '../../db/icao';
import type { Flight } from '../../types/flight';
import type { LicenceCtx } from './licenceHours';

const up = (s?: string) => (s || '').trim().toUpperCase();

export async function loadLicenceCtx(flights: Flight[]): Promise<LicenceCtx> {
  const places = new Set<string>();
  for (const f of flights) for (const p of [f.dep_place, f.arr_place, (f as any).stop_place]) if (up(p)) places.add(up(p));
  const codes = [...places];
  const coords: LicenceCtx['coords'] = {};
  for (let i = 0; i < codes.length; i += 400) {
    const rows = await getAirportCoordinates(codes.slice(i, i + 400)).catch(() => []);
    for (const r of rows) coords[up(r.icao)] = { lat: r.lat, lon: r.lon };
  }
  const db = await getDatabase();
  const cats: LicenceCtx['cats'] = {};
  const rows = await db.getAllAsync<{ t: string; c: string }>(
    `SELECT UPPER(aircraft_type) AS t, MAX(category) AS c FROM aircraft_registry GROUP BY UPPER(aircraft_type)`,
  ).catch(() => []);
  for (const r of rows) if (r.t) cats[r.t] = r.c || '';
  return { coords, cats };
}

const useLicenceCtxStore = create<{ ctx: LicenceCtx | null; forFlights: Flight[] | null }>(() => ({ ctx: null, forFlights: null }));
let loading: Flight[] | null = null;

// Ger senast laddade sammanhang och laddar om när flights-listan byts (null tills första laddningen är klar).
export function useLicenceCtx(flights: Flight[]): LicenceCtx | null {
  const ctx = useLicenceCtxStore((s) => s.ctx);
  useEffect(() => {
    if (useLicenceCtxStore.getState().forFlights === flights || loading === flights) return;
    loading = flights;
    loadLicenceCtx(flights).then((c) => {
      if (loading === flights) { useLicenceCtxStore.setState({ ctx: c, forFlights: flights }); loading = null; }
    }).catch(() => { if (loading === flights) loading = null; });
  }, [flights]);
  return ctx;
}
