import { useState, useEffect, useMemo, type ReactNode } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet, FlatList, ScrollView,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { continentForCountry } from '../constants/continents';
import { CountryFlag } from './CountryFlag';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { getVisitedAirportIcaos, getVisitedAirportDates, getAirportLandingCounts, getAirportLastFlight } from '../db/flights';
import { getAirportCoordinates, getAllTemporaryPlaces, getSeedAirports } from '../db/icao';
import runwayData from '../assets/runways.json';
import { getRunways } from '../utils/runways';
import { topCountryThumb } from '../utils/thumbRegion';
import { AirportInfoCard, MetarPopup } from './AirportInfoCard';
import type { AirportMetar } from '../services/weather';
import { Colors } from '../constants/colors';
import { useFlightStore } from '../store/flightStore';
import { GlobalAirportMap } from './GlobalAirportMap';
import { RunwayDiagram } from './FlightShareCard';
import { usePlacedPlaces } from './PlacesToPinNotice';

// Region som ramar in en uppsättning punkter (för Apple-kartan).
function fitRegion(pts: { lat: number; lon: number }[]) {
  if (!pts.length) return { latitude: 20, longitude: 0, latitudeDelta: 120, longitudeDelta: 120 };
  let minLa = 90, maxLa = -90, minLo = 180, maxLo = -180;
  for (const p of pts) { minLa = Math.min(minLa, p.lat); maxLa = Math.max(maxLa, p.lat); minLo = Math.min(minLo, p.lon); maxLo = Math.max(maxLo, p.lon); }
  return {
    latitude: (minLa + maxLa) / 2,
    longitude: (minLo + maxLo) / 2,
    latitudeDelta: Math.max(2, Math.min(160, (maxLa - minLa) * 1.4 + 3)),
    longitudeDelta: Math.max(2, Math.min(330, (maxLo - minLo) * 1.4 + 3)),
  };
}

const countryNames: Record<string, string> = {
  US:'United States',BR:'Brazil',CA:'Canada',AU:'Australia',RU:'Russia',CL:'Chile',DE:'Germany',
  PG:'Papua New Guinea',ID:'Indonesia',FR:'France',VE:'Venezuela',ZA:'South Africa',CN:'China',
  EC:'Ecuador',KR:'South Korea',IN:'India',ES:'Spain',GB:'United Kingdom',CD:'DR Congo',NZ:'New Zealand',
  AR:'Argentina',NO:'Norway',BO:'Bolivia',SE:'Sweden',IT:'Italy',MX:'Mexico',PE:'Peru',CO:'Colombia',
  JP:'Japan',CZ:'Czechia',PL:'Poland',CR:'Costa Rica',BE:'Belgium',NL:'Netherlands',NA:'Namibia',
  HN:'Honduras',KE:'Kenya',AT:'Austria',PH:'Philippines',IR:'Iran',FI:'Finland',PT:'Portugal',
  PK:'Pakistan',ZW:'Zimbabwe',DK:'Denmark',TR:'Turkey',CH:'Switzerland',UA:'Ukraine',ZM:'Zambia',
  TZ:'Tanzania',HU:'Hungary',IS:'Iceland',BW:'Botswana',SA:'Saudi Arabia',MY:'Malaysia',GL:'Greenland',
  MM:'Myanmar',TH:'Thailand',MG:'Madagascar',GR:'Greece',DZ:'Algeria',EG:'Egypt',KZ:'Kazakhstan',
  BG:'Bulgaria',BS:'Bahamas',RO:'Romania',IE:'Ireland',PA:'Panama',NG:'Nigeria',UY:'Uruguay',
  ET:'Ethiopia',IL:'Israel',AE:'UAE',TW:'Taiwan',MN:'Mongolia',NP:'Nepal',
};

function getCountryName(code: string): string {
  return countryNames[code] || code;
}

