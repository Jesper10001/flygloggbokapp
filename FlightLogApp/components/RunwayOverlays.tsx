// Landningsbanor ritade på en karta (react-native-maps) i samma stil som vädersidans bankarta, men i verklig
// bredd och längd: asfalt med vit kantlinje, tröskelstreck, streckad mittlinje och bannumret innanför tröskeln
// (läses åt det håll man landar). Används av Global map, Find airport och Closest to me. Inga måttetiketter.
//
// Korsande banor ritas som EN yta, i tre lager (ordningen bland barnen = ritordningen):
//   1. allas kantlinje (ytan med vit kontur)  2. allas asfalt ovanpå (täcker den andra banans kantlinje i
//   korsningen, så konturen följer ytterkanten)  3. markeringarna.
// outline (bara Global map): bara kantlinje och markeringar på en nästan genomskinlig yta, så att den riktiga
// banan i satellitbilden syns igenom. Utan andra asfaltlagret: i korsningar syns båda banornas kantlinjer.
// ends: per bana änden vinden gynnar ('le'/'he') → cyan tröskel, nummer och pil. Utan vind är allt vitt.
// Läggs som barn till en MapView: <RunwayOverlays runways={…} tracks={…} />.
import { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Marker, Polygon, Polyline } from 'react-native-maps';
import { runwayMarkings, type RunwayGeo } from '../constants/runwayGeo';

const FAV = '#67E8F9';
const EDGE = '#EEF3F8';
const ASPHALT = '#364154';
const MARK = 'rgba(255,255,255,0.85)';

const OUTLINE_FILL = 'rgba(10,22,40,0.10)';
const OUTLINE_EDGE = 'rgba(255,255,255,0.92)';

export function RunwayOverlays({ runways, ends, tracks, id, outline = false }: {
  runways: RunwayGeo[];
  outline?: boolean;    // Global map: genomskinlig bana (bara konturer), annars asfalt
  ends?: ('le' | 'he' | null)[];
  tracks: boolean;      // tracksViewChanges för nummermarkörerna (sant en kort stund så iOS rasteriserar dem)
  id: string;           // nyckelprefix (flygplatsens ICAO)
}) {
  const marks = useMemo(() => runwayMarkings(runways), [runways]);
  if (!marks.length) return null;
  return (
    <>
      {marks.map((m, i) => (
        <Polygon key={`${id}-c${i}`} coordinates={m.corners} fillColor={outline ? OUTLINE_FILL : ASPHALT} strokeColor={outline ? OUTLINE_EDGE : EDGE} strokeWidth={outline ? 1.5 : 2.6} zIndex={5} />
      ))}
      {/* Asfalten en gång till, utan kantlinje: täcker kantlinjernas inre halva och den andra banans kant i korsningen. */}
      {!outline && marks.map((m, i) => (
        <Polygon key={`${id}-a${i}`} coordinates={m.corners} fillColor={ASPHALT} strokeColor={ASPHALT} strokeWidth={0} zIndex={6} />
      ))}
      {marks.flatMap((m, i) => m.centre.map((seg, n) => (
        <Polyline key={`${id}-l${i}-${n}`} coordinates={seg} strokeColor={outline ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.8)'} strokeWidth={1} lineDashPattern={[5, 4]} zIndex={7} />
      )))}
      {marks.flatMap((m, i) => (['le', 'he'] as const).flatMap((e) => m.keys[e].map((k, n) => (
        <Polygon key={`${id}-k${i}${e}${n}`} coordinates={k} fillColor={ends?.[i] === e ? FAV : outline ? OUTLINE_EDGE : MARK} strokeColor="rgba(0,0,0,0)" strokeWidth={0} zIndex={7} />
      ))))}
      {marks.flatMap((m, i) => (['le', 'he'] as const).filter((e) => ends?.[i] === e).map((e) => (
        <Polyline key={`${id}-v${i}${e}`} coordinates={m.chevron[e]} strokeColor={FAV} strokeWidth={2.4} lineCap="round" lineJoin="round" zIndex={7} />
      )))}
      {/* Bannumren: flat → ligger på kartytan och följer kartans vridning. Vinkeln sätts på barnvyn (rotation-
          propen ignoreras för egna vyer på Apple Maps): numrets topp pekar i landningsriktningen. */}
      {marks.flatMap((m, i) => (['le', 'he'] as const).map((e) => (
        <Marker key={`${id}-n${i}${e}`} coordinate={m.num[e]} anchor={{ x: 0.5, y: 0.5 }} flat tracksViewChanges={tracks} zIndex={8}>
          <View style={{ transform: [{ rotate: `${(m.bearing + (e === 'he' ? 180 : 0)) % 360}deg` }] }}>
            <Text style={[s.num, ends?.[i] === e && { color: FAV }]}>{e === 'le' ? runways[i].leIdent : runways[i].heIdent}</Text>
          </View>
        </Marker>
      )))}
    </>
  );
}

const s = StyleSheet.create({
  // Mörk skugga: numret är läsbart även när det är bredare än banan (utzoomat) och hamnar över terrängen.
  num: { fontFamily: 'JetBrainsMono', color: '#FFFFFF', fontSize: 11, fontWeight: '800', letterSpacing: 0.3,
    textShadowColor: 'rgba(10,22,40,0.95)', textShadowRadius: 3, textShadowOffset: { width: 0, height: 0 } },
});
