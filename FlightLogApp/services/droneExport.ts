import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { getDroneFlights, droneModeHours, droneModeLabel, droneAltIn, type DroneFlight } from '../db/drones';
import { useAltitudeUnitStore } from '../store/altitudeUnitStore';
import { DRONE_OTHER_ROLES, DRONE_ROLE_LABEL, droneRoleOf, dronePicTime, droneCrewExportText } from '../constants/droneRoles';

function toHHMM(decimal: number): string {
  if (!decimal || isNaN(decimal)) return '0:00';
  const h = Math.floor(decimal);
  const m = Math.round((decimal - h) * 60);
  if (m === 60) return `${h + 1}:00`;
  return `${h}:${String(m).padStart(2, '0')}`;
}

const DELIM = ';';

function esc(val: string | number | null | undefined): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes(';')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

type Col = {
  header: string;
  value: (f: DroneFlight) => string | number;
  optional?: boolean;
  hasData?: (f: DroneFlight) => boolean;
  hours?: (f: DroneFlight) => number; // tidskolumn (HH:MM) → summeras i TOTAL-raden
};

// Tidskolumn i HH:MM; valfri = visas bara när någon flygning har tid där.
const timeCol = (header: string, hours: (f: DroneFlight) => number, optional = true): Col => ({
  header, hours, value: (f) => toHHMM(hours(f)),
  ...(optional ? { optional: true, hasData: (f: DroneFlight) => hours(f) > 0 } : {}),
});

export async function exportDroneToCSV(): Promise<void> {
  const flights = await getDroneFlights(99999);
  const altUnit = useAltitudeUnitStore.getState().unit; // höjd i användarens enhet (importen läser båda)

  const hasText = (s: string | null | undefined) => !!s && s.trim() !== '';

  const cols: Col[] = [
    { header: 'Date', value: f => f.date },
    { header: 'Drone type', value: f => f.drone_type },
    { header: 'Registration', value: f => f.registration },
    { header: 'Location', value: f => f.location, optional: true, hasData: f => hasText(f.location) },
    { header: 'Mission type', value: f => f.mission_type, optional: true, hasData: f => hasText(f.mission_type) },
    { header: 'Category', value: f => f.category, optional: true, hasData: f => hasText(f.category) },
    { header: 'Flight mode', value: f => droneModeLabel(f) },
    timeCol('Flight time', f => f.total_time || 0, false),
    // Tid per siktläge (delad tid exakt, som VFR/IFR) — visas när någon flygning har tid i läget.
    timeCol('VLOS', f => droneModeHours(f).vlos),
    timeCol('EVLOS', f => droneModeHours(f).evlos),
    timeCol('BVLOS', f => droneModeHours(f).bvlos),
    // Pilot function + tid per roll (valfria). PIC/SIC/Dual/Instructor som i loggboken — instruktör, RPIC och
    // examinator räknas även som PIC, safety pilot som co-pilot; övriga roller = hela flygtiden i egen kolumn.
    { header: 'Pilot function', value: f => DRONE_ROLE_LABEL[droneRoleOf(f)], optional: true, hasData: f => droneRoleOf(f) !== 'pic' },
    timeCol('PIC time', f => dronePicTime(f)),
    timeCol('SIC / Co-pilot time', f => f.co_pilot_fpv || 0),
    timeCol('Dual time', f => f.dual || 0),
    timeCol('Instructor time', f => f.instructor || 0),
    ...DRONE_OTHER_ROLES.map((r) => timeCol(`${DRONE_ROLE_LABEL[r]} time`, (f) => (droneRoleOf(f) === r ? f.total_time || 0 : 0))),
    { header: `Max altitude (${altUnit})`, value: f => droneAltIn(f.max_altitude_m, altUnit) || '', optional: true, hasData: f => droneAltIn(f.max_altitude_m, altUnit) > 0 },
    { header: 'Night', value: f => f.is_night ? 'Yes' : 'No', optional: true, hasData: f => f.is_night === 1 },
    // Besättning med roll (Second pilot + fler, inkl. observatörer) — ersätter den gamla Observer-kolumnen.
    { header: 'Crew', value: f => droneCrewExportText(f), optional: true, hasData: f => droneCrewExportText(f) !== '' },
    { header: 'Remarks', value: f => f.remarks, optional: true, hasData: f => hasText(f.remarks) },
  ];

  const activeCols = cols.filter(c => !c.optional || flights.some(f => c.hasData!(f)));

  const headers = activeCols.map(c => c.header);
  const rows = flights.map(f =>
    activeCols.map(c => esc(c.value(f))).join(DELIM)
  );

  const totalRow = activeCols.map((c, i) => {
    if (i === 0) return esc('TOTAL');
    if (c.hours) return esc(toHHMM(flights.reduce((sum, f) => sum + c.hours!(f), 0)));
    if (c.header === 'Drone type') return esc(`${flights.length} flights`);
    return '';
  }).join(DELIM);

  const sepHint = `sep=${DELIM}`;
  const csv = [sepHint, headers.join(DELIM), ...rows, '', totalRow].join('\r\n');
  const filename = `dronelog_${new Date().toISOString().split('T')[0]}.csv`;
  const path = FileSystem.documentDirectory + filename;

  await FileSystem.writeAsStringAsync(path, '\uFEFF' + csv, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(path, {
      mimeType: 'text/csv',
      dialogTitle: 'Export drone log — CSV',
    });
  }
}
