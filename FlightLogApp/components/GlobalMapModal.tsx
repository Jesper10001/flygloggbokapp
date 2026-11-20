// Global flygplatskarta som helskärmsmodal (utan header, likt Visited airports). Flytande sökruta
// upptill med typ-chips + expander (Properties = banlängd/höjd-range-barer, Access, Closed). Nere till
// höger: Cluster/Region-växel + Map/Satellite. Cluster (default) = geo-kluster som delas vid inzoomning;
// Region = land → region → sektor-drill DIREKT PÅ KARTAN (cyan-gränser + antal, borra ner tills ICAO-
// pins). Infokort i botten vid val. Öppnas från Manage airports + dashboard.
import { useState, useEffect, useMemo, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, TextInput, Modal, Pressable, StyleSheet, Keyboard, Alert, LayoutAnimation, Clipboard, Linking } from 'react-native';
import { Marker } from 'react-native-maps';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { GlobalAirportMap, type RegionMarker } from './GlobalAirportMap';
import { AirportInfoCard } from './AirportInfoCard';
import { WxMapPopup } from './WxMapPopup';
import { AirportNavPanel } from './AirportNavPanel';
import { FlightDetailView } from '../app/flight/detail/[id]';
import { getSeedAirports, getNearbyAirports } from '../db/icao';
import { getFavoriteIcaos, setFavorite } from '../db/favorites';
import { getAirportLandingCounts, getAirportLastFlight, getLastFlightAt, getSetting, setSetting } from '../db/flights';
import { formatCoord, COORD_SYSTEMS, type CoordSystem } from '../utils/coords';
import { LatestFlightCard } from './logbook-page/LatestFlightCard';
import { useReplay } from './milestones/ReplayKit';
import { FlightReplayLayer, buildReplay, replayTotal, replayProgress, replayCaption, type ReplayFlight } from './FlightReplay';
import { getRunwayIndex, SURFACE_FILTERS, surfaceBit } from '../utils/runways';
import { countryNameFull } from '../constants/countryNames';
import { COUNTRY_POPULATION, formatPopulation } from '../constants/countryPopulation';
import { CountryFlag } from './CountryFlag';
import {
  leavesFor, matchLeaves, keysNeedRunway, propsActive, matchProps, FILTER_GROUPS, ACCESS_NODES, SPECIFIC_NODES, isSpecificKey, type FilterGroup,
  filterCountLabel, EMPTY_PROPS, type MapProps,
} from '../constants/mapFilters';
import { fetchMetarsInBbox, categoryColor, type FlightCat, type AirportMetar } from '../services/weather';
import { COUNTRY_NAMES } from '../constants/countryNames';
import { useRegulationStandardStore } from '../store/regulationStandardStore';
import { useFlightStore } from '../store/flightStore';
import { presentPaywall } from '../services/purchases';
import { useTourStore } from '../store/tourStore';
import { IncidentNewsOverlay } from './IncidentNewsOverlay';
import { MapControlStack } from './MapControlStack';
import { useIncidentNewsStore } from '../store/incidentNewsStore';
import { useHoldPopups } from '../store/mapScreenStore';

// Väderfilter: min-kategori (lägsta acceptabla). VFR bäst → LIFR sämst. En flygplats "möter" kravet
// om dess aktuella kategori är minst lika bra som vald tröskel (VFR-tröskel = enbart VFR-fält).
const WX_RANK: Record<string, number> = { VFR: 3, MVFR: 2, IFR: 1, LIFR: 0 };
function meetsWx(cat: FlightCat | null | undefined, min: FlightCat): boolean {
  if (!cat) return false;
  return (WX_RANK[cat] ?? -1) >= (WX_RANK[min] ?? 99);
}
const WX_CATS: FlightCat[] = ['VFR', 'MVFR', 'IFR', 'LIFR'];
// Väder- och favoritläget målar ut enskilda pins direkt upp till detta antal (= GlobalAirportMaps
// pin-tak), annars faller de tillbaka på flaggor/kluster.
const DIRECT_PIN_LIMIT = 180;

// Legend-rader: sikt i sm (FAA) eller km (EASA/CAA), molnbas alltid i fot. Samma trösklar som väderfiltret.
function wxLegendRowsFor(sm: boolean): { cat: FlightCat; vis: string; ceil: string }[] {
  const vis = sm
    ? { VFR: 'vis >5 sm', MVFR: 'vis 3–5 sm', IFR: 'vis 1–3 sm', LIFR: 'vis <1 sm' }
    : { VFR: 'vis >8 km', MVFR: 'vis 5–8 km', IFR: 'vis 1.6–5 km', LIFR: 'vis <1.6 km' };
  const ceil = { VFR: 'ceil >3000 ft', MVFR: 'ceil 1000–3000 ft', IFR: 'ceil 500–1000 ft', LIFR: 'ceil <500 ft' };
  return WX_CATS.map((cat) => ({ cat, vis: vis[cat], ceil: ceil[cat] }));
}

// Access-val (samma nycklar som ACCESS_NODES i constants/mapFilters) → Access-panelen.
const ACCESS_CHIPS: { label: string; key: string }[] = [
  { label: 'Public', key: 'r:public' },
  { label: 'Private', key: 'r:private' },
  { label: 'Joint Use', key: 'r:joint' },
];
import { countryRoot, buildChildren, nodeAirports, nodeRings, DRILL_CAP, type DrillNode } from '../utils/regionDrill';
import { neighborCountries } from '../utils/neighbors';
import { countryBorder } from '../utils/borders';
import { Colors } from '../constants/colors';
import airportDataMeta from '../assets/airport-data-meta.json';
import { displayCode } from '../utils/airportCodes';
import { UnitCard } from './UnitCard';
import { UnitSourcesPopup } from './UnitSources';
import { RoleTag } from './RoleTag';
import { getMilBase, baseRoles, milCounts, ROLES, ROLE_ORDER, typeFamilies, baseHasFamily, suggestFamilies, type RoleKey } from '../utils/milAirbases';
import { useOsintStore } from '../store/osintStore';
import { useAirportInfoStore, useAirportInfo } from '../store/airportInfoStore';
import { AirportInfoPanel } from './AirportInfoPanel';

