import { useState, useMemo } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Alert, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { pickImportFile, importFromFile, type ImportResult } from '../../services/import';
import { insertFlight, getAircraftCruiseSpeed, updateAircraftCruiseSpeed, updateAircraftEndurance, addAircraftTypeToRegistry } from '../../db/flights';
import { useFlightStore } from '../../store/flightStore';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import type { OcrFlightResult } from '../../types/flight';
import { TextInput as RNTextInput } from 'react-native';
import { getAirportByIcao, addCustomAirport, addTemporaryPlace, getAirportCoordinates, calculateDistance } from '../../db/icao';

const SUPPORTED_FORMATS = [
  { name: 'ForeFlight', icon: 'airplane', ext: 'CSV' },
  { name: 'LogTen Pro', icon: 'document-text', ext: 'TXT' },
  { name: 'MyFlightbook', icon: 'book', ext: 'CSV' },
  { name: 'mccPILOTLOG', icon: 'grid', ext: 'CSV/XLS' },
  { name: 'Logbook Pro', icon: 'document', ext: 'CSV' },
  { name: 'APDL', icon: 'layers', ext: 'TXT' },
  { name: 'Eflightbook', icon: 'albums', ext: 'CSV' },
  { name: 'Generic CSV', icon: 'code', ext: 'CSV' },
];

