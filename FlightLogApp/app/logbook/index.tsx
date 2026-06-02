import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList, Modal, ScrollView,
  TextInput, ActivityIndicator, useWindowDimensions, Platform, Alert, Image, InteractionManager,
} from 'react-native';
import { WebView } from 'react-native-webview';
import * as ScreenOrientation from 'expo-screen-orientation';
import { useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { useAppModeStore } from '../../store/appModeStore';
import { useFlightStore } from '../../store/flightStore';
import { useTimeFormatStore } from '../../store/timeFormatStore';
import { parseTimeInput, formatTimeValue } from '../../hooks/useTimeFormat';
import { getSetting, setSetting } from '../../db/flights';
import {
  LOGBOOK_TEMPLATES, getTemplate, ASSIGNABLE_TIME_FIELDS,
  type LogbookTemplate, type LogbookColumn,
} from '../../constants/logbookTemplates';
import {
  buildSpreads, numericColumns,
  type LogbookConfig, type ColumnTotals, type LogbookSpread,
} from '../../services/logbook/paginate';
import { renderSpreadHTML } from '../../services/logbook/renderSpread';
import { type SignatureData } from '../../components/SignaturePad';

const KEY_INTRO = 'dlb_intro_seen';
const KEY_TEMPLATE = 'dlb_template_id';
const KEY_START = 'dlb_start_page';
const KEY_BALANCE = 'dlb_opening_balance';
const KEY_COLS = 'dlb_custom_cols';

// Bygger en effektiv mall där tomma kolumner fått en tilldelad flygtidstyp.
function applyCustomCols(template: LogbookTemplate, customCols: Record<string, string>): LogbookTemplate {
  if (!customCols || Object.keys(customCols).length === 0) return template;
  const apply = (c: LogbookColumn): LogbookColumn => {
    const fk = customCols[c.id];
    if (!fk) return c;
    const f = ASSIGNABLE_TIME_FIELDS.find((a) => a.key === fk);
    if (!f) return c;
    return { ...c, flightKey: f.key, format: f.format, label: f.label };
  };
  return {
    ...template,
    left_columns: template.left_columns.map(apply),
    right_columns: template.right_columns.map(apply),
  };
}

export default function LogbookScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { mode } = useAppModeStore();
  const { flights, loadFlights } = useFlightStore();
  const { timeFormat } = useTimeFormatStore();
  const styles = makeStyles();

  const [loading, setLoading] = useState(true);
  const [introSeen, setIntroSeen] = useState(true);
  const [templateId, setTemplateId] = useState('sv-easa-standard');
  const [startPage, setStartPage] = useState(1);
  const [openingBalance, setOpeningBalance] = useState<ColumnTotals>({});
  const [pilotName, setPilotName] = useState('');
  const [signature, setSignature] = useState<SignatureData | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const [showOverview, setShowOverview] = useState(false);
  const [showLayout, setShowLayout] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [customColsAll, setCustomColsAll] = useState<Record<string, Record<string, string>>>({});
  const [assignTarget, setAssignTarget] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);

  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    (async () => {
      const defTpl = mode === 'drone' ? 'sv-drone-logbook' : 'sv-easa-standard';
      const [seen, tpl, sp, ob, fn, ln, sg, cc] = await Promise.all([
        getSetting(KEY_INTRO),
        getSetting(KEY_TEMPLATE),
        getSetting(KEY_START),
        getSetting(KEY_BALANCE),
        getSetting('profile_first_name'),
        getSetting('profile_last_name'),
        getSetting('pilot_signature'),
        getSetting(KEY_COLS),
      ]);
      setIntroSeen(seen === '1');
      setTemplateId(tpl || defTpl);
      setStartPage(Math.max(1, parseInt(sp || '1', 10) || 1));
      try { setOpeningBalance(ob ? JSON.parse(ob) : {}); } catch { setOpeningBalance({}); }
      try { setSignature(sg ? JSON.parse(sg) : null); } catch { setSignature(null); }
      try { setCustomColsAll(cc ? JSON.parse(cc) : {}); } catch { setCustomColsAll({}); }
      setPilotName([fn, ln].filter(Boolean).join(' '));
      await loadFlights();
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Orientering: boken visas liggande, palett-/bokinställnings-modalerna stående.
  // Låsningen körs EFTER att navigeringsövergången hunnit klart — annars kan
  // appen kastas tillbaka när den försöker rotera mitt i transitionen.
  useEffect(() => {
    let cancelled = false;
    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;
      const lock = (showLayout || showSettings)
        ? ScreenOrientation.OrientationLock.PORTRAIT_UP
        : ScreenOrientation.OrientationLock.LANDSCAPE;
      ScreenOrientation.lockAsync(lock).catch(() => { /* ignore */ });
    });
    return () => { cancelled = true; (task as any)?.cancel?.(); };
  }, [showLayout, showSettings]);

  // Återställ till stående när vyn lämnas.
  useEffect(() => () => {
    ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP).catch(() => { /* ignore */ });
  }, []);

  const template = useMemo(() => getTemplate(templateId), [templateId]);
  const customCols = useMemo<Record<string, string>>(() => customColsAll[templateId] ?? {}, [customColsAll, templateId]);
  const effectiveTemplate = useMemo(() => applyCustomCols(template, customCols), [template, customCols]);
  const config = useMemo<LogbookConfig>(() => ({
    startingPage: startPage,
    rowsPerSpread: effectiveTemplate.rows_per_spread,
    openingBalance,
  }), [startPage, effectiveTemplate, openingBalance]);
  const spreads = useMemo(
    () => buildSpreads(flights, effectiveTemplate, config),
    [flights, effectiveTemplate, config],
  );

  // Flygtidstyper som kan läggas i en tom kolumn: inte redan i mallen + finns i datan.
  const availableTypes = useMemo(() => {
    const used = new Set<string>();
    for (const c of [...template.left_columns, ...template.right_columns]) {
      if (c.flightKey) used.add(c.flightKey);
    }
    if (used.has('tt_total')) used.add('total_time');
    if (used.has('sp_se')) used.add('se_time');
    if (used.has('sp_me')) used.add('me_time');
    const hasData = (key: string) => flights.some((f) => (parseFloat(String((f as any)[key])) || 0) > 0);
    return ASSIGNABLE_TIME_FIELDS.filter((a) => !used.has(a.key) && hasData(a.key));
  }, [template, flights]);

  const onAssign = useCallback((colId: string) => {
    setAssignTarget(colId);
    setAssignOpen(true);
  }, []);

  const applyAssign = async (flightKey: string | null) => {
    if (!assignTarget) return;
    const nextMap = { ...(customColsAll[templateId] ?? {}) };
    if (flightKey) nextMap[assignTarget] = flightKey; else delete nextMap[assignTarget];
    const nextAll = { ...customColsAll, [templateId]: nextMap };
    setCustomColsAll(nextAll);
    await setSetting(KEY_COLS, JSON.stringify(nextAll));
    setAssignOpen(false);
    setAssignTarget(null);
  };

  const safeIndex = Math.min(activeIndex, Math.max(0, spreads.length - 1));
  const current = spreads[safeIndex];
  const sheetMax = Math.min(520, Math.round(height * 0.62));

  // Håll uppslaget i synk om skärmens mått ändras (t.ex. vid rotation).
  useEffect(() => {
    const id = setTimeout(() => {
      try { listRef.current?.scrollToIndex({ index: safeIndex, animated: false }); } catch { /* ignore */ }
    }, 60);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width]);

  const goToIndex = (idx: number) => {
    const clamped = Math.max(0, Math.min(idx, spreads.length - 1));
    setActiveIndex(clamped);
    try { listRef.current?.scrollToIndex({ index: clamped, animated: false }); } catch { /* ignore */ }
  };

  // Loggböcker som passar nuvarande läge (manned vs drönare).
  const pickable = LOGBOOK_TEMPLATES.filter((tpl) => (mode === 'drone') === tpl.id.includes('drone'));

  // Välj bok i introt → spara mall + markera intro som sedd + öppna boken.
  const chooseAndStart = async (id: string) => {
    setTemplateId(id);
    setActiveIndex(0);
    await setSetting(KEY_TEMPLATE, id);
    await setSetting(KEY_INTRO, '1');
    setIntroSeen(true);
  };

  const saveTemplate = async (id: string) => {
    setTemplateId(id);
    setActiveIndex(0);
    await setSetting(KEY_TEMPLATE, id);
    setShowLayout(false);
    setTimeout(() => { try { listRef.current?.scrollToOffset({ offset: 0, animated: false }); } catch { /* ignore */ } }, 30);
  };

  const saveSettings = async (newStart: number, newBalance: ColumnTotals) => {
    setStartPage(newStart);
    setOpeningBalance(newBalance);
    await setSetting(KEY_START, String(newStart));
    await setSetting(KEY_BALANCE, JSON.stringify(newBalance));
    setShowSettings(false);
  };

  // ── Render-grenar ──────────────────────────────────────────────
  if (loading) {
    return (
      <View style={styles.center}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (!introSeen) {
    return <Intro templates={pickable} onChoose={chooseAndStart} onBack={() => router.back()} />;
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Header */}
      <View style={[styles.header, { paddingLeft: insets.left + 6, paddingRight: insets.right + 6 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={Colors.primary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.headerCenter}
          onPress={() => setShowOverview(true)}
          activeOpacity={0.7}
          disabled={flights.length === 0}
        >
          <Text style={styles.headerTitle}>{t('your_books')}</Text>
          {flights.length > 0 && current && (
            <View style={styles.headerSubRow}>
              <Text style={styles.headerSub}>
                {t('page')} {current.page_left}–{current.page_right} · {safeIndex + 1}/{spreads.length}
              </Text>
              <Ionicons name="chevron-down" size={12} color={Colors.textMuted} />
            </View>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setShowLayout(true)} style={styles.iconBtn} activeOpacity={0.7}>
          <Ionicons name="color-palette-outline" size={20} color={Colors.textSecondary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowSettings(true)} style={styles.iconBtn} activeOpacity={0.7}>
          <Ionicons name="options-outline" size={20} color={Colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {flights.length === 0 ? (
        <Empty onAdd={() => router.push('/flight/add')} />
      ) : (
        <>
          <FlatList
            ref={listRef}
            data={spreads}
            keyExtractor={(s) => String(s.spread_number)}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            key={templateId}
            getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
            initialNumToRender={1}
            maxToRenderPerBatch={2}
            windowSize={3}
            onMomentumScrollEnd={(e) => {
              const idx = Math.round(e.nativeEvent.contentOffset.x / width);
              setActiveIndex(idx);
            }}
            renderItem={({ item }) => (
              <SpreadPage
                spread={item}
                template={effectiveTemplate}
                pilotName={pilotName}
                timeFormat={timeFormat}
                width={width}
                signature={signature}
                onAssign={onAssign}
              />
            )}
          />
          <View style={[styles.footerHint, { paddingBottom: insets.bottom + 6 }]}>
            <Ionicons name="swap-horizontal" size={13} color={Colors.textMuted} />
            <Text style={styles.footerHintText}>{t('dlb_swipe_hint')}</Text>
          </View>
        </>
      )}

      {/* ── Sidöversikt ── */}
      <Modal visible={showOverview} animationType="slide" transparent supportedOrientations={['portrait', 'landscape']} onRequestClose={() => setShowOverview(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
            <SheetHeader title={t('dlb_overview')} onClose={() => setShowOverview(false)} />
            <ScrollView style={{ maxHeight: sheetMax }}>
              {spreads.map((s, i) => (
                <TouchableOpacity
                  key={s.spread_number}
                  style={[styles.ovRow, i === safeIndex && styles.ovRowActive]}
                  onPress={() => { setShowOverview(false); goToIndex(i); }}
                  activeOpacity={0.7}
                >
                  <Ionicons name="document-text-outline" size={18} color={i === safeIndex ? Colors.primary : Colors.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.ovTitle, i === safeIndex && { color: Colors.primary }]}>
                      {t('page')} {s.page_left}–{s.page_right}
                    </Text>
                    <Text style={styles.ovMeta}>
                      {s.flights.length} {t('flights').toLowerCase()}
                    </Text>
                  </View>
                  {i === spreads.length - 1 && (
                    <View style={styles.latestPill}><Text style={styles.latestPillText}>{t('dlb_latest')}</Text></View>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Layout-galleri ── */}
      <Modal visible={showLayout} animationType="slide" transparent supportedOrientations={['portrait', 'landscape']} onRequestClose={() => setShowLayout(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
            <SheetHeader title={t('dlb_choose_layout')} onClose={() => setShowLayout(false)} />
            <Text style={styles.sheetHint}>{t('dlb_choose_layout_sub')}</Text>
            <ScrollView style={{ maxHeight: sheetMax }}>
              {pickable.map((tpl) => (
                <LayoutCard
                  key={tpl.id}
                  template={tpl}
                  active={tpl.id === templateId}
                  onSelect={() => saveTemplate(tpl.id)}
                />
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Bokinställningar (startsida + ingående balans) ── */}
      <Modal visible={showSettings} animationType="slide" transparent supportedOrientations={['portrait', 'landscape']} onRequestClose={() => setShowSettings(false)}>
        <View style={styles.sheetBackdrop}>
          <SettingsSheet
            template={effectiveTemplate}
            startPage={startPage}
            openingBalance={openingBalance}
            timeFormat={timeFormat}
            onClose={() => setShowSettings(false)}
            onSave={saveSettings}
          />
        </View>
      </Modal>

      {/* ── Välj flygtidstyp för en tom kolumn ── */}
      <Modal visible={assignOpen} animationType="slide" transparent supportedOrientations={['portrait', 'landscape']} onRequestClose={() => setAssignOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
            <SheetHeader title={t('dlb_pick_time_type')} onClose={() => setAssignOpen(false)} />
            <Text style={styles.sheetHint}>{t('dlb_pick_time_type_sub')}</Text>
            <ScrollView style={{ maxHeight: sheetMax }}>
              {assignTarget && customCols[assignTarget] ? (
                <TouchableOpacity style={styles.ovRow} onPress={() => applyAssign(null)} activeOpacity={0.7}>
                  <Ionicons name="close-circle-outline" size={18} color={Colors.textMuted} />
                  <Text style={[styles.ovTitle, { color: Colors.textSecondary }]}>{t('dlb_remove_type')}</Text>
                </TouchableOpacity>
              ) : null}
              {availableTypes.length === 0 ? (
                <Text style={{ color: Colors.textMuted, fontSize: 13, padding: 16, textAlign: 'center' }}>{t('dlb_no_types')}</Text>
              ) : availableTypes.map((a) => {
                const active = !!assignTarget && customCols[assignTarget] === a.key;
                return (
                  <TouchableOpacity key={a.key} style={[styles.ovRow, active && styles.ovRowActive]} onPress={() => applyAssign(a.key)} activeOpacity={0.7}>
                    <Ionicons name="time-outline" size={18} color={active ? Colors.primary : Colors.textMuted} />
                    <Text style={[styles.ovTitle, active && { color: Colors.primary }]}>{a.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ════════════════════════════════════════════════════════════════
// Ett uppslag (memo:at så bläddring inte laddar om WebView:n)
// ════════════════════════════════════════════════════════════════
const SpreadPage = memo(function SpreadPage({
  spread, template, pilotName, timeFormat, width, signature, onAssign,
}: {
  spread: LogbookSpread; template: LogbookTemplate; pilotName: string;
  timeFormat: 'decimal' | 'hhmm'; width: number; signature?: SignatureData | null;
  onAssign?: (colId: string) => void;
}) {
  const html = useMemo(
    () => renderSpreadHTML({ template, spread, rowsPerSpread: template.rows_per_spread, pilotName, timeFormat, signature }),
    [template, spread, pilotName, timeFormat, signature],
  );
  return (
    <View style={{ width, flex: 1 }}>
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        style={{ flex: 1, backgroundColor: '#ECE3CC' }}
        showsVerticalScrollIndicator={false}
        scalesPageToFit={Platform.OS === 'android'}
        scrollEnabled
        onMessage={(e) => {
          try {
            const m = JSON.parse(e.nativeEvent.data);
            if (m && m.type === 'assignCol' && onAssign) onAssign(m.colId);
          } catch { /* ignore */ }
        }}
      />
    </View>
  );
});

// ════════════════════════════════════════════════════════════════
// Omslag + valkort för en loggbok
// ════════════════════════════════════════════════════════════════
function CoverThumb({ cover, style }: { cover?: number; style?: any }) {
  if (cover) return <Image source={cover} style={style} resizeMode="cover" />;
  return (
    <View style={[style, { alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.elevated }]}>
      <Ionicons name="book-outline" size={22} color={Colors.textMuted} />
    </View>
  );
}

function LogbookChoiceCard({ template, onPress }: { template: LogbookTemplate; onPress: () => void }) {
  const { t } = useTranslation();
  const styles = makeStyles();
  const desc = template.descriptionKey
    ? t(template.descriptionKey as any)
    : `${template.rows_per_spread} ${t('rows_per_spread')} · ${template.time_format === 'decimal' ? 'decimal' : 'HH:MM'}`;
  return (
    <TouchableOpacity style={styles.choiceCard} onPress={onPress} activeOpacity={0.85}>
      <CoverThumb cover={template.cover} style={styles.choiceCover} />
      <View style={{ flex: 1 }}>
        <Text style={styles.choiceName}>{template.name}</Text>
        <Text style={styles.choiceDesc} numberOfLines={4}>{desc}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
    </TouchableOpacity>
  );
}

// ════════════════════════════════════════════════════════════════
// Intro för nya användare
// ════════════════════════════════════════════════════════════════
function Intro({ templates, onChoose, onBack }: { templates: LogbookTemplate[]; onChoose: (id: string) => void; onBack: () => void }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const styles = makeStyles();
  const points: { icon: any; title: string; body: string }[] = [
    { icon: 'book-outline', title: t('dlb_intro_p1_t'), body: t('dlb_intro_p1_b') },
    { icon: 'calculator-outline', title: t('dlb_intro_p2_t'), body: t('dlb_intro_p2_b') },
    { icon: 'color-palette-outline', title: t('dlb_intro_p3_t'), body: t('dlb_intro_p3_b') },
    { icon: 'cloud-done-outline', title: t('dlb_intro_p4_t'), body: t('dlb_intro_p4_b') },
  ];
  return (
    <View style={[styles.container, { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.iconBtn} activeOpacity={0.7}>
          <Ionicons name="chevron-back" size={22} color={Colors.primary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}><Text style={styles.headerTitle}>{t('your_books')}</Text></View>
        <View style={styles.iconBtn} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40, gap: 18, width: '100%', maxWidth: 640, alignSelf: 'center' }}>
        <View style={styles.introHero}>
          <Ionicons name="book" size={34} color={Colors.primary} />
        </View>
        <Text style={styles.introTitle}>{t('dlb_intro_title')}</Text>
        <Text style={styles.introLead}>{t('dlb_intro_lead')}</Text>

        <View style={{ gap: 12, marginTop: 4 }}>
          {points.map((p) => (
            <View key={p.title} style={styles.introPoint}>
              <View style={styles.introPointIcon}>
                <Ionicons name={p.icon} size={18} color={Colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.introPointTitle}>{p.title}</Text>
                <Text style={styles.introPointBody}>{p.body}</Text>
              </View>
            </View>
          ))}
        </View>

        <Text style={styles.pickHeading}>{t('dlb_pick_your_book')}</Text>
        <View style={{ gap: 12 }}>
          {templates.map((tpl) => (
            <LogbookChoiceCard key={tpl.id} template={tpl} onPress={() => onChoose(tpl.id)} />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

// ════════════════════════════════════════════════════════════════
// Tom loggbok
// ════════════════════════════════════════════════════════════════
function Empty({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation();
  const styles = makeStyles();
  return (
    <View style={styles.emptyWrap}>
      <Ionicons name="documents-outline" size={48} color={Colors.textMuted} />
      <Text style={styles.emptyTitle}>{t('dlb_empty_title')}</Text>
      <Text style={styles.emptyBody}>{t('dlb_empty_body')}</Text>
      <TouchableOpacity style={styles.primaryBtn} onPress={onAdd} activeOpacity={0.85}>
        <Ionicons name="add" size={18} color={Colors.textInverse} />
        <Text style={styles.primaryBtnText}>{t('import_manual_title')}</Text>
      </TouchableOpacity>
    </View>
  );
}

// ════════════════════════════════════════════════════════════════
// Layout-kort (omslag + beskrivning) — ingen WebView (krockar i Modal)
// ════════════════════════════════════════════════════════════════
function LayoutCard({ template, active, onSelect }: {
  template: LogbookTemplate; active: boolean; onSelect: () => void;
}) {
  const styles = makeStyles();
  const { t } = useTranslation();
  return (
    <TouchableOpacity
      style={[styles.layoutCard, active && styles.layoutCardActive]}
      onPress={onSelect}
      activeOpacity={0.85}
    >
      <View style={styles.layoutHead}>
        <CoverThumb cover={template.cover} style={styles.layoutCover} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.layoutName, active && { color: Colors.primary }]}>{template.name}</Text>
          <Text style={styles.layoutMeta}>
            {template.rows_per_spread} {t('rows_per_spread')} · {template.time_format === 'decimal' ? 'decimal' : 'HH:MM'} · {template.language.toUpperCase()}
          </Text>
          {template.descriptionKey ? (
            <Text style={styles.layoutDesc} numberOfLines={3}>{t(template.descriptionKey as any)}</Text>
          ) : null}
        </View>
        {active && <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />}
      </View>
    </TouchableOpacity>
  );
}

// ════════════════════════════════════════════════════════════════
// Inställningar — startsida + ingående balans
// ════════════════════════════════════════════════════════════════
function SettingsSheet({
  template, startPage, openingBalance, timeFormat, onClose, onSave,
}: {
  template: LogbookTemplate; startPage: number; openingBalance: ColumnTotals;
  timeFormat: 'decimal' | 'hhmm';
  onClose: () => void;
  onSave: (startPage: number, balance: ColumnTotals) => void;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const styles = makeStyles();
  const cols = useMemo(() => numericColumns(template), [template]);

  const [pageStr, setPageStr] = useState(String(startPage));
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    for (const c of cols) {
      const v = openingBalance[c.flightKey!] ?? 0;
      if (!v) { o[c.flightKey!] = ''; continue; }
      o[c.flightKey!] = c.format === 'int' ? String(Math.round(v)) : formatTimeValue(v, timeFormat);
    }
    return o;
  });

  const handleSave = () => {
    const balance: ColumnTotals = {};
    for (const c of cols) {
      const raw = (vals[c.flightKey!] ?? '').trim();
      if (!raw) continue;
      if (c.format === 'int') {
        const n = parseInt(raw, 10);
        if (!isNaN(n) && n > 0) balance[c.flightKey!] = n;
      } else {
        const n = parseTimeInput(raw, timeFormat);
        if (n === null) {
          Alert.alert(t('error'), `${c.label}: ${t('dlb_invalid_time')}`);
          return;
        }
        if (n > 0) balance[c.flightKey!] = n;
      }
    }
    const p = Math.max(1, parseInt(pageStr, 10) || 1);
    onSave(p, balance);
  };

  return (
    <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
      <SheetHeader title={t('dlb_book_settings')} onClose={onClose} />
      <ScrollView style={{ maxHeight: Math.min(520, Math.round(height * 0.62)) }} keyboardShouldPersistTaps="handled">
        <Text style={styles.fieldLabel}>{t('starting_page')}</Text>
        <TextInput
          style={styles.input}
          value={pageStr}
          onChangeText={(v) => setPageStr(v.replace(/\D/g, ''))}
          keyboardType="number-pad"
          placeholder="1"
          placeholderTextColor={Colors.textMuted}
        />
        <Text style={styles.fieldHint}>{t('dlb_start_page_hint')}</Text>

        <View style={styles.divider} />
        <Text style={styles.sectionTitle}>{t('dlb_opening_balance')}</Text>
        <Text style={styles.fieldHint}>{t('dlb_opening_balance_hint')}</Text>

        <View style={{ gap: 10, marginTop: 12 }}>
          {cols.map((c) => (
            <View key={c.id} style={styles.balanceRow}>
              <Text style={styles.balanceLabel}>{c.group ? `${c.group} · ${c.label}` : c.label}</Text>
              <TextInput
                style={styles.balanceInput}
                value={vals[c.flightKey!] ?? ''}
                onChangeText={(v) => setVals((s) => ({ ...s, [c.flightKey!]: v }))}
                keyboardType={c.format === 'int' ? 'number-pad' : (timeFormat === 'decimal' ? 'decimal-pad' : 'numbers-and-punctuation')}
                placeholder={c.format === 'int' ? '0' : (timeFormat === 'decimal' ? '0.0' : '0:00')}
                placeholderTextColor={Colors.textMuted}
              />
            </View>
          ))}
        </View>
      </ScrollView>

      <TouchableOpacity style={styles.primaryBtn} onPress={handleSave} activeOpacity={0.85}>
        <Text style={styles.primaryBtnText}>{t('save')}</Text>
      </TouchableOpacity>
    </View>
  );
}

function SheetHeader({ title, onClose }: { title: string; onClose: () => void }) {
  const styles = makeStyles();
  return (
    <View style={styles.sheetHeader}>
      <Text style={styles.sheetTitle}>{title}</Text>
      <TouchableOpacity onPress={onClose} hitSlop={10} activeOpacity={0.7}>
        <Ionicons name="close" size={22} color={Colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );
}

function makeStyles() {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    center: { flex: 1, backgroundColor: Colors.background, alignItems: 'center', justifyContent: 'center' },
    web: { flex: 1, backgroundColor: '#ECE3CC' },

    header: {
      flexDirection: 'row', alignItems: 'center',
      paddingHorizontal: 6, paddingVertical: 6,
      borderBottomWidth: 0.5, borderBottomColor: Colors.border, backgroundColor: Colors.surface,
    },
    iconBtn: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
    headerCenter: { flex: 1, alignItems: 'center' },
    headerTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '800', letterSpacing: 0.2 },
    headerSubRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 1 },
    headerSub: { color: Colors.textSecondary, fontSize: 11 },

    footerHint: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
      paddingTop: 6, backgroundColor: Colors.surface,
      borderTopWidth: 0.5, borderTopColor: Colors.border,
    },
    footerHintText: { color: Colors.textMuted, fontSize: 11 },

    // Intro
    introHero: {
      alignSelf: 'center', width: 72, height: 72, borderRadius: 20,
      backgroundColor: Colors.primary + '1A', alignItems: 'center', justifyContent: 'center',
    },
    introTitle: { color: Colors.textPrimary, fontSize: 24, fontWeight: '800', textAlign: 'center' },
    introLead: { color: Colors.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center' },
    introPoint: {
      flexDirection: 'row', gap: 12, backgroundColor: Colors.card,
      borderRadius: 14, padding: 14, borderWidth: 0.5, borderColor: Colors.cardBorder,
    },
    introPointIcon: {
      width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.primary + '14',
      alignItems: 'center', justifyContent: 'center',
    },
    introPointTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
    introPointBody: { color: Colors.textSecondary, fontSize: 12.5, lineHeight: 18, marginTop: 2 },

    // Boksval (intro)
    pickHeading: { color: Colors.textPrimary, fontSize: 16, fontWeight: '800', marginTop: 8 },
    choiceCard: {
      flexDirection: 'row', alignItems: 'center', gap: 14,
      backgroundColor: Colors.card, borderRadius: 14, padding: 12,
      borderWidth: 1, borderColor: Colors.cardBorder,
    },
    choiceCover: {
      width: 92, height: 60, borderRadius: 8, overflow: 'hidden',
      borderWidth: 1, borderColor: Colors.cardBorder,
    },
    choiceName: { color: Colors.textPrimary, fontSize: 15, fontWeight: '800' },
    choiceDesc: { color: Colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 3 },

    primaryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 15, marginTop: 10,
    },
    primaryBtnText: { color: Colors.textInverse, fontSize: 15, fontWeight: '800' },

    // Empty
    emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
    emptyTitle: { color: Colors.textPrimary, fontSize: 18, fontWeight: '800' },
    emptyBody: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },

    // Sheets
    sheetBackdrop: { flex: 1, backgroundColor: '#00000088', justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
      paddingHorizontal: 16, paddingTop: 14,
    },
    sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
    sheetTitle: { color: Colors.textPrimary, fontSize: 17, fontWeight: '800' },
    sheetHint: { color: Colors.textSecondary, fontSize: 12.5, lineHeight: 18, marginBottom: 10 },

    // Overview
    ovRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 6,
      borderBottomWidth: 0.5, borderBottomColor: Colors.separator,
    },
    ovRowActive: { backgroundColor: Colors.primary + '0E' },
    ovTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
    ovMeta: { color: Colors.textMuted, fontSize: 12, marginTop: 1 },
    latestPill: { backgroundColor: Colors.primary + '22', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
    latestPillText: { color: Colors.primary, fontSize: 10, fontWeight: '800' },

    // Layout cards
    layoutCard: {
      backgroundColor: Colors.card, borderRadius: 14, padding: 12, marginBottom: 12,
      borderWidth: 1, borderColor: Colors.cardBorder,
    },
    layoutCardActive: { borderColor: Colors.primary },
    layoutHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
    layoutName: { color: Colors.textPrimary, fontSize: 14, fontWeight: '800' },
    layoutMeta: { color: Colors.textMuted, fontSize: 11.5, marginTop: 2 },
    layoutCover: { width: 104, height: 66, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: Colors.cardBorder },
    layoutDesc: { color: Colors.textSecondary, fontSize: 11.5, lineHeight: 16, marginTop: 4 },
    previewBox: {
      height: 200, borderRadius: 8, overflow: 'hidden',
      borderWidth: 1, borderColor: Colors.border, backgroundColor: '#ECE3CC',
    },

    // Settings fields
    fieldLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 6, marginTop: 4 },
    fieldHint: { color: Colors.textMuted, fontSize: 11.5, lineHeight: 16, marginTop: 4 },
    sectionTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '800', marginBottom: 2 },
    input: {
      backgroundColor: Colors.elevated, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
      color: Colors.textPrimary, fontSize: 15, borderWidth: 1, borderColor: Colors.border,
    },
    divider: { height: 1, backgroundColor: Colors.separator, marginVertical: 16 },
    balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    balanceLabel: { flex: 1, color: Colors.textSecondary, fontSize: 13 },
    balanceInput: {
      width: 96, backgroundColor: Colors.elevated, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8,
      color: Colors.textPrimary, fontSize: 14, borderWidth: 1, borderColor: Colors.border, textAlign: 'right',
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
  });
}
