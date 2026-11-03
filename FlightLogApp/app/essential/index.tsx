// Blades Essential: ett enkelt skal för den som bara vill logga och ha loggboken digitalt. Sex knappar och
// abonnemanget, ovanpå samma data och funktioner som den vanliga appen (Blades Extensive).
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import Svg, { Path } from 'react-native-svg';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { AppBackground } from '../../components/AppBackground';
import { DialogIcon, GlassDialog } from '../../components/GlassDialog';
import { GlassMenu, type GlassMenuAnchor, type GlassMenuOption } from '../../components/GlassMenu';
import { useAcarsScanStart } from '../../components/AcarsScanChooser';
import { useDroneScanStart } from '../../components/DroneScanChooser';
import { useLogbookScanStart } from '../../components/LogbookScanChooser';
import { UpdateAvailableModal } from '../../components/UpdateAvailableModal';
import { UpdateAppliedModal } from '../../components/UpdateAppliedModal';
import { DraftBanner } from '../../components/DraftBanner';
import { useToastStore } from '../../components/Toast';
import { FONT_MONO, FONT_SERIF } from '../../components/logbook-page/tokens';
import { getDroneFlightCount } from '../../db/drones';
import { exportDroneFlightsToCSV, exportToCSV } from '../../services/export';
import { switchLogbookMode } from '../../services/logbookMode';
import { enrichDroneModels } from '../../services/droneImport';
import { takeSkippedFleet } from '../../services/essentialFleet';
import { enrichFleetInBackground } from '../../services/fleetEnrich';
import { useFleetDoneStore } from '../../components/FleetDoneModal';
import { presentManageSubscription, presentPaywall } from '../../services/purchases';
import { useAppModeStore } from '../../store/appModeStore';
import { useAppVariantStore } from '../../store/appVariantStore';
import { useDroneAccentStore } from '../../store/droneAccentStore';
import { useDroneFlightStore } from '../../store/droneFlightStore';
import { useFlightStore } from '../../store/flightStore';
import { decimalToHHMM } from '../../hooks/useTimeFormat';
import { useRegulationStandardStore } from '../../store/regulationStandardStore';
import { SCAN_OPEN } from '../../store/scanStore';

type MenuKey = 'log' | 'import' | 'export' | 'mode';

// Tunna linjeikoner, samma streck överallt.
const ICONS = {
  plus: 'M12 5v14M5 12h14',
  book: 'M12 6.5C10 5 7 4.5 4 5v13.5c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5zM12 6.5V20',
  import: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M5 20h14',
  export: 'M12 15V4M7.5 8.5 12 4l4.5 4.5M5 20h14',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z',
  swap: 'M4 8h14M14.5 4.5 18 8l-3.5 3.5M20 16H6M9.5 12.5 6 16l3.5 3.5',
  card: 'M3.5 6h17v12h-17zM3.5 10h17',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M13 5h4v4h-4zM7 15h4v4H7z',
};

function LineIcon({ d, color, size = 24, width = 1.5 }: { d: string; color: string; size?: number; width?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d={d} stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// hasMenu: tre prickar när knappen öppnar val, annars pil till en egen sida.
function MenuRow({ icon, label, accent, hasMenu, busy, onPress, onRef }: {
  icon: keyof typeof ICONS; label: string; accent: string; hasMenu?: boolean; busy?: boolean; onPress: () => void; onRef?: (v: View | null) => void;
}) {
  return (
    <TouchableOpacity ref={onRef as any} style={s.row} onPress={onPress} disabled={busy} activeOpacity={0.6} accessibilityRole="button" accessibilityLabel={label}>
      <View style={s.rowIcon}>
        {busy ? <ActivityIndicator color={accent} /> : <LineIcon d={ICONS[icon]} color={accent} />}
      </View>
      <Text style={s.rowLabel}>{label}</Text>
      {hasMenu
        ? <Ionicons name="ellipsis-horizontal" size={18} color={Colors.textSecondary} />
        : <LineIcon d="M9 6l6 6-6 6" color={Colors.textSecondary} size={18} width={2} />}
    </TouchableOpacity>
  );
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.total} accessible accessibilityLabel={`${label === 'YTD' ? 'Year to date' : 'Total flight time'}, ${value}`}>
      <Text style={s.totalValue} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={s.totalLabel}>{label}</Text>
    </View>
  );
}

