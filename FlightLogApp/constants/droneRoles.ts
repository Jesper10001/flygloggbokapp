// Drönar-roller — egen pilot function (rutnätet + "Other"-dropdownen) och besättningens roller
// (Second pilot + fler, = pilotläget). Nycklarna lagras i drone_flights.pilot_role / second_pilot_role /
// extra_pilots (JSON [{ role, name }]).

export type DroneRole =
  | 'pic' | 'sic' | 'dual' | 'instructor'
  | 'rpic' | 'payload' | 'mission_commander' | 'observer' | 'safety_pilot' | 'examiner';

// "Other"-dropdownens roller (visningsordning). Grundrollerna (PIC/SIC/DUAL/INSTRUCTOR) ligger i rutnätet.
export const DRONE_OTHER_ROLES: DroneRole[] = ['rpic', 'payload', 'mission_commander', 'observer', 'safety_pilot', 'examiner'];

export const DRONE_ROLE_LABEL: Record<DroneRole, string> = {
  pic: 'PIC', sic: 'SIC', dual: 'Dual', instructor: 'Instructor',
  rpic: 'RPIC', payload: 'Payload operator', mission_commander: 'Mission commander',
  observer: 'Observer', safety_pilot: 'Safety pilot', examiner: 'Examiner',
};

// Kortform — roll-pillen i Second pilot och besättningsraden i remarks ("SIC: J. Doe, OBS: A. Berg").
export const DRONE_ROLE_SHORT: Record<DroneRole, string> = {
  pic: 'PIC', sic: 'SIC', dual: 'DUAL', instructor: 'INSTR',
  rpic: 'RPIC', payload: 'PO', mission_commander: 'MC',
  observer: 'OBS', safety_pilot: 'SP', examiner: 'EXAM',
};

const ROLE_KEYS = new Set<string>(Object.keys(DRONE_ROLE_LABEL));
export const isDroneRole = (r: string | null | undefined): r is DroneRole => !!r && ROLE_KEYS.has(r);

// Pilot in command — max en per flygning (PIC och RPIC är samma funktion, olika regelverks namn).
export const isDronePicRole = (r: string | null | undefined) => r === 'pic' || r === 'rpic';

// Roller som inte flyger drönaren → ingen pilot function-tid (PIC 0 i loggboken), bara total.
export const DRONE_NON_PILOT_ROLES: DroneRole[] = ['payload', 'mission_commander', 'observer'];
export const isDroneNonPilotRole = (r: string | null | undefined) => isDroneRole(r) && DRONE_NON_PILOT_ROLES.includes(r);

// PIC-tid som i loggboken (droneToFlightRow + exporterna): total − co-pilot − dual; 0 för roller som inte flyger.
export function dronePicTime(f: { pilot_role?: string | null; total_time?: number | null; co_pilot_fpv?: number | null; dual?: number | null }): number {
  if (isDroneNonPilotRole(f.pilot_role)) return 0;
  return Math.max(0, (f.total_time || 0) - (f.co_pilot_fpv || 0) - (f.dual || 0));
}

// Rolltext (CSV-import, fritext) → rollnyckel. Tål etikett, kortform, nyckel och vanliga synonymer.
const ROLE_ALIASES: Record<string, DroneRole> = {
  pic: 'pic', pilotincommand: 'pic', pilot: 'pic',
  sic: 'sic', copilot: 'sic', siccopilot: 'sic', copilotsic: 'sic', secondincommand: 'sic', secondpilot: 'sic', fpv: 'sic', p2: 'sic',
  dual: 'dual', student: 'dual', studentdual: 'dual', dualstudent: 'dual', dualreceived: 'dual', trainee: 'dual',
  instructor: 'instructor', instr: 'instructor', fi: 'instructor', dualgiven: 'instructor',
  rpic: 'rpic', remotepilotincommand: 'rpic',
  payload: 'payload', po: 'payload', payloadoperator: 'payload', sensoroperator: 'payload', so: 'payload', cameraoperator: 'payload',
  missioncommander: 'mission_commander', mc: 'mission_commander',
  observer: 'observer', obs: 'observer', vo: 'observer', visualobserver: 'observer', uaobserver: 'observer',
  safetypilot: 'safety_pilot', sp: 'safety_pilot',
  examiner: 'examiner', exam: 'examiner',
};
export function parseDroneRole(text: string | null | undefined): DroneRole | '' {
  const k = (text ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!k) return '';
  if (ROLE_ALIASES[k]) return ROLE_ALIASES[k];
  return isDroneRole(k) ? k : '';
}

