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
  flight_type: 'normal' | 'sim' | 'hot_refuel' | 'summary';
  multi_pilot: number;
  single_pilot: number;
  instructor: number;
  picus: number;
  spic: number;
  examiner: number;
  safety_pilot: number;
  observer: number;
  ferry_pic: number;
  relief_crew: number;
  sim_category: string;
  vfr: number;
  se_time: number;
  me_time: number;
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
  flight_type?: 'normal' | 'sim' | 'hot_refuel' | 'touch_and_go' | 'summary';
  stop_place?: string;
  multi_pilot?: string;
  single_pilot?: string;
  instructor?: string;
  picus?: string;
  spic?: string;
  examiner?: string;
  safety_pilot?: string;
  observer?: string;
  ferry_pic?: string;
  relief_crew?: string;
  sim_category?: 'FFS' | 'FTD' | 'FNPT_II' | 'FNPT_I' | 'BITD' | 'CPT_PPT' | 'CBT' | '';
  vfr?: string;
}

export interface IcaoAirport {
  icao: string;
  name: string;
  country: string;
  region: string;
  lat: number;
  lon: number;
  custom?: boolean;
  temporary?: number; // 1 = tillfällig landningsplats, ej på karta
}

export interface OcrFlightResult extends FlightFormData {
  needs_review: boolean;
  review_reason?: string;
  // AI-förslag på tolkning av remarks-fältet. Om AI tror att en del av remarks
  // egentligen hör hemma i ett annat fält (t.ex. 3-bokstavskod → second_pilot),
  // läggs förslaget här så UI kan visa en "Ja/Nej"-prompt.
  remarks_suggestion?: {
    field: string;           // fältnamn (second_pilot, picus, ...)
    value: string;           // värde att fylla in
    original_text: string;   // texten i remarks som triggade förslaget
    confidence: number;      // 0-1
    reason: string;          // kort förklaring (ex. "3-bokstavskod = andrepilot-kod")
  };
  // Om total_time (anchor) inte går ihop med dep_utc/arr_utc — AI anger vilka
  // alternativ som räknats ut så UI kan visa Ja/Nej-knappar per sida.
  time_mismatch?: {
    anchor_total_h: number;
    read_dep: string;
    read_arr: string;
    computed_dep_if_arr_correct: string;   // om arr är rätt, vad bör dep vara?
    computed_arr_if_dep_correct: string;   // om dep är rätt, vad bör arr vara?
  };
  // Specifika fält AI är osäker på. UI visar BARA dessa fält på flaggade
  // rader (plus "Visa alla fält"-toggle). Om tom array → visa alla fält.
  field_issues?: { field: string; reason: string; confidence: number }[];
  // Övergripande säkerhet 0–1 på hela raden. ≥ 0.95 = fast-track (komprimerad
  // rad, auto-godkänd) om needs_review=false.
  overall_confidence?: number;
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
  total_vfr: number;
  total_night: number;
  total_nvg: number;
  total_sim: number;
  total_landings_day: number;
  total_landings_night: number;
  last_90_days: number;
  last_12_months: number;
  year_to_date: number;
  best_week_hours: number;
  best_week_label: string;
  best_week_start: string;
  best_week_last_flight_id: number | null;
  longest_xc_hours: number;
  longest_xc_km: number;
  longest_xc_date: string;
  longest_xc_first_dep: string;
  longest_xc_last_arr: string;
  longest_xc_id: number | null;
  total_multi_pilot: number;
  total_single_pilot: number;
  total_instructor: number;
  total_picus: number;
  total_spic: number;
  total_ferry_pic: number;
  total_observer: number;
  total_relief_crew: number;
  total_examiner: number;
  total_safety_pilot: number;
  total_se: number;
  total_me: number;
}
