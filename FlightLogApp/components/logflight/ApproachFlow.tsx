// Designens ApproachFlow — per ICAO (ankomst + ev. stopp, EJ avgång): välj 2D/3D →
// approach-typ (2D: VOR/NDB/LOC · 3D: ILS/RNAV/GLS) → runway. Resultatet byggs in i
// remarks som "ESSA ILS 27" (se add.tsx). Kedjan visar bara nästa steg i taget.
import { View, Text, TouchableOpacity } from 'react-native';
import { Colors } from '../../constants/colors';
import { FONT_MONO } from '../logbook-page/tokens';

export type ApproachVal = { dim?: '2d' | '3d'; app?: string; rwy?: string };
export const APP_TYPES: Record<'2d' | '3d', string[]> = {
  '2d': ['VOR', 'NDB', 'LOC'],
  '3d': ['ILS', 'RNAV', 'GLS'],
};

function Opt({ on, label, onPress }: { on?: boolean; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={{
        backgroundColor: on ? Colors.primary + '28' : Colors.elevated,
        borderWidth: 1, borderColor: on ? Colors.primary : Colors.border,
        borderRadius: 7, paddingHorizontal: 9, paddingVertical: 5,
      }}
    >
      <Text style={{ fontFamily: FONT_MONO, fontSize: 10, fontWeight: '700', color: on ? Colors.primary : Colors.textSecondary }}>{label}</Text>
    </TouchableOpacity>
  );
}

export function ApproachFlow({ icaos, value, onChange, ifr, runwaysFor }: {
  icaos: string[];
  value: Record<string, ApproachVal>;
  onChange: (next: Record<string, ApproachVal>) => void;
  ifr: boolean;
  runwaysFor: (icao: string) => string[];
}) {
  const upd = (icao: string, patch: ApproachVal | null) =>
    onChange({ ...value, [icao]: patch === null ? {} : { ...(value[icao] || {}), ...patch } });

  if (icaos.length === 0) {
    return <Text style={{ fontFamily: FONT_MONO, fontSize: 11, color: Colors.textMuted }}>Add a destination first</Text>;
  }

  return (
    <View style={{ gap: 9 }}>
      {icaos.map((icao) => {
        const v = value[icao] || {};
        const rwys = runwaysFor(icao);
        return (
          <View key={icao} style={{ backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border, borderRadius: 11, paddingHorizontal: 11, paddingVertical: 9 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text style={{ fontFamily: FONT_MONO, fontSize: 14, fontWeight: '800', letterSpacing: 0.5, color: Colors.textPrimary }}>{icao}</Text>
              {v.app ? (
                <Text style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: '700', color: Colors.primary }}>{v.app}{v.rwy ? ` ${v.rwy}` : ''}</Text>
              ) : null}
              {ifr && !v.dim ? (
                <Text style={{ fontFamily: FONT_MONO, fontSize: 11, fontWeight: '700', letterSpacing: 0.4, color: Colors.textMuted }}>+ approach</Text>
              ) : null}
              {v.dim ? (
                <TouchableOpacity onPress={() => upd(icao, null)} hitSlop={8} style={{ marginLeft: 'auto' }}>
                  <Text style={{ fontFamily: FONT_MONO, fontSize: 10, color: Colors.textMuted }}>reset</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            {/* steg 1 — 2D / 3D (endast IFR/Y/Z) */}
            {ifr && !v.dim ? (
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 8 }}>
                <Opt label="2D approach" onPress={() => upd(icao, { dim: '2d' })} />
                <Opt label="3D approach" onPress={() => upd(icao, { dim: '3d' })} />
              </View>
            ) : null}

            {/* steg 2 — approach-typ */}
            {v.dim && !v.app ? (
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {APP_TYPES[v.dim].map((a) => <Opt key={a} label={a} onPress={() => upd(icao, { app: a })} />)}
              </View>
            ) : null}

            {/* steg 3 — runway */}
            {v.app && !v.rwy ? (
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <Text style={{ fontFamily: FONT_MONO, fontSize: 9, color: Colors.textMuted, marginRight: 2 }}>RWY</Text>
                {(rwys.length ? rwys : ['—']).map((r) => <Opt key={r} label={r} onPress={() => upd(icao, { rwy: r === '—' ? undefined : r })} />)}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