// Tidshink per roll (loggbokens "Pilot function time"). 'pic' = ingen hink — PIC härleds i
// droneToFlightRow som total − co-pilot − dual. Instructor får även PIC (som förut), Safety pilot =
// co-pilot och Examiner = PIC (som overlay-rollerna i pilotläget).
export function droneRoleColumn(r: DroneRole): 'pic' | 'co_pilot_fpv' | 'dual' | 'instructor' | 'none' {
  if (r === 'sic' || r === 'safety_pilot') return 'co_pilot_fpv';
  if (r === 'dual') return 'dual';
  if (r === 'instructor') return 'instructor';
  if (DRONE_NON_PILOT_ROLES.includes(r)) return 'none';
  return 'pic';
}

// Egen roll för en sparad flygning: pilot_role om satt, annars härledd ur tidshinkarna (äldre/importerade).
export function droneRoleOf(f: { pilot_role?: string | null; co_pilot_fpv?: number | null; dual?: number | null; instructor?: number | null }): DroneRole {
  if (isDroneRole(f.pilot_role)) return f.pilot_role;
  if ((f.co_pilot_fpv ?? 0) > 0) return 'sic';
  if ((f.dual ?? 0) > 0) return 'dual';
  if ((f.instructor ?? 0) > 0) return 'instructor';
  return 'pic';
}

// Second pilot-väljarens roller (medpilotens roll), vanligast först.
export const DRONE_CREW_ROLE_OPTS = (
  ['pic', 'sic', 'rpic', 'instructor', 'dual', 'observer', 'payload', 'mission_commander', 'safety_pilot', 'examiner'] as DroneRole[]
).map((k) => ({ key: k, short: DRONE_ROLE_SHORT[k], label: k === 'dual' ? 'Student (dual)' : DRONE_ROLE_LABEL[k] }));

export type DroneCrewMember = { role: string; name: string };

// extra_pilots-JSON → medlemmar (behåller rader med roll ELLER namn, som pilotläget).
export function parseDroneExtraPilots(json: string | null | undefined): DroneCrewMember[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr
      .map((p: any) => ({ role: String(p?.role ?? ''), name: String(p?.name ?? '').trim() }))
      .filter((p) => p.role || p.name);
  } catch {
    return [];
  }
}

// Hela besättningen ur DB-kolumnerna: second pilot först, sedan extra_pilots.
export function parseDroneCrew(f: { second_pilot?: string | null; second_pilot_role?: string | null; extra_pilots?: string | null }): DroneCrewMember[] {
  const second = (f.second_pilot ?? '').trim();
  return [
    ...(second ? [{ role: f.second_pilot_role ?? '', name: second }] : []),
    ...parseDroneExtraPilots(f.extra_pilots),
  ];
}

// Besättning → EN rad i pilotlägets format: "SIC: J. Doe, OBS: A. Berg" (namnlösa rader hoppas över).
// 'short' = remarks (kortform), 'label' = CSV-exportens Crew-kolumn ("Observer: A. Berg").
export function droneCrewLine(crew: DroneCrewMember[], style: 'short' | 'label' = 'short'): string {
  const roleText = (r: string) => (isDroneRole(r) ? (style === 'short' ? DRONE_ROLE_SHORT[r] : DRONE_ROLE_LABEL[r]) : '');
  return crew
    .filter((p) => p.name.trim())
    .map((p) => [roleText(p.role), p.name.trim()].filter(Boolean).join(': '))
    .join(', ');
}

// Crew-text (CSV-import) → medlemmar: "SIC: J. Doe, Observer: A. Berg" — rollprefix valfritt (okänt prefix
// = del av namnet). Avgränsare komma eller semikolon.
export function parseDroneCrewText(text: string | null | undefined): DroneCrewMember[] {
  return (text ?? '')
    .split(/\s*[,;]\s*/)
    .map((part) => {
      const m = part.match(/^([^:]{1,30}):\s*(.+)$/);
      const role = m ? parseDroneRole(m[1]) : '';
      return role ? { role: role as string, name: m![2].trim() } : { role: '', name: part.trim() };
    })
    .filter((p) => p.name);
}

