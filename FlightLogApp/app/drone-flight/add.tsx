import { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Image,
  Alert, KeyboardAvoidingView, Platform, TextInput, Modal, Pressable,
  InputAccessoryView, Keyboard, ActivityIndicator, Animated, Easing,
} from 'react-native';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import { pickScanImage, CHOOSER_CLOSE_MS } from '../../components/AcarsScanChooser';
import { DroneScanChooser, DENIED_TEXT } from '../../components/DroneScanChooser';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { FlightVideo } from '../../components/FlightVideo';
import { useTranslation } from '../../hooks/useTranslation';
import {
  listDrones, insertDroneFlight, getDroneFlights,
  getDroneFlightById, updateDroneFlight, getRecentDroneLocations, addDrone, updateDrone,
  getDroneFlightCount, persistDroneModelLookup, setDroneFlightPhoto, getRecentDroneCrew, getDroneCrewByModel,
  droneAltFt, droneAltIn, droneAltToM, formatDroneAlt,
  type DroneRegistryEntry, type DroneFlightFormData, type DroneFlightMode,
} from '../../db/drones';
import {
  DRONE_OTHER_ROLES, DRONE_ROLE_LABEL, DRONE_CREW_ROLE_OPTS, DRONE_ROLE_INFO,
  droneRoleColumn, droneRoleOf, isDronePicRole, droneCrewLine, parseDroneCrew, parseDroneExtraPilots,
  type DroneRole,
} from '../../constants/droneRoles';
import { PersonPicker, type SavedPerson, type AircraftPilots } from '../../components/logflight/PersonPicker';
import { AddPilotModal } from '../../components/logflight/AddPilotModal';
import { enrichDroneFleet } from '../../services/droneLookup';
import { askAiConsent, isAiConsentError } from '../../services/aiConsent';
import { scanDroneFlightLog, type ScannedDroneDay } from '../../services/droneLogScan';
import { hasTokenQuota, showMonthlyTokenLimitAlert, isTokenQuotaError } from '../../utils/tokenGate';
import { useFlightStore } from '../../store/flightStore';
import { presentPaywall } from '../../services/purchases';
import { FREE_TIER_LIMIT_DRONE } from '../../constants/easa';
import { FlightLimitModal } from '../../components/FlightLimitModal';
import { DroneModal } from '../../components/DroneModal';
import { SlideToggle } from '../../components/logflight/SlideToggle';
import { useDroneFlightStore } from '../../store/droneFlightStore';
import { decimalToMMSS, mmssToDecimal, decimalToHHMM } from '../../hooks/useTimeFormat';
import { SmartTimeInput, type SmartTimeInputHandle } from '../../components/SmartTimeInput';
import { calcFlightTime, isValidTime } from '../../utils/format';
import { FONT_LED7, FONT_LED14 } from '../../components/logflight/tokens';
import { categoryFromCClass, NATO_CLASSES } from '../../constants/droneCategories';
import { GlassDialog, DialogIcon } from '../../components/GlassDialog';
import { SunGlobe } from '../../components/logflight/SunGlobe';
import { SunStrip } from '../../components/sun/SunStrip';
import { DayNightMap } from '../../components/DayNightMap';
import { buildSunTimeline } from '../../utils/sunTimeline';
import { IcaoInput, type RecentPlace } from '../../components/IcaoInput';
import { getRecentPlaces } from '../../db/flights';
import { getAirportTzInfo } from '../../db/icao';
import { usePilotTypeStore } from '../../store/pilotTypeStore';
import { useToastStore } from '../../components/Toast';
import { DR } from '../../constants/droneTheme';
import { Colors } from '../../constants/colors';
import { useDroneAccentStore } from '../../store/droneAccentStore';
import { useAltitudeUnitStore } from '../../store/altitudeUnitStore';
import { useLanguageStore } from '../../store/languageStore';
import { classifySun, computeNightHoursTimed, type SunState } from '../../utils/dayNight';
import { buildInstants } from '../../utils/flightTime';
import { CondBar } from '../../components/logflight/CondBar';
import { MaxAltBar } from '../../components/logflight/MaxAltBar';
import { useTourStore } from '../../store/tourStore';
import { loadFlightDraft, saveFlightDraft, clearFlightDraft, draftLabels } from '../../services/flightDrafts';
import { TOURS } from '../../constants/tourSteps';
import { TourPress } from '../../components/TourPress';
import { rememberTourDemo, cleanupTourDemo } from '../../services/tourDemoFlight';
import { isEssential, rememberSkippedDrones } from '../../services/essentialFleet';

