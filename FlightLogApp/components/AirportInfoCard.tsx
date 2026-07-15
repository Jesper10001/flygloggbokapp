// Delat flygplats-infokort (används i visited airports-kartan + global map). Vänster: ICAO +
// namn + rullbane-diagram. Höger: en rad per bana [ident] [längd] [yta] (inkapslat), och —
// om landingCount anges — LANDINGS + LAST. Positionering (topp/botten) sköts av föräldern.
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { getRunways } from '../utils/runways';
import { RunwayDiagram } from './FlightShareCard';
import runwayData from '../assets/runways.json';

const rwyNum = (h: number) => ((Math.round(h / 10) + 35) % 36) + 1;
function runwayPairs(headings: number[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of headings || []) {
    const a = rwyNum(h), b = rwyNum((h + 180) % 360);
    const key = [Math.min(a, b), Math.max(a, b)].join('/');
    if (!seen.has(key)) {
      seen.add(key);
      const p = (n: number) => String(n).padStart(2, '0');
      out.push(`${p(Math.min(a, b))}/${p(Math.max(a, b))}`);
    }
  }
  return out;
}

export function AirportInfoCard({ icao, name, accent = Colors.info, landingCount, lastText, onLastPress, onClose }: {
  icao: string;
  name?: string;
  accent?: string;
  landingCount?: number;      // undefined → dölj LANDINGS + LAST (t.ex. flygplats man inte landat på)
  lastText?: string;
  onLastPress?: () => void;   // om satt → LAST blir en länk (öppna flygningen)
  onClose: () => void;
}) {
  const rwyInfo = getRunways(icao).filter((r) => !r.closed);
  const pairs = runwayPairs((runwayData as Record<string, number[]>)[icao] || []);
  const rwyRows = (rwyInfo.length
    ? rwyInfo.map((r) => ({ ident: r.ident, lengthM: r.lengthM, surface: r.surface }))
    : pairs.map((p) => ({ ident: p, lengthM: 0, surface: '' }))
  ).slice(0, 5);
  const showLandings = landingCount !== undefined;

  return (
    <View style={{ flexDirection: 'row', backgroundColor: 'rgba(15,22,38,0.96)', borderRadius: 14, borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden' }}>
      {/* ICAO-kort — 2/5 av rutan */}
      <View style={{ flex: 2, backgroundColor: accent + '22', paddingHorizontal: 14, paddingVertical: 12, justifyContent: 'center', borderRightWidth: 1, borderRightColor: Colors.cardBorder }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={{ color: accent, fontSize: 20, fontWeight: '800', fontFamily: 'Menlo', letterSpacing: 1 }}>{icao}</Text>
          <RunwayDiagram icao={icao} size={28} color={accent} />
        </View>
        {!!name && <Text style={{ color: Colors.textMuted, fontSize: 10, fontWeight: '600', marginTop: 2, lineHeight: 14 }}>{name}</Text>}
      </View>

      {/* Detaljer — 3/5 av rutan */}
      <View style={{ flex: 3, paddingLeft: 14, paddingRight: 38, paddingVertical: 10, gap: 9, justifyContent: 'center' }}>
        {/* En rad per bana: [ident] [längd] [yta] */}
        <View style={{ gap: 4 }}>
          <Text style={{ color: Colors.textMuted, fontSize: 9, fontWeight: '700', letterSpacing: 0.8, fontFamily: 'Menlo' }}>RWY</Text>
          {rwyRows.length ? rwyRows.map((r, i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
              <View style={{ backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.15)' }}>
                <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700', fontFamily: 'Menlo' }}>{r.ident}</Text>
              </View>
              {r.lengthM > 0 && (
                <View style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1.5, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.12)' }}>
                  <Text style={{ color: Colors.textSecondary, fontSize: 9.5, fontWeight: '600', fontFamily: 'Menlo' }}>{r.lengthM} m</Text>
                </View>
              )}
              {!!r.surface && (
                <View style={{ backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1.5, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.12)' }}>
                  <Text style={{ color: Colors.textSecondary, fontSize: 9.5, fontWeight: '600', fontFamily: 'Menlo' }}>{r.surface}</Text>
                </View>
              )}
            </View>
          )) : <Text style={{ color: Colors.textMuted, fontSize: 12 }}>—</Text>}
        </View>

        {/* LANDINGS + LAST — bara om man landat där */}
        {showLandings && (
          <View style={{ flexDirection: 'row', gap: 18 }}>
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
      </View>

      {/* Stäng — större & tydligare (cirkel) */}
      <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        style={{ position: 'absolute', top: 6, right: 6, width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)', alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name="close" size={19} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}
