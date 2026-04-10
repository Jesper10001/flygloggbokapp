import type { FlightFormData, ValidationIssue, IcaoAirport } from '../types/flight';
import { calcFlightTime, isValidIcao, isValidTime, parseFlightTime } from './format';
import { calculateDistance } from '../db/icao';

// Rimliga flygtidsintervall per luftfartygstyp (min, max timmar)
const AIRCRAFT_TIME_RANGES: Record<string, [number, number]> = {
  C172: [0.1, 6],
  C152: [0.1, 5],
  PA28: [0.1, 6],
  PA44: [0.1, 7],
  TB20: [0.1, 7],
  DA40: [0.1, 7],
  DA42: [0.1, 8],
  SR22: [0.1, 8],
  B737: [0.3, 14],
  A320: [0.3, 14],
  B777: [0.5, 18],
  A330: [0.5, 18],
  A350: [0.5, 18],
  B787: [0.5, 18],
  ATR72: [0.2, 8],
  ATR42: [0.2, 7],
  Q400: [0.2, 7],
  E190: [0.3, 10],
  E195: [0.3, 10],
  CRJ9: [0.3, 9],
  SF340: [0.2, 7],
  SAAB340: [0.2, 7],
};

// Max rimlig genomsnittshastighet km/h för avståndskontroll
const MAX_SPEED_KMH = 950;

export function validateFlightForm(data: FlightFormData): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Datum
  if (!data.date) {
    issues.push({ field: 'date', message: 'Datum krävs', severity: 'error' });
  } else if (new Date(data.date) > new Date()) {
    issues.push({ field: 'date', message: 'Framtida datum', severity: 'error' });
  }

  // Luftfartyg — frivilliga, varning om tomma
  if (!data.aircraft_type?.trim()) {
    issues.push({ field: 'aircraft_type', message: 'Luftfartygstyp saknas', severity: 'warning' });
  }
  if (!data.registration?.trim()) {
    issues.push({ field: 'registration', message: 'Registration saknas', severity: 'warning' });
  }

  // ICAO — varning om ogiltigt, fel bara om helt tomt
  if (data.dep_place?.trim() && !isValidIcao(data.dep_place)) {
    issues.push({ field: 'dep_place', message: 'Ogiltig ICAO-kod (4 bokstäver)', severity: 'warning' });
  }
  if (data.arr_place?.trim() && !isValidIcao(data.arr_place)) {
    issues.push({ field: 'arr_place', message: 'Ogiltig ICAO-kod (4 bokstäver)', severity: 'warning' });
  }

  // Tider — validera bara om de är angivna
  if (data.dep_utc?.trim() && !isValidTime(data.dep_utc)) {
    issues.push({ field: 'dep_utc', message: 'Ogiltigt tidsformat, använd HH:MM', severity: 'warning' });
  }
  if (data.arr_utc?.trim() && !isValidTime(data.arr_utc)) {
    issues.push({ field: 'arr_utc', message: 'Ogiltigt tidsformat, använd HH:MM', severity: 'warning' });
  }

  // Flygtid — accepterar decimal (1.5) och HH:MM (1:30)
  const total = parseFlightTime(data.total_time);
  if (!data.total_time?.trim() || total <= 0) {
    issues.push({ field: 'total_time', message: 'Ange flygtid (t.ex. 1.5 eller 1:30)', severity: 'error' });
  } else {
    // Jämför med beräknad tid
    if (isValidTime(data.dep_utc) && isValidTime(data.arr_utc)) {
      const calc = calcFlightTime(data.dep_utc, data.arr_utc);
      if (calc > 0 && Math.abs(calc - total) > 0.1) {
        issues.push({
          field: 'total_time',
          message: `Beräknad flygtid ${calc}h stämmer inte med loggad ${total}h`,
          severity: 'warning',
          suggested: String(calc),
        });
      }
    }

    // Rimlighet per luftfartygstyp
    const typeKey = data.aircraft_type.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const range = AIRCRAFT_TIME_RANGES[typeKey];
    if (range && (total < range[0] || total > range[1])) {
      issues.push({
        field: 'total_time',
        message: `${total}h verkar orimligt för ${data.aircraft_type} (förväntat ${range[0]}–${range[1]}h)`,
        severity: 'warning',
      });
    }

    // Delkategorier ska inte överstiga total
    const pic = parseFlightTime(data.pic);
    const cop = parseFlightTime(data.co_pilot);
    const dual = parseFlightTime(data.dual);
    const ifr = parseFlightTime(data.ifr);
    const night = parseFlightTime(data.night);

    if (pic + cop + dual > total + 0.01) {
      issues.push({
        field: 'pic',
        message: `PIC+Co-pilot+Dual (${(pic+cop+dual).toFixed(1)}h) överstiger total flygtid`,
        severity: 'error',
      });
    }
    if (ifr > total + 0.01) {
      issues.push({ field: 'ifr', message: 'IFR-tid överstiger total flygtid', severity: 'error' });
    }
    if (night > total + 0.01) {
      issues.push({ field: 'night', message: 'Natttid överstiger total flygtid', severity: 'error' });
    }
  }

  // Samma dep och arr
  if (
    isValidIcao(data.dep_place) && isValidIcao(data.arr_place) &&
    data.dep_place.toUpperCase() === data.arr_place.toUpperCase()
  ) {
    issues.push({
      field: 'arr_place',
      message: 'Avgångs- och ankomstplats är samma (cirkelflygning?)',
      severity: 'warning',
    });
  }

  return issues;
}

// Avståndskontroll med ICAO-koordinater
export function validateDistance(
  dep: IcaoAirport,
  arr: IcaoAirport,
  totalTimeHours: number
): ValidationIssue | null {
  const distKm = calculateDistance(dep.lat, dep.lon, arr.lat, arr.lon);
  const avgSpeed = distKm / totalTimeHours;
  if (avgSpeed > MAX_SPEED_KMH) {
    return {
      field: 'total_time',
      message: `Genomsnittshastighet ${Math.round(avgSpeed)} km/h verkar hög för sträckan ${dep.icao}→${arr.icao} (${Math.round(distKm)} km)`,
      severity: 'warning',
    };
  }
  return null;
}

// Kontrollera sidtotaler (OCR)
export function validatePageTotals(params: {
  broughtForward: number;
  totalThisPage: number;
  totalToDate: number;
}): ValidationIssue | null {
  const expected = params.broughtForward + params.totalThisPage;
  if (Math.abs(expected - params.totalToDate) > 0.05) {
    return {
      field: 'total_time',
      message: `Brought forward (${params.broughtForward}) + this page (${params.totalThisPage}) = ${expected.toFixed(1)}, men Total to date är ${params.totalToDate}`,
      severity: 'error',
    };
  }
  return null;
}
