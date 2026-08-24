// Delat flygplats-infokort (visited airports-kartan + global map). Helsvart, en kolumn:
// ICAO + namn (till höger, radbryts) + IATA·höjd·typ + frekvenser, och LANDINGS/LAST under.
// Under ICAO en väder-molnsymbol — visas BARA om flygplatsen har EGEN METAR; klick → METAR-popup
// (Decoded/Raw-toggle). Baninfo visas inte här (banor ritas på kartan).
import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { getAirportFreq } from '../constants/airportFreq';
import { fetchAirportMetar, categoryColor, type AirportMetar } from '../services/weather';

const CARD_BG = 'rgba(15,22,38,0.96)'; // mörk nyans

// airportmap.de-typ → läsbar etikett.
const TYPE_LABEL: Record<string, string> = {
  large: 'Large', medium: 'Medium', small: 'Airfield', heliport: 'Heliport',
  seaplane: 'Seaplane', altiport: 'Altiport', balloonport: 'Balloonport', closed: 'Closed',
};

export function AirportInfoCard({ icao, name, iata, alt, type, accent = Colors.info, landingCount, lastText, onLastPress, onClose, isFavorite, onToggleFavorite, freqStats, onMetar }: {
  icao: string;
  name?: string;
  iata?: string;              // IATA-kod (airportmap.de)
  alt?: number | null;        // elevation (ft)
  type?: string;              // airportmap.de-kategori
  accent?: string;
  landingCount?: number;      // undefined → dölj LANDINGS + LAST (t.ex. flygplats man inte landat på)
  lastText?: string;
  onLastPress?: () => void;   // om satt → LAST blir en länk (öppna flygningen)
  onClose: () => void;
  isFavorite?: boolean;       // om onToggleFavorite satt → visa stjärna under X
  onToggleFavorite?: () => void;
  freqStats?: boolean;        // Find airport: dölj iata·höjd·typ-metan, visa frekvenser som stora staplade kolumner
  onMetar?: (m: AirportMetar | null) => void; // rapporterar hämtad METAR uppåt (t.ex. vind → aktiv bana i snippeten)
}) {
  const meta = [iata || null, alt != null ? `${alt} ft` : null, type ? (TYPE_LABEL[type] || type) : null].filter(Boolean).join('  ·  ');
  const showLandings = landingCount !== undefined;

  // Frekvenser (TWR/GND/ATIS/APP) — visas bara för fält som har dem, på egen rad under meta.
  const freq = getAirportFreq(icao);
  const freqLine = freq ? [
    freq.twr != null && `TWR ${freq.twr}`,
    freq.gnd != null && `GND ${freq.gnd}`,
    freq.atis != null && `ATIS ${freq.atis}`,
    freq.app != null && `APP ${freq.app}`,
  ].filter(Boolean).join(' · ') : '';
  // freqStats-läge: frekvenser som staplade kolumner (etikett över, frekvens under).
  const freqCols = freq ? ([
    ['TWR', freq.twr], ['GND', freq.gnd], ['ATIS', freq.atis], ['APP', freq.app],
  ] as const).filter(([, v]) => v != null) : [];

  // Egen METAR (ingen närmaste-fält-fallback). I freqStats-läget skrivs den ut inline under namnet
  // (annars ritas molnet bara när den finns).
  const [metar, setMetar] = useState<AirportMetar | null>(null);
  const [metarLoading, setMetarLoading] = useState(true);
  const [wxOpen, setWxOpen] = useState(false);
  const [view, setView] = useState<'decoded' | 'raw'>('decoded');
  useEffect(() => {
    let alive = true;
    setMetar(null); setWxOpen(false); setView('decoded'); setMetarLoading(true);
    onMetar?.(null); // nollställ tills ny hämtats (t.ex. banhighlight)
    fetchAirportMetar(icao)
      .then((r) => { if (alive) { setMetar(r); setMetarLoading(false); onMetar?.(r); } })
      .catch(() => { if (alive) { setMetarLoading(false); onMetar?.(null); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [icao]);
  // Animerade "..." medan vädret hämtas (inline-utskriften i freqStats).
  const [dots, setDots] = useState('');
  useEffect(() => {
    if (!metarLoading) { setDots(''); return; }
    const id = setInterval(() => setDots((d) => (d.length >= 3 ? '' : d + '.')), 400);
    return () => clearInterval(id);
  }, [metarLoading]);

  return (
    <View style={{ backgroundColor: CARD_BG, borderRadius: 14, borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden', paddingLeft: 16, paddingRight: 46, paddingVertical: 14, minHeight: onToggleFavorite ? 84 : 42 }}>
      {/* ICAO till vänster, namn (radbryts) + meta till höger → lågt kort. */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        {/* ICAO + väder-moln (bara om egen METAR finns) centrerat under. Egen kolumn → rör inte info till höger. */}
        <View style={{ alignItems: 'center' }}>
          <Text style={{ color: accent, fontSize: 22, fontWeight: '800', fontFamily: 'Menlo', letterSpacing: 1 }}>{icao}</Text>
          {!freqStats && metar && (
            <TouchableOpacity onPress={() => setWxOpen(true)} activeOpacity={0.7} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} style={{ marginTop: 6 }}>
              <Ionicons name="partly-sunny-outline" size={29} color={accent} />
            </TouchableOpacity>
          )}
        </View>
        {(!!name || !!meta || !!freqLine || freqStats) && (
          <View style={{ flex: 1 }}>
            {!!name && <Text style={{ color: Colors.textMuted, fontSize: 11, fontWeight: '600', lineHeight: 15 }}>{name}</Text>}
            {freqStats ? (
              // METAR skrivs ut direkt under namnet (tryck → Decoded/Raw-popup). Medan den hämtas: "Fetching weather…"
              metarLoading ? (
                <Text style={{ color: Colors.textMuted, fontSize: 11.5, fontWeight: '600', marginTop: 5, fontFamily: 'ChakraPetch-SemiBold' }}>Fetching weather{dots}</Text>
              ) : metar ? (
                <TouchableOpacity activeOpacity={0.7} onPress={() => setWxOpen(true)} style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 5 }}>
                  {metar.category && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: categoryColor(metar.category), marginTop: 4 }} />}
                  <Text style={{ flex: 1, color: Colors.textSecondary, fontSize: 11.5, fontWeight: '600', lineHeight: 16 }}>{metar.brief}</Text>
                </TouchableOpacity>
              ) : (
                <Text style={{ color: Colors.textMuted, fontSize: 11, fontWeight: '600', marginTop: 5 }}>No weather reported</Text>
              )
            ) : (
              <>
                {!!meta && <Text style={{ color: accent, fontSize: 10, fontWeight: '700', marginTop: 2, letterSpacing: 0.3 }} numberOfLines={1}>{meta}</Text>}
                {!!freqLine && <Text style={{ color: Colors.textSecondary, fontSize: 9.5, fontWeight: '600', fontFamily: 'Menlo', marginTop: 3, lineHeight: 13, fontVariant: ['tabular-nums'] }}>{freqLine}</Text>}
              </>
            )}
          </View>
        )}
      </View>

      {/* Find airport: frekvenser i stora staplade kolumner (etikett över, frekvens under) */}
      {freqStats && freqCols.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, rowGap: 8 }}>
          {freqCols.map(([label, val]) => (
            <View key={label} style={{ width: '25%' }}>
              <Text style={{ color: Colors.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 0.6, fontFamily: 'Menlo' }}>{label}</Text>
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '800', marginTop: 2, fontVariant: ['tabular-nums'] }}>{val}</Text>
            </View>
          ))}
        </View>
      )}

      {/* LANDINGS + LAST — bara om man landat där */}
      {showLandings && (
        <View style={{ flexDirection: 'row', gap: 22, marginTop: 14 }}>
          <View>
            <Text style={{ color: Colors.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 0.8, fontFamily: 'Menlo' }}>LANDINGS</Text>
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{landingCount}</Text>
          </View>
          <View style={{ flexShrink: 1 }}>
            <Text style={{ color: Colors.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 0.8, fontFamily: 'Menlo' }}>LAST</Text>
            {onLastPress ? (
              <TouchableOpacity onPress={onLastPress} activeOpacity={0.7} hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                <Text style={{ color: accent, fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }} numberOfLines={1}>{lastText}</Text>
                <Ionicons name="open-outline" size={11} color={accent} />
              </TouchableOpacity>
            ) : (
              <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{lastText}</Text>
            )}
          </View>
        </View>
      )}

      {/* Stäng */}
      <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={{ position: 'absolute', top: 6, right: 6, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="close" size={19} color="#fff" />
      </TouchableOpacity>

      {/* Favorit */}
      {onToggleFavorite && (
        <TouchableOpacity onPress={onToggleFavorite} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={{ position: 'absolute', top: 42, right: 6, width: 30, height: 30, borderRadius: 15, backgroundColor: isFavorite ? Colors.gold + '2e' : 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: isFavorite ? Colors.gold : 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={isFavorite ? 'star' : 'star-outline'} size={17} color={isFavorite ? Colors.gold : '#fff'} />
        </TouchableOpacity>
      )}

      {/* METAR-popup (moln-klick) — liten ruta, Decoded/Raw-toggle */}
      {metar && (
        <Modal visible={wxOpen} transparent animationType="fade" onRequestClose={() => setWxOpen(false)}>
          <Pressable onPress={() => setWxOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <Pressable onPress={() => {}} style={{ width: '100%', maxWidth: 340, backgroundColor: Colors.surface, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden' }}>
              {/* header */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: Colors.separator }}>
                {metar.category && <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: categoryColor(metar.category) }} />}
                <Text style={{ color: Colors.textPrimary, fontSize: 15, fontWeight: '800', fontFamily: 'Menlo', letterSpacing: 0.5 }}>METAR {metar.icao}</Text>
                {!!metar.timeZ && <Text style={{ color: Colors.textMuted, fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{metar.timeZ}</Text>}
                <View style={{ flex: 1 }} />
                <TouchableOpacity onPress={() => setWxOpen(false)} hitSlop={10}><Ionicons name="close" size={18} color={Colors.textSecondary} /></TouchableOpacity>
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
        </Modal>
      )}
    </View>
  );
}
