// Global flygplatskarta som helskärmsmodal (utan header, likt Visited airports). Flytande sökruta
// upptill med typ-chips + expander (Properties = banlängd/höjd-range-barer, Access, Closed). Nere till
// höger: Cluster/Region-växel + Map/Satellite. Cluster (default) = geo-kluster som delas vid inzoomning;
// Region = land → region → sektor-drill DIREKT PÅ KARTAN (cyan-gränser + antal, borra ner tills ICAO-
// pins). Infokort i botten vid val. Öppnas från Manage airports + dashboard.
import { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Modal, StyleSheet, Keyboard, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { GlobalAirportMap, type RegionMarker } from './GlobalAirportMap';
import { AirportInfoCard } from './AirportInfoCard';
import { FlightDetailView } from '../app/flight/detail/[id]';
import { getSeedAirports } from '../db/icao';
import { getFavoriteIcaos, setFavorite } from '../db/favorites';
import { RangeBar } from './RangeBar';
import { getAirportLandingCounts, getAirportLastFlight } from '../db/flights';
import { getRunwayIndex } from '../utils/runways';
import { countryNameFull } from '../constants/countryNames';
import { COUNTRY_POPULATION, formatPopulation } from '../constants/countryPopulation';
import { CountryFlag } from './CountryFlag';
import {
  leavesFor, keysNeedRunway, propsActive, matchProps,
  filterCountLabel, EMPTY_PROPS, type MapProps,
} from '../constants/mapFilters';
import { fetchMetarsInBbox, categoryColor, type FlightCat } from '../services/weather';
import { COUNTRY_NAMES } from '../constants/countryNames';
import { useRegulationStandardStore } from '../store/regulationStandardStore';
import { useFlightStore } from '../store/flightStore';
import { presentPaywall } from '../services/purchases';
import { useTourStore } from '../store/tourStore';
import { IncidentNewsOverlay } from './IncidentNewsOverlay';

// Väderfilter: min-kategori (lägsta acceptabla). VFR bäst → LIFR sämst. En flygplats "möter" kravet
// om dess aktuella kategori är minst lika bra som vald tröskel (VFR-tröskel = enbart VFR-fält).
const WX_RANK: Record<string, number> = { VFR: 3, MVFR: 2, IFR: 1, LIFR: 0 };
function meetsWx(cat: FlightCat | null | undefined, min: FlightCat): boolean {
  if (!cat) return false;
  return (WX_RANK[cat] ?? -1) >= (WX_RANK[min] ?? 99);
}
const WX_CATS: FlightCat[] = ['VFR', 'MVFR', 'IFR', 'LIFR'];
const WX_PIN_LIMIT = 180; // väderläget målar ut enskilda pins direkt upp till detta antal, annars klustras det

// Legend-rader: sikt i sm (FAA) eller km (EASA/CAA), molnbas alltid i fot. Samma trösklar som väderfiltret.
function wxLegendRowsFor(sm: boolean): { cat: FlightCat; vis: string; ceil: string }[] {
  const vis = sm
    ? { VFR: 'vis >5 sm', MVFR: 'vis 3–5 sm', IFR: 'vis 1–3 sm', LIFR: 'vis <1 sm' }
    : { VFR: 'vis >8 km', MVFR: 'vis 5–8 km', IFR: 'vis 1.6–5 km', LIFR: 'vis <1.6 km' };
  const ceil = { VFR: 'ceil >3000 ft', MVFR: 'ceil 1000–3000 ft', IFR: 'ceil 500–1000 ft', LIFR: 'ceil <500 ft' };
  return WX_CATS.map((cat) => ({ cat, vis: vis[cat], ceil: ceil[cat] }));
}

// Snabb-typfilter (swipebar rad bredvid Favorites). "Airports L/M" togglar large+medium ihop.
const TYPE_CHIPS: { label: string; keys: string[] }[] = [
  { label: 'Airports L/M', keys: ['t:large', 't:medium'] },
  { label: 'Airfields', keys: ['t:small'] },
  { label: 'Heliports', keys: ['t:heliport'] },
  { label: 'Seaplane', keys: ['t:seaplane'] },
  { label: 'Air Bases', keys: ['r:military'] },
  { label: 'Altiports', keys: ['t:altiport'] },
  { label: 'Balloonports', keys: ['t:balloonport'] },
];
// Access-val (samma nycklar som Access-noden i FILTER_TREE) → snabbknapp uppe vid sök-raden.
const ACCESS_CHIPS: { label: string; key: string }[] = [
  { label: 'Public', key: 'r:public' },
  { label: 'Private', key: 'r:private' },
  { label: 'Joint Use', key: 'r:joint' },
];
import { countryRoot, buildChildren, nodeAirports, nodeRings, DRILL_CAP, type DrillNode } from '../utils/regionDrill';
import { neighborCountries } from '../utils/neighbors';
import { countryBorder } from '../utils/borders';
import { Colors } from '../constants/colors';

type SeedRow = [string, string, string, string, number, number, string?, (number | null)?, string?, string?, string?, string?];
type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
const WORLD: Region = { latitude: 25, longitude: 5, latitudeDelta: 110, longitudeDelta: 110 };
const MAX_LEN = 4000; // slider-tak för banlängd (m)
const NBINS = 48;     // antal staplar i fördelningskurvorna ovanför range-barerna

function fmtVisit(d?: string): string {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${(y || '').slice(-2)}`;
}

// Bounds-region som ramar in en uppsättning flygplatser. Robust mot antimeridian-spann (ex USA:s
// Aleuter ligger på +172° medan resten är negativt → naiv center/delta blir ogiltig och kraschar
// MapKit) och med tak på delta så animateToRegion aldrig får ogiltiga värden.
function boundsRegion(rows: SeedRow[]): Region {
  let minLa = 90, maxLa = -90, minLo = 180, maxLo = -180;
  for (const r of rows) {
    minLa = Math.min(minLa, r[4]); maxLa = Math.max(maxLa, r[4]);
    minLo = Math.min(minLo, r[5]); maxLo = Math.max(maxLo, r[5]);
  }
  let cLon = (minLo + maxLo) / 2, dLon = (maxLo - minLo) * 1.4 + 0.3;
  if (dLon > 180) {
    // Antimeridian (ex Chukotka): veckla ut negativa lon (+360), räkna center/delta där, veckla tillbaka.
    let umin = 360, umax = -360, usum = 0;
    for (const r of rows) { const lu = r[5] < 0 ? r[5] + 360 : r[5]; umin = Math.min(umin, lu); umax = Math.max(umax, lu); usum += lu; }
    cLon = usum / rows.length; if (cLon > 180) cLon -= 360;
    dLon = (umax - umin) * 1.4 + 0.3;
  }
  return {
    latitude: (minLa + maxLa) / 2, longitude: cLon,
    latitudeDelta: Math.min(120, Math.max(0.4, (maxLa - minLa) * 1.4 + 0.3)),
    longitudeDelta: Math.min(160, Math.max(0.4, dLon)),
  };
}

export function GlobalMapModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [seedData, setSeedData] = useState<SeedRow[]>([]);
  const [mapSearch, setMapSearch] = useState('');
  const [focusAirport, setFocusAirport] = useState<SeedRow | null>(null);
  const [newsOpen, setNewsOpen] = useState(false);      // Global map → News-rutan
  const [cameFromNews, setCameFromNews] = useState(false); // kom hit via "Map" i nyhetsrutan → visa "Back to news"
  const [satellite, setSatellite] = useState(true); // satellitläge förvalt
  useEffect(() => { if (visible) setSatellite(true); }, [visible]); // alltid satellit vid öppning
  const [landingCounts, setLandingCounts] = useState<Record<string, number>>({});
  const [lastFlightMap, setLastFlightMap] = useState<Record<string, { id: number; date: string; reg: string }>>({});
  const [detailFlightId, setDetailFlightId] = useState<number | null>(null); // flight-detalj som overlay ovanpå kartan

  // Filter: flervals-löv (Set) + Properties (banlängd/höjd/yta/lit) + closed-läge.
  const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set());
  const [mapProps, setMapProps] = useState<MapProps>(EMPTY_PROPS);
  const [closedMode, setClosedMode] = useState<'hide' | 'include' | 'only'>('hide'); // closed döljs som standard
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [favMode, setFavMode] = useState(false); // Favorites-knappen: visa bara favoriter (filtrerbart)
  // Vilken expander-panel under typ-raden som är öppen (en i taget): Properties / Weather / Access / Closed.
  const [openSection, setOpenSection] = useState<null | 'props' | 'weather' | 'access' | 'closed'>(null);
  const [dataInfoOpen, setDataInfoOpen] = useState(false); // info-ruta: datakälla + uppdaterad + friskrivning
  const propsOpen = openSection === 'props';

  // ── Väderfilter (Global map) ──────────────────────────────────────────────────
  // Flöde: välj min-kategori → land-sökruta → hämta METAR för landet (bbox, kaklat) → måla progressivt
  // bara flygplatser som möter kravet. wxResults fylls tile-för-tile (ICAO → kategori).
  const [wxCat, setWxCat] = useState<FlightCat | 'ALL' | null>(null); // 'ALL' = visa alla stationer, färgkodat
  const [wxCountry, setWxCountry] = useState<string | null>(null); // ISO2
  const [wxResults, setWxResults] = useState<Map<string, FlightCat | null>>(new Map());
  const [wxLoading, setWxLoading] = useState(false);
  const [wxAsOf, setWxAsOf] = useState<number | null>(null);
  const [countryPickerFor, setCountryPickerFor] = useState<FlightCat | 'ALL' | null>(null); // satt → land-sökrutan öppen
  const [countryQuery, setCountryQuery] = useState('');
  const wxRunRef = useRef(0); // avbryter en pågående hämtning om användaren byter land/kategori
  const regStandard = useRegulationStandardStore((s) => s.standard);
  const wxLegendRows = useMemo(() => wxLegendRowsFor(regStandard === 'faa'), [regStandard]);
  // Väderfiltret är en Blades Premium-funktion.
  const isPremium = useFlightStore((s) => s.isPremium);
  const promptWeatherPremium = () => {
    Alert.alert(
      'Blades Premium',
      'Filtering airports by live weather (METAR) is a Blades Premium feature.',
      [{ text: 'Not now', style: 'cancel' }, { text: 'See Premium', onPress: () => router.push('/settings/premium') }],
    );
  };

  // Region-drill på kartan (ersätter land-listan). Tom = världsvy (flaggor).
  const [drillStack, setDrillStack] = useState<DrillNode[]>([]);
  // Kartläge (växlas nere till höger): 'Cluster' (default) = geografiska kluster som delas när man zoomar
  // in; 'Region' = land → region → sektor-drill. clusterMode true = Cluster.
  const [clusterMode, setClusterMode] = useState(true);
  // Kartans nuvarande vy (rapporteras från GlobalAirportMap i klusterläge) → används för center-landrutan
  // och för att BEHÅLLA positionen när kartan monteras om vid filterändring (i st f att hoppa till världen).
  const [mapRegion, setMapRegion] = useState<Region>(WORLD);

  useEffect(() => {
    if (!visible || seedData.length) return;
    getSeedAirports().then((d) => setSeedData(d as SeedRow[]));
    getAirportLandingCounts().then(setLandingCounts);
    getAirportLastFlight().then(setLastFlightMap);
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (visible) getFavoriteIcaos().then((ids) => setFavorites(new Set(ids))); }, [visible]);

  // ── Filtrerat urval (union av aktiva löv, AND Properties) ────────────────────
  const typedSeed = useMemo(() => {
    const leaves = leavesFor(activeKeys);
    // Runway-props kräver banindex; elevation (alt, r[7]) ligger på seed-raden → separat filter.
    const runwayActive = mapProps.minLenM != null || mapProps.maxLenM != null || mapProps.surface != null || mapProps.lit;
    const altActive = mapProps.minAltFt != null || mapProps.maxAltFt != null;
    const pActive = runwayActive || altActive;
    // Favorites-läge: begränsa till favoriter först (går att filtrera vidare bland dem).
    const favBase = favMode ? seedData.filter((r) => favorites.has(r[0])) : seedData;
    // Closed-läge: standard (hide) döljer closed ur originalpresentationen; 'only' visar bara closed;
    // 'include' behåller alla. Appliceras före kategori-/Properties-filtren.
    const base = closedMode === 'include' ? favBase
      : closedMode === 'only' ? favBase.filter((r) => r[8] === 'closed')
      : favBase.filter((r) => r[8] !== 'closed');
    let result: SeedRow[];
    if (!leaves.length && !pActive) {
      result = base;
    } else {
      const idx = (runwayActive || keysNeedRunway(activeKeys)) ? getRunwayIndex() : null;
      result = base.filter((r) => {
        const rwy = idx?.get(r[0]);
        if (leaves.length && !leaves.some((l) => l.match(r, rwy))) return false;
        if (runwayActive && !matchProps(rwy, mapProps)) return false;
        if (altActive) {
          const a = r[7];
          if (a == null || (mapProps.minAltFt != null && a < mapProps.minAltFt) || (mapProps.maxAltFt != null && a > mapProps.maxAltFt)) return false;
        }
        return true;
      });
    }
    // Väderfilter sist: bara valt land. 'ALL' → alla fält med en rapporterad kategori (färgkodas på kartan);
    // annars bara de som möter min-kategorin. wxResults fylls progressivt.
    if (wxCat && wxCountry) {
      result = wxCat === 'ALL'
        ? result.filter((r) => r[2] === wxCountry && wxResults.get(r[0]) != null)
        : result.filter((r) => r[2] === wxCountry && meetsWx(wxResults.get(r[0]), wxCat));
    }
    return result;
  }, [seedData, activeKeys, mapProps, closedMode, favMode, favorites, wxCat, wxCountry, wxResults]);

  // Runway-längdintervall för nuvarande urval (kategori/closed/fav — EJ längdfiltret självt) → sätter
  // slidrarnas gränser + default (kortaste/längsta bana som finns). Beräknas bara när Properties är öppet.
  const lenRange = useMemo(() => {
    if (!propsOpen) return { min: 0, max: MAX_LEN };
    const leaves = leavesFor(activeKeys);
    const favBase = favMode ? seedData.filter((r) => favorites.has(r[0])) : seedData;
    const base = closedMode === 'include' ? favBase : closedMode === 'only' ? favBase.filter((r) => r[8] === 'closed') : favBase.filter((r) => r[8] !== 'closed');
    const idx = getRunwayIndex();
    let mn = Infinity, mx = 0;
    for (const r of base) {
      const rwy = idx.get(r[0]);
      if (leaves.length && !leaves.some((l) => l.match(r, rwy))) continue;
      if (!rwy || !rwy.hasData || rwy.maxLenM <= 0) continue;
      if (rwy.maxLenM < mn) mn = rwy.maxLenM;
      if (rwy.maxLenM > mx) mx = rwy.maxLenM;
    }
    if (mn === Infinity || mx <= 0) return { min: 0, max: MAX_LEN };
    const lo = Math.floor(mn / 50) * 50;
    return { min: lo, max: Math.max(Math.ceil(mx / 50) * 50, lo + 50) };
  }, [propsOpen, seedData, activeKeys, closedMode, favMode, favorites]); // eslint-disable-line react-hooks/exhaustive-deps

  // Elevation-intervall (alt, ft) för nuvarande urval → sätter elevation-slidrarnas gränser + default.
  const altRange = useMemo(() => {
    if (!propsOpen) return { min: 0, max: 1000 };
    const leaves = leavesFor(activeKeys);
    const favBase = favMode ? seedData.filter((r) => favorites.has(r[0])) : seedData;
    const base = closedMode === 'include' ? favBase : closedMode === 'only' ? favBase.filter((r) => r[8] === 'closed') : favBase.filter((r) => r[8] !== 'closed');
    let mn = Infinity, mx = -Infinity;
    for (const r of base) {
      if (leaves.length && !leaves.some((l) => l.match(r, undefined))) continue;
      const a = r[7];
      if (a == null) continue;
      if (a < mn) mn = a; if (a > mx) mx = a;
    }
    if (mn === Infinity) return { min: 0, max: 1000 };
    const lo = Math.floor(mn / 50) * 50;
    return { min: lo, max: Math.max(Math.ceil(mx / 50) * 50, lo + 50) };
  }, [propsOpen, seedData, activeKeys, closedMode, favMode, favorites]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fördelningskurvor: histogram (NBINS staplar) över HELA intervallet, samma urval/filter som
  // *Range ovan → visas som mjuk kurva ovanför respektive range-bar. Beräknas bara när Properties öppet.
  const lenDist = useMemo<number[] | undefined>(() => {
    if (!propsOpen) return undefined;
    const { min, max } = lenRange; const span = Math.max(1, max - min);
    const leaves = leavesFor(activeKeys);
    const favBase = favMode ? seedData.filter((r) => favorites.has(r[0])) : seedData;
    const base = closedMode === 'include' ? favBase : closedMode === 'only' ? favBase.filter((r) => r[8] === 'closed') : favBase.filter((r) => r[8] !== 'closed');
    const idx = getRunwayIndex();
    const bins = new Array(NBINS).fill(0);
    for (const r of base) {
      const rwy = idx.get(r[0]);
      if (leaves.length && !leaves.some((l) => l.match(r, rwy))) continue;
      if (!rwy || !rwy.hasData || rwy.maxLenM <= 0) continue; // saknar banlängd → räknas ej
      if (r[7] == null) continue;                              // saknar höjddata → räknas ej (samma urval i båda kurvorna)
      let b = Math.floor(((rwy.maxLenM - min) / span) * NBINS);
      if (b < 0) b = 0; else if (b >= NBINS) b = NBINS - 1;
      bins[b]++;
    }
    return bins;
  }, [propsOpen, lenRange, seedData, activeKeys, closedMode, favMode, favorites]); // eslint-disable-line react-hooks/exhaustive-deps

  const altDist = useMemo<number[] | undefined>(() => {
    if (!propsOpen) return undefined;
    const { min, max } = altRange; const span = Math.max(1, max - min);
    const leaves = leavesFor(activeKeys);
    const favBase = favMode ? seedData.filter((r) => favorites.has(r[0])) : seedData;
    const base = closedMode === 'include' ? favBase : closedMode === 'only' ? favBase.filter((r) => r[8] === 'closed') : favBase.filter((r) => r[8] !== 'closed');
    const idx = getRunwayIndex();
    const bins = new Array(NBINS).fill(0);
    for (const r of base) {
      const rwy = idx.get(r[0]);
      if (leaves.length && !leaves.some((l) => l.match(r, rwy))) continue;
      const a = r[7];
      if (a == null) continue;                                 // saknar höjddata → räknas ej
      if (!rwy || !rwy.hasData || rwy.maxLenM <= 0) continue;   // saknar banlängd → räknas ej (samma urval som runway-kurvan)
      let b = Math.floor(((a - min) / span) * NBINS);
      if (b < 0) b = 0; else if (b >= NBINS) b = NBINS - 1;
      bins[b]++;
    }
    return bins;
  }, [propsOpen, altRange, seedData, activeKeys, closedMode, favMode, favorites]); // eslint-disable-line react-hooks/exhaustive-deps

  // Kart-nyckel = filtersignaturen. Vid FILTERändring (på alla zoomnivåer) byter nyckeln → kartan
  // byggs om från grunden i stället för att diffa markörer live (mass-markör-diff = native-krasch).
  // NAVIGERING (drill/back) ändrar inte nyckeln → ingen remount → frameRegion-effekten sköter mjuk
  // zoom. Efter remount monteras kartan på currentNode via initialRegion={frameRegion} (ingen världshopp).
  const mapKey = useMemo(
    () => (clusterMode ? 'C' : 'R') + '|' + [...activeKeys].sort().join(',') + `|${mapProps.minLenM}_${mapProps.maxLenM}_${mapProps.surface}_${mapProps.lit}|${closedMode}` + (favMode ? `|F${favorites.size}` : '') + (wxCat && wxCountry ? `|W${wxCat}_${wxCountry}_${wxResults.size}` : ''),
    [clusterMode, activeKeys, mapProps, closedMode, favMode, favorites, wxCat, wxCountry, wxResults],
  );

  // ── Aktuell drill-nod → flygplatser härleds LIVE ur typedSeed (stanna kvar vid filterändring) ──
  const currentNode = drillStack.length ? drillStack[drillStack.length - 1] : null;
  const currentAirports = useMemo(() => (currentNode ? nodeAirports(currentNode, typedSeed) : []), [currentNode, typedSeed]);
  const childrenData = useMemo(
    () => (currentNode && currentAirports.length > DRILL_CAP ? buildChildren(currentNode, currentAirports) : []),
    [currentNode, currentAirports],
  );
  const isBranch = childrenData.length > 1; // >1 delnod → gren (region-markörer); annars löv (pins)
  // Väderläge: måla ut de matchande flygplatserna DIREKT som enskilda pins (ingen klustring) så länge de
  // ryms under kart-taket (WX_PIN_LIMIT). Över taket faller vi tillbaka på klustring för prestanda.
  const wxDirect = !!(wxCat && wxCountry) && typedSeed.length > 0 && typedSeed.length <= WX_PIN_LIMIT;
  // Favorites i världsvyn → visa favoriterna som pins direkt (inte landsflaggor). Annars normal drill.
  const pins = wxDirect ? typedSeed
    : favMode && !currentNode ? typedSeed
    : currentNode && !isBranch ? currentAirports
    : undefined;
  const regionMarkers = isBranch
    ? childrenData.map((c) => ({ key: c.node.key, label: c.node.label, count: c.count, lat: c.lat, lon: c.lon }))
    : undefined;
  // Gränser: gren → varje delregions gräns som egen KLICKBAR yta (nyckel per shape); löv → den valda
  // nodens egen kontur runt pins (ej klickbar — man är redan här).
  const regionShapes = isBranch ? childrenData.map((c) => ({ key: c.node.key, rings: c.rings })) : undefined;
  const hulls = currentNode && !isBranch ? nodeRings(currentNode, currentAirports) : undefined;
  // Ingen träff på platsen med aktuellt filter → varningsruta (försvinner vid Back / bredare filter).
  const noMatches = !!currentNode && !focusAirport && currentAirports.length === 0;
  // Rama in noden bara vid NAVIGERING (dep: currentNode) — INTE vid filterändring → kartan står still.
  const frameRegion = useMemo<Region | undefined>(() => {
    if (!currentNode) return WORLD;
    const rows = nodeAirports(currentNode, typedSeed);
    return rows.length ? boundsRegion(rows) : undefined;
  }, [currentNode]); // eslint-disable-line react-hooks/exhaustive-deps

  // Center-landruta (klusterläge): vilket land ligger kartans MITT över? Uppdateras när man panorerar/
  // zoomar och göms när man valt en flygplats. Visas bara när man zoomat in förbi flagg-nivån (delta ≤ 16
  // = countryMax) → krockar inte med sökrutan som ligger kvar på flagg-nivån.
  // Metod: landet för NÄRMASTE flygplats till kartans mitt (robust även vid kuster, där landsgräns-
  // polygonerna är för grova för punkt-i-polygon). null om ingen flygplats inom ~3° (öppet hav).
  const atFlagLevel = mapRegion.latitudeDelta > 16;
  const centerCountry = useMemo(() => {
    if (!clusterMode || focusAirport || atFlagLevel) return null;
    const lat = mapRegion.latitude, lon = mapRegion.longitude, R = 3; // sökruta ±3° (~330 km)
    let bestCc: string | null = null, bestD = Infinity;
    for (const r of seedData) {
      const dLa = r[4] - lat, dLo = r[5] - lon;
      if (dLa < -R || dLa > R || dLo < -R || dLo > R) continue;
      const d = dLa * dLa + dLo * dLo;
      if (d < bestD) { bestD = d; bestCc = r[2]; }
    }
    return bestCc;
  }, [clusterMode, focusAirport, atFlagLevel, mapRegion.latitude, mapRegion.longitude, seedData]);

  // Landruta. Nedborrad i en region → visa regionens namn + antal (annars landets totala). I klusterläge
  // = center-landet (ingen drill).
  const country = clusterMode ? centerCountry : (drillStack.length ? drillStack[0].cc : null);
  const countryAirportCount = useMemo(
    () => (country ? typedSeed.filter((r) => r[2] === country).length : 0),
    [country, typedSeed],
  );
  const inRegion = drillStack.length >= 2;
  const regionLabel = inRegion ? drillStack[drillStack.length - 1].label : null;
  const boxAirportCount = inRegion ? currentAirports.length : countryAirportCount;

  // ── Klickbara grann-gränser: grannLÄNDER på landsnivå, region-SYSKON när man borrat i en region ──
  // Landets alla region-noder — behövs bara för region-syskon (regionnivå), så beräkna ej på landsnivå
  // (där bygger childrenData redan samma sak → undvik dubbel buildChildren).
  const atRegion = drillStack.length >= 2;
  const countryChildren = useMemo(() => {
    if (!country || !atRegion) return [] as ReturnType<typeof buildChildren>;
    const cAir = typedSeed.filter((r) => r[2] === country);
    return cAir.length > DRILL_CAP ? buildChildren(countryRoot(country, countryNameFull(country)), cAir) : [];
  }, [country, typedSeed, atRegion]);

  const neighbors = useMemo(() => {
    if (!currentNode || focusAirport) return { markers: undefined as RegionMarker[] | undefined, shapes: undefined as { key: string; rings: { latitude: number; longitude: number }[][] }[] | undefined };
    let entries: { key: string; label: string; count: number; lat: number; lon: number; rings: { latitude: number; longitude: number }[][] }[];
    if (currentNode.kind === 'country') {
      entries = neighborCountries(seedData, currentNode.cc, 8).map((n) => ({ key: `nbc:${n.cc}`, label: n.label, count: n.count, lat: n.lat, lon: n.lon, rings: countryBorder(n.cc) ?? [n.hull] }));
    } else {
      const regKey = drillStack.length >= 2 ? drillStack[1].key : null;
      const cur = countryChildren.find((c) => c.node.key === regKey);
      const sibs = countryChildren.filter((c) => c.node.key !== regKey);
      const ranked = cur
        ? [...sibs].sort((a, b) => ((a.lat - cur.lat) ** 2 + (a.lon - cur.lon) ** 2) - ((b.lat - cur.lat) ** 2 + (b.lon - cur.lon) ** 2))
        : sibs;
      entries = ranked.slice(0, 8).map((c) => ({ key: c.node.key, label: c.node.label, count: c.count, lat: c.lat, lon: c.lon, rings: c.rings }));
    }
    return {
      markers: entries.map(({ key, label, count, lat, lon }) => ({ key, label, count, lat, lon })),
      shapes: entries.map((e) => ({ key: e.key, rings: e.rings })).filter((s) => s.rings.length > 0),
    };
  }, [currentNode, focusAirport, seedData, countryChildren, drillStack]);
  const neighborMarkers = neighbors.markers;
  const neighborShapes = neighbors.shapes;

  const searchResults = useMemo(() => {
    const q = mapSearch.trim().toUpperCase();
    if (q.length < 2) return [];
    // Prioritet: exakt ICAO → exakt IATA → ICAO-prefix → namn/ort innehåller.
    const exact: SeedRow[] = [], iataM: SeedRow[] = [], pre: SeedRow[] = [], nameM: SeedRow[] = [];
    for (const r of seedData) {
      const icao = r[0].toUpperCase();
      if (icao === q) exact.push(r);
      else if ((r[6] || '').toUpperCase() === q) { if (iataM.length < 10) iataM.push(r); }
      else if (icao.startsWith(q)) { if (pre.length < 30) pre.push(r); }
      else if (r[1].toUpperCase().includes(q) || (r[9] || '').toUpperCase().includes(q)) { if (nameM.length < 30) nameM.push(r); }
    }
    return [...exact, ...iataM, ...pre, ...nameM].slice(0, 20);
  }, [mapSearch, seedData]);

  const closeMap = () => {
    setDrillStack([]); setFocusAirport(null); setMapSearch(''); setMapRegion(WORLD);
    setActiveKeys(new Set()); setMapProps(EMPTY_PROPS); setSatellite(false); setClosedMode('hide'); setFavMode(false);
    clearWeather();
    onClose();
  };
  // Favorites-knapp: nollställ filter + drill, zooma ut till världen, visa bara favoriter (går att
  // filtrera vidare bland dem). Tryck igen → av. (Favoriterna sparas i DB och överlever om-seed.)
  const toggleFavMode = () => {
    if (favMode) { setFavMode(false); return; }
    setActiveKeys(new Set()); setMapProps(EMPTY_PROPS); setClosedMode('hide');
    setDrillStack([]); setFocusAirport(null); setMapSearch('');
    setFavMode(true);
  };
  const toggleFavorite = (icao: string) => setFavorites((prev) => {
    const n = new Set(prev); const fav = !n.has(icao);
    if (fav) n.add(icao); else n.delete(icao);
    setFavorite(icao, fav);
    return n;
  });
  const focusByIcao = (icao: string) => {
    const r = seedData.find((x) => x[0] === icao);
    if (r) setFocusAirport(r);
  };
  // News: när vald flygplats stängs (X / auto-avmarkering) slutar "Back to news" gälla.
  useEffect(() => { if (!focusAirport) setCameFromNews(false); }, [focusAirport]);

  // Blades introduction: rundturen ber kartan söka + zooma till en ICAO (demo: KJFK) vid öppning.
  const tourSearchIcao = useTourStore((s) => s.mapSearchIcao);
  useEffect(() => {
    if (!visible || !tourSearchIcao || seedData.length === 0) return;
    const t = setTimeout(() => { setMapSearch(tourSearchIcao); focusByIcao(tourSearchIcao); }, 900);
    return () => clearTimeout(t);
  }, [visible, tourSearchIcao, seedData.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // Land: exakt 1 (filtrerad) träff → direkt till flygplatsen; annars → region-drill-rot.
  const handleSelectCountry = (cc: string) => {
    const inCountry = typedSeed.filter((r) => r[2] === cc);
    if (!inCountry.length) return;
    if (inCountry.length === 1) { setFocusAirport(inCountry[0]); return; }
    setDrillStack([countryRoot(cc, countryNameFull(cc))]);
  };
  const handleSelectRegion = (key: string) => {
    const child = childrenData.find((c) => c.node.key === key);
    if (child) setDrillStack((s) => [...s, child.node]);
  };
  // Grann-gräns: land (nbc:XX) → öppna landet; annars region-syskon-nyckel → hoppa till den regionen.
  const handleSelectNeighbor = (key: string) => {
    if (key.startsWith('nbc:')) { handleSelectCountry(key.slice(4)); return; }
    const sib = countryChildren.find((c) => c.node.key === key);
    if (sib && country) setDrillStack([countryRoot(country, countryNameFull(country)), sib.node]);
  };
  const goBack = () => {
    if (focusAirport) {
      const toNews = cameFromNews; // kom hit via nyhetsrutan → tillbaka dit med de andra platserna
      setFocusAirport(null);
      if (toNews) { setCameFromNews(false); setNewsOpen(true); }
      return;
    }
    setDrillStack((s) => s.slice(0, -1));
  };
  // Cluster/Region-växel: byt läge + nollställ navigering (drill/fokus/sök/vy) så det nya läget börjar rent.
  const setMode = (cluster: boolean) => {
    if (cluster === clusterMode) return;
    setClusterMode(cluster);
    setDrillStack([]); setFocusAirport(null); setMapSearch(''); setMapRegion(WORLD);
  };

  // ── Filter-hjälpare ──────────────────────────────────────────────────────────
  const toggleKey = (k: string) => setActiveKeys((prev) => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n; });
  // Togglar en typ-chip (kan omfatta flera nycklar, t.ex. Airports L/M = large+medium): alla på → av, annars på.
  const toggleKeys = (keys: string[]) => setActiveKeys((prev) => {
    const n = new Set(prev);
    const allOn = keys.every((k) => n.has(k));
    keys.forEach((k) => (allOn ? n.delete(k) : n.add(k)));
    return n;
  });
  // Kombinerade min–max-setters för range-barerna (null vid ytterkant = ingen gräns → filter av).
  const setLenRange = (lo: number, hi: number) => setMapProps((p) => ({ ...p, minLenM: lo <= lenRange.min ? null : lo, maxLenM: hi >= lenRange.max ? null : hi }));
  const setAltRange = (lo: number, hi: number) => setMapProps((p) => ({ ...p, minAltFt: lo <= altRange.min ? null : lo, maxAltFt: hi >= altRange.max ? null : hi }));
  const toggleSurface = (sfc: 'asphalt' | 'grass') => setMapProps((p) => ({ ...p, surface: p.surface === sfc ? null : sfc }));
  const toggleSection = (s: 'props' | 'weather' | 'access' | 'closed') => setOpenSection((cur) => (cur === s ? null : s));
  const accessOn = ACCESS_CHIPS.some((c) => activeKeys.has(c.key));

  // ── Väderfilter-hjälpare ──────────────────────────────────────────────────────
  // Länder som finns i seed-datan → engelska namn, alfabetiskt. Underlag för land-sökrutan.
  const seedCountries = useMemo(() => {
    const set = new Set<string>();
    for (const r of seedData) { if (r[2]) set.add(r[2]); }
    return [...set].map((cc) => ({ cc, name: COUNTRY_NAMES[cc] ?? cc })).sort((a, b) => a.name.localeCompare(b.name));
  }, [seedData]);
  const countryMatches = useMemo(() => {
    const q = countryQuery.trim().toLowerCase();
    if (!q) return seedCountries.slice(0, 60);
    return seedCountries.filter((c) => c.name.toLowerCase().includes(q) || c.cc.toLowerCase() === q).slice(0, 60);
  }, [seedCountries, countryQuery]);

  const clearWeather = () => {
    wxRunRef.current++; // avbryt ev. pågående hämtning
    setWxCat(null); setWxCountry(null); setWxResults(new Map()); setWxLoading(false); setWxAsOf(null);
    setCountryPickerFor(null); setCountryQuery('');
  };

  // Hämtar landets METAR (bbox kaklat i 2×2 → progressiv utmålning) och fyller wxResults tile-för-tile.
  const runWeatherSearch = async (cat: FlightCat | 'ALL', cc: string) => {
    const inC = seedData.filter((r) => r[2] === cc && Number.isFinite(r[4]) && Number.isFinite(r[5]) && !(r[4] === 0 && r[5] === 0));
    const token = ++wxRunRef.current;
    setCountryPickerFor(null); setCountryQuery(''); setOpenSection(null);
    setWxCat(cat); setWxCountry(cc); setWxResults(new Map()); setWxAsOf(null);
    setDrillStack([]); setFocusAirport(null); setFavMode(false); // väderläget står på egna ben
    if (!inC.length) { setWxLoading(false); return; }
    let minLa = 90, maxLa = -90, minLo = 180, maxLo = -180;
    for (const r of inC) { const la = r[4], lo = r[5]; if (la < minLa) minLa = la; if (la > maxLa) maxLa = la; if (lo < minLo) minLo = lo; if (lo > maxLo) maxLo = lo; }
    // Zooma till landet (clusterMode monterar på mapRegion). Klampa deltan till GILTIGA värden —
    // annars kan ett land som spänner nära hela jordklotet (USA: Aleuterna→Guam ≈ 340° longitud) ge
    // longitudeDelta > 360 → ogiltig Region → native-kartan kraschar.
    setMapRegion({
      latitude: (minLa + maxLa) / 2, longitude: (minLo + maxLo) / 2,
      latitudeDelta: Math.min(Math.max((maxLa - minLa) * 1.3, 0.5), 140),
      longitudeDelta: Math.min(Math.max((maxLo - minLo) * 1.3, 0.5), 300),
    });
    setWxLoading(true);
    const seedIcaos = new Set(inC.map((r) => r[0])); // bara landets egna fält (bbox kan spilla in i grannländer)

    // Rutnät över landets EGNA flygplatser: bara populerade celler hämtas, var och en begränsad till
    // CELL° → varje bbox-anrop ger ett litet, regionalt svar. Stora länder (USA sträcker sig ~340° i
    // longitud via Aleuterna/Guam/Samoa) blev annars ett nära-globalt anrop → enormt svar → krasch.
    const CELL = 12;               // grader per cell
    const MAX_CELLS = 60;          // säkerhetstak på antal anrop
    const MAX_STATIONS = 800;      // säkerhetstak på antal stationer (hindrar minnesskena)
    const cells = new Map<string, { la0: number; lo0: number }>();
    for (const r of inC) {
      const la0 = Math.floor(r[4] / CELL) * CELL, lo0 = Math.floor(r[5] / CELL) * CELL;
      const k = `${la0},${lo0}`;
      if (!cells.has(k)) cells.set(k, { la0, lo0 });
    }
    const cellList = [...cells.values()].slice(0, MAX_CELLS);

    const acc = new Map<string, FlightCat | null>();
    let sinceUpdate = 0;
    for (let i = 0; i < cellList.length; i++) {
      if (wxRunRef.current !== token) return; // användaren bytte land/kategori → avbryt tyst
      if (acc.size >= MAX_STATIONS) break;
      const c = cellList[i];
      const stations = await fetchMetarsInBbox(c.la0, c.lo0, c.la0 + CELL, c.lo0 + CELL);
      if (wxRunRef.current !== token) return;
      for (const s of stations) {
        if (seedIcaos.has(s.icao)) acc.set(s.icao, s.category);
        if (acc.size >= MAX_STATIONS) break;
      }
      // Batcha uppdateringar (var 4:e cell + sista) → färre remounts/omklustringar.
      if (++sinceUpdate >= 4 || i === cellList.length - 1) { setWxResults(new Map(acc)); setWxAsOf(Date.now()); sinceUpdate = 0; }
    }
    if (wxRunRef.current === token) setWxLoading(false);
  };

  const showMapCtrls = !focusAirport;
  const hideCountries = !!focusAirport || mapSearch.trim().length >= 2 || drillStack.length > 0;
  const showBack = !!focusAirport || drillStack.length > 0;
  const wxLegendShown = !!wxCat && !focusAirport; // väder-legend visas i väderläget (ej vid enskilt flygplatsfokus)

  // Landskort (flagga + namn + antal) — återanvänds både uppe (vid fokus) och nere till vänster.
  const countryCardEl = country ? (
    <View style={styles.countryBox}>
      <CountryFlag code={country} height={42} radius={3} />
      <View style={styles.countryInfo}>
        <Text style={styles.countryName} numberOfLines={1}>{countryNameFull(country)}</Text>
        {inRegion && <Text style={styles.countryRegion} numberOfLines={2}>{regionLabel}</Text>}
        <Text style={styles.countryStat} numberOfLines={1}>
          {String(boxAirportCount).replace(/\B(?=(\d{3})+(?!\d))/g, ',')} {filterCountLabel(activeKeys)}
        </Text>
        {!inRegion && <Text style={styles.countryStat} numberOfLines={1}>{formatPopulation(COUNTRY_POPULATION[country])} people</Text>}
      </View>
    </View>
  ) : null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={closeMap}>
      <View style={{ flex: 1, backgroundColor: Colors.background }}>
        {visible && (
          <GlobalAirportMap
            key={mapKey}
            airports={typedSeed}
            // Klusterläge: montera på SENAST kända vyn (mapRegion) → filterändring (mapKey-remount) hoppar
            // inte till världen. frameRegion lämnas otilldelad (annars animerar den tillbaka till WORLD).
            initialRegion={clusterMode ? mapRegion : frameRegion}
            // Väderläge (under taket) → tvinga enskilda pins, ingen klustring.
            mode={wxDirect ? 'pins' : clusterMode ? 'auto' : 'country'}
            clustering={wxDirect ? false : clusterMode}
            clusterKey={mapKey}
            onRegionChange={(r) => {
              if (clusterMode) setMapRegion(r);
              // Zooma ut tillräckligt → avmarkera flygplatsen automatiskt (flygplatskortet försvinner).
              if (focusAirport && r.latitudeDelta > 2.5) setFocusAirport(null);
            }}
            onSelectCountry={clusterMode ? undefined : handleSelectCountry}
            onSelectAirport={focusByIcao}
            onSelectRegion={handleSelectRegion}
            focus={focusAirport}
            hideCountries={hideCountries}
            mapType={satellite ? 'hybridFlyover' : 'standard'}
            pins={pins}
            pinCategory={wxCat && wxCountry ? wxResults : undefined}
            regionMarkers={regionMarkers}
            hulls={hulls}
            regionShapes={regionShapes}
            neighborMarkers={neighborMarkers}
            neighborShapes={neighborShapes}
            onSelectNeighbor={handleSelectNeighbor}
            frameRegion={clusterMode ? undefined : frameRegion}
          />
        )}

        {/* Ingen träff på platsen med aktuellt filter → centrerad varning */}
        {noMatches && !wxCat && (
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <View style={styles.noMatchBox}>
              <Ionicons name="funnel-outline" size={20} color={Colors.textSecondary} />
              <Text style={styles.noMatchTxt}>No matches according to{'\n'}filters / properties</Text>
            </View>
          </View>
        )}

        {/* Väderläge: laddning respektive "inga fält möter kravet" (progressiv utmålning fyller på). */}
        {wxCat && wxCountry && (wxLoading || typedSeed.length === 0) && (
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <View style={styles.noMatchBox}>
              <Ionicons name={wxLoading ? 'cloud-download-outline' : 'partly-sunny-outline'} size={20} color={Colors.textSecondary} />
              <Text style={styles.noMatchTxt}>
                {wxLoading
                  ? `Fetching weather for\n${COUNTRY_NAMES[wxCountry] ?? wxCountry}…`
                  : `No airport in ${COUNTRY_NAMES[wxCountry] ?? wxCountry}\ncurrently reports ≥ ${wxCat}`}
              </Text>
            </View>
          </View>
        )}

        {/* Land-sökruta: öppnas efter att en väderkategori valts. Progressiv (engelska) landsträffar. */}
        <Modal visible={countryPickerFor != null} transparent animationType="fade" onRequestClose={() => setCountryPickerFor(null)}>
          <TouchableOpacity activeOpacity={1} onPress={() => setCountryPickerFor(null)}
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', paddingHorizontal: 24 }}>
            <TouchableOpacity activeOpacity={1} onPress={() => {}} style={styles.cpSheet}>
              <View style={styles.cpHeader}>
                {countryPickerFor === 'ALL'
                  ? <View style={{ flexDirection: 'row', gap: 3 }}>{WX_CATS.map((cat) => <View key={cat} style={[styles.wxDot, { backgroundColor: categoryColor(cat) }]} />)}</View>
                  : countryPickerFor ? <View style={[styles.wxDot, { backgroundColor: categoryColor(countryPickerFor) }]} /> : null}
                <Text style={styles.cpTitle}>{countryPickerFor === 'ALL' ? 'All stations · choose country' : countryPickerFor ? `≥ ${countryPickerFor} · choose country` : 'Choose country'}</Text>
              </View>
              <TextInput
                value={countryQuery}
                onChangeText={setCountryQuery}
                placeholder="Type a country name…"
                placeholderTextColor={Colors.textMuted}
                autoFocus
                autoCorrect={false}
                style={styles.cpInput}
              />
              <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 320 }}>
                {countryMatches.length === 0 && (
                  <Text style={styles.cpEmpty}>No matching country</Text>
                )}
                {countryMatches.map((c) => (
                  <TouchableOpacity key={c.cc} activeOpacity={0.7} style={styles.cpRow}
                    onPress={() => { Keyboard.dismiss(); if (countryPickerFor) runWeatherSearch(countryPickerFor, c.cc); }}>
                    <CountryFlag code={c.cc} height={14} />
                    <Text style={styles.cpName} numberOfLines={1}>{c.name}</Text>
                    <Text style={styles.cpCc}>{c.cc}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>

        {/* Stäng — uppe till höger */}
        <TouchableOpacity onPress={closeMap} activeOpacity={0.8}
          style={{ position: 'absolute', top: insets.top + 12, right: 12, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(15,22,38,0.9)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="close" size={22} color="#fff" />
        </TouchableOpacity>

        {/* Tillbaka — vid flygplatsfokus uppe till vänster (som förr); annars (utan fokus) nere till vänster
            så filtermodulen kan ligga kvar upptill utan krock. */}
        {showBack && (
          <TouchableOpacity onPress={goBack} activeOpacity={0.85}
            style={[{ position: 'absolute', zIndex: 25, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(15,22,38,0.92)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: Colors.primary + '66' },
              focusAirport ? { top: insets.top + 12, left: 12 } : { bottom: 24, left: 12 }]}>
            <Ionicons name="chevron-back" size={16} color={Colors.primary} />
            <Text style={{ color: Colors.primary, fontSize: 13, fontWeight: '700' }}>Back</Text>
          </TouchableOpacity>
        )}

        {/* Landruta vid flygplatsfokus: uppe (mellan Back och X, som förr). */}
        {focusAirport && countryCardEl && (
          <View pointerEvents="none" style={{ position: 'absolute', zIndex: 24, top: insets.top + 12, left: 96, right: 56, alignItems: 'center' }}>
            {countryCardEl}
          </View>
        )}

        {/* Utan fokus: nere till vänster. I väderläget döljs landskortet (onödigt) och bara legenden visas. */}
        {!focusAirport && ((countryCardEl && !wxCat) || wxLegendShown) && (
          <View pointerEvents="none" style={{ position: 'absolute', zIndex: 24, bottom: 24 + (showBack ? 42 : 0), left: 12, alignItems: 'flex-start', gap: 8 }}>
            {!wxCat && countryCardEl}
            {wxLegendShown && (
              <View style={styles.wxLegendCard}>
                <Text style={styles.wxLegendTitle}>Flight categories</Text>
                {wxLegendRows.map((row) => (
                  <View key={row.cat} style={styles.wxLegendRow}>
                    <View style={[styles.wxLegendDot, { backgroundColor: categoryColor(row.cat) }]} />
                    <Text style={styles.wxLegendCat}>{row.cat}</Text>
                    <Text style={styles.wxLegendTxt} numberOfLines={1}>{row.vis} · {row.ceil}</Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        )}

        {/* Filtermodul (sök + typ-chips + Properties) — ligger kvar upptill så länge ingen flygplats är
            vald (alla zoomnivåer/drill-lägen). Landrutan flyttas då nere till vänster (krockar ej). */}
        {!focusAirport && (
          <View style={{ position: 'absolute', top: insets.top + 12, left: 12, right: 12, pointerEvents: 'box-none' }}>
            <View style={styles.searchRow}>
              <Ionicons name="search" size={16} color={Colors.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search ICAO or name"
                placeholderTextColor={Colors.textMuted}
                value={mapSearch}
                onChangeText={setMapSearch}
                autoCapitalize="characters"
                autoCorrect={false}
              />
              {mapSearch.length > 0 && (
                <TouchableOpacity onPress={() => { setMapSearch(''); Keyboard.dismiss(); }}>
                  <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
                </TouchableOpacity>
              )}
            </View>
            {/* Swipebar filterrad + expander. Favorites ligger FÖRST i scrollen (scrollas bort med
                resten, inget statiskt). Full bredd (kompassrosen borttagen) → mer plats åt Closed-knappen. */}
            {searchResults.length === 0 && (
              <View style={{ marginTop: 8 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
                  contentContainerStyle={{ gap: 6, paddingRight: 4, alignItems: 'center' }}>
                  <TouchableOpacity onPress={toggleFavMode} activeOpacity={0.85} style={[styles.favBtn, favMode && styles.favBtnOn]}>
                    <Ionicons name={favMode ? 'star' : 'star-outline'} size={10} color={favMode ? '#062024' : Colors.gold} />
                    <Text style={[styles.favBtnTxt, favMode && { color: '#062024' }]}>Favorites{favorites.size ? ` · ${favorites.size}` : ''}</Text>
                  </TouchableOpacity>
                  {TYPE_CHIPS.map((chip) => {
                    const on = chip.keys.every((k) => activeKeys.has(k));
                    return (
                      <TouchableOpacity key={chip.label} onPress={() => toggleKeys(chip.keys)} activeOpacity={0.85}
                        style={[styles.typeChip, on && styles.typeChipOn]}>
                        <Text style={[styles.typeChipTxt, on && styles.typeChipTxtOn]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{chip.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>

                {/* Expander-rad: Properties (banlängd+höjd) · Access (public/private/joint) · Closed (hide/show/only).
                    Bara EN panel öppen i taget (openSection). Access/Closed delar state med filter-boxen. */}
                <View style={styles.expRow}>
                  <TouchableOpacity onPress={() => toggleSection('props')} activeOpacity={0.85}
                    style={[styles.propsToggle, propsOpen && styles.propsToggleActive]}>
                    <Ionicons name="options-outline" size={12} color={propsActive(mapProps) ? Colors.primary : '#fff'} />
                    <Text style={[styles.propsToggleTxt, propsActive(mapProps) && { color: Colors.primary }]}>Properties</Text>
                    <Ionicons name={propsOpen ? 'chevron-up' : 'chevron-down'} size={12} color="#fff" />
                  </TouchableOpacity>
                  {/* Weather-filtret borttaget: bulk-METAR-sökning (fetchMetarsInBbox) riskerade API-utlåsning.
                      Väder finns kvar för "closest to me" (dashboard/drönare, enstaka station). */}
                  <TouchableOpacity onPress={() => toggleSection('access')} activeOpacity={0.85}
                    style={[styles.propsToggle, openSection === 'access' && styles.propsToggleActive]}>
                    <Text style={[styles.propsToggleTxt, accessOn && { color: Colors.primary }]}>Access</Text>
                    <Ionicons name={openSection === 'access' ? 'chevron-up' : 'chevron-down'} size={12} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => toggleSection('closed')} activeOpacity={0.85}
                    style={[styles.propsToggle, openSection === 'closed' && styles.propsToggleActive]}>
                    <Text style={[styles.propsToggleTxt, closedMode !== 'hide' && { color: Colors.primary }]}>Closed</Text>
                    <Ionicons name={openSection === 'closed' ? 'chevron-up' : 'chevron-down'} size={12} color="#fff" />
                  </TouchableOpacity>
                  {/* Info om datakälla + senast uppdaterad + friskrivning */}
                  <TouchableOpacity onPress={() => setDataInfoOpen(true)} activeOpacity={0.7} hitSlop={8}
                    style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="information-circle-outline" size={18} color={Colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                {/* ── Datakälla / friskrivning ── */}
                <Modal visible={dataInfoOpen} transparent animationType="fade" onRequestClose={() => setDataInfoOpen(false)}>
                  <TouchableOpacity activeOpacity={1} onPress={() => setDataInfoOpen(false)}
                    style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
                    <TouchableOpacity activeOpacity={1} onPress={() => {}}
                      style={{ width: '100%', maxWidth: 400, backgroundColor: Colors.card, borderRadius: 16, borderWidth: 1, borderColor: Colors.cardBorder, padding: 20 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <Ionicons name="information-circle" size={20} color={Colors.primary} />
                        <Text style={{ color: Colors.textPrimary, fontSize: 16, fontWeight: '800', flex: 1 }}>Airport data</Text>
                        <TouchableOpacity onPress={() => setDataInfoOpen(false)} hitSlop={8}>
                          <Ionicons name="close" size={20} color={Colors.textMuted} />
                        </TouchableOpacity>
                      </View>
                      <Text style={{ color: Colors.textSecondary, fontSize: 13.5, lineHeight: 20 }}>
                        Airport locations, types, runways and other details are compiled from public, open-data aviation sources (including airportmap.de).
                      </Text>
                      <Text style={{ color: Colors.textSecondary, fontSize: 13.5, lineHeight: 20, marginTop: 10 }}>
                        <Text style={{ color: Colors.textPrimary, fontWeight: '700' }}>Last updated: </Text>September 2026.
                      </Text>
                      <Text style={{ color: Colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 14 }}>
                        This data is provided for general reference only and may be incomplete, outdated or inaccurate. It is not for navigation. Always verify against official aeronautical information (AIP/NOTAM) and current charts before flight. Blades accepts no liability for any errors or omissions.
                      </Text>
                    </TouchableOpacity>
                  </TouchableOpacity>
                </Modal>

                {propsOpen && (
                  <View style={styles.propsPanel}>
                    <RangeBar label="Runway length" unit="m" min={lenRange.min} max={lenRange.max} step={50} dist={lenDist}
                      low={mapProps.minLenM ?? lenRange.min} high={mapProps.maxLenM ?? lenRange.max} onChange={setLenRange} />
                    <RangeBar label="Elevation" unit="ft" min={altRange.min} max={altRange.max} step={50} dist={altDist}
                      low={mapProps.minAltFt ?? altRange.min} high={mapProps.maxAltFt ?? altRange.max} onChange={setAltRange} />
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center' }}>
                      {(['asphalt', 'grass'] as const).map((sfc) => (
                        <TouchableOpacity key={sfc} onPress={() => toggleSurface(sfc)} activeOpacity={0.7}
                          style={[styles.propPill, mapProps.surface === sfc && styles.propPillOn]}>
                          <Text style={[styles.propPillTxt, mapProps.surface === sfc && { color: Colors.primary }]}>{sfc === 'asphalt' ? 'Asphalt' : 'Grass'}</Text>
                        </TouchableOpacity>
                      ))}
                      <TouchableOpacity onPress={() => setMapProps((p) => ({ ...p, lit: !p.lit }))} activeOpacity={0.7}
                        style={[styles.propPill, { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }, mapProps.lit && styles.propPillOn]}>
                        <Ionicons name={mapProps.lit ? 'flash' : 'flash-outline'} size={12} color={mapProps.lit ? Colors.primary : Colors.textMuted} />
                        <Text style={[styles.propPillTxt, mapProps.lit && { color: Colors.primary }]}>Lit</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}

                {openSection === 'access' && (
                  <View style={styles.propsPanel}>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {ACCESS_CHIPS.map((c) => {
                        const on = activeKeys.has(c.key);
                        return (
                          <TouchableOpacity key={c.key} onPress={() => toggleKey(c.key)} activeOpacity={0.7}
                            style={[styles.propPill, on && styles.propPillOn]}>
                            <Text style={[styles.propPillTxt, on && { color: Colors.primary }]} numberOfLines={1}>{c.label}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}

                {openSection === 'closed' && (
                  <View style={styles.propsPanel}>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {(['hide', 'include', 'only'] as const).map((m) => (
                        <TouchableOpacity key={m} onPress={() => setClosedMode(m)} activeOpacity={0.7}
                          style={[styles.propPill, closedMode === m && styles.propPillOn]}>
                          <Text style={[styles.propPillTxt, closedMode === m && { color: Colors.primary }]}>
                            {m === 'hide' ? 'Hide' : m === 'include' ? 'Show' : 'Only'}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                )}
              </View>
            )}
            {searchResults.length > 0 && (
              <View style={[styles.searchDropdown, { marginTop: 8 }]}>
                <ScrollView keyboardShouldPersistTaps="handled">
                  {searchResults.map((r) => (
                    <TouchableOpacity key={r[0]} style={styles.searchResult} activeOpacity={0.7}
                      onPress={() => { setFocusAirport(r); setMapSearch(''); Keyboard.dismiss(); }}>
                      <Text style={styles.searchResultIcao}>{r[0]}</Text>
                      <Text style={styles.searchResultName} numberOfLines={1}>{r[6] ? `${r[1]} · ${r[6]}` : r[1]}</Text>
                      <Ionicons name="location" size={13} color={Colors.textMuted} />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>
        )}

        {/* Kartkontroller — nere till höger: Cluster/Region-växel (vänster) + Map/Satellite (höger, längst ut). */}
        {showMapCtrls && (
          <View style={{ position: 'absolute', bottom: 24, right: 16, flexDirection: 'row', gap: 8 }}>
            {/* News (AI): flygincidenter kopplade till flygplatser — vänster om Region-knappen. */}
            <TouchableOpacity onPress={() => setNewsOpen(true)} activeOpacity={0.8} style={styles.mapCtrlBtn}>
              <Ionicons name="newspaper-outline" size={15} color="#fff" />
              <Text style={styles.mapCtrlTxt}>News</Text>
            </TouchableOpacity>
            {/* Region/Cluster-växeln döljs i väderläget (legenden täcker den ändå). */}
            {!wxCat && (
              <TouchableOpacity onPress={() => setMode(!clusterMode)} activeOpacity={0.8} style={styles.mapCtrlBtn}>
                <Ionicons name={clusterMode ? 'flag' : 'apps'} size={15} color="#fff" />
                <Text style={styles.mapCtrlTxt}>{clusterMode ? 'Region' : 'Cluster'}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => setSatellite((s) => !s)} activeOpacity={0.8} style={styles.mapCtrlBtn}>
              <Ionicons name={satellite ? 'map' : 'globe'} size={15} color="#fff" />
              <Text style={styles.mapCtrlTxt}>{satellite ? 'Map' : 'Satellite'}</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Vald flygplats → infokort i botten */}
        {focusAirport && (() => {
          const lc = landingCounts[focusAirport[0]] ?? 0;
          const lf = lastFlightMap[focusAirport[0]];
          return (
            <View style={{ position: 'absolute', left: 12, right: 12, bottom: insets.bottom + 14, zIndex: 15 }}>
              <AirportInfoCard
                icao={focusAirport[0]}
                name={focusAirport[1]}
                iata={focusAirport[6]}
                alt={focusAirport[7]}
                type={focusAirport[8]}
                landingCount={lc > 0 ? lc : undefined}
                lastText={lf ? fmtVisit(lf.date) : undefined}
                onLastPress={lf ? () => setDetailFlightId(lf.id) : undefined}
                onClose={() => setFocusAirport(null)}
                isFavorite={favorites.has(focusAirport[0])}
                onToggleFavorite={() => toggleFavorite(focusAirport[0])}
              />
            </View>
          );
        })()}

        {/* News (AI) — flygincidenter kopplade till flygplatser. Ligger överst; cachas i storen. */}
        <IncidentNewsOverlay
          visible={newsOpen}
          onClose={() => setNewsOpen(false)}
          onViewOnMap={(icao) => { setNewsOpen(false); setCameFromNews(true); focusByIcao(icao); }}
          canLocate={(icao) => !!icao && seedData.some((r) => r[0] === icao)}
          onUpgrade={() => { setNewsOpen(false); presentPaywall('Flight incident news'); }}
        />

        {/* Flight-detalj som overlay OVANPÅ kartan (nästlad Modal) → stäng återgår hit, kartan bevaras. */}
        {detailFlightId != null && (
          <Modal visible animationType="slide" onRequestClose={() => setDetailFlightId(null)}>
            <View style={{ flex: 1, backgroundColor: Colors.background, paddingTop: insets.top }}>
              <FlightDetailView
                id={detailFlightId}
                onBack={() => setDetailFlightId(null)}
                onEdit={(fid) => { setDetailFlightId(null); closeMap(); router.push(`/flight/add?editId=${fid}` as any); }}
              />
            </View>
          </Modal>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  searchRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(15,22,38,0.95)', borderRadius: 12,
    paddingHorizontal: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', gap: 8,
    marginRight: 48, // håll sökraden fri från X-stängknappen uppe till höger (kompassen borttagen)
  },
  searchInput: { flex: 1, color: '#fff', fontSize: 15, paddingVertical: 10 },
  favBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'center',
    backgroundColor: 'rgba(15,22,38,0.95)', borderRadius: 7,
    borderWidth: 1, borderColor: Colors.gold + '66', paddingHorizontal: 8, paddingVertical: 6,
  },
  favBtnOn: { backgroundColor: Colors.gold, borderColor: Colors.gold },
  favBtnTxt: { color: Colors.gold, fontSize: 9, fontWeight: '800', letterSpacing: 0.2 },
  // Swipebara typ-filterknappar (lika breda, ~30% mindre). Aktiv = cyan (skild från Favorites guld).
  typeChip: { width: 68, alignItems: 'center', justifyContent: 'center', paddingVertical: 6, paddingHorizontal: 5, borderRadius: 7, backgroundColor: 'rgba(15,22,38,0.95)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  typeChipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  typeChipTxt: { color: '#fff', fontSize: 8.5, fontWeight: '800', letterSpacing: 0.2, textAlign: 'center' },
  typeChipTxtOn: { color: '#062024' },
  // Properties-expander + panel (under swipe-raden). Full bredd (kompassrosen borttagen).
  expRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 6 },
  propsToggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 7, backgroundColor: 'rgba(15,22,38,0.95)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  propsToggleActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' },
  propsToggleTxt: { color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 0.2 },
  propsPanel: { marginTop: 6, backgroundColor: 'rgba(15,22,38,0.96)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 14, paddingVertical: 10 },
  searchDropdown: {
    maxHeight: 280, backgroundColor: 'rgba(15,22,38,0.97)', borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', overflow: 'hidden',
  },
  searchResult: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 0.5, borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  searchResultIcao: { color: '#fff', fontSize: 14, fontWeight: '800', fontFamily: 'Menlo', letterSpacing: 1, width: 52 },
  searchResultName: { color: 'rgba(255,255,255,0.7)', fontSize: 12.5, flex: 1 },

  // Kartkontroller nere till höger (Cluster/Region + Map/Satellite) — identisk storlek.
  mapCtrlBtn: { height: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 12, borderRadius: 18, backgroundColor: 'rgba(15,22,38,0.9)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.2)' },
  mapCtrlTxt: { color: '#fff', fontSize: 11, fontWeight: '700' },
  propPill: {
    flex: 1, alignItems: 'center', paddingVertical: 7, borderRadius: 8,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(255,255,255,0.05)',
  },
  propPillOn: { borderColor: Colors.primary, backgroundColor: Colors.primary + '22' },
  propPillTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },
  noMatchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(15,22,38,0.95)', borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 18, paddingVertical: 14, maxWidth: '82%',
  },
  noMatchTxt: { color: Colors.textSecondary, fontSize: 13.5, fontWeight: '700', lineHeight: 19 },
  // Väderpanel
  wxHint: { color: Colors.textSecondary, fontSize: 11.5, fontWeight: '600', lineHeight: 16 },
  wxDot: { width: 9, height: 9, borderRadius: 5 },
  wxStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  wxStatusTxt: { flex: 1, color: Colors.primary, fontSize: 11.5, fontWeight: '700' },
  wxClearBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  wxClearTxt: { color: '#fff', fontSize: 11, fontWeight: '700' },
  // Land-sökruta (country picker)
  cpSheet: { backgroundColor: 'rgba(15,22,38,0.98)', borderRadius: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', padding: 14 },
  cpHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
  cpTitle: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 0.2 },
  cpInput: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', color: '#fff', fontSize: 15, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8 },
  cpEmpty: { color: Colors.textMuted, fontSize: 13, fontWeight: '600', paddingVertical: 14, textAlign: 'center' },
  cpRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.08)' },
  cpName: { flex: 1, color: '#fff', fontSize: 14, fontWeight: '600' },
  cpCc: { color: Colors.textMuted, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  // Väder-legend (nedre vänstra hörnet, under landskortet)
  wxLegendCard: { backgroundColor: 'rgba(15,22,38,0.92)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', paddingHorizontal: 10, paddingVertical: 8, gap: 4 },
  wxLegendTitle: { color: Colors.textSecondary, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 2 },
  wxLegendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  wxLegendDot: { width: 9, height: 9, borderRadius: 5, borderWidth: 1, borderColor: 'rgba(5,10,20,0.6)' },
  wxLegendCat: { color: '#fff', fontSize: 10.5, fontWeight: '800', width: 34 },
  wxLegendTxt: { color: Colors.textSecondary, fontSize: 10.5, fontWeight: '600' },
  countryBox: {
    flexDirection: 'row', alignItems: 'center', gap: 9, maxWidth: '100%',
    backgroundColor: 'rgba(15,22,38,0.92)', borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    paddingLeft: 6, paddingRight: 14, paddingVertical: 5,
  },
  countryInfo: { alignItems: 'center', justifyContent: 'center', flexShrink: 1 },
  countryName: { color: '#fff', fontSize: 18, fontWeight: '800', lineHeight: 21, flexShrink: 1 },
  countryRegion: { color: Colors.primary, fontSize: 12.5, fontWeight: '700', lineHeight: 15, textAlign: 'center', flexShrink: 1 },
  countryStat: { color: Colors.textMuted, fontSize: 10.5, fontWeight: '600', lineHeight: 13.5 },
});