export default function EssentialHome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const mode = useAppModeStore((st) => st.mode);
  const isDrone = mode === 'drone';
  const droneAccent = useDroneAccentStore((st) => st.color);
  const loadAccent = useDroneAccentStore((st) => st.load);
  const accent = isDrone ? droneAccent : Colors.primary;
  const { isPremium, isMax } = useFlightStore();
  const standard = useRegulationStandardStore((st) => st.standard);
  const paying = isPremium || isMax;
  const { t } = useTranslation();
  const pilotStats = useFlightStore((st) => st.stats);
  const droneStats = useDroneFlightStore((st) => st.stats);
  const stats = isDrone ? droneStats : pilotStats;

  useEffect(() => { loadAccent(); }, [loadAccent]);
  // Gratisgränsen i Log Flight räknar sparade flygningar. Totalerna överst läses om efter varje loggad flygning.
  useFocusEffect(useCallback(() => {
    if (isDrone) {
      useFlightStore.getState().loadDroneFlightCount();
      useDroneFlightStore.getState().loadStats().catch(() => {});
    } else {
      useFlightStore.getState().loadFlights();
      useFlightStore.getState().loadStats().catch(() => {});
    }
  }, [isDrone]));

  const acarsScan = useAcarsScanStart();
  const logbookScan = useLogbookScanStart();
  const droneScan = useDroneScanStart();

  // ── Glasmenyn vid knappen ──
  const refs = useRef<Partial<Record<MenuKey, View | null>>>({});
  const [menu, setMenu] = useState<{ key: MenuKey; anchor: GlassMenuAnchor } | null>(null);
  const openMenu = (key: MenuKey) => {
    refs.current[key]?.measureInWindow((x, y, w, h) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      setMenu({ key, anchor: { x, y, w, h } });
    });
  };

  // ── Export ──
  const [exporting, setExporting] = useState(false);
  const exportCsv = async () => {
    setExporting(true);
    try {
      if (isDrone) {
        if ((await getDroneFlightCount()) === 0) { useToastStore.getState().show('No drone flights to export yet'); return; }
        await exportDroneFlightsToCSV();
      } else {
        await exportToCSV(standard === 'other' ? 'easa' : standard); // 'other' → EASA-format i CSV
      }
    } catch (e: any) { Alert.alert(t('export_failed'), e.message); }
    finally { setExporting(false); }
  };

  // ── Logbook mode ──
  // target behålls när rutan stängs, så att texten inte byter riktning under uttoningen.
  const [askMode, setAskMode] = useState<{ open: boolean; target: 'manned' | 'drone' }>({ open: false, target: 'drone' });
  const closeMode = () => setAskMode((d) => ({ ...d, open: false }));
  const confirmMode = () => {
    closeMode();
    switchLogbookMode(askMode.target).catch((e) => Alert.alert('Could not switch', e?.message ?? ''));
  };
  const backToExtensive = () => {
    // Variant först: flikarna skickar annars direkt tillbaka hit.
    useAppVariantStore.getState().setVariant('extensive').catch(() => {});
    router.replace((isDrone ? '/(tabs)/drone-dashboard' : '/(tabs)') as any);
    fetchSkippedFleet().catch(() => {});
  };

  // ── Valen per knapp ──
  const options: Record<MenuKey, GlassMenuOption[]> = {
    log: isDrone ? [
      { key: 'manual', label: 'Manual entry', icon: 'create-outline', onPress: () => router.push('/drone-flight/add') },
      { key: 'scan', label: 'Instrument scan', icon: 'scan-outline', onPress: droneScan.start },
    ] : [
      { key: 'manual', label: 'Manual entry', icon: 'create-outline', onPress: () => router.push('/flight/add') },
      { key: 'acars', label: 'ACARS scan', icon: 'hardware-chip-outline', onPress: acarsScan.start },
      ...(SCAN_OPEN ? [{ key: 'logbook', label: 'Logbook scan', icon: 'book-outline' as const, onPress: logbookScan.start }] : []),
    ],
    import: [
      { key: 'csv', label: 'CSV import', icon: 'document-attach-outline', onPress: () => router.push(isDrone ? '/drone-import' : '/import') },
      { key: 'block', label: 'Block import manually', icon: 'create-outline', onPress: () => router.push(isDrone ? '/drone-import/manual' : '/import/manual') },
    ],
    export: [
      { key: 'pages', label: 'Pages', icon: 'document-text-outline', onPress: () => router.push('/essential/export-pages') },
      { key: 'csv', label: 'CSV', icon: 'grid-outline', onPress: exportCsv },
      ...(isDrone ? [] : [{ key: 'custom', label: 'Custom CSV', icon: 'options-outline' as const, onPress: () => router.push('/settings/custom-export') }]),
    ],
    mode: [
      { key: 'pilot', label: 'Pilot logbook', icon: 'airplane-outline', selected: !isDrone, onPress: () => { if (isDrone) setAskMode({ open: true, target: 'manned' }); } },
      { key: 'drone', label: 'Drone logbook', icon: 'hardware-chip-outline', selected: isDrone, onPress: () => { if (!isDrone) setAskMode({ open: true, target: 'drone' }); } },
      { key: 'extensive', label: 'Blades Extensive', icon: 'apps-outline', onPress: backToExtensive },
    ],
  };

  return (
    <View style={{ flex: 1 }}>
      <AppBackground accent={accent} />
      <ScrollView contentContainerStyle={[s.content, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 16 }]} showsVerticalScrollIndicator={false}>
        <Text style={s.eyebrow}>{isDrone ? 'DRONE LOGBOOK' : 'PILOT LOGBOOK'}</Text>
        {/* Total flygtid och i år, alltid H:MM som på dashboarden ("–" tills de lästs, i stället för 0:00). */}
        <View style={s.totals}>
          <Total label="TOTAL FLIGHT TIME" value={stats ? decimalToHHMM(stats.total_time ?? 0) : '–'} />
          <Total label="YTD" value={stats ? decimalToHHMM(stats.year_to_date ?? 0) : '–'} />
        </View>

        <View style={s.draft}>
          <DraftBanner mode={isDrone ? 'drone' : 'pilot'} onOpen={() => router.push(isDrone ? '/drone-flight/add?draft=1' : '/flight/add?draft=1')} />
        </View>

        <View style={s.rows}>
          <MenuRow icon="plus" label="Log flight" accent={accent} hasMenu onRef={(v) => { refs.current.log = v; }} onPress={() => openMenu('log')} />
          <MenuRow icon="book" label="Logbook" accent={accent} onPress={() => router.push('/essential/logbook')} />
          <MenuRow icon="import" label="Import" accent={accent} hasMenu onRef={(v) => { refs.current.import = v; }} onPress={() => openMenu('import')} />
          <MenuRow icon="export" label="Export" accent={accent} hasMenu busy={exporting} onRef={(v) => { refs.current.export = v; }} onPress={() => openMenu('export')} />
          <MenuRow icon="lock" label="Security" accent={accent} onPress={() => router.push('/essential/security')} />
          <MenuRow icon="swap" label="Logbook mode" accent={accent} hasMenu onRef={(v) => { refs.current.mode = v; }} onPress={() => openMenu('mode')} />
          <MenuRow icon="settings" label="Settings" accent={accent} onPress={() => router.push('/essential/settings')} />
        </View>

        <TouchableOpacity
          style={s.subscription}
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityLabel={`Subscription, ${paying ? 'Active' : 'Upgrade'}`}
          onPress={() => {
            if (paying) presentManageSubscription().then((ok) => { if (!ok) router.push('/settings/premium'); });
            else presentPaywall();
          }}
        >
          <View style={s.rowIcon}>
            <LineIcon d={ICONS.card} color={Colors.gold} />
          </View>
          <Text style={s.subscriptionLabel}>Subscription</Text>
          <Text style={s.subscriptionState}>{paying ? 'ACTIVE' : 'UPGRADE'}</Text>
        </TouchableOpacity>
      </ScrollView>

      <GlassMenu anchor={menu?.anchor ?? null} options={menu ? options[menu.key] : []} onClosed={() => setMenu(null)} accent={accent} />
      {acarsScan.chooser}
      {logbookScan.chooser}
      {droneScan.chooser}
      <GlassDialog
        visible={askMode.open}
        onClose={closeMode}
        icon={<DialogIcon name="swap-horizontal-outline" color={accent} />}
        eyebrow="Logbook mode"
        title={askMode.target === 'drone' ? 'Switch to Drone logbook?' : 'Switch to Pilot logbook?'}
        body={`All data in ${askMode.target === 'drone' ? 'Pilot' : 'Drone'} mode is saved.`}
        primary={{ label: 'Switch', onPress: confirmMode }}
        secondary={{ label: 'Cancel', onPress: closeMode }}
      />
      <UpdateAvailableModal />
      <UpdateAppliedModal />
    </View>
  );
}

