// Väderkortet på dashboarden (pilot- och drönarläget). Visas efter "Fetch WX" (dra ner sidan) på platsen
// ovanför WORKLOAD: flygkategorin som färgad etikett, stationen, hur gammal observationen är, fyra värden
// (vind, sikt, moln, QNH) och en TAF-rad med nästa förändring. Tryck öppnar hela METAR och TAF.
// Färgen betyder flygkategori. Åldern står som text och blir gul (över en timme) eller röd (över två).
// Här finns också raderna för "hämtar" och "inget väder hittades", som ligger på samma plats.
import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../constants/colors';
import { categoryColor, type DecodedWx, type FlightCat, type WxCell } from '../services/weather';
import { FONT_MONO } from './logbook-page/tokens';

const PILL_INK = '#06121F'; // mörk text på den fyllda kategori-etiketten (samma i båda teman)

function ageMinutes(obsMs: number): number {
  return Math.max(0, Math.round((Date.now() - obsMs) / 60000));
}
function ageText(min: number): string {
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 24) return m ? `${h} h ${m} min ago` : `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}
function clockZ(obsMs: number): string {
  const d = new Date(obsMs);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}z`;
}

function CatPill({ cat, outline }: { cat: FlightCat; outline?: boolean }) {
  const c = categoryColor(cat);
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: outline ? 2 : 3, borderRadius: 8, backgroundColor: outline ? 'transparent' : c, borderWidth: outline ? 1 : 0, borderColor: c }}>
      <Text style={{ fontFamily: FONT_MONO, fontSize: outline ? 9.5 : 11, fontWeight: '700', letterSpacing: 1, color: outline ? c : PILL_INK }}>{cat}</Text>
    </View>
  );
}

function Cell({ label, cell, first, line }: { label: string; cell: WxCell; first: boolean; line: string }) {
  return (
    <View style={{ flex: 1, paddingVertical: 9, paddingHorizontal: 4, alignItems: 'center', borderLeftWidth: first ? 0 : 1, borderLeftColor: line }}>
      <Text style={{ fontFamily: FONT_MONO, fontSize: 7.5, fontWeight: '700', letterSpacing: 1, color: Colors.gold }}>{label}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6} style={{ fontFamily: FONT_MONO, fontSize: 17, fontWeight: '700', color: Colors.textPrimary, marginTop: 4 }}>{cell.value}</Text>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ fontSize: 10, color: Colors.textSecondary, marginTop: 2, minHeight: 13 }}>{cell.unit}</Text>
    </View>
  );
}

