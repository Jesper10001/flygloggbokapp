import { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, TextInput, Alert,
  ActivityIndicator, Keyboard,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { useScanProfileStore, LOGBOOK_COLUMNS, type ScanProfile } from '../../store/scanProfileStore';
import { lookupAircraft, type AircraftLookupResult } from '../../services/aircraftLookup';
import { addAircraftTypeToRegistry } from '../../db/flights';
import { callAnthropicJson } from '../../services/anthropicClient';
import { showQuotaExceededAlert } from '../../utils/quotaAlert';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Haptics from 'expo-haptics';

const COUNTRY_ICAO: { name_en: string; name_sv: string; prefix: string }[] = [
  { name_en: 'Sweden', name_sv: 'Sverige', prefix: 'ES' },
  { name_en: 'Norway', name_sv: 'Norge', prefix: 'EN' },
  { name_en: 'Denmark', name_sv: 'Danmark', prefix: 'EK' },
  { name_en: 'Finland', name_sv: 'Finland', prefix: 'EF' },
  { name_en: 'Iceland', name_sv: 'Island', prefix: 'BI' },
  { name_en: 'Germany', name_sv: 'Tyskland', prefix: 'ED' },
  { name_en: 'Germany (East)', name_sv: 'Tyskland (militär)', prefix: 'ET' },
  { name_en: 'United Kingdom', name_sv: 'Storbritannien', prefix: 'EG' },
  { name_en: 'France', name_sv: 'Frankrike', prefix: 'LF' },
  { name_en: 'Spain', name_sv: 'Spanien', prefix: 'LE' },
  { name_en: 'Spain (Canary)', name_sv: 'Spanien (Kanarieöarna)', prefix: 'GC' },
  { name_en: 'Italy', name_sv: 'Italien', prefix: 'LI' },
  { name_en: 'Switzerland', name_sv: 'Schweiz', prefix: 'LS' },
  { name_en: 'Austria', name_sv: 'Österrike', prefix: 'LO' },
  { name_en: 'Netherlands', name_sv: 'Nederländerna', prefix: 'EH' },
  { name_en: 'Belgium', name_sv: 'Belgien', prefix: 'EB' },
  { name_en: 'Ireland', name_sv: 'Irland', prefix: 'EI' },
  { name_en: 'Portugal', name_sv: 'Portugal', prefix: 'LP' },
  { name_en: 'Greece', name_sv: 'Grekland', prefix: 'LG' },
  { name_en: 'Turkey', name_sv: 'Turkiet', prefix: 'LT' },
  { name_en: 'Poland', name_sv: 'Polen', prefix: 'EP' },
  { name_en: 'Czech Republic', name_sv: 'Tjeckien', prefix: 'LK' },
  { name_en: 'Hungary', name_sv: 'Ungern', prefix: 'LH' },
  { name_en: 'Romania', name_sv: 'Rumänien', prefix: 'LR' },
  { name_en: 'Croatia', name_sv: 'Kroatien', prefix: 'LD' },
  { name_en: 'Estonia', name_sv: 'Estland', prefix: 'EE' },
  { name_en: 'Latvia', name_sv: 'Lettland', prefix: 'EV' },
  { name_en: 'Lithuania', name_sv: 'Litauen', prefix: 'EY' },
  { name_en: 'USA', name_sv: 'USA', prefix: 'K' },
  { name_en: 'Canada', name_sv: 'Kanada', prefix: 'C' },
  { name_en: 'Australia', name_sv: 'Australien', prefix: 'Y' },
  { name_en: 'New Zealand', name_sv: 'Nya Zeeland', prefix: 'NZ' },
  { name_en: 'South Africa', name_sv: 'Sydafrika', prefix: 'FA' },
  { name_en: 'Brazil', name_sv: 'Brasilien', prefix: 'SB' },
  { name_en: 'UAE', name_sv: 'Förenade Arabemiraten', prefix: 'OM' },
  { name_en: 'India', name_sv: 'Indien', prefix: 'VI' },
  { name_en: 'Thailand', name_sv: 'Thailand', prefix: 'VT' },
  { name_en: 'Japan', name_sv: 'Japan', prefix: 'RJ' },
  { name_en: 'Singapore', name_sv: 'Singapore', prefix: 'WS' },
  { name_en: 'Bulgaria', name_sv: 'Bulgarien', prefix: 'LB' },
  { name_en: 'Serbia', name_sv: 'Serbien', prefix: 'LY' },
  { name_en: 'Slovenia', name_sv: 'Slovenien', prefix: 'LJ' },
  { name_en: 'Slovakia', name_sv: 'Slovakien', prefix: 'LZ' },
  { name_en: 'Malta', name_sv: 'Malta', prefix: 'LM' },
  { name_en: 'Cyprus', name_sv: 'Cypern', prefix: 'LC' },
  { name_en: 'Luxembourg', name_sv: 'Luxemburg', prefix: 'EL' },
  { name_en: 'Morocco', name_sv: 'Marocko', prefix: 'GM' },
  { name_en: 'Egypt', name_sv: 'Egypten', prefix: 'HE' },
  { name_en: 'Kenya', name_sv: 'Kenya', prefix: 'HK' },
  { name_en: 'China', name_sv: 'Kina', prefix: 'Z' },
];

const COLUMN_SHORT: Record<string, string> = {
  date: 'DAT', aircraft_type: 'TYP', registration: 'REG',
  dep_place: 'DEP', dep_utc: 'D-T', arr_place: 'ARR', arr_utc: 'A-T',
  total_time: 'TOT', pic: 'PIC', co_pilot: 'COP', dual: 'DUL',
  instructor: 'INS', multi_pilot: 'MP', single_pilot: 'SP',
  ifr: 'IFR', vfr: 'VFR', night: 'NGT', nvg: 'NVG',
  landings_day: 'L-D', landings_night: 'L-N', flight_rules: 'F/R',
  se_time: 'SE', me_time: 'ME', other_flight_time: 'OTH', sim: 'SIM', remarks: 'RMK',
};

const EXAMPLE_DATA: Record<string, string[]> = {
  date: ['03-12', '03-12', '03-14', '03-15', '03-15', '03-18'],
  aircraft_type: ['B206', 'B206', 'B206', 'B206', 'B206', 'B206'],
  registration: ['-::-', '-::-', '-::-', '-::-', '-::-', '-::-'],
  dep_place: ['ESCF', 'ESSL', 'ESCF', 'ESCF', 'ESSA', 'ESCF'],
  dep_utc: ['08:20', '10:45', '07:00', '09:10', '14:00', '06:45'],
  arr_place: ['ESSL', 'ESCF', 'ESCF', 'ESSA', 'ESCF', 'ESSL'],
  arr_utc: ['09:10', '11:30', '08:30', '10:20', '15:10', '08:00'],
  total_time: ['0.8', '0.7', '1.5', '1.2', '1.2', '1.3'],
  pic: ['0.8', '0.7', '1.5', '1.2', '1.2', '1.3'],
  co_pilot: ['', '', '', '', '', ''],
  dual: ['', '', '', '', '', ''],
  instructor: ['', '', '', '', '', ''],
  multi_pilot: ['', '', '', '', '', ''],
  single_pilot: ['0.8', '0.7', '1.5', '1.2', '1.2', '1.3'],
  ifr: ['', '', '0.5', '', '0.8', ''],
  vfr: ['0.8', '0.7', '1.0', '1.2', '0.4', '1.3'],
  night: ['', '', '', '', '', ''],
  nvg: ['', '', '', '', '', ''],
  landings_day: ['1', '1', '2', '1', '1', '1'],
  landings_night: ['', '', '', '', '', ''],
  flight_rules: ['V', 'V', 'Y', 'V', 'I', 'V'],
  se_time: ['0.8', '0.7', '1.5', '1.2', '1.2', '1.3'],
  me_time: ['', '', '', '', '', ''],
  other_flight_time: ['', '', '', '', '', ''],
  sim: ['', '', '', '', '', ''],
  remarks: ['HES', 'JON', 'ILS', 'SZ', 'AXA PC', 'CON'],
};

const STRUCTURE_PROMPT = `Du är expert på EASA-flygloggböcker. Analysera bilden av en loggbokssida (kan vara tom eller ifylld) och identifiera kolumnstrukturen.

GRUNDREGEL: Antalet element i "columns"-arrayen MÅSTE vara EXAKT lika med
antalet fysiska kolumner i loggbokens tabell. Räkna vertikala linjer minus 1.
Slå ALDRIG ihop flera fysiska kolumner till ett element.

ARBETSORDNING:
1. Räkna FÖRST det totala antalet fysiska kolumner i tabellen (vänster+höger sida).
2. Läs ALLA tryckta kolumnrubriker i tabellen, från vänster till höger.
3. Börja på vänster sida (den med datum), fortsätt rad för rad i rubrikerna.
4. När vänster sidas kolumner är klara, fortsätt med höger sidas kolumner
   (vanligtvis börjar med PIC, Co-pilot eller liknande).
5. Notera EXAKT ordning — om PIC kommer före Co-pilot, så ska "pic" komma
   före "co_pilot" i arrayen.
6. Om en kolumn har underrubriker (t.ex. "Single-pilot time" med SE/ME under),
   representera varje underrubrik som en separat kolumn (se_time, me_time).
7. Rubriker som "Operational condition time" med IFR/Night under → ifr, night.
8. GRUPPHUVUDEN SOM SPÄNNER ÖVER FLERA KOLUMNER (KRITISKT):
   Många EASA-loggböcker har grupphuvuden som sträcker sig över 2-3+ kolumner.
   Exempel:
     "Other type of flight time" kan spänna över 3 fysiska kolumner.
     "Pilot function time" kan spänna över PIC, Co-pilot, Dual, Instructor.
     "Landings" kan spänna över Day och Night.
   Du MÅSTE räkna varje fysisk kolumn UNDER grupphuvudet som en separat entry.
   Om "Other type of flight time" har 3 kolumner under sig (tom, tom, tom eller
   med handskriven text som "AR landings") → returnera:
     "other_flight_time", "other_flight_time_2", "other_flight_time_3"
   ALDRIG bara "other_flight_time" för alla tre.
   Räkna de vertikala linjerna inom gruppen för att bestämma antalet.
9. Verifiera: antalet element i din columns-array == antalet du räknade i steg 1.
   Om inte, har du missat eller slagit ihop kolumner — gå tillbaka och räkna om.

Returnera ENBART ett JSON-objekt med:
1. "columns" — array med ALLA kolumner i EXAKT ordning från vänster till höger
   (hela uppslaget, vänster sida FÖRST sedan höger sida).
   Mappa varje rubrik till en av dessa nycklar:
   date, aircraft_type, registration, dep_place, dep_utc, arr_place, arr_utc,
   total_time, pic, co_pilot, dual, instructor, multi_pilot, single_pilot,
   ifr, vfr, night, nvg, landings_day, landings_night, flight_rules,
   se_time, me_time, other_flight_time, sim, remarks
   - "other_flight_time" = "Other type of flight time" — en eller flera kolumner.
     Använd denna nyckel för:
       * Kolumner med rubriken "Other type of flight time" eller liknande
       * Helt TOMMA kolumner utan rubrik eller med okänd/egendefinierad rubrik
       * Kolumner som inte matchar någon annan standardnyckel
     KRITISKT: Räkna de vertikala linjerna UNDER grupphuvudet "Other type of
     flight time" (eller liknande). Varje fysisk kolumn = ett separat element.
     Exempel: om grupphuvudet spänner över 3 kolumner (3 vertikala fält) →
       ["other_flight_time", "other_flight_time_2", "other_flight_time_3"]
     Även om kolumnerna är helt tomma eller bara har handskriven text som
     rubrik (t.ex. "AR landings") — var och en är fortfarande en separat kolumn.
   VIKTIGT:
   - "aircraft_type" inkluderar ALLTID modell/variant (typ + modell i samma kolumn)
   - "remarks" inkluderar ALLTID andrepilot (remarks + second pilot i samma kolumn)
   - Använd INTE "aircraft_model" eller "second_pilot" som separata kolumner
   Om en kolumn inte matchar dessa, använd en beskrivande nyckel (t.ex. "nvd", "picus", "fstd").
2. "rows_per_page" — TOTALT antal rader avsedda för flygningar i tabellen.
   KRITISKT: Räkna ALLA horisontella linjer/rader i flygnings-tabellen, INTE bara
   de som är ifyllda. Om 9 rader har text och 3 är tomma = 12 rader.
   Räkna INTE summa-rader ("Total this page", "Brought forward", "Total to date").
   Räkna INTE rubrikrader/kolumnhuvuden.
   Tips: räkna de horisontella linjerna i tabellens kropp (body) och subtrahera 1.
   Vanliga värden i EASA-loggböcker: 10, 12, 13, 14, 15.
3. "custom_columns" — array med objekt för kolumner som inte matchar standardnycklarna:
   [{ "key": "nvd", "header_text": "NVD", "description": "Night Vision Device time" }]
4. "page_layout" — "single" om bilden visar en sida, "double" om det är ett uppslag (vänster+höger)
5. "summary_rows" — objekt som beskriver var summa-raderna finns, relativt flygningsraderna.
   Identifiera om och var dessa rader finns:
   - "brought_forward" — "Brought forward" / "Överförd summa" (rad OVANFÖR flygningsraderna)
   - "total_this_page" — "Total this page" / "Summa denna sida" (rad UNDER flygningsraderna)
   - "total_to_date" — "Total to date" / "Summa hittills" (rad under "Total this page")
   Ange position som "above" (ovanför flygningsrader) eller "below" (under flygningsrader).
   Ange vilken sida raden finns på: "left", "right" eller "both" (om den sträcker sig över båda).
   Ange vilka kolumner som har summor (de kolumner som har numeriska värden i summa-raden).
   Om raden inte finns, utelämna den.

JSON-SCHEMA:
{"columns":["date","aircraft_type",...],"rows_per_page":12,"custom_columns":[],"page_layout":"double","summary_rows":{"brought_forward":{"position":"above","page":"left","sum_columns":["total_time","pic","co_pilot","dual","ifr","night","landings_day","landings_night"]},"total_this_page":{"position":"below","page":"left","sum_columns":["total_time","pic","co_pilot","dual","ifr","night","landings_day","landings_night"]},"total_to_date":{"position":"below","page":"left","sum_columns":["total_time","pic","co_pilot","dual","ifr","night","landings_day","landings_night"]}}}

Svara ENBART med JSON.`;

type SummaryRowInfo = { position: 'above' | 'below'; page: 'left' | 'right' | 'both'; sum_columns: string[] };
type SummaryRows = { brought_forward?: SummaryRowInfo; total_this_page?: SummaryRowInfo; total_to_date?: SummaryRowInfo };

function parseSummaryRow(raw: any): SummaryRowInfo | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  return {
    position: raw.position === 'above' ? 'above' : 'below',
    page: raw.page === 'right' ? 'right' : raw.page === 'both' ? 'both' : 'left',
    sum_columns: Array.isArray(raw.sum_columns) ? raw.sum_columns.map(String) : [],
  };
}

