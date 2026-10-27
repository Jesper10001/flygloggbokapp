// Fleet-tomtillstånd: en SOLFJÄDER av små, rektangulära kort (spelkorts-proportioner) där de bakre korten
// bara tittar fram litegrann bakom det främsta — som en kortlek man håller i handen. Det främre kortet är
// byggt som ett RIKTIGT fleet-kort i miniatyr: liten bild-banner (gradient + cutout-spill som riktiga
// kortet), header med modell + tillverkare till vänster och total till höger, samt en spec-rad. Siffrorna är
// exempel. Bilden hämtas gratis via Wikipedia och sparas aldrig. Delas av FleetView + drönarens FleetTab.
import { useEffect } from 'react';
import { View, Text, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Colors } from '../../constants/colors';
import { useFleetPreviewImageStore } from '../../store/fleetPreviewImageStore';
import { PhotoCreditLabel } from '../PhotoCreditLabel';
import { FONT_SERIF, FONT_MONO } from './tokens';

type Kind = 'rotary' | 'fixed' | 'drone';
type Spec = { label: string; value: string; unit: string };

const FRONT: Record<Kind, {
  key: string; name: string; maker: string; total: string; imgKind: 'ac' | 'drone';
  icon: keyof typeof Ionicons.glyphMap; queries: string[]; specs: Spec[];
}> = {
  rotary: {
    key: 'preview:UH-60', name: 'UH-60', maker: 'Sikorsky', total: '640', imgKind: 'ac', icon: 'airplane-outline',
    queries: ['Sikorsky UH-60 Black Hawk', 'UH-60 Black Hawk', 'Black Hawk helicopter'],
    specs: [{ label: 'Cruise', value: '150', unit: 'kt' }, { label: 'MTOW', value: '10', unit: 't' }],
  },
  fixed: {
    key: 'preview:A320', name: 'A320', maker: 'Airbus', total: '1,240', imgKind: 'ac', icon: 'airplane-outline',
    queries: ['Airbus A320', 'Airbus A320neo', 'A320 airliner'],
    specs: [{ label: 'Cruise', value: '447', unit: 'kt' }, { label: 'MTOW', value: '78', unit: 't' }],
  },
  drone: {
    key: 'preview:Matrice4T', name: 'Matrice 4T', maker: 'DJI', total: '92', imgKind: 'drone', icon: 'hardware-chip-outline',
    // Matrice 4T är ny → kan saknas på Wikipedia; fall tillbaka på närliggande DJI Matrice-modeller
    // (sista = Matrice 350 RTK, samma som demo-korten använder → garanterad riktig bild).
    queries: ['DJI Matrice 4T', 'DJI Matrice 4', 'DJI Matrice 400', 'DJI Matrice 350 RTK'],
    specs: [{ label: 'Flight', value: '49', unit: 'min' }, { label: 'Speed', value: '82', unit: 'km/h' }],
  },
};

// Spelkorts-proportioner (lite mindre). Alla kort delar samma botten-pivot → äkta solfjäder.
const CARD_W = 128;
const CARD_H = 180;
const BANNER_H = 78; // liten bild-banner (som andelen i riktiga fleet-kortet, inte en bild-dominerad trading card)

// Gemensam kort-stomme (navy + ram + skugga) så korten separerar mot den navyfärgade bakgrunden.
// OBS: ingen overflow:'hidden' här — på iOS klipper det bort skuggan OCH cutout-spillet. Bilden klipps i
// stället av sitt eget banner-barn (top-radier + overflow:hidden), så skugga + cutout blir kvar.
const cardBase = {
  position: 'absolute' as const, bottom: 14, left: '50%' as const, marginLeft: -CARD_W / 2 + 34,
  width: CARD_W, height: CARD_H, borderRadius: 14, backgroundColor: Colors.card,
  borderWidth: 1, borderColor: Colors.border,
  transformOrigin: 'bottom center' as any, // RN ≥0.74 — rotera kring nederkanten (handflat-fjäder)
  shadowColor: '#000', shadowOpacity: 0.38, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6,
};

// Bakre kort: kortrygg-känsla med ett litet hörn-index (ikon + pip) som tittar fram, likt en spelkorts-hörnsiffra.
function BackCard({ rotate, icon, accent }: { rotate: number; icon: keyof typeof Ionicons.glyphMap; accent: string }) {
  return (
    <View style={[cardBase, { transform: [{ rotate: `${rotate}deg` }] }]}>
      <View style={{ position: 'absolute', top: 8, left: 8, alignItems: 'center', gap: 3 }}>
        <Ionicons name={icon} size={14} color={Colors.textMuted} />
        <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: accent + '99' }} />
      </View>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={30} color={Colors.border} />
      </View>
    </View>
  );
}