export function WxCard({ wx, loading, byPosition, onPress, translucent = false }: {
  wx: DecodedWx;
  loading?: boolean;     // en ny hämtning pågår (sidan drogs ner igen): kortet står kvar, åldern byts mot en snurra
  byPosition?: boolean;  // vädret gäller närmaste station från ens position (ingen destination att utgå från)
  onPress: () => void;
  translucent?: boolean; // ovanpå en karta (WxMapPopup): 10 % genomskinligt
}) {
  // Åldern räknas om en gång i halvminuten medan kortet visas.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  const station = wx.metarStation ?? wx.tafStation ?? wx.destIcao;
  const name = wx.metarStation ? wx.metarStationName : wx.tafStationName;
  const accent = wx.category ? categoryColor(wx.category) : Colors.primary;
  const line = accent + '33';

  const min = wx.metarObsMs != null ? ageMinutes(wx.metarObsMs) : null;
  const ageColor = min == null || min <= 60 ? Colors.textSecondary : min <= 120 ? Colors.warning : Colors.danger;

  const note = byPosition
    ? 'Nearest weather station to your position'
    : wx.metarStation && wx.metarIsAlternate
      ? `Nearest station to ${wx.destIcao}, which has no weather report`
      : !wx.metarStation && wx.tafIsAlternate
        ? `Nearest forecast to ${wx.destIcao}`
        : '';

  const tafLabel = wx.tafStation && wx.tafStation !== station ? `TAF ${wx.tafStation}` : 'TAF';
  const tafText = wx.tafNext?.text ?? (wx.tafStation ? 'No forecast details' : 'No forecast for this station');
  const tafCat = wx.tafNext?.category && wx.tafNext.category !== wx.category ? wx.tafNext.category : null;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`Weather for ${station}. Opens the full METAR and TAF.`}
      style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: accent + '66', marginBottom: 6 }}
    >
      {/* Ovanpå kartan: en jämn bas som släpper igenom 10 %, kategorifärgen som en svag ton ovanpå. */}
      {translucent && <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,30,58,0.9)' }} />}
      <LinearGradient colors={[accent + '1F', translucent ? 'rgba(15,30,58,0)' : Colors.surface]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: '100%', height: '100%', position: 'absolute' }} />

      {/* Rubrik: kategori, station, ålder */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 11, paddingBottom: note ? 4 : 10 }}>
        {wx.category && <CatPill cat={wx.category} />}
        <Text style={{ fontFamily: FONT_MONO, fontSize: 14, fontWeight: '700', color: Colors.textPrimary }}>{station}</Text>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 12.5, color: Colors.textSecondary }}>{name && name !== station ? name : ''}</Text>
        {loading ? (
          <ActivityIndicator size="small" color={accent} />
        ) : wx.metarObsMs != null && min != null ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {min > 60 && <Ionicons name="time-outline" size={12} color={ageColor} />}
            <Text style={{ fontFamily: FONT_MONO, fontSize: 10.5, fontWeight: min > 60 ? '700' : '500', color: ageColor }}>
              {min > 60 ? ageText(min) : `${clockZ(wx.metarObsMs)} · ${ageText(min)}`}
            </Text>
          </View>
        ) : null}
      </View>
      {!!note && <Text style={{ fontSize: 11.5, color: Colors.textSecondary, paddingHorizontal: 12, paddingBottom: 9 }}>{note}</Text>}

      {/* Fyra värden. Utan observation står det i klartext i stället för fyra streck. */}
      {wx.cells ? (
        <View style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: line }}>
          <Cell label="WIND" cell={wx.cells.wind} first line={line} />
          <Cell label="VISIBILITY" cell={wx.cells.vis} first={false} line={line} />
          <Cell label="CLOUD" cell={wx.cells.cloud} first={false} line={line} />
          <Cell label="QNH" cell={wx.cells.qnh} first={false} line={line} />
        </View>
      ) : (
        <Text style={{ fontSize: 12.5, color: Colors.textSecondary, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: line }}>No current observation near {wx.destIcao}</Text>
      )}

      {/* TAF: nästa förändring */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 9, borderTopWidth: 1, borderTopColor: line }}>
        <Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, fontWeight: '700', letterSpacing: 1, color: Colors.gold }}>{tafLabel}</Text>
        <Text numberOfLines={2} style={{ flex: 1, fontSize: 13, lineHeight: 17, color: Colors.textPrimary }}>{tafText}</Text>
        {tafCat && <CatPill cat={tafCat} outline />}
        <Ionicons name="chevron-forward" size={14} color={Colors.textSecondary} />
      </View>
    </TouchableOpacity>
  );
}

// "Fetching weather for ESCF…": visas på kortets plats medan den första hämtningen pågår.
export function WxFetchingRow({ place, accent = Colors.primary }: { place?: string; accent?: string }) {
  return (
    <View accessibilityRole="progressbar" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 44, marginBottom: 2 }}>
      <ActivityIndicator size="small" color={accent} />
      <Text style={{ fontSize: 14, fontWeight: '700', color: Colors.textPrimary }}>
        Fetching weather {place ? 'for ' : 'near you'}{place ? <Text style={{ color: accent }}>{place}</Text> : null}…
      </Text>
    </View>
  );
}

// "No weather found near ESCF. Pull down to try again.": visas på kortets plats när hämtningen inte gav något.
export function WxNotFoundRow({ place, accent = Colors.primary }: { place?: string; accent?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, marginBottom: 2 }}>
      <View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: accent + '99', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="arrow-down" size={14} color={accent} />
      </View>
      <Text style={{ flex: 1, fontSize: 14, lineHeight: 19, fontWeight: '700', color: Colors.textPrimary }}>
        No weather found {place ? 'near ' : 'nearby'}{place ? <Text style={{ color: accent }}>{place}</Text> : null}. Pull down to try again.
      </Text>
    </View>
  );
}