async function analyzeLogbookStructure(base64: string, mediaType: string): Promise<{
  columns: string[];
  rows_per_page: number;
  custom_columns: { key: string; header_text: string; description: string }[];
  summary_rows: SummaryRows;
}> {
  const parsed = await callAnthropicJson<any>({
    system: STRUCTURE_PROMPT,
    maxTokens: 2000,
    userContent: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
      { type: 'text', text: 'Analysera kolumnstrukturen i denna loggbok. Svara ENBART med JSON.' },
    ],
  });
  const sr = parsed.summary_rows ?? {};
  return {
    columns: Array.isArray(parsed.columns) ? parsed.columns.map((c: any) => String(c)) : [],
    rows_per_page: Number(parsed.rows_per_page) || 0,
    custom_columns: Array.isArray(parsed.custom_columns)
      ? parsed.custom_columns.map((c: any) => ({
          key: String(c.key ?? ''),
          header_text: String(c.header_text ?? ''),
          description: String(c.description ?? ''),
        }))
      : [],
    summary_rows: {
      brought_forward: parseSummaryRow(sr.brought_forward),
      total_this_page: parseSummaryRow(sr.total_this_page),
      total_to_date: parseSummaryRow(sr.total_to_date),
    },
  };
}

export default function ScanProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { profile, save } = useScanProfileStore();
  const sv = t('yes') === 'Ja';

  const [aircraftInput, setAircraftInput] = useState('');
  const [aircraftList, setAircraftList] = useState<string[]>(profile.aircraftTypes);
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupResult, setLookupResult] = useState<AircraftLookupResult | null>(null);
  const [editType, setEditType] = useState('');
  const [editSpeed, setEditSpeed] = useState('');
  const [editEndurance, setEditEndurance] = useState('');
  const [editCategory, setEditCategory] = useState<'airplane' | 'helicopter' | ''>('');
  const [editEngine, setEditEngine] = useState<'se' | 'me' | ''>('');
  const [editCrew, setEditCrew] = useState('');
  const [countryInput, setCountryInput] = useState('');
  const [countrySuggestions, setCountrySuggestions] = useState<typeof COUNTRY_ICAO>([]);
  const [countries, setCountries] = useState<string[]>(profile.homeCountries);
  const [icaoInput, setIcaoInput] = useState('');
  const [icaos, setIcaos] = useState<string[]>(profile.frequentIcaos);
  const [crewType, setCrewType] = useState<'sp' | 'mp' | 'both'>(profile.crewType);
  const [rules, setRules] = useState<'vfr' | 'ifr' | 'both'>(profile.flightRules);
  const [columns, setColumns] = useState<string[]>(profile.columnOrder);
  const [rowsPerPage, setRowsPerPage] = useState(profile.rowsPerPage || 0);
  const [scanningStructure, setScanningStructure] = useState(false);
  const [customCols, setCustomCols] = useState<{ key: string; header_text: string; description: string }[]>([]);
  const [summaryRows, setSummaryRows] = useState<SummaryRows>({});
  const [crewFormat, setCrewFormat] = useState(profile.crewFormat);
  const [timeFormat, setTimeFormat] = useState<'decimal' | 'hhmm' | 'mixed'>(profile.timeFormat);
  const [usesDitto, setUsesDitto] = useState(profile.usesDitto);

  const addToList = (list: string[], setList: (v: string[]) => void, input: string, setInput: (v: string) => void) => {
    const val = input.trim().toUpperCase();
    if (val && !list.includes(val)) {
      Haptics.selectionAsync();
      setList([...list, val]);
    }
    setInput('');
  };

  const removeFromList = (list: string[], setList: (v: string[]) => void, val: string) => {
    setList(list.filter(v => v !== val));
  };

  const toggleColumn = (key: string) => {
    Haptics.selectionAsync();
    if (columns.includes(key)) {
      setColumns(columns.filter(k => k !== key));
    } else {
      setColumns([...columns, key]);
    }
  };

  const scanLogbookStructure = async () => {
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (result.canceled || !result.assets?.[0]) return;
    setScanningStructure(true);
    try {
      const info = await ImageManipulator.manipulateAsync(result.assets[0].uri, [], {});
      const actions: ImageManipulator.Action[] = [];
      if (info.height > info.width) actions.push({ rotate: 90 });
      actions.push({ resize: { width: 2000 } });
      const img = await ImageManipulator.manipulateAsync(
        result.assets[0].uri, actions,
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!img.base64) throw new Error('Could not process image');
      const struct = await analyzeLogbookStructure(img.base64, 'image/jpeg');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setColumns(struct.columns);
      if (struct.rows_per_page > 0) setRowsPerPage(struct.rows_per_page);
      if (struct.custom_columns.length > 0) setCustomCols(struct.custom_columns);
      setSummaryRows(struct.summary_rows);
    } catch (e: any) {
      Alert.alert(sv ? 'Analys misslyckades' : 'Analysis failed', e.message);
    } finally {
      setScanningStructure(false);
    }
  };

  const scanFromLibrary = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (result.canceled || !result.assets?.[0]) return;
    setScanningStructure(true);
    try {
      const info = await ImageManipulator.manipulateAsync(result.assets[0].uri, [], {});
      const actions: ImageManipulator.Action[] = [];
      if (info.height > info.width) actions.push({ rotate: 90 });
      actions.push({ resize: { width: 2000 } });
      const img = await ImageManipulator.manipulateAsync(
        result.assets[0].uri, actions,
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );
      if (!img.base64) throw new Error('Could not process image');
      const struct = await analyzeLogbookStructure(img.base64, 'image/jpeg');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setColumns(struct.columns);
      if (struct.rows_per_page > 0) setRowsPerPage(struct.rows_per_page);
      if (struct.custom_columns.length > 0) setCustomCols(struct.custom_columns);
      setSummaryRows(struct.summary_rows);
    } catch (e: any) {
      Alert.alert(sv ? 'Analys misslyckades' : 'Analysis failed', e.message);
    } finally {
      setScanningStructure(false);
    }
  };

  const handleSave = async () => {
    const p: ScanProfile = {
      aircraftTypes: aircraftList,
      homeCountries: countries,
      frequentIcaos: icaos,
      crewType,
      flightRules: rules,
      columnOrder: columns,
      rowsPerPage,
      summaryRowColumns: [
        ...(summaryRows.brought_forward?.sum_columns ?? []),
        ...(summaryRows.total_this_page?.sum_columns ?? []),
      ].filter((v, i, a) => a.indexOf(v) === i),
      crewFormat: crewFormat.trim(),
      timeFormat,
      usesDitto,
    };
    await save(p);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <Text style={s.title}>{sv ? 'Skanningsprofil' : 'Scan Profile'}</Text>
      <Text style={s.subtitle}>
        {sv
          ? 'Hjälp AI:n att tolka din loggbok korrekt genom att svara på några frågor. Sparas en gång och används vid varje skanning.'
          : 'Help the AI read your logbook correctly by answering a few questions. Saved once and used for every scan.'}
      </Text>

      {/* 1. Aircraft types — smart search */}
      <View style={s.section}>
        <Text style={s.question}>{sv ? '1. Vilka farkoster har du flugit?' : '1. What aircraft have you flown?'}</Text>
        <Text style={s.hint}>{sv ? 'Sök på namn eller typkod — granska resultatet och tryck Lägg till' : 'Search by name or type code — review the result and tap Add'}</Text>
        <View style={s.inputRow}>
          <TextInput
            style={s.input}
            value={aircraftInput}
            onChangeText={setAircraftInput}
            placeholder={sv ? 'T.ex. Cessna 172, EC135, Bell 407...' : 'E.g. Cessna 172, EC135, Bell 407...'}
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="characters"
            editable={!lookingUp && !lookupResult}
          />
          {!lookupResult && (
            <TouchableOpacity
              style={[s.addBtn, (lookingUp || !aircraftInput.trim()) && { opacity: 0.5 }]}
              disabled={lookingUp || !aircraftInput.trim()}
              onPress={async () => {
                const q = aircraftInput.trim();
                if (!q) return;
                Keyboard.dismiss();
                setLookingUp(true);
                try {
                  const result = await lookupAircraft(q);
                  setLookupResult(result);
                  setEditType(result.aircraft_type || q.toUpperCase());
                  setEditSpeed(result.cruise_speed_kts > 0 ? String(result.cruise_speed_kts) : '');
                  setEditEndurance(result.endurance_h > 0 ? String(result.endurance_h) : '');
                  setEditCategory(result.category || '');
                  setEditEngine(result.engine_type || '');
                  setEditCrew(result.crew_type || '');
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                } catch (err: any) {
                  setLookupResult(null);
                  setEditType(q.toUpperCase());
                  setEditSpeed('');
                  setEditEndurance('');
                  setEditCategory('');
                  setEditEngine('');
                  setEditCrew('');
                  const msg = err?.message ?? '';
                  if (msg.includes('QUOTA_EXCEEDED') || msg.includes('quota') || msg.includes('429')) {
                    showQuotaExceededAlert(t as any, sv ? 'Farkostsökningar slut denna månad.' : 'Aircraft lookups exhausted this month.');
                  } else {
                    Alert.alert(sv ? 'Sökning misslyckades' : 'Lookup failed', msg || (sv ? 'Fyll i uppgifterna manuellt.' : 'Fill in the details manually.'));
                  }
                } finally {
                  setLookingUp(false);
                }
              }}
            >
              {lookingUp
                ? <ActivityIndicator size="small" color={Colors.textInverse} />
                : <Ionicons name="search" size={18} color={Colors.textInverse} />
              }
            </TouchableOpacity>
          )}
          {lookupResult && (
            <TouchableOpacity style={[s.addBtn, { backgroundColor: Colors.danger }]} onPress={() => { setLookupResult(null); setAircraftInput(''); }}>
              <Ionicons name="close" size={18} color={Colors.textInverse} />
            </TouchableOpacity>
          )}
        </View>

        {/* Lookup result card — editable */}
        {lookupResult && (
          <View style={s.resultCard}>
            {lookupResult.manufacturer || lookupResult.model ? (
              <Text style={s.resultInfo}>
                {lookupResult.manufacturer} {lookupResult.model}
                {lookupResult.confidence > 0 ? `  ·  ${Math.round(lookupResult.confidence * 100)}%` : ''}
              </Text>
            ) : null}

            <Text style={s.resultLabel}>{sv ? 'ICAO-TYPKOD' : 'ICAO TYPE CODE'}</Text>
            <TextInput style={s.resultInput} value={editType} onChangeText={(v) => setEditType(v.toUpperCase())} autoCapitalize="characters" />

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={s.resultLabel}>{sv ? 'MARSCHFART (KT)' : 'CRUISE SPEED (KT)'}</Text>
                <TextInput style={s.resultInput} value={editSpeed} onChangeText={setEditSpeed} keyboardType="number-pad" placeholder="110" placeholderTextColor={Colors.textMuted} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.resultLabel}>{sv ? 'UTHÅLLIGHET (H)' : 'ENDURANCE (H)'}</Text>
                <TextInput style={s.resultInput} value={editEndurance} onChangeText={setEditEndurance} keyboardType="decimal-pad" placeholder="3.0" placeholderTextColor={Colors.textMuted} />
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 6 }}>
              {(['sp', 'mp'] as const).map(k => {
                const active = editCrew.includes(k);
                return (
                  <TouchableOpacity key={k} style={[s.resultOptBtn, active && s.resultOptBtnActive]} onPress={() => {
                    if (editCrew === 'sp,mp') setEditCrew(k === 'sp' ? 'mp' : 'sp');
                    else if (editCrew === k) setEditCrew('');
                    else if (editCrew) setEditCrew(['sp', 'mp'].sort().join(','));
                    else setEditCrew(k);
                  }} activeOpacity={0.7}>
                    <Text style={[s.resultOptText, active && s.resultOptTextActive]}>{k.toUpperCase()}</Text>
                  </TouchableOpacity>
                );
              })}
              {(['se', 'me'] as const).map(k => {
                const active = editEngine === k;
                return (
                  <TouchableOpacity key={k} style={[s.resultOptBtn, active && s.resultOptBtnActive]} onPress={() => setEditEngine(active ? '' : k)} activeOpacity={0.7}>
                    <Text style={[s.resultOptText, active && s.resultOptTextActive]}>{k.toUpperCase()}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              {(['airplane', 'helicopter'] as const).map(cat => {
                const active = editCategory === cat;
                return (
                  <TouchableOpacity key={cat} style={[s.resultOptBtn, active && s.resultOptBtnActive]} onPress={() => setEditCategory(active ? '' : cat)} activeOpacity={0.7}>
                    <Text style={[s.resultOptText, active && s.resultOptTextActive]}>
                      {cat === 'airplane' ? (sv ? 'Flygplan' : 'Airplane') : (sv ? 'Helikopter' : 'Helicopter')}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity
              style={s.resultAddBtn}
              onPress={async () => {
                const code = editType.trim().toUpperCase();
                if (!code) return;
                await addAircraftTypeToRegistry(code, parseInt(editSpeed) || 0, parseFloat(editEndurance.replace(',', '.')) || 0, editCrew, editCategory, editEngine);
                if (!aircraftList.includes(code)) {
                  setAircraftList([...aircraftList, code]);
                }
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                setLookupResult(null);
                setAircraftInput('');
              }}
              activeOpacity={0.85}
            >
              <Ionicons name="add-circle" size={18} color={Colors.textInverse} />
              <Text style={s.resultAddBtnText}>{sv ? 'Lägg till' : 'Add'}</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={s.chipRow}>
          {aircraftList.map(a => (
            <TouchableOpacity key={a} style={s.chip} onPress={() => removeFromList(aircraftList, setAircraftList, a)}>
              <Text style={s.chipText}>{a}</Text>
              <Ionicons name="close" size={12} color={Colors.textMuted} />
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* 2. Countries + frequent ICAO */}
      <View style={s.section}>
        <Text style={s.question}>{sv ? '2. Vilket land utgår du oftast ifrån?' : '2. What country do you mostly fly from?'}</Text>
        <Text style={s.hint}>
          {sv
            ? 'Sök på land — ICAO-prefixet fylls i automatiskt. Skriver du "CF" i loggboken tolkar AI:n det som ESCF.'
            : 'Search by country — the ICAO prefix is filled automatically. If you write "CF" the AI reads it as ESCF.'}
        </Text>
        <View style={s.inputRow}>
          <TextInput
            style={s.input}
            value={countryInput}
            onChangeText={(text) => {
              setCountryInput(text);
              const q = text.trim().toLowerCase();
              if (q.length < 1) { setCountrySuggestions([]); return; }
              const raw = COUNTRY_ICAO.filter(c =>
                c.name_en.toLowerCase().startsWith(q) ||
                c.name_sv.toLowerCase().startsWith(q) ||
                c.prefix.toLowerCase() === q ||
                c.name_en.replace(/\s*\(.*\)$/, '').toLowerCase().startsWith(q) ||
                c.name_sv.replace(/\s*\(.*\)$/, '').toLowerCase().startsWith(q)
              );
              const seen = new Set<string>();
              const matches = raw.filter(c => {
                const base = c.name_en.replace(/\s*\(.*\)$/, '');
                if (seen.has(base)) return false;
                seen.add(base);
                return true;
              }).slice(0, 5);
              setCountrySuggestions(matches);
            }}
            placeholder={sv ? 'Sök land, t.ex. Sverige, Norge...' : 'Search country, e.g. Sweden, Norway...'}
            placeholderTextColor={Colors.textMuted}
          />
        </View>
        {countrySuggestions.length > 0 && (
          <View style={s.suggestionList}>
            {countrySuggestions.map(c => (
              <TouchableOpacity
                key={c.prefix}
                style={s.suggestionRow}
                onPress={() => {
                  const baseName = c.name_en.replace(/\s*\(.*\)$/, '');
                  const allForCountry = COUNTRY_ICAO
                    .filter(ci => ci.name_en.replace(/\s*\(.*\)$/, '') === baseName)
                    .map(ci => ci.prefix);
                  const newPrefixes = allForCountry.filter(p => !countries.includes(p));
                  if (newPrefixes.length > 0) {
                    Haptics.selectionAsync();
                    setCountries([...countries, ...newPrefixes]);
                  }
                  setCountryInput('');
                  setCountrySuggestions([]);
                }}
                activeOpacity={0.7}
              >
                <Text style={s.suggestionName}>{sv ? c.name_sv.replace(/\s*\(.*\)$/, '') : c.name_en.replace(/\s*\(.*\)$/, '')}</Text>
                <View style={{ flexDirection: 'row', gap: 4 }}>
                  {COUNTRY_ICAO
                    .filter(ci => ci.name_en.replace(/\s*\(.*\)$/, '') === c.name_en.replace(/\s*\(.*\)$/, ''))
                    .map(ci => (
                      <View key={ci.prefix} style={s.suggestionBadge}>
                        <Text style={s.suggestionPrefix}>{ci.prefix}</Text>
                      </View>
                    ))
                  }
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <View style={s.chipRow}>
          {countries.map(c => {
            const info = COUNTRY_ICAO.find(ci => ci.prefix === c);
            return (
              <TouchableOpacity key={c} style={s.chip} onPress={() => removeFromList(countries, setCountries, c)}>
                <Text style={s.chipText}>{c}</Text>
                {info && <Text style={[s.chipText, { fontFamily: undefined, fontWeight: '400', fontSize: 11 }]}>{sv ? info.name_sv : info.name_en}</Text>}
                <Ionicons name="close" size={12} color={Colors.textMuted} />
              </TouchableOpacity>
            );
          })}
        </View>

        <Text style={[s.hint, { marginTop: 10 }]}>{sv ? 'Vanligaste flygplatserna (ICAO)' : 'Most frequent airports (ICAO)'}</Text>
        <View style={s.inputRow}>
          <TextInput style={s.input} value={icaoInput} onChangeText={setIcaoInput} placeholder="ESSA, ESCF..." placeholderTextColor={Colors.textMuted} autoCapitalize="characters" maxLength={4} />
          <TouchableOpacity style={s.addBtn} onPress={() => addToList(icaos, setIcaos, icaoInput, setIcaoInput)}>
            <Ionicons name="add" size={18} color={Colors.textInverse} />
          </TouchableOpacity>
        </View>
        <View style={s.chipRow}>
          {icaos.map(c => (
            <TouchableOpacity key={c} style={s.chip} onPress={() => removeFromList(icaos, setIcaos, c)}>
              <Text style={s.chipText}>{c}</Text>
              <Ionicons name="close" size={12} color={Colors.textMuted} />
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* 3. Crew type */}
      <View style={s.section}>
        <Text style={s.question}>{sv ? '3. Flyger du single- eller multi-pilot?' : '3. Do you fly single- or multi-pilot?'}</Text>
        <View style={s.segRow}>
          {([['sp', 'Single pilot'], ['mp', 'Multi-pilot'], ['both', sv ? 'Båda' : 'Both']] as const).map(([key, label]) => (
            <TouchableOpacity key={key} style={[s.segBtn, crewType === key && s.segBtnActive]} onPress={() => { Haptics.selectionAsync(); setCrewType(key); }} activeOpacity={0.75}>
              <Text style={[s.segText, crewType === key && s.segTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Flight rules */}
      <View style={s.section}>
        <Text style={s.question}>{sv ? 'Flyger du mest VFR eller IFR?' : 'Do you mostly fly VFR or IFR?'}</Text>
        <View style={s.segRow}>
          {([['vfr', 'VFR'], ['ifr', 'IFR'], ['both', sv ? 'Båda' : 'Both']] as const).map(([key, label]) => (
            <TouchableOpacity key={key} style={[s.segBtn, rules === key && s.segBtnActive]} onPress={() => { Haptics.selectionAsync(); setRules(key); }} activeOpacity={0.75}>
              <Text style={[s.segText, rules === key && s.segTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* 4. Column order — clean sheet */}
      <View style={s.section}>
        <Text style={s.question}>{sv ? '4. Vilka kolumner har din loggbok?' : '4. What columns does your logbook have?'}</Text>
        <Text style={s.hint}>
          {sv
            ? 'Fotografera en sida i din loggbok så identifierar AI kolumnerna automatiskt, eller lägg till manuellt.'
            : 'Take a photo of a logbook page and the AI identifies columns automatically, or add manually.'}
        </Text>

        {/* Scan structure button */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TouchableOpacity
            style={[s.scanStructBtn, scanningStructure && { opacity: 0.5 }]}
            onPress={scanLogbookStructure}
            disabled={scanningStructure}
            activeOpacity={0.8}
          >
            {scanningStructure
              ? <ActivityIndicator size="small" color={Colors.primary} />
              : <Ionicons name="camera" size={16} color={Colors.primary} />
            }
            <Text style={s.scanStructText}>
              {scanningStructure
                ? (sv ? 'Analyserar...' : 'Analyzing...')
                : (sv ? 'Fotografera sida' : 'Photo of page')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.scanStructBtn, scanningStructure && { opacity: 0.5 }]}
            onPress={scanFromLibrary}
            disabled={scanningStructure}
            activeOpacity={0.8}
          >
            <Ionicons name="images" size={16} color={Colors.primary} />
            <Text style={s.scanStructText}>{sv ? 'Bildbibliotek' : 'Library'}</Text>
          </TouchableOpacity>
        </View>

        {/* Custom columns detected */}
        {customCols.length > 0 && (
          <View style={{ gap: 4 }}>
            <Text style={[s.hint, { color: Colors.warning }]}>
              {sv ? 'Icke-standard kolumner hittade:' : 'Non-standard columns detected:'}
            </Text>
            {customCols.map(c => (
              <View key={c.key} style={{
                flexDirection: 'row', alignItems: 'center', gap: 6,
                backgroundColor: Colors.warning + '12', borderRadius: 8,
                paddingHorizontal: 10, paddingVertical: 6,
                borderWidth: 1, borderColor: Colors.warning + '33',
              }}>
                <Text style={{ color: Colors.warning, fontSize: 12, fontWeight: '800', fontFamily: 'Menlo' }}>{c.header_text}</Text>
                <Text style={{ color: Colors.textSecondary, fontSize: 11, flex: 1 }}>{c.description}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Mini clean-sheet logbook */}
        {columns.length > 0 && (() => {
          const hasBF = !!summaryRows.brought_forward;
          const hasTTP = !!summaryRows.total_this_page;
          const hasTTD = !!summaryRows.total_to_date;
          const sumCols = new Set([
            ...(summaryRows.brought_forward?.sum_columns ?? []),
            ...(summaryRows.total_this_page?.sum_columns ?? []),
            ...(summaryRows.total_to_date?.sum_columns ?? []),
          ]);
          const renderSummaryRow = (label: string, cols: string[]) => {
            const sc = new Set(cols);
            return (
              <View style={{ flexDirection: 'row' }}>
                {columns.map((key, i) => (
                  <View key={key} style={[s.sheetSummaryCell, i === 0 && { minWidth: 44 }]}>
                    <Text style={s.sheetSummaryText}>
                      {i === 0 ? label : (sc.has(key) ? '—' : '')}
                    </Text>
                  </View>
                ))}
              </View>
            );
          };
          return (
            <View style={s.sheetContainer}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 4 }}>
                <View>
                  {/* Header row */}
                  <View style={{ flexDirection: 'row' }}>
                    {columns.map((key, i) => {
                      const col = LOGBOOK_COLUMNS.find(c => c.key === key);
                      const custom = customCols.find(c => c.key === key);
                      const isOther = key.startsWith('other_flight_time');
                      const label = isOther ? 'Other' : col ? (sv ? col.label_sv : col.label_en) : (custom?.header_text ?? key);
                      const short = isOther ? 'OTH' : (COLUMN_SHORT[key] ?? (custom?.header_text ?? label).slice(0, 4).toUpperCase());
                      return (
                        <TouchableOpacity
                          key={key}
                          style={s.sheetHeaderCell}
                          onPress={() => { Haptics.selectionAsync(); setColumns(columns.filter(k => k !== key)); }}
                          activeOpacity={0.7}
                        >
                          <Text style={s.sheetHeaderNum}>{i + 1}</Text>
                          <Text style={s.sheetHeaderText} numberOfLines={1}>{short}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  {/* Brought forward (above flights) */}
                  {hasBF && renderSummaryRow('B/F', summaryRows.brought_forward!.sum_columns)}

                  {/* Example data rows */}
                  {Array.from({ length: rowsPerPage || 3 }, (_, i) => i).map(row => (
                    <View key={row} style={{ flexDirection: 'row' }}>
                      {columns.map((key) => (
                        <View key={key} style={s.sheetDataCell}>
                          <Text style={s.sheetDataText}>{EXAMPLE_DATA[key]?.[row] ?? ''}</Text>
                        </View>
                      ))}
                    </View>
                  ))}

                  {/* Total this page (below flights) */}
                  {hasTTP && renderSummaryRow('TTP', summaryRows.total_this_page!.sum_columns)}
                  {/* Total to date */}
                  {hasTTD && renderSummaryRow('TTD', summaryRows.total_to_date!.sum_columns)}
                </View>
              </ScrollView>

              {/* Legend */}
              {(hasBF || hasTTP || hasTTD) && (
                <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 6, paddingTop: 4 }}>
                  {hasBF && <Text style={s.sheetLegend}>B/F = Brought forward</Text>}
                  {hasTTP && <Text style={s.sheetLegend}>TTP = Total this page</Text>}
                  {hasTTD && <Text style={s.sheetLegend}>TTD = Total to date</Text>}
                </View>
              )}

              <TouchableOpacity onPress={() => { setColumns([]); setSummaryRows({}); }} style={{ alignSelf: 'flex-end', paddingVertical: 4, paddingHorizontal: 2 }}>
                <Text style={{ color: Colors.danger, fontSize: 11, fontWeight: '600' }}>{sv ? 'Rensa alla' : 'Clear all'}</Text>
              </TouchableOpacity>
            </View>
          );
        })()}

        {columns.length === 0 && (
          <View style={s.sheetEmpty}>
            <Ionicons name="camera-outline" size={24} color={Colors.textMuted} />
            <Text style={{ color: Colors.textMuted, fontSize: 12, marginTop: 4 }}>
              {sv ? 'Fotografera en sida för att identifiera kolumnerna' : 'Take a photo of a page to identify columns'}
            </Text>
          </View>
        )}

        {/* Row count */}
        <Text style={[s.hint, { marginTop: 10 }]}>
          {sv ? 'Hur många flygningsrader per sida?' : 'How many flight rows per page?'}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <TouchableOpacity
            style={s.rowCountBtn}
            onPress={() => { if (rowsPerPage > 0) { Haptics.selectionAsync(); setRowsPerPage(rowsPerPage - 1); } }}
            disabled={rowsPerPage <= 0}
          >
            <Ionicons name="remove" size={16} color={rowsPerPage > 0 ? Colors.textPrimary : Colors.textMuted} />
          </TouchableOpacity>
          <Text style={s.rowCountValue}>{rowsPerPage || '—'}</Text>
          <TouchableOpacity
            style={s.rowCountBtn}
            onPress={() => { Haptics.selectionAsync(); setRowsPerPage(rowsPerPage + 1); }}
          >
            <Ionicons name="add" size={16} color={Colors.textPrimary} />
          </TouchableOpacity>
          <Text style={{ color: Colors.textMuted, fontSize: 11, flex: 1 }}>
            {sv ? 'rader' : 'rows'}
          </Text>
        </View>
      </View>

      {/* 5. Crew format */}
      <View style={s.section}>
        <Text style={s.question}>{sv ? '5. Hur anger du andrepilot/besättning i remarks?' : '5. How do you write second pilot/crew in remarks?'}</Text>
        <Text style={s.hint}>{sv ? 'T.ex. "JON/AXA" (3-ställigt), "SA/GA", "Johan Svensson"' : 'E.g. "JON/AXA" (3-letter), "SA/GA", "Johan Svensson"'}</Text>
        <TextInput
          style={[s.input, { alignSelf: 'stretch' }]}
          value={crewFormat}
          onChangeText={setCrewFormat}
          placeholder={sv ? 'T.ex. JON/AXA (3-ställigt)' : 'E.g. JON/AXA (3-letter codes)'}
          placeholderTextColor={Colors.textMuted}
        />
      </View>

      {/* 6. Time format */}
      <View style={s.section}>
        <Text style={s.question}>{sv ? '6. Hur skrivs flygtider i din loggbok?' : '6. How are flight times written in your logbook?'}</Text>
        <View style={s.segRow}>
          {([['hhmm', 'HH:MM (1:30)'], ['decimal', 'Decimal (1.5)'], ['mixed', sv ? 'Blandat' : 'Mixed']] as const).map(([key, label]) => (
            <TouchableOpacity key={key} style={[s.segBtn, timeFormat === key && s.segBtnActive]} onPress={() => { Haptics.selectionAsync(); setTimeFormat(key); }} activeOpacity={0.75}>
              <Text style={[s.segText, timeFormat === key && s.segTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* 7. Ditto marks */}
      <View style={s.section}>
        <Text style={s.question}>{sv ? '7. Använder du ditto-tecken (″ eller —)?' : '7. Do you use ditto marks (″ or —)?'}</Text>
        <Text style={s.hint}>{sv ? 'Vanligt för att upprepa värdet från raden ovan' : 'Common to repeat the value from the row above'}</Text>
        <View style={s.segRow}>
          {([
            [true, sv ? 'Ja' : 'Yes'],
            [false, sv ? 'Nej' : 'No'],
          ] as const).map(([val, label]) => (
            <TouchableOpacity key={String(val)} style={[s.segBtn, usesDitto === val && s.segBtnActive]} onPress={() => { Haptics.selectionAsync(); setUsesDitto(val); }} activeOpacity={0.75}>
              <Text style={[s.segText, usesDitto === val && s.segTextActive]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Save */}
      <TouchableOpacity style={s.saveBtn} onPress={handleSave} activeOpacity={0.85}>
        <Ionicons name="checkmark-circle" size={20} color={Colors.textInverse} />
        <Text style={s.saveBtnText}>{sv ? 'Spara profil' : 'Save profile'}</Text>
      </TouchableOpacity>

      <Text style={s.footer}>
        {sv
          ? 'Skanna en sida åt gången. Profilen skickas automatiskt till AI:n vid varje skanning för bättre resultat.'
          : 'Scan one page at a time. The profile is automatically sent to the AI with every scan for better results.'}
      </Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 48, gap: 4 },
  title: { color: Colors.textPrimary, fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18, marginBottom: 8 },

  section: { marginTop: 16, gap: 6 },
  question: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
  hint: { color: Colors.textMuted, fontSize: 12, lineHeight: 16 },

  inputRow: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1, backgroundColor: Colors.card, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border,
    color: Colors.textPrimary, fontSize: 14,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  addBtn: {
    width: 40, borderRadius: 10, backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.primary + '18', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 5,
    borderWidth: 1, borderColor: Colors.primary + '44',
  },
  chipText: { color: Colors.primary, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' },

  segRow: { flexDirection: 'row', gap: 6 },
  segBtn: {
    flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center',
    backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
  },
  segBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  segText: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700' },
  segTextActive: { color: Colors.textInverse },

  sheetContainer: {
    backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1,
    borderColor: Colors.cardBorder, overflow: 'hidden', paddingBottom: 2,
  },
  sheetHeaderCell: {
    width: 44, paddingVertical: 5, alignItems: 'center',
    backgroundColor: Colors.elevated,
    borderRightWidth: 0.5, borderBottomWidth: 1,
    borderColor: Colors.border,
  },
  sheetHeaderNum: { color: Colors.primary, fontSize: 7, fontWeight: '800', fontFamily: 'Menlo' },
  sheetHeaderText: { color: Colors.textPrimary, fontSize: 8, fontWeight: '700', marginTop: 1 },
  sheetDataCell: {
    width: 44, paddingVertical: 4, alignItems: 'center',
    borderRightWidth: 0.5, borderBottomWidth: 0.5,
    borderColor: Colors.border,
  },
  sheetDataText: { color: Colors.textMuted, fontSize: 7, fontFamily: 'Menlo' },
  sheetSummaryCell: {
    width: 44, paddingVertical: 3, alignItems: 'center',
    backgroundColor: Colors.primary + '0C',
    borderRightWidth: 0.5, borderBottomWidth: 0.5,
    borderColor: Colors.primary + '33',
  },
  sheetSummaryText: { color: Colors.primary, fontSize: 6, fontWeight: '800', fontFamily: 'Menlo' },
  sheetLegend: { color: Colors.textMuted, fontSize: 8 },
  sheetEmpty: {
    backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1,
    borderColor: Colors.cardBorder, padding: 20, alignItems: 'center',
    borderStyle: 'dashed',
  },


  scanStructBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.primary + '14', borderRadius: 10,
    borderWidth: 1, borderColor: Colors.primary + '44',
    paddingVertical: 12,
  },
  scanStructText: { color: Colors.primary, fontSize: 12, fontWeight: '700' },

  rowCountBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  rowCountValue: {
    color: Colors.textPrimary, fontSize: 20, fontWeight: '800',
    fontFamily: 'Menlo', minWidth: 32, textAlign: 'center',
  },

  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 15, marginTop: 20,
  },
  saveBtnText: { color: Colors.textInverse, fontSize: 16, fontWeight: '700' },

  resultCard: {
    backgroundColor: Colors.card, borderRadius: 12, padding: 14, gap: 8,
    borderWidth: 1, borderColor: Colors.primary + '44',
  },
  resultInfo: {
    color: Colors.textSecondary, fontSize: 12, fontWeight: '600',
    textAlign: 'center', letterSpacing: 0.3,
  },
  resultLabel: {
    color: Colors.textMuted, fontSize: 10, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8,
  },
  resultInput: {
    backgroundColor: Colors.elevated, borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: Colors.border,
    color: Colors.textPrimary, fontSize: 15, fontWeight: '600',
  },
  resultOptBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8,
    borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.elevated,
  },
  resultOptBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' },
  resultOptText: { color: Colors.textMuted, fontSize: 11, fontWeight: '700' },
  resultOptTextActive: { color: Colors.primary },
  resultAddBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: 10, paddingVertical: 12, marginTop: 4,
  },
  resultAddBtnText: { color: Colors.textInverse, fontSize: 14, fontWeight: '700' },

  suggestionList: {
    backgroundColor: Colors.card, borderRadius: 10,
    borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
  },
  suggestionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 11,
    borderBottomWidth: 0.5, borderBottomColor: Colors.separator,
  },
  suggestionName: { color: Colors.textPrimary, fontSize: 14, fontWeight: '600' },
  suggestionBadge: {
    backgroundColor: Colors.primary + '22', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  suggestionPrefix: { color: Colors.primary, fontSize: 13, fontWeight: '800', fontFamily: 'Menlo' },

  footer: { color: Colors.textMuted, fontSize: 11, textAlign: 'center', lineHeight: 16, marginTop: 12 },
});