export function FleetEmptyPreview({ kind, accent }: { kind: Kind; accent: string }) {
  const front = FRONT[kind];
  const isDrone = kind === 'drone';
  const entry = useFleetPreviewImageStore((s) => s.byKey[front.key]);
  useEffect(() => { useFleetPreviewImageStore.getState().load(front.key, front.queries, front.imgKind); }, [front.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const img = entry?.image ?? null;
  const cutout = entry?.cutout ?? null;
  const aspect = entry?.aspect || 1.6;
  // Bilden placeras EXAKT som i riktiga fleet-kortet: passa bredden (1.05× zoom), centrera i x och biasa
  // uppåt så motivet sitter fint och ev. cutout spiller något nedåt över bannern.
  const ZOOM = 1.05;
  const imgW = CARD_W * ZOOM;
  const imgH = imgW / aspect;
  const imgStyle = { position: 'absolute' as const, left: -(CARD_W * (ZOOM - 1)) / 2, top: -Math.max(0, imgH - BANNER_H) * 0.42, width: imgW, height: imgH };

  return (
    <View style={{ paddingTop: 6, paddingBottom: 6 }}>
      {/* Liten introtext (samma stil som Physical logbook / Logbook-sidorna). */}
      <View style={{ paddingHorizontal: 18 }}>
        <Text style={{ fontFamily: FONT_SERIF, fontSize: 19, fontWeight: '600', color: Colors.textPrimary, textAlign: 'center' }}>
          {isDrone ? 'No drones yet?' : 'No aircraft yet?'}
        </Text>
        <Text style={{ fontSize: 13, color: Colors.textSecondary, textAlign: 'center', marginTop: 4, lineHeight: 19 }}>
          {isDrone
            ? 'Every drone you fly becomes a card with its specs, photo and hours — here is how your fleet will look.'
            : 'Every aircraft you fly becomes a card with its specs, photo and hours — here is how your fleet will look.'}
        </Text>
      </View>

      <View style={{ width: '100%', height: CARD_H + 30, position: 'relative', marginTop: 20 }}>
        {/* Bakre korten (målas först → hamnar bakom), fanade åt vänster från gemensam botten-pivot. */}
        <BackCard rotate={-30} icon={front.icon} accent={accent} />
        <BackCard rotate={-19} icon={front.icon} accent={accent} />
        <BackCard rotate={-9} icon={front.icon} accent={accent} />

        {/* Främre kortet — litet fleet-kort i miniatyr (lutar lätt åt höger, som referensen). */}
        <View style={[cardBase, { transform: [{ rotate: '5deg' }] }]}>
          {/* Banner: foto (klipps i barnet) + cutout som spiller över (sibling, overflow synligt). */}
          <View style={{ position: 'relative' }}>
            <View style={{ height: BANNER_H, overflow: 'hidden', borderTopLeftRadius: 13, borderTopRightRadius: 13, backgroundColor: Colors.elevated }}>
              {img ? <Image source={{ uri: img }} style={imgStyle} /> : (
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name={front.icon} size={24} color={Colors.textMuted} />
                </View>
              )}
              <LinearGradient colors={[Colors.card + '00', Colors.card + '88', Colors.card]} locations={[0.4, 0.8, 1]}
                style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} pointerEvents="none" />
            </View>
            {cutout ? (
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 3, overflow: 'visible' }} pointerEvents="none">
                <Image source={{ uri: cutout }} style={[imgStyle, { shadowColor: Colors.background, shadowOpacity: 0.5, shadowRadius: 6, shadowOffset: { width: 0, height: 5 } }]} />
              </View>
            ) : null}
          </View>

          {/* Innehåll: header (modell + tillverkare | total) + en spec-rad — som riktiga kortet. */}
          <View style={{ flex: 1, paddingHorizontal: 11, paddingTop: cutout ? 15 : 9, paddingBottom: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', paddingBottom: 7, borderBottomWidth: 1, borderBottomColor: Colors.separator }}>
              <View style={{ flex: 1, paddingRight: 6 }}>
                <Text numberOfLines={1} style={{ fontFamily: FONT_SERIF, fontSize: 18, fontWeight: '600', color: Colors.textPrimary, letterSpacing: -0.3 }}>{front.name}</Text>
                <Text numberOfLines={1} style={{ fontSize: 9.5, color: Colors.textMuted, marginTop: 1 }}>{front.maker}</Text>
              </View>
              <Text style={{ fontFamily: FONT_SERIF, fontSize: 16, fontWeight: '600', color: Colors.textPrimary, letterSpacing: -0.3 }}>
                {front.total}<Text style={{ fontFamily: FONT_MONO, fontSize: 8.5, fontWeight: '700', color: accent }}> h</Text>
              </Text>
            </View>
            <View style={{ flexDirection: 'row', marginTop: 9 }}>
              {front.specs.map((it, i) => (
                <View key={it.label} style={{ flex: 1, paddingHorizontal: 8, borderLeftWidth: i === 0 ? 0 : 1, borderLeftColor: Colors.separator, gap: 2 }}>
                  <Text numberOfLines={1} style={{ fontFamily: FONT_MONO, fontSize: 8, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: Colors.textMuted }}>{it.label}</Text>
                  <Text numberOfLines={1} style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: '700', color: Colors.textPrimary }}>
                    {it.value}<Text style={{ fontSize: 8, color: Colors.textMuted, fontWeight: '500' }}> {it.unit}</Text>
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      </View>
      {/* Exempelkortets foto (Wikimedia) — kortet är för litet för en kredit på bilden. */}
      {img ? <PhotoCreditLabel credit={entry?.credit} variant="inline" style={{ marginTop: 2 }} /> : null}
    </View>
  );
}
