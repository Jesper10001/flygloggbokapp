// Solens tidslinje över en flygning: dag / skymning / natt i tidsordning, när solen går ned och när natten
// börjar (eller tvärtom på morgonen), och en mening som säger vad det betyder. Delas av route-kortets
// dagsbar (components/sun/SunStrip), Sun route-panelen och flygningens översikt (components/DayNightMap).
// Natt = solen mer än 6° under horisonten (samma modell som natt-tiden, utils/dayNight.ts).

import { sampleTimedRoute, type RouteLeg, type SunState } from './dayNight';

export type SunPhase = 'day' | 'twilight' | 'night';

// Samma färger överallt: guld = dag, solnedgångstoning = skymning, blålila = natt. Cyan är bara för det man trycker på.
export const SUN = {
  day: '#FFB830',
  twilight: '#F2784B',
  night: '#6C8CFF',
  nightText: '#A9BEFF',
  nightOnMap: '#8FA8FF',
  // Skymningens toning dag → natt (gryningen vänds).
  twilightGradient: ['#FFB830', '#F2784B', '#B25FB0', '#6C8CFF'] as const,
};

export const phaseOf = (s: SunState): SunPhase => (s === 'day' ? 'day' : s === 'night' ? 'night' : 'twilight');

export interface SunRun {
  state: SunState;   // dusk/dawn behålls så att skymningens toning kan vändas på morgonen
  phase: SunPhase;
  fromMs: number;
  toMs: number;
  f0: number;        // andel av flygningen (0–1)
  f1: number;
}

export type SunEventKind = 'sunset' | 'night' | 'nightEnd' | 'sunrise';
export interface SunEvent { kind: SunEventKind; ms: number; f: number }