// Datum då flygplatsdatan senast hämtades (skrivs av scripts/build-airports.mjs --refresh), t.ex. "26 October 2026".
const AIRPORT_DATA_UPDATED = new Date(`${airportDataMeta.updated}T12:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

type SeedRow = [string, string, string, string, number, number, string?, (number | null)?, string?, string?, string?, string?, string?];
type Region = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };
const WORLD: Region = { latitude: 25, longitude: 5, latitudeDelta: 110, longitudeDelta: 110 };

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

// ⓘ-texten för OSINT-lagret (INSTRUKTION_osint_lager.md avsnitt 6), anpassad efter användarens beslut 2026-11-20:
// även Schweiz och Österrike är borta, och Ryssland visas som förut (inga rapporterade placeringar).
const LAYER_INFO = 'Military air bases and the units based there, compiled from open sources (OSINT). NATO member states, Switzerland, Austria and Ukraine are not included, nor are NATO units deployed abroad. In conflict areas, only long-standing home bases are shown. Open-source information can be incomplete or out of date. Tap Source on any base to check it.';

// Properties: fasta steg för banlängd (längsta banan minst …) och höjd.
const RWY_STEPS = [null, 800, 1200, 1500, 2000, 2500, 3000] as const;
const ALT_STEPS: { label: string; min: number | null; max: number | null }[] = [
  { label: 'Any', min: null, max: null },
  { label: 'Below 1,000 ft', min: null, max: 1000 },
  { label: '1,000–5,000 ft', min: 1000, max: 5000 },
  { label: 'Above 5,000 ft', min: 5000, max: null },
];

export function GlobalMapModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [seedData, setSeedData] = useState<SeedRow[]>([]);
  const [mapSearch, setMapSearch] = useState('');
  const [focusAirport, setFocusAirport] = useState<SeedRow | null>(null);
  const [metarPopup, setMetarPopup] = useState<AirportMetar | null>(null); // väderrutan som overlay över kartan
  useEffect(() => { setMetarPopup(null); }, [focusAirport]);
  const [flyTo, setFlyTo] = useState(false);               // "Fly to XXXX" → plan-overlay (rutt/distans/förbrukning)
  const [flyToFrozen, setFlyToFrozen] = useState(false);   // fryser snippet-markörerna strax före avmontering (ingen kart-krasch)
  const [flyToMetar, setFlyToMetar] = useState<AirportMetar | null>(null); // vind från kortet → aktiv bana i snippeten
  const flyToTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [newsOpen, setNewsOpen] = useState(false);      // Global map → News-rutan
  const [newsSel, setNewsSel] = useState<string | null>(null); // vald post i News → dess prick lyser
  // Kartknapparna nere till höger (Apple Kartor-stil, 2026-11-18): kompass, News, kartlager, min position.
  const [mapHeading, setMapHeading] = useState(0);
  const [camCmd, setCamCmd] = useState<any>(null);
  const [userPos, setUserPos] = useState<{ lat: number; lon: number } | null>(null);
  const [meActive, setMeActive] = useState(false);   // kartan står centrerad på dig (fylld pil)
  const [meBusy, setMeBusy] = useState(false);
  const [locOff, setLocOff] = useState(false);       // platstjänster nekade → liten ruta med "Open Settings"
  const meGuardRef = useRef(0);                      // kamerans egen flygning räknas inte som att man drog i kartan
  const newsIncidents = useIncidentNewsStore((st) => st.incidents);
  const [cameFromNews, setCameFromNews] = useState(false); // kom hit via "Map" i nyhetsrutan → visa "Back to news"
  const [satellite, setSatellite] = useState(true); // satellitläge förvalt
  useEffect(() => { if (visible) setSatellite(true); }, [visible]); // alltid satellit vid öppning
  useEffect(() => { if (visible) { useOsintStore.getState().load(); useAirportInfoStore.getState().load(); } }, [visible]);
  useEffect(() => { setInfoOpen(false); }, [focusAirport]);
  const [landingCounts, setLandingCounts] = useState<Record<string, number>>({});
  const [lastFlightMap, setLastFlightMap] = useState<Record<string, { id: number; date: string; reg: string }>>({});
  const [detailFlightId, setDetailFlightId] = useState<number | null>(null); // flight-detalj som overlay ovanpå kartan

  // ── Play: senaste flygningen FRÅN flygplatsen till en annan flygplats ──
  // Börjar inzoomat: farkosten dyker upp på banan som pekar mot målet och rullar iväg. Sedan zoomar kartan ut
  // (flygplatskortet överst, flygkortet längst ner), flygningen spelas och den slutar med att kartan zoomar in på
  // ankomstflygplatsen med dess kort. Bara när ankomsten finns bland flygplatserna (annars inget kort att visa).
  // Koordinaterna i flygplatsvyn: valt system (sparas, MGRS första gången), rullistan och "Copied".
  const [coordSys, setCoordSys] = useState<CoordSystem>('mgrs');
  const [coordListOpen, setCoordListOpen] = useState(false);
  // Airport Info (Info-knappen på kartan → kortet ovanför flygplatskortet). Stängs när man byter flygplats.
  const [infoOpen, setInfoOpen] = useState(false);
  const focusInfo = useAirportInfo(focusAirport?.[0]);   // egen ↻-hämtning vinner över serverns
  const [coordShown, setCoordShown] = useState(false); // koordinaterna syns först när man valt ett system (gäller resten av besöket på kartan)
  useEffect(() => { if (!visible) { setCoordShown(false); setCoordListOpen(false); } }, [visible]);
  const [coordCopied, setCoordCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    getSetting('coord_system').then((v) => { if (v && COORD_SYSTEMS.some((c) => c.id === v)) setCoordSys(v as CoordSystem); }).catch(() => {});
    return () => { if (copiedTimer.current) clearTimeout(copiedTimer.current); };
  }, []);
  useEffect(() => { setCoordListOpen(false); setCoordCopied(false); }, [focusAirport]);
  const pickCoordSys = (id: CoordSystem) => { setCoordSys(id); setCoordShown(true); setCoordListOpen(false); setCoordCopied(false); setSetting('coord_system', id).catch(() => {}); };
  const copyCoord = (text: string) => {
    try { Clipboard.setString(text); } catch { return; }
    setCoordListOpen(false); setCoordCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCoordCopied(false), 1600);
  };

  const PLAY_PRE = 2.2;
  const [playCand, setPlayCand] = useState<(ReplayFlight & { arrRow: SeedRow }) | null>(null);
  const play = useReplay(replayTotal(PLAY_PRE));
  const [playOn, setPlayOn] = useState(false);
  const playGuardRef = useRef(0); // fram till den tiden får en utzoomning inte avmarkera flygplatsen
  const [playCardH, setPlayCardH] = useState(150);
  const [playFlightH, setPlayFlightH] = useState(150);
  useEffect(() => {
    setPlayCand(null);
    if (!focusAirport) return;
    let alive = true;
    (async () => {
      const f = await getLastFlightAt(focusAirport[0], 'from');
      if (!f) return;
      const arrRow = seedData.find((r) => r[0] === f.arr_place.trim().toUpperCase());
      if (!arrRow) return;
      const r = await buildReplay(focusAirport[0], f, { lat: focusAirport[4], lon: focusAirport[5] }, { lat: arrRow[4], lon: arrRow[5] }, true);
      if (alive) setPlayCand({ ...r, arrRow });
    })().catch(() => {});
    return () => { alive = false; };
  }, [focusAirport, seedData]);
  const playLayout = () => LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
  const startPlay = () => {
    if (!playCand) return;
    setMetarPopup(null);
    playGuardRef.current = Number.MAX_SAFE_INTEGER;
    playLayout();
    play.seek(0);
    setPlayOn(true);
    play.play();
  };
  const stopPlay = () => {
    play.halt(); play.seek(0);
    playGuardRef.current = Date.now() + 1500;
    playLayout();
    setPlayOn(false);
  };
  // Klar → ankomstflygplatsen blir vald: kartan zoomar in där (GlobalAirportMap focus) och dess kort visas.
  useEffect(() => {
    if (!playOn || play.playing || play.t < replayTotal(PLAY_PRE) - 0.01) return;
    const id = setTimeout(() => {
      const to = playCand?.arrRow;
      playGuardRef.current = Date.now() + 2000;
      playLayout();
      setPlayOn(false); play.seek(0);
      if (to) setFocusAirport(to);
    }, 600);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playOn, play.playing, play.t]);
  // Annan flygplats, stängt kort eller stängd karta → avbryt.
  useEffect(() => { if (playOn && (!focusAirport || focusAirport[0] !== playCand?.icao)) stopPlay(); }, [focusAirport]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!visible && playOn) stopPlay(); }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter: flervals-löv (Set) + Properties (banlängd/höjd/yta/lit) + closed-läge.
  const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set());
  const [mapProps, setMapProps] = useState<MapProps>(EMPTY_PROPS);
  const [closedMode, setClosedMode] = useState<'hide' | 'include' | 'only'>('hide'); // closed döljs som standard
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [favMode, setFavMode] = useState(false); // Favorites-knappen: visa bara favoriter (filtrerbart)
  // Vilken expander-panel under typ-raden som är öppen (en i taget): Properties / Weather / Access / Closed.
  const [openSection, setOpenSection] = useState<null | string>(null); // 'props' | 'access' | 'closed' | 'g:<grupp>'
  const [specificPage, setSpecificPage] = useState(false); // Air Bases-panelens andra sida (Specific)
  const [unitSourceOpen, setUnitSourceOpen] = useState(false); // förbandskortets Source-ruta
  // OSINT-lagret (Air Bases → Specific) hämtas från proxyn när kartan öppnas (store/osintStore.ts). Versionen ingår i
  // filtren och kartnyckeln så att baserna ritas när lagret kommit (eller försvinner vid 451).
  const osintStatus = useOsintStore((st) => st.status);
  const osintVersion = useOsintStore((st) => st.version);
  const [layerInfoOpen, setLayerInfoOpen] = useState(false); // ⓘ på Specific-sidan: om lagret
  // Specific → Types (2026-11-20): valda modellfamiljer förfinar Specific — bara baser med någon av dem; samma
  // rollsymboler och förbandskort, de valda typerna i cyan på kortet.
  const [typeSel, setTypeSel] = useState<Set<string>>(new Set());
  const [typesPage, setTypesPage] = useState(false);
  const [typeRole, setTypeRole] = useState<RoleKey | null>(null); // öppen kategori i Types-listan
  const [typeQuery, setTypeQuery] = useState('');
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
  // Väderfiltret är en Blades Premium-funktion → RevenueCat-paywallen (inte den gamla egna sidan).
  const isPremium = useFlightStore((s) => s.isPremium);
  // Betalväggen är ett eget fönster och får inte öppnas ovanpå kartans: kartan stängs först, sedan betalväggen.
  const paywallAfterClose = (feature: string) => { closeMap(); setTimeout(() => presentPaywall(feature), 550); };
  const promptWeatherPremium = () => paywallAfterClose('Weather filter');
  // Medan kartan är öppen väntar appens popup-rutor och systemrutor (de kan annars låsa skärmen).
  useHoldPopups(visible);

  // Region-drill på kartan (ersätter land-listan). Tom = världsvy (flaggor).
  const [drillStack, setDrillStack] = useState<DrillNode[]>([]);
  // Kartläge (växlas nere till höger): 'Cluster' (default) = geografiska kluster som delas när man zoomar
  // in; 'Region' = land → region → sektor-drill. clusterMode true = Cluster.
  // Region-knappen är borttagen (2026-11-17): kartan är alltid i Cluster-läget. Region-koden ligger kvar orörd.
  const [clusterMode] = useState(true);
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
    const runwayActive = mapProps.minLenM != null || mapProps.maxLenM != null || mapProps.surface.length > 0;
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
        if (!matchLeaves(leaves, r, rwy)) return false;
        if (runwayActive && !matchProps(rwy, mapProps)) return false;
        if (altActive) {
          const a = r[7];
          if (a == null || (mapProps.minAltFt != null && a < mapProps.minAltFt) || (mapProps.maxAltFt != null && a > mapProps.maxAltFt)) return false;
        }
        return true;
      });
    }
    // Specific → Types: bara baser med någon av de valda modellfamiljerna
    if (typeSel.size) result = result.filter((r) => baseHasFamily(r[0], typeSel));
    // Väderfilter sist: bara valt land. 'ALL' → alla fält med en rapporterad kategori (färgkodas på kartan);
    // annars bara de som möter min-kategorin. wxResults fylls progressivt.
    if (wxCat && wxCountry) {
      result = wxCat === 'ALL'
        ? result.filter((r) => r[2] === wxCountry && wxResults.get(r[0]) != null)
        : result.filter((r) => r[2] === wxCountry && meetsWx(wxResults.get(r[0]), wxCat));
    }
    return result;
  }, [seedData, activeKeys, mapProps, closedMode, favMode, favorites, wxCat, wxCountry, wxResults, osintVersion, typeSel]);

  // Runway-längdintervall för nuvarande urval (kategori/closed/fav — EJ längdfiltret självt) → sätter
  // slidrarnas gränser + default (kortaste/längsta bana som finns). Beräknas bara när Properties är öppet.

  // Kart-nyckel = filtersignaturen. Vid FILTERändring (på alla zoomnivåer) byter nyckeln → kartan
  // byggs om från grunden i stället för att diffa markörer live (mass-markör-diff = native-krasch).
  // NAVIGERING (drill/back) ändrar inte nyckeln → ingen remount → frameRegion-effekten sköter mjuk
  // zoom. Efter remount monteras kartan på currentNode via initialRegion={frameRegion} (ingen världshopp).
  const mapKey = useMemo(
    () => (clusterMode ? 'C' : 'R') + '|' + [...activeKeys].sort().join(',') + `|${mapProps.minLenM}_${mapProps.maxLenM}_${mapProps.surface.join('+')}|${closedMode}` + (favMode ? `|F${favorites.size}` : '') + (wxCat && wxCountry ? `|W${wxCat}_${wxCountry}_${wxResults.size}` : '')
      + ([...activeKeys].some(isSpecificKey) ? `|O${osintVersion}|T${[...typeSel].sort().join('+')}` : ''),
    [clusterMode, activeKeys, mapProps, closedMode, favMode, favorites, wxCat, wxCountry, wxResults, osintVersion, typeSel],
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
  // ryms under kart-taket (DIRECT_PIN_LIMIT). Över taket faller vi tillbaka på klustring för prestanda.
  const wxDirect = !!(wxCat && wxCountry) && typedSeed.length > 0 && typedSeed.length <= DIRECT_PIN_LIMIT;
  // Favorites: samma sak — favoriterna syns som pins på ALLA zoomnivåer, även i världsvyn. (Förr klustrades
  // de i klusterläget → syntes först när man zoomat in på platsen.) Över taket: flaggor/kluster som vanligt.
  const favDirect = favMode && !currentNode && typedSeed.length > 0 && typedSeed.length <= DIRECT_PIN_LIMIT;
  const directPins = wxDirect || favDirect;
  const pins = directPins ? typedSeed
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
  // Flaggnivån rapporteras av kartan (dynamisk: beror på hur många flygplatser filtret visar i vyn). Landrutan
  // visas när kartan visar kluster/nålar, men inte i världsvyn.
  const [flagView, setFlagView] = useState(true);
  const atFlagLevel = flagView || mapRegion.latitudeDelta > 40;
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
      const shown = displayCode(r[0]).toUpperCase(); // lokal kod för flygplatser utan ICAO (utils/airportCodes)
      if (icao === q || shown === q) exact.push(r);
      else if ((r[6] || '').toUpperCase() === q) { if (iataM.length < 10) iataM.push(r); }
      else if (icao.startsWith(q) || shown.startsWith(q)) { if (pre.length < 30) pre.push(r); }
      else if (r[1].toUpperCase().includes(q) || (r[9] || '').toUpperCase().includes(q)) { if (nameM.length < 30) nameM.push(r); }
    }
    return [...exact, ...iataM, ...pre, ...nameM].slice(0, 20);
  }, [mapSearch, seedData]);

  const closeMap = () => {
    setFlyTo(false); setFlyToFrozen(false); setUnitSourceOpen(false); setLayerInfoOpen(false); setTypeSel(new Set()); setTypesPage(false); setTypeQuery('');
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
    // Rama in favoriterna (klusterläget monterar om på mapRegion) → de syns direkt, var man än stod.
    const favRows = seedData.filter((r) => favorites.has(r[0]) && r[8] !== 'closed');
    setMapRegion(favRows.length ? boundsRegion(favRows) : WORLD);
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

  // "Fly to XXXX": öppnar plan-overlayn (rutt/distans/förbrukning) ovanpå kartan. Stängs i tre steg som
  // Find airport — frys snippet-markörerna, avmontera MapView:n nästa frame — så react-native-maps inte
  // rivs mitt i en aktiv tracksViewChanges (kraschar annars native-kartan på iOS).
  const openFlyTo = () => { setFlyToFrozen(false); setFlyToMetar(null); setFlyTo(true); };
  const closeFlyTo = () => {
    setFlyToFrozen(true);
    requestAnimationFrame(() => {
      if (flyToTimer.current) clearTimeout(flyToTimer.current);
      flyToTimer.current = setTimeout(() => { setFlyTo(false); setFlyToMetar(null); flyToTimer.current = null; }, 90);
    });
  };
  useEffect(() => () => { if (flyToTimer.current) clearTimeout(flyToTimer.current); }, []);

  // News: när vald flygplats stängs (X / auto-avmarkering) slutar "Back to news" gälla. Plan-overlayn
  // stängs också direkt (ingen flygplats kvar att flyga till).
  useEffect(() => { if (!focusAirport) { setCameFromNews(false); setFlyTo(false); setFlyToFrozen(false); } }, [focusAirport]);

  // Blades introduction: rundturen demonstrerar sökningen LÅNGSAMT — skriv in ICAO (demo: KJFK) tecken för
  // tecken (förslag dyker upp), "klicka" på träffen → navigera dit, vänta en stund vid flygplatsen.
  // (Väder-popupen öppnas INTE i demon — en nästlad modal gav svart skärm när kartan stängdes.)
  const tourSearchIcao = useTourStore((s) => s.mapSearchIcao);
  useEffect(() => {
    if (!visible || !tourSearchIcao || seedData.length === 0) return;
    let alive = true;
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      const icao = tourSearchIcao.toUpperCase();
      await sleep(900); if (!alive) return;
      for (let i = 1; i <= icao.length; i++) {      // skriv tecken för tecken → förslagen fylls på
        setMapSearch(icao.slice(0, i));
        await sleep(520); if (!alive) return;
      }
      await sleep(900); if (!alive) return;         // låt hela förslagslistan synas
      focusByIcao(icao); setMapSearch('');          // "klicka" på träffen → navigera dit, dölj listan
    })();
    return () => { alive = false; };
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
  const toggleSurface = (sfc: string) => setMapProps((p) => ({ ...p, surface: p.surface.includes(sfc) ? p.surface.filter((x) => x !== sfc) : [...p.surface, sfc] }));
  // Properties (design B 2026-11-20): en rad per egenskap med valt värde till höger; tryck → radens fasta steg.
  const [propRow, setPropRow] = useState<'rwy' | 'alt' | 'sfc' | null>(null);
  const rwyLabel = mapProps.minLenM == null ? 'Any' : `${mapProps.minLenM.toLocaleString('en-US')} m+`;
  const altStep = ALT_STEPS.find((a) => a.min === mapProps.minAltFt && a.max === mapProps.maxAltFt);
  const altLabel = mapProps.minAltFt == null && mapProps.maxAltFt == null ? 'Any' : altStep?.label ?? `${mapProps.minAltFt ?? '…'}–${mapProps.maxAltFt ?? '…'} ft`;
  const sfcLabel = mapProps.surface.length === 0 ? 'Any' : mapProps.surface.length > 2 ? `${mapProps.surface.length} types` : mapProps.surface.join(', ');
  const toggleSection = (s: string) => { setSpecificPage(false); setTypesPage(false); setOpenSection((cur) => (cur === s ? null : s)); };
  // Gruppknapparna (Airports/Air Bases/Airfields/Helicopter/Other): "All" = hela gruppen; en undertyp tar bort All.
  const groupOn = (g: FilterGroup) => activeKeys.has(g.all.key) || g.subs.some((n) => activeKeys.has(n.key))
    || (g.key === 'airbases' && [...activeKeys].some(isSpecificKey));
  // Air Bases → Specific: "All" = alla ryska baser; en roll tar bort All (flera roller går att välja).
  const specificOn = [...activeKeys].some(isSpecificKey);
  const specificChosen = SPECIFIC_NODES.filter((n) => activeKeys.has(n.key));
  // Types utan modellista (gammalt lager i telefonen) → hämta lagret på nytt direkt
  useEffect(() => { if (typesPage && osintVersion && !typeFamilies().length) useOsintStore.getState().load(true); }, [typesPage, osintVersion]);
  // Typvalet hör till Specific: stängs Specific av (inga roller valda) försvinner typvalet också.
  useEffect(() => { if (!specificOn && typeSel.size) setTypeSel(new Set()); }, [specificOn]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickSpecific = (key: string) => setActiveKeys((prev) => {
    const n = new Set(prev);
    if (key === 'rb:all') { const was = n.has(key); [...n].filter(isSpecificKey).forEach((k) => n.delete(k)); if (!was) n.add(key); }
    else { n.delete('rb:all'); n.has(key) ? n.delete(key) : n.add(key); }
    return n;
  });
  const pickGroupAll = (g: FilterGroup) => setActiveKeys((prev) => {
    const n = new Set(prev);
    if (n.has(g.all.key)) n.delete(g.all.key); else { n.add(g.all.key); g.subs.forEach((x) => n.delete(x.key)); }
    return n;
  });
  const pickGroupSub = (g: FilterGroup, key: string) => setActiveKeys((prev) => {
    const n = new Set(prev);
    n.delete(g.all.key);
    n.has(key) ? n.delete(key) : n.add(key);
    return n;
  });
  // Antal (öppna flygplatser i hela databasen) under varje val i den öppna gruppanelen.
  const openGroup = openSection?.startsWith('g:') ? FILTER_GROUPS.find((g) => `g:${g.key}` === openSection) ?? null : null;
  const groupCounts = useMemo(() => {
    if (!openGroup) return null;
    const nodes = [openGroup.all, ...openGroup.subs];
    const out: Record<string, number> = {};
    nodes.forEach((n) => { out[n.key] = 0; });
    for (const r of seedData) {
      if (r[8] === 'closed') continue;
      for (const n of nodes) if (n.match!(r)) out[n.key]++;
    }
    return out;
  }, [openGroup, seedData]);
  const accessOn = ACCESS_CHIPS.some((c) => activeKeys.has(c.key));
  // Access-knappen visar antalet val, Closed-läget inräknat (Closed ligger numera under Access).
  const accessCount = ACCESS_CHIPS.filter((c) => activeKeys.has(c.key)).length + (closedMode !== 'hide' ? 1 : 0);
  // Clear (höger om Favorites): syns bara när något filter är på; nollställer alla filterval.
  const anyFilterOn = activeKeys.size > 0 || propsActive(mapProps) || closedMode !== 'hide' || favMode || typeSel.size > 0;
  const clearAll = () => {
    setActiveKeys(new Set()); setMapProps(EMPTY_PROPS); setClosedMode('hide'); setFavMode(false);
    setTypeSel(new Set()); setTypeQuery(''); setFocusAirport(null);
  };
  const pickType = (f: string) => {
    setTypeSel((prev) => { const n = new Set(prev); n.has(f) ? n.delete(f) : n.add(f); return n; });
    // Typvalet förfinar Specific: är ingen roll vald visas alla baser (All) med typen
    setActiveKeys((prev) => ([...prev].some(isSpecificKey) ? prev : new Set([...prev, 'rb:all'])));
  };

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

  const showMapCtrls = !focusAirport && !newsOpen;

  // Min position: flyg till dig och zooma bara in så långt att närmaste flygplats fortfarande syns.
  const goToMe = async () => {
    if (meBusy) return;
    setMeBusy(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setLocOff(true); return; }
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const me = { lat: p.coords.latitude, lon: p.coords.longitude };
      setUserPos(me);
      // Närmaste riktiga flygplats (inte heliport/nedlagd); ringar utåt tills en hittas.
      let near: { lat: number; lon: number } | null = null;
      for (const deg of [0.5, 1.5, 4, 9, 18, 30]) {
        const c = (await getNearbyAirports(me.lat, me.lon, 40, deg)).find((a) => ['large', 'medium', 'small'].includes(a.type || ''));
        if (c) { near = { lat: c.lat, lon: c.lon }; break; }
      }
      // Ingen flygplats (eller samma punkt) → en ruta på ca 5 km runt dig.
      const pts = near && (Math.abs(near.lat - me.lat) + Math.abs(near.lon - me.lon) > 0.002)
        ? [me, near]
        : [{ lat: me.lat - 0.025, lon: me.lon - 0.04 }, { lat: me.lat + 0.025, lon: me.lon + 0.04 }];
      meGuardRef.current = Date.now() + 2000;
      setMeActive(true);
      setCamCmd({ key: `me-${Date.now()}`, kind: 'fit', pts, padding: { top: insets.top + 90, bottom: insets.bottom + 70, left: 50, right: 90 } });
    } catch {
      setLocOff(true);
    } finally { setMeBusy(false); }
  };
  useEffect(() => { if (!locOff) return; const t = setTimeout(() => setLocOff(false), 6000); return () => clearTimeout(t); }, [locOff]);

  // News: nyheternas flygplatser som prickar på kartan. Kartan står kvar där den är (ingen inramning).
  const seedByIcao = useMemo(() => new Map(seedData.map((r) => [r[0], r])), [seedData]);
  const newsPts = useMemo(() => {
    const seen = new Set<string>();
    const out: { icao: string; lat: number; lon: number }[] = [];
    for (const it of newsIncidents) {
      const icao = it.resolvedIcao;
      const r = icao ? seedByIcao.get(icao) : undefined;
      if (!icao || !r || seen.has(icao)) continue;
      seen.add(icao);
      out.push({ icao, lat: r[4], lon: r[5] });
    }
    return out;
  }, [newsIncidents, seedByIcao]);
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
            // Väder-/favoritläge (under taket) → tvinga enskilda pins, ingen klustring.
            mode={directPins ? 'pins' : clusterMode ? 'auto' : 'country'}
            clustering={directPins ? false : clusterMode}
            clusterKey={mapKey}
            onFlagView={setFlagView}
            roleTagFor={specificOn ? baseRoles : undefined}
            onRegionChange={(r) => {
              if (clusterMode) setMapRegion(r);
              if (Date.now() > meGuardRef.current) setMeActive(false); // man drog i kartan → pilen blir kontur igen
              // Zooma ut tillräckligt → avmarkera flygplatsen automatiskt (flygplatskortet försvinner).
              // (Inte under Play: uppspelningen zoomar ut med flygplatsen vald.)
              if (focusAirport && Date.now() > playGuardRef.current && r.latitudeDelta > 2.5) setFocusAirport(null);
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
            fitTo={playOn && playCand && play.t >= PLAY_PRE - 0.15 ? {
              key: `play-${playCand.flight.id}`,
              pts: [playCand.dep, playCand.arr],
              padding: { top: insets.top + 8 + playCardH + 44, bottom: insets.bottom + 6 + playFlightH + 44, left: 56, right: 56 },
            } : null}
            ownCompass
            onHeading={(h) => setMapHeading(Math.round(h))}
            camCmd={camCmd}
            showsUser={!!userPos}
          >
            {playOn && playCand && <FlightReplayLayer r={playCand} t={play.t} pre={PLAY_PRE} playing={play.playing} labels />}
            {/* News: platserna i listan; vald post lyser (större prick med gloria). */}
            {newsOpen && newsPts.map((p) => {
              const sel = p.icao === newsSel;
              return (
                <Marker key={`news-${p.icao}`} coordinate={{ latitude: p.lat, longitude: p.lon }} anchor={{ x: 0.5, y: 0.5 }}
                  tracksViewChanges={false} zIndex={sel ? 30 : 20} onPress={() => setNewsSel(sel ? null : p.icao)}>
                  <View style={{ width: 26, height: 26, alignItems: 'center', justifyContent: 'center' }}>
                    <View style={{ position: 'absolute', width: sel ? 26 : 0, height: sel ? 26 : 0, borderRadius: 13, backgroundColor: 'rgba(255,176,32,0.25)' }} />
                    <View style={{ width: sel ? 13 : 10, height: sel ? 13 : 10, borderRadius: 7, backgroundColor: '#FFB020', borderWidth: 1.5, borderColor: '#0A1628' }} />
                  </View>
                </Marker>
              );
            })}
          </GlobalAirportMap>
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

        {/* Land-sökruta: öppnas efter att en väderkategori valts. Progressiv (engelska) landsträffar.
            OVERLAY (ej nästlad Modal) → ingen native modal ovanpå MapView:n (undviker iOS-kart-frysning). */}
        {countryPickerFor != null && (
          <View style={[StyleSheet.absoluteFill, { zIndex: 60 }]}>
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
          </View>
        )}

        {/* Datakälla / friskrivning — OVERLAY på rot-nivå (ej nästlad Modal → ingen iOS-kart-frysning). */}
        {dataInfoOpen && (
          <View style={[StyleSheet.absoluteFill, { zIndex: 60 }]}>
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
                  Airport locations, types, runways, frequencies and other details are compiled from public, open-data aviation sources (including airportmap.de and OurAirports).
                </Text>
                <Text style={{ color: Colors.textSecondary, fontSize: 13.5, lineHeight: 20, marginTop: 10 }}>
                  <Text style={{ color: Colors.textPrimary, fontWeight: '700' }}>Last updated: </Text>{AIRPORT_DATA_UPDATED}
                </Text>
                <Text style={{ color: Colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 14 }}>
                  This data is provided for general reference only and may be incomplete, outdated or inaccurate. It is not for navigation. Always verify against official aeronautical information (AIP/NOTAM) and current charts before flight. Blades accepts no liability for any errors or omissions.
                </Text>
              </TouchableOpacity>
            </TouchableOpacity>
          </View>
        )}

        {/* Stäng — uppe till höger */}
        {!playOn && !focusAirport && <TouchableOpacity onPress={closeMap} activeOpacity={0.8}
          style={{ position: 'absolute', top: insets.top + 12, right: 12, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(15,22,38,0.9)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="close" size={22} color="#fff" />
        </TouchableOpacity>}

        {/* Tillbaka — vid flygplatsfokus uppe till vänster (som förr); annars (utan fokus) nere till vänster
            så filtermodulen kan ligga kvar upptill utan krock. */}
        {showBack && !playOn && !focusAirport && (
          <TouchableOpacity onPress={goBack} activeOpacity={0.85}
            style={[{ position: 'absolute', zIndex: 25, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(15,22,38,0.92)', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: Colors.primary + '66' },
              { bottom: 24, left: 12 }]}>
            <Ionicons name="chevron-back" size={16} color={Colors.primary} />
            <Text style={{ color: Colors.primary, fontSize: 13, fontWeight: '700' }}>Back</Text>
          </TouchableOpacity>
        )}

        {/* Flygplatsvyn: överst Back · Fly to · Coordinates i en rad (lika breda, vit text). Coordinates öppnar
            systemlistan; när man valt ett system visas koordinaterna centrerade under knapparna (tryck = kopiera).
            Ingen Map/Satellite-knapp här (2026-11-18, användarens val). */}
        {focusAirport && !flyTo && !playOn && (() => {
          const coord = formatCoord(focusAirport[4], focusAirport[5], coordSys);
          const sysName = COORD_SYSTEMS.find((c) => c.id === coordSys)?.name ?? 'MGRS';
          return (
            <View style={{ position: 'absolute', zIndex: 25, top: insets.top + 12, left: 12, right: 12, gap: 8 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <TouchableOpacity onPress={goBack} activeOpacity={0.85} style={[styles.focusBtn, styles.topBtn]} accessibilityRole="button">
                  <Ionicons name="chevron-back" size={16} color="#fff" />
                  <Text style={styles.topBtnTxt} numberOfLines={1}>Back</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={openFlyTo} activeOpacity={0.85} style={[styles.focusBtn, styles.topBtn, { flex: 1.25 }]} accessibilityRole="button">
                  <Ionicons name="navigate" size={15} color="#fff" />
                  <Text style={styles.topBtnTxt} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>Fly to {focusAirport[0]}</Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={() => setCoordListOpen((o) => !o)} activeOpacity={0.85} style={[styles.focusBtn, styles.topBtn, { flex: 1.35 }]}
                  accessibilityRole="button" accessibilityLabel="Coordinates" accessibilityState={{ expanded: coordListOpen }}>
                  <Ionicons name="locate" size={15} color="#fff" />
                  <Text style={styles.topBtnTxt} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>Coordinates</Text>
                  <Ionicons name={coordListOpen ? 'chevron-up' : 'chevron-down'} size={12} color="#fff" />
                </TouchableOpacity>
              </View>
              {!coordListOpen && focusInfo && (
                <TouchableOpacity onPress={() => setInfoOpen((o) => !o)} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Aerodrome info"
                  accessibilityState={{ selected: infoOpen }} style={[styles.infoBtn, infoOpen && { borderColor: Colors.primary, backgroundColor: Colors.primary + '38' }]}>
                  <Ionicons name="information-circle-outline" size={15} color={Colors.primary} />
                  <Text style={styles.topBtnTxt}>AD info</Text>
                </TouchableOpacity>
              )}
              {coordListOpen && (
                <View style={[styles.coordList, { alignSelf: 'flex-end' }]}>
                  {COORD_SYSTEMS.map((c, i) => {
                    const on = coordShown && c.id === coordSys;
                    const sample = formatCoord(focusAirport[4], focusAirport[5], c.id);
                    return (
                      <TouchableOpacity key={c.id} onPress={() => pickCoordSys(c.id)} activeOpacity={0.7} disabled={!sample}
                        style={[styles.coordOpt, i > 0 && { borderTopWidth: 1, borderTopColor: Colors.primary + '24' }, !sample && { opacity: 0.4 }]}
                        accessibilityRole="button" accessibilityState={{ selected: on }}>
                        <Text style={[styles.coordTxt, { width: 56, fontWeight: '800', color: on ? Colors.primary : '#fff' }]}>{c.name}</Text>
                        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                          <Text style={{ fontSize: 12, color: '#A9C3DB' }}>{c.desc}</Text>
                          <Text numberOfLines={1} style={{ fontFamily: 'JetBrainsMono', fontSize: 11, color: '#8FB0CC' }}>{sample ?? 'Not available this far north or south'}</Text>
                        </View>
                        {on && <Ionicons name="checkmark" size={16} color={Colors.primary} />}
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
              {coordShown && !coordListOpen && coord && (
                <TouchableOpacity onPress={() => copyCoord(coord)} activeOpacity={0.8} style={[styles.coordBox, { alignSelf: 'center', gap: 10, maxWidth: '100%' }]}
                  accessibilityRole="button" accessibilityLabel={`Copy coordinates ${coord}`}>
                  <Text style={[styles.coordTxt, { color: Colors.primary, fontWeight: '800', fontSize: 11 }]}>{sysName}</Text>
                  <Text style={[styles.coordTxt, { flexShrink: 1 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{coord}</Text>
                  {coordCopied ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                      <Ionicons name="checkmark" size={14} color={Colors.success} />
                      <Text style={{ color: Colors.success, fontSize: 11, fontWeight: '700' }}>Copied</Text>
                    </View>
                  ) : <Ionicons name="copy-outline" size={15} color="#8FB0CC" />}
                </TouchableOpacity>
              )}
            </View>
          );
        })()}

        {/* Landruta vid flygplatsfokus: uppe (mellan Back och X, som förr). */}
        {focusAirport && countryCardEl && !playOn && (
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
                {/* Gruppknapparna: ett tryck öppnar gruppens panel (All + undertyper); knappen lyser när något är valt. */}
                {/* Swipebar rad (som förut): varje knapp är lika bred som sitt namn, så hela namnet syns. */}
                <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
                  contentContainerStyle={styles.groupRow}>
                  {FILTER_GROUPS.map((g) => {
                    const on = groupOn(g), open = openSection === `g:${g.key}`;
                    return (
                      <TouchableOpacity key={g.key} onPress={() => toggleSection(`g:${g.key}`)} activeOpacity={0.85}
                        accessibilityRole="button" accessibilityState={{ selected: on, expanded: open }}
                        style={[styles.typeChip, on && styles.typeChipOn, open && !on && styles.propsToggleActive]}>
                        <Text style={[styles.typeChipTxt, on && styles.typeChipTxtOn]} numberOfLines={1}>{g.label}</Text>
                        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={9} color={on ? '#062024' : '#fff'} />
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
                    <Text style={[styles.propsToggleTxt, accessCount > 0 && { color: Colors.primary }]}>{accessCount ? `Access · ${accessCount}` : 'Access'}</Text>
                    <Ionicons name={openSection === 'access' ? 'chevron-up' : 'chevron-down'} size={12} color="#fff" />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={toggleFavMode} activeOpacity={0.85} style={[styles.favBtn, favMode && styles.favBtnOn]}>
                    <Ionicons name={favMode ? 'star' : 'star-outline'} size={10} color={favMode ? '#062024' : Colors.gold} />
                    <Text style={[styles.favBtnTxt, favMode && { color: '#062024' }]}>Favorites{favorites.size ? ` · ${favorites.size}` : ''}</Text>
                  </TouchableOpacity>
                  {anyFilterOn && (
                    <TouchableOpacity onPress={clearAll} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Clear all filters" style={styles.clearBtn}>
                      <Ionicons name="close" size={10} color="#FF8A6B" />
                      <Text style={styles.clearBtnTxt}>Clear</Text>
                    </TouchableOpacity>
                  )}
                  {/* Info om datakälla + senast uppdaterad + friskrivning */}
                  <TouchableOpacity onPress={() => setDataInfoOpen(true)} activeOpacity={0.7} hitSlop={8}
                    style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="information-circle-outline" size={18} color={Colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                {openGroup && openGroup.key === 'airbases' && specificPage && typesPage && (() => {
                  /* Specific → Types: kategorierna (bara namn) som fällbara rader; modellfamiljerna med kort beskrivning
                     och antal baser, flest först. Flerval, även över kategorier. Sökfältet söker i alla. */
                  const fams = typeFamilies();
                  const q = typeQuery.trim().toLowerCase();
                  // När man skriver: förslagslista (namn som börjar så först) i stället för kategorierna
                  const suggestions = q ? suggestFamilies(typeQuery) : [];
                  const shown = fams;
                  const selBases = typedSeed.length;
                  return (
                    <View style={styles.propsPanel}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                        <TouchableOpacity onPress={() => setTypesPage(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back to Specific"
                          style={{ width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                          <Ionicons name="chevron-back" size={16} color="#fff" />
                        </TouchableOpacity>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>Types</Text>
                          <Text style={{ color: '#9DB4CC', fontSize: 11.5 }}>Bases with the models you pick</Text>
                        </View>
                      </View>
                      <View style={styles.typeSearch}>
                        <Ionicons name="search" size={14} color={Colors.textMuted} />
                        <TextInput value={typeQuery} onChangeText={setTypeQuery} placeholder="Search model, e.g. Su-57" placeholderTextColor="#6F89A6"
                          autoCorrect={false} autoCapitalize="none" style={{ flex: 1, color: '#fff', fontSize: 13, paddingVertical: 0 }} />
                        {!!typeQuery && (
                          <TouchableOpacity onPress={() => setTypeQuery('')} hitSlop={8} accessibilityLabel="Clear search"><Ionicons name="close-circle" size={15} color={Colors.textMuted} /></TouchableOpacity>
                        )}
                      </View>
                      {!!q && (
                        <View style={styles.suggestBox}>
                          {suggestions.map((f) => {
                            const on = typeSel.has(f.name);
                            return (
                              <TouchableOpacity key={f.name} onPress={() => { pickType(f.name); setTypeQuery(''); Keyboard.dismiss(); }} activeOpacity={0.7}
                                accessibilityRole="button" accessibilityLabel={`${f.name}, ${f.desc}, ${f.bases} bases`} style={styles.suggestRow}>
                                <Ionicons name={on ? 'checkmark-circle' : 'add-circle-outline'} size={17} color={on ? Colors.primary : Colors.textMuted} />
                                <View style={{ flex: 1 }}>
                                  <Text style={{ color: '#fff', fontSize: 13.5, fontWeight: '700' }}>{f.name}</Text>
                                  {!!f.desc && <Text style={{ color: '#8FB0CC', fontSize: 11 }} numberOfLines={1}>{f.desc}</Text>}
                                </View>
                                <Text style={styles.groupOptCount}>{f.bases}</Text>
                              </TouchableOpacity>
                            );
                          })}
                          {!suggestions.length && <Text style={{ color: '#8FB0CC', fontSize: 12.5, padding: 10 }}>{fams.length ? `No model matches “${typeQuery}”.` : 'Loading models…'}</Text>}
                        </View>
                      )}
                      {!q && <ScrollView style={{ maxHeight: 330 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
                        {ROLE_ORDER.map((role) => {
                          const list = shown.filter((f) => f.role === role);
                          if (!list.length) return null;
                          const open = typeRole === role;
                          const picked = list.filter((f) => typeSel.has(f.name)).length;
                          return (
                            <View key={role} style={styles.propRow}>
                              <TouchableOpacity onPress={() => setTypeRole(open ? null : role)} activeOpacity={0.7} accessibilityRole="button" accessibilityState={{ expanded: open }} style={styles.propRowHead}>
                                <Text style={styles.propRowLabel}>{ROLES[role].label}</Text>
                                {picked > 0 && <Text style={{ color: Colors.primary, fontSize: 11, fontWeight: '700' }}>{picked} picked</Text>}
                                <Text style={styles.groupOptCount}>{list.length}</Text>
                                <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={Colors.textMuted} />
                              </TouchableOpacity>
                              {open && list.map((f) => {
                                const on = typeSel.has(f.name);
                                return (
                                  <TouchableOpacity key={f.name} onPress={() => pickType(f.name)} activeOpacity={0.7} accessibilityRole="checkbox" accessibilityState={{ checked: on }}
                                    style={[styles.typeRow, on && { backgroundColor: Colors.primary + '1f' }]}>
                                    <View style={[styles.typeBox, on && { backgroundColor: Colors.primary, borderColor: Colors.primary }]}>
                                      {on && <Ionicons name="checkmark" size={12} color="#050B16" />}
                                    </View>
                                    <View style={{ flex: 1 }}>
                                      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>{f.name}</Text>
                                      {!!f.desc && <Text style={{ color: '#8FB0CC', fontSize: 11 }} numberOfLines={1}>{f.desc}</Text>}
                                    </View>
                                    <Text style={styles.groupOptCount}>{f.bases}</Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          );
                        })}
                        {!shown.length && <Text style={{ color: '#8FB0CC', fontSize: 12.5, paddingVertical: 12 }}>Loading models…</Text>}
                      </ScrollView>}
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10 }}>
                        <Text style={{ color: '#C9D6E6', fontSize: 12.5, flexShrink: 1 }} numberOfLines={1}>
                          {typeSel.size ? `${[...typeSel].join(', ')} · ${selBases} base${selBases === 1 ? '' : 's'}` : 'No model picked'}
                        </Text>
                        {typeSel.size > 0 && (
                          <TouchableOpacity onPress={() => setTypeSel(new Set())} hitSlop={10} accessibilityRole="button">
                            <Text style={{ color: Colors.primary, fontSize: 12.5, fontWeight: '700' }}>Clear</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  );
                })()}

                {openGroup && openGroup.key === 'airbases' && specificPage && !typesPage && (
                  /* Air Bases → Specific: nästa sida i samma ruta — välj roll; baserna ritas då med rollsymboler. */
                  <View style={styles.propsPanel}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                      <TouchableOpacity onPress={() => setSpecificPage(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back to Air Bases"
                        style={{ width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="chevron-back" size={16} color="#fff" />
                      </TouchableOpacity>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>Specific</Text>
                        <Text style={{ color: '#9DB4CC', fontSize: 11.5 }}>
                          {osintStatus === 'unavailable' ? 'Not available in your region'
                            : !osintVersion ? (osintStatus === 'error' ? 'Could not load the bases. Check your connection.' : 'Loading bases…')
                            : `${milCounts().all.toLocaleString('en-US')} bases · by aircraft`}
                        </Text>
                      </View>
                      <TouchableOpacity onPress={() => setLayerInfoOpen(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel="About this layer">
                        <Ionicons name="information-circle-outline" size={20} color={Colors.textSecondary} />
                      </TouchableOpacity>
                    </View>
                    <View style={styles.groupOpts}>
                      {!!osintVersion && SPECIFIC_NODES.map((n) => {
                        const on = activeKeys.has(n.key);
                        return (
                          <TouchableOpacity key={n.key} onPress={() => pickSpecific(n.key)} activeOpacity={0.7}
                            accessibilityRole="button" accessibilityState={{ selected: on }}
                            style={[styles.groupOpt, { justifyContent: 'flex-start' }, on && styles.propPillOn]}>
                            {n.role && <RoleTag role={n.role} />}
                            <Text style={[styles.propPillTxt, { flex: 1, flexShrink: 1, lineHeight: 15 }, on && { color: Colors.primary }]} numberOfLines={2}>{n.label}</Text>
                            <Text style={[styles.groupOptCount, on && { color: Colors.primary }]}>{(n.role ? milCounts().roles[n.role] : milCounts().all).toLocaleString('en-US')}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    {!!osintVersion && (
                      <TouchableOpacity onPress={() => setTypesPage(true)} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="Types: pick single aircraft models"
                        style={[styles.typesBtn, typeSel.size > 0 && styles.propPillOn]}>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.propPillTxt, { fontSize: 13.5 }, typeSel.size > 0 && { color: Colors.primary }]}>Types</Text>
                          <Text style={{ color: '#9DB4CC', fontSize: 11 }} numberOfLines={1}>
                            {typeSel.size ? [...typeSel].join(', ') : 'Pick single aircraft models'}
                          </Text>
                        </View>
                        <Text style={styles.groupOptCount}>{new Set(typeFamilies().map((f) => f.name)).size.toLocaleString('en-US')}</Text>
                        <Ionicons name="chevron-forward" size={14} color="#fff" />
                      </TouchableOpacity>
                    )}
                    <Text style={styles.groupInfo}>Each base is marked with the symbol of its aircraft. Tap one to see the units and the types based there. From open sources; can be out of date.</Text>
                  </View>
                )}

                {openGroup && !(openGroup.key === 'airbases' && specificPage) && (
                  <View style={styles.propsPanel}>
                    <View style={styles.groupOpts}>
                      {[openGroup.all, ...openGroup.subs].map((n) => {
                        const isAll = n.key === openGroup.all.key;
                        const on = activeKeys.has(n.key);
                        const cnt = groupCounts?.[n.key] ?? 0;
                        if (!isAll && cnt === 0) return null; // tomma undertyper visas inte
                        return (
                          <TouchableOpacity key={n.key} onPress={() => (isAll ? pickGroupAll(openGroup) : pickGroupSub(openGroup, n.key))} activeOpacity={0.7}
                            accessibilityRole="button" accessibilityState={{ selected: on }}
                            style={[styles.groupOpt, on && styles.propPillOn]}>
                            <Text style={[styles.propPillTxt, { flexShrink: 1, lineHeight: 15 }, on && { color: Colors.primary }]} numberOfLines={2}>{n.label}</Text>
                            <Text style={[styles.groupOptCount, on && { color: Colors.primary }]}>{cnt.toLocaleString('en-US')}</Text>
                          </TouchableOpacity>
                        );
                      })}
                      {openGroup.key === 'airbases' && (
                        <TouchableOpacity onPress={() => setSpecificPage(true)} activeOpacity={0.7} accessibilityRole="button"
                          accessibilityLabel="Specific: military air bases by aircraft" accessibilityState={{ selected: specificOn }}
                          style={[styles.groupOpt, { justifyContent: 'flex-start', borderColor: specificOn ? Colors.primary : Colors.primary + '73' }, specificOn && styles.propPillOn]}>
                          <View style={{ flexDirection: 'row' }}>
                            {(['fighter', 'bomber', 'heli'] as const).map((r, i) => (
                              <View key={r} style={{ width: 11, height: 11, borderRadius: 3.5, borderWidth: 1.5, borderColor: ROLES[r].color, backgroundColor: '#0F1A2E', marginLeft: i ? -4 : 0 }} />
                            ))}
                          </View>
                          <Text style={[styles.propPillTxt, { flex: 1 }, specificOn && { color: Colors.primary }]} numberOfLines={1}>Specific</Text>
                          {specificChosen.length > 0 && (
                            <Text style={{ color: Colors.primary, fontSize: 10.5, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>
                              {specificChosen.length === 1 ? specificChosen[0].label : `${specificChosen.length} roles`}
                            </Text>
                          )}
                          <Ionicons name="chevron-forward" size={13} color={specificOn ? Colors.primary : '#fff'} />
                        </TouchableOpacity>
                      )}
                    </View>
                    <Text style={styles.groupInfo}>{openGroup.info}</Text>
                  </View>
                )}

                {/* Datakälla/friskrivning visas som overlay på rot-nivå (längre ned) — ej nästlad Modal. */}

                {propsOpen && (
                  <View style={[styles.propsPanel, { paddingTop: 2, paddingBottom: 10 }]}>
                    {([
                      { k: 'rwy', label: 'Runway length', value: rwyLabel, on: mapProps.minLenM != null,
                        opts: RWY_STEPS.map((v) => ({ key: String(v), t: v == null ? 'Any' : `${v.toLocaleString('en-US')} m+`, on: mapProps.minLenM === v || (v == null && mapProps.minLenM == null),
                          pick: () => setMapProps((p) => ({ ...p, minLenM: v, maxLenM: null })) })) },
                      { k: 'alt', label: 'Elevation', value: altLabel, on: mapProps.minAltFt != null || mapProps.maxAltFt != null,
                        opts: ALT_STEPS.map((a) => ({ key: a.label, t: a.label, on: a.min === mapProps.minAltFt && a.max === mapProps.maxAltFt,
                          pick: () => setMapProps((p) => ({ ...p, minAltFt: a.min, maxAltFt: a.max })) })) },
                      { k: 'sfc', label: 'Surface', value: sfcLabel, on: mapProps.surface.length > 0,
                        opts: SURFACE_FILTERS.map((sfc) => ({ key: sfc, t: sfc, on: mapProps.surface.includes(sfc), pick: () => toggleSurface(sfc) })) },
                    ] as const).map((row) => {
                      const open = propRow === row.k;
                      return (
                        <View key={row.k} style={styles.propRow}>
                          <TouchableOpacity onPress={() => setPropRow(open ? null : row.k)} activeOpacity={0.7} accessibilityRole="button"
                            accessibilityState={{ expanded: open }} accessibilityLabel={`${row.label}: ${row.value}`} style={styles.propRowHead}>
                            <Text style={styles.propRowLabel}>{row.label}</Text>
                            <Text style={[styles.propRowValue, row.on && { color: Colors.primary }]} numberOfLines={1}>{row.value}</Text>
                            <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={Colors.textMuted} />
                          </TouchableOpacity>
                          {open && (
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingBottom: 12 }}>
                              {row.opts.map((o) => (
                                <TouchableOpacity key={o.key} onPress={o.pick} activeOpacity={0.7} accessibilityRole="button" accessibilityState={{ selected: o.on }}
                                  style={[styles.propStep, o.on && styles.propPillOn]}>
                                  <Text style={[styles.propPillTxt, o.on && { color: Colors.primary }]}>{o.t}</Text>
                                </TouchableOpacity>
                              ))}
                            </View>
                          )}
                        </View>
                      );
                    })}
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 10 }}>
                      <Text style={{ color: '#C9D6E6', fontSize: 12.5 }}>
                        <Text style={{ color: '#fff', fontWeight: '800', fontFamily: 'JetBrainsMono' }}>{typedSeed.length.toLocaleString('en-US')}</Text> airports match
                      </Text>
                      {propsActive(mapProps) && (
                        <TouchableOpacity onPress={() => setMapProps(EMPTY_PROPS)} hitSlop={10} activeOpacity={0.7} accessibilityRole="button">
                          <Text style={{ color: Colors.primary, fontSize: 12.5, fontWeight: '700' }}>Reset</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                )}

                {openSection === 'access' && (
                  // Access: vem som får använda flygplatsen + stängda flygplatser (Closed-knappen borttagen ur raden).
                  <View style={[styles.propsPanel, { gap: 14 }]}>
                    <View style={{ gap: 8 }}>
                      <Text style={styles.surfaceHead}>Who can use it</Text>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        {ACCESS_CHIPS.map((c) => {
                          const on = activeKeys.has(c.key);
                          return (
                            <TouchableOpacity key={c.key} onPress={() => toggleKey(c.key)} activeOpacity={0.7} accessibilityRole="button" accessibilityState={{ selected: on }}
                              style={[styles.propPill, on && styles.propPillOn]}>
                              <Text style={[styles.propPillTxt, { lineHeight: 15, textAlign: 'center' }, on && { color: Colors.primary }]} numberOfLines={2}>{c.label}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    </View>
                    <View style={{ gap: 8 }}>
                      <Text style={styles.surfaceHead}>Closed airports</Text>
                      <View style={styles.segment}>
                        {(['hide', 'include', 'only'] as const).map((m) => {
                          const on = closedMode === m;
                          return (
                            <TouchableOpacity key={m} onPress={() => setClosedMode(m)} activeOpacity={0.8} accessibilityRole="button" accessibilityState={{ selected: on }}
                              style={[styles.segmentBtn, on && { backgroundColor: Colors.primary }]}>
                              <Text style={[styles.propPillTxt, on && { color: '#050B16' }]}>{m === 'hide' ? 'Hide' : m === 'include' ? 'Also show' : 'Only closed'}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                      <Text style={{ color: '#8FB0CC', fontSize: 11.5 }}>
                        {closedMode === 'hide' ? 'Closed airports are hidden.' : closedMode === 'include' ? 'Closed airports are shown together with open ones.' : 'Only closed airports are shown.'}
                      </Text>
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
                      <Text style={styles.searchResultIcao}>{displayCode(r[0])}</Text>
                      <Text style={styles.searchResultName} numberOfLines={1}>{r[6] ? `${r[1]} · ${r[6]}` : r[1]}</Text>
                      <Ionicons name="location" size={13} color={Colors.textMuted} />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>
        )}

        {/* Kartknapparna nere till höger (Apple Kartor-stil): kompass (bara när kartan är vriden), News,
            kapsel med kartlager + min position. Döljs när ett flygplatskort eller News är öppet. */}
        {showMapCtrls && (
          <MapControlStack
            style={{ position: 'absolute', right: 16, bottom: insets.bottom + 16 }}
            heading={mapHeading}
            onNorth={() => setCamCmd({ key: `north-${Date.now()}`, kind: 'north' })}
            onNews={() => { setNewsSel(null); setNewsOpen(true); }}
            satellite={satellite}
            onToggleLayer={() => setSatellite((v) => !v)}
            meActive={meActive}
            meBusy={meBusy}
            locOff={locOff}
            onMe={goToMe}
            onOpenSettings={() => { setLocOff(false); Linking.openSettings(); }}
          />
        )}

        {/* Vald flygplats → infokort i botten */}
        {focusAirport && (() => {
          const lc = landingCounts[focusAirport[0]] ?? 0;
          const lf = lastFlightMap[focusAirport[0]];
          return (
            <View onLayout={(e) => setPlayCardH(e.nativeEvent.layout.height)}
              style={[{ position: 'absolute', left: 12, right: 12, zIndex: 15 }, playOn ? { top: insets.top + 8 } : { bottom: insets.bottom + 14 }]}>
              {infoOpen && !playOn && focusInfo && (
                <View style={{ marginBottom: 8 }}>
                  <AirportInfoPanel info={focusInfo} infoKey={focusAirport[0]} maxHeight={360} />
                </View>
              )}
              {specificOn && getMilBase(focusAirport[0]) ? (
                // Air Bases → Specific: förbandskortet ersätter flygplatskortet för baserna.
                <UnitCard
                  icao={focusAirport[0]}
                  base={getMilBase(focusAirport[0])!}
                  country={focusAirport[2]}
                  onClose={() => setFocusAirport(null)}
                  isFavorite={favorites.has(focusAirport[0])}
                  onToggleFavorite={() => toggleFavorite(focusAirport[0])}
                  onSource={() => setUnitSourceOpen(true)}
                  highlight={typeSel}
                />
              ) : (
              <AirportInfoCard
                icao={focusAirport[0]}
                name={focusAirport[1]}
                country={focusAirport[2]}
                iata={focusAirport[6]}
                alt={focusAirport[7]}
                type={focusAirport[8]}
                sub={focusAirport[12]}
                landingCount={lc > 0 ? lc : undefined}
                lastText={lf ? fmtVisit(lf.date) : undefined}
                onLastPress={lf ? () => setDetailFlightId(lf.id) : undefined}
                onClose={() => setFocusAirport(null)}
                onOpenMetar={setMetarPopup}
                isFavorite={favorites.has(focusAirport[0])}
                onToggleFavorite={() => toggleFavorite(focusAirport[0])}
                onPlay={playCand && playCand.icao === focusAirport[0] ? (playOn ? stopPlay : startPlay) : undefined}
                playing={playOn}
              />
              )}
            </View>
          );
        })()}

        {/* Play: det avskalade flygkortet längst ner */}
        {playOn && playCand && (
          <View pointerEvents="none" onLayout={(e) => setPlayFlightH(e.nativeEvent.layout.height)}
            style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + 6, zIndex: 16 }}>
            <LatestFlightCard flight={playCand.flight} accent={Colors.primary} placeNames={{}} onPress={() => {}} bare progress={replayProgress(play.t, PLAY_PRE)} caption={replayCaption(playCand)} />
          </View>
        )}

        {/* "Fly to XXXX" plan-overlay: flygplatskortet + bank-snippet med min position + rutt/distans/
            förbrukning. OVERLAY (ej nästlad Modal → ingen iOS-kart-frysning); nästan opak botten döljer
            huvudkartan. Ligger under flight-detaljen (zIndex 70) men över allt annat. Bakgrunden stänger inte
            (en zoomning utanför rutan kastade ut en) — bara krysset. */}
        {flyTo && focusAirport && (
          <View
            style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(3,8,18,0.94)', zIndex: 66, justifyContent: 'center', paddingHorizontal: 16, paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
            <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 440, alignSelf: 'center' }}>
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 10 }}>
                <AirportInfoCard
                  icao={focusAirport[0]}
                  name={focusAirport[1]}
                  country={focusAirport[2]}
                  iata={focusAirport[6]}
                  alt={focusAirport[7]}
                  type={focusAirport[8]}
                  sub={focusAirport[12]}
                  accent={Colors.primary}
                  onClose={closeFlyTo}
                  onMetar={setFlyToMetar}
                  onOpenMetar={setMetarPopup}
                  solid
                />
                <AirportNavPanel
                  icao={focusAirport[0]}
                  lat={focusAirport[4]}
                  lon={focusAirport[5]}
                  accent={Colors.primary}
                  frozen={flyToFrozen}
                  metar={flyToMetar}
                />
              </ScrollView>
            </Pressable>
          </View>
        )}

        {/* Förbandskortets Source-ruta: lager ovanpå kartan (ingen nästlad Modal). */}
        {layerInfoOpen && (
          // ⓘ för OSINT-lagret: texten ur användarens instruktion (avsnitt 6). Lager inne i kartvyn; stängs med krysset.
          <View style={[StyleSheet.absoluteFill, { zIndex: 85, backgroundColor: 'rgba(3,8,18,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 }]}>
            <View style={styles.layerInfoCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={{ flex: 1, color: '#fff', fontSize: 16, fontWeight: '800' }}>About this layer</Text>
                <TouchableOpacity onPress={() => setLayerInfoOpen(false)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" style={styles.layerInfoClose}>
                  <Ionicons name="close" size={17} color="#fff" />
                </TouchableOpacity>
              </View>
              <Text style={{ color: '#C9D6E6', fontSize: 13.5, lineHeight: 20 }}>{LAYER_INFO}</Text>
            </View>
          </View>
        )}
        {unitSourceOpen && focusAirport && <UnitSourcesPopup dataset={getMilBase(focusAirport[0])?.s ?? 'eu'} topInset={insets.top} onClose={() => setUnitSourceOpen(false)} />}

        {/* News (AI) — flygincidenter kopplade till flygplatser. Ligger överst; cachas i storen. */}
        <IncidentNewsOverlay
          visible={newsOpen}
          onClose={() => { setNewsOpen(false); setNewsSel(null); }}
          selectedIcao={newsSel}
          onSelect={setNewsSel}
          onViewOnMap={(icao) => { setNewsOpen(false); setCameFromNews(true); focusByIcao(icao); }}
          canLocate={(icao) => !!icao && seedData.some((r) => r[0] === icao)}
          onUpgrade={() => { setNewsOpen(false); paywallAfterClose('Flight incident news'); }}
        />

        {/* Flight-detalj som OVERLAY ovanpå kartan (ej nästlad Modal → ingen iOS-kart-frysning). Opak
            bakgrund täcker kartan helt; stäng återgår hit, kartans vy bevaras. */}
        {detailFlightId != null && (
          <View style={[StyleSheet.absoluteFill, { backgroundColor: Colors.background, paddingTop: insets.top, zIndex: 70 }]}>
            <FlightDetailView
              id={detailFlightId}
              onBack={() => setDetailFlightId(null)}
              // Kartan glider undan först: en Modal som stängs samtidigt som en ny skärm öppnas kan låsa iOS.
              onEdit={(fid) => { setDetailFlightId(null); closeMap(); setTimeout(() => router.push(`/flight/add?editId=${fid}` as any), 450); }}
            />
          </View>
        )}

        {/* METAR från flygplatskortet: overlay överst, ingen Modal ovanpå kartan (den slutar annars svara). */}
        {metarPopup && <WxMapPopup icao={metarPopup.icao} onClose={() => setMetarPopup(null)} />}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  infoBtn: { alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 14, borderRadius: 18, borderWidth: 1, borderColor: Colors.primary + '73', backgroundColor: 'rgba(10,22,40,0.92)' },
  suggestBox: { borderRadius: 10, borderWidth: 1, borderColor: 'rgba(0,200,232,0.25)', backgroundColor: 'rgba(5,11,22,0.6)', marginTop: 2, overflow: 'hidden' },
  suggestRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  typesBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 46, marginTop: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 10, borderWidth: 1, borderColor: Colors.primary + '8c', backgroundColor: Colors.primary + '0f' },
  typeSearch: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 36, paddingHorizontal: 10, borderRadius: 9, marginBottom: 4, backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  typeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 42, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  typeBox: { width: 18, height: 18, borderRadius: 5, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.3)', alignItems: 'center', justifyContent: 'center' },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'center', paddingHorizontal: 8, paddingVertical: 6, borderRadius: 7, borderWidth: 1, borderColor: 'rgba(255,107,74,0.6)', backgroundColor: 'rgba(40,16,14,0.95)' },
  clearBtnTxt: { color: '#FF8A6B', fontSize: 9, fontWeight: '800', letterSpacing: 0.2 },
  segment: { flexDirection: 'row', padding: 3, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.06)' },
  segmentBtn: { flex: 1, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  propRow: { borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  propRowHead: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 46 },
  propRowLabel: { flex: 1, color: '#fff', fontSize: 13.5, fontWeight: '700' },
  propRowValue: { color: Colors.textMuted, fontSize: 12.5, fontWeight: '700', maxWidth: '55%' },
  propStep: { height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  layerInfoCard: { width: '100%', maxWidth: 360, gap: 12, borderRadius: 16, padding: 16, backgroundColor: 'rgba(15,30,58,0.98)', borderWidth: 1, borderColor: Colors.primary + '55' },
  layerInfoClose: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  focusBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(15,22,38,0.92)', borderRadius: 10, paddingHorizontal: 10, height: 36, borderWidth: 1, borderColor: Colors.primary + '66' },
  focusBtnTxt: { color: Colors.primary, fontSize: 13, fontWeight: '700' },
  topBtn: { flex: 1, justifyContent: 'center', height: 40, paddingHorizontal: 8 },
  topBtnTxt: { color: '#fff', fontSize: 13, fontWeight: '700', flexShrink: 1 },
  coordBox: { flexDirection: 'row', alignItems: 'center', height: 38, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: Colors.primary + '55', backgroundColor: 'rgba(15,30,58,0.8)' },
  coordTxt: { fontFamily: 'JetBrainsMono', fontSize: 13, fontWeight: '700', color: '#fff', letterSpacing: 0.3 },
  coordList: { width: 300, maxWidth: '100%', borderRadius: 12, overflow: 'hidden', borderWidth: 1, borderColor: Colors.primary + '55', backgroundColor: 'rgba(15,30,58,0.97)' },
  coordOpt: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
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
  // Gruppknapparna + deras paneler (design 2026-11-19, artifact 6vxEJM7EKGBVrJi8vH8e3n): två kolumner, namn + antal.
  groupRow: { flexDirection: 'row', gap: 6, paddingRight: 4 },
  groupOpts: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 6 },
  // Långa namn (Training & test, Farm & ranch …) bryts på två rader i stället för att kapas → minHeight.
  groupOpt: { width: '49%', minHeight: 38, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 10, borderRadius: 9,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(255,255,255,0.05)' },
  groupOptCount: { fontFamily: 'JetBrainsMono', fontSize: 10.5, fontWeight: '600', color: Colors.textSecondary },
  groupInfo: { color: '#8FB0CC', fontSize: 11.5, lineHeight: 16, marginTop: 10 },
  typeChip: { height: 32, flexDirection: 'row', gap: 4, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderRadius: 7, backgroundColor: 'rgba(15,22,38,0.95)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  typeChipOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  typeChipTxt: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.2, textAlign: 'center' },
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
  surfaceHead: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.3 },
  surfaceChip: {
    width: '23.5%', alignItems: 'center', paddingVertical: 7, borderRadius: 8, gap: 1,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(255,255,255,0.05)',
  },
  surfaceCount: { fontFamily: 'JetBrainsMono', fontSize: 9.5, fontWeight: '600', color: Colors.textMuted },
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
