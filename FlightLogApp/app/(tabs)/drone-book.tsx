// Drönar-Book — renderar ett riktigt EASA-uppslag av drönar-flygningarna via den
// befintliga loggboksmotorn (icke-invasivt, se services/logbook/droneSpread.ts).
// Visar senaste uppslaget skalat till fliken (samma mönster som manned-preview).

import { useCallback, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { getTemplate } from '../../constants/logbookTemplates';
import { useDroneFlightStore } from '../../store/droneFlightStore';
import { useTimeFormatStore } from '../../store/timeFormatStore';
import { buildDroneSpreads, loadDroneMetaById } from '../../services/logbook/droneSpread';
import { SpreadWebView } from '../../components/logbook/SpreadWebView';
import { DR } from '../../constants/droneTheme';

const SERIF = 'Fraunces';
const MONO = 'JetBrainsMono';
const MARGIN = 16;

export default function DroneBookScreen() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { flights, loadFlights } = useDroneFlightStore();
  const timeFormat = useTimeFormatStore((s) => s.timeFormat);
  const [aspect, setAspect] = useState(0.62);
  const [dronesById, setDronesById] = useState<Map<number, { model: string; klass: string }>>(new Map());

  useFocusEffect(useCallback(() => {
    loadFlights();
    loadDroneMetaById().then(setDronesById).catch(() => {});
  }, [loadFlights]));

  const template = useMemo(() => getTemplate('sv-drone-logbook'), []);
  const spreads = useMemo(
    () => buildDroneSpreads(flights, { startingPage: 1, rowsPerSpread: template.rows_per_spread, openingBalance: {}, leadingEmptyRows: 0 }, dronesById),
    [flights, template, dronesById],
  );
  const spread = spreads[spreads.length - 1];

  const contentWidth = useMemo(
    () => [...template.left_columns, ...template.right_columns].reduce((sum, c) => sum + (c.width || 0), 0),
    [template],
  );
  const previewW = Math.max(220, width - 24);
  const viewportWidth = contentWidth + 34 + MARGIN * 2;
  const scale = viewportWidth > 0 ? previewW / viewportWidth : 1;
  const naturalH = viewportWidth * aspect + MARGIN;
  const previewH = viewportWidth > 0 ? Math.round(naturalH * scale) : Math.round(previewW * 0.5);

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <View style={s.header}>
        <Text style={s.title}>Logbook</Text>
        <Text style={s.sub}>{flights.length} {flights.length === 1 ? 'FLIGHT' : 'FLIGHTS'} · DRONE SPREAD</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 12, alignItems: 'center', gap: 12 }}>
        <View style={[s.sheet, { width: previewW, height: previewH }]}>
          {spread ? (
            <View style={{ position: 'absolute', width: viewportWidth, height: naturalH, left: (previewW - viewportWidth) / 2, top: (previewH - naturalH) / 2, transform: [{ scale }] }}>
              <SpreadWebView
                spread={spread}
                template={template}
                pilotName=""
                timeFormat={timeFormat}
                width={viewportWidth}
                signature={null}
                interactive={false}
                margin={MARGIN}
                onAspect={setAspect}
              />
            </View>
          ) : null}
        </View>
        <Text style={s.note}>
          Drone-specific columns (distance, max altitude, mission) are free-text on the
          paper spread. Full multi-page book & PDF export coming next.
        </Text>
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: DR.bgDeep },
  header: { paddingHorizontal: 16, paddingBottom: 10, paddingTop: 6, backgroundColor: DR.surface, borderBottomWidth: 0.5, borderBottomColor: DR.separator },
  title: { fontFamily: SERIF, fontSize: 22, fontWeight: '500', color: DR.text },
  sub: { fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1, color: DR.muted, marginTop: 2 },
  sheet: { overflow: 'hidden', borderRadius: 12, backgroundColor: '#ECE3CC', borderWidth: 1, borderColor: DR.border },
  note: { color: DR.text3, fontSize: 12, lineHeight: 17, paddingHorizontal: 8 },
});
