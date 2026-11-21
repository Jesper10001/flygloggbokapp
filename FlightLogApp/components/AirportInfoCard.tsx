// Delat flygplats-infokort (Global map, Visited airports, Find airport, "Fly to"). Samma stil som dashboardens
// flygkort men lågt och 20 % genomskinligt (kartan syns igenom):
//   rad 1: ICAO · namn (upp till två rader) · stjärna · stäng
//   rad 2: IATA · storlek (· land) · väder (VFR-märke + kort METAR, tryck → METAR-rutan), annars "No weather"
//   remsa: ELEV · bana (en: RUNWAY + LENGTH, flera: RUNWAYS + LONGEST) · SURFACE
//   tunna rader bara när de finns: frekvenserna (TWR först), egna landningar (tryck → flygningen)
// Väder: bara flygplatsens EGEN METAR. På kartorna (Visited airports, Global map) visar föräldern METAR-rutan som
// overlay (MetarPopup via onOpenMetar): en native Modal ovanpå kartans Modal gör att Apple-kartan slutar svara på iOS.
import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../constants/colors';
import { getAirportFreq } from '../constants/airportFreq';
import { getRunwayGeo } from '../constants/runwayGeo';
import { getRunways } from '../utils/runways';
import { COUNTRY_NAMES } from '../constants/countryNames';
import { fetchAirportMetar, categoryColor, type AirportMetar } from '../services/weather';
import { displayCode } from '../utils/airportCodes';

// Kortet är alltid mörkt (ligger på kartor), oavsett tema.
const MONO = 'JetBrainsMono';
const SERIF = 'Fraunces';
const SUB = '#A9C3DB';
const MUTED = '#8FB0CC';
const GOLD = '#FFB830';

// airportmap.de-typ → läsbar etikett.
const TYPE_LABEL: Record<string, string> = {
  large: 'Large', medium: 'Medium', small: 'Airfield', heliport: 'Heliport',
  seaplane: 'Seaplane', altiport: 'Altiport', balloonport: 'Balloonport', closed: 'Closed',
};

// Undertyp (SeedRow[12], se constants/mapFilters) → tydligare etikett än bara typen.
const SUB_LABEL: Record<string, string> = {
  hp: 'Helipad', os: 'Offshore helideck', gl: 'Gliding site', ul: 'Ultralight field', fr: 'Farm strip',
  ap: 'Airpark', ag: 'Ag strip', sk: 'Skydiving field', ic: 'Ice & snow runway', sp: 'Spaceport',
  bh: 'Beach landing', lc: 'Lodge strip', is: 'Island strip',
};
const subLabel = (sub?: string) => (sub ? sub.split(',').map((c) => SUB_LABEL[c]).find(Boolean) : undefined);

const fmtFreq = (v: number) => v.toFixed(3);
const fmtM = (m: number) => `${Math.round(m).toLocaleString('en-US')} m`;

