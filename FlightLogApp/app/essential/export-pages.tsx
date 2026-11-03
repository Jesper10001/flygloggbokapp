// Blades Essential → Export → Pages: bläddra mellan loggbokstyper med dina senaste flygningar i förhandsvisningen,
// välj en och ange sedan hur många uppslag som exporteras. Ingen digital bok behöver skapas.
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, ScrollView, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../constants/colors';
import { LOGBOOK_TEMPLATES, type LogbookTemplate } from '../../constants/logbookTemplates';
import { AppBackground } from '../../components/AppBackground';
import { ExportPagesDialog, type PagesChoice } from '../../components/ExportPagesDialog';
import { EssentialHeader, useEssentialAccent } from '../../components/essential/EssentialUi';
import { SpreadWebView } from '../../components/logbook/SpreadWebView';
import { getCustomTemplates } from '../../db/customTemplates';
import { useTranslation } from '../../hooks/useTranslation';
import { getScannedTemplateId } from '../../services/logbook/bookFromScan';
import { exportTemplatePages, loadExportFlights, templateSpreads } from '../../services/logbook/exportPages';
import { useAppModeStore } from '../../store/appModeStore';
import { useTimeFormatStore } from '../../store/timeFormatStore';
import type { Flight } from '../../types/flight';

function TemplatePreview({ template, flights, width }: { template: LogbookTemplate; flights: Flight[]; width: number }) {
  const timeFormat = useTimeFormatStore((s) => s.timeFormat);
  const [ratioL, setRatioL] = useState(0.72);
  const [ratioR, setRatioR] = useState(0.72);
  const spread = useMemo(() => {
    const all = templateSpreads(flights, template);
    return all[all.length - 1] ?? null;
  }, [flights, template]);
  if (!spread) return <View style={{ width }} />;
  const page = (side: 'left' | 'right', ratio: number, onRatio: (r: number) => void) => (
    <View style={{ width, height: width * ratio, marginBottom: 6 }}>
      <SpreadWebView spread={spread} template={template} pilotName="" timeFormat={timeFormat} width={width} signature={null} interactive={false} bare
        bgColor={Colors.background} side={side} margin={0} onAspect={(r) => { if (r > 0 && Math.abs(r - ratio) > 0.01) onRatio(r); }} />
    </View>
  );
  return (
    <ScrollView style={{ width }} showsVerticalScrollIndicator={false}>
      {page('left', ratioL, setRatioL)}
      {page('right', ratioR, setRatioR)}
    </ScrollView>
  );
}

export default function EssentialExportPages() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { t } = useTranslation();
  const accent = useEssentialAccent();
  const kind = useAppModeStore((s) => s.mode) === 'drone' ? 'drone' as const : 'digital' as const;

  const [templates, setTemplates] = useState<LogbookTemplate[] | null>(null);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [index, setIndex] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [total, setTotal] = useState(0);
  const [choice, setChoice] = useState<PagesChoice>(3);
  const [custom, setCustom] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      const [mine, scannedId, rows] = await Promise.all([
        getCustomTemplates().catch(() => []),
        getScannedTemplateId().catch(() => null),
        loadExportFlights(kind).catch(() => []),
      ]);
      // Samma urval som när en bok skapas: den skannade boken först, utfasade mallar och fel läge bort.
      const scanned = mine.filter((c) => c.id === scannedId);
      const list = [...scanned, ...LOGBOOK_TEMPLATES, ...mine.filter((c) => c.id !== scannedId)]
        .filter((tpl) => (kind === 'drone') === tpl.id.includes('drone') && tpl.id !== 'sv-easa-standard');
      if (alive) { setTemplates(list); setFlights(rows); }
    })();
    return () => { alive = false; };
  }, [kind]);

  const selected = templates?.[index];
  const useTemplate = () => {
    if (!selected) return;
    if (flights.length === 0) { Alert.alert(t('export_logbook_pages'), t('dlb_export_empty')); return; }
    const count = templateSpreads(flights, selected).length;
    setTotal(count);
    setChoice(count < 3 ? 'whole' : 3);
    setCustom(String(count));
    setDialogOpen(true);
  };
  const runExport = async () => {
    setDialogOpen(false);
    if (!selected) return;
    const count = choice === 'whole' ? total : Math.max(1, Math.min(choice === 'custom' ? parseInt(custom || '0', 10) || 1 : choice, total));
    setExporting(true);
    try { await exportTemplatePages(selected, flights, count, kind); }
    catch (e: any) { Alert.alert(t('export_failed'), e?.message ?? ''); }
    finally { setExporting(false); }
  };

  return (
    <View style={{ flex: 1 }}>
      <AppBackground accent={accent} />
      <EssentialHeader title="Choose a logbook" />
      {!templates ? (
        <ActivityIndicator color={accent} style={{ marginTop: 40 }} />
      ) : (
        <>
          <View style={{ paddingHorizontal: 20, paddingBottom: 10 }}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: Colors.textPrimary }} numberOfLines={1}>{selected?.name ?? ''}</Text>
            <Text style={{ fontSize: 12, color: Colors.textSecondary, marginTop: 2 }}>Swipe to compare · {index + 1}/{templates.length}</Text>
          </View>
          <FlatList
            style={{ flex: 1 }}
            data={templates}
            keyExtractor={(tpl) => tpl.id}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            initialNumToRender={1}
            maxToRenderPerBatch={1}
            windowSize={3}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            onMomentumScrollEnd={(e) => setIndex(Math.round(e.nativeEvent.contentOffset.x / width))}
            renderItem={({ item }) => <TemplatePreview template={item} flights={flights} width={width} />}
          />
          <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: insets.bottom + 12 }}>
            <TouchableOpacity onPress={useTemplate} disabled={exporting} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Use this logbook"
              style={{ height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: accent }}>
              {exporting ? <ActivityIndicator color={Colors.textInverse} /> : <Text style={{ fontSize: 16, fontWeight: '800', color: Colors.textInverse }}>Use this logbook</Text>}
            </TouchableOpacity>
          </View>
        </>
      )}
      <ExportPagesDialog
        visible={dialogOpen}
        onClose={() => setDialogOpen(false)}
        choice={choice}
        onChoice={setChoice}
        custom={custom}
        onCustom={setCustom}
        total={total}
        onExport={runExport}
        accent={accent}
        text={{ title: t('export_logbook_pages'), choose: t('dlb_export_choose'), whole: 'Whole logbook', customPages: 'Custom pages', of: t('dlb_export_max'), note: t('dlb_export_note'), exportBtn: t('dlb_export_btn') }}
      />
    </View>
  );
}