function makeStyles() {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    content: { padding: 16, paddingBottom: 40, gap: 12 },

    title: { color: Colors.textPrimary, fontSize: 24, fontWeight: '800' },
    subtitle: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20 },

    freeNotice: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: Colors.success + '18', borderRadius: 8,
      padding: 12, borderWidth: 1, borderColor: Colors.success + '44',
    },
    freeNoticeText: { color: Colors.success, fontSize: 13, fontWeight: '600' },

    section: {
      color: Colors.textSecondary, fontSize: 11, fontWeight: '700',
      textTransform: 'uppercase', letterSpacing: 1,
      marginTop: 8, marginBottom: 4,
    },

    formatGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    formatChip: {
      flexDirection: 'row', alignItems: 'center', gap: 5,
      backgroundColor: Colors.card, borderRadius: 8,
      paddingHorizontal: 10, paddingVertical: 7,
      borderWidth: 1, borderColor: Colors.border,
    },
    formatName: { color: Colors.textPrimary, fontSize: 12, fontWeight: '600' },
    formatExt: { color: Colors.textMuted, fontSize: 10 },

    pickBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: Colors.primary, borderRadius: 12,
      paddingVertical: 15, gap: 8,
    },
    pickBtnText: { color: Colors.textInverse, fontSize: 16, fontWeight: '700' },

    resultHeader: {
      backgroundColor: Colors.card, borderRadius: 12, padding: 14,
      borderWidth: 1, borderColor: Colors.cardBorder,
      flexDirection: 'row', alignItems: 'center', gap: 12,
    },
    resultInfo: { flex: 1 },
    resultFormat: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
    resultFile: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
    resultStats: { flexDirection: 'row', gap: 8 },
    statPill: { alignItems: 'center' },
    statValue: { color: Colors.textPrimary, fontSize: 16, fontWeight: '800' },
    statLabel: { color: Colors.textMuted, fontSize: 9, textTransform: 'uppercase' },

    warningBox: {
      backgroundColor: Colors.warning + '18', borderRadius: 10, padding: 12,
      gap: 6, borderWidth: 1, borderColor: Colors.warning + '44',
    },
    warningRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start' },
    warningText: { color: Colors.warning, fontSize: 12, flex: 1 },

    summaryCard: {
      flexDirection: 'row', backgroundColor: Colors.card, borderRadius: 12,
      borderWidth: 1, borderColor: Colors.cardBorder,
      overflow: 'hidden',
    },
    summaryItem: { flex: 1, alignItems: 'center', paddingVertical: 16 },
    summaryValue: { color: Colors.primary, fontSize: 28, fontWeight: '800' },
    summaryLabel: { color: Colors.textSecondary, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },
    summarySep: { width: 1, backgroundColor: Colors.separator, marginVertical: 12 },

    previewRow: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: Colors.card, borderRadius: 8, padding: 10,
      borderWidth: 1, borderColor: Colors.cardBorder, gap: 8,
    },
    previewRowFlagged: { borderColor: Colors.warning + '66' },
    previewRoute: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700' },
    previewDate: { color: Colors.textSecondary, fontSize: 12 },
    previewChip: { color: Colors.primary, fontSize: 11, fontWeight: '700', fontFamily: 'Menlo' },
    moreText: { color: Colors.textMuted, fontSize: 12, textAlign: 'center' },

    saveBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
      backgroundColor: Colors.accent, borderRadius: 12, paddingVertical: 15, gap: 8, marginTop: 8,
    },
    saveBtnText: { color: Colors.textInverse, fontSize: 16, fontWeight: '700' },
    hint: { color: Colors.textMuted, fontSize: 11, textAlign: 'center' },

    instructionRow: {
      flexDirection: 'row', backgroundColor: Colors.card,
      borderRadius: 8, padding: 12,
      borderWidth: 1, borderColor: Colors.cardBorder, gap: 8,
    },
    instructionApp: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700', width: 110 },
    instructionSteps: { color: Colors.textSecondary, fontSize: 12, flex: 1 },

    speedSection: {
      backgroundColor: Colors.gold + '14',
      borderRadius: 10, padding: 12,
      borderWidth: 1, borderColor: Colors.gold + '55', gap: 8,
    },
    speedHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    speedTitle: { color: Colors.gold, fontSize: 12, fontWeight: '700' },
    speedSubtitle: { color: Colors.textSecondary, fontSize: 11, lineHeight: 16 },
    speedRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: Colors.card, borderRadius: 8,
      paddingHorizontal: 12, paddingVertical: 8,
      borderWidth: 1, borderColor: Colors.border,
    },
    speedColHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 },
    speedType: { flex: 1, color: Colors.textPrimary, fontSize: 14, fontWeight: '700', letterSpacing: 0.5 },
    speedInput: {
      width: 72, color: Colors.textPrimary, fontSize: 15, fontWeight: '700',
      fontFamily: 'Menlo', textAlign: 'center',
      backgroundColor: Colors.elevated, borderRadius: 6,
      paddingHorizontal: 6, paddingVertical: 6,
      borderWidth: 1, borderColor: Colors.border,
    },
    speedInputDone: { borderColor: Colors.success + '66', backgroundColor: Colors.success + '12' },
    speedUnit: { color: Colors.textMuted, fontSize: 12, fontWeight: '600', width: 24 },

    exceedSection: {
      backgroundColor: Colors.warning + '12',
      borderRadius: 10, padding: 12,
      borderWidth: 1, borderColor: Colors.warning + '55', gap: 8,
    },
    exceedTitle: { color: Colors.warning, fontSize: 12, fontWeight: '700' },
    exceedRow: {
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: Colors.card, borderRadius: 8,
      padding: 10, borderWidth: 1, borderColor: Colors.border, gap: 8,
    },
    exceedInfo: { flex: 1 },
    exceedRoute: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' },
    exceedMeta: { color: Colors.textSecondary, fontSize: 11, marginTop: 2 },
    exceedToggle: { flexDirection: 'row', gap: 4 },
    exceedBtn: {
      paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6,
      borderWidth: 1, borderColor: Colors.border,
      backgroundColor: Colors.elevated,
    },
    exceedBtnSim: { backgroundColor: Colors.danger + '22', borderColor: Colors.danger + '88' },
    exceedBtnHot: { backgroundColor: Colors.success + '22', borderColor: Colors.success + '88' },
    exceedBtnText: { color: Colors.textMuted, fontSize: 11, fontWeight: '600' },
    exceedBtnTextActive: { color: Colors.textPrimary, fontWeight: '700' },

    typeBlock: { gap: 6 },
    crewRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 2 },
    crewBtn: {
      flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 8,
      borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.elevated,
    },
    crewBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' },
    crewBtnLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700' },
    crewBtnLabelActive: { color: Colors.primary },
    crewBtnSub: { color: Colors.textMuted, fontSize: 9, marginTop: 1 },

    // Misstänkta sträckor
    suspiciousSection: {
      backgroundColor: Colors.warning + '12',
      borderRadius: 10, padding: 12,
      borderWidth: 1, borderColor: Colors.warning + '55', gap: 8,
    },
    suspiciousTitle: { color: Colors.warning, fontSize: 12, fontWeight: '700' },
    suspiciousRow: {
      backgroundColor: Colors.card, borderRadius: 8,
      padding: 10, borderWidth: 1, borderColor: Colors.border, gap: 8,
    },
    suspiciousInfo: { gap: 2 },
    suspiciousRoute: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700', fontFamily: 'Menlo' },
    suspiciousMeta: { color: Colors.textSecondary, fontSize: 11 },
    suspiciousToggle: { flexDirection: 'row', gap: 6 },
    suspiciousBtn: {
      flex: 1, paddingHorizontal: 8, paddingVertical: 7, borderRadius: 6,
      borderWidth: 1, borderColor: Colors.border,
      backgroundColor: Colors.elevated, alignItems: 'center',
    },
    suspiciousBtnActive: { backgroundColor: Colors.textMuted + 'CC', borderColor: Colors.textMuted },
    suspiciousBtnRefuel: { backgroundColor: Colors.success + '22', borderColor: Colors.success + '88' },
    suspiciousBtnText: { color: Colors.textMuted, fontSize: 11, fontWeight: '600', textAlign: 'center' },
    suspiciousBtnTextActive: { color: Colors.textInverse, fontWeight: '700' },

    // Okända flygplatser
    unknownSection: {
      backgroundColor: Colors.danger + '10',
      borderRadius: 10, padding: 12,
      borderWidth: 1, borderColor: Colors.danger + '44', gap: 8,
    },
    unknownTitle: { color: Colors.danger, fontSize: 12, fontWeight: '700' },
    unknownRow: {
      backgroundColor: Colors.card, borderRadius: 8,
      borderWidth: 1, borderColor: Colors.border, overflow: 'hidden',
    },
    unknownHeader: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 12, paddingVertical: 10, gap: 8,
    },
    unknownIcao: {
      color: Colors.textPrimary, fontSize: 14, fontWeight: '800',
      fontFamily: 'Menlo', letterSpacing: 1,
    },
    unknownDecisionLabel: { color: Colors.success, fontSize: 11, fontWeight: '600', marginTop: 2 },
    unknownDecisionTemporary: { color: Colors.textMuted },
    unknownBody: { paddingHorizontal: 12, paddingBottom: 12, gap: 8, borderTopWidth: 1, borderTopColor: Colors.separator },
    tempBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: Colors.elevated, borderRadius: 8,
      paddingHorizontal: 12, paddingVertical: 10,
      borderWidth: 1, borderColor: Colors.border,
    },
    tempBtnActive: { backgroundColor: Colors.textMuted, borderColor: Colors.textMuted },
    tempBtnText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '500', flex: 1 },
    tempBtnTextActive: { color: Colors.textInverse },
    unknownForm: { gap: 6 },
    unknownFormLabel: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600', marginTop: 4 },
    unknownInput: {
      backgroundColor: Colors.elevated, borderRadius: 8, padding: 10,
      borderWidth: 1, borderColor: Colors.border,
      color: Colors.textPrimary, fontSize: 14,
    },
  });
}

