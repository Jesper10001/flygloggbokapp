export type FlightStatus = 'manual' | 'scanned' | 'flagged' | 'verified';
export type FlightSource = 'manual' | 'ocr' | 'import';

export interface Flight {
  id: number;
  date: string;
  aircraft_type: string;
  registration: string;
  dep_place: string;
  dep_utc: string;
  arr_place: string;
  arr_utc: string;
  total_time: number;
  ifr: number;
  night: number;
  pic: number;
  co_pilot: number;
  dual: number;
  landings_day: number;
  landings_night: number;
  remarks: string;
  created_at: string;
  status: FlightStatus;
  source: FlightSource;
  original_data?: string;
  flight_rules: string;
  second_pilot: string;
  nvg: number;
  tng_count: number;
}

export interface FlightFormData {
  date: string;
  aircraft_type: string;
  registration: string;
  dep_place: string;
  dep_utc: string;
  arr_place: string;
  arr_utc: string;
  total_time: string;
  ifr: string;
  night: string;
  pic: string;
  co_pilot: string;
  dual: string;
  landings_day: string;
  landings_night: string;
  remarks: string;
  flight_rules?: string;
  second_pilot?: string;
  nvg?: string;
  tng_count?: string;
}

export interface IcaoAirport {
  icao: string;
  name: string;
  country: string;
  region: string;
  lat: number;
  lon: number;
  custom?: boolean;
}

export interface OcrFlightResult extends FlightFormData {
  needs_review: boolean;
  review_reason?: string;
}

export interface ValidationIssue {
  field: string;
  message: string;
  severity: 'error' | 'warning';
  suggested?: string;
}

export interface AuditEntry {
  id: number;
  flight_id: number;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  reason: string | null;
  changed_at: string;
  // joined
  date?: string;
  dep_place?: string;
  arr_place?: string;
}

export interface FlightStats {
  total_flights: number;
  total_time: number;
  total_pic: number;
  total_co_pilot: number;
  total_dual: number;
  total_ifr: number;
  total_night: number;
  total_landings_day: number;
  total_landings_night: number;
  last_90_days: number;
  last_12_months: number;
}
