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
// Utzoomat (mpp: meter per skärmpunkt, från kartans region och höjd): när banan är smalare än FAR_PT punkter på
// skärmen ritas den i stället som EN vit linje med mörk kant, och bannumren står upprätt i små taggar strax
// utanför ändarna (design A, 2026-11-18) — kantlinjer, tröskelstreck och mittlinje går inte att urskilja då och
// blev bara plottriga. heading = kartans vridning, så taggarna hamnar utanför ändarna även på en vriden karta.
// Läggs som barn till en MapView: <RunwayOverlays runways={…} tracks={…} mpp={…} heading={…} />.
import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Marker, Polygon, Polyline } from 'react-native-maps';
import { runwayMarkings, type RunwayGeo } from '../constants/runwayGeo';

const FAV = '#67E8F9';
const EDGE = '#EEF3F8';
const ASPHALT = '#364154';
const MARK = 'rgba(255,255,255,0.85)';

const FAR_PT = 7;   // smalare än så på skärmen → utzoomat läge
const TAG_H = 16;

const OUTLINE_FILL = 'rgba(10,22,40,0.10)';
const OUTLINE_EDGE = 'rgba(255,255,255,0.92)';

export function RunwayOverlays({ runways, ends, tracks, id, outline = false, mpp, heading = 0, frozen = false }: {
  runways: RunwayGeo[];
  outline?: boolean;    // Global map: genomskinlig bana (bara konturer), annars asfalt
  ends?: ('le' | 'he' | null)[];
  tracks: boolean;      // tracksViewChanges för nummermarkörerna (sant en kort stund så iOS rasteriserar dem)
  id: string;           // nyckelprefix (flygplatsens ICAO)
  mpp?: number | null;  // meter per skärmpunkt (saknas → alltid full detalj)
  heading?: number;     // kartans vridning i grader (0 = norr uppåt)
  frozen?: boolean;     // strax före avmontering: aldrig tracksViewChanges (annars kraschar iOS-teardown)
}) {
  const marks = useMemo(() => runwayMarkings(runways), [runways]);
  const widest = runways.reduce((m, r) => Math.max(m, r.widthM > 0 ? r.widthM : 30), 0);
  const far = mpp != null && mpp > 0 && widest / mpp < FAR_PT;
  const hBucket = Math.round(heading / 5) * 5;
  // Nya eller flyttade taggar måste rasteriseras om: spåra en kort stund när läget eller vridningen ändras.
  const [pulse, setPulse] = useState(false);
  useEffect(() => { setPulse(true); const t = setTimeout(() => setPulse(false), 1200); return () => clearTimeout(t); }, [far, hBucket]);
  const track = !frozen && (tracks || pulse);
  if (!marks.length) return null;
  // VIKTIGT: samma barn i båda lägena. Bytet utzoomat ↔ inzoomat ändrar bara färger och opacity — inga lager
  // monteras eller avmonteras då. Att byta ut överlägg och markörer mitt i en zoomning kraschade iOS-kartan
  // (Find airport / Closest to me stängdes, 2026-11-18). Dolt = genomskinlig färg / opacity 0.
  const near = !far;
  const NONE = 'rgba(0,0,0,0)';
  return (
    <>
      {/* Utzoomat: en vit linje med mörk kant per bana. */}
      {runways.map((rw, i) => {
        const line = [{ latitude: rw.le.lat, longitude: rw.le.lon }, { latitude: rw.he.lat, longitude: rw.he.lon }];
        return [
          <Polyline key={`${id}-fh${i}`} coordinates={line} strokeColor={far ? 'rgba(8,18,32,0.45)' : NONE} strokeWidth={6} lineCap="round" zIndex={5} />,
          <Polyline key={`${id}-fl${i}`} coordinates={line} strokeColor={far ? 'rgba(255,255,255,0.94)' : NONE} strokeWidth={2.6} lineCap="round" zIndex={6} />,
        ];
      })}
      {/* Inzoomat: kantlinje + asfalt, mittlinje, tröskelstreck, pil vid den gynnade änden. */}
      {marks.map((m, i) => (
        <Polygon key={`${id}-c${i}`} coordinates={m.corners} fillColor={near ? (outline ? OUTLINE_FILL : ASPHALT) : NONE}
          strokeColor={near ? (outline ? OUTLINE_EDGE : EDGE) : NONE} strokeWidth={outline ? 1.5 : 2.6} zIndex={5} />
      ))}
      {/* Asfalten en gång till, utan kantlinje: täcker kantlinjernas inre halva och den andra banans kant i korsningen. */}
      {!outline && marks.map((m, i) => (
        <Polygon key={`${id}-a${i}`} coordinates={m.corners} fillColor={near ? ASPHALT : NONE} strokeColor={NONE} strokeWidth={0} zIndex={6} />
      ))}
      {marks.flatMap((m, i) => m.centre.map((seg, n) => (
        <Polyline key={`${id}-l${i}-${n}`} coordinates={seg} strokeColor={near ? (outline ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.8)') : NONE}
          strokeWidth={1} lineDashPattern={[5, 4]} zIndex={7} />
      )))}
      {marks.flatMap((m, i) => (['le', 'he'] as const).flatMap((e) => m.keys[e].map((k, n) => (
        <Polygon key={`${id}-k${i}${e}${n}`} coordinates={k} fillColor={near ? (ends?.[i] === e ? FAV : outline ? OUTLINE_EDGE : MARK) : NONE}
          strokeColor={NONE} strokeWidth={0} zIndex={7} />
      ))))}
      {/* Pilen finns för båda ändarna och syns bara vid den ände vinden gynnar (vinden kommer in efter start). */}
      {marks.flatMap((m, i) => (['le', 'he'] as const).map((e) => (
        <Polyline key={`${id}-v${i}${e}`} coordinates={m.chevron[e]} strokeColor={near && ends?.[i] === e ? FAV : NONE}
          strokeWidth={2.4} lineCap="round" lineJoin="round" zIndex={7} />
      )))}
      {/* Bannumren inzoomat: flat → ligger på kartytan och följer kartans vridning. Vinkeln sätts på barnvyn
          (rotation-propen ignoreras för egna vyer på Apple Maps): numrets topp pekar i landningsriktningen. */}
      {marks.flatMap((m, i) => (['le', 'he'] as const).map((e) => (
        <Marker key={`${id}-n${i}${e}`} coordinate={m.num[e]} anchor={{ x: 0.5, y: 0.5 }} flat opacity={near ? 1 : 0} tracksViewChanges={track} zIndex={8}>
          <View style={{ transform: [{ rotate: `${(m.bearing + (e === 'he' ? 180 : 0)) % 360}deg` }] }} pointerEvents="none">
            <Text style={[s.num, ends?.[i] === e && { color: FAV }]}>{e === 'le' ? runways[i].leIdent : runways[i].heIdent}</Text>
          </View>
        </Marker>
      )))}
      {/* Bannumren utzoomat: upprätta taggar strax utanför ändarna. */}
      {runways.flatMap((rw, i) => (['le', 'he'] as const).map((e) => {
        // Riktningen utåt från änden, i skärmens koordinater (x höger, y nedåt).
        const th = ((marks[i].bearing + (e === 'le' ? 180 : 0) - hBucket) * Math.PI) / 180;
        const dx = Math.sin(th), dy = -Math.cos(th);
        const label = e === 'le' ? rw.leIdent : rw.heIdent;
        const halfW = 5 + label.length * 3.1;
        const off = 7 + Math.abs(dx) * halfW + Math.abs(dy) * (TAG_H / 2);
        const fav = ends?.[i] === e;
        const p = e === 'le' ? rw.le : rw.he;
        return (
          <Marker key={`${id}-t${i}${e}`} coordinate={{ latitude: p.lat, longitude: p.lon }} anchor={{ x: 0.5, y: 0.5 }} opacity={far ? 1 : 0} tracksViewChanges={track} zIndex={8}>
            <View style={s.tagBox} pointerEvents="none">
              <View style={[s.tag, { transform: [{ translateX: dx * off }, { translateY: dy * off }] }, fav && { borderColor: FAV }]}>
                <Text style={[s.tagTxt, fav && { color: FAV }]}>{label}</Text>
              </View>
            </View>
          </Marker>
        );
      }))}
    </>
  );
}

const s = StyleSheet.create({
  // Utzoomat: taggen i en fast, genomskinlig ruta centrerad på banänden och flyttad utåt med transform
  // (rutans storlek ändras aldrig → ankaret 0.5/0.5 träffar änden exakt).
  tagBox: { width: 80, height: 60, alignItems: 'center', justifyContent: 'center' },
  tag: { height: TAG_H, paddingHorizontal: 5, borderRadius: 5, justifyContent: 'center',
    backgroundColor: 'rgba(12,28,52,0.84)', borderWidth: 0.8, borderColor: 'rgba(255,255,255,0.4)' },
  tagTxt: { fontFamily: 'JetBrainsMono', color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
  // Mörk skugga: numret är läsbart även när det är bredare än banan (utzoomat) och hamnar över terrängen.
  num: { fontFamily: 'JetBrainsMono', color: '#FFFFFF', fontSize: 11, fontWeight: '800', letterSpacing: 0.3,
    textShadowColor: 'rgba(10,22,40,0.95)', textShadowRadius: 3, textShadowOffset: { width: 0, height: 0 } },
});