const today = new Date().toISOString().split('T')[0];
const nowHHMM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
// Lokal (enhetens tidszon) ↔ UTC för en given flygdag. Loggboken (fysisk + digital)
// lagrar UTC (Z); lokaltid räknas om via enhetens tz (användarens region), med DST för datumet.
const localToUtc = (date: string, hhmm: string): string => {
  if (!/^\d{1,2}:\d{2}$/.test(hhmm) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`); // enhetens lokala tz
  if (isNaN(d.getTime())) return '';
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
};
const utcToLocal = (date: string, hhmm: string): string => {
  if (!/^\d{1,2}:\d{2}$/.test(hhmm) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`); // UTC
  if (isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
// HH:MM + decimaltimmar → HH:MM (för att härleda ankomsttid ur take-off + total vid redigering).
const addHHMM = (hhmm: string, hours: number): string => {
  if (!/^\d{1,2}:\d{2}$/.test(hhmm) || !(hours > 0)) return '';
  const [h, m] = hhmm.split(':').map(Number);
  const tot = (h * 60 + m + Math.round(hours * 60)) % 1440;
  return `${String(Math.floor(tot / 60)).padStart(2, '0')}:${String(tot % 60).padStart(2, '0')}`;
};
// Open-kategorins höjdtak (EU 2019/947): 120 m AGL. Över → Specific krävs.
const OPEN_ALT_LIMIT_M = 120;
// Max alt-baren i vald enhet (Settings → General; lagras alltid i meter): fot 0–24 000 (drag 200, −/+ 10),
// meter 0–7 300 (drag 50, −/+ 5) — samma tak i båda enheterna.
const ALT_BAR = { ft: { max: 24000, drag: 200, fine: 10 }, m: { max: 7300, drag: 50, fine: 5 } } as const;
// Äldre Observer-rad ("Observer: xxxx", från tiden med egen Observer-ruta) — tas bort ur remarks vid
// redigering; namnet flyttas in som besättning med rollen Observer.
const stripObserverRemarks = (remarks: string): string =>
  (remarks || '').replace(/(^|\n)\s*Observer:[^\n]*/gi, '\n').replace(/\n{2,}/g, '\n').trim();
// Besättningsraden (Second pilot + fler, "SIC: J. Doe, OBS: A. Berg") läggs SIST i remarks vid spar
// (= pilotläget) och plockas bort igen vid redigering — rutorna är källan, remarks får en kopia.
const stripCrewRemarks = (remarks: string, crewLine: string): string =>
  crewLine ? (remarks || '').split('\n').filter((ln) => ln.trim() !== crewLine).join('\n').trim() : (remarks || '').trim();
const mergeCrewRemarks = (remarks: string, crewLine: string): string => {
  const free = stripCrewRemarks(remarks, crewLine);
  return crewLine ? (free ? `${free}\n${crewLine}` : crewLine) : free;
};
// Väljarna (PersonPicker/AddPilotModal) i drönarens palett — samma utseende som pilotläget.
const crewPalette = (accent: string) => ({
  picker: { accent, box: DR.surface, flyout: DR.elevated, chip: DR.surface, border: DR.border, text: DR.text, text2: DR.text2, muted: DR.muted },
  modal: { accent, onAccent: DR.inkOnAccent, card: DR.surface, cardBorder: DR.border, field: DR.elevated, border: DR.border, text: DR.text, text2: DR.text2, muted: DR.muted },
});

// Ordningstal (2nd, 3rd, 4th …) för "+ Add Nth flight".
const ordinal = (n: number) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };
// Orange backdrop för extra-flygningarnas (2:a/3:e…) inmatningsrutor — särskiljer dem tydligt från de cyan/
// navy-färgade tid-rutorna så det syns bättre vad man skriver.
const DRONE_ORANGE = '#F97316';
// Dynamisk platstext-storlek (= pilot log flight): 19 (≤4 tecken) → 13 (≥12 tecken).
const placeFontSize = (v: string) => 19 - Math.max(0, Math.min(v.length, 12) - 4) * 0.75;

// Förvalda mission-typer — snabbval i Mission-dropdownen överst. Fritextrutan tillåter
// valfri egen text (mission_type = valfri sträng), så "Other" behövs inte längre.
const MISSION_TYPES = ['Inspection', 'Mapping', 'Photo / Video', 'SAR', 'Training', 'Testing', 'Recreation'];

// Blades introduction — exempel för loggningsdemon när användaren saknar egen drönare/besättning.
// Exempeldrönaren läggs till tillfälligt och raderas med exempel-flygningen (services/tourDemoFlight).
const TOUR_DRONE = { drone_type: 'multirotor' as const, model: 'Mavic 3 Enterprise', registration: 'SE-D001', mtow_g: 920, category: 'Specific', drone_class: 'civil', notes: '' };
const TOUR_BVLOS_SHARE = 0.7; // siktläge i demon: 70 % BVLOS, resten VLOS (BVLOS kräver kategorin Specific)
const TOUR_CREW = { name: 'Erik Lind', role: 'observer' };
const TOUR_REMARK = 'Example flight · Blades introduction';
const FLIGHT_MODES: DroneFlightMode[] = ['VLOS', 'EVLOS', 'BVLOS'];
// Kategorin väljs per flygning ur EN lista för alla: militära piloter kan flyga civila drönare (och tvärtom)
// under ett annat regelverk. Förvalet kommer från drönaren; ett annat val frågar vid Save om drönaren ska få det.
type CatOption = { value: string; label: string; note: string };
const CAT_CIVIL: CatOption[] = [
  { value: 'A1', label: 'A1', note: '' }, { value: 'A2', label: 'A2', note: '' }, { value: 'A3', label: 'A3', note: '' },
  { value: 'Specific', label: 'Specific', note: '' }, { value: 'Certified', label: 'Certified', note: '' },
];
const CAT_MILITARY: CatOption[] = [{ value: 'MRPAS', label: 'MRPAS', note: '< 25 kg' }, { value: 'RPAS', label: 'RPAS', note: '> 25 kg' }];
const CAT_NATO: CatOption[] = NATO_CLASSES.flatMap((g) => g.options.map((o) => ({
  value: o.value, label: o.label.replace(/^Class /, ''), note: /kg/.test(o.note ?? '') ? (o.note ?? '').split(',')[0] : '',
})));
const OPEN_CATS = ['A1', 'A2', 'A3'];
// Visning i väljarrutan: kort namn + förklaring ("A1 · Open · max 120 m", "NATO I · Mini · 2–20 kg").
const catDisplay = (v: string): { short: string; note: string } => {
  if (!v) return { short: 'Choose', note: '' };
  if (OPEN_CATS.includes(v)) return { short: v, note: 'Open · max 120 m' };
  if (v === 'Specific' || v === 'Certified') return { short: v, note: '' };
  const m = CAT_MILITARY.find((o) => o.value === v);
  if (m) return { short: m.label, note: `Military · ${m.note}` };
  const n = CAT_NATO.find((o) => o.value === v);
  if (n) return { short: `NATO ${n.label}`, note: n.note };
  return { short: v, note: '' };
};
const LEG_ORD = (i: number) => ['1ST', '2ND', '3RD'][i] ?? `${i + 1}TH`;
const kmBetween = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

export default function AddDroneFlightScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ id?: string; addPhoto?: string; scanImage?: string; draft?: string }>();
  const editId = params.id ? parseInt(params.id, 10) : null;
  const isEdit = !!editId;
  const fromDraft = params.draft === '1' && !isEdit;   // fortsätter ett sparat utkast (dashboardens kort)
  // Media (bild/video) — = pilotläget: väljs i formuläret och sparas på flygningen.
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [mediaType, setMediaType] = useState<'image' | 'video'>('image');
  const { t } = useTranslation();
  const { loadFlights, loadStats } = useDroneFlightStore();
  const { isPremium, isMax, canAddDroneFlight } = useFlightStore();
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [limitBlockedOnEntry, setLimitBlockedOnEntry] = useState(false);
  const pilotType = usePilotTypeStore((s) => s.pilotType);
  const accent = useDroneAccentStore((s) => s.color);
  const loadAccent = useDroneAccentStore((s) => s.load);
  const lang = useLanguageStore((s) => s.language);
  const insets = useSafeAreaInsets();
  const altUnit = useAltitudeUnitStore((s) => s.unit);
  const styles = makeStyles(accent);
  const crewColors = crewPalette(accent);

  const [form, setForm] = useState<DroneFlightFormData>({
    date: today,
    drone_id: null,
    location: '',
    takeoff_time: nowHHMM(),
    landing_location: '',
    mission_type: '', // tomt som standard → bara platshållaren "Type of mission" syns
    category: '',
    flight_mode: 'VLOS',
    total_time: '0',
    max_altitude_m: '',
    is_night: false,
    has_observer: false,
    observer_name: '',
    wind_ms: '',
    operation_type: '',
    landings_day: '',
    landings_night: '',
    co_pilot_fpv: '',
    dual: '',
    instructor: '',
    ifr: '',
    vfr: '',
    night_time: '',
    flight_rules: 'VFR',
    second_pilot: '',
    second_pilot_role: '',
    remarks: '',
  });

  const [drones, setDrones] = useState<DroneRegistryEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [showDate, setShowDate] = useState(false);
  // Drönar-box (typ + registrering) — dropdown-flikar + "+" öppnar drönar-modalen.
  const [typeOpen, setTypeOpen] = useState(false);
  const [regOpen, setRegOpen] = useState(false);
  const [showDroneModal, setShowDroneModal] = useState(false);
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  // Pilot function (som pilot log flight): PIC / SIC / DUAL / INSTRUCTOR + "Other"-rollerna (dropdown).
  const [role, setRole] = useState<DroneRole>('pic');
  const [otherOpen, setOtherOpen] = useState(false);       // "Other"-dropdownen
  const [roleInfoOpen, setRoleInfoOpen] = useState(false); // info-sidan (i-knappen vid Pilot function)
  // Second pilot + fler medpiloter (= pilotläget). Second pilot ligger i form, fler i extraPilots (JSON vid spar).
  const [extraPilots, setExtraPilots] = useState<{ id: string; role: string; name: string }[]>([]);
  const [recentCrew, setRecentCrew] = useState<SavedPerson[]>([]);
  const [crewByModel, setCrewByModel] = useState<AircraftPilots[]>([]);
  const [crewOpen, setCrewOpen] = useState(false); // en väljarflik är öppen → lyft ramen över innehållet under
  const [addPilot, setAddPilot] = useState<{ visible: boolean; title: string; cb?: (n: string) => void }>({ visible: false, title: '' });
  // Instrument scan (skärmdump av drönarappens flyglogg): dagar som inte loggats än (senaste först), dagen
  // som ligger i formuläret, och datumväljaren — före första loggningen och efter varje Save.
  const [scanChooserOpen, setScanChooserOpen] = useState(false);
  const scanResolveRef = useRef<((s: 'camera' | 'library' | null) => void) | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanDays, setScanDays] = useState<ScannedDroneDay[]>([]);
  const [scanActiveDate, setScanActiveDate] = useState<string | null>(null);
  const [scanPicker, setScanPicker] = useState<null | { selected: string; afterSave: boolean; loggedDate?: string }>(null);
  const [loggedDates, setLoggedDates] = useState<Set<string>>(new Set()); // datum som redan finns i loggboken
  // Mission (överst): fritextruta + dropdown med förval (MISSION_TYPES).
  const [showMissionPicker, setShowMissionPicker] = useState(false);
  // Quicklog (det kritiska) ↔ Full (allt), som pilotens Log Flight: Quicklog för nya, Full vid redigering.
  const [logFull, setLogFull] = useState(isEdit);
  // Same spot (start och landning på samma plats, flygningar med batteribyte) ↔ A → B (som pilotens rutt:
  // avgångs- och ankomstplats med var sin tid; totalen = ankomst − avgång).
  const [routeMode, setRouteMode] = useState<'same' | 'ab'>('same');
  const [arrTime, setArrTime] = useState(''); // A → B: ankomsttid (UTC)
  const [arrLocalBuf, setArrLocalBuf] = useState('');
  const [nightManual, setNightManual] = useState(isEdit);
  const [landingsManual, setLandingsManual] = useState(isEdit);
  const [condOpen, setCondOpen] = useState(false); // Full: tid per läge · natt · VFR/IFR
  const [catOpen, setCatOpen] = useState(false);   // kategorilistan
  const [sunRouteOpen, setSunRouteOpen] = useState(false);
  const [placeBusy, setPlaceBusy] = useState<null | 'dep' | 'arr'>(null);
  // Frågan vid Save när vald kategori skiljer sig från drönarens.
  const [catAsk, setCatAsk] = useState<null | { drone: string; from: string; to: string }>(null);
  const catAskResolve = useRef<((r: 'drone' | 'flight' | null) => void) | null>(null);
  const catAsked = useRef<Set<string>>(new Set());
  const loadedCat = useRef<string | null>(null); // kategorin när en sparad flygning öppnades
  // Full-läge route-hero: enskild plats (Location) + take-off-tid + FLYGTID per flygning.
  // fullLegs[0] = 1:a flygningens varaktighet ("Flight time"); [1..] = extra flygningar (MM:SS).
  const [fullLegs, setFullLegs] = useState<string[]>(['']);
  // Z (UTC) ↔ L (lokal): tider lagras alltid som UTC; L visar/matar lokalbuffert.
  const [timeMode, setTimeMode] = useState<'utc' | 'local'>('utc');
  const [depLocalBuf, setDepLocalBuf] = useState('');
  const [showRegInput, setShowRegInput] = useState(false);
  const [regInput, setRegInput] = useState('');
  // Kondition-barer (VFR/IFR/Night): rå tid-inmatningsbuffert + scroll-lås under drag + natt-auto.
  const [condRaw, setCondRaw] = useState<Record<string, string>>({});
  const [scrollLocked, setScrollLocked] = useState(false);
  const [recentPlaces, setRecentPlaces] = useState<string[]>([]);
  const [recentAirports, setRecentAirports] = useState<RecentPlace[]>([]);
  const depTimeRef = useRef<SmartTimeInputHandle>(null);
  const arrTimeRef = useRef<SmartTimeInputHandle>(null);
  // Blades introduction: loggningsdemon (effekten före return) — scroll-ref, sektionernas y-lägen och
  // senaste renderns save/värden (demon körs async i flera sekunder → inga inaktuella closures).
  const tourActive = useTourStore((s) => s.active);
  const logDemoRun = useTourStore((s) => s.logDemoRun);
  const demoRunAtMount = useRef(logDemoRun); // demon startar bara när rundturen ökar räknaren EFTER montering
  const scrollRef = useRef<ScrollView>(null);
  const demoY = useRef<Record<string, number>>({});
  const scrollMetrics = useRef({ contentH: 0, viewH: 0 });
  const demoLatest = useRef<{ save: (sameSession?: boolean, demo?: boolean) => Promise<number | undefined>; role: DroneRole; total: number } | null>(null);

  // Varaktighet (HH:MM, eller bara minuter innan kolon skrivits) → decimaltimmar.
  const durToDec = (d: string) => {
    if (!d) return 0;
    if (d.includes(':')) { const [h, m] = d.split(':'); return (parseInt(h, 10) || 0) + (parseInt(m, 10) || 0) / 60; }
    const n = parseInt(d, 10) || 0; return n / 60; // 1–2 siffror = minuter (progressiv inmatning)
  };
  // Same spot: total = summan av flygningarnas varaktigheter (fullLegs). A → B: ankomst − avgång.
  const fullTotalDecimal = fullLegs.reduce((s, d) => s + durToDec(d), 0);
  const abTotal = calcFlightTime(form.takeoff_time ?? '', arrTime);
  const totalNow = routeMode === 'ab' ? abTotal : fullTotalDecimal;
  // Landningstid: A → B den inskrivna, annars take-off + total (för natt och landningar).
  const derivedArr = routeMode === 'ab'
    ? (isValidTime(arrTime) ? arrTime : '')
    : (isValidTime(form.takeoff_time ?? '') && fullTotalDecimal > 0) ? addHHMM(form.takeoff_time ?? '', fullTotalDecimal) : '';
  const depCoords = form.lat && form.lon ? { lat: form.lat, lon: form.lon } : null;
  const arrCoords = form.landing_lat && form.landing_lon ? { lat: form.landing_lat, lon: form.landing_lon } : null;

  useEffect(() => {
    const next = String(totalNow);
    setForm((p) => (p.total_time === next ? p : { ...p, total_time: next }));
  }, [totalNow]);

  // Natt räknas själv ur plats + tid (solen 6° under horisonten) tills man drar i nattbaren.
  useEffect(() => {
    if (nightManual) return;
    const legs = routeMode === 'ab' && depCoords && arrCoords ? [depCoords, arrCoords] : depCoords ? [depCoords, depCoords] : null;
    const inst = legs && derivedArr ? buildInstants(form.date, form.takeoff_time ?? '', derivedArr, 0) : null;
    if (!legs || !inst) return;
    const n = computeNightHoursTimed(legs, inst.dep.getTime(), inst.arr.getTime());
    const v = n > 0 ? String(n) : '';
    setForm((p) => (p.night_time === v ? p : { ...p, night_time: v }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nightManual, routeMode, form.lat, form.lon, form.landing_lat, form.landing_lon, form.takeoff_time, derivedArr, form.date]);

  // A → B: avgång och ankomst är flygplatser (ICAO, som pilotens rutt) → koordinaterna slås upp i registret.
  // Okända namn behåller koordinaterna de har (t.ex. från GPS).
  useEffect(() => {
    if (routeMode !== 'ab') return;
    let alive = true;
    const dep = form.location.trim().toUpperCase();
    const arr = (form.landing_location ?? '').trim().toUpperCase();
    (async () => {
      const rows = await getAirportTzInfo([dep, arr].filter((c) => c.length >= 2));
      if (!alive) return;
      const d = rows.find((r) => r.icao === dep), a = rows.find((r) => r.icao === arr);
      setForm((p) => {
        let next = p;
        if (d && d.lat != null && (p.lat !== d.lat || p.lon !== d.lon)) next = { ...next, lat: d.lat, lon: d.lon };
        if (a && a.lat != null && (p.landing_lat !== a.lat || p.landing_lon !== a.lon)) next = { ...next, landing_lat: a.lat, landing_lon: a.lon };
        return next;
      });
    })().catch(() => {});
    return () => { alive = false; };
  }, [routeMode, form.location, form.landing_location]);

  // Landningar (auto): en per flygning, dag eller natt efter när den landade (platsens sol). −/+ tar över.
  useEffect(() => {
    if (landingsManual) return;
    const times: string[] = [];
    if (routeMode === 'ab') { if (isValidTime(arrTime)) times.push(arrTime); }
    else {
      let acc = 0;
      for (const leg of fullLegs) {
        const d = durToDec(leg);
        if (d <= 0) continue;
        acc += d;
        times.push(isValidTime(form.takeoff_time ?? '') ? addHHMM(form.takeoff_time ?? '', acc) : '');
      }
    }
    const at = routeMode === 'ab' ? arrCoords : depCoords;
    let day = 0, night = 0;
    for (const tm of times) {
      const inst = tm && at ? buildInstants(form.date, tm, tm, 0) : null;
      if (inst && at && classifySun(inst.dep, at.lat, at.lon) === 'night') night++; else day++;
    }
    const d = day ? String(day) : '', n = night ? String(night) : '';
    setForm((p) => (p.landings_day === d && p.landings_night === n ? p : { ...p, landings_day: d, landings_night: n }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landingsManual, routeMode, arrTime, fullLegs, form.takeoff_time, form.date, form.lat, form.lon, form.landing_lat, form.landing_lon]);

  // Lokalläge: när flygdatum ändras → räkna om UTC ur lokalbufferten (DST kan skifta).
  useEffect(() => {
    if (timeMode !== 'local') return;
    if (isValidTime(depLocalBuf)) setForm((p) => ({ ...p, takeoff_time: localToUtc(form.date, depLocalBuf) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.date]);

  // Pilot function → tidshinkar: vald roll får hela totalen i sin kolumn, övriga 0 (droneRoleColumn).
  // PIC härleds i droneToFlightRow som total − co_pilot_fpv − dual (instructor är egen kolumn/overlay);
  // roller som inte flyger (payload/mission commander/observer) får ingen PIC — styrs av pilot_role.
  useEffect(() => {
    const tt = parseFloat(form.total_time) || 0;
    const s = (n: number) => (n > 0 ? String(n) : '');
    const col = droneRoleColumn(role);
    const next = {
      co_pilot_fpv: col === 'co_pilot_fpv' ? s(tt) : '',
      dual: col === 'dual' ? s(tt) : '',
      instructor: col === 'instructor' ? s(tt) : '',
    };
    setForm((p) => (p.co_pilot_fpv === next.co_pilot_fpv && p.dual === next.dual && p.instructor === next.instructor ? p : { ...p, ...next }));
  }, [role, form.total_time]);

  // Det måste finnas en pilot in command när en medpilot är namngiven (= pilotläget): saknas PIC blir den
  // första namngivna medpiloten utan roll PIC. Du som instruktör/examinator räknas som PIC.
  useEffect(() => {
    const namedSecond = (form.second_pilot ?? '').trim() !== '';
    const hasOther = namedSecond || extraPilots.some((p) => p.name.trim() !== '');
    const anyPic = isDronePicRole(role) || role === 'instructor' || role === 'examiner'
      || isDronePicRole(form.second_pilot_role) || extraPilots.some((p) => isDronePicRole(p.role));
    if (!hasOther || anyPic) return;
    if (namedSecond && !(form.second_pilot_role ?? '')) setForm((p) => ({ ...p, second_pilot_role: 'pic' }));
    else {
      const first = extraPilots.find((p) => p.name.trim() !== '' && !p.role);
      if (first) setExtraPilots((prev) => prev.map((x) => (x.id === first.id ? { ...x, role: 'pic' } : x)));
    }
  }, [role, form.second_pilot, form.second_pilot_role, extraPilots]);

  // Kondition-default: is_night härleds ur night_time; ren VFR/IFR fyller hela totalen (Y/Z = manuell split).
  useEffect(() => {
    const tt = parseFloat(form.total_time) || 0;
    setForm((p) => {
      // Natt får ALDRIG överstiga total flygtid — klamp (t.ex. när ankomsttiden kortas).
      let night_time = p.night_time;
      const nt = parseFloat(p.night_time ?? '0') || 0;
      if (tt > 0 && nt > tt + 1e-6) night_time = String(tt);
      const isNight = (parseFloat(night_time ?? '0') || 0) > 0;
      let vfr = p.vfr, ifr = p.ifr;
      if (p.flight_rules === 'VFR') { vfr = tt ? String(tt) : ''; ifr = ''; }
      else if (p.flight_rules === 'IFR') { ifr = tt ? String(tt) : ''; vfr = ''; }
      if (p.is_night === isNight && p.vfr === vfr && p.ifr === ifr && p.night_time === night_time) return p;
      return { ...p, is_night: isNight, vfr, ifr, night_time };
    });
  }, [form.total_time, form.flight_rules, form.night_time]);

  // Siktläge (som VFR/IFR): ett rent läge fyller hela totalen; delad tid skalas med när totalen ändras.
  useEffect(() => {
    const tt = parseFloat(form.total_time) || 0;
    setForm((p) => {
      const cur: Record<DroneFlightMode, number> = { VLOS: parseFloat(p.h_vlos ?? '') || 0, EVLOS: parseFloat(p.h_evlos ?? '') || 0, BVLOS: parseFloat(p.h_bvlos ?? '') || 0 };
      const sum = cur.VLOS + cur.EVLOS + cur.BVLOS;
      const mixed = FLIGHT_MODES.filter((m) => cur[m] > 1e-6).length > 1;
      const mode = (p.flight_mode || 'VLOS') as DroneFlightMode;
      const k = sum > 0 ? tt / sum : 0;
      const next: Record<DroneFlightMode, number> = mixed
        ? { VLOS: cur.VLOS * k, EVLOS: cur.EVLOS * k, BVLOS: cur.BVLOS * k }
        : { VLOS: 0, EVLOS: 0, BVLOS: 0, [mode]: tt };
      const str = (n: number) => (n > 1e-6 ? n.toFixed(4) : '');
      const h_vlos = str(next.VLOS), h_evlos = str(next.EVLOS), h_bvlos = str(next.BVLOS);
      if ((p.h_vlos ?? '') === h_vlos && (p.h_evlos ?? '') === h_evlos && (p.h_bvlos ?? '') === h_bvlos) return p;
      return { ...p, h_vlos, h_evlos, h_bvlos };
    });
  }, [form.total_time, form.flight_mode]);


  useEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [isEdit]);

  useEffect(() => { loadAccent(); }, [loadAccent]);

  useEffect(() => {
    (async () => {
      const ds = await listDrones();
      setDrones(ds);
      getRecentDroneLocations(10).then(setRecentPlaces).catch(() => {});
      getRecentPlaces().then(setRecentAirports).catch(() => {});
      getRecentDroneCrew().then(setRecentCrew).catch(() => {});
      getDroneCrewByModel().then(setCrewByModel).catch(() => {});

      if (isEdit && editId) {
        const f = await getDroneFlightById(editId);
        if (!f) return;
        const crewLine = droneCrewLine(parseDroneCrew(f)); // raden som sparades sist i remarks
        // Äldre Observer-fält (egen ruta före Second pilot-rollerna, eller CSV-import) → besättning med rollen
        // Observer: tom second pilot-plats först, annars en extra rad. Namn som redan finns hoppas över.
        const legacyObs = (f.observer_name || f.remarks.match(/Observer:\s*([^\n]+)/i)?.[1]?.trim() || '')
          .split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
        let second = { name: f.second_pilot ?? '', role: f.second_pilot_role ?? '' };
        const extras = parseDroneExtraPilots(f.extra_pilots);
        const known = new Set(parseDroneCrew(f).map((p) => p.name.toLowerCase()));
        for (const name of legacyObs) {
          if (known.has(name.toLowerCase())) continue;
          known.add(name.toLowerCase());
          if (!second.name.trim()) second = { name, role: 'observer' };
          else extras.push({ role: 'observer', name });
        }
        setForm({
          date: f.date,
          drone_id: f.drone_id,
          drone_type: f.drone_type,
          registration: f.registration,
          location: f.location,
          lat: f.lat,
          lon: f.lon,
          takeoff_time: f.takeoff_time ?? '',
          landing_location: f.landing_location ?? '',
          landing_lat: f.landing_lat ?? 0,
          landing_lon: f.landing_lon ?? 0,
          mission_type: f.mission_type,
          category: f.category,
          flight_mode: f.flight_mode,
          total_time: String(f.total_time),
          max_altitude_m: String(f.max_altitude_m),
          is_night: !!f.is_night,
          // Observer härleds vid spar ur besättningen; laddas bara för en äldre Yes-flagga utan namn.
          has_observer: !!f.has_observer,
          observer_name: legacyObs.join(', '),
          wind_ms: f.wind_ms ? String(f.wind_ms) : '',
          operation_type: f.operation_type ?? '',
          landings_day: f.landings_day ? String(f.landings_day) : '',
          landings_night: f.landings_night ? String(f.landings_night) : '',
          co_pilot_fpv: f.co_pilot_fpv ? String(f.co_pilot_fpv) : '',
          dual: f.dual ? String(f.dual) : '',
          instructor: f.instructor ? String(f.instructor) : '',
          ifr: f.ifr ? String(f.ifr) : '',
          vfr: f.vfr ? String(f.vfr) : '',
          // Äldre flygningar (is_night utan night_time) → ladda baren som full natt.
          night_time: f.night_time ? String(f.night_time) : (f.is_night ? String(f.total_time) : ''),
          flight_rules: f.flight_rules ?? 'VFR',
          // Delad siktläges-tid (0 = rent läge → effekten fyller flight_mode med hela totalen).
          h_vlos: f.h_vlos ? String(f.h_vlos) : '',
          h_evlos: f.h_evlos ? String(f.h_evlos) : '',
          h_bvlos: f.h_bvlos ? String(f.h_bvlos) : '',
          second_pilot: second.name,
          second_pilot_role: second.role,
          // Besättningen visas i egna rutor, ej i remarks-rutan (läggs tillbaka vid spar).
          remarks: stripCrewRemarks(stripObserverRemarks(f.remarks), crewLine),
        });
        setExtraPilots(extras.map((p, i) => ({ id: `e${i}`, ...p })));
        if (f.photo_uri) { setPhotoUri(f.photo_uri); setMediaType(f.media_type === 'video' ? 'video' : 'image'); }
        // A → B när landningsplatsen är en annan än startplatsen; ankomsttiden = take-off + total.
        const ab = !!(f.landing_location ?? '').trim() && (f.landing_location ?? '').trim().toUpperCase() !== (f.location ?? '').trim().toUpperCase();
        setRouteMode(ab ? 'ab' : 'same');
        if (ab) setArrTime(addHHMM(f.takeoff_time ?? '', f.total_time));
        // Same spot: hela totalen som 1:a flygningens varaktighet (HH:MM; splitten okänd vid redigering).
        setFullLegs([f.total_time > 0 ? decimalToHHMM(f.total_time) : '']);
        setRole(droneRoleOf(f)); // sparad roll, annars härledd ur tidshinkarna (äldre flygningar)
        loadedCat.current = f.category ?? '';
        return;
      }

      // Utkast: formulärets sparade tillstånd tillbaka (ingen förifyllning från senaste flygningen).
      if (fromDraft) {
        const d = await loadFlightDraft('drone').catch(() => null);
        const st = d?.state as ReturnType<typeof draftSnapshot> | undefined;
        if (st) {
          if (st.form) setForm((p) => ({ ...p, ...st.form }));
          if (st.role) setRole(st.role);
          if (Array.isArray(st.extraPilots)) setExtraPilots(st.extraPilots);
          if (Array.isArray(st.fullLegs) && st.fullLegs.length) setFullLegs(st.fullLegs);
          setNightManual(!!st.nightManual);
          setLandingsManual(!!st.landingsManual);
          if (st.timeMode) setTimeMode(st.timeMode);
          if (st.condRaw) setCondRaw(st.condRaw);
          if (typeof st.logFull === 'boolean') setLogFull(st.logFull);
          // Äldre utkast saknar routeMode: en ifylld landningsplats betyder A → B.
          setRouteMode(st.routeMode ?? (st.form?.landing_location ? 'ab' : 'same'));
          if (st.arrTime) setArrTime(st.arrTime);
          if (st.photoUri) setPhotoUri(st.photoUri);
          if (st.mediaType) setMediaType(st.mediaType);
          return;
        }
      }

      const last = (await getDroneFlights(1))[0];
      if (last) {
        const lastDrone = ds.find((d) => d.id === last.drone_id);
        if (lastDrone) {
          await setDrone(lastDrone);
          setForm((p) => ({
            ...p,
            location: last.location ?? '',
            // Kopiera ÄVEN koordinaterna (review-fynd #3): annars sparas "samma plats
            // som förra" med namn men lat/lon 0,0 → tappas från kartan + natt-auto av.
            lat: last.lat || undefined,
            lon: last.lon || undefined,
            category: last.category || p.category,
            flight_mode: (last.flight_mode as DroneFlightMode) ?? p.flight_mode,
          }));
        }
      } else if (ds.length === 1) {
        await setDrone(ds[0]);
      }
    })();
  }, [isEdit, editId]);

  const setDrone = async (d: DroneRegistryEntry) => {
    setForm((p) => ({
      ...p,
      drone_id: d.id,
      drone_type: d.drone_type,
      registration: d.registration,
      // Kategorin följer drönarens klass automatiskt: dess sparade category, annars härledd ur EU C-märkningen
      // (c_class). Så slipper man ange kategori på nytt i Log Flight — den bestäms av vald drönare.
      category: d.category || categoryFromCClass(d.c_class || '') || p.category,
    }));
  };

  // Media (bild/video) ur biblioteket — = pilotläget. Video ≤ 50 MB.
  const pickMedia = async (type: 'image' | 'video') => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: type === 'video' ? ['videos'] : ['images'], quality: 1 });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if (type === 'video') {
        try {
          const info = await FileSystem.getInfoAsync(asset.uri);
          const mb = (info.exists ? info.size : 0) / (1024 * 1024);
          if (mb > 50) { Alert.alert('Video too large', `Maximum file size is 50 MB (your video is ${mb.toFixed(1)} MB).`); return; }
        } catch { /* storlekskoll ej kritisk */ }
      }
      setMediaType(type);
      setPhotoUri(asset.uri);
    } catch (e: any) { Alert.alert('Could not add media', e?.message || 'Try again.'); }
  };

  // ?addPhoto=1 (från dashboardens "Add media") → öppna bildväljaren automatiskt.
  useEffect(() => {
    if (params.addPhoto === '1') { const t = setTimeout(() => pickMedia('image'), 450); return () => clearTimeout(t); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Instrument scan: skärmdump/foto av drönarappens flyglogg (DJI Fly, DJI GO 4, Autel …) ─────────────
  // Flödet: välj bild → AI läser alla rader → datumväljare (senaste förvalt) → dagens flygningar fylls i som
  // 1st/2nd/3rd flight → Save → frågan om fler flygningar ur bilden (näst senaste förvalt) … tills klart.
  const chooseScanSource = (src: 'camera' | 'library' | null) => {
    setScanChooserOpen(false);
    const r = scanResolveRef.current; scanResolveRef.current = null;
    // iOS: vänta tills modalen stängts innan kamera/bibliotek presenteras (annars dyker väljaren aldrig upp).
    setTimeout(() => r?.(src), CHOOSER_CLOSE_MS);
  };

  const startLogScan = async () => {
    // Token-styrt (som pilotens flight scan): fri nivå tills engångspotten är slut → Premium-erbjudande.
    if (!hasTokenQuota()) {
      if (isPremium || isMax) showMonthlyTokenLimitAlert(); else presentPaywall('Flight log scan');
      return;
    }
    if (!(await askAiConsent())) return; // AI-samtycke innan källväljaren/kameran öppnas
    const source = await new Promise<'camera' | 'library' | null>((resolve) => {
      scanResolveRef.current = resolve;
      setScanChooserOpen(true);
    });
    if (!source) return;
    const uri = await pickScanImage(source, DENIED_TEXT);
    if (uri) await readLogImage(uri);
  };

  // Bilden är vald (här, eller på dashboarden/i Settings innan Log Flight öppnades): AI läser alla rader.
  const readLogImage = async (uri: string) => {
    setScanLoading(true);
    try {
      const [res, existing] = await Promise.all([
        scanDroneFlightLog(uri),
        getDroneFlights(100000).catch(() => []),
      ]);
      if (!res.days.length) {
        Alert.alert('No flights found', 'No flights could be read from the image. Try a sharper screenshot of the flight list.');
        return;
      }
      setLoggedDates(new Set(existing.map((f) => f.date)));
      setScanDays(res.days);
      setScanPicker({ selected: res.days[0].date, afterSave: false });
    } catch (e: any) {
      if (isAiConsentError(e)) return; // användaren valde "Not now" — inget fel att visa
      if (isTokenQuotaError(e)) { if (isPremium || isMax) showMonthlyTokenLimitAlert(); else presentPaywall('Flight log scan'); }
      else Alert.alert('Scan failed', e?.message ?? 'Try again.');
    } finally {
      setScanLoading(false);
    }
  };

  // Fyll formuläret med en skannad dag: datum, flygtider (1st/2nd/3rd flight), dagens högsta höjd, plats och
  // ev. starttid/drönarmodell om de syns. Övriga per-flygning-fält nollställs (som "nästa flygning i passet").
  const applyScanDay = (date: string) => {
    const day = scanDays.find((d) => d.date === date);
    setScanPicker(null);
    if (!day) return;
    const legs = day.flights.map((f) => decimalToHHMM(Math.max(1, Math.round(f.minutes)) / 60));
    const maxAltM = Math.max(0, ...day.flights.map((f) => f.altitude_m));
    const firstTime = day.flights.find((f) => f.takeoff_time)?.takeoff_time ?? '';
    const place = day.flights.find((f) => f.location)?.location ?? '';
    const model = day.flights.find((f) => f.aircraft)?.aircraft.toLowerCase() ?? '';
    const match = model ? drones.find((d) => { const m = (d.model || '').toLowerCase(); return !!m && (m.includes(model) || model.includes(m)); }) : undefined;
    if (match) setDrone(match);
    setFullLegs(legs.length ? legs : ['']);
    setRouteMode('same'); setArrTime(''); setLandingsManual(false); setNightManual(false);
    setDepLocalBuf(''); setCondRaw({});
    setPhotoUri(null); setMediaType('image');
    setTimeMode('utc');
    setForm((p) => ({
      ...p,
      date,
      takeoff_time: firstTime ? localToUtc(date, firstTime) : '', // appens tider syns lokalt → lagras som UTC
      max_altitude_m: maxAltM > 0 ? String(maxAltM) : '',
      // Plats ur bilden ersätter förra flygningens plats (koordinater slås upp nedan).
      ...(place ? { location: place, lat: undefined, lon: undefined } : {}),
      night_time: '', vfr: '',
      h_vlos: '', h_evlos: '', h_bvlos: '',
      remarks: '',
    }));
    setScanActiveDate(date);
    // Koordinater för platsnamnet (Apples geokodare, ingen behörighet) → flygningen syns på drönarglobens karta.
    if (place) {
      Location.geocodeAsync(place)
        .then(([hit]) => { if (hit) setForm((p) => (p.location === place ? { ...p, lat: hit.latitude, lon: hit.longitude } : p)); })
        .catch(() => {});
    }
  };

  // Datumväljaren stängs: före första loggningen = avbryt skanningen; efter en Save = klar → tillbaka
  // (efter att modalen tonat ut — en Modal som stängs mitt i en navigering kan hänga sig på iOS).
  const closeScanPicker = () => {
    const after = scanPicker?.afterSave;
    setScanPicker(null);
    setScanDays([]);
    if (after) setTimeout(() => router.back(), 250);
  };
  // "Tue, Dec 31, 2024" / kort "Dec 31, 2024" (knappen).
  const fmtScanDate = (iso: string, short = false) => (/^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? new Date(`${iso}T12:00:00`).toLocaleDateString(lang === 'sv' ? 'sv-SE' : 'en-US',
      short ? { day: 'numeric', month: 'short', year: 'numeric' } : { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
    : iso);

  // Bilden valdes på dashboarden eller i Settings (useDroneScanStart): läs den när skärmen kommit upp.
  useEffect(() => {
    if (!params.scanImage || isEdit) return;
    const t = setTimeout(() => readLogImage(params.scanImage!), 400);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Flygningarna matas som varaktighet (HH:MM) i fullLegs; totalen = summan. fullLegs[0] är
  // 1:a flygningen ("Flight time"); addLeg lägger till en extra flygning (redigerbar/ta bort).
  const addLeg = () => setFullLegs((ls) => [...ls, '']);
  const updateLeg = (i: number, raw: string) => {
    const d = raw.replace(/\D/g, '').slice(0, 4);
    let hhmm: string;
    if (d.length === 0) hhmm = '';
    else if (d.length <= 2) hhmm = d; // bara minuter tills timmar skrivs
    else { const mm = Math.min(59, parseInt(d.slice(-2), 10) || 0); hhmm = `${d.slice(0, -2)}:${String(mm).padStart(2, '0')}`; }
    setFullLegs((ls) => ls.map((v, k) => (k === i ? hhmm : v)));
  };
  const removeLeg = (i: number) => setFullLegs((ls) => ls.filter((_, k) => k !== i));

  // sameSession = spara och logga nästa flygning i samma pass: behåll drönare/plats/
  // uppdrag/kategori/läge, nollställ tid, stanna kvar.
  // Gratisgräns: nådd redan vid öppning av en NY drönarflygning → visa Premium-uppmaning direkt.
  useEffect(() => {
    // (Inte under rundturen — loggningsdemon sparar bara en tillfällig exempel-flygning.)
    if (!isEdit && !isPremium && !isMax && !useTourStore.getState().active) {
      getDroneFlightCount().then((n) => {
        if (n >= FREE_TIER_LIMIT_DRONE) { setLimitBlockedOnEntry(true); setShowLimitModal(true); }
      }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // demo = rundturens loggningsdemon: sparar tyst (ingen gräns-popup, ingen navigering) och returnerar id:t.
  // ── Utkast ("Save as draft") ─────────────────────────────────────────────
  // Formulärets tillstånd sparas som utkast (services/flightDrafts) och läses tillbaka när man fortsätter från
  // dashboarden: formuläret, roll, besättning, flygpassen, villkorens råvärden, media och manuella lägen.
  const draftSnapshot = () => ({
    form, role, extraPilots, fullLegs, nightManual, landingsManual, timeMode, condRaw, logFull, routeMode, arrTime, photoUri, mediaType,
  });
  const saveAsDraft = async () => {
    const drone = drones.find((d) => d.id === form.drone_id);
    const labels = draftLabels({ from: form.location, to: form.landing_location || form.location, date: form.date,
      aircraft: drone ? [drone.model, drone.registration].filter(Boolean).join(' ') : '' });
    const write = async () => {
      try {
        await saveFlightDraft('drone', { savedAt: new Date().toISOString(), ...labels, state: draftSnapshot() });
        router.back();
      } catch (e: any) {
        Alert.alert(t('error'), e?.message ?? 'Could not save the draft.');
      }
    };
    // Ett utkast per läge: finns redan ett annat (inte det man fortsätter på) frågar appen först.
    const existing = fromDraft ? null : await loadFlightDraft('drone');
    if (existing) {
      Alert.alert('Replace your draft?', `You already have an unfinished draft (${existing.title}). Saving this one replaces it.`, [
        { text: t('cancel'), style: 'cancel' },
        { text: 'Replace', style: 'destructive', onPress: () => { write(); } },
      ]);
      return;
    }
    await write();
  };

  const save = async (sameSession = false, demo = false) => {
    // Gratisgräns för manuellt loggade drönarflygningar (ny, ej redigering). Kollas mot DB varje spar
    // så även "same session"-flödet stoppas vid gränsen.
    if (!isEdit && !isPremium && !isMax && !demo) {
      const n = await getDroneFlightCount().catch(() => 0);
      if (n >= FREE_TIER_LIMIT_DRONE) { setShowLimitModal(true); return; }
    }
    if (!form.drone_id) { if (!demo) Alert.alert(t('error'), t('drone_pick_required')); return; }
    if ((parseFloat(form.total_time) || 0) <= 0) { if (!demo) Alert.alert(t('error'), t('time_required')); return; }
    // Annan kategori än drönarens: fråga om drönaren ska få den (flygningen sparas med den oavsett).
    const drone0 = drones.find((d) => d.id === form.drone_id);
    const droneCat0 = drone0 ? (drone0.category || categoryFromCClass(drone0.c_class || '')) : '';
    if (!demo && drone0 && form.category && form.category !== droneCat0 && form.category !== loadedCat.current
      && !catAsked.current.has(`${drone0.id}:${form.category}`)) {
      const answer = await new Promise<'drone' | 'flight' | null>((resolve) => {
        catAskResolve.current = resolve;
        setCatAsk({ drone: drone0.model || drone0.registration || 'the drone', from: droneCat0, to: form.category });
      });
      if (!answer) return;
      catAsked.current.add(`${drone0.id}:${form.category}`);
      if (answer === 'drone') {
        await updateDrone(drone0.id, { drone_type: drone0.drone_type, model: drone0.model, registration: drone0.registration, mtow_g: drone0.mtow_g,
          category: form.category, drone_class: drone0.drone_class, notes: drone0.notes });
        listDrones().then(setDrones).catch(() => {});
      }
    }
    setSaving(true);
    // Observer läggs in i remarks som "Observer: xxxx" (loggbokens Remarks-kolumn).
    const hv = parseFloat(form.h_vlos ?? '') || 0, he = parseFloat(form.h_evlos ?? '') || 0, hb = parseFloat(form.h_bvlos ?? '') || 0;
    const modeMixed = [hv, he, hb].filter((h) => h > 1e-6).length > 1;
    const modeSplit = modeMixed
      ? { h_vlos: String(hv), h_evlos: String(he), h_bvlos: String(hb) }
      : { h_vlos: '0', h_evlos: '0', h_bvlos: '0' }; // rent läge → flight_mode × total (stats/loggbok)
    // Besättning: second pilot i egna kolumner, fler som JSON; namnen hamnar även som en rad sist i remarks.
    const secondName = (form.second_pilot ?? '').trim();
    const extraClean = extraPilots.filter((p) => p.role || p.name.trim()).map((p) => ({ role: p.role, name: p.name.trim() }));
    const crew = [{ role: form.second_pilot_role ?? '', name: secondName }, ...extraClean];
    const crewLine = droneCrewLine(crew);
    // Observer = besättning med rollen Observer (egen ruta finns inte längre) → has_observer/observer_name
    // för export, statistik och import. En äldre Yes-flagga utan namn (CSV-import) behålls.
    const observers = crew.filter((p) => p.role === 'observer' && p.name).map((p) => p.name);
    const legacyObsFlag = !!form.has_observer && !(form.observer_name ?? '').trim();
    const dataToSave = {
      ...form, ...modeSplit,
      // Same spot: landningsplatsen = startplatsen (inget eget fält).
      ...(routeMode === 'same' ? { landing_location: '', landing_lat: 0, landing_lon: 0 } : {}),
      pilot_role: role,
      second_pilot: secondName,
      second_pilot_role: secondName ? (form.second_pilot_role ?? '') : '',
      extra_pilots: extraClean.length ? JSON.stringify(extraClean) : '',
      has_observer: observers.length > 0 || legacyObsFlag,
      observer_name: observers.join(', '),
      remarks: mergeCrewRemarks(form.remarks, crewLine),
    };
    // Media: kopiera temp-uri till app-katalogen så den överlever (= pilotläget).
    let savedPhotoUri = '';
    if (photoUri) {
      savedPhotoUri = photoUri;
      if (!photoUri.startsWith(FileSystem.documentDirectory ?? '___')) {
        try {
          const folder = `${FileSystem.documentDirectory}${mediaType === 'video' ? 'drone_videos' : 'drone_photos'}/`;
          await FileSystem.makeDirectoryAsync(folder, { intermediates: true }).catch(() => {});
          const ext = photoUri.split('.').pop() || (mediaType === 'video' ? 'mp4' : 'jpg');
          const dest = `${folder}${Date.now()}.${ext}`;
          await FileSystem.copyAsync({ from: photoUri, to: dest });
          savedPhotoUri = dest;
        } catch { savedPhotoUri = photoUri; }
      }
    }
    try {
      let flightId: number;
      if (isEdit && editId) { await updateDroneFlight(editId, dataToSave); flightId = editId; }
      else {
        flightId = await insertDroneFlight(dataToSave);
        // Flygningen kom från ett utkast → utkastet är klart och tas bort.
        if (fromDraft) clearFlightDraft('drone').catch(() => {});
      }
      // Spara/uppdatera media på flygningen (rör inte ev. synkad photo_local_id).
      await setDroneFlightPhoto(flightId, savedPhotoUri, mediaType);
      await Promise.all([loadFlights(), loadStats()]);
      if (demo) return flightId;

      // Instrument scan: dagen är loggad → fråga om fler flygningar ur bilden (näst senaste förvald),
      // eller tillbaka när alla dagar är loggade.
      if (scanActiveDate && !isEdit) {
        const done = scanActiveDate;
        const remaining = scanDays.filter((d) => d.date !== done);
        setScanDays(remaining);
        setScanActiveDate(null);
        setLoggedDates((prev) => new Set(prev).add(done));
        if (remaining.length) { setScanPicker({ selected: remaining[0].date, afterSave: true, loggedDate: done }); return; }
        useToastStore.getState().show('All flights from the image are logged');
        router.back();
        return;
      }

      if (sameSession && !isEdit) {
        setFullLegs(['']); // route-heron: rensa flygtider → nästa flygning i passet börjar tomt
        setArrTime(''); setArrLocalBuf(''); setDepLocalBuf(''); setCondRaw({});
        setPhotoUri(null); setMediaType('image'); // ny flygning i passet → rensa media
        setForm((p) => ({
          ...p,
          takeoff_time: nowHHMM(),
          total_time: '0',
          max_altitude_m: '',
          night_time: '', vfr: '', // ny flygning i passet → nollställ kondition-tider
          h_vlos: '', h_evlos: '', h_bvlos: '', // siktläge: tillbaka till rent läge (samma som förra)
          remarks: '',
        }));
        useToastStore.getState().show('Flight saved — logging next in session');
        return;
      }
      router.back();
    } catch (e: any) {
      if (!demo) Alert.alert(t('error'), e.message);
    } finally {
      setSaving(false);
    }
  };

  const selectedDrone = drones.find((d) => d.id === form.drone_id);

  // Drönar-box: distinkta modeller + registreringar för vald modell (som pilotens typ→reg).
  const droneModels = [...new Set(drones.map((d) => d.model).filter(Boolean))];
  const curModel = selectedDrone?.model ?? pendingModel ?? '';
  const regsForModel = drones.filter((d) => d.model === curModel).map((d) => d.registration).filter(Boolean);

  const selectModel = async (m: string) => {
    setTypeOpen(false);
    const matches = drones.filter((d) => d.model === m);
    // Registreringen är kopplad till modellen → byt till den nya modellens drönare (reg följer med via
    // setDrone). Saknar modellen registrering: töm reg + drone_id så den FÖRRA modellens reg inte ligger kvar.
    if (matches.length >= 1) { setPendingModel(null); await setDrone(matches[0]); }
    else { setPendingModel(m); setForm((p) => ({ ...p, drone_id: null, registration: '' })); }
  };
  const selectReg = async (rg: string) => {
    setRegOpen(false);
    const entry = drones.find((d) => d.model === curModel && d.registration === rg);
    if (entry) { setPendingModel(null); await setDrone(entry); }
  };
  // ── Pilot function + besättning (= pilotläget). Bara EN pilot in command (PIC/RPIC): väljer du PIC/RPIC
  // blir en medpilot-PIC SIC, och får en medpilot PIC/RPIC blir du (om PIC/RPIC) SIC.
  const selectRole = (r: DroneRole) => {
    setRole(r);
    if (!isDronePicRole(r)) return;
    setForm((p) => (isDronePicRole(p.second_pilot_role) ? { ...p, second_pilot_role: 'sic' } : p));
    setExtraPilots((prev) => prev.map((x) => (isDronePicRole(x.role) ? { ...x, role: 'sic' } : x)));
  };
  const selectSecondPilotRole = (key: string) => {
    setForm((p) => ({ ...p, second_pilot_role: key }));
    if (!isDronePicRole(key)) return;
    setRole((r) => (isDronePicRole(r) ? 'sic' : r));
    setExtraPilots((prev) => prev.map((x) => (isDronePicRole(x.role) ? { ...x, role: 'sic' } : x)));
  };
  const selectExtraPilotRole = (id: string, key: string) => {
    const pic = isDronePicRole(key);
    setExtraPilots((prev) => prev.map((x) => (x.id === id ? { ...x, role: key } : pic && isDronePicRole(x.role) ? { ...x, role: 'sic' } : x)));
    if (!pic) return;
    setRole((r) => (isDronePicRole(r) ? 'sic' : r));
    setForm((p) => (isDronePicRole(p.second_pilot_role) ? { ...p, second_pilot_role: 'sic' } : p));
  };
  const addExtraPilot = () => setExtraPilots((prev) => [...prev, { id: String(Date.now()), role: '', name: '' }]);
  const removeExtraPilot = (id: string) => setExtraPilots((prev) => prev.filter((p) => p.id !== id));
  const setExtraPilotName = (id: string, name: string) => setExtraPilots((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
  // "+" i namn-rutan → skriv in ett nytt namn (blir valt; sparas i historiken när flygningen loggas).
  const promptAddPersonName = (title: string, onName: (n: string) => void) => setAddPilot({ visible: true, title, cb: onName });

  // "Other"-rutan under DUAL/INSTRUCTOR + dropdownflik (= pilotläget). Knappen visar vald roll.
  const renderOtherBox = () => {
    const special = (DRONE_OTHER_ROLES as string[]).includes(role);
    const ddRow = (key: string, label: string, on: boolean, onPress: () => void, danger?: boolean) => (
      <TouchableOpacity key={key} onPress={onPress} activeOpacity={0.7} style={[styles.ddRow, on && { backgroundColor: accent + '18' }]}>
        <Ionicons name={danger ? 'close-circle-outline' : on ? 'radio-button-on' : 'radio-button-off'} size={15} color={danger ? DR.danger : on ? accent : DR.muted} />
        <Text style={[styles.ddRowText, { color: danger ? DR.danger : on ? accent : DR.text }]}>{label}</Text>
      </TouchableOpacity>
    );
    return (
      <View style={{ flex: 1, position: 'relative', zIndex: otherOpen ? 40 : undefined }}>
        <TouchableOpacity style={[styles.roleBtn, special && styles.roleBtnActive]} onPress={() => setOtherOpen((o) => !o)} activeOpacity={0.75}>
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.roleBtnText, special && styles.roleBtnTextActive]}>
            {special ? DRONE_ROLE_LABEL[role].toUpperCase() : 'OTHER'}
          </Text>
        </TouchableOpacity>
        {otherOpen && (
          <View style={[styles.ddFlyout, { right: 0, width: 220 }]}>
            {DRONE_OTHER_ROLES.map((r) => ddRow(r, DRONE_ROLE_LABEL[r], role === r, () => { selectRole(r); setOtherOpen(false); }))}
            {special && ddRow('reset', t('reset_special_role'), false, () => { selectRole('pic'); setOtherOpen(false); }, true)}
          </View>
        )}
      </View>
    );
  };

  // Z/L-växling: fyll lokalbufferten ur UTC vid byte till local.
  const toggleTimeMode = () => {
    setTimeMode((m) => {
      if (m === 'local') return 'utc';
      setDepLocalBuf(utcToLocal(form.date, form.takeoff_time ?? ''));
      setArrLocalBuf(utcToLocal(form.date, arrTime));
      return 'local';
    });
  };
  const onArrLocalChange = (v: string) => {
    setArrLocalBuf(v);
    setArrTime(isValidTime(v) ? localToUtc(form.date, v) : '');
  };

  // Same spot ↔ A → B. Till A → B: ankomsttiden förifylls ur take-off + flygtiden. Tillbaka: flygtiden
  // blir 1:a flygningen om inga flygningar finns.
  const switchRouteMode = (m: 'same' | 'ab') => {
    if (m === routeMode) return;
    if (m === 'ab' && !isValidTime(arrTime) && derivedArr) setArrTime(derivedArr);
    if (m === 'same' && fullTotalDecimal <= 0 && abTotal > 0) setFullLegs([decimalToHHMM(abTotal)]);
    setRouteMode(m);
  };

  // Platsens koordinater: GPS-knappen (enhetens position + ortnamn om rutan är tom) eller Apples
  // geokodare för ett skrivet/valt namn (ingen behörighet). Behövs för natt, landningar, distans och Sun route.
  const fetchMyPosition = async (which: 'dep' | 'arr') => {
    setPlaceBusy(which);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { Alert.alert(t('permission_required'), 'Location permission is needed to use your position.'); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const lat = pos.coords.latitude, lon = pos.coords.longitude;
      let name = '';
      try {
        const [g] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
        name = (g?.city || g?.district || g?.subregion || g?.name || '').toUpperCase();
      } catch { /* namnet är valfritt */ }
      setForm((p) => (which === 'dep'
        ? { ...p, lat, lon, location: p.location.trim() ? p.location : name }
        : { ...p, landing_lat: lat, landing_lon: lon, landing_location: (p.landing_location ?? '').trim() ? p.landing_location : name }));
    } catch (e: any) {
      Alert.alert(t('error'), e?.message ?? String(e));
    } finally {
      setPlaceBusy(null);
    }
  };
  const geocodePlace = (which: 'dep' | 'arr', name: string) => {
    const q = name.trim();
    if (!q) return;
    Location.geocodeAsync(q).then(([hit]) => {
      if (!hit) return;
      setForm((p) => (which === 'dep'
        ? (p.location === name ? { ...p, lat: hit.latitude, lon: hit.longitude } : p)
        : (p.landing_location === name ? { ...p, landing_lat: hit.latitude, landing_lon: hit.longitude } : p)));
    }).catch(() => {});
  };
  const onDepLocalChange = (v: string) => {
    setDepLocalBuf(v);
    setForm((p) => ({ ...p, takeoff_time: isValidTime(v) ? localToUtc(form.date, v) : '' }));
  };

  // Lägg registrering under Registration-fältet: sätt basentryts reg om tom, annars ny kopia med specarna.
  const applyReg = async () => {
    const rg = regInput.trim().toUpperCase();
    setShowRegInput(false);
    setRegInput('');
    if (!rg || !curModel) return;
    // Finns registreringen redan för modellen → välj den (ingen dubblett/unik-krock).
    const existing = drones.find((d) => d.model === curModel && d.registration === rg);
    if (existing) { setPendingModel(null); await setDrone(existing); return; }
    const base = selectedDrone ?? drones.find((d) => d.model === curModel);
    if (!base) return;
    const spec = { drone_type: base.drone_type, model: base.model, mtow_g: base.mtow_g, category: base.category, drone_class: base.drone_class, notes: base.notes };
    if (!((base.registration ?? '').trim())) {
      await updateDrone(base.id, { ...spec, registration: rg });
    } else if (!drones.some((d) => d.model === curModel && d.registration === rg)) {
      await addDrone({ ...spec, registration: rg });
    }
    const ds = await listDrones();
    setDrones(ds);
    setPendingModel(null);
    const entry = ds.find((d) => d.model === curModel && d.registration === rg);
    if (entry) await setDrone(entry);
  };

  const onDroneModalSave = async (data: Omit<DroneRegistryEntry, 'id'>) => {
    const id = await addDrone(data);
    const ds = await listDrones();
    setDrones(ds);
    setShowDroneModal(false);
    setPendingModel(null);
    const entry = ds.find((d) => d.id === id);
    if (entry) await setDrone(entry);
    // Auto-hämta fleet-data (bild + specar + c_class) direkt för den nya modellen (token-styrt), sedan
    // uppdatera valet så kategorin ev. härleds ur hämtad c_class. CSV-import påverkas inte.
    if (data.model && isEssential()) {
      rememberSkippedDrones([data.model]).catch(() => {}); // Essential visar ingen Fleet: hämtas vid byte till Extensive
    } else if (data.model && hasTokenQuota()) {
      enrichDroneFleet(data.model, { background: true })
        .then((r) => persistDroneModelLookup(data.model, {
          manufacturer: r.manufacturer, drone_type: r.drone_type, mtow_g: r.mtow_g, c_class: r.c_class,
          max_flight_min: r.max_flight_min, max_speed_kmh: r.max_speed_kmh, ceiling_m: r.ceiling_m, range_km: r.range_km,
          ...(r.image_url ? { image_url: r.image_url, image_credit: r.image_credit, cutout_url: '' } : {}),
        }))
        .then(async () => { const ds2 = await listDrones(); setDrones(ds2); const e2 = ds2.find((d) => d.id === id); if (e2) await setDrone(e2); })
        .catch(() => {});
    }
  };

  // ── Blades introduction: loggningsdemon ───────────────────────────────────
  // TourHost ökar logDemoRun → formuläret fyller själv i ett komplett pass (två flygningar) fält för fält,
  // med fokusram + bildtext i rundturens smala rad, och sparar det på riktigt så loggboken kan öppna det.
  // Egen drönare/besättning/plats används om de finns; annars läggs en exempeldrönare till tillfälligt.
  demoLatest.current = { save, role, total: parseFloat(form.total_time) || 0 };
  useEffect(() => {
    if (!logDemoRun || isEdit || logDemoRun === demoRunAtMount.current) return;
    const st0 = useTourStore.getState();
    if (!st0.active || !TOURS[st0.mode][st0.stepIndex]?.logDemo) return;
    let dead = false;
    const tour = useTourStore.getState;
    const alive = () => {
      const st = tour();
      return !dead && st.active && st.logDemoRun === logDemoRun && !!TOURS[st.mode][st.stepIndex]?.logDemo;
    };
    const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const PHASES = 11;
    const say = (n: number, caption: string) => tour().setCaption(caption, n / (PHASES + 1));
    const focus = (id: string | null) => tour().setPressTarget(id);
    const scrollTo = (y: number | undefined, above: number) => {
      if (y == null) return;
      const { contentH, viewH } = scrollMetrics.current;
      const max = contentH > 0 && viewH > 0 ? Math.max(0, contentH - viewH) : Number.MAX_SAFE_INTEGER;
      scrollRef.current?.scrollTo({ y: Math.min(max, Math.max(0, y - above)), animated: true });
    };
    const typeSeq = async (parts: string[], put: (v: string) => void, ms: number) => {
      for (let i = 0; i < parts.length; i++) {
        if (!alive()) return false;
        put(parts[i]);
        await wait(ms + ((i * 7) % 3) * 22);
      }
      return alive();
    };
    const chars = (text: string) => Array.from({ length: text.length }, (_, i) => text.slice(0, i + 1));
    const clock = (t: string) => { const d = t.replace(':', ''); return [d.slice(0, 1), d.slice(0, 2), `${d.slice(0, 2)}:${d.slice(2, 3)}`, t]; };
    const legKeys = (min: number) => { const d = `${Math.floor(min / 60)}${String(min % 60).padStart(2, '0')}`; return chars(d); }; // "025" → 0 · 02 · 0:25

    (async () => {
      try {
        // ── Data: egen drönare/besättning/plats om de finns, annars exempel ──
        const [ds, recent, crew] = await Promise.all([
          listDrones().catch(() => [] as DroneRegistryEntry[]),
          getDroneFlights(10).catch(() => []),
          getRecentDroneCrew().catch(() => [] as { name: string; role: string }[]),
        ]);
        const last = recent.find((f) => !(f.remarks || '').includes(TOUR_REMARK)) ?? null;
        let entry: DroneRegistryEntry | null = (last && ds.find((d) => d.id === last.drone_id)) || ds.find((d) => d.registration) || ds[0] || null;
        if (!entry) {
          const id = await addDrone(TOUR_DRONE);
          await rememberTourDemo({ kind: 'drone', droneId: id }); // raderas med flygningen (även efter krasch)
          const fresh = await listDrones().catch(() => [] as DroneRegistryEntry[]);
          setDrones(fresh);
          entry = fresh.find((d) => d.id === id) ?? null;
        }
        const mission = (last?.mission_type || '').trim() || 'Inspection';
        const place = (last?.location || '').trim() || 'Stockholm';
        const op = last?.operation_type === 'PRI' ? 'PRI' : 'COM';
        const myRole = demoLatest.current!.role;
        let mate = crew[0] ?? TOUR_CREW;
        // Bara en pilot in command: är du PIC/RPIC och sparad roll också PIC → visa som observatör.
        if (!mate.role || (isDronePicRole(mate.role) && isDronePicRole(myRole))) mate = { ...mate, role: 'observer' };
        const legs = [25, 18];
        const totalMin = legs[0] + legs[1] + 12; // två flygningar + batteribyte
        const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
        const depMin = isValidTime(last?.takeoff_time ?? '') ? toMin(last!.takeoff_time!) : 10 * 60 + 30;
        const now = new Date();
        let depAt = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + depMin * 60000;
        if (depAt + (totalMin + 10) * 60000 > now.getTime()) depAt -= 86400000; // aldrig framtida tider
        const date = new Date(depAt).toISOString().slice(0, 10);
        const takeoff = `${String(Math.floor(depMin / 60)).padStart(2, '0')}:${String(depMin % 60).padStart(2, '0')}`;
        const altVal = altUnit === 'ft' ? 360 : 110; // under 120 m-gränsen för Open
        if (!alive()) return;

        // ── Rent formulär ──
        setTimeMode('utc'); setDepLocalBuf(''); setFullLegs(['']); setExtraPilots([]); setCondRaw({});
        setShowMissionPicker(false); setPendingModel(null);
        setLogFull(true); setRouteMode('same'); setArrTime(''); setCondOpen(false); setCatOpen(false);
        setLandingsManual(false); setNightManual(false);
        setForm((p) => ({
          ...p, date, mission_type: '', location: '', lat: undefined, lon: undefined, takeoff_time: '',
          drone_id: null, drone_type: undefined, registration: '', category: '',
          flight_mode: 'VLOS', h_vlos: '', h_evlos: '', h_bvlos: '', night_time: '', is_night: false,
          second_pilot: '', second_pilot_role: '', operation_type: '', landings_day: '', landings_night: '',
          max_altitude_m: '', remarks: '',
        }));
        scrollRef.current?.scrollTo({ y: 0, animated: true });
        await wait(700); if (!alive()) return;

        // 1 · Plats + starttid.
        say(1, 'Location and take-off time');
        scrollTo(demoY.current.route, 10);
        focus('ld-route');
        await wait(500);
        if (!(await typeSeq(chars(place), (v) => setForm((p) => ({ ...p, location: v })), 85))) return;
        await wait(350); if (!alive()) return;
        if (!(await typeSeq(clock(takeoff), (v) => setForm((p) => ({ ...p, takeoff_time: v })), 135))) return;
        await wait(450); if (!alive()) return;

        // 2 · Första flygningen.
        say(2, 'Flight time — the first flight of the session');
        if (!(await typeSeq(legKeys(legs[0]), (v) => updateLeg(0, v), 150))) return;
        await wait(800); if (!alive()) return;

        // 3 · Andra flygningen i samma pass (ett tryck).
        say(3, 'A second flight — same session, one tap');
        focus('ld-addleg');
        await wait(850); if (!alive()) return;
        addLeg();
        await wait(350); if (!alive()) return;
        focus('ld-leg2');
        if (!(await typeSeq(legKeys(legs[1]), (v) => updateLeg(1, v), 150))) return;
        await wait(1000); if (!alive()) return;

        // 5 · Siktläge: barerna växer fram (plats + tid + flygtid finns) → BVLOS dras upp till 70 %, VLOS
        // får resten; växlaren följer det dominerande läget (BVLOS).
        const bvPct = Math.round(TOUR_BVLOS_SHARE * 100);
        say(4, `Sight mode — ${100 - bvPct}% VLOS, ${bvPct}% BVLOS, split with the bars`);
        setCondOpen(true);
        scrollTo(demoY.current.mode, 150);
        focus('ld-mode');
        await wait(900); if (!alive()) return;
        for (let k = 1; k <= 7; k++) {
          if (!alive()) return;
          const tot = demoLatest.current!.total;
          const b = tot * TOUR_BVLOS_SHARE * (k / 7);
          const str = (n: number) => (n > 1e-6 ? n.toFixed(4) : '');
          setForm((p) => ({ ...p, flight_mode: b > tot / 2 ? 'BVLOS' : 'VLOS', h_vlos: str(tot - b), h_evlos: '', h_bvlos: str(b) }));
          await wait(115);
        }
        await wait(1500); if (!alive()) return;

        // 5 · Drönare. Kategorin följer annars drönarens klass, men BVLOS-flygningen är i Specific.
        say(5, 'Drone — model and registration');
        scrollTo(demoY.current.frame, 120);
        focus('ld-drone');
        await wait(700); if (!alive()) return;
        if (entry) await setDrone(entry);
        setForm((p) => ({ ...p, category: 'Specific' }));
        await wait(1000); if (!alive()) return;

        // 6 · Uppdrag.
        say(6, 'Mission — what the flight was for');
        scrollTo((demoY.current.frame ?? 0) + (demoY.current.missionIn ?? 0), 150);
        focus('ld-mission');
        await wait(500);
        if (!(await typeSeq(chars(mission), (v) => setForm((p) => ({ ...p, mission_type: v })), 70))) return;
        await wait(600); if (!alive()) return;

        // 7 · Pilot function.
        say(7, `Pilot function — ${DRONE_ROLE_LABEL[myRole] ?? 'PIC'}`);
        scrollTo((demoY.current.frame ?? 0) + (demoY.current.roleIn ?? 0), 150);
        focus('ld-role');
        await wait(650); if (!alive()) return;
        selectRole(myRole);
        await wait(950); if (!alive()) return;

        // 8 · Besättning (namn + roll, t.ex. observatör).
        say(8, `Crew — who you flew with, as ${DRONE_ROLE_LABEL[mate.role as DroneRole] ?? 'crew'}`);
        scrollTo((demoY.current.frame ?? 0) + (demoY.current.crewIn ?? 0), 170);
        focus('ld-crew');
        await wait(650); if (!alive()) return;
        setForm((p) => ({ ...p, second_pilot: mate.name }));
        await wait(500); if (!alive()) return;
        selectSecondPilotRole(mate.role);
        await wait(1000); if (!alive()) return;

        // 9 · Operation.
        say(9, `Operation — ${op === 'COM' ? 'commercial' : 'private'}`);
        scrollTo((demoY.current.frame ?? 0) + (demoY.current.opIn ?? 0), 200);
        focus('ld-op');
        await wait(650); if (!alive()) return;
        setForm((p) => ({ ...p, operation_type: op }));
        await wait(950); if (!alive()) return;

        // 10 · Landningar + max-höjd (räknas upp).
        say(10, 'Landings and max altitude');
        scrollTo(demoY.current.fields, 190);
        focus('ld-fields');
        await wait(600); if (!alive()) return;
        setForm((p) => ({ ...p, landings_day: String(legs.length), landings_night: '' }));
        await wait(500);
        for (let k = 1; k <= 6; k++) {
          if (!alive()) return;
          const v = Math.round((altVal * k) / 6);
          setForm((p) => ({ ...p, max_altitude_m: String(droneAltToM(v, altUnit)) }));
          await wait(90);
        }
        await wait(900); if (!alive()) return;

        // 11 · Remarks.
        say(11, 'Remarks — anything worth remembering');
        scrollTo(demoY.current.remarks, 210);
        focus('ld-remarks');
        await wait(500); if (!alive()) return;
        if (!(await typeSeq(chars(TOUR_REMARK), (v) => setForm((p) => ({ ...p, remarks: v })), 42))) return;
        await wait(900); if (!alive()) return;

        // 12 · Spara tyst → minns flygningen (raderas när rundturen slutar).
        tour().setCaption('Saving to your logbook…', PHASES / (PHASES + 1));
        focus(null);
        scrollRef.current?.scrollToEnd({ animated: true });
        await wait(650); if (!alive()) return;
        focus('ld-save');
        await wait(950); if (!alive()) return;
        const id = await demoLatest.current!.save(false, true);
        if (id) await rememberTourDemo({ kind: 'drone', id });
        if (!tour().active) { await cleanupTourDemo(); return; } // rundturen avbröts mitt i sparningen
        if (!alive()) return;
        focus(null);
        tour().setCaption(id ? 'Saved to your logbook' : 'Could not save the example flight', 1);
        tour().finishLogDemo();
      } catch {
        if (alive()) tour().finishLogDemo();
      } finally {
        if (tour().pressTarget?.startsWith('ld-')) focus(null);
      }
    })();
    return () => { dead = true; };
  }, [logDemoRun]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Siktläge + villkor (tid per läge, natt, VFR/IFR): delas av Quicklog-reglaget och Full-fällningen ──
  const condTotal = parseFloat(form.total_time) || 0;
  const condTotalMin = condTotal * 60;
  const num = (v?: string) => parseFloat(v ?? '') || 0;
  const pct = (v?: string) => (condTotal > 0 ? Math.round((num(v) / condTotal) * 100) : 0);
  const cap = (n: number) => Math.min(Math.max(0, n), condTotal || n);
  const setVfrIfr = (key: 'vfr' | 'ifr', p: number) => {
    const val = condTotal * p / 100;
    const ifrV = key === 'ifr' ? val : Math.max(0, condTotal - val);
    const vfrV = Math.max(0, condTotal - ifrV);
    const eps = 0.01;
    const rules = ifrV >= condTotal - eps ? 'IFR' : (ifrV <= eps ? 'VFR' : 'Y');
    setForm((prev) => ({ ...prev, ifr: ifrV.toFixed(2), vfr: vfrV.toFixed(2), flight_rules: rules }));
  };
  // Tid på ett läge → resten fördelas proportionellt på de två andra (är de tomma: VLOS, eller BVLOS
  // när det är VLOS som ändras). flight_mode = det dominerande läget (visning, filter, landningspunkt).
  const setModeTime = (m: DroneFlightMode, hours: number) => {
    const v = cap(hours);
    setForm((prev) => {
      const cur: Record<DroneFlightMode, number> = { VLOS: num(prev.h_vlos), EVLOS: num(prev.h_evlos), BVLOS: num(prev.h_bvlos) };
      if (cur.VLOS + cur.EVLOS + cur.BVLOS <= 1e-6) cur[(prev.flight_mode || 'VLOS') as DroneFlightMode] = condTotal;
      const others = FLIGHT_MODES.filter((x) => x !== m);
      const rest = Math.max(0, condTotal - v);
      const otherSum = others.reduce((sum, x) => sum + cur[x], 0);
      const fallback: DroneFlightMode = m === 'VLOS' ? 'BVLOS' : 'VLOS';
      const next: Record<DroneFlightMode, number> = { ...cur, [m]: v };
      others.forEach((x) => { next[x] = otherSum > 1e-6 ? rest * (cur[x] / otherSum) : (x === fallback ? rest : 0); });
      const dominant = FLIGHT_MODES.reduce((a, b) => (next[b] > next[a] + 1e-6 ? b : a), (prev.flight_mode || 'VLOS') as DroneFlightMode);
      const str = (n: number) => (n > 1e-6 ? n.toFixed(4) : '');
      return { ...prev, flight_mode: dominant, h_vlos: str(next.VLOS), h_evlos: str(next.EVLOS), h_bvlos: str(next.BVLOS) };
    });
  };
  const fmtInput = (dec?: string) => { const n = parseFloat(dec ?? ''); return (!n || isNaN(n)) ? '' : decimalToHHMM(n); };
  const parseRaw = (raw: string): number => {
    if (!raw.trim()) return 0;
    if (raw.includes(':')) { const [h, m] = raw.split(':'); return (parseInt((h || '0').replace(/\D/g, '') || '0', 10) || 0) + Math.min(59, parseInt((m || '0').replace(/\D/g, '') || '0', 10) || 0) / 60; }
    const d = raw.replace(/\D/g, ''); if (!d) return 0; if (d.length <= 2) return (Math.min(59, parseInt(d, 10) || 0)) / 60; return (parseInt(d.slice(0, -2), 10) || 0) + Math.min(59, parseInt(d.slice(-2), 10) || 0) / 60;
  };
  const fmtDur = (raw: string) => { const d = raw.replace(/\D/g, '').slice(0, 4); return d.length <= 2 ? d : `${d.slice(0, -2)}:${d.slice(-2)}`; };
  type CondKey = 'vfr' | 'ifr' | 'night_time' | 'h_vlos' | 'h_evlos' | 'h_bvlos';
  const MODE_KEY: Record<DroneFlightMode, 'h_vlos' | 'h_evlos' | 'h_bvlos'> = { VLOS: 'h_vlos', EVLOS: 'h_evlos', BVLOS: 'h_bvlos' };
  // BVLOS orange (inte gul) så att EVLOS (guld) och BVLOS skiljer sig åt.
  const MODE_TINT: Record<DroneFlightMode, string> = { VLOS: Colors.success, EVLOS: Colors.gold, BVLOS: '#FF8C42' };
  const onTime = (key: CondKey, raw: string) => {
    const f = fmtDur(raw);
    setCondRaw((r) => ({ ...r, [key]: f }));
    const dec = cap(parseRaw(f));
    if (key === 'vfr' || key === 'ifr') setVfrIfr(key, condTotal > 0 ? dec / condTotal * 100 : 0);
    else if (key === 'night_time') { setNightManual(true); setForm((p) => ({ ...p, night_time: String(dec) })); }
    else setModeTime(key === 'h_vlos' ? 'VLOS' : key === 'h_evlos' ? 'EVLOS' : 'BVLOS', dec);
  };
  const onBlur = (key: string) => setCondRaw((r) => { const n = { ...r }; delete n[key]; return n; });
  const valFor = (key: CondKey, dec?: string) => (condRaw[key] !== undefined ? condRaw[key]! : fmtInput(dec));
  const lock = () => setScrollLocked(true); const unlock = () => setScrollLocked(false);
  const curMode = (form.flight_mode || 'VLOS') as DroneFlightMode;

  // ── Route-kortets delar (= pilotens Log Flight): platsruta med GPS-nål/bock och snabbval, tidsruta med Z/L ──
  const renderPlace = (which: 'dep' | 'arr') => {
    const value = which === 'dep' ? form.location : (form.landing_location ?? '');
    const located = which === 'dep' ? !!depCoords : !!arrCoords;
    const setValue = (v: string) => setForm((p) => (which === 'dep'
      ? { ...p, location: v, lat: undefined, lon: undefined }
      : { ...p, landing_location: v, landing_lat: 0, landing_lon: 0 }));
    const picks = recentPlaces.filter((rp) => rp.trim()).slice(0, 2);
    return (
      <View>
        <View style={styles.placeBox}>
          <TextInput
            style={[styles.placeInput, { fontSize: placeFontSize(value) }]}
            value={value}
            onChangeText={setValue}
            onEndEditing={(e) => geocodePlace(which, e.nativeEvent.text)}
            placeholder="Place"
            placeholderTextColor={DR.faint}
            autoCapitalize="characters"
            autoCorrect={false}
            numberOfLines={1}
          />
          {located ? (
            <Ionicons name="checkmark-circle" size={18} color={Colors.success} style={{ marginLeft: 6 }} />
          ) : (
            <TouchableOpacity onPress={() => fetchMyPosition(which)} disabled={placeBusy === which} hitSlop={8} style={{ marginLeft: 4 }}
              accessibilityRole="button" accessibilityLabel="Use my position">
              {placeBusy === which ? <ActivityIndicator size="small" color={accent} /> : <Ionicons name="location" size={18} color={accent} />}
            </TouchableOpacity>
          )}
        </View>
        {!value.trim() && picks.length > 0 && (
          <View style={styles.pickRow}>
            {picks.map((rp, i) => (
              <TouchableOpacity key={rp} style={[styles.pickChip, i === 0 && styles.pickChipFirst]} activeOpacity={0.75}
                onPress={() => { setValue(rp); geocodePlace(which, rp); }}>
                <Text numberOfLines={1} style={[styles.pickChipText, i === 0 && { color: Colors.gold }]}>{rp}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    );
  };
  // A → B: samma ICAO-fält som pilotens Log Flight (kod eller fritext, flygplatsnamn under, snabbval, sök
  // och "här"-nålen som föreslår närmaste flygplatser).
  const renderAirport = (which: 'dep' | 'arr') => {
    const value = which === 'dep' ? form.location : (form.landing_location ?? '');
    const put = (v: string) => setForm((p) => (which === 'dep' ? { ...p, location: v } : { ...p, landing_location: v }));
    return (
      <IcaoInput
        label=""
        inputFontFamily={FONT_LED14}
        design
        freeText
        value={value}
        onChangeText={(v) => put(v)}
        onResolve={(raw, icao) => put(icao ?? raw.trim().toUpperCase())}
        recentPlaces={recentAirports}
        onConfirm={() => setTimeout(() => (which === 'dep' ? depTimeRef : arrTimeRef).current?.focus(), 80)}
      />
    );
  };
  const renderTime = (which: 'dep' | 'arr') => {
    const utc = which === 'dep' ? (form.takeoff_time ?? '') : arrTime;
    return (
      <View>
        <SmartTimeInput
          ref={which === 'dep' ? depTimeRef : arrTimeRef}
          label=""
          align="left"
          compactRight
          inputFontFamily={FONT_LED7}
          showNowBtn={false}
          value={timeMode === 'utc' ? utc : (which === 'dep' ? depLocalBuf : arrLocalBuf)}
          onChangeText={(v) => {
            if (which === 'dep') { if (timeMode === 'utc') setForm((p) => ({ ...p, takeoff_time: v })); else onDepLocalChange(v); }
            else if (timeMode === 'utc') setArrTime(v); else onArrLocalChange(v);
          }}
          rightAdornment={
            <Pressable onPress={toggleTimeMode} hitSlop={10} style={{ paddingHorizontal: 4, paddingVertical: 2 }}>
              <Text style={{ fontFamily: FONT_LED14, fontSize: 15, fontWeight: '700', color: timeMode === 'utc' ? accent : Colors.gold }}>{timeMode === 'utc' ? 'Z' : 'L'}</Text>
            </Pressable>
          }
        />
        {isValidTime(utc) ? (
          <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={styles.timeBelowCenter}>
            {timeMode === 'utc' ? `${utcToLocal(form.date, utc)} local` : `${utc} UTC`}
          </Text>
        ) : null}
      </View>
    );
  };
  const nightH = parseFloat(form.night_time ?? '') || 0;
  const heroNight = (
    <View style={styles.heroNight}>
      <View style={[styles.heroDot, { backgroundColor: nightH > 0 ? Colors.info : Colors.gold }]} />
      <Text style={styles.heroNightText}>{nightH > 0 ? `${decimalToHHMM(nightH)} during night` : 'Day flight'}</Text>
    </View>
  );
  const totalShown = routeMode === 'ab' ? abTotal : fullTotalDecimal;
  const legCount = fullLegs.filter((l) => durToDec(l) > 0).length;
  const distKm = routeMode === 'ab' && depCoords && arrCoords ? kmBetween(depCoords, arrCoords) : null;
  const abTl = routeMode === 'ab' && depCoords && arrCoords && isValidTime(form.takeoff_time ?? '') && isValidTime(arrTime) ? (() => {
    const inst = buildInstants(form.date, form.takeoff_time ?? '', arrTime, 0);
    return inst ? buildSunTimeline([depCoords, arrCoords], inst.dep.getTime(), inst.arr.getTime()) : null;
  })() : null;
  // Landningar (auto, en per flygning) — samma rutor som pilotens Quicklog, bara landningar (dag/natt).
  const renderLandingChip = (night: boolean) => {
    const key = night ? 'landings_night' : 'landings_day';
    const count = parseInt(form[key] || '0', 10) || 0;
    const step = (d: number) => {
      setLandingsManual(true);
      setForm((p) => ({ ...p, [key]: String(Math.max(0, (parseInt(p[key] || '0', 10) || 0) + d)) }));
    };
    return (
      <View style={styles.ldgChip}>
        <Text style={[styles.ldgCount, !count && { color: DR.faint }]}>{count}</Text>
        <Text style={[styles.ldgLbl, { color: night ? Colors.info : Colors.success }]}>{night ? 'NIGHT' : 'DAY'}</Text>
        <TouchableOpacity onPress={() => step(-1)} hitSlop={8} activeOpacity={0.6} style={styles.ldgStep}
          accessibilityRole="button" accessibilityLabel={`One ${night ? 'night' : 'day'} landing fewer`}>
          <Text style={styles.ldgStepText}>−</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => step(1)} hitSlop={8} activeOpacity={0.6} style={[styles.ldgStep, styles.ldgStepPlus]}
          accessibilityRole="button" accessibilityLabel={`One more ${night ? 'night' : 'day'} landing`}>
          <Text style={[styles.ldgStepText, { color: accent }]}>+</Text>
        </TouchableOpacity>
      </View>
    );
  };
  // Kategorin: förvalet från drönaren, en lista för alla (militära piloter ser sina grupper först).
  const droneDefaultCat = selectedDrone ? (selectedDrone.category || categoryFromCClass(selectedDrone.c_class || '')) : '';
  const catNow = catDisplay(form.category);
  const catGroups = pilotType === 'military'
    ? [{ title: 'MILITARY', items: CAT_MILITARY }, { title: 'NATO', items: CAT_NATO }, { title: 'CIVIL · EASA', items: CAT_CIVIL }]
    : [{ title: 'CIVIL · EASA', items: CAT_CIVIL }, { title: 'MILITARY', items: CAT_MILITARY }, { title: 'NATO', items: CAT_NATO }];
  const altM = parseFloat(form.max_altitude_m) || 0;
  const overOpenLimit = OPEN_CATS.includes(form.category) && altM > OPEN_ALT_LIMIT_M;
  const answerCat = (r: 'drone' | 'flight' | null) => { setCatAsk(null); const fn = catAskResolve.current; catAskResolve.current = null; fn?.(r); };

  return (
    <>
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'android' ? 'height' : undefined}>
      {/* Datum-header (= pilotens) + Quicklog/Full och Same spot/A → B (där piloten har Real flight/Sim) */}
      <TouchableOpacity style={styles.droneHeader} onPress={() => setShowDate(true)} activeOpacity={0.85}>
        <TouchableOpacity style={styles.droneHeaderClose} onPress={() => router.back()} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="close" size={22} color={DR.text2} />
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={styles.droneHeaderDate}>
            {(() => {
              const d = form.date ? new Date(form.date + 'T12:00:00') : new Date();
              return d.toLocaleDateString(lang === 'sv' ? 'sv-SE' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long' });
            })()}
          </Text>
          <Ionicons name="calendar-outline" size={18} color={accent} />
        </View>
        {/* Instrument scan (= pilotens scan-knapp i headern) — bara för nya flygningar */}
        {!isEdit && (
          <TouchableOpacity style={styles.droneHeaderScan} onPress={startLogScan} disabled={scanLoading} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            accessibilityRole="button" accessibilityLabel="Scan a flight log screenshot">
            {scanLoading ? <ActivityIndicator size="small" color={accent} /> : <Ionicons name="scan-outline" size={22} color={accent} />}
          </TouchableOpacity>
        )}
      </TouchableOpacity>
      <View style={styles.modeRow}>
        <SlideToggle
          sans
          options={[{ value: 'quick', label: 'Quicklog' }, { value: 'full', label: 'Full' }]}
          value={logFull ? 'full' : 'quick'}
          onChange={(v) => setLogFull(v === 'full')}
          activeColor={logFull ? Colors.gold : accent}
        />
        <View style={{ flex: 1 }} />
        <SlideToggle
          sans
          options={[{ value: 'same', label: 'Same spot' }, { value: 'ab', label: 'A → B' }]}
          value={routeMode}
          onChange={(v) => switchRouteMode(v as 'same' | 'ab')}
          activeColor={routeMode === 'ab' ? Colors.gold : accent}
        />
      </View>
      <ScrollView
        ref={scrollRef}
        // Under rundturen: extra luft i botten så Save kan scrollas upp ovanför rundturens bildtextrad.
        contentContainerStyle={[styles.content, tourActive && { paddingBottom: 170 }]}
        onLayout={(e) => { scrollMetrics.current.viewH = e.nativeEvent.layout.height; }}
        onContentSizeChange={(_w, h) => { scrollMetrics.current.contentH = h; }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        scrollEnabled={!scrollLocked}
      >
        {/* Instrument scan pågår: vilken dag ur bilden som fylls i och hur många som återstår efter den. */}
        {scanActiveDate && (() => {
          const day = scanDays.find((d) => d.date === scanActiveDate);
          const n = day?.flights.length ?? 0;
          const more = scanDays.length - 1;
          return (
            <View style={styles.scanBanner}>
              <Ionicons name="scan-outline" size={15} color={accent} />
              <Text style={styles.scanBannerText} numberOfLines={2}>
                From image · {n} {n === 1 ? 'flight' : 'flights'}{more > 0 ? ` · ${more} more ${more === 1 ? 'date' : 'dates'} after this` : ''}
              </Text>
            </View>
          );
        })()}

        {/* ── Route-kortet (= pilotens): Same spot = plats + take-off, flygtiden med flygningarna bredvid;
            A → B = avgång/ankomst med var sin plats och tid, distans, total och Sun route. ── */}
        <View style={styles.placeBlock} onLayout={(e) => { demoY.current.route = e.nativeEvent.layout.y; }}>
          {routeMode === 'same' ? (
            <>
              <View style={[styles.rRow, { gap: 10 }]}>
                <View style={[styles.panelL, { flex: 1.25 }]}>
                  <Text style={styles.panelHead}>{t('location')}</Text>
                  {renderPlace('dep')}
                </View>
                <View style={[styles.panelR, { flex: 1 }]}>
                  <Text style={styles.panelHead}>Take-off</Text>
                  {renderTime('dep')}
                </View>
              </View>
              <View style={styles.heroRow}>
                <View style={styles.totalBox}>
                  <Text style={[styles.totalVal, !(totalShown > 0) && { color: DR.faint }]}>{totalShown > 0 ? decimalToHHMM(totalShown) : '0:00'}</Text>
                  <Text style={styles.totalLbl}>{legCount > 1 ? 'Total flight time' : 'Flight time'}</Text>
                  {heroNight}
                </View>
                <View style={styles.legCol}>
                  {fullLegs.map((leg, i) => (
                    <View key={i} style={[styles.legChip, fullLegs.length > 1 && { paddingRight: 2 }]}>
                      <Text style={styles.legOrd}>{LEG_ORD(i)}</Text>
                      <View style={{ flex: 1, justifyContent: 'center' }}>
                        <TextInput
                          style={styles.legInput}
                          value={leg}
                          onChangeText={(raw) => updateLeg(i, raw)}
                          keyboardType="number-pad"
                          inputAccessoryViewID="drone-add-done"
                          accessibilityLabel={`${LEG_ORD(i).toLowerCase()} flight time`}
                        />
                        {/* DSEG7 kan inte rita bokstäver → egen platshållare */}
                        {!leg ? <View style={styles.legPh} pointerEvents="none"><Text style={styles.legPhText}>h:mm</Text></View> : null}
                      </View>
                      {fullLegs.length > 1 && (
                        <TouchableOpacity onPress={() => removeLeg(i)} hitSlop={6} activeOpacity={0.7}
                          accessibilityRole="button" accessibilityLabel={`Remove ${LEG_ORD(i).toLowerCase()} flight`}>
                          <Ionicons name="close-circle" size={16} color={DR.faint} />
                        </TouchableOpacity>
                      )}
                      {i === 1 ? <TourPress id="ld-leg2" variant="focus" radius={8} inset={3} /> : null}
                    </View>
                  ))}
                  <TouchableOpacity style={styles.addLegBtn} onPress={addLeg} activeOpacity={0.85}>
                    <Ionicons name="add" size={14} color={accent} />
                    <Text style={styles.addLegText}>Add flight</Text>
                    <TourPress id="ld-addleg" radius={8} />
                  </TouchableOpacity>
                </View>
              </View>
            </>
          ) : (
            <>
              <View style={styles.rRow}>
                <View style={[styles.panelL, { flex: 1 }]}>
                  <Text style={styles.panelHead}>{t('departure')}</Text>
                  {renderAirport('dep')}
                  {renderTime('dep')}
                </View>
                <View style={styles.connector}>
                  <View style={styles.connectorLine} />
                  <Ionicons name="arrow-down" size={26} color={accent} />
                  <View style={styles.connectorLine} />
                </View>
                <View style={[styles.panelR, { flex: 1 }]}>
                  <Text style={styles.panelHead}>{t('arrival')}</Text>
                  {renderAirport('arr')}
                  {renderTime('arr')}
                </View>
              </View>
              <View style={styles.heroAb}>
                {distKm != null && (
                  <View style={styles.heroStats}>
                    <View>
                      <Text style={styles.statVal}>{distKm < 10 ? distKm.toFixed(1) : Math.round(distKm)}<Text style={[styles.statUnit, { color: accent }]}> km</Text></Text>
                      <Text style={styles.statLbl}>Distance</Text>
                    </View>
                    {abTotal > 0 && (
                      <View>
                        <Text style={styles.statVal}>{Math.round(distKm / abTotal)}<Text style={[styles.statUnit, { color: accent }]}> km/h</Text></Text>
                        <Text style={styles.statLbl}>Avg speed</Text>
                      </View>
                    )}
                  </View>
                )}
                <View style={styles.totalBox}>
                  <Text style={[styles.totalVal, !(totalShown > 0) && { color: DR.faint }]}>{totalShown > 0 ? decimalToHHMM(totalShown) : '0:00'}</Text>
                  <Text style={styles.totalLbl}>Total flight time</Text>
                  {heroNight}
                </View>
                {abTl && (
                  <TouchableOpacity onPress={() => setSunRouteOpen(true)} activeOpacity={0.8} style={styles.heroGlobe}
                    accessibilityRole="button" accessibilityLabel="Open Sun route">
                    <SunGlobe size={60} lit={totalShown > 0 ? Math.max(0, Math.min(1, 1 - nightH / totalShown)) : 1} />
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                      <Text style={[styles.globeLbl, { color: accent }]}>{t('sun_route')}</Text>
                      <Ionicons name="chevron-forward" size={10} color={accent} />
                    </View>
                  </TouchableOpacity>
                )}
              </View>
              {abTl && (
                <TouchableOpacity style={{ marginTop: 14 }} onPress={() => setSunRouteOpen(true)} activeOpacity={0.8}>
                  <SunStrip tl={abTl} nightLabel={nightH > 0 ? decimalToHHMM(nightH) : undefined} />
                </TouchableOpacity>
              )}
            </>
          )}
          <TourPress id="ld-route" variant="focus" radius={14} inset={4} />
        </View>

        {/* ── Siktläge (= pilotens VFR/IFR) + i Full: tid per läge, natt och VFR/IFR i en fällning ── */}
        <View onLayout={(e) => { demoY.current.mode = e.nativeEvent.layout.y; }}>
          <View style={{ paddingHorizontal: 4, marginTop: 2, marginBottom: 6 }}>
            <SlideToggle
              block sans size="md"
              options={FLIGHT_MODES.map((m) => ({ value: m, label: m }))}
              value={curMode}
              // Val i toggeln = rent läge: hela flygtiden på det läget (barerna delar sedan upp den).
              onChange={(m) => {
                setForm((p) => ({ ...p, flight_mode: m as DroneFlightMode, h_vlos: '', h_evlos: '', h_bvlos: '' }));
                setCondRaw((r) => { const n = { ...r }; delete n.h_vlos; delete n.h_evlos; delete n.h_bvlos; return n; });
              }}
              activeColor={MODE_TINT[curMode]}
            />
          </View>
          {logFull && (
            <View style={styles.condBox}>
              <TouchableOpacity onPress={() => setCondOpen((o) => !o)} activeOpacity={0.75} style={styles.condHead}
                accessibilityRole="button" accessibilityState={{ expanded: condOpen }}>
                <Ionicons name={condOpen ? 'chevron-up' : 'chevron-down'} size={14} color={DR.text3} />
                <Text style={styles.condHeadText}>Time per mode · night · VFR/IFR</Text>
                <Text style={styles.condSummary}>{`NIGHT ${decimalToHHMM(nightH) || '0:00'}${nightManual ? '' : ' AUTO'}`}</Text>
              </TouchableOpacity>
              {condOpen && (
                <View style={{ paddingHorizontal: 14, paddingBottom: 12 }}>
                  {FLIGHT_MODES.map((m) => (
                    <CondBar key={m} label={m} pct={pct(form[MODE_KEY[m]])} onPct={(p) => setModeTime(m, condTotal * p / 100)} tint={MODE_TINT[m]} totalMin={condTotalMin} onGrab={lock} onRelease={unlock}
                      editable timeValue={valFor(MODE_KEY[m], form[MODE_KEY[m]])} onTimeChange={(raw) => onTime(MODE_KEY[m], raw)} onTimeBlur={() => onBlur(MODE_KEY[m])} />
                  ))}
                  <CondBar label={t('night')} pct={pct(form.night_time)}
                    onPct={(p) => { setNightManual(true); setForm((prev) => ({ ...prev, night_time: String(condTotal * p / 100) })); }}
                    tint="#5DA9FF" totalMin={condTotalMin} onGrab={lock} onRelease={unlock}
                    autoLabel={!nightManual && depCoords ? 'auto' : undefined}
                    onReset={nightManual && depCoords ? () => setNightManual(false) : undefined}
                    editable timeValue={valFor('night_time', form.night_time)} onTimeChange={(raw) => onTime('night_time', raw)} onTimeBlur={() => onBlur('night_time')} />
                  {!depCoords && (
                    <TouchableOpacity onPress={() => fetchMyPosition('dep')} activeOpacity={0.8} style={styles.nightAutoBtn}>
                      {placeBusy === 'dep' ? <ActivityIndicator size="small" color={accent} /> : <Ionicons name="location" size={13} color={accent} />}
                      <Text style={styles.nightAutoText}>Use my position for night</Text>
                    </TouchableOpacity>
                  )}
                  <View style={{ marginTop: 4 }}>
                    <SlideToggle
                      block sans size="md"
                      options={[{ value: 'VFR', label: 'VFR' }, { value: 'Y', label: 'Y/Z' }, { value: 'IFR', label: 'IFR' }]}
                      value={(form.flight_rules === 'Z' || form.flight_rules === 'Mixed') ? 'Y' : (form.flight_rules ?? 'VFR')}
                      onChange={(v) => {
                        const tot = parseFloat(form.total_time) || 0;
                        setForm((p) => {
                          if (v === 'VFR') return { ...p, flight_rules: 'VFR', vfr: tot ? tot.toFixed(2) : '', ifr: '' };
                          if (v === 'IFR') return { ...p, flight_rules: 'IFR', ifr: tot ? tot.toFixed(2) : '', vfr: '' };
                          const ifrNow = parseFloat(p.ifr ?? '0') || 0, vfrNow = parseFloat(p.vfr ?? '0') || 0;
                          if (ifrNow <= 0 || vfrNow <= 0) return { ...p, flight_rules: 'Y', ifr: (tot / 2).toFixed(2), vfr: (tot / 2).toFixed(2) };
                          return { ...p, flight_rules: 'Y' };
                        });
                        setCondRaw((r) => { const n = { ...r }; delete n.ifr; delete n.vfr; return n; });
                      }}
                      activeColor={form.flight_rules === 'IFR' ? accent : (form.flight_rules === 'Y' || form.flight_rules === 'Z') ? Colors.gold : Colors.success}
                    />
                  </View>
                  {(form.flight_rules === 'Y' || form.flight_rules === 'Z' || form.flight_rules === 'Mixed') && (
                    <View style={{ marginTop: 12 }}>
                      <CondBar label="VFR" pct={pct(form.vfr)} onPct={(p) => setVfrIfr('vfr', p)} tint={Colors.success} totalMin={condTotalMin} onGrab={lock} onRelease={unlock}
                        editable timeValue={valFor('vfr', form.vfr)} onTimeChange={(raw) => onTime('vfr', raw)} onTimeBlur={() => onBlur('vfr')} />
                      <CondBar label="IFR" pct={pct(form.ifr)} onPct={(p) => setVfrIfr('ifr', p)} tint={accent} totalMin={condTotalMin} onGrab={lock} onRelease={unlock}
                        editable timeValue={valFor('ifr', form.ifr)} onTimeChange={(raw) => onTime('ifr', raw)} onTimeBlur={() => onBlur('ifr')} />
                    </View>
                  )}
                </View>
              )}
            </View>
          )}
          <TourPress id="ld-mode" variant="focus" radius={10} inset={4} />
        </View>

        {/* ── Drönarkortet (= pilotens aircraft-kort): drönare, kategori, (Full) mission + operation, roll, besättning ── */}
        <View style={[styles.frameCard, (typeOpen || regOpen || otherOpen || crewOpen || catOpen || showMissionPicker) ? { zIndex: 20 } : null]} onLayout={(e) => { demoY.current.frame = e.nativeEvent.layout.y; }}>
        <View style={{ position: 'relative', zIndex: (typeOpen || regOpen) ? 30 : undefined }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1.1 }}>
              <Text style={styles.cardFieldLabel}>Drone</Text>
              <View style={styles.pickBox}>
                <TouchableOpacity style={styles.pickBoxTap} onPress={() => { setRegOpen(false); setCatOpen(false); setTypeOpen((o) => !o); }} activeOpacity={0.7}>
                  <Text style={[styles.pickBoxValue, !curModel && { color: DR.muted }]} numberOfLines={1}>{curModel || 'Model'}</Text>
                  <Ionicons name={typeOpen ? 'chevron-up' : 'chevron-down'} size={15} color={DR.text2} />
                </TouchableOpacity>
                <View style={styles.pickBoxDivider} />
                <TouchableOpacity onPress={() => { setTypeOpen(false); setPendingModel(null); setShowDroneModal(true); }} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }} activeOpacity={0.7}>
                  <Ionicons name="add" size={18} color={accent} />
                </TouchableOpacity>
              </View>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardFieldLabel}>Registration</Text>
              <View style={styles.pickBox}>
                <TouchableOpacity style={styles.pickBoxTap} onPress={() => { if (!curModel) { Alert.alert('Select a drone first', 'Pick a model before its registration.'); return; } setTypeOpen(false); setCatOpen(false); setRegOpen((o) => !o); }} activeOpacity={0.7}>
                  <Text style={[styles.pickBoxValue, !selectedDrone?.registration && { color: DR.muted }]} numberOfLines={1}>{selectedDrone?.registration || 'Reg / S/N'}</Text>
                  <Ionicons name={regOpen ? 'chevron-up' : 'chevron-down'} size={15} color={DR.text2} />
                </TouchableOpacity>
                <View style={styles.pickBoxDivider} />
                <TouchableOpacity onPress={() => { setRegOpen(false); if (!curModel) { setShowDroneModal(true); } else { setRegInput(''); setShowRegInput(true); } }} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }} activeOpacity={0.7}>
                  <Ionicons name="add" size={18} color={accent} />
                </TouchableOpacity>
              </View>
            </View>
            <TourPress id="ld-drone" variant="focus" radius={10} inset={6} />
          </View>

          {typeOpen && (
            <View style={[styles.ddFlyout, { left: 0, width: '55%' }]}>
              {droneModels.length === 0 ? (
                <Text style={styles.ddEmpty}>No saved drones — tap + to add</Text>
              ) : (() => {
                const ROWS = 8; const cols: string[][] = [];
                for (let i = 0; i < droneModels.length; i += ROWS) cols.push(droneModels.slice(i, i + ROWS));
                return (
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {cols.map((col, ci) => (
                      <View key={ci} style={{ flex: 1, gap: 6 }}>
                        {col.map((m) => {
                          const active = curModel === m;
                          return (
                            <TouchableOpacity key={m} style={[styles.ddChip, active && styles.ddChipActive]} onPress={() => selectModel(m)} activeOpacity={0.75}>
                              <Text numberOfLines={1} style={[styles.ddChipText, active && styles.ddChipTextActive]}>{m}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    ))}
                  </View>
                );
              })()}
            </View>
          )}

          {regOpen && (
            <View style={[styles.ddFlyout, { left: 0, right: 0 }]}>
              {regsForModel.length === 0 ? (
                <Text style={styles.ddEmpty}>No registrations — tap + to add</Text>
              ) : (() => {
                const sorted = [...regsForModel].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
                const ROWS = 8; const cols: string[][] = [];
                for (let i = 0; i < sorted.length; i += ROWS) cols.push(sorted.slice(i, i + ROWS));
                return (
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {cols.map((col, ci) => (
                      <View key={ci} style={{ flex: 1, gap: 4 }}>
                        {col.map((rg) => {
                          const active = selectedDrone?.registration === rg;
                          return (
                            <TouchableOpacity key={rg} style={[styles.ddCell, active && styles.ddChipActive]} onPress={() => selectReg(rg)} activeOpacity={0.75}>
                              <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.ddCellText, active && styles.ddChipTextActive]}>{rg}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    ))}
                  </View>
                );
              })()}
            </View>
          )}
        </View>

        {/* Kategori: en lista för civila och militära kategorier. Förval från drönaren ("From drone"). */}
        <View style={{ position: 'relative', zIndex: catOpen ? 30 : undefined }}>
          <View style={[styles.labelRow, { marginTop: 4 }]}>
            <Text style={[styles.cardFieldLabel, { marginTop: 0, marginBottom: 0 }]}>Category</Text>
            {!!form.category && form.category === droneDefaultCat && (
              <View style={styles.fromDrone}>
                <Ionicons name="checkmark" size={8} color={Colors.success} />
                <Text style={styles.fromDroneText}>from drone</Text>
              </View>
            )}
          </View>
          <TouchableOpacity style={[styles.pickBox, catOpen && { borderColor: accent }]} activeOpacity={0.75}
            onPress={() => { setTypeOpen(false); setRegOpen(false); setCatOpen((o) => !o); }}
            accessibilityRole="button" accessibilityLabel={`Category for this flight: ${catNow.short}`} accessibilityState={{ expanded: catOpen }}>
            <Text style={[styles.pickBoxValue, { flex: 0 }, !form.category && { color: DR.muted }]} numberOfLines={1}>{catNow.short}</Text>
            <Text style={styles.catNote} numberOfLines={1}>{catNow.note}</Text>
            <Ionicons name={catOpen ? 'chevron-up' : 'chevron-down'} size={15} color={accent} />
          </TouchableOpacity>
          {catOpen && (
            <View style={[styles.ddFlyout, { left: 0, right: 0, gap: 10 }]}>
              {catGroups.map((g) => (
                <View key={g.title} style={{ gap: 5 }}>
                  <Text style={styles.catGroupTitle}>{g.title}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
                    {g.items.map((o) => {
                      const on = form.category === o.value;
                      return (
                        <TouchableOpacity key={o.value} style={[styles.catChip, on && styles.ddChipActive]} activeOpacity={0.75}
                          onPress={() => { setForm((p) => ({ ...p, category: o.value })); setCatOpen(false); }}
                          accessibilityRole="button" accessibilityState={{ selected: on }}>
                          <Text style={[styles.ddChipText, on && styles.ddChipTextActive]}>{o.label}</Text>
                          {o.note ? <Text style={styles.catChipNote}>{o.note}</Text> : null}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Full: Mission (fritext + förval) och Operation (Private/Commercial) */}
        {logFull && (
          <View style={[{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }, showMissionPicker && { zIndex: 25 }]}
            onLayout={(e) => { demoY.current.missionIn = e.nativeEvent.layout.y; demoY.current.opIn = e.nativeEvent.layout.y; }}>
            <View style={{ flex: 1, position: 'relative' }}>
              <Text style={styles.cardFieldLabel}>Mission</Text>
              <View style={styles.pickBox}>
                <TextInput
                  style={styles.missionInput}
                  value={form.mission_type}
                  onChangeText={(v) => setForm((p) => ({ ...p, mission_type: v }))}
                  onFocus={() => setShowMissionPicker(false)}
                  placeholder="Type of mission"
                  placeholderTextColor={DR.muted}
                  autoCapitalize="sentences"
                />
                <TouchableOpacity onPress={() => { Keyboard.dismiss(); setShowMissionPicker((v) => !v); }} hitSlop={8} activeOpacity={0.7}>
                  <Ionicons name={showMissionPicker ? 'chevron-up' : 'chevron-down'} size={15} color={accent} />
                </TouchableOpacity>
                <TourPress id="ld-mission" variant="focus" radius={10} inset={3} />
              </View>
              {showMissionPicker && (
                <View style={styles.missionDropdown}>
                  <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 260 }}>
                    {MISSION_TYPES.map((m) => (
                      <TouchableOpacity key={m} style={styles.missionDropItem} onPress={() => { setForm((p) => ({ ...p, mission_type: m })); setShowMissionPicker(false); }} activeOpacity={0.7}>
                        <Text style={styles.missionDropItemText} numberOfLines={1}>{m}</Text>
                        {form.mission_type === m && <Ionicons name="checkmark" size={15} color={accent} />}
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
            </View>
            <View>
              <Text style={styles.cardFieldLabel}>Operation</Text>
              <View style={styles.opSeg}>
                {([['PRI', 'Private'], ['COM', 'Commercial']] as const).map(([k, lbl]) => {
                  const active = form.operation_type === k;
                  return (
                    <TouchableOpacity key={k} style={[styles.opBtn, active && styles.opBtnOn]} activeOpacity={0.75}
                      onPress={() => setForm((p) => ({ ...p, operation_type: p.operation_type === k ? '' : k }))}
                      accessibilityRole="button" accessibilityState={{ selected: active }}>
                      <Text style={[styles.opBtnText, active && { color: DR.inkOnAccent }]}>{lbl}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TourPress id="ld-op" variant="focus" radius={10} inset={4} />
            </View>
          </View>
        )}

        {/* Your role (= pilotens): PIC / SIC / DUAL / INSTRUCTOR + OTHER. i-knappen beskriver alla roller. */}
        <View style={styles.labelRow}>
          <Text style={[styles.cardFieldLabel, { marginTop: 0, marginBottom: 0 }]}>{t('your_role')}</Text>
          <TouchableOpacity onPress={() => setRoleInfoOpen(true)} hitSlop={{ top: 10, bottom: 10, left: 6, right: 10 }} activeOpacity={0.7}
            accessibilityRole="button" accessibilityLabel="About pilot functions and crew roles">
            <Ionicons name="information-circle-outline" size={16} color={accent} />
          </TouchableOpacity>
        </View>
        <View style={[styles.roleGrid, otherOpen ? { zIndex: 30 } : null]} onLayout={(e) => { demoY.current.roleIn = e.nativeEvent.layout.y; }}>
          <View style={styles.roleRow}>
            {(['pic', 'sic'] as const).map((r) => (
              <TouchableOpacity key={r} style={[styles.roleBtn, role === r && styles.roleBtnActive]} onPress={() => selectRole(r)} activeOpacity={0.75}>
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.roleBtnText, role === r && styles.roleBtnTextActive]}>{r.toUpperCase()}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.roleRow}>
            {(['dual', 'instructor'] as const).map((r) => (
              <TouchableOpacity key={r} style={[styles.roleBtn, role === r && styles.roleBtnActive]} onPress={() => selectRole(r)} activeOpacity={0.75}>
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.roleBtnText, role === r && styles.roleBtnTextActive]}>{r === 'instructor' ? 'INSTRUCTOR' : 'DUAL'}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.roleRow}>
            {renderOtherBox()}
          </View>
          <TourPress id="ld-role" variant="focus" radius={10} inset={5} />
        </View>

        {/* Second pilot + fler medpiloter (= pilotläget): roll till vänster, namn till höger, +figur lägger till. */}
        <View style={crewOpen ? { zIndex: 25 } : null} onLayout={(e) => { demoY.current.crewIn = e.nativeEvent.layout.y; }}>
          <Text style={[styles.cardFieldLabel, { marginTop: 10 }]}>{t('second_pilot_label')}</Text>
          <View style={{ gap: 6 }}>
            <PersonPicker
              name={form.second_pilot ?? ''}
              roleKey={form.second_pilot_role ?? ''}
              roleOptions={DRONE_CREW_ROLE_OPTS}
              saved={recentCrew}
              byAircraft={crewByModel}
              currentAircraft={curModel}
              placeholder={t('second_pilot_ph')}
              onPick={(n, r) => { setForm((p) => ({ ...p, second_pilot: n })); if (r) selectSecondPilotRole(r); }}
              onChangeRole={selectSecondPilotRole}
              onAddNew={() => promptAddPersonName(t('second_pilot_label'), (n) => setForm((p) => ({ ...p, second_pilot: n })))}
              onAddMore={addExtraPilot}
              onToggle={setCrewOpen}
              palette={crewColors.picker}
              acIcon={<MaterialCommunityIcons name="quadcopter" size={20} color={accent} />}
            />
            {extraPilots.map((p) => (
              <PersonPicker
                key={p.id}
                name={p.name}
                roleKey={p.role}
                roleOptions={DRONE_CREW_ROLE_OPTS}
                saved={recentCrew}
                byAircraft={crewByModel}
                currentAircraft={curModel}
                placeholder={t('second_pilot_ph')}
                onPick={(n, r) => { setExtraPilotName(p.id, n); if (r) selectExtraPilotRole(p.id, r); }}
                onChangeRole={(k) => selectExtraPilotRole(p.id, k)}
                onAddNew={() => promptAddPersonName(t('second_pilot_label'), (n) => setExtraPilotName(p.id, n))}
                onRemove={() => removeExtraPilot(p.id)}
                onToggle={setCrewOpen}
                palette={crewColors.picker}
                acIcon={<MaterialCommunityIcons name="quadcopter" size={20} color={accent} />}
              />
            ))}
          </View>
          <TourPress id="ld-crew" variant="focus" radius={10} inset={5} />
        </View>
        </View>{/* /drönarkortet */}

        {/* ── Landningar (auto, en per flygning) + i Full: max-höjd med 120 m-gränsen för Open ── */}
        <View style={{ paddingHorizontal: 4, marginTop: 6 }} onLayout={(e) => { demoY.current.fields = e.nativeEvent.layout.y; }}>
          <View style={styles.ldgHead}>
            <Text style={[styles.cardFieldLabel, { marginTop: 0, marginBottom: 0 }]}>Landings</Text>
            {!landingsManual && (
              <View style={styles.autoPill}>
                <Ionicons name="checkmark" size={8} color={Colors.success} />
                <Text style={styles.autoPillText}>auto</Text>
              </View>
            )}
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {renderLandingChip(false)}
            {renderLandingChip(true)}
          </View>
          {logFull && (
            <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: DR.border }}>
              {/* Max alt i vald enhet (ft/m, Settings → General). Lagras i meter: 120 m-regeln, exporter och import. */}
              <MaxAltBar
                value={droneAltIn(altM, altUnit)}
                onChange={(v) => setForm((p) => ({ ...p, max_altitude_m: v > 0 ? String(droneAltToM(v, altUnit)) : '' }))}
                min={0} max={ALT_BAR[altUnit].max} dragStep={ALT_BAR[altUnit].drag} fineStep={ALT_BAR[altUnit].fine}
                label="Max alt" unit={altUnit} unitBefore={false} toDisplay={(v) => String(v)}
                onGrab={() => setScrollLocked(true)} onRelease={() => setScrollLocked(false)}
              />
            </View>
          )}
          {logFull && overOpenLimit && (
            <View style={styles.altWarn}>
              <Ionicons name="warning" size={15} color={Colors.gold} />
              <Text style={styles.altWarnText}>
                {`${formatDroneAlt(altM, altUnit)} is above the ${altUnit === 'ft' ? `${droneAltFt(OPEN_ALT_LIMIT_M)} ft` : `${OPEN_ALT_LIMIT_M} m`} limit for ${form.category} (Open).`}
              </Text>
              <TouchableOpacity style={styles.altWarnBtn} onPress={() => setForm((p) => ({ ...p, category: 'Specific' }))} activeOpacity={0.8}>
                <Text style={styles.altWarnBtnText}>Use Specific</Text>
              </TouchableOpacity>
            </View>
          )}
          <TourPress id="ld-fields" variant="focus" radius={10} inset={4} />
        </View>

        {/* Quicklog: resten finns i Full (= pilotens "open Full"-rad) */}
        {!logFull && (
          <TouchableOpacity style={styles.openFull} onPress={() => setLogFull(true)} activeOpacity={0.75}>
            <Ionicons name="chevron-down" size={14} color={DR.text3} />
            <Text style={styles.openFullText}>Mission · max alt · conditions · notes · media — open Full</Text>
          </TouchableOpacity>
        )}

        {logFull && (<>
        <Text style={styles.section}>{t('remarks')}</Text>
        <View onLayout={(e) => { demoY.current.remarks = e.nativeEvent.layout.y; }}>
          <TextInput
            style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
            value={form.remarks}
            onChangeText={(v) => setForm((p) => ({ ...p, remarks: v }))}
            placeholder={t('notes_ph')}
            placeholderTextColor={DR.muted}
            multiline
          />
          <TourPress id="ld-remarks" variant="focus" radius={10} inset={3} />
        </View>

        {/* Media (bild eller video) — = pilotläget: väljs här och sparas på flygningen. */}
        <Text style={styles.section}>Media</Text>
        {photoUri ? (
          <View style={{ borderRadius: 12, overflow: 'hidden', position: 'relative' }}>
            {mediaType === 'video' ? (
              <FlightVideo uri={photoUri} style={{ width: '100%', height: 180 }} contentFit="cover" loop muted autoPlay />
            ) : (
              <Image source={{ uri: photoUri }} style={{ width: '100%', height: 180, borderRadius: 12 }} resizeMode="cover" />
            )}
            <TouchableOpacity onPress={() => { setPhotoUri(null); setMediaType('image'); }}
              style={{ position: 'absolute', top: 8, right: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="close" size={16} color="#fff" />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity onPress={() => pickMedia('image')} activeOpacity={0.75}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 10, backgroundColor: DR.elevated, borderWidth: 1, borderColor: DR.border }}>
              <Ionicons name="image-outline" size={16} color={DR.muted} />
              <Text style={{ color: DR.muted, fontSize: 13, fontWeight: '600' }}>Image</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => pickMedia('video')} activeOpacity={0.75}
              style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 10, backgroundColor: DR.elevated, borderWidth: 1, borderColor: DR.border }}>
              <Ionicons name="videocam-outline" size={16} color={DR.muted} />
              <Text style={{ color: DR.muted, fontSize: 13, fontWeight: '600' }}>Video</Text>
            </TouchableOpacity>
          </View>
        )}
        </>)}

        <TouchableOpacity style={styles.saveBtn} onPress={() => save(false)} disabled={saving} activeOpacity={0.85}>
          <Ionicons name="checkmark-circle" size={18} color={DR.inkOnAccent} />
          <Text style={styles.saveBtnText}>{saving ? t('saving') : t('save')}</Text>
          <TourPress id="ld-save" radius={12} />
        </TouchableOpacity>
        {/* Spara som utkast: fortsätt senare från dashboarden (inte vid redigering eller i rundturen). */}
        {!isEdit && !tourActive && (
          <TouchableOpacity style={styles.draftBtn} onPress={saveAsDraft} disabled={saving} activeOpacity={0.8}
            accessibilityRole="button" accessibilityLabel="Save as draft. Finish the flight later.">
            <Ionicons name="document-text-outline" size={17} color={DR.text2} />
            <Text style={styles.draftBtnText}>Save as draft</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Sun route (A → B med båda platsernas koordinater) — samma panel som pilotens. */}
      <Modal visible={sunRouteOpen && !!abTl} transparent animationType="slide" onRequestClose={() => setSunRouteOpen(false)}>
        <Pressable style={{ flex: 1, backgroundColor: '#000A', justifyContent: 'flex-end' }} onPress={() => setSunRouteOpen(false)}>
          <Pressable style={styles.sunSheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sunGrabber} />
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text style={styles.sunTitle}>{t('sun_route')}</Text>
                <Text numberOfLines={1} style={styles.sunSub}>{`${form.location} → ${form.landing_location} · ${form.takeoff_time}–${arrTime} UTC`}</Text>
              </View>
              <TouchableOpacity onPress={() => setSunRouteOpen(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityRole="button" accessibilityLabel="Close">
                <Ionicons name="close" size={22} color={DR.text2} />
              </TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 12) + 16 }}>
              {depCoords && arrCoords ? (
                <DayNightMap embedded
                  points={[{ ...depCoords, label: form.location }, { ...arrCoords, label: form.landing_location ?? '' }]}
                  date={form.date} depUtc={form.takeoff_time} arrUtc={arrTime} flightType="normal" vehicle="plane"
                  logged={{ night: nightH, nightLdg: parseInt(form.landings_night || '0', 10) || 0, total: totalShown }}
                  editHint />
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Annan kategori än drönarens → ska drönaren få den? (flygningen sparas med den oavsett) */}
      <GlassDialog
        visible={!!catAsk}
        onClose={() => answerCat(null)}
        icon={<DialogIcon name="pricetag-outline" color={accent} />}
        eyebrow="Drone category"
        title={catAsk ? `Save ${catAsk.drone} as ${catDisplay(catAsk.to).short}?` : ''}
        body={catAsk ? `It is saved as ${catAsk.from ? catDisplay(catAsk.from).short : 'no category'} today. Save ${catDisplay(catAsk.to).short} on the drone and it is filled in next time you fly it. This flight is saved as ${catDisplay(catAsk.to).short} either way.` : ''}
        primary={{ label: 'Save on the drone', onPress: () => answerCat('drone') }}
        secondary={{ label: 'Only this flight', onPress: () => answerCat('flight') }}
      />

      {showDate && Platform.OS === 'android' && (
        <DateTimePicker
          value={new Date(form.date)}
          mode="date"
          display="calendar"
          maximumDate={new Date()}
          onChange={(e, d) => {
            setShowDate(false);
            if (e.type === 'set' && d) setForm((p) => ({ ...p, date: d.toISOString().split('T')[0] }));
          }}
        />
      )}
      {Platform.OS === 'ios' && (
        <Modal visible={showDate} transparent animationType="slide">
          <Pressable style={styles.modalBackdrop} onPress={() => setShowDate(false)}>
            <Pressable style={styles.datePickerSheet} onPress={(e) => e.stopPropagation()}>
              <TouchableOpacity style={{ alignSelf: 'flex-end', padding: 12 }} onPress={() => setShowDate(false)}>
                <Text style={{ color: accent, fontWeight: '700' }}>{t('done')}</Text>
              </TouchableOpacity>
              <DateTimePicker
                value={new Date(form.date)}
                mode="date"
                display="spinner"
                maximumDate={new Date()}
                themeVariant="dark"
                onChange={(_, d) => d && setForm((p) => ({ ...p, date: d.toISOString().split('T')[0] }))}
              />
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Drönar-modal (smartsearch): lägg till/sök drönare — airframe, vikt, klass */}
      <DroneModal
        visible={showDroneModal}
        initialModel={pendingModel ?? curModel ?? ''}
        onClose={() => setShowDroneModal(false)}
        onSave={onDroneModalSave}
      />

      <FlightLimitModal
        visible={showLimitModal}
        kind="drone"
        limit={FREE_TIER_LIMIT_DRONE}
        onClose={() => { setShowLimitModal(false); if (limitBlockedOnEntry) router.back(); }}
        onGoPremium={() => { setShowLimitModal(false); presentPaywall(); }}
      />

      {/* Lägg registrering/serienr för vald modell (matas under Registration-fältet) */}
      <Modal visible={showRegInput} transparent animationType="fade" onRequestClose={() => setShowRegInput(false)}>
        <Pressable style={styles.regBackdrop} onPress={() => setShowRegInput(false)}>
          <Pressable style={styles.regSheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.regTitle}>Add registration</Text>
            <Text style={styles.regSub}>Registration / serial for {curModel || 'this drone'}</Text>
            <TextInput
              style={styles.regInput}
              value={regInput}
              onChangeText={setRegInput}
              placeholder="SE-Dxxxx / S/N"
              placeholderTextColor={DR.muted}
              autoCapitalize="characters"
              autoCorrect={false}
              autoFocus
              onSubmitEditing={applyReg}
              returnKeyType="done"
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity style={styles.regCancel} onPress={() => { setShowRegInput(false); setRegInput(''); }} activeOpacity={0.7}>
                <Text style={styles.regCancelText}>{t('cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.regAdd, !regInput.trim() && { opacity: 0.5 }]} onPress={applyReg} disabled={!regInput.trim()} activeOpacity={0.85}>
                <Text style={styles.regAddText}>{t('save')}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Info-sida (helskärm, = pilotlägets info-sidor): alla roller + vilken loggbokskolumn tiden hamnar i */}
      <Modal visible={roleInfoOpen} animationType="slide" onRequestClose={() => setRoleInfoOpen(false)}>
        <View style={[styles.infoPage, { paddingTop: insets.top }]}>
          <View style={styles.infoPageHeader}>
            <Text style={styles.infoPageTitle}>Pilot functions & crew roles</Text>
            <TouchableOpacity onPress={() => setRoleInfoOpen(false)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} activeOpacity={0.7} style={styles.infoPageClose}>
              <Ionicons name="close" size={22} color={DR.text2} />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 48 }} showsVerticalScrollIndicator>
            <Text style={styles.infoPageIntro}>Pick the role you had on the flight. It decides which logbook column the flight time goes into. The same roles are available for the people you add under Second pilot.</Text>
            {DRONE_ROLE_INFO.map((s) => (
              <View key={s.code} style={{ marginBottom: 18 }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                  <Text style={{ color: accent, fontSize: 16, fontWeight: '800', fontFamily: 'JetBrainsMono' }}>{s.code}</Text>
                  <Text style={{ color: DR.text, fontSize: 15, fontWeight: '600', flex: 1 }}>{s.name}</Text>
                </View>
                {s.bullets.map((b, i) => (
                  <View key={i} style={{ flexDirection: 'row', gap: 8, marginTop: 6, paddingLeft: 2 }}>
                    <Text style={{ color: DR.muted, fontSize: 14, lineHeight: 20 }}>•</Text>
                    <Text style={{ color: DR.text2, fontSize: 14, lineHeight: 20, flex: 1 }}>{b}</Text>
                  </View>
                ))}
                <Text style={styles.infoLogbook}>LOGBOOK · {s.logbook.toUpperCase()}</Text>
              </View>
            ))}
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: accent + '14', borderWidth: 1, borderColor: accent + '44', borderRadius: 10, padding: 14, marginTop: 4 }}>
              <Ionicons name="information-circle" size={18} color={accent} />
              <Text style={{ flex: 1, color: DR.text2, fontSize: 13.5, lineHeight: 20 }}>
                <Text style={{ fontWeight: '700', color: DR.text }}>Payload operator</Text>, <Text style={{ fontWeight: '700', color: DR.text }}>Mission commander</Text> and <Text style={{ fontWeight: '700', color: DR.text }}>Observer</Text> don’t fly the drone, so the flight counts toward your total time but not PIC. Add the people you flew with — including your observer — under Second pilot. They are written into Remarks, e.g. “OBS: A. Berg”.
              </Text>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <DroneScanChooser visible={scanChooserOpen} onChoose={chooseScanSource} />

      {/* Instrument scan — datumväljare: före första loggningen och efter varje Save (fler dagar kvar). */}
      <Modal visible={!!scanPicker} transparent animationType="fade" onRequestClose={closeScanPicker}>
        <View style={styles.scanBackdrop}>
          <View style={styles.scanCard}>
            <Text style={styles.scanTitle}>{scanPicker?.afterSave ? 'Log more flights from the image?' : 'Flights in the image'}</Text>
            <Text style={styles.scanBody}>
              {scanPicker?.afterSave
                ? `${fmtScanDate(scanPicker.loggedDate ?? '')} is saved. The latest remaining date is selected — or pick another.`
                : 'The latest date is selected — or pick another. Several flights on the same day are added as 1st, 2nd and 3rd flight.'}
            </Text>
            <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ gap: 6 }} showsVerticalScrollIndicator>
              {scanDays.map((d, i) => {
                const sel = d.date === scanPicker?.selected;
                const mins = d.flights.reduce((sum, f) => sum + Math.max(1, Math.round(f.minutes)), 0);
                const alt = Math.max(0, ...d.flights.map((f) => f.altitude_m));
                const place = d.flights.find((f) => f.location)?.location;
                return (
                  <TouchableOpacity key={d.date} style={[styles.scanRow, sel && styles.scanRowActive]} onPress={() => setScanPicker((p) => (p ? { ...p, selected: d.date } : p))} activeOpacity={0.75}>
                    <Ionicons name={sel ? 'radio-button-on' : 'radio-button-off'} size={18} color={sel ? accent : DR.muted} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.scanRowDate}>{fmtScanDate(d.date)}</Text>
                      <Text style={styles.scanRowMeta} numberOfLines={1}>
                        {d.flights.length} {d.flights.length === 1 ? 'flight' : 'flights'} · {decimalToHHMM(mins / 60)}{alt > 0 ? ` · max ${formatDroneAlt(alt, altUnit)}` : ''}{place ? ` · ${place}` : ''}
                      </Text>
                      {loggedDates.has(d.date) && <Text style={styles.scanRowWarn}>A flight on this date is already in your logbook</Text>}
                    </View>
                    {i === 0 && <Text style={styles.scanLatest}>LATEST</Text>}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={[styles.scanBtn, { marginTop: 14 }]} onPress={() => scanPicker && applyScanDay(scanPicker.selected)} activeOpacity={0.85}>
              <Text style={styles.scanBtnText}>Log {fmtScanDate(scanPicker?.selected ?? '', true)}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.scanCancel} onPress={closeScanPicker} activeOpacity={0.7}>
              <Text style={styles.scanCancelText}>{scanPicker?.afterSave ? 'Done' : t('cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Instrument scan — AI läser bilden (överlägg i skärmen, ingen Modal: krockar inte med bildväljarens stängning) */}
      {scanLoading && (
        <View style={styles.scanOverlay}>
          <View style={[styles.scanCard, { alignItems: 'center', paddingVertical: 26 }]}>
            <ActivityIndicator size="large" color={accent} />
            <Text style={[styles.scanTitle, { marginTop: 14, textAlign: 'center' }]}>Reading flights…</Text>
            <Text style={[styles.scanBody, { textAlign: 'center', marginBottom: 0 }]}>This takes about 10 seconds.</Text>
          </View>
        </View>
      )}

      {/* Nytt namn för second pilot / extra medpilot (Name eller Callsign) — = pilotläget */}
      <AddPilotModal
        visible={addPilot.visible}
        title={addPilot.title}
        palette={crewColors.modal}
        onClose={() => setAddPilot((st) => ({ ...st, visible: false }))}
        onSave={(n) => { addPilot.cb?.(n); setAddPilot((st) => ({ ...st, visible: false })); }}
      />

    </KeyboardAvoidingView>
    {Platform.OS === 'ios' && (
      <InputAccessoryView nativeID="drone-add-done">
        <View style={{
          flexDirection: 'row', justifyContent: 'flex-end',
          backgroundColor: DR.elevated,
          borderTopWidth: 0.5, borderTopColor: DR.border,
          paddingHorizontal: 14, paddingVertical: 8,
        }}>
          <TouchableOpacity onPress={() => Keyboard.dismiss()} activeOpacity={0.7}>
            <Text style={{ color: accent, fontSize: 15, fontWeight: '700' }}>{t('done')}</Text>
          </TouchableOpacity>
        </View>
      </InputAccessoryView>
    )}
    </>
  );
}

function makeStyles(accent: string) {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: DR.background },
    content: { padding: 16, paddingBottom: 60, gap: 8 },
    // Quicklog/Full + Same spot/A → B under datumet (= pilotens Quicklog/Full + Real/Sim-rad).
    modeRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 8, backgroundColor: DR.surface, borderBottomWidth: 0.5, borderBottomColor: DR.separator },
    // Route-kortet (= pilotens placeBlock): panelerna blöder ut till kortets kanter.
    rRow: { flexDirection: 'row', alignItems: 'stretch', marginHorizontal: -14 },
    placeBlock: { backgroundColor: DR.surface, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: DR.border, zIndex: 10 },
    panelL: { gap: 8, backgroundColor: accent + '0D', borderTopWidth: 1, borderBottomWidth: 1, borderRightWidth: 1, borderColor: DR.separator, borderTopRightRadius: 12, borderBottomRightRadius: 12, padding: 12, paddingBottom: 11, minWidth: 0 },
    panelR: { gap: 8, backgroundColor: accent + '0D', borderTopWidth: 1, borderBottomWidth: 1, borderLeftWidth: 1, borderColor: DR.separator, borderTopLeftRadius: 12, borderBottomLeftRadius: 12, padding: 12, paddingBottom: 11, minWidth: 0 },
    panelHead: { color: DR.text, fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', textAlign: 'center', marginBottom: 2 },
    placeBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: DR.surface, borderRadius: 10, borderWidth: 1, borderColor: DR.border, paddingHorizontal: 12 },
    placeInput: { flex: 1, minWidth: 0, color: DR.text, fontFamily: FONT_LED14, fontWeight: '700', letterSpacing: 2, paddingVertical: 12 },
    pickRow: { flexDirection: 'row', gap: 4, marginTop: 6 },
    pickChip: { flex: 1, minWidth: 0, alignItems: 'center', backgroundColor: DR.elevated, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 4, borderWidth: 1, borderColor: DR.border },
    pickChipFirst: { backgroundColor: Colors.gold + '22', borderColor: Colors.gold + '88' },
    pickChipText: { color: DR.text2, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.5 },
    timeBelowCenter: { textAlign: 'center', color: DR.text3, fontSize: 10, marginTop: 4 },
    heroRow: { marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
    totalBox: { alignItems: 'center', paddingHorizontal: 18, paddingVertical: 8, borderRadius: 14, borderWidth: 1, borderColor: accent + '88', backgroundColor: Colors.gold + '0D' },
    totalVal: { fontFamily: FONT_LED7, fontSize: 28, fontWeight: '800', color: DR.text },
    totalLbl: { marginTop: 5, fontFamily: 'JetBrainsMono', fontSize: 9, fontWeight: '800', letterSpacing: 1.4, color: DR.text, textTransform: 'uppercase' },
    heroNight: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 5 },
    heroDot: { width: 4, height: 4, borderRadius: 2 },
    heroNightText: { fontFamily: 'JetBrainsMono', fontSize: 8, fontWeight: '700', letterSpacing: 0.5, color: DR.text, textTransform: 'uppercase' },
    legCol: { width: 128, gap: 5 },
    legChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingLeft: 8, paddingRight: 8, borderRadius: 8, borderWidth: 1, borderColor: DR.border, backgroundColor: DR.elevated },
    legOrd: { width: 24, fontFamily: 'JetBrainsMono', fontSize: 8.5, fontWeight: '700', letterSpacing: 0.4, color: DR.faint },
    legInput: { fontFamily: FONT_LED7, fontSize: 13, fontWeight: '800', color: DR.text, padding: 0 },
    legPh: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, justifyContent: 'center' },
    legPhText: { fontFamily: 'JetBrainsMono', fontSize: 11, fontWeight: '700', letterSpacing: 1, color: DR.faint },
    addLegBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, height: 30, borderRadius: 8, borderWidth: 1, borderColor: accent + '66', backgroundColor: accent + '10' },
    addLegText: { color: accent, fontSize: 11.5, fontWeight: '800', letterSpacing: 0.3 },
    connector: { width: 48, alignItems: 'center', justifyContent: 'center', paddingVertical: 6 },
    connectorLine: { flex: 1, minHeight: 12, width: 0, borderLeftWidth: 2, borderColor: accent + '80', borderStyle: 'dashed' },
    heroAb: { position: 'relative', marginTop: 12, minHeight: 70, alignItems: 'center', justifyContent: 'center' },
    heroStats: { position: 'absolute', left: 0, top: 4, gap: 9 },
    statVal: { fontFamily: FONT_LED14, fontWeight: '800', fontSize: 20, color: DR.text },
    statUnit: { fontSize: 9, fontFamily: 'JetBrainsMono' },
    statLbl: { fontFamily: 'JetBrainsMono', fontSize: 7.5, fontWeight: '800', letterSpacing: 1.4, color: DR.faint, textTransform: 'uppercase', marginTop: 2 },
    heroGlobe: { position: 'absolute', right: 0, top: 0, alignItems: 'center', gap: 3 },
    globeLbl: { fontFamily: 'JetBrainsMono', fontSize: 8.5, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
    condBox: { borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: DR.border, marginBottom: 4 },
    condHead: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 12 },
    condHeadText: { flex: 1, color: DR.text3, fontSize: 13.5, fontWeight: '700' },
    condSummary: { fontFamily: 'JetBrainsMono', fontSize: 8.5, fontWeight: '800', letterSpacing: 0.5, color: DR.text3 },
    fromDrone: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: Colors.success + '24', borderWidth: 1, borderColor: Colors.success + '66' },
    fromDroneText: { fontFamily: 'JetBrainsMono', fontSize: 8, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: Colors.success },
    catNote: { flex: 1, color: DR.text3, fontSize: 12, marginLeft: 8 },
    catGroupTitle: { fontFamily: 'JetBrainsMono', fontSize: 9, fontWeight: '700', letterSpacing: 1, color: DR.text3 },
    catChip: { flexGrow: 1, minWidth: 56, alignItems: 'center', justifyContent: 'center', backgroundColor: DR.surface, borderWidth: 1, borderColor: DR.border, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6 },
    catChipNote: { fontFamily: 'JetBrainsMono', fontSize: 8.5, color: DR.text3, marginTop: 1 },
    missionInput: { flex: 1, color: DR.text, fontSize: 15, fontWeight: '700', padding: 0, height: '100%' },
    opSeg: { flexDirection: 'row', height: 44, padding: 2, borderRadius: 8, borderWidth: 1, borderColor: DR.border, backgroundColor: DR.elevated },
    opBtn: { justifyContent: 'center', paddingHorizontal: 9, borderRadius: 6 },
    opBtnOn: { backgroundColor: Colors.gold, shadowColor: Colors.gold, shadowOpacity: 0.5, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } },
    opBtnText: { color: DR.faint, fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
    ldgHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
    autoPill: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: Colors.success + '24', borderWidth: 1, borderColor: Colors.success + '66' },
    autoPillText: { fontFamily: 'JetBrainsMono', fontSize: 8, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: Colors.success },
    ldgChip: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: DR.elevated, borderWidth: 1, borderColor: DR.border, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 11 },
    ldgCount: { fontFamily: 'JetBrainsMono', fontSize: 18, fontWeight: '800', color: DR.text },
    ldgLbl: { flex: 1, fontFamily: 'JetBrainsMono', fontSize: 9.5, fontWeight: '700', letterSpacing: 0.5 },
    ldgStep: { width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: DR.border, alignItems: 'center', justifyContent: 'center' },
    ldgStepPlus: { borderColor: accent + '66', backgroundColor: accent + '14' },
    ldgStepText: { color: DR.text2, fontSize: 14, fontWeight: '800', lineHeight: 16 },
    altWarn: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, paddingVertical: 10, paddingLeft: 12, paddingRight: 10, borderRadius: 10, borderWidth: 1, borderColor: Colors.gold + '80', backgroundColor: Colors.gold + '1A' },
    altWarnText: { flex: 1, color: '#FFD58A', fontSize: 12.5, lineHeight: 17 },
    altWarnBtn: { height: 34, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: Colors.gold, backgroundColor: Colors.gold + '29', justifyContent: 'center' },
    altWarnBtnText: { color: Colors.gold, fontSize: 12, fontWeight: '800' },
    openFull: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, paddingVertical: 14, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: DR.border },
    openFullText: { flex: 1, color: DR.text3, fontSize: 13.5, fontWeight: '700' },
    sunSheet: { maxHeight: '94%', backgroundColor: DR.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: DR.border, paddingTop: 8, paddingHorizontal: 16 },
    sunGrabber: { alignSelf: 'center', width: 38, height: 5, borderRadius: 3, backgroundColor: DR.border, marginBottom: 10 },
    sunTitle: { fontFamily: 'Fraunces', fontSize: 21, fontWeight: '600', color: DR.text },
    sunSub: { fontFamily: 'JetBrainsMono', fontSize: 10.5, fontWeight: '700', letterSpacing: 0.4, color: DR.text3 },
    droneHeader: {
      paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 30 : 8, paddingBottom: 10,
      backgroundColor: DR.surface, borderBottomWidth: 0.5, borderBottomColor: DR.separator,
      alignItems: 'center', justifyContent: 'flex-end', position: 'relative',
    },
    droneHeaderClose: { position: 'absolute', left: 16, bottom: 10 },
    droneHeaderScan: { position: 'absolute', right: 16, bottom: 10 },
    // Instrument scan: banner i formuläret, källväljare, datumväljare och läs-överlägg
    scanBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: accent + '55', backgroundColor: accent + '12', marginBottom: 6 },
    scanBannerText: { flex: 1, color: accent, fontSize: 12.5, fontWeight: '700' },
    scanBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
    scanCard: { width: '100%', maxWidth: 380, backgroundColor: DR.surface, borderRadius: 20, borderWidth: 1, borderColor: DR.border, paddingTop: 22, paddingBottom: 12, paddingHorizontal: 18 },
    scanTitle: { color: DR.text, fontSize: 18, fontWeight: '800', marginBottom: 6 },
    scanBody: { color: DR.text2, fontSize: 13.5, lineHeight: 19, marginBottom: 12 },
    scanRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: DR.border, backgroundColor: DR.elevated },
    scanRowActive: { borderColor: accent, backgroundColor: accent + '1A' },
    scanRowDate: { color: DR.text, fontSize: 14.5, fontWeight: '700' },
    scanRowMeta: { color: DR.text2, fontSize: 12, marginTop: 2 },
    scanRowWarn: { color: DR.warning, fontSize: 11, marginTop: 3 },
    scanLatest: { color: accent, fontSize: 9.5, fontWeight: '800', letterSpacing: 1, fontFamily: 'JetBrainsMono' },
    scanBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: accent, borderRadius: 13, paddingVertical: 13, marginTop: 8 },
    scanBtnText: { color: DR.inkOnAccent, fontSize: 15, fontWeight: '800' },
    scanCancel: { paddingVertical: 12, alignItems: 'center', marginTop: 2 },
    scanCancelText: { color: DR.text2, fontSize: 14, fontWeight: '700' },
    scanOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: 24, zIndex: 1000, elevation: 20 },
    // Exakt som pilot-manned add-flight: Georgia, 22/700, letterSpacing -0.6, capitalize.
    droneHeaderDate: { fontFamily: 'Georgia', fontSize: 22, fontWeight: '700', color: DR.text, letterSpacing: -0.6, textTransform: 'capitalize' },
    section: {
      color: DR.text2, fontSize: 11, fontWeight: '700',
      textTransform: 'uppercase', letterSpacing: 1, marginTop: 12,
    },
    label: {
      color: DR.text2, fontSize: 11, fontWeight: '600',
      textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8, marginBottom: 4,
    },
    field: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: DR.surface, borderRadius: 10,
      borderWidth: 1, borderColor: DR.border,
      paddingHorizontal: 12, paddingVertical: 12,
    },
    fieldText: { color: DR.text, fontSize: 14, fontWeight: '600' },
    input: {
      backgroundColor: DR.surface, borderRadius: 10,
      borderWidth: 1, borderColor: DR.border,
      color: DR.text, fontSize: 14,
      paddingHorizontal: 12, paddingVertical: 10,
    },
    iconBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 4,
      backgroundColor: accent + '18',
      borderRadius: 10, paddingHorizontal: 10,
      borderWidth: 1, borderColor: accent + '44',
    },
    iconBtnText: { color: accent, fontSize: 12, fontWeight: '700' },

    // ── Route-hero (Full) — speglar pilot-manned legRow/panels + total-hero ──
    routeCard: { marginTop: 4 },
    legRow: { flexDirection: 'row', alignItems: 'stretch' },
    // Route-hero 2×2-rutnät (Location/Dep-time | Flight-time/Total) + Add-flight-rad.
    gridCol: { flex: 1, minWidth: 0 },
    flightTimeBox: { justifyContent: 'center', alignItems: 'center', backgroundColor: DR.surface, borderRadius: 10, borderWidth: 1, borderColor: DR.border, paddingHorizontal: 8 },
    flightTimeInput: { fontFamily: FONT_LED7, fontSize: 24, fontWeight: '800', color: DR.text, textAlign: 'center', padding: 0, width: '100%' },
    flightTimePh: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
    flightTimePhText: { fontFamily: 'JetBrainsMono', fontSize: 14, fontWeight: '700', letterSpacing: 1.5, color: DR.muted },
    totalDisplayBox: { justifyContent: 'center', alignItems: 'center', borderRadius: 12, borderWidth: 1, borderColor: accent + '88', backgroundColor: accent + '0D' },
    totalDisplayValue: { fontFamily: FONT_LED7, fontSize: 26, fontWeight: '800', color: DR.text },
    addFlightBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 34, borderRadius: 10, borderWidth: 1, borderColor: accent + '66', backgroundColor: accent + '10' },
    addFlightBtnText: { color: accent, fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
    // Extra-flygningarnas rutor: lika stora som Total-rutan (height = timeBoxH inline) men ORANGE backdrop.
    extraFlightBox: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1.5, borderColor: DRONE_ORANGE, backgroundColor: DRONE_ORANGE + '26', paddingHorizontal: 8, marginBottom: 8 },
    extraFlightOrd: { width: 24, fontFamily: 'JetBrainsMono', fontSize: 9, fontWeight: '800', letterSpacing: 0.3, color: DRONE_ORANGE },
    extraFlightInputWrap: { flex: 1, justifyContent: 'center' },
    extraFlightInput: { fontFamily: FONT_LED7, fontSize: 24, fontWeight: '800', color: DR.text, textAlign: 'center', padding: 0, width: '100%' },
    extraFlightPhText: { fontFamily: 'JetBrainsMono', fontSize: 14, fontWeight: '700', letterSpacing: 1.5, color: DRONE_ORANGE + '99' },
    extraFlightRemove: { width: 24, alignItems: 'flex-end' },
    legPanelLeft: {
      flex: 1, gap: 6, backgroundColor: accent + '0D',
      borderWidth: 1, borderColor: DR.separator,
      borderTopLeftRadius: 12, borderBottomLeftRadius: 12, padding: 12,
    },
    legPanelRight: {
      flex: 1, gap: 6, backgroundColor: accent + '0D',
      borderWidth: 1, borderColor: DR.separator,
      borderTopRightRadius: 12, borderBottomRightRadius: 12, padding: 12,
    },
    // paddingTop 12 = panelernas padding → "1st flight" hamnar i höjd med DEPARTURE/ARRIVAL-texten.
    legConnector: { width: 58, alignItems: 'center', paddingTop: 12, paddingBottom: 0, paddingHorizontal: 2, backgroundColor: accent + '0D', borderTopWidth: 1, borderBottomWidth: 1, borderColor: DR.separator },
    legFlightLabel: { fontSize: 11, fontWeight: '800', color: accent, letterSpacing: 0.2, textAlign: 'center', textTransform: 'uppercase' },
    legNodeWrap: { flex: 1, justifyContent: 'center' },
    legNode: { width: 22, height: 22, borderRadius: 11, backgroundColor: DR.surface, borderWidth: 1, borderColor: accent + '88', alignItems: 'center', justifyContent: 'center' },
    placeColHeaderText: { color: DR.text, fontSize: 11, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', textAlign: 'center', marginBottom: 2 },
    // Place-ruta: en View med FAST höjd + overflow:hidden (klipper texten säkert, till skillnad
    // från overflow på själva TextInput:en). Höjd = dep/arr-tidrutorna. Bara texten krymper.
    legPlaceBox: {
      height: 50, borderRadius: 10, borderWidth: 1, borderColor: DR.border, backgroundColor: DR.surface,
      justifyContent: 'center', overflow: 'hidden', paddingHorizontal: 8,
    },
    legPlaceText: {
      color: DR.text, fontFamily: FONT_LED14, letterSpacing: 1, textAlign: 'center', padding: 0,
    },
    // Gemensam ram — samma bakgrund som dep/arr-panelerna (accent-transparent), som pilot-kortet
    frameCard: { backgroundColor: DR.surface, borderRadius: 10, borderWidth: 0.5, borderColor: DR.border, padding: 14, gap: 10, marginTop: 2 },
    obsClear: { position: 'absolute', right: 8, top: 0, bottom: 0, justifyContent: 'center' },
    obsDropdown: {
      position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 200,
      backgroundColor: DR.surface, borderRadius: 10, borderWidth: 1, borderColor: DR.border, overflow: 'hidden',
      shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 12,
    },
    obsItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, paddingHorizontal: 12, borderTopWidth: 0.5, borderTopColor: DR.separator },
    obsItemText: { flex: 1, color: DR.text, fontSize: 14, fontWeight: '600' },
    sameAsDep: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 2 },
    sameAsDepText: { color: accent, fontSize: 11, fontWeight: '700' },
    heroCol: { flex: 1, alignItems: 'center' },
    // Departure-fritext med dropdown-knapp inuti + lista med senaste 10 platserna
    depWrap: { position: 'relative' },
    depDropBtn: { position: 'absolute', right: 4, top: 0, bottom: 0, width: 24, alignItems: 'center', justifyContent: 'center' },
    depDropdown: {
      position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, zIndex: 200,
      backgroundColor: DR.surface, borderRadius: 10, borderWidth: 1, borderColor: DR.border, overflow: 'hidden',
      shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 8 }, elevation: 12,
    },
    depDropItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, paddingHorizontal: 12, borderTopWidth: 0.5, borderTopColor: DR.separator },
    depDropItemText: { flex: 1, color: DR.text, fontSize: 14, fontWeight: '600' },
    // Total- och Add-rutan delar stil (samma bg/storlek). Fast höjd → båda lika höga.
    totalHero: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 76, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, borderWidth: 1, borderColor: accent + '88', backgroundColor: accent + '0D', alignSelf: 'stretch' },
    // Halv-höjd + rad-layout när extra flygningar lagts till (räknare tar övre halvan).
    totalHeroHalf: { flex: 0, minHeight: 0, height: 38, paddingVertical: 4 },
    totalHeroRow: { flexDirection: 'row', gap: 6 },
    totalHeroInputHalf: { fontSize: 18, minWidth: 0, flex: 1, textAlign: 'left' },
    flightsCountWrap: { flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
    flightsCountText: { fontFamily: 'JetBrainsMono', fontSize: 12, fontWeight: '800', letterSpacing: 1, color: DR.text, textTransform: 'uppercase' },
    totalHeroValue: { fontFamily: FONT_LED7, fontSize: 28, fontWeight: '800', color: DR.text },
    totalHeroInput: { fontFamily: FONT_LED7, fontSize: 28, fontWeight: '800', color: DR.text, textAlign: 'center', minWidth: 130, padding: 0 },
    totalHeroLabel: { marginTop: 5, fontFamily: 'JetBrainsMono', fontSize: 9, fontWeight: '800', letterSpacing: 1.4, color: DR.text, textTransform: 'uppercase' },
    addConfirmBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8, backgroundColor: accent },
    addConfirmText: { color: DR.inkOnAccent, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },

    // ── Drönar-box (typ + registrering) + pilot function — speglar pilot log flight ──
    cardFieldLabel: { color: DR.text2, fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, marginTop: 2, marginBottom: 4 },
    pickBox: { flexDirection: 'row', alignItems: 'center', height: 44, paddingHorizontal: 11, backgroundColor: DR.elevated, borderWidth: 1, borderColor: DR.border, borderRadius: 10 },
    pickBoxTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, height: '100%' },
    pickBoxValue: { flex: 1, fontFamily: 'JetBrainsMono', fontSize: 16, fontWeight: '800', letterSpacing: 1, color: DR.text },
    pickBoxDivider: { width: 1, height: 20, backgroundColor: DR.border, marginHorizontal: 6 },
    ddFlyout: {
      position: 'absolute', top: '100%', marginTop: 4, zIndex: 50, elevation: 8,
      backgroundColor: DR.elevated, borderWidth: 1, borderColor: DR.border, borderRadius: 10, padding: 8,
      shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 10, shadowOffset: { width: 0, height: 6 },
    },
    ddEmpty: { fontFamily: 'JetBrainsMono', fontSize: 10, color: DR.muted, paddingVertical: 4 },
    ddChip: { backgroundColor: DR.surface, borderWidth: 1, borderColor: DR.border, borderRadius: 8, paddingHorizontal: 11, paddingVertical: 7, alignItems: 'center', justifyContent: 'center' },
    ddChipActive: { backgroundColor: accent + '24', borderColor: accent },
    ddChipText: { fontFamily: 'JetBrainsMono', fontSize: 12, fontWeight: '800', letterSpacing: 0.5, color: DR.text2 },
    ddChipTextActive: { color: accent },
    ddCell: { backgroundColor: DR.surface, borderWidth: 1, borderColor: DR.border, borderRadius: 7, paddingVertical: 6, alignItems: 'center', justifyContent: 'center' },
    ddCellText: { fontFamily: 'JetBrainsMono', fontSize: 9.5, fontWeight: '800', letterSpacing: 0.3, color: DR.text2 },
    droneMetaLine: { fontFamily: 'JetBrainsMono', fontSize: 11, color: DR.text3, marginTop: 6, letterSpacing: 0.3 },
    // Rubrik + i-knapp (Pilot function) — samma mått som cardFieldLabel ensam.
    labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, marginBottom: 4 },
    // "Other"-dropdownens rader (radio + etikett), = pilotläget
    ddRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 7 },
    ddRowText: { flex: 1, fontSize: 12.5, fontWeight: '600' },
    // Helskärms-info-sida (roller) — speglar pilotlägets infoPage-stilar i DR-tema
    infoPage: { flex: 1, backgroundColor: DR.background },
    infoPageHeader: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingLeft: 20, paddingRight: 12, paddingVertical: 12,
      borderBottomWidth: 1, borderBottomColor: DR.separator,
    },
    infoPageTitle: { flex: 1, color: DR.text, fontSize: 20, fontWeight: '700' },
    infoPageClose: {
      width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
      backgroundColor: DR.elevated, borderWidth: 1, borderColor: DR.border,
    },
    infoPageIntro: { color: DR.muted, fontSize: 14, lineHeight: 20, marginBottom: 18 },
    infoLogbook: { marginTop: 8, paddingLeft: 2, fontFamily: 'JetBrainsMono', fontSize: 10.5, fontWeight: '700', letterSpacing: 0.8, color: accent },
    roleGrid: { gap: 4 },
    roleRow: { flexDirection: 'row', gap: 4 },
    roleBtn: { flex: 1, minWidth: 0, alignItems: 'center', paddingVertical: 10, borderRadius: 10, backgroundColor: DR.elevated, borderWidth: 1, borderColor: DR.border },
    roleBtnActive: { backgroundColor: accent + '24', borderColor: accent },
    roleBtnText: { color: DR.text2, fontSize: 10.5, fontWeight: '700', fontFamily: 'JetBrainsMono', letterSpacing: 0.3 },
    roleBtnTextActive: { color: accent },
    // Pilot function (vänster) + vertikal flygläge-toggle (höger)
    pfRow: { flexDirection: 'row', gap: 6, alignItems: 'stretch' },
    modeVToggle: { flex: 1, gap: 4 },
    modeVBtn: { flex: 1, minHeight: 30, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4, borderRadius: 10, backgroundColor: DR.elevated, borderWidth: 1, borderColor: DR.border },
    modeVBtnActive: { backgroundColor: accent + '24', borderColor: accent },
    modeVBtnText: { color: DR.text2, fontSize: 10.5, fontWeight: '700', fontFamily: 'JetBrainsMono', letterSpacing: 0.5 },
    modeVBtnTextActive: { color: accent },
    // Mission (överst): label + fritextruta + dropdown
    missionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
    missionLabel: { color: DR.text2, fontSize: 13, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
    missionInputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: DR.surface, borderRadius: 10, borderWidth: 1, borderColor: DR.border, paddingLeft: 12, paddingRight: 4 },
    missionDropBtn: { padding: 6 },
    missionDropdown: { position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, backgroundColor: DR.elevated, borderRadius: 10, borderWidth: 1, borderColor: DR.border, zIndex: 200, elevation: 8, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
    missionDropItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 11, borderBottomWidth: 0.5, borderBottomColor: DR.separator },
    missionDropItemText: { color: DR.text, fontSize: 14, fontWeight: '600' },
    // Arrival-förslag (autofyllt dep): ✓/x inuti rutan
    arrSuggestBtns: { position: 'absolute', right: 4, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', gap: 2 },
    arrSuggestBtn: { width: 22, height: '100%', alignItems: 'center', justifyContent: 'center' },
    // Lokaltid/UTC-etikett under tidrutorna (= pilot)
    timeBelow: { textAlign: 'center', color: DR.text2, fontSize: 10, marginTop: 4 },
    // Natt-auto-knapp under natt-baren
    nightAutoBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 2, paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: accent + '55', backgroundColor: accent + '10' },
    nightAutoText: { color: accent, fontSize: 12, fontWeight: '700' },
    rulesExpandBtn: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DR.border, backgroundColor: DR.surface },
    // Reg-input-modal
    regBackdrop: { flex: 1, backgroundColor: '#000A', alignItems: 'center', justifyContent: 'center', padding: 24 },
    regSheet: { width: '100%', maxWidth: 360, backgroundColor: DR.surface, borderRadius: 16, borderWidth: 1, borderColor: DR.border, padding: 18 },
    regTitle: { color: DR.text, fontSize: 16, fontWeight: '800' },
    regSub: { color: DR.text2, fontSize: 12, marginTop: 2, marginBottom: 12 },
    regInput: { backgroundColor: DR.elevated, borderRadius: 10, borderWidth: 1, borderColor: DR.border, color: DR.text, fontSize: 15, fontWeight: '700', letterSpacing: 1, paddingHorizontal: 12, paddingVertical: 11 },
    regCancel: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: DR.border, backgroundColor: DR.elevated },
    regCancelText: { color: DR.text2, fontSize: 14, fontWeight: '700' },
    regAdd: { flex: 2, alignItems: 'center', paddingVertical: 12, borderRadius: 10, backgroundColor: accent },
    regAddText: { color: DR.inkOnAccent, fontSize: 14, fontWeight: '800' },

    segRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: {
      paddingHorizontal: 10, paddingVertical: 7, borderRadius: 7,
      backgroundColor: DR.elevated, borderWidth: 1, borderColor: DR.border,
    },
    chipActive: { backgroundColor: accent, borderColor: accent },
    chipText: { color: DR.muted, fontSize: 11, fontWeight: '700' },
    chipTextActive: { color: DR.inkOnAccent },
    toggle: {
      flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      paddingVertical: 10, borderRadius: 8,
      backgroundColor: DR.elevated, borderWidth: 1, borderColor: DR.border,
    },
    toggleActive: { backgroundColor: accent, borderColor: accent },
    toggleText: { color: DR.text2, fontSize: 12, fontWeight: '600' },
    toggleTextActive: { color: DR.inkOnAccent },
    saveBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: accent, borderRadius: 12,
      paddingVertical: 15, marginTop: 20,
    },
    saveBtnText: { color: DR.inkOnAccent, fontSize: 16, fontWeight: '700' },
    draftBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      paddingVertical: 13, marginTop: 10, borderRadius: 12,
      borderWidth: 1, borderColor: DR.border, backgroundColor: DR.elevated,
    },
    draftBtnText: { color: DR.text2, fontSize: 14.5, fontWeight: '700' },
    saveAgainBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
      paddingVertical: 12, marginTop: 8, borderRadius: 12,
      borderWidth: 1, borderColor: accent + '55', backgroundColor: accent + '10',
    },
    saveAgainText: { color: accent, fontSize: 13.5, fontWeight: '700' },
    modeToggle: {
      flexDirection: 'row', backgroundColor: DR.elevated, borderRadius: 10, padding: 3, gap: 3,
      borderWidth: 0.5, borderColor: DR.border, marginBottom: 4,
    },
    modeBtn: { flex: 1, paddingVertical: 8, borderRadius: 7, alignItems: 'center' },
    modeBtnActive: { backgroundColor: accent },
    modeBtnText: { color: DR.text2, fontSize: 13, fontWeight: '700' },
    modeBtnTextActive: { color: DR.inkOnAccent },
    ruleWarn: {
      flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10,
      paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10,
      borderWidth: 1, borderColor: DR.warning + '66', backgroundColor: DR.warning + '14',
    },
    ruleWarnText: { flex: 1, color: DR.warning, fontSize: 12, fontWeight: '600', lineHeight: 16 },
    modalBackdrop: { flex: 1, backgroundColor: '#000A', justifyContent: 'flex-end' },
    modalSheet: {
      backgroundColor: DR.surface, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 28,
      borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '70%',
    },
    datePickerSheet: {
      backgroundColor: DR.surface, paddingBottom: 24, paddingTop: 8,
      borderTopLeftRadius: 16, borderTopRightRadius: 16,
    },
    handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: DR.border, alignSelf: 'center', marginBottom: 10 },
    modalTitle: { color: DR.text, fontSize: 16, fontWeight: '700', marginBottom: 10 },
    modalRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      paddingVertical: 12, paddingHorizontal: 4,
      borderTopWidth: 0.5, borderTopColor: DR.separator,
    },
    modalRowTitle: { color: DR.text, fontSize: 14, fontWeight: '700' },
    modalRowMeta: { color: DR.text2, fontSize: 12, marginTop: 2 },
    emptyText: { color: DR.muted, fontSize: 13, paddingVertical: 20, textAlign: 'center' },
  });
}