export default function ImportScreen() {
  const styles = makeStyles();
  const { t } = useTranslation();
  const router = useRouter();
  const { loadFlights, loadStats } = useFlightStore();

  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [result, setResult] = useState<ImportResult | null>(null);
  const [saving, setSaving] = useState(false);
  const [fileName, setFileName] = useState('');
  // Marschfart + uthållighet för fartygstyper utan registrerade värden
  const [speedInputs, setSpeedInputs] = useState<Record<string, string>>({});
  const [enduranceInputs, setEnduranceInputs] = useState<Record<string, string>>({});
  const [typesNeedingData, setTypesNeedingData] = useState<{ type: string; hasSpeed: boolean; hasEndurance: boolean }[]>([]);
  // flight_type per flygningsindex för flygningar som överstiger uthållighet: 'sim' | 'hot_refuel'
  const [flightTypes, setFlightTypes] = useState<Record<number, 'sim' | 'hot_refuel'>>({});
  // sim-kategori per index när flight_type='sim': FFS | FTD | FNPT_II | FNPT_I | BITD
  const [simCategories, setSimCategories] = useState<Record<number, 'FFS' | 'FTD' | 'FNPT_II' | 'FNPT_I' | 'BITD' | 'CPT_PPT' | 'CBT'>>({});
  // Besättningstyp per fartygstyp
  const [crewTypeInputs, setCrewTypeInputs] = useState<Record<string, Set<string>>>({});
  // Farkosttyp per typ: 'airplane' | 'helicopter' | ''
  const [categoryInputs, setCategoryInputs] = useState<Record<string, 'airplane' | 'helicopter' | ''>>({});
  // Koordinater för kända flygplatser i importen + kända typ-data från DB
  const [airportCoords, setAirportCoords] = useState<Record<string, { lat: number; lon: number }>>({});
  const [dbTypeData, setDbTypeData] = useState<Record<string, { speedKts: number; endH: number }>>({});
  // Förklaring per flygningsindex för misstänkta flygningar
  const [flightExplanations, setFlightExplanations] = useState<Record<number, 'temporary' | 'refuel'>>({});

  // Okända ICAO-koder som hittades i importfilen
  type UnknownAirport = {
    icao: string;
    decision: 'pending' | 'temporary' | 'custom';
    name: string;
    lat: string;
    lon: string;
    expanded: boolean;
  };
  const [unknownAirports, setUnknownAirports] = useState<UnknownAirport[]>([]);

  const toggleCrewForType = (aircraftType: string, key: 'sp' | 'mp') => {
    setCrewTypeInputs(prev => {
      const current = new Set(prev[aircraftType] ?? []);
      if (current.has(key)) current.delete(key); else current.add(key);
      return { ...prev, [aircraftType]: current };
    });
  };

  // Motortyp per fartygstyp: 'se' | 'me' | ''
  const [engineInputs, setEngineInputs] = useState<Record<string, 'se' | 'me' | ''>>({});

  // Flygningar som överstiger angiven uthållighet — reaktivt på enduranceInputs
  const exceedingFlights = useMemo(() => {
    if (!result) return [];
    return result.flights
      .map((f, idx) => ({ f, idx }))
      .filter(({ f }) => {
        const raw = enduranceInputs[f.aircraft_type] ?? '';
        if (raw.endsWith('.')) return false; // fortfarande inmatning, vänta
        const endH = parseFloat(raw) || 0;
        return endH > 0 && parseFloat(f.total_time) > endH;
      });
  }, [result, enduranceInputs]);

  // Flygningar vars avstånd överstiger 1.5× räckvidd (endurance × marschfart)
  const suspiciousFlights = useMemo(() => {
    if (!result || Object.keys(airportCoords).length === 0) return [];
    return result.flights
      .map((f, idx) => {
        const dep = airportCoords[f.dep_place ?? ''];
        const arr = airportCoords[f.arr_place ?? ''];
        if (!dep || !arr || f.dep_place === f.arr_place) return null;

        // Hämta fart + endurance: user-input prioriteras, annars DB-känd
        // Om fältet slutar på '.' håller användaren fortfarande på att skriva — använd 0
        const rawSpeed = speedInputs[f.aircraft_type] ?? '';
        const rawEnd = enduranceInputs[f.aircraft_type] ?? '';
        const speedKts =
          (!rawSpeed.endsWith('.') && parseInt(rawSpeed)) ||
          dbTypeData[f.aircraft_type]?.speedKts || 0;
        const endH =
          (!rawEnd.endsWith('.') && parseFloat(rawEnd)) ||
          dbTypeData[f.aircraft_type]?.endH || 0;
        if (!speedKts || !endH) return null;

        const distKm = calculateDistance(dep.lat, dep.lon, arr.lat, arr.lon);
        const distNm = distKm / 1.852;
        const rangeNm = speedKts * endH;
        if (distNm > rangeNm * 1.5) return { idx, f, distNm: Math.round(distNm), rangeNm: Math.round(rangeNm) };
        return null;
      })
      .filter((x): x is { idx: number; f: OcrFlightResult; distNm: number; rangeNm: number } => x !== null);
  }, [result, airportCoords, speedInputs, enduranceInputs, dbTypeData]);

  const handlePick = async () => {
    const file = await pickImportFile();
    if (!file) return;

    setFileName(file.name);
    setImporting(true);
    setResult(null);
    setProgress({ current: 0, total: 0 });
    setUnknownAirports([]);
    setAirportCoords({});
    setDbTypeData({});
    setFlightExplanations({});

    try {
      const res = await importFromFile(file.uri, (current, total) => {
        setProgress({ current, total });
      });
      setResult(res);

      // Kolla vilka fartygstyper i importen som saknar marschfart eller uthållighet
      const types = [...new Set(res.flights.map((f) => f.aircraft_type).filter(Boolean))];
      const needingData: { type: string; hasSpeed: boolean; hasEndurance: boolean }[] = [];
      for (const t of types) {
        const speed = await getAircraftCruiseSpeed(t);
        // Hämta uthållighet via samma registry
        const db = await import('../../db/database').then(m => m.getDatabase());
        const row = await db.getFirstAsync<{ endurance_h: number }>(
          `SELECT MAX(endurance_h) as endurance_h FROM aircraft_registry WHERE aircraft_type=?`, [t]
        );
        const endH = row?.endurance_h ?? 0;
        if (!speed || !endH) {
          needingData.push({ type: t, hasSpeed: speed > 0, hasEndurance: endH > 0 });
        }
      }
      setTypesNeedingData(needingData);
      setSpeedInputs(Object.fromEntries(needingData.map(({ type }) => [type, ''])));
      setEnduranceInputs(Object.fromEntries(needingData.map(({ type }) => [type, ''])));
      setCategoryInputs(Object.fromEntries(needingData.map(({ type }) => [type, ''])));
      setEngineInputs(Object.fromEntries(needingData.map(({ type }) => [type, ''])));

      // Kontrollera okända ICAO-koder mot databasen
      const places = [...new Set(
        res.flights.flatMap(f => [f.dep_place, f.arr_place]).filter((p): p is string => !!p && p.trim().length > 0)
      )];
      const unknowns: UnknownAirport[] = [];
      for (const place of places) {
        const found = await getAirportByIcao(place);
        if (!found) {
          unknowns.push({ icao: place, decision: 'pending', name: '', lat: '', lon: '', expanded: false });
        }
      }
      setUnknownAirports(unknowns);

      // Hämta koordinater för alla kända platser (för avståndsberäkning)
      const coords = await getAirportCoordinates(places);
      const coordMap: Record<string, { lat: number; lon: number }> = {};
      for (const c of coords) coordMap[c.icao] = { lat: c.lat, lon: c.lon };
      setAirportCoords(coordMap);

      // Hämta kända fart/endurance från DB för typer som INTE är i needingData
      const db2 = await import('../../db/database').then(m => m.getDatabase());
      const knownTypes = types.filter(t => !needingData.find(n => n.type === t));
      const dbData: Record<string, { speedKts: number; endH: number }> = {};
      for (const t of knownTypes) {
        const row = await db2.getFirstAsync<{ cruise_speed_kts: number; endurance_h: number }>(
          `SELECT MAX(cruise_speed_kts) as cruise_speed_kts, MAX(endurance_h) as endurance_h FROM aircraft_registry WHERE aircraft_type=?`, [t]
        );
        if (row) dbData[t] = { speedKts: row.cruise_speed_kts ?? 0, endH: row.endurance_h ?? 0 };
      }
      setDbTypeData(dbData);
    } catch (e: any) {
      Alert.alert(t('import_failed'), e.message);
    } finally {
      setImporting(false);
    }
  };

  const saveAll = async () => {
    if (!result) return;
    setSaving(true);
    let saved = 0;
    try {
      // Spara marschfart och uthållighet för fartygstyper som saknade värden
      for (const { type } of typesNeedingData) {
        const speedKts = parseInt(speedInputs[type] ?? '0') || 0;
        const endH = parseFloat(enduranceInputs[type] ?? '0') || 0;
        const crewSet = crewTypeInputs[type] ?? new Set<string>();
        const crewType = crewSet.size === 0 ? '' : [...crewSet].sort().join(',');
        const category = categoryInputs[type] ?? '';
        const engineType = engineInputs[type] ?? '';
        await addAircraftTypeToRegistry(type, speedKts, endH, crewType, category, engineType);
        if (speedKts > 0) await updateAircraftCruiseSpeed(type, speedKts);
        if (endH > 0) await updateAircraftEndurance(type, endH);
      }
      // Spara okända flygplatser
      for (const ua of unknownAirports) {
        if (ua.decision === 'temporary') {
          await addTemporaryPlace(ua.icao, ua.icao);
        } else if (ua.decision === 'custom') {
          const lat = parseFloat(ua.lat.replace(',', '.'));
          const lon = parseFloat(ua.lon.replace(',', '.'));
          if (!isNaN(lat) && !isNaN(lon)) {
            await addCustomAirport({
              icao: ua.icao,
              name: ua.name || ua.icao,
              country: '',
              region: '',
              lat,
              lon,
            });
          }
        }
        // 'pending' — lämnas utan åtgärd, platsen finns ändå i flygningens text
      }
      for (let i = 0; i < result.flights.length; i++) {
        const f = result.flights[i];
        const ft = flightTypes[i] ?? 'normal';
        const simCat = ft === 'sim' ? (simCategories[i] ?? 'FFS') : '';
        const explanation = flightExplanations[i];
        const remarksNote =
          explanation === 'temporary' ? '[Temporary landing site]' :
          explanation === 'refuel'    ? '[En-route refuel]' : '';
        const remarks = [f.remarks, remarksNote].filter(Boolean).join(' ');
        await insertFlight({ ...f, remarks, flight_type: ft, sim_category: simCat as any }, { source: 'import' });
        saved++;
      }
      await Promise.all([loadFlights(), loadStats()]);
      Alert.alert(t('done_exclamation'), `${saved} ${t('flights_imported')}`, [
        { text: 'OK', onPress: () => router.back() },
      ]);
    } catch (e: any) {
      Alert.alert(t('save_error'), e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
    >
      <Text style={styles.title}>{t('import_logbook')}</Text>
      <Text style={styles.subtitle}>{t('import_logbook_sub')}</Text>

      {/* Free notice */}
      <View style={styles.freeNotice}>
        <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
        <Text style={styles.freeNoticeText}>{t('import_always_free')}</Text>
      </View>

      {/* Format list */}
      <Text style={styles.section}>{t('supported_formats')}</Text>
      <View style={styles.formatGrid}>
        {SUPPORTED_FORMATS.map((f) => (
          <View key={f.name} style={styles.formatChip}>
            <Ionicons name={f.icon as any} size={14} color={Colors.primary} />
            <Text style={styles.formatName}>{f.name}</Text>
            <Text style={styles.formatExt}>{f.ext}</Text>
          </View>
        ))}
      </View>

      {/* Välj fil */}
      <TouchableOpacity
        style={[styles.pickBtn, importing && { opacity: 0.6 }]}
        onPress={handlePick}
        disabled={importing}
        activeOpacity={0.8}
      >
        {importing ? (
          <>
            <ActivityIndicator color={Colors.textInverse} size="small" />
            <Text style={styles.pickBtnText}>
              {progress.current === 0 ? t('reading_file') :
               progress.current === 1 ? t('claude_identifying') :
               progress.current === 2 ? t('parsing_rows') :
               t('done_exclamation')}
            </Text>
          </>
        ) : (
          <>
            <Ionicons name="cloud-upload" size={20} color={Colors.textInverse} />
            <Text style={styles.pickBtnText}>{t('choose_file')}</Text>
          </>
        )}
      </TouchableOpacity>

      {/* Förhandsvisning */}
      {result && (
        <>
          <View style={styles.resultHeader}>
            <View style={styles.resultInfo}>
              <Text style={styles.resultFormat}>{result.detectedFormat}</Text>
              <Text style={styles.resultFile} numberOfLines={1}>{fileName}</Text>
            </View>
            <View style={styles.resultStats}>
              <StatPill label="Rows" value={String(result.totalRows)} />
              <StatPill label="Mapped" value={String(result.mappedRows)} color={Colors.success} />
              {result.warnings.length > 0 && (
                <StatPill label="Warnings" value={String(result.warnings.length)} color={Colors.warning} />
              )}
            </View>
          </View>

          {/* Varningar */}
          {result.warnings.length > 0 && (
            <View style={styles.warningBox}>
              {result.warnings.map((w, i) => (
                <View key={i} style={styles.warningRow}>
                  <Ionicons name="warning" size={12} color={Colors.warning} />
                  <Text style={styles.warningText}>{w}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Flight summary */}
          {(() => {
            const totalHours = result.flights.reduce((sum, f) => sum + (parseFloat(f.total_time) || 0), 0);
            return (
              <View style={styles.summaryCard}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>{result.flights.length}</Text>
                  <Text style={styles.summaryLabel}>{t('flights_label')}</Text>
                </View>
                <View style={styles.summarySep} />
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryValue}>{totalHours.toFixed(1)}h</Text>
                  <Text style={styles.summaryLabel}>{t('total_flight_time')}</Text>
                </View>
              </View>
            );
          })()}

          {/* Okända flygplatser */}
          {unknownAirports.length > 0 && (
            <View style={styles.unknownSection}>
              <View style={styles.speedHeader}>
                <Ionicons name="location-outline" size={14} color={Colors.danger} />
                <Text style={styles.unknownTitle}>{t('unknown_airports')} ({unknownAirports.length})</Text>
              </View>
              <Text style={styles.speedSubtitle}>{t('unknown_airports_sub')}</Text>
              {unknownAirports.map((ua, idx) => {
                const setField = (patch: Partial<typeof ua>) =>
                  setUnknownAirports(prev => prev.map((x, i) => i === idx ? { ...x, ...patch } : x));
                return (
                  <View key={ua.icao} style={styles.unknownRow}>
                    {/* Rubrikrad */}
                    <TouchableOpacity
                      style={styles.unknownHeader}
                      onPress={() => setField({ expanded: !ua.expanded })}
                      activeOpacity={0.7}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.unknownIcao}>{ua.icao}</Text>
                        {ua.decision !== 'pending' && (
                          <Text style={[styles.unknownDecisionLabel, ua.decision === 'temporary' && styles.unknownDecisionTemporary]}>
                            {ua.decision === 'temporary' ? t('temporary_badge') : t('will_be_added')}
                          </Text>
                        )}
                      </View>
                      <Ionicons
                        name={ua.expanded ? 'chevron-up' : 'chevron-down'}
                        size={16} color={Colors.textMuted}
                      />
                    </TouchableOpacity>

                    {ua.expanded && (
                      <View style={styles.unknownBody}>
                        {/* Tillfällig-knapp */}
                        <TouchableOpacity
                          style={[styles.tempBtn, ua.decision === 'temporary' && styles.tempBtnActive]}
                          onPress={() => setField({ decision: ua.decision === 'temporary' ? 'pending' : 'temporary' })}
                          activeOpacity={0.7}
                        >
                          <Ionicons
                            name={ua.decision === 'temporary' ? 'checkmark-circle' : 'flag-outline'}
                            size={14}
                            color={ua.decision === 'temporary' ? Colors.textInverse : Colors.textMuted}
                          />
                          <Text style={[styles.tempBtnText, ua.decision === 'temporary' && styles.tempBtnTextActive]}>
                            {t('temporary_landing_site')}
                          </Text>
                        </TouchableOpacity>

                        {/* Formulär för att lägga till i databasen */}
                        {ua.decision !== 'temporary' && (
                          <View style={styles.unknownForm}>
                            <Text style={styles.unknownFormLabel}>{t('or_add_to_database')}</Text>
                            <RNTextInput
                              style={styles.unknownInput}
                              placeholder={t('name_placeholder')}
                              placeholderTextColor={Colors.textMuted}
                              value={ua.name}
                              onChangeText={(v) => setField({ name: v, decision: v ? 'custom' : 'pending' })}
                            />
                            <View style={{ flexDirection: 'row', gap: 8 }}>
                              <RNTextInput
                                style={[styles.unknownInput, { flex: 1 }]}
                                placeholder={t('latitude_placeholder')}
                                placeholderTextColor={Colors.textMuted}
                                keyboardType="decimal-pad"
                                value={ua.lat}
                                onChangeText={(v) => setField({ lat: v, decision: ua.name || v ? 'custom' : 'pending' })}
                              />
                              <RNTextInput
                                style={[styles.unknownInput, { flex: 1 }]}
                                placeholder={t('longitude_placeholder')}
                                placeholderTextColor={Colors.textMuted}
                                keyboardType="decimal-pad"
                                value={ua.lon}
                                onChangeText={(v) => setField({ lon: v, decision: ua.name || v ? 'custom' : 'pending' })}
                              />
                            </View>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {/* Marschfart + uthållighet för nya/ofullständiga fartygstyper */}
          {typesNeedingData.length > 0 && (
            <View style={styles.speedSection}>
              <View style={styles.speedHeader}>
                <Ionicons name="speedometer-outline" size={14} color={Colors.gold} />
                <Text style={styles.speedTitle}>{t('aircraft_data')}</Text>
              </View>
              <Text style={styles.speedSubtitle}>{t('aircraft_data_sub')} {t('aircraft_data_edit_later')}</Text>
              <View style={styles.speedColHeader}>
                <Text style={[styles.speedType, { color: Colors.textMuted, fontSize: 10 }]}>TYPE</Text>
                <Text style={[styles.speedUnit, { color: Colors.textMuted, fontSize: 10, width: 80, textAlign: 'center' }]}>SPEED (kts)</Text>
                <Text style={[styles.speedUnit, { color: Colors.textMuted, fontSize: 10, width: 80, textAlign: 'center' }]}>ENDUR. (h)</Text>
              </View>
              {typesNeedingData.map(({ type, hasSpeed, hasEndurance }) => {
                const crewSet = crewTypeInputs[type] ?? new Set<string>();
                return (
                  <View key={type} style={styles.typeBlock}>
                    <View style={styles.speedRow}>
                      <Text style={styles.speedType}>{type}</Text>
                      <RNTextInput
                        style={[styles.speedInput, hasSpeed && styles.speedInputDone]}
                        placeholder={hasSpeed ? '✓' : '110'}
                        placeholderTextColor={hasSpeed ? Colors.success : Colors.textMuted}
                        keyboardType="number-pad"
                        value={speedInputs[type] ?? ''}
                        onChangeText={(v) => setSpeedInputs((prev) => ({ ...prev, [type]: v }))}
                        maxLength={4}
                        editable={!hasSpeed}
                      />
                      <RNTextInput
                        style={[styles.speedInput, hasEndurance && styles.speedInputDone]}
                        placeholder={hasEndurance ? '✓' : '3.0'}
                        placeholderTextColor={hasEndurance ? Colors.success : Colors.textMuted}
                        keyboardType="decimal-pad"
                        value={enduranceInputs[type] ?? ''}
                        onChangeText={(v) => setEnduranceInputs((prev) => ({ ...prev, [type]: v }))}
                        maxLength={4}
                        editable={!hasEndurance}
                      />
                    </View>
                    <View style={styles.crewRow}>
                      {(['sp', 'mp'] as const).map((key) => {
                        const active = crewSet.has(key);
                        const label = key === 'sp' ? 'SP' : 'MP';
                        const sub = key === 'sp' ? 'Single pilot' : 'Multi-pilot';
                        return (
                          <TouchableOpacity
                            key={key}
                            style={[styles.crewBtn, active && styles.crewBtnActive]}
                            onPress={() => toggleCrewForType(type, key)}
                            activeOpacity={0.7}
                          >
                            <Text style={[styles.crewBtnLabel, active && styles.crewBtnLabelActive]}>{label}</Text>
                            <Text style={styles.crewBtnSub}>{sub}</Text>
                          </TouchableOpacity>
                        );
                      })}
                      {(['se', 'me'] as const).map((key) => {
                        const active = engineInputs[type] === key;
                        const label = key === 'se' ? 'SE' : 'ME';
                        const sub = key === 'se' ? 'Single engine' : 'Multi engine';
                        return (
                          <TouchableOpacity
                            key={key}
                            style={[styles.crewBtn, active && styles.crewBtnActive]}
                            onPress={() => setEngineInputs(prev => ({ ...prev, [type]: active ? '' : key }))}
                            activeOpacity={0.7}
                          >
                            <Text style={[styles.crewBtnLabel, active && styles.crewBtnLabelActive]}>{label}</Text>
                            <Text style={styles.crewBtnSub}>{sub}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <View style={styles.crewRow}>
                      {(['airplane', 'helicopter'] as const).map((cat) => {
                        const active = categoryInputs[type] === cat;
                        return (
                          <TouchableOpacity
                            key={cat}
                            style={[styles.crewBtn, { flex: 1 }, active && styles.crewBtnActive]}
                            onPress={() => setCategoryInputs(prev => ({ ...prev, [type]: active ? '' : cat }))}
                            activeOpacity={0.7}
                          >
                            <Text style={[styles.crewBtnLabel, active && styles.crewBtnLabelActive]}>
                              {cat === 'airplane' ? t('airplane') : t('helicopter')}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* Misstänkta flygningar — avstånd > 1.5× räckvidd */}
          {suspiciousFlights.length > 0 && (
            <View style={styles.suspiciousSection}>
              <View style={styles.speedHeader}>
                <Ionicons name="warning-outline" size={14} color={Colors.warning} />
                <Text style={styles.suspiciousTitle}>Suspicious legs ({suspiciousFlights.length})</Text>
              </View>
              <Text style={styles.speedSubtitle}>
                Distance exceeds 1.5× the range. Provide an explanation or import anyway.
              </Text>
              {suspiciousFlights.map(({ idx, f, distNm, rangeNm }) => {
                const current = flightExplanations[idx];
                return (
                  <View key={idx} style={styles.suspiciousRow}>
                    <View style={styles.suspiciousInfo}>
                      <Text style={styles.suspiciousRoute}>{f.dep_place || '?'}→{f.arr_place || '?'}</Text>
                      <Text style={styles.suspiciousMeta}>
                        {f.date} · {f.aircraft_type} · {distNm} nm · range {rangeNm} nm
                      </Text>
                    </View>
                    <View style={styles.suspiciousToggle}>
                      <TouchableOpacity
                        style={[styles.suspiciousBtn, current === 'temporary' && styles.suspiciousBtnActive]}
                        onPress={() => setFlightExplanations(p => ({ ...p, [idx]: p[idx] === 'temporary' ? undefined as any : 'temporary' }))}
                      >
                        <Text style={[styles.suspiciousBtnText, current === 'temporary' && styles.suspiciousBtnTextActive]}>
                          Temporary site
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.suspiciousBtn, current === 'refuel' && styles.suspiciousBtnRefuel]}
                        onPress={() => setFlightExplanations(p => ({ ...p, [idx]: p[idx] === 'refuel' ? undefined as any : 'refuel' }))}
                      >
                        <Text style={[styles.suspiciousBtnText, current === 'refuel' && styles.suspiciousBtnTextActive]}>
                          En-route refuel
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* Flygningar som överstiger uthållighet — kategorisera som sim eller hot refuel */}
          {exceedingFlights.length > 0 && (
            <View style={styles.exceedSection}>
              <View style={styles.speedHeader}>
                <Ionicons name="warning-outline" size={14} color={Colors.warning} />
                <Text style={styles.exceedTitle}>Longer than endurance — what is it?</Text>
              </View>
              <Text style={styles.speedSubtitle}>
                Sim sessions are excluded from statistics and map. Hot refuel counts as a normal flight.
              </Text>
              {exceedingFlights.map(({ f, idx }) => {
                const current = flightTypes[idx] ?? 'sim';
                return (
                  <View key={idx}>
                    <View style={styles.exceedRow}>
                      <View style={styles.exceedInfo}>
                        <Text style={styles.exceedRoute}>{f.dep_place || '?'}→{f.arr_place || '?'}</Text>
                        <Text style={styles.exceedMeta}>{f.date} · {f.aircraft_type} · {f.total_time}h</Text>
                      </View>
                      <View style={styles.exceedToggle}>
                        <TouchableOpacity
                          style={[styles.exceedBtn, current === 'sim' && styles.exceedBtnSim]}
                          onPress={() => setFlightTypes((p) => ({ ...p, [idx]: 'sim' }))}
                        >
                          <Text style={[styles.exceedBtnText, current === 'sim' && styles.exceedBtnTextActive]}>Sim</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.exceedBtn, current === 'hot_refuel' && styles.exceedBtnHot]}
                          onPress={() => setFlightTypes((p) => ({ ...p, [idx]: 'hot_refuel' }))}
                        >
                          <Text style={[styles.exceedBtnText, current === 'hot_refuel' && styles.exceedBtnTextActive]}>Hot refuel</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                    {current === 'sim' && (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 6, marginLeft: 12 }}>
                        {(['FFS','FTD','FNPT_II','FNPT_I','BITD','CPT_PPT','CBT'] as const).map((cat) => {
                          const active = (simCategories[idx] ?? 'FFS') === cat;
                          return (
                            <TouchableOpacity
                              key={cat}
                              style={[styles.exceedBtn, active && styles.exceedBtnSim]}
                              onPress={() => setSimCategories((p) => ({ ...p, [idx]: cat }))}
                            >
                              <Text style={[styles.exceedBtnText, active && styles.exceedBtnTextActive]}>
                                {cat.replace(/_/g, '/')}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          {/* Spara-knapp */}
          <TouchableOpacity
            style={[styles.saveBtn, saving && { opacity: 0.6 }]}
            onPress={saveAll}
            disabled={saving}
            activeOpacity={0.8}
          >
            {saving ? (
              <ActivityIndicator color={Colors.textInverse} />
            ) : (
              <>
                <Ionicons name="checkmark-circle" size={20} color={Colors.textInverse} />
                <Text style={styles.saveBtnText}>{t('save_all')} ({result.flights.length})</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.hint}>
            All imported data is saved with source "import" and can be reviewed in the audit log.
          </Text>
        </>
      )}

      {/* Instruktioner */}
      <Text style={styles.section}>How do I export?</Text>
      {[
        { app: 'ForeFlight', steps: 'Logbook → Export → CSV' },
        { app: 'LogTen Pro', steps: 'File → Export → LogTen Pro' },
        { app: 'MyFlightbook', steps: 'Profile → Download → CSV' },
        { app: 'mccPILOTLOG', steps: 'Logbook → Export → CSV/Excel' },
      ].map(({ app, steps }) => (
        <View key={app} style={styles.instructionRow}>
          <Text style={styles.instructionApp}>{app}</Text>
          <Text style={styles.instructionSteps}>{steps}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

function FlightPreviewRow({ flight }: { flight: OcrFlightResult }) {
  const styles = makeStyles();
  const pic = parseFloat(flight.pic ?? '0') || 0;
  const ifr = parseFloat(flight.ifr ?? '0') || 0;
  const night = parseFloat(flight.night ?? '0') || 0;
  const cop = parseFloat(flight.co_pilot ?? '0') || 0;
  return (
    <View style={[styles.previewRow, flight.needs_review && styles.previewRowFlagged]}>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={styles.previewRoute}>{flight.dep_place || '?'}→{flight.arr_place || '?'}</Text>
          <Text style={styles.previewDate}>{flight.date}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Text style={styles.previewChip}>TOT {flight.total_time}h</Text>
          {pic > 0 && <Text style={[styles.previewChip, { color: Colors.success }]}>PIC {flight.pic}h</Text>}
          {cop > 0 && <Text style={[styles.previewChip, { color: Colors.primary }]}>COP {flight.co_pilot}h</Text>}
          {ifr > 0 && <Text style={[styles.previewChip, { color: Colors.primaryLight }]}>IFR {flight.ifr}h</Text>}
          {night > 0 && <Text style={[styles.previewChip, { color: Colors.textMuted }]}>NIGHT {flight.night}h</Text>}
          {flight.flight_rules === 'IFR' && ifr === 0 && (
            <Text style={[styles.previewChip, { color: Colors.warning }]}>IFR-regel</Text>
          )}
        </View>
      </View>
      {flight.needs_review && (
        <Ionicons name="warning" size={12} color={Colors.warning} />
      )}
    </View>
  );
}

function StatPill({ label, value, color }: { label: string; value: string; color?: string }) {
  const styles = makeStyles();
  return (
    <View style={styles.statPill}>
      <Text style={[styles.statValue, color ? { color } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}
