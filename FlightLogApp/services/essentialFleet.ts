// Blades Essential har ingen Fleet-vy, så data och bilder för nya flygplan och drönare hämtas inte där: det skulle
// kosta Blade coins för något som inte syns. Det som hoppades över sparas här och hämtas när man byter till Extensive.
import { getSetting, setSetting } from '../db/flights';
import { useAppVariantStore } from '../store/appVariantStore';

const AIRCRAFT_KEY = 'essential_skipped_aircraft';
const DRONE_KEY = 'essential_skipped_drones';

export function isEssential(): boolean {
  return useAppVariantStore.getState().variant === 'essential';
}

async function read(key: string): Promise<string[]> {
  try {
    const list = JSON.parse((await getSetting(key)) || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}

async function remember(key: string, names: string[]): Promise<void> {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (!clean.length) return;
  await setSetting(key, JSON.stringify([...new Set([...(await read(key)), ...clean])]));
}

export const rememberSkippedAircraft = (types: string[]) => remember(AIRCRAFT_KEY, types);
export const rememberSkippedDrones = (models: string[]) => remember(DRONE_KEY, models);

/** Tömmer listorna och returnerar det som hoppades över. */
export async function takeSkippedFleet(): Promise<{ aircraft: string[]; drones: string[] }> {
  const [aircraft, drones] = await Promise.all([read(AIRCRAFT_KEY), read(DRONE_KEY)]);
  if (aircraft.length) await setSetting(AIRCRAFT_KEY, '[]');
  if (drones.length) await setSetting(DRONE_KEY, '[]');
  return { aircraft, drones };
}