export function AirportInfoCard({ icao, name, iata, alt, type, sub, country, accent = Colors.info, landingCount, lastText, onLastPress, onClose, isFavorite, onToggleFavorite, onMetar, onOpenMetar, solid = false, onPlay, playing = false, hideWxRow = false }: {
  icao: string;
  name?: string;
  country?: string | null;    // ISO alpha-2 landskod → landets namn på rad 2
  sub?: string;               // undertyper (SeedRow[12]), t.ex. 'hp' → "Helipad"
  iata?: string;              // IATA-kod (airportmap.de)
  alt?: number | null;        // elevation (ft)
  type?: string;              // airportmap.de-kategori
  accent?: string;
  landingCount?: number;      // undefined → ingen landningsrad (t.ex. flygplats man inte landat på)
  lastText?: string;
  onLastPress?: () => void;   // satt → landningsraden öppnar flygningen
  onClose: () => void;
  isFavorite?: boolean;       // om onToggleFavorite satt → stjärna bredvid stäng
  onToggleFavorite?: () => void;
  onMetar?: (m: AirportMetar | null) => void; // rapporterar hämtad METAR uppåt (t.ex. vind → aktiv bana i snippeten)
  onOpenMetar?: (m: AirportMetar) => void;    // satt → föräldern visar METAR-rutan (MetarPopup) i stället för en egen Modal
  hideWxRow?: boolean;        // Find airport: rad 2 (IATA · typ · väder) döljs — vädret visas via Weather-knappen på kartan
  onPlay?: () => void;        // satt → Play i landningsraden (Visited airports: spela upp senaste flygningen hit)
  playing?: boolean;          // uppspelningen pågår → knappen blir Stop (samma onPlay växlar)
  solid?: boolean;            // tät bakgrund (Find airport: kortet ligger inte på en karta utan bredvid täta paneler)
}) {
  const freq = getAirportFreq(icao);
  const freqs = freq ? ([
    ['TWR', freq.twr], ['GND', freq.gnd], ['ATIS', freq.atis], ['APP', freq.app],
  ] as const).filter(([, v]) => v != null) as unknown as [string, number][] : [];
  const runways = getRunwayGeo(icao);
  const longest = runways.reduce((a, r) => Math.max(a, r.lengthM || 0), 0);
  const countryName = country ? (COUNTRY_NAMES[country.toUpperCase()] ?? country.toUpperCase()) : '';

  // Egen METAR (ingen närmaste-fält-fallback).
  const [metar, setMetar] = useState<AirportMetar | null>(null);
  const [metarLoading, setMetarLoading] = useState(true);
  const [wxOpen, setWxOpen] = useState(false);
  const openMetar = () => {
    if (!metar) return;
    if (onOpenMetar) onOpenMetar(metar);
    else setWxOpen(true);
  };
  useEffect(() => {
    let alive = true;
    setMetar(null); setWxOpen(false); setMetarLoading(true);
    onMetar?.(null); // nollställ tills ny hämtats (t.ex. banhighlight)
    fetchAirportMetar(icao)
      .then((r) => { if (alive) { setMetar(r); setMetarLoading(false); onMetar?.(r); } })
      .catch(() => { if (alive) { setMetarLoading(false); onMetar?.(null); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [icao]);

  // Rad 2: med väder får vädret platsen (landet utelämnas), annars står landet med.
  const meta = [iata || null, type ? (subLabel(sub) || TYPE_LABEL[type] || type) : null, !metar ? countryName || null : null].filter(Boolean).join(' · ');

  // Remsan: högst fyra celler, bara det som finns.
  const cells: { label: string; value: string; freq?: boolean }[] = [];
  if (alt != null) cells.push({ label: 'ELEV', value: `${alt} ft` });
  if (runways.length === 1) {
    cells.push({ label: 'RUNWAY', value: `${runways[0].leIdent}/${runways[0].heIdent}` });
    if (longest > 0) cells.push({ label: 'LENGTH', value: fmtM(longest) });
  } else if (runways.length > 1) {
    cells.push({ label: 'RUNWAYS', value: String(runways.length) });
    if (longest > 0) cells.push({ label: 'LONGEST', value: fmtM(longest) });
  }
  // Ytan (OurAirports, öppna banor): en eller flera, t.ex. "Asphalt" eller "Asphalt/Grass".
  const surfaces = [...new Set(getRunways(icao).filter((r) => !r.closed && r.surface).map((r) => r.surface))];
  if (surfaces.length) cells.push({ label: 'SURFACE', value: surfaces.slice(0, 2).join('/') + (surfaces.length > 2 ? '…' : '') });
  // Alla frekvenser på raden under remsan, TWR först.
  const moreFreqs = freqs;
  const showLandings = landingCount !== undefined;
  const line = accent + '33';

  return (
    <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: accent + '55' }}>
      <LinearGradient colors={solid ? ['rgba(18,48,74,0.97)', 'rgba(15,30,58,0.97)'] : ['rgba(18,48,74,0.8)', 'rgba(15,30,58,0.8)']} locations={[0, 0.55]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />

      {/* Rad 1: ICAO · namn · stjärna · stäng */}
      {/* Långa namn (var fjärde flygplats) får två rader bredvid koden i stället för att kapas (alternativ A, 2026-11-19). */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingLeft: 14, paddingRight: 10, paddingTop: 10, paddingBottom: 2 }}>
        <Text style={{ fontFamily: MONO, fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: 1, color: accent }}>{displayCode(icao)}</Text>
        <Text style={{ flex: 1, fontFamily: SERIF, fontSize: 16, lineHeight: 20, paddingTop: 3, fontWeight: '600', color: '#FFFFFF' }} numberOfLines={2}>{name || ''}</Text>
        {onToggleFavorite && (
          <TouchableOpacity onPress={onToggleFavorite} hitSlop={6} accessibilityRole="button" accessibilityLabel={isFavorite ? 'Remove from favourites' : 'Add to favourites'}
            style={[s.btn, isFavorite && { backgroundColor: Colors.gold + '2e', borderColor: Colors.gold }]}>
            <Ionicons name={isFavorite ? 'star' : 'star-outline'} size={16} color={isFavorite ? Colors.gold : '#fff'} />
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={onClose} hitSlop={6} accessibilityRole="button" accessibilityLabel="Close" style={s.btn}>
          <Ionicons name="close" size={18} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Rad 2: IATA · storlek (· land) · väder */}
      {!hideWxRow && (
      <TouchableOpacity onPress={openMetar} disabled={!metar} activeOpacity={0.7} accessibilityRole={metar ? 'button' : undefined}
        accessibilityLabel={metar ? `Weather at ${icao}: ${metar.brief}` : undefined}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 14, paddingBottom: 10 }}>
        {!!meta && <Text style={{ fontFamily: MONO, fontSize: 11, color: SUB, flexShrink: 0 }} numberOfLines={1}>{meta}</Text>}
        {!!meta && <Text style={{ color: '#3A5A7A', fontSize: 12 }}>·</Text>}
        {metarLoading ? (
          <Text style={{ flex: 1, fontSize: 12, color: MUTED }} numberOfLines={1}>Fetching weather…</Text>
        ) : metar ? (
          <>
            {metar.category && (
              <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, backgroundColor: categoryColor(metar.category) + '26' }}>
                <Text style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: '800', letterSpacing: 0.5, color: categoryColor(metar.category) }}>{metar.category}</Text>
              </View>
            )}
            <Text style={{ flex: 1, fontSize: 12, color: '#CFE3F3' }} numberOfLines={1}>{metar.brief.replace(/\s+·\s+/g, ' · ')}</Text>
            <Ionicons name="chevron-forward" size={14} color={accent} />
          </>
        ) : (
          <Text style={{ flex: 1, fontSize: 12, color: MUTED }} numberOfLines={1}>No weather</Text>
        )}
      </TouchableOpacity>
      )}

      {/* Remsan */}
      {cells.length > 0 && (
        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: line }}>
          {cells.map((c, i) => (
            <View key={c.label} style={[{ flex: 1, minWidth: 0, gap: 3, paddingVertical: 8, paddingHorizontal: 10 }, i > 0 && { borderLeftWidth: 1, borderLeftColor: line }]}>
              <Text style={{ fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1.2, color: c.freq ? MUTED : GOLD }}>{c.label}</Text>
              <Text style={{ fontFamily: MONO, fontSize: 12.5, fontWeight: '700', color: c.freq ? accent : '#FFFFFF' }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75}>{c.value}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Övriga frekvenser */}
      {moreFreqs.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 2, paddingHorizontal: 14, paddingVertical: 7, borderTopWidth: 1, borderTopColor: line }}>
          {moreFreqs.map(([label, v]) => (
            <Text key={label} style={{ fontFamily: MONO, fontSize: 11, fontWeight: '700', color: accent }}>
              <Text style={{ color: MUTED }}>{label} </Text>{fmtFreq(v)}
            </Text>
          ))}
        </View>
      )}

      {/* Egna landningar */}
      {(showLandings || !!onPlay) && (
        <TouchableOpacity onPress={onLastPress} disabled={!onLastPress} activeOpacity={0.7} accessibilityRole={onLastPress ? 'button' : undefined}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1, borderTopColor: line, backgroundColor: accent + '0F' }}>
          <Text style={{ flex: 1, fontSize: 12.5, color: '#FFFFFF' }} numberOfLines={1}>
            {showLandings ? (
              <>
                <Text style={{ fontFamily: MONO, fontWeight: '800' }}>{landingCount}</Text>
                {landingCount === 1 ? ' landing' : ' landings'}
                {lastText ? <>{' · last '}<Text style={{ fontFamily: MONO, fontWeight: '700' }}>{lastText}</Text></> : null}
              </>
            ) : 'Your latest flight from here'}
          </Text>
          {onPlay && (
            // Lika hög som texten på raden; tryckytan når ändå 44 pt med hitSlop.
            <TouchableOpacity onPress={onPlay} hitSlop={{ top: 14, bottom: 14, left: 8, right: 8 }} activeOpacity={0.8} accessibilityRole="button"
              accessibilityLabel={playing ? 'Stop' : 'Play the latest flight here'}
              style={{ height: 18, flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 7, paddingRight: 9, borderRadius: 9,
                backgroundColor: playing ? accent + '1F' : accent, borderWidth: 1, borderColor: accent }}>
              <Ionicons name={playing ? 'stop' : 'play'} size={9} color={playing ? accent : Colors.textInverse} />
              <Text style={{ fontSize: 12, lineHeight: 15, fontWeight: '800', color: playing ? accent : Colors.textInverse }}>{playing ? 'Stop' : 'Play'}</Text>
            </TouchableOpacity>
          )}
          {onLastPress && <Text style={{ fontSize: 12.5, fontWeight: '700', color: accent }}>Open flight ›</Text>}
        </TouchableOpacity>
      )}

      {/* METAR-popup som egen Modal, bara där kortet inte ligger på en karta (Find airport). */}
      {metar && !onOpenMetar && (
        <Modal visible={wxOpen} transparent animationType="fade" onRequestClose={() => setWxOpen(false)}>
          <MetarSheet metar={metar} accent={accent} onClose={() => setWxOpen(false)} />
        </Modal>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  btn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
});