// Banbeteckningar ur kursdata (number[] = magnetiska kurser). Ihop med reciprok →
// "07/25", dubbletter (reciproka) slås ihop.
const padRwy = (n: number) => String(n).padStart(2, '0');
const rwyNum = (h: number) => ((Math.round(h / 10) + 35) % 36) + 1;
function runwayPairs(headings: number[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of headings) {
    const a = rwyNum(h), b = rwyNum((h + 180) % 360);
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const key = `${lo}-${hi}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`${padRwy(lo)}/${padRwy(hi)}`);
  }
  return out;
}

function fmtVisit(d?: string): string {
  if (!d) return '—';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y.slice(-2)}`;
}

type SeedRow = [string, string, string, string, number, number, string?, (number | null)?, string?, string?, string?, string?];

function buildCountryList(data: SeedRow[]) {
  const map = new Map<string, number>();
  for (const [, , country] of data) map.set(country, (map.get(country) ?? 0) + 1);
  return Array.from(map.entries())
    .map(([code, count]) => ({ code, name: getCountryName(code), count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

type AirportPoint = { icao: string; name: string; lat: number; lon: number; temporary?: boolean; visitDate?: string };

// Hämta alla unika besökta ICAO-koder direkt från flygningarna
async function getAllVisitedIcaos(): Promise<string[]> {
  const icaos = await getVisitedAirportIcaos();
  return [...new Set(icaos)].filter(Boolean);
}

function makeStyles() {
  return StyleSheet.create({
    widget: {
      backgroundColor: Colors.card,
      borderRadius: 12,
      padding: 12,
      borderWidth: 1,
      borderColor: Colors.cardBorder,
      marginBottom: 8,
    },
    compactCard: {
      flex: 1,
      height: 168,
      backgroundColor: Colors.card,
      borderRadius: 12,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: Colors.cardBorder,
    },
    thumbLabel: {
      position: 'absolute', bottom: 0, left: 0, right: 0,
      paddingHorizontal: 10, paddingVertical: 6,
      backgroundColor: 'rgba(15,22,38,0.85)',
    },
    thumbLabelTxt: { color: '#fff', fontSize: 13, fontWeight: '800', textAlign: 'center' },
    thumbPin: {
      backgroundColor: 'rgba(15,22,38,0.9)', borderRadius: 3,
      paddingHorizontal: 3, paddingVertical: 1, borderWidth: 0.5, borderColor: Colors.info,
    },
    thumbPinTxt: { color: '#fff', fontSize: 6.5, fontWeight: '700', fontFamily: 'Menlo' },

    modal: {
      flex: 1,
      backgroundColor: '#000',
    },
    webview: {
      flex: 1,
    },
    closeBtn: {
      position: 'absolute',
      right: 16,
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(0,0,0,0.65)',
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 0.5,
      borderColor: 'rgba(255,255,255,0.2)',
    },
  });
}

// compact: kompakt knapp (halv bredd) för dashboard.
// rightSlot: element som renderas till höger om den kompakta knappen.
// asButton: liten pill-knapp (öppnar samma modal) — används i globens övre hörn på dashboarden.
export function AirportMapWidget({ compact = false, rightSlot, asButton = false }: { compact?: boolean; rightSlot?: ReactNode; asButton?: boolean } = {}) {
  const styles = makeStyles();
  const router = useRouter();
  const [airports, setAirports] = useState<AirportPoint[]>([]);
  const [allIcaos, setAllIcaos] = useState<string[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [selectedAirport, setSelectedAirport] = useState<string | null>(null);
  const [metarPopup, setMetarPopup] = useState<AirportMetar | null>(null); // väderrutan som overlay över kartan
  const [landingCounts, setLandingCounts] = useState<Record<string, number>>({});
  const [lastFlight, setLastFlight] = useState<Record<string, { id: number; date: string; reg: string }>>({});
  const [satellite, setSatellite] = useState(false); // kartläge (standard) förvalt
  const [period, setPeriod] = useState<'all' | 'year' | 'custom'>('all');
  const [customDate, setCustomDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [seedData, setSeedData] = useState<SeedRow[]>([]);
  const [countryList, setCountryList] = useState<{ code: string; name: string; count: number }[]>([]);
  const insets = useSafeAreaInsets();
  const { isPremium } = useFlightStore();

  const flightCount = useFlightStore((s) => s.flightCount);
  // En plats som fått position i "places to pin" (PlacesToPinNotice) → kartan läser om flygplatserna.
  const placedVersion = usePlacedPlaces((s) => s.version);

  useEffect(() => {
    getSeedAirports().then(data => { setSeedData(data); setCountryList(buildCountryList(data)); });
  }, []);

  useEffect(() => {
    (async () => {
      const icaos = await getAllVisitedIcaos();
      const tempPlaces = await getAllTemporaryPlaces();
      if (!icaos.length && !tempPlaces.length) {
        setAllIcaos([]);
        setAirports([]);
        return;
      }
      setAllIcaos([...icaos, ...tempPlaces.map(p => p.icao)]);
      const coords = await getAirportCoordinates(icaos);
      const visitDates = await getVisitedAirportDates();
      const regular = coords.filter(a => a.lat && a.lon).map(a => ({ ...a, temporary: false, visitDate: visitDates[a.icao] }));
      const temps = tempPlaces.map(p => ({ icao: p.icao, name: p.name, lat: p.lat, lon: p.lon, temporary: true, visitDate: visitDates[p.icao] }));
      setAirports([...regular, ...temps]);
      setLandingCounts(await getAirportLandingCounts());
      setLastFlight(await getAirportLastFlight());
    })();
  }, [flightCount, placedVersion]);

  // Period-filter: All time / This year / Custom (visitDate >= valt från-datum).
  const periodStart = useMemo(() => {
    if (period === 'year') return `${new Date().getFullYear()}-01-01`;
    if (period === 'custom' && customDate) return customDate.toISOString().slice(0, 10);
    return null;
  }, [period, customDate]);
  const periodAirports = useMemo(
    () => periodStart ? airports.filter((a) => a.visitDate && a.visitDate >= periodStart) : airports,
    [airports, periodStart],
  );
  const seedByIcao = useMemo(() => new Map(seedData.map((r) => [r[0], r] as const)), [seedData]);
  // Besökta (i perioden) som SeedRow [icao,name,country,region,lat,lon] för Apple-kartan.
  const visitedSeedRows: SeedRow[] = useMemo(() =>
    periodAirports.filter((a) => a.lat && a.lon && a.icao !== 'ZZZZ')
      .map((a) => { const s = seedByIcao.get(a.icao); return [a.icao, a.name, s ? s[2] : '', s ? s[3] : '', a.lat, a.lon] as SeedRow; }),
    [periodAirports, seedByIcao],
  );
  // Besökta länder (flest besökta flygplatser överst): flagga + visited/total.
  const countryStats = useMemo(() => {
    const totalByCode = new Map(countryList.map((c) => [c.code, c.count]));
    const visitedByCode = new Map<string, number>();
    for (const a of periodAirports) {
      const code = seedByIcao.get(a.icao)?.[2];
      if (!code) continue;
      visitedByCode.set(code, (visitedByCode.get(code) ?? 0) + 1);
    }
    return [...visitedByCode.entries()]
      .map(([code, visited]) => ({ code, name: getCountryName(code), visited, total: totalByCode.get(code) ?? visited }))
      .sort((a, b) => b.visited - a.visited);
  }, [periodAirports, seedByIcao, countryList]);

  // Thumbnail: centrera över kontinenten man landat mest på + små ICAO-pins där.
  const thumb = useMemo(() => topCountryThumb(visitedSeedRows), [visitedSeedRows]);

  if (!allIcaos.length) return null;

  // Kompakt header (halv bredd) — bara ikon + antal + etikett.
  const compactHeader = (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      <View style={styles.compactCard}>
        <MapView
          style={StyleSheet.absoluteFill}
          region={thumb.region}
          pointerEvents="none"
          scrollEnabled={false} zoomEnabled={false} rotateEnabled={false} pitchEnabled={false}
          userInterfaceStyle="dark"
          showsPointsOfInterests={false} showsCompass={false} toolbarEnabled={false}
        >
          {thumb.rows.slice(0, 18).map((r) => (
            <Marker key={r[0]} coordinate={{ latitude: r[4], longitude: r[5] }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
              <View style={styles.thumbPin}><Text style={styles.thumbPinTxt}>{r[0]}</Text></View>
            </Marker>
          ))}
        </MapView>
        <View style={styles.thumbLabel}><Text style={styles.thumbLabelTxt}>Visited airports</Text></View>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          onPress={() => airports.length > 0 && setModalVisible(true)}
          activeOpacity={airports.length > 0 ? 0.85 : 1}
        />
      </View>
      {rightSlot}
    </View>
  );

  // Rektangulärt val-kort (globens tap-meny på dashboarden) — öppnar samma modal.
  const buttonPill = (
    <TouchableOpacity
      onPress={() => airports.length > 0 && setModalVisible(true)}
      activeOpacity={airports.length > 0 ? 0.85 : 1}
      style={{ width: '100%', flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 14, backgroundColor: 'rgba(6,11,22,0.85)', borderWidth: 1, borderColor: Colors.info + '66' }}
    >
      <View style={{ width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.info + '22' }}>
        <Ionicons name="location" size={18} color={Colors.info} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: Colors.info, fontSize: 14, fontWeight: '800' }}>Visited airports</Text>
        <Text numberOfLines={1} style={{ color: 'rgba(255,255,255,0.72)', fontSize: 11, fontWeight: '500', marginTop: 1 }}>Airports you've landed at, mapped</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.5)" />
    </TouchableOpacity>
  );

  return (
    <>
      {asButton ? buttonPill : compact ? compactHeader : (
      /* Visited airports — MC1 style */
      <TouchableOpacity
        style={styles.widget}
        onPress={() => airports.length > 0 && setModalVisible(true)}
        activeOpacity={airports.length > 0 ? 0.75 : 1}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{
            width: 36, height: 36, borderRadius: 8,
            backgroundColor: Colors.info + '22',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <Ionicons name="location" size={16} color={Colors.info} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Text style={{
                fontSize: 9, fontWeight: '700', color: Colors.textMuted,
                letterSpacing: 1, fontFamily: 'Menlo',
              }}>VISITED AIRPORTS</Text>
              <Text style={{
                fontSize: 11, fontWeight: '800', color: Colors.info,
                fontFamily: 'Menlo', fontVariant: ['tabular-nums'],
              }}>{allIcaos.length}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
              {allIcaos.slice(0, 6).map(icao => (
                <View key={icao} style={{
                  paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
                  backgroundColor: Colors.info + '15',
                  borderWidth: 1, borderColor: Colors.info + '30',
                }}>
                  <Text style={{
                    fontSize: 10, fontWeight: '700', color: Colors.textPrimary,
                    fontFamily: 'Menlo', letterSpacing: 0.4,
                  }}>{icao}</Text>
                </View>
              ))}
              {allIcaos.length > 6 && (
                <Text style={{
                  fontSize: 10, fontWeight: '700', color: Colors.textMuted,
                  fontFamily: 'Menlo', paddingVertical: 2,
                }}>+{allIcaos.length - 6}</Text>
              )}
            </View>
          </View>
          <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
        </View>
      </TouchableOpacity>
      )}

      {/* Fullskärmskarta (Apple Maps) */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        onRequestClose={() => { setModalVisible(false); setSelectedCountry(null); setSelectedAirport(null); setMetarPopup(null); }}
      >
        <View style={styles.modal}>
          {(() => {
            // Centrera på den kontinent där flest besökta flygplatser ligger (i perioden) så
            // kartan inte zoomas ut mellan regioner långt isär. Land-val överstyr.
            let focusRows: SeedRow[];
            if (selectedCountry) {
              focusRows = visitedSeedRows.filter((r) => r[2] === selectedCountry);
            } else {
              const byCont = new Map<string, SeedRow[]>();
              for (const r of visitedSeedRows) {
                const cont = continentForCountry(r[2]) ?? '??';
                const arr = byCont.get(cont); if (arr) arr.push(r); else byCont.set(cont, [r]);
              }
              focusRows = visitedSeedRows;
              let bestN = -1;
              for (const arr of byCont.values()) if (arr.length > bestN) { bestN = arr.length; focusRows = arr; }
            }
            const region = fitRegion(focusRows.map((r) => ({ lat: r[4], lon: r[5] })));
            const dateKey = period === 'custom' && customDate ? customDate.toISOString().slice(0, 10) : period;
            return (
              <GlobalAirportMap
                key={`${dateKey}-${selectedCountry ?? 'all'}`}
                airports={visitedSeedRows}
                initialRegion={region}
                mode="pins"
                onSelectAirport={setSelectedAirport}
                selectedIcao={selectedAirport ?? undefined}
                mapType={satellite ? 'hybridFlyover' : 'standard'}
              />
            );
          })()}

          {/* Flygplats-detalj vid klick: ICAO-kort + banor + landningar + senaste besök */}
          {selectedAirport && (() => {
            const ic = selectedAirport;
            const ap = airports.find((a) => a.icao === ic);
            const count = landingCounts[ic] ?? 0;
            const lf = lastFlight[ic];
            return (
              <View style={{ position: 'absolute', top: insets.top + 56, left: 12, right: 12 }}>
                <AirportInfoCard
                  icao={ic}
                  name={ap?.name}
                  landingCount={count}
                  lastText={lf ? fmtVisit(lf.date) : fmtVisit(ap?.visitDate)}
                  // Kartan glider undan först: en Modal som stängs samtidigt som en ny skärm öppnas kan låsa iOS.
                  onLastPress={lf ? () => {
                    setModalVisible(false); setSelectedCountry(null); setSelectedAirport(null); setMetarPopup(null);
                    setTimeout(() => router.push(`/flight/detail/${lf.id}` as any), 450);
                  } : undefined}
                  onOpenMetar={setMetarPopup}
                  onClose={() => { setSelectedAirport(null); setMetarPopup(null); }}
                />
              </View>
            );
          })()}

          {/* Besökta länder — flest besökta överst, scrollbar (max ~5 synliga) */}
          {countryStats.length > 0 && (
            <View style={{
              position: 'absolute', bottom: 24, left: 16, width: 190, maxHeight: 5 * 34 + 8,
              backgroundColor: 'rgba(15,22,38,0.92)', borderRadius: 12,
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', overflow: 'hidden',
            }}>
              <ScrollView showsVerticalScrollIndicator={false}>
                {countryStats.map((c) => {
                  const active = selectedCountry === c.code;
                  return (
                    <TouchableOpacity
                      key={c.code}
                      onPress={() => { setSelectedAirport(null); setSelectedCountry((s) => s === c.code ? null : c.code); }}
                      activeOpacity={0.7}
                      style={{
                        flexDirection: 'row', alignItems: 'center', gap: 8,
                        paddingHorizontal: 10, height: 34,
                        backgroundColor: active ? Colors.primary + '33' : 'transparent',
                      }}
                    >
                      <CountryFlag code={c.code} height={14} />
                      <Text style={{ flex: 1, color: '#fff', fontSize: 12, fontWeight: '700' }} numberOfLines={1}>{c.name}</Text>
                      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{c.visited}/{c.total}</Text>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {/* Period-väljare (All time / This year / Custom) */}
          <View style={{
            position: 'absolute', top: insets.top + 12, left: 0, right: 64,
            alignItems: 'center', pointerEvents: 'box-none',
          }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {/* Period-pills */}
              <View style={{ flexDirection: 'row', backgroundColor: 'rgba(15,22,38,0.9)', borderRadius: 10, padding: 3, gap: 2 }}>
                {([['all', 'All time'], ['year', 'This year'], ['custom', 'Custom']] as const).map(([p, label]) => {
                  const active = period === p;
                  const text = p === 'custom' && period === 'custom' && customDate ? customDate.toISOString().slice(0, 10) : label;
                  return (
                    <TouchableOpacity
                      key={p}
                      onPress={() => { setSelectedAirport(null); if (p === 'custom') setShowDatePicker(true); else setPeriod(p); }}
                      activeOpacity={0.8}
                      style={{ paddingHorizontal: 11, paddingVertical: 6, borderRadius: 7, backgroundColor: active ? Colors.primary : 'transparent' }}
                    >
                      <Text style={{ color: active ? Colors.textInverse : '#fff', fontSize: 11, fontWeight: '700' }}>{text}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          </View>

          {/* Kartläge-växel: standard (default) ↔ satellit (hybrid) */}
          <TouchableOpacity
            onPress={() => setSatellite((s) => !s)}
            activeOpacity={0.8}
            style={{
              position: 'absolute', bottom: 24, right: 16, height: 36,
              flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12,
              borderRadius: 18, backgroundColor: 'rgba(15,22,38,0.9)',
              borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.2)',
            }}
          >
            <Ionicons name={satellite ? 'map' : 'globe'} size={15} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{satellite ? 'Map' : 'Satellite'}</Text>
          </TouchableOpacity>

          {/* Close button */}
          <TouchableOpacity
            style={[styles.closeBtn, { top: insets.top + 12 }]}
            onPress={() => { setModalVisible(false); setSelectedCountry(null); setSelectedAirport(null); setMetarPopup(null); }}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Ionicons name="close" size={20} color="#fff" />
          </TouchableOpacity>

          {/* METAR från flygplatskortet: overlay, ingen Modal ovanpå kartan (den slutar annars svara). */}
          {metarPopup && <MetarPopup metar={metarPopup} onClose={() => setMetarPopup(null)} />}
        </View>

        {/* Datum-väljare för Custom-period (från-datum fram till idag) */}
        {showDatePicker && (
          <View style={{
            position: 'absolute', left: 0, right: 0, bottom: 0,
            backgroundColor: Colors.card, paddingBottom: 24,
            borderTopLeftRadius: 16, borderTopRightRadius: 16,
            borderTopWidth: 1, borderColor: Colors.border,
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingVertical: 8 }}>
              <TouchableOpacity onPress={() => setShowDatePicker(false)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="checkmark" size={24} color={Colors.primary} />
              </TouchableOpacity>
            </View>
            <DateTimePicker
              value={customDate ?? new Date()}
              mode="date"
              display="spinner"
              maximumDate={new Date()}
              themeVariant="dark"
              onChange={(_e, d) => { if (d) { setCustomDate(d); setPeriod('custom'); } }}
            />
          </View>
        )}
      </Modal>

    </>
  );
}