export interface SunTimeline {
  depMs: number;
  arrMs: number;
  runs: SunRun[];
  events: SunEvent[];
  minutes: Record<SunPhase, number>;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
export const fmtUtc = (ms: number) => { const d = new Date(ms); return `${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}`; };
export const fmtMin = (min: number) => { const m = Math.max(0, Math.round(min)); return `${Math.floor(m / 60)}:${pad2(m % 60)}`; };

export function buildSunTimeline(legs: RouteLeg[], depMs: number, arrMs: number, steps = 300): SunTimeline | null {
  const dur = arrMs - depMs;
  if (!(dur > 0) || legs.length === 0) return null;
  const pts = sampleTimedRoute(legs, depMs, arrMs, steps);
  if (!pts.length) return null;
  const runs: SunRun[] = [];
  for (let i = 0; i < pts.length; i++) {
    // Varje punkt äger tiden halvvägs till grannarna.
    const a = i === 0 ? depMs : (pts[i - 1].timeMs + pts[i].timeMs) / 2;
    const b = i === pts.length - 1 ? arrMs : (pts[i].timeMs + pts[i + 1].timeMs) / 2;
    if (!(b > a)) continue;
    const last = runs[runs.length - 1];
    if (last && last.state === pts[i].state) last.toMs = b;
    else runs.push({ state: pts[i].state, phase: phaseOf(pts[i].state), fromMs: a, toMs: b, f0: 0, f1: 0 });
  }
  const minutes: Record<SunPhase, number> = { day: 0, twilight: 0, night: 0 };
  for (const r of runs) {
    r.f0 = (r.fromMs - depMs) / dur;
    r.f1 = (r.toMs - depMs) / dur;
    minutes[r.phase] += (r.toMs - r.fromMs) / 60000;
  }
  const events: SunEvent[] = [];
  for (let i = 1; i < runs.length; i++) {
    const p = runs[i - 1].phase, n = runs[i].phase, ms = runs[i].fromMs;
    const ev = (kind: SunEventKind) => events.push({ kind, ms, f: (ms - depMs) / dur });
    if (p === 'day' && n !== 'day') ev('sunset');
    if (p !== 'night' && n === 'night') ev('night');
    if (p === 'night' && n !== 'night') ev('nightEnd');
    if (p !== 'day' && n === 'day') ev('sunrise');
  }
  return { depMs, arrMs, runs, events, minutes };
}

export interface SunStory {
  icon: 'moon' | 'sun' | 'sunset' | 'sunrise';
  title: string;        // panelens rubrik
  sub: string;          // panelens andra rad
  short: string | null; // route-kortets rad (null = inget att säga: dagsljus hela vägen)
}

// Vad solen gör under flygningen, i klartext.
export function sunStory(tl: SunTimeline, arrLabel: string): SunStory {
  const first = tl.runs[0]?.phase ?? 'day';
  const last = tl.runs[tl.runs.length - 1]?.phase ?? 'day';
  const ev = (k: SunEventKind) => tl.events.find((e) => e.kind === k);
  const lastEv = (k: SunEventKind) => [...tl.events].reverse().find((e) => e.kind === k);
  const nightMin = tl.minutes.night;
  const at = arrLabel ? ` at ${arrLabel}` : '';
  const phases = new Set(tl.runs.map((r) => r.phase));

  if (phases.size === 1 && first === 'day') {
    return { icon: 'sun', title: 'Daylight the whole flight', sub: 'The sun is up from take-off to landing.', short: null };
  }
  if (phases.size === 1 && first === 'night') {
    return { icon: 'moon', title: 'Night the whole flight', sub: 'The sun stays more than 6° below the horizon from take-off to landing.', short: 'Night the whole flight.' };
  }
  const nightStart = ev('night');
  const nightEnd = ev('nightEnd');
  if (nightStart && last === 'night' && !nightEnd) {
    const before = Math.round((tl.arrMs - nightStart.ms) / 60000);
    const sunset = ev('sunset');
    return {
      icon: 'moon',
      title: `Night falls at ${fmtUtc(nightStart.ms)}, ${before} min before landing`,
      sub: `You land${at} in darkness.${sunset ? ` The sun set at ${fmtUtc(sunset.ms)} along the way.` : ''}`,
      short: `Night falls ${before} min before landing.`,
    };
  }
  if (nightEnd && first === 'night' && !nightStart) {
    const after = Math.round((nightEnd.ms - tl.depMs) / 60000);
    const sunrise = lastEv('sunrise');
    return {
      icon: 'sunrise',
      title: `Night ends at ${fmtUtc(nightEnd.ms)}, ${after} min after take-off`,
      sub: last === 'day'
        ? `${sunrise ? `Sunrise at ${fmtUtc(sunrise.ms)}. ` : ''}You land${at} in daylight.`
        : `You land${at} in twilight, which counts as day.`,
      short: `Night ends ${after} min after take-off.`,
    };
  }
  if (nightMin > 0) {
    return {
      icon: 'moon',
      title: `${fmtMin(nightMin)} of night along the way`,
      sub: nightStart ? `Night from ${fmtUtc(nightStart.ms)}${nightEnd && nightEnd.ms > nightStart.ms ? ` to ${fmtUtc(nightEnd.ms)}` : ''}.` : 'Part of the flight is more than 6° after sunset.',
      short: `${fmtMin(nightMin)} of night along the way.`,
    };
  }
  // Skymning men ingen natt.
  const sunset = ev('sunset');
  const sunrise = ev('sunrise');
  if (sunset) {
    return { icon: 'sunset', title: `The sun sets at ${fmtUtc(sunset.ms)}`, sub: 'It never gets dark enough for night, so the whole flight counts as day.', short: `Sunset at ${fmtUtc(sunset.ms)}, no night.` };
  }
  if (sunrise) {
    return { icon: 'sunrise', title: `The sun rises at ${fmtUtc(sunrise.ms)}`, sub: 'It is never dark enough for night, so the whole flight counts as day.', short: `Sunrise at ${fmtUtc(sunrise.ms)}, no night.` };
  }
  return { icon: 'sunset', title: 'Twilight the whole flight', sub: 'The sun is just below the horizon but never 6° down, so it counts as day.', short: 'Twilight the whole flight, no night.' };
}