/** METAR-rutan som overlay över hela föräldern (kartornas Modal), utan någon egen native Modal. */
export function MetarPopup({ metar, accent = Colors.info, onClose }: { metar: AirportMetar; accent?: string; onClose: () => void }) {
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 90 }]}>
      <MetarSheet metar={metar} accent={accent} onClose={onClose} />
    </View>
  );
}

// Liten ruta med Decoded/Raw-toggle, mörk bakgrund runt om (tryck utanför stänger).
function MetarSheet({ metar, accent, onClose }: { metar: AirportMetar; accent: string; onClose: () => void }) {
  const [view, setView] = useState<'decoded' | 'raw'>('decoded');
  return (
    <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 340, backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' }}>
        {/* header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.separator }}>
          {metar.category && <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: categoryColor(metar.category) }} />}
          <Text style={{ color: Colors.textPrimary, fontSize: 15, fontWeight: '800', fontFamily: 'Menlo', letterSpacing: 0.5 }}>METAR {metar.icao}</Text>
          {!!metar.timeZ && <Text style={{ color: Colors.textMuted, fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{metar.timeZ}</Text>}
          <View style={{ flex: 1 }} />
          <TouchableOpacity onPress={onClose} hitSlop={10}><Ionicons name="close" size={18} color={Colors.textSecondary} /></TouchableOpacity>
        </View>
        {/* Decoded / Raw */}
        <View style={{ flexDirection: 'row', alignSelf: 'flex-start', marginHorizontal: 14, marginTop: 12, backgroundColor: Colors.card, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, padding: 3, gap: 3 }}>
          {(['decoded', 'raw'] as const).map((m) => (
            <TouchableOpacity key={m} activeOpacity={0.8} onPress={() => setView(m)}
              style={{ paddingHorizontal: 16, paddingVertical: 6, borderRadius: 7, backgroundColor: view === m ? accent : 'transparent' }}>
              <Text style={{ fontSize: 12.5, fontWeight: '700', color: view === m ? Colors.textInverse : Colors.textSecondary }}>{m === 'decoded' ? 'Decoded' : 'Raw'}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {/* body */}
        <ScrollView style={{ maxHeight: 240 }} contentContainerStyle={{ paddingHorizontal: 14, paddingVertical: 12 }}>
          <Text style={view === 'raw'
            ? { fontFamily: 'JetBrainsMono', fontSize: 12.5, color: Colors.textSecondary, lineHeight: 19 }
            : { fontSize: 14, color: Colors.textPrimary, lineHeight: 21 }}>
            {view === 'decoded' ? metar.text : (metar.raw || metar.text)}
          </Text>
        </ScrollView>
      </Pressable>
    </Pressable>
  );
}

/** "Weather" utanför flygplatskortet på kartorna (Global map: ovanför till vänster; Visited airports: nedanför
 *  till vänster). Pricken har flygkategorins färg (kortet rapporterar sin METAR via onMetar). */
export function WeatherPill({ category, onPress, accent = Colors.info }: { category?: FlightCatLike; onPress: () => void; accent?: string }) {
  const c = category ? categoryColor(category) : accent;
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Weather"
      style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 12, borderRadius: 15, borderWidth: 1, borderColor: c + '99', backgroundColor: 'rgba(10,22,40,0.88)' }}>
      <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: c }} />
      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>Weather</Text>
    </TouchableOpacity>
  );
}
type FlightCatLike = NonNullable<AirportMetar['category']>;