// Fleet-data som inte hämtades i Essential hämtas nu, med samma popup som efter en import.
async function fetchSkippedFleet() {
  const { aircraft, drones } = await takeSkippedFleet();
  if (aircraft.length) {
    const res = await enrichFleetInBackground(aircraft);
    if (res.enriched > 0 || res.stoppedForQuota) useFleetDoneStore.getState().show(res);
  }
  if (drones.length) {
    const res = await enrichDroneModels(drones);
    if (res.enriched > 0 || res.stoppedForQuota) useFleetDoneStore.getState().show(res, '/(tabs)/drone-log');
  }
}

const HAIRLINE = 'rgba(255,255,255,0.12)';

const s = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: 20 },
  eyebrow: { fontFamily: FONT_MONO, fontSize: 11, fontWeight: '700', letterSpacing: 2.2, color: Colors.textSecondary },
  totals: { flexDirection: 'row', gap: 24, marginTop: 8, marginBottom: 14 },
  total: { flexShrink: 1 },
  totalValue: { fontFamily: FONT_SERIF, fontSize: 38, fontWeight: '500', letterSpacing: -0.4, color: Colors.textPrimary, fontVariant: ['tabular-nums'] },
  totalLabel: { fontFamily: FONT_MONO, fontSize: 10, fontWeight: '700', letterSpacing: 1.8, color: Colors.textSecondary, marginTop: 2 },
  draft: { marginTop: -10, marginBottom: 14 },
  rows: { borderTopWidth: 1, borderTopColor: HAIRLINE, marginBottom: 20 },
  row: { height: 72, flexDirection: 'row', alignItems: 'center', gap: 16, borderBottomWidth: 1, borderBottomColor: HAIRLINE },
  rowIcon: { width: 24, alignItems: 'center' },
  rowLabel: { flex: 1, fontFamily: FONT_SERIF, fontSize: 23, fontWeight: '500', color: Colors.textPrimary },
  subscription: { height: 64, marginTop: 'auto', flexDirection: 'row', alignItems: 'center', gap: 16 },
  subscriptionLabel: { flex: 1, color: Colors.textPrimary, fontSize: 16, fontWeight: '600' },
  subscriptionState: { fontFamily: FONT_MONO, fontSize: 11, fontWeight: '700', letterSpacing: 1.6, color: Colors.gold },
});
