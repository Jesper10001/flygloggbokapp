// ApproachFlow — per ICAO (ankomst + ev. stopp, EJ avgång): välj 2D/3D → subkategori →
// exakt approach → runway. Resultatet byggs in i remarks (se add.tsx), t.ex. "ESCF PU - ILS 08"
// för ett stopp eller "ESSA ILS 27" för ankomsten. Kedjan visar bara nästa steg i taget.
//
// Klassificering (ICAO/EASA): 3D = vertikal ledning (precision + APV), 2D = enbart lateral (NPA).
import { View, Text, TouchableOpacity } from 'react-native';
import { Colors } from '../../constants/colors';
import { FONT_MONO } from '../logbook-page/tokens';

export type ApproachVal = { dim?: '2d' | '3d'; cat?: string; app?: string; rwy?: string };

// Två nivåer: subkategori → exakta approacher (fler val än som får plats på en rad ⇒ mellansteg).
export const APP_TREE: Record<'2d' | '3d', { cat: string; opts: string[] }[]> = {
  '2d': [
    { cat: 'RNAV', opts: ['LNAV', 'LP'] },
    { cat: 'VOR', opts: ['VOR', 'VOR/DME'] },
    { cat: 'NDB', opts: ['NDB', 'NDB/DME'] },
    { cat: 'LOC', opts: ['LOC', 'LOC/DME', 'LDA', 'SDF', 'IGS'] },
    { cat: 'Radar', opts: ['SRA'] },
  ],
  '3d': [
    { cat: 'ILS', opts: ['ILS', 'ILS CAT II', 'ILS CAT III'] },
    { cat: 'RNAV', opts: ['LPV', 'LNAV/VNAV', 'RNP AR'] },
    { cat: 'GLS', opts: ['GLS', 'MLS'] },
    { cat: 'PAR', opts: ['PAR'] },
  ],
};

// Platt uppslag + parse-hjälp (används av add.tsx för remarks ↔ state).
export const ALL_APPROACHES: { app: string; dim: '2d' | '3d'; cat: string }[] =
  (['2d', '3d'] as const).flatMap((d) => APP_TREE[d].flatMap((g) => g.opts.map((app) => ({ app, dim: d, cat: g.cat }))));

export function dimForApp(app: string): '2d' | '3d' | undefined {
  const u = app.toUpperCase();
  return ALL_APPROACHES.find((x) => x.app.toUpperCase() === u)?.dim;
}
export function catForApp(app: string): string | undefined {
  const u = app.toUpperCase();
  return ALL_APPROACHES.find((x) => x.app.toUpperCase() === u)?.cat;
}
export function normApp(app: string): string {
  const u = app.toUpperCase();
  return ALL_APPROACHES.find((x) => x.app.toUpperCase() === u)?.app ?? app.toUpperCase();
}
// Första ordet i varje approach — för att känna igen approach-rader i remarks ("ESSA ILS 27").
export const APP_FIRST_WORDS = Array.from(new Set(ALL_APPROACHES.map((x) => x.app.split(/[ /]/)[0].toUpperCase())));

// Bakåtkompatibilitet: gammalt APP_TYPES-API (add.tsx importerar det historiskt).
export const APP_TYPES: Record<'2d' | '3d', string[]> = {
  '2d': APP_TREE['2d'].flatMap((g) => g.opts),
  '3d': APP_TREE['3d'].flatMap((g) => g.opts),
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
        const cats = v.dim ? APP_TREE[v.dim] : [];
        const opts = v.dim && v.cat ? (cats.find((c) => c.cat === v.cat)?.opts || []) : [];
        return (
          <View key={icao} style={{ backgroundColor: Colors.elevated, borderWidth: 1, borderColor: Colors.border, borderRadius: 11, paddingHorizontal: 11, paddingVertical: 9 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text style={{ fontFamily: FONT_MONO, fontSize: 14, fontWeight: '800', letterSpacing: 0.5, color: Colors.textPrimary }}>{icao}</Text>
              {v.app ? (
                <Text style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: '700', color: Colors.primary }}>{v.app}{v.rwy ? ` ${v.rwy}` : ''}</Text>
              ) : v.cat ? (
                <Text style={{ fontFamily: FONT_MONO, fontSize: 11, fontWeight: '700', color: Colors.textSecondary }}>{v.dim?.toUpperCase()} · {v.cat}</Text>
              ) : v.dim ? (
                <Text style={{ fontFamily: FONT_MONO, fontSize: 11, fontWeight: '700', color: Colors.textSecondary }}>{v.dim.toUpperCase()}</Text>
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
                <Opt label="2D approach" onPress={() => upd(icao, { dim: '2d', cat: undefined, app: undefined, rwy: undefined })} />
                <Opt label="3D approach" onPress={() => upd(icao, { dim: '3d', cat: undefined, app: undefined, rwy: undefined })} />
              </View>
            ) : null}

            {/* steg 2 — subkategori */}
            {v.dim && !v.cat ? (
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {cats.map((c) => <Opt key={c.cat} label={c.cat} onPress={() => upd(icao, { cat: c.cat, app: undefined, rwy: undefined })} />)}
              </View>
            ) : null}

            {/* steg 3 — exakt approach inom subkategorin */}
            {v.cat && !v.app ? (
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {opts.map((a) => <Opt key={a} label={a} onPress={() => upd(icao, { app: a })} />)}
              </View>
            ) : null}

            {/* steg 4 — runway */}
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
