// Flygplatsfrekvenser (TWR/GND/ATIS/APP) från OurAirports → assets/airport-freq.json.
// Regenereras med `node scripts/build-frequencies.mjs`. Community-underhållen data → kan saknas/vara
// inaktuell för vissa fält (visas bara när den finns).
import FREQ_DATA from '../assets/airport-freq.json';

export type AirportFreq = { twr?: number; gnd?: number; atis?: number; app?: number };
const DATA = FREQ_DATA as unknown as Record<string, AirportFreq>;

export function getAirportFreq(icao: string): AirportFreq | null {
  return DATA[(icao || '').trim().toUpperCase()] ?? null;
}
