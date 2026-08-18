import { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, KeyboardAvoidingView, Platform, TextInput, Modal, Pressable,
  InputAccessoryView, Keyboard, ActivityIndicator, Animated, Easing,
} from 'react-native';
import { useRouter, useLocalSearchParams, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as Location from 'expo-location';
import { useTranslation } from '../../hooks/useTranslation';
import {
  listDrones, insertDroneFlight, getDroneFlights,
  getDroneFlightById, updateDroneFlight, getRecentDroneLocations, addDrone, updateDrone,
  type DroneRegistryEntry, type DroneFlightFormData, type DroneFlightMode,
} from '../../db/drones';
import { DroneModal } from '../../components/DroneModal';
import { SlideToggle } from '../../components/logflight/SlideToggle';
import { useDroneFlightStore } from '../../store/droneFlightStore';
import { decimalToMMSS, mmssToDecimal, decimalToHHMM } from '../../hooks/useTimeFormat';
import { SmartTimeInput, type SmartTimeInputHandle } from '../../components/SmartTimeInput';
import { calcFlightTime, isValidTime } from '../../utils/format';
import { FONT_LED7, FONT_LED14 } from '../../components/logflight/tokens';
import { DroneDurationInput } from '../../components/DroneDurationInput';
import { DroneCategoryPicker } from '../../components/DroneCategoryPicker';
import { usePilotTypeStore } from '../../store/pilotTypeStore';
import { useToastStore } from '../../components/Toast';
import { DR } from '../../constants/droneTheme';
import { Colors } from '../../constants/colors';
import { useDroneAccentStore } from '../../store/droneAccentStore';
import { useLanguageStore } from '../../store/languageStore';
import { classifySun, computeNightHoursTimed, type SunState } from '../../utils/dayNight';
import { buildInstants } from '../../utils/flightTime';
import { CondBar } from '../../components/logflight/CondBar';

const today = new Date().toISOString().split('T')[0];
const nowHHMM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const dateToHHMM = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const timeToDate = (hhmm?: string) => {
  const d = new Date();
  if (hhmm && /^\d{1,2}:\d{2}$/.test(hhmm)) {
    const [h, m] = hhmm.split(':').map(Number);
    d.setHours(h, m, 0, 0);
  }
  return d;
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
// Observer → remarks som "Observer: xxxx" (första raden). Strippar ev. gammal Observer-rad först.
const mergeObserverRemarks = (remarks: string, obs?: string): string => {
  const stripped = (remarks || '').replace(/(^|\n)\s*Observer:[^\n]*/gi, '\n').replace(/\n{2,}/g, '\n').trim();
  const name = (obs || '').trim();
  return name ? `Observer: ${name}${stripped ? '\n' + stripped : ''}` : stripped;
};
const stripObserverRemarks = (remarks: string): string =>
  (remarks || '').replace(/(^|\n)\s*Observer:[^\n]*/gi, '\n').replace(/\n{2,}/g, '\n').trim();

// Ordningstal (2nd, 3rd, 4th …) för "+ Add Nth flight".
const ordinal = (n: number) => { const s = ['th', 'st', 'nd', 'rd']; const v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };
// Dynamisk platstext-storlek (= pilot log flight): 19 (≤4 tecken) → 13 (≥12 tecken).
const placeFontSize = (v: string) => 19 - Math.max(0, Math.min(v.length, 12) - 4) * 0.75;

// Förvalda mission-typer — snabbval i Mission-dropdownen överst. Fritextrutan tillåter
// valfri egen text (mission_type = valfri sträng), så "Other" behövs inte längre.
const MISSION_TYPES = ['Inspection', 'Mapping', 'Photo / Video', 'SAR', 'Training', 'Testing', 'Recreation'];
const FLIGHT_MODES: DroneFlightMode[] = ['VLOS', 'EVLOS', 'BVLOS'];

export default function AddDroneFlightScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const params = useLocalSearchParams<{ id?: string }>();
  const editId = params.id ? parseInt(params.id, 10) : null;
  const isEdit = !!editId;
  const { t } = useTranslation();
  const { loadFlights, loadStats } = useDroneFlightStore();
  const pilotType = usePilotTypeStore((s) => s.pilotType);
  const accent = useDroneAccentStore((s) => s.color);
  const loadAccent = useDroneAccentStore((s) => s.load);
  const lang = useLanguageStore((s) => s.language);
  const styles = makeStyles(accent);

  const [form, setForm] = useState<DroneFlightFormData>({
    date: today,
    drone_id: null,
    location: '',
    takeoff_time: nowHHMM(),
    landing_location: '',
    mission_type: 'Inspection',
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
    remarks: '',
  });

  const [drones, setDrones] = useState<DroneRegistryEntry[]>([]);
  const [saving, setSaving] = useState(false);
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);
  // Drönar-box (typ + registrering) — dropdown-flikar + "+" öppnar drönar-modalen.
  const [typeOpen, setTypeOpen] = useState(false);
  const [regOpen, setRegOpen] = useState(false);
  const [showDroneModal, setShowDroneModal] = useState(false);
  const [pendingModel, setPendingModel] = useState<string | null>(null);
  // Pilot function (som pilot log flight): PIC / SIC / DUAL / INSTRUCTOR.
  const [role, setRole] = useState<'pic' | 'sic' | 'dual' | 'instructor'>('pic');
  const [passes, setPasses] = useState<string[]>(['']); // MM:SS per pass, max 5
  // Mission (överst): fritextruta + dropdown med förval (MISSION_TYPES).
  const [showMissionPicker, setShowMissionPicker] = useState(false);
  // Log Flight-lyft: Quicklog (default nya) ↔ Full · natt-auto (override via manuell tap)
  const [logFull, setLogFull] = useState(isEdit);
  const [nightManual, setNightManual] = useState(isEdit);
  const [nightAuto, setNightAuto] = useState<SunState | null>(null);
  const [showLandingPoint, setShowLandingPoint] = useState(false);
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
  const [nightAutoLoading, setNightAutoLoading] = useState(false);
  const [timeBoxH, setTimeBoxH] = useState(48); // uppmätt höjd på tidrutan → matchande rutor
  const [barsH, setBarsH] = useState(0);        // uppmätt höjd på kondition-barerna (reveal)
  const barsAnim = useRef(new Animated.Value(0)).current;
  const [recentPlaces, setRecentPlaces] = useState<string[]>([]);
  const [showDepDropdown, setShowDepDropdown] = useState(false);
  const depPlaceRef = useRef<TextInput>(null);
  const depTimeRef = useRef<SmartTimeInputHandle>(null);

  // MM:SS → timmar. Ett halvinmatat pass ("5", inga siffror efter kolon ännu) tolkas
  // som minuter så totalen växer direkt och save inte blockeras felaktigt (review-fynd #5).
  const passesToDecimal = (list: string[]) =>
    list.reduce((sum, p) => {
      if (!p) return sum;
      if (p.includes(':')) return sum + mmssToDecimal(p);
      const mins = parseInt(p, 10);
      return sum + (isNaN(mins) ? 0 : mins / 60);
    }, 0);

  const totalDecimal = passesToDecimal(passes);
  const totalDisplay = decimalToMMSS(totalDecimal);
  // Varaktighet (MM:SS, eller bara minuter innan kolon skrivits) → timmar.
  const durToDec = (d: string) => { if (!d) return 0; if (d.includes(':')) return mmssToDecimal(d); const n = parseInt(d, 10) || 0; return n / 60; };
  // Full: total = summan av flygningarnas varaktigheter (fullLegs). Quick: summan av passen.
  const fullTotalDecimal = fullLegs.reduce((s, d) => s + durToDec(d), 0);
  // Härledd ankomsttid (take-off + total) — bara för natt-auto-fönstret.
  const derivedArr = (isValidTime(form.takeoff_time ?? '') && fullTotalDecimal > 0)
    ? addHHMM(form.takeoff_time ?? '', fullTotalDecimal) : '';

  useEffect(() => {
    const next = logFull ? String(fullTotalDecimal) : String(totalDecimal);
    setForm((p) => (p.total_time === next ? p : { ...p, total_time: next }));
  }, [logFull, fullTotalDecimal, totalDecimal]);

  // Lokalläge: när flygdatum ändras → räkna om UTC ur lokalbufferten (DST kan skifta).
  useEffect(() => {
    if (timeMode !== 'local') return;
    if (isValidTime(depLocalBuf)) setForm((p) => ({ ...p, takeoff_time: localToUtc(form.date, depLocalBuf) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.date]);

  // Pilot function → tidshinkar: vald roll får hela totalen, övriga 0. PIC härleds i
  // droneToFlightRow som total − co_pilot_fpv − dual (instructor är egen kolumn/overlay).
  useEffect(() => {
    const tt = parseFloat(form.total_time) || 0;
    const s = (n: number) => (n > 0 ? String(n) : '');
    const next = role === 'sic' ? { co_pilot_fpv: s(tt), dual: '', instructor: '' }
      : role === 'dual' ? { co_pilot_fpv: '', dual: s(tt), instructor: '' }
      : role === 'instructor' ? { co_pilot_fpv: '', dual: '', instructor: s(tt) }
      : { co_pilot_fpv: '', dual: '', instructor: '' };
    setForm((p) => (p.co_pilot_fpv === next.co_pilot_fpv && p.dual === next.dual && p.instructor === next.instructor ? p : { ...p, ...next }));
  }, [role, form.total_time]);

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

  // Kondition-barerna animeras in när plats + take-off-tid + flygtid (>0) är ifyllda.
  const routeComplete = form.location.trim().length > 0
    && isValidTime(form.takeoff_time ?? '')
    && fullTotalDecimal > 0;
  useEffect(() => {
    Animated.timing(barsAnim, { toValue: routeComplete ? 1 : 0, duration: 320, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [routeComplete, barsAnim]);

  // (Gamla is_night-auto borttagen — natt hanteras nu av natt-kondition-baren + Auto-knappen.)

  // BVLOS/EVLOS antyder ofta start≠landning (leverans/korridor) → visa landningspunkt
  useEffect(() => {
    if (form.flight_mode === 'BVLOS' || form.flight_mode === 'EVLOS') setShowLandingPoint(true);
  }, [form.flight_mode]);

  useEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [isEdit]);

  useEffect(() => { loadAccent(); }, [loadAccent]);

  useEffect(() => {
    (async () => {
      const ds = await listDrones();
      setDrones(ds);
      getRecentDroneLocations(10).then(setRecentPlaces).catch(() => {});

      if (isEdit && editId) {
        const f = await getDroneFlightById(editId);
        if (!f) return;
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
          has_observer: !!f.has_observer,
          observer_name: f.observer_name || (f.remarks.match(/Observer:\s*([^\n]+)/i)?.[1]?.trim() ?? ''),
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
          remarks: stripObserverRemarks(f.remarks), // Observer visas i egen ruta, ej i remarks-rutan
        });
        if (f.landing_location) setShowLandingPoint(true);
        if (f.total_time > 0) setPasses([decimalToMMSS(f.total_time)]);
        // Full-heron: visa hela totalen som 1:a flygningens varaktighet (splitten är okänd vid redigering).
        setFullLegs([f.total_time > 0 ? decimalToMMSS(f.total_time) : '']);
        setRole(f.co_pilot_fpv ? 'sic' : f.dual ? 'dual' : f.instructor ? 'instructor' : 'pic');
        return;
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
            mission_type: last.mission_type || p.mission_type,
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
      category: d.category || p.category,
    }));
  };

  const useHere = async (target: 'start' | 'landing' = 'start') => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('permission_required'), 'Location permission required');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude: lat, longitude: lon } = pos.coords;
      let locName = '';
      try {
        const [geo] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lon });
        locName = geo?.city || geo?.district || geo?.region || '';
      } catch {}
      const name = locName || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
      if (target === 'landing') {
        setForm((p) => ({ ...p, landing_lat: lat, landing_lon: lon, landing_location: name }));
      } else {
        setForm((p) => ({ ...p, lat, lon, location: name }));
      }
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  // Natt-AUTO: hämta enhetens plats + räkna nattandel ur dep/arr-tid (UTC) för flygdagen.
  const computeNightAuto = async () => {
    if (!isValidTime(form.takeoff_time ?? '') || !derivedArr) {
      Alert.alert('Set times first', 'Enter take-off time and flight time before auto night.');
      return;
    }
    setNightAutoLoading(true);
    try {
      let lat = form.lat, lon = form.lon;
      if (lat == null || lon == null || (lat === 0 && lon === 0)) {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') { Alert.alert(t('permission_required'), 'Location permission required for auto night.'); return; }
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        lat = pos.coords.latitude; lon = pos.coords.longitude;
        setForm((p) => ({ ...p, lat, lon }));
      }
      const inst = buildInstants(form.date, form.takeoff_time ?? '', derivedArr, 0);
      if (!inst) return;
      const legs = [{ lat, lon }, { lat, lon }];
      const n = computeNightHoursTimed(legs, inst.dep.getTime(), inst.arr.getTime());
      setForm((p) => ({ ...p, night_time: n > 0 ? String(n) : '0' }));
    } catch (e: any) {
      Alert.alert(t('error'), e?.message ?? String(e));
    } finally {
      setNightAutoLoading(false);
    }
  };

  // Flygningarna matas som varaktighet (MM:SS) i fullLegs; totalen = summan. fullLegs[0] är
  // 1:a flygningen ("Flight time"); addLeg lägger till en extra flygning (redigerbar/ta bort).
  const addLeg = () => setFullLegs((ls) => [...ls, '']);
  const updateLeg = (i: number, raw: string) => {
    const d = raw.replace(/\D/g, '').slice(0, 4);
    const mmss = d.length === 0 ? '' : d.length <= 2 ? d : `${d.slice(0, d.length - 2)}:${d.slice(-2)}`;
    setFullLegs((ls) => ls.map((v, k) => (k === i ? mmss : v)));
  };
  const removeLeg = (i: number) => setFullLegs((ls) => ls.filter((_, k) => k !== i));

  // sameSession = spara och logga nästa flygning i samma pass: behåll drönare/plats/
  // uppdrag/kategori/läge, nollställ tid, stanna kvar.
  const save = async (sameSession = false) => {
    if (!form.drone_id) { Alert.alert(t('error'), t('drone_pick_required')); return; }
    if ((parseFloat(form.total_time) || 0) <= 0) { Alert.alert(t('error'), t('time_required')); return; }
    setSaving(true);
    // Observer läggs in i remarks som "Observer: xxxx" (loggbokens Remarks-kolumn).
    const dataToSave = { ...form, remarks: mergeObserverRemarks(form.remarks, form.observer_name) };
    try {
      if (isEdit && editId) {
        await updateDroneFlight(editId, dataToSave);
      } else {
        await insertDroneFlight(dataToSave);
      }
      await Promise.all([loadFlights(), loadStats()]);

      if (sameSession && !isEdit) {
        setPasses(['']);
        setFullLegs(['']); // route-heron: rensa flygtider → nästa flygning i passet börjar tomt
        setShowDepDropdown(false); setDepLocalBuf(''); setCondRaw({});
        setForm((p) => ({
          ...p,
          takeoff_time: nowHHMM(),
          total_time: '0',
          max_altitude_m: '',
          night_time: '', vfr: '', // ny flygning i passet → nollställ kondition-tider
          remarks: '',
        }));
        useToastStore.getState().show('Flight saved — logging next in session');
        return;
      }
      router.back();
    } catch (e: any) {
      Alert.alert(t('error'), e.message);
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
    if (matches.length === 1) { setPendingModel(null); await setDrone(matches[0]); }
    else { setPendingModel(m); setForm((p) => ({ ...p, drone_id: null })); }
  };
  const selectReg = async (rg: string) => {
    setRegOpen(false);
    const entry = drones.find((d) => d.model === curModel && d.registration === rg);
    if (entry) { setPendingModel(null); await setDrone(entry); }
  };
  // Z/L-växling: fyll lokalbufferten ur UTC vid byte till local.
  const toggleTimeMode = () => {
    setTimeMode((m) => {
      if (m === 'local') return 'utc';
      setDepLocalBuf(utcToLocal(form.date, form.takeoff_time ?? ''));
      return 'local';
    });
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
  };

  return (
    <>
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'android' ? 'height' : undefined}>
      {/* Custom serif-datum-header (speglar manned add-flight) */}
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
      </TouchableOpacity>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        scrollEnabled={!scrollLocked}
      >
        {/* Quicklog ↔ Full (speglar manned) — döljs vid redigering */}
        {!isEdit && (
          <View style={styles.modeToggle}>
            {(['quick', 'full'] as const).map((m) => {
              const active = (m === 'full') === logFull;
              return (
                <TouchableOpacity
                  key={m}
                  style={[styles.modeBtn, active && styles.modeBtnActive]}
                  onPress={() => setLogFull(m === 'full')}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.modeBtnText, active && styles.modeBtnTextActive]}>
                    {m === 'quick' ? 'Quicklog' : 'Full'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        {/* Mission — överst (under Quicklog/Full): label + fritextruta + dropdown med förval.
            Fritexten ersätter den gamla "Other"-knappen; dropdownen ger snabbval. */}
        <View style={[styles.missionRow, showMissionPicker && { zIndex: 200 }]}>
          <Text style={styles.missionLabel}>Mission</Text>
          <View style={{ flex: 1, position: 'relative' }}>
            <View style={styles.missionInputWrap}>
              <TextInput
                style={styles.missionInput}
                value={form.mission_type}
                onChangeText={(v) => setForm((p) => ({ ...p, mission_type: v }))}
                onFocus={() => setShowMissionPicker(false)}
                placeholder="Type of mission"
                placeholderTextColor={DR.muted}
                autoCapitalize="sentences"
              />
              <TouchableOpacity style={styles.missionDropBtn} onPress={() => { Keyboard.dismiss(); setShowMissionPicker((v) => !v); }} hitSlop={8} activeOpacity={0.7}>
                <Ionicons name={showMissionPicker ? 'chevron-up' : 'chevron-down'} size={16} color={accent} />
              </TouchableOpacity>
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
        </View>

        {/* ── Route-hero (Full): 2×2-rutnät — Location + Flight time (uppe), Departure time +
            Total flight time (nere) — plus en Add-flight-rad med redigerbara extra-flight-chip. ── */}
        {logFull && (
          <View style={styles.routeCard}>

            {/* Route-hero (Full): 2×2 — Location + Flight time (uppe), Departure time + Total (nere) */}
            <View style={[styles.legRow, showDepDropdown && { zIndex: 100 }]}>
              {/* Vänster kolumn: Location + Departure time */}
              <View style={styles.gridCol}>
                <Text style={styles.placeColHeaderText}>{t('location')}</Text>
                <View style={styles.depWrap}>
                  <View style={[styles.legPlaceBox, { height: timeBoxH }, recentPlaces.length > 0 && { paddingRight: 26 }]}>
                    <TextInput
                      ref={depPlaceRef}
                      style={[styles.legPlaceText, { fontSize: placeFontSize(form.location) }]}
                      value={form.location}
                      onChangeText={(v) => setForm((p) => ({ ...p, location: v }))}
                      onFocus={() => setShowDepDropdown(false)}
                      placeholder="—"
                      placeholderTextColor={DR.muted}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      returnKeyType="next"
                      blurOnSubmit={false}
                      multiline={false}
                      numberOfLines={1}
                      onSubmitEditing={() => depTimeRef.current?.focus()}
                    />
                  </View>
                  {recentPlaces.length > 0 && (
                    <TouchableOpacity style={styles.depDropBtn} onPress={() => { Keyboard.dismiss(); setShowDepDropdown((v) => !v); }} hitSlop={8} activeOpacity={0.7}>
                      <Ionicons name={showDepDropdown ? 'chevron-up' : 'chevron-down'} size={16} color={accent} />
                    </TouchableOpacity>
                  )}
                  {showDepDropdown && recentPlaces.length > 0 && (
                    <View style={styles.depDropdown}>
                      <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 220 }}>
                        {recentPlaces.slice(0, 10).map((rp) => (
                          <TouchableOpacity
                            key={rp}
                            style={styles.depDropItem}
                            onPress={() => { setForm((p) => ({ ...p, location: rp })); setShowDepDropdown(false); setTimeout(() => depTimeRef.current?.focus(), 60); }}
                            activeOpacity={0.7}
                          >
                            <Ionicons name="location-outline" size={13} color={DR.muted} />
                            <Text style={styles.depDropItemText} numberOfLines={1}>{rp}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}
                </View>
                <Text style={[styles.placeColHeaderText, { marginTop: 8 }]}>Departure time</Text>
                {/* onLayout mäter BARA tidrutan (ej lokaltid-texten) → alla fyra rutor lika höga. */}
                <View onLayout={(e) => { const h = e.nativeEvent.layout.height; if (h > 0 && Math.abs(h - timeBoxH) > 1) setTimeBoxH(h); }}>
                  <SmartTimeInput
                    ref={depTimeRef}
                    label=""
                    align="center"
                    compactRight
                    inputFontFamily={FONT_LED7}
                    value={timeMode === 'utc' ? (form.takeoff_time ?? '') : depLocalBuf}
                    onChangeText={(v) => { if (timeMode === 'utc') setForm((p) => ({ ...p, takeoff_time: v })); else onDepLocalChange(v); }}
                    rightAdornment={
                      <Pressable onPress={toggleTimeMode} hitSlop={10} style={{ paddingHorizontal: 4, paddingVertical: 2 }}>
                        <Text style={{ fontFamily: FONT_LED14, fontSize: 15, fontWeight: '700', color: accent }}>{timeMode === 'utc' ? 'Z' : 'L'}</Text>
                      </Pressable>
                    }
                  />
                </View>
                {isValidTime(form.takeoff_time ?? '') && (
                  <Text style={styles.timeBelow} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                    {timeMode === 'utc' ? `${utcToLocal(form.date, form.takeoff_time ?? '')} local` : `${form.takeoff_time} UTC`}
                  </Text>
                )}
              </View>

              <View style={{ width: 12 }} />

              {/* Höger kolumn: Flight time (1:a flygningen) + Total flight time (display) */}
              <View style={styles.gridCol}>
                <Text style={styles.placeColHeaderText}>Flight time</Text>
                <View style={[styles.flightTimeBox, { height: timeBoxH }]}>
                  <TextInput
                    style={styles.flightTimeInput}
                    value={fullLegs[0]}
                    onChangeText={(raw) => updateLeg(0, raw)}
                    keyboardType="number-pad"
                    inputAccessoryViewID="drone-add-done"
                  />
                  {/* Ren placeholder (DSEG7-fonten kan inte rendera bokstäver → egen "mm:ss") */}
                  {!fullLegs[0] ? (
                    <View style={styles.flightTimePh} pointerEvents="none"><Text style={styles.flightTimePhText}>mm:ss</Text></View>
                  ) : null}
                </View>
                <Text style={[styles.placeColHeaderText, { marginTop: 8 }]}>Total flight time</Text>
                <View style={[styles.totalDisplayBox, { height: timeBoxH }]}>
                  <Text style={styles.totalDisplayValue}>{fullTotalDecimal > 0 ? decimalToHHMM(fullTotalDecimal) : '--:--'}</Text>
                </View>
              </View>
            </View>

            {/* Under: "Add Nth flight" (vänster, halv höjd) + extra-flight-chip (höger, redigerbara/tag bort) */}
            <View style={[styles.legRow, { marginTop: 10, alignItems: 'flex-start' }]}>
              <TouchableOpacity style={styles.addFlightBtn} onPress={addLeg} activeOpacity={0.85}>
                <Ionicons name="add" size={16} color={accent} />
                <Text style={styles.addFlightBtnText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{`Add ${ordinal(fullLegs.length + 1)} flight`}</Text>
              </TouchableOpacity>
              <View style={{ width: 8 }} />
              <View style={styles.extraChipsWrap}>
                {fullLegs.slice(1).map((leg, idx) => {
                  const i = idx + 1;
                  return (
                    <View key={i} style={styles.extraChip}>
                      <Text style={styles.extraChipOrd}>{ordinal(i + 1)}</Text>
                      <TextInput
                        style={styles.extraChipInput}
                        value={leg}
                        onChangeText={(raw) => updateLeg(i, raw)}
                        placeholder="MM:SS"
                        keyboardType="number-pad"
                        placeholderTextColor={DR.muted}
                        inputAccessoryViewID="drone-add-done"
                      />
                      <TouchableOpacity onPress={() => removeLeg(i)} hitSlop={6} activeOpacity={0.7}>
                        <Ionicons name="close-circle" size={16} color={DR.danger} />
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            </View>

            {/* ── Flygregler (VFR / Y·Z / IFR) alltid synlig; barerna animeras in när plats + tid + flygtid ifyllda ── */}
            <View style={{ marginTop: 16 }}>
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

              <Animated.View style={
                barsH === 0
                  ? { position: 'absolute', left: 0, right: 0, opacity: 0 } // mät-pass: naturlig höjd, ur flödet
                  : { height: barsAnim.interpolate({ inputRange: [0, 1], outputRange: [0, barsH] }), opacity: barsAnim, overflow: 'hidden' }
              }>
              <View onLayout={(e) => { const h = e.nativeEvent.layout.height; if (h > 0 && barsH === 0) setBarsH(h); }}>
              {(() => {
                const total = parseFloat(form.total_time) || 0;
                const totalMin = total * 60;
                const pct = (v?: string) => { const n = parseFloat(v ?? '0') || 0; return total > 0 ? Math.round((n / total) * 100) : 0; };
                const cap = (n: number) => Math.min(Math.max(0, n), total || n);
                const setVfrIfr = (key: 'vfr' | 'ifr', p: number) => {
                  const val = total * p / 100;
                  const ifrV = key === 'ifr' ? val : Math.max(0, total - val);
                  const vfrV = Math.max(0, total - ifrV);
                  const eps = 0.01;
                  const rules = ifrV >= total - eps ? 'IFR' : (ifrV <= eps ? 'VFR' : 'Y');
                  setForm((prev) => ({ ...prev, ifr: ifrV.toFixed(2), vfr: vfrV.toFixed(2), flight_rules: rules }));
                };
                const fmtInput = (dec?: string) => { const n = parseFloat(dec ?? ''); return (!n || isNaN(n)) ? '' : decimalToHHMM(n); };
                const parseRaw = (raw: string): number => {
                  if (!raw.trim()) return 0;
                  if (raw.includes(':')) { const [h, m] = raw.split(':'); return (parseInt((h || '0').replace(/\D/g, '') || '0', 10) || 0) + Math.min(59, parseInt((m || '0').replace(/\D/g, '') || '0', 10) || 0) / 60; }
                  const d = raw.replace(/\D/g, ''); if (!d) return 0; if (d.length <= 2) return (Math.min(59, parseInt(d, 10) || 0)) / 60; return (parseInt(d.slice(0, -2), 10) || 0) + Math.min(59, parseInt(d.slice(-2), 10) || 0) / 60;
                };
                const fmtDur = (raw: string) => { const d = raw.replace(/\D/g, '').slice(0, 4); return d.length <= 2 ? d : `${d.slice(0, -2)}:${d.slice(-2)}`; };
                const onTime = (key: 'vfr' | 'ifr' | 'night_time', raw: string) => {
                  const f = fmtDur(raw);
                  setCondRaw((r) => ({ ...r, [key]: f }));
                  const dec = cap(parseRaw(f));
                  if (key === 'vfr') setVfrIfr('vfr', total > 0 ? dec / total * 100 : 0);
                  else if (key === 'ifr') setVfrIfr('ifr', total > 0 ? dec / total * 100 : 0);
                  else setForm((p) => ({ ...p, night_time: String(dec) }));
                };
                const onBlur = (key: string) => setCondRaw((r) => { const n = { ...r }; delete n[key]; return n; });
                const valFor = (key: 'vfr' | 'ifr' | 'night_time', dec?: string) => condRaw[key] !== undefined ? condRaw[key]! : fmtInput(dec);
                const lock = () => setScrollLocked(true); const unlock = () => setScrollLocked(false);
                return (
                  <View style={{ marginTop: 12 }}>
                    <CondBar label="VFR" pct={pct(form.vfr)} onPct={(p) => setVfrIfr('vfr', p)} tint={Colors.success} totalMin={totalMin} onGrab={lock} onRelease={unlock}
                      editable timeValue={valFor('vfr', form.vfr)} onTimeChange={(raw) => onTime('vfr', raw)} onTimeBlur={() => onBlur('vfr')} />
                    <CondBar label="IFR" pct={pct(form.ifr)} onPct={(p) => setVfrIfr('ifr', p)} tint={accent} totalMin={totalMin} onGrab={lock} onRelease={unlock}
                      editable timeValue={valFor('ifr', form.ifr)} onTimeChange={(raw) => onTime('ifr', raw)} onTimeBlur={() => onBlur('ifr')} />
                    <CondBar label={t('night')} pct={pct(form.night_time)} onPct={(p) => setForm((prev) => ({ ...prev, night_time: String(total * p / 100) }))} tint="#5DA9FF" totalMin={totalMin} onGrab={lock} onRelease={unlock}
                      editable timeValue={valFor('night_time', form.night_time)} onTimeChange={(raw) => onTime('night_time', raw)} onTimeBlur={() => onBlur('night_time')} />
                    <TouchableOpacity onPress={computeNightAuto} disabled={nightAutoLoading} activeOpacity={0.8} style={styles.nightAutoBtn}>
                      {nightAutoLoading ? <ActivityIndicator size="small" color={accent} /> : <Ionicons name="moon" size={13} color={accent} />}
                      <Text style={styles.nightAutoText}>{nightAutoLoading ? 'Computing…' : 'Auto night — use my location'}</Text>
                    </TouchableOpacity>
                  </View>
                );
              })()}
              </View>
              </Animated.View>
            </View>
          </View>
        )}

        {/* Gemensam ram (som pilot): drönare + registrering + pilot function + flygläge + observer */}
        <View style={[styles.frameCard, (typeOpen || regOpen) ? { zIndex: 20 } : null]}>
        {/* Drönare: modell + registrering (dropdown-flikar; "+" öppnar drönar-modalen) */}
        <View style={{ position: 'relative', zIndex: (typeOpen || regOpen) ? 30 : undefined }}>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1.1 }}>
              <Text style={styles.cardFieldLabel}>Drone</Text>
              <View style={styles.pickBox}>
                <TouchableOpacity style={styles.pickBoxTap} onPress={() => { setRegOpen(false); setTypeOpen((o) => !o); }} activeOpacity={0.7}>
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
                <TouchableOpacity style={styles.pickBoxTap} onPress={() => { if (!curModel) { Alert.alert('Select a drone first', 'Pick a model before its registration.'); return; } setTypeOpen(false); setRegOpen((o) => !o); }} activeOpacity={0.7}>
                  <Text style={[styles.pickBoxValue, !selectedDrone?.registration && { color: DR.muted }]} numberOfLines={1}>{selectedDrone?.registration || 'Reg / S/N'}</Text>
                  <Ionicons name={regOpen ? 'chevron-up' : 'chevron-down'} size={15} color={DR.text2} />
                </TouchableOpacity>
                <View style={styles.pickBoxDivider} />
                <TouchableOpacity onPress={() => { setRegOpen(false); if (!curModel) { setShowDroneModal(true); } else { setRegInput(''); setShowRegInput(true); } }} hitSlop={{ top: 10, bottom: 10, left: 6, right: 6 }} activeOpacity={0.7}>
                  <Ionicons name="add" size={18} color={accent} />
                </TouchableOpacity>
              </View>
            </View>
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

        {/* Pilot function (= pilot log flight): PIC / SIC / DUAL / INSTRUCTOR (vänster, smalare)
            + vertikal flygläge-toggle (VLOS/EVLOS/BVLOS) till höger om SIC/INSTRUCTOR. */}
        <Text style={[styles.cardFieldLabel, { marginTop: 10 }]}>Pilot function</Text>
        <View style={styles.pfRow}>
          <View style={[styles.roleGrid, { flex: 2 }]}>
            <View style={styles.roleRow}>
              {(['pic', 'sic'] as const).map((r) => (
                <TouchableOpacity key={r} style={[styles.roleBtn, role === r && styles.roleBtnActive]} onPress={() => setRole(r)} activeOpacity={0.75}>
                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.roleBtnText, role === r && styles.roleBtnTextActive]}>{r.toUpperCase()}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.roleRow}>
              {(['dual', 'instructor'] as const).map((r) => (
                <TouchableOpacity key={r} style={[styles.roleBtn, role === r && styles.roleBtnActive]} onPress={() => setRole(r)} activeOpacity={0.75}>
                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.roleBtnText, role === r && styles.roleBtnTextActive]}>{r === 'instructor' ? 'INSTRUCTOR' : 'DUAL'}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={styles.modeVToggle}>
            {FLIGHT_MODES.map((m) => {
              const active = form.flight_mode === m;
              return (
                <TouchableOpacity key={m} style={[styles.modeVBtn, active && styles.modeVBtnActive]} onPress={() => setForm((p) => ({ ...p, flight_mode: m }))} activeOpacity={0.8}>
                  <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={[styles.modeVBtnText, active && styles.modeVBtnTextActive]}>{m}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Observer — ren textruta. Texten hamnar i remarks som "Observer: xxxx" vid spar. */}
        <Text style={[styles.cardFieldLabel, { marginTop: 12 }]}>Observer</Text>
        <TextInput
          style={styles.input}
          value={form.observer_name}
          onChangeText={(v) => setForm((p) => ({ ...p, observer_name: v, has_observer: v.trim().length > 0 }))}
          placeholder="Observer name (optional)"
          placeholderTextColor={DR.muted}
          autoCapitalize="words"
        />
        </View>{/* /gemensam ram */}

        {/* Plats + take-off-tid (Quicklog) — i Full sköts detta av route-heron ovan. */}
        {!logFull && (<>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.label}>{t('location')}</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={form.location}
                onChangeText={(v) => setForm((p) => ({ ...p, location: v }))}
                placeholder={t('location_ph')}
                placeholderTextColor={DR.muted}
              />
              <TouchableOpacity style={styles.iconBtn} onPress={() => useHere('start')} activeOpacity={0.7}>
                <Ionicons name="location" size={16} color={accent} />
                <Text style={styles.iconBtnText}>{t('here')}</Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={{ width: 96 }}>
            <Text style={styles.label}>Take-off</Text>
            <TouchableOpacity style={[styles.input, { justifyContent: 'center' }]} onPress={() => setShowTime(true)} activeOpacity={0.7}>
              <Text style={[styles.fieldText, !form.takeoff_time && { color: DR.muted }]}>
                {form.takeoff_time || '--:--'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Landningspunkt (BVLOS/korridor) — expanderbar */}
        {showLandingPoint ? (
          <View style={{ marginTop: 4 }}>
            <Text style={styles.label}>Landing point (if different)</Text>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <TextInput
                style={[styles.input, { flex: 1 }]}
                value={form.landing_location}
                onChangeText={(v) => setForm((p) => ({ ...p, landing_location: v }))}
                placeholder="Same as take-off"
                placeholderTextColor={DR.muted}
              />
              <TouchableOpacity style={styles.iconBtn} onPress={() => useHere('landing')} activeOpacity={0.7}>
                <Ionicons name="location" size={16} color={accent} />
                <Text style={styles.iconBtnText}>{t('here')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity onPress={() => setShowLandingPoint(true)} activeOpacity={0.7} style={{ marginTop: 6, alignSelf: 'flex-start' }}>
            <Text style={{ color: accent, fontSize: 12, fontWeight: '600' }}>+ Different landing point</Text>
          </TouchableOpacity>
        )}
        </>)}

        <Text style={styles.section}>{t('operation')}</Text>
        <Text style={styles.label}>{t('drone_category')}</Text>
        <DroneCategoryPicker
          pilotType={pilotType}
          value={form.category}
          onChange={(v) => setForm((p) => ({ ...p, category: v as any }))}
        />

        {/* Operation: privat/kommersiell → loggbokens "Type and Cat of mission" (PRI/COM) */}
        <Text style={styles.label}>Operation</Text>
        <View style={styles.segRow}>
          {([['PRI', 'Private'], ['COM', 'Commercial']] as const).map(([k, lbl]) => (
            <TouchableOpacity key={k}
              style={[styles.chip, form.operation_type === k && styles.chipActive]}
              onPress={() => setForm((p) => ({ ...p, operation_type: p.operation_type === k ? '' : k }))}>
              <Text style={[styles.chipText, form.operation_type === k && styles.chipTextActive]}>{lbl}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Flygläge (VLOS/EVLOS/BVLOS) flyttat till glidande toggle under Pilot function. */}

        {/* Max-höjd (Full) — flyttad hit då passes-sektionen bara gäller Quicklog. */}
        {logFull && (
          <>
            <Text style={styles.label}>{t('max_altitude')}</Text>
            <TextInput
              style={styles.input}
              value={form.max_altitude_m}
              onChangeText={(v) => setForm((pp) => ({ ...pp, max_altitude_m: v.replace(/\D/g, '') }))}
              placeholder="120"
              keyboardType="number-pad"
              placeholderTextColor={DR.muted}
              inputAccessoryViewID="drone-add-done"
            />
          </>
        )}

        {/* Flygtid via passes — endast Quicklog. Full räknar total ur dep→arr (route-heron ovan). */}
        {!logFull && (<>
        <Text style={styles.section}>{t('flight_time_section')}</Text>
        <View style={{ gap: 10 }}>
          {passes.map((p, idx) => (
            <View key={idx} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-end' }}>
              <DroneDurationInput
                label={`${t('pass')} ${idx + 1}`}
                value={p}
                onChangeText={(mmss) => setPasses((prev) => prev.map((v, i) => i === idx ? mmss : v))}
                inputAccessoryViewID="drone-add-done"
              />
              {passes.length > 1 && (
                <TouchableOpacity
                  onPress={() => setPasses((prev) => prev.filter((_, i) => i !== idx))}
                  style={{
                    width: 44, height: 44, borderRadius: 10,
                    backgroundColor: DR.danger + '14', borderWidth: 0.5, borderColor: DR.danger + '55',
                    alignItems: 'center', justifyContent: 'center', marginBottom: 0,
                  }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="close" size={18} color={DR.danger} />
                </TouchableOpacity>
              )}
              {idx === 0 && passes.length === 1 && (
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>{t('max_altitude')}</Text>
                  <TextInput
                    style={styles.input}
                    value={form.max_altitude_m}
                    onChangeText={(v) => setForm((pp) => ({ ...pp, max_altitude_m: v.replace(/\D/g, '') }))}
                    placeholder="120"
                    keyboardType="number-pad"
                    placeholderTextColor={DR.muted}
                    inputAccessoryViewID="drone-add-done"
                  />
                </View>
              )}
            </View>
          ))}

          {/* Fet totalbar under sista passet — färgsatt efter valt tema */}
          <View style={{
            marginTop: 4,
            borderRadius: 14,
            backgroundColor: accent + '1F',
            borderWidth: 1.5,
            borderColor: accent,
            paddingHorizontal: 16,
            paddingVertical: 14,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            shadowColor: accent,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.35,
            shadowRadius: 10,
            elevation: 4,
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <View style={{
                width: 28, height: 28, borderRadius: 14,
                backgroundColor: accent + '33',
                alignItems: 'center', justifyContent: 'center',
                borderWidth: 1, borderColor: accent + '88',
              }}>
                <Ionicons name="stopwatch" size={15} color={accent} />
              </View>
              <Text style={{
                color: accent,
                fontSize: 11,
                fontWeight: '900',
                letterSpacing: 2,
                textTransform: 'uppercase',
              }}>
                {t('flight_time_section')}
              </Text>
            </View>
            <Text style={{
              color: accent,
              fontSize: 26,
              fontWeight: '900',
              fontFamily: 'Menlo',
              letterSpacing: 2,
              fontVariant: ['tabular-nums'],
              textShadowColor: accent + '55',
              textShadowOffset: { width: 0, height: 0 },
              textShadowRadius: 6,
            }}>
              {totalDisplay}
            </Text>
          </View>

          {passes.length < 5 && (
            <TouchableOpacity
              onPress={() => setPasses((prev) => [...prev, ''])}
              style={{
                flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                gap: 6, paddingVertical: 10, borderRadius: 10,
                borderWidth: 1, borderColor: accent + '66', borderStyle: 'dashed',
                backgroundColor: accent + '0E',
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="add" size={16} color={accent} />
              <Text style={{ color: accent, fontSize: 13, fontWeight: '700' }}>{t('add_pass')}</Text>
            </TouchableOpacity>
          )}

          {passes.length > 1 && (
            <View>
              <Text style={styles.label}>{t('max_altitude')}</Text>
              <TextInput
                style={styles.input}
                value={form.max_altitude_m}
                onChangeText={(v) => setForm((pp) => ({ ...pp, max_altitude_m: v.replace(/\D/g, '') }))}
                placeholder="120"
                keyboardType="number-pad"
                placeholderTextColor={DR.muted}
                inputAccessoryViewID="drone-add-done"
              />
            </View>
          )}
        </View>
        </>)}

        {/* 120 m-regelvarning: höjd över Open-taket i A1/A2/A3 → Specific krävs */}
        {(() => {
          const alt = parseInt(form.max_altitude_m, 10) || 0;
          const isOpen = ['A1', 'A2', 'A3'].includes(form.category);
          if (alt <= OPEN_ALT_LIMIT_M || !isOpen) return null;
          return (
            <View style={styles.ruleWarn}>
              <Ionicons name="warning" size={14} color={DR.warning} />
              <Text style={styles.ruleWarnText}>
                {alt} m exceeds the {OPEN_ALT_LIMIT_M} m Open-category limit — this needs a Specific authorisation.
              </Text>
            </View>
          );
        })()}

        {/* Natt + observer hanteras nu i route-kortet (natt-bar) resp. den gemensamma ramen ovan. */}

        {/* Loggboksfält (Full): landningar D/N + pilot-funktion + IFR + vind */}
        {logFull && (
          <>
            <Text style={styles.section}>Logbook fields</Text>

            <Text style={styles.label}>Landings (Day / Night)</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <TextInput style={styles.input} value={form.landings_day}
                  onChangeText={(v) => setForm((p) => ({ ...p, landings_day: v.replace(/\D/g, '') }))}
                  placeholder="Day" keyboardType="number-pad" placeholderTextColor={DR.muted} inputAccessoryViewID="drone-add-done" />
              </View>
              <View style={{ flex: 1 }}>
                <TextInput style={styles.input} value={form.landings_night}
                  onChangeText={(v) => setForm((p) => ({ ...p, landings_night: v.replace(/\D/g, '') }))}
                  placeholder="Night" keyboardType="number-pad" placeholderTextColor={DR.muted} inputAccessoryViewID="drone-add-done" />
              </View>
            </View>

            {/* Pilot-funktion (PIC/SIC/DUAL/INSTRUCTOR) sätts i väljaren ovan → co_pilot_fpv/dual/instructor. */}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>IFR (h)</Text>
                <TextInput style={styles.input} value={form.ifr}
                  onChangeText={(v) => setForm((p) => ({ ...p, ifr: v.replace(/[^\d.]/g, '') }))}
                  placeholder="0" keyboardType="decimal-pad" placeholderTextColor={DR.muted} inputAccessoryViewID="drone-add-done" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Wind (m/s)</Text>
                <TextInput style={styles.input} value={form.wind_ms}
                  onChangeText={(v) => setForm((p) => ({ ...p, wind_ms: v.replace(/[^\d.]/g, '') }))}
                  placeholder="e.g. 6" keyboardType="decimal-pad" placeholderTextColor={DR.muted} inputAccessoryViewID="drone-add-done" />
              </View>
            </View>
          </>
        )}

        {logFull && (<>
        <Text style={styles.section}>{t('remarks')}</Text>
        <TextInput
          style={[styles.input, { minHeight: 70, textAlignVertical: 'top' }]}
          value={form.remarks}
          onChangeText={(v) => setForm((p) => ({ ...p, remarks: v }))}
          placeholder={t('notes_ph')}
          placeholderTextColor={DR.muted}
          multiline
        />
        {(() => {
          const suggestions: string[] = [];
          // Uppdragsspecifika
          if (form.mission_type === 'Inspection') suggestions.push('Object: ', 'Client: ');
          if (form.mission_type === 'Mapping') suggestions.push('Area: ', 'GSD: ');
          if (form.mission_type === 'Photo / Video') suggestions.push('Client: ');
          if (form.mission_type === 'SAR') suggestions.push('Mission: ', 'Target: ');
          if (form.mission_type === 'Training') suggestions.push('Exercise: ');
          if (form.mission_type === 'Testing') suggestions.push('Test: ');
          // Flyglägen / kategori
          if (form.flight_mode === 'BVLOS' || form.flight_mode === 'EVLOS') suggestions.push('Weather: ');
          if (form.category === 'Specific' || form.category === 'Certified') suggestions.push('OA: ');
          if (form.is_night) suggestions.push('Light: ');
          if (form.has_observer) suggestions.push('Observer role: ');
          suggestions.push('Incident: ');

          const unique = [...new Set(suggestions)].slice(0, 3);
          if (unique.length === 0) return null;
          return (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }} keyboardShouldPersistTaps="always">
              {unique.map((s) => (
                <TouchableOpacity
                  key={s}
                  style={[styles.chip, { marginRight: 6 }]}
                  onPress={() => setForm((p) => ({ ...p, remarks: p.remarks ? `${p.remarks.trimEnd()} · ${s}` : s }))}
                  activeOpacity={0.7}
                >
                  <Ionicons name="add" size={10} color={accent} style={{ marginRight: 4 }} />
                  <Text style={[styles.chipText]}>{s.trim()}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          );
        })()}
        </>)}

        <TouchableOpacity style={styles.saveBtn} onPress={() => save(false)} disabled={saving} activeOpacity={0.85}>
          <Ionicons name="checkmark-circle" size={18} color={DR.inkOnAccent} />
          <Text style={styles.saveBtnText}>{saving ? t('saving') : t('save')}</Text>
        </TouchableOpacity>

        {/* Session-flöde: spara + logga nästa flygning i samma pass (bara nya) */}
        {!isEdit && (
          <TouchableOpacity style={styles.saveAgainBtn} onPress={() => save(true)} disabled={saving} activeOpacity={0.8}>
            <Ionicons name="repeat" size={16} color={accent} />
            <Text style={styles.saveAgainText}>Save &amp; log another (same session)</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

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
                display="inline"
                maximumDate={new Date()}
                themeVariant="dark"
                onChange={(_, d) => d && setForm((p) => ({ ...p, date: d.toISOString().split('T')[0] }))}
              />
            </Pressable>
          </Pressable>
        </Modal>
      )}

      {/* Take-off-tid — driver natt-auto */}
      {showTime && Platform.OS === 'android' && (
        <DateTimePicker
          value={timeToDate(form.takeoff_time)}
          mode="time"
          is24Hour
          onChange={(e, d) => {
            setShowTime(false);
            if (e.type === 'set' && d) setForm((p) => ({ ...p, takeoff_time: dateToHHMM(d) }));
          }}
        />
      )}
      {Platform.OS === 'ios' && (
        <Modal visible={showTime} transparent animationType="slide">
          <Pressable style={styles.modalBackdrop} onPress={() => setShowTime(false)}>
            <Pressable style={styles.datePickerSheet} onPress={(e) => e.stopPropagation()}>
              <TouchableOpacity style={{ alignSelf: 'flex-end', padding: 12 }} onPress={() => setShowTime(false)}>
                <Text style={{ color: accent, fontWeight: '700' }}>{t('done')}</Text>
              </TouchableOpacity>
              <DateTimePicker
                value={timeToDate(form.takeoff_time)}
                mode="time"
                is24Hour
                display="spinner"
                themeVariant="dark"
                onChange={(_, d) => d && setForm((p) => ({ ...p, takeoff_time: dateToHHMM(d) }))}
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
    content: { padding: 16, paddingBottom: 60, gap: 6 },
    droneHeader: {
      paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 30 : 8, paddingBottom: 10,
      backgroundColor: DR.surface, borderBottomWidth: 0.5, borderBottomColor: DR.separator,
      alignItems: 'center', justifyContent: 'flex-end', position: 'relative',
    },
    droneHeaderClose: { position: 'absolute', left: 16, bottom: 10 },
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
    extraChipsWrap: { flex: 1.35, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    extraChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 8, paddingRight: 6, height: 34, borderRadius: 9, borderWidth: 1, borderColor: DR.border, backgroundColor: DR.surface },
    extraChipOrd: { fontFamily: 'JetBrainsMono', fontSize: 8.5, fontWeight: '800', letterSpacing: 0.4, color: DR.muted },
    extraChipInput: { fontFamily: FONT_LED7, fontSize: 15, fontWeight: '800', color: DR.text, minWidth: 42, padding: 0 },
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
    frameCard: { backgroundColor: accent + '0D', borderRadius: 14, borderWidth: 1, borderColor: DR.separator, padding: 14, gap: 8, marginTop: 4 },
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
    pickBox: { flexDirection: 'row', alignItems: 'center', height: 44, paddingHorizontal: 11, backgroundColor: DR.surface, borderWidth: 1, borderColor: DR.border, borderRadius: 10 },
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
    missionInput: { flex: 1, color: DR.text, fontSize: 14, paddingVertical: 10 },
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