// Hela besättningen för visning/export: kolumnerna + äldre Observer-fält (observer_name, från tiden före
// Second pilot-rollerna och från CSV-import) som roll 'observer' — utan dubbletter.
export function droneCrewOf(f: { second_pilot?: string | null; second_pilot_role?: string | null; extra_pilots?: string | null; observer_name?: string | null }): DroneCrewMember[] {
  const crew = parseDroneCrew(f);
  const seen = new Set(crew.map((p) => p.name.toLowerCase()));
  for (const raw of (f.observer_name ?? '').split(/\s*,\s*/)) {
    const name = raw.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    crew.push({ role: 'observer', name });
    seen.add(name.toLowerCase());
  }
  return crew;
}

// CSV-exportens Crew-kolumn: "SIC: J. Doe, Observer: A. Berg". En äldre Observer-flagga utan namn
// (CSV-import med Yes/No) skrivs som "Observer: Yes" — importen läser tillbaka den som flagga.
export function droneCrewExportText(f: { second_pilot?: string | null; second_pilot_role?: string | null; extra_pilots?: string | null; observer_name?: string | null; has_observer?: number | boolean | null }): string {
  const crew = droneCrewOf(f);
  const text = droneCrewLine(crew, 'label');
  const flagOnly = !!f.has_observer && !crew.some((p) => p.role === 'observer' && p.name.trim());
  return flagOnly ? (text ? `${text}, Observer: Yes` : 'Observer: Yes') : text;
}

// Info-sidan (i-knappen vid Pilot function): vad rollen innebär + vilken loggbokskolumn tiden hamnar i.
export const DRONE_ROLE_INFO: { code: string; name: string; bullets: string[]; logbook: string }[] = [
  { code: 'PIC', name: 'Pilot in command', logbook: 'PIC', bullets: [
    'You flew the drone and were responsible for the flight',
    'The usual choice when you fly on your own',
  ] },
  { code: 'SIC', name: 'Second in command', logbook: 'Co-pilot', bullets: [
    'You were the second remote pilot in a two-pilot crew, supporting the PIC',
    'For example flying FPV, or taking turns on the controls during a long mission',
  ] },
  { code: 'DUAL', name: 'Dual — instruction received', logbook: 'Dual', bullets: [
    'You were the student, flying under an instructor’s supervision',
  ] },
  { code: 'INSTR', name: 'Instructor — instruction given', logbook: 'Instructor and PIC', bullets: [
    'You taught a student who was flying the drone',
  ] },
  { code: 'RPIC', name: 'Remote pilot in command', logbook: 'PIC', bullets: [
    'The FAA (Part 107) and ICAO term for the pilot with final authority over the flight',
    'Under Part 107, another person may fly under the RPIC’s direct supervision',
    'Choose it when your operation uses the RPIC title — otherwise it works like PIC',
  ] },
  { code: 'PO', name: 'Payload operator', logbook: 'Total time only', bullets: [
    'You ran the camera, sensor or other payload while someone else flew',
    'Also called sensor operator',
  ] },
  { code: 'MC', name: 'Mission commander', logbook: 'Total time only', bullets: [
    'You led the mission — planning, tasking and crew coordination — without flying the drone',
    'Common in military, public-safety and larger commercial crews',
    'If you also flew the drone, choose PIC or RPIC instead',
  ] },
  { code: 'OBS', name: 'Observer', logbook: 'Total time only', bullets: [
    'You kept the drone and the airspace around it in sight and reported to the pilot',
    'EVLOS flights rely on observers',
  ] },
  { code: 'SP', name: 'Safety pilot', logbook: 'Co-pilot', bullets: [
    'You stood ready to take manual control — during automated flights, test flights or when a student was flying',
  ] },
  { code: 'EXAM', name: 'Examiner', logbook: 'PIC', bullets: [
    'You ran a practical skill test or proficiency check of another remote pilot',
  ] },
];
