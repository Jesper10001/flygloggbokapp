import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, Image, TextInput, useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Colors } from '../../constants/colors';
import { GlassDialog } from '../../components/GlassDialog';
import { askAiConsent } from '../../services/aiConsent';
import { isScanCameraAvailable } from '../../modules/scan-camera';
import { useScanQuotaStore } from '../../store/scanQuotaStore';
import { setScanBatch, setScanBookSession, type ScanImage } from '../../store/scanStore';
import {
  useScanBookStore, sessionsOf, expectedPages, ledgerRange, photoFile, thumbFile, wordsFile, readFile, SESSION_SIZE,
  type BookPhoto, type BookSession,
} from '../../store/scanBookStore';
import { pageStep } from '../../services/scanFormat';
import { scanQuotaWeight } from '../../utils/tokenGate';
import { label as fieldLabel } from '../../services/scanFields';

// "Scan your whole logbook": alla uppslag läggs till på en gång. Varje foto förbereds direkt (boken letas upp,
// vrids, rätas och beskärs) och formatet läses från första uppslaget, så att varje omgång går rakt till
// läsningen. Sidspannet (bokens första och sista sida) säger var uppslagen hör hemma och när boken är skannad
// hela vägen. Sedan granskas boken i delar om tio uppslag (samma granskning som en vanlig skanning).

const COLS = 4;
const toPage = (t: string) => { const n = parseInt(t, 10); return Number.isFinite(n) && n > 0 ? n : null; };

export default function ScanBookScreen() {
  const router = useRouter();
  const { width: W } = useWindowDimensions();
  const st = useScanBookStore();
  const { project, format, formatStatus, formatError } = st;
  const cameraAvailable = isScanCameraAvailable();
  const [sourcePicker, setSourcePicker] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => { st.load(); }, []);

  const photos = project?.photos ?? [];
  const sessions = useMemo(() => sessionsOf(photos), [photos]);
  const ready = photos.filter((ph) => ph.status === 'ready' || ph.savedIn != null).length;
  const working = photos.filter((ph) => ph.status === 'waiting' || ph.status === 'preparing').length;
  const failed = photos.filter((ph) => ph.status === 'failed').length;
  const allSaved = photos.length > 0 && photos.every((ph) => ph.savedIn != null);
  const step = pageStep(format);

  // Sidspannet: förifyllt från första uppslagets tryckta sidnummer (formatet) och antalet foton. Bokens första
  // sida fylls bara i när fotona börjar på bokens början; annars får användaren ange den.
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  useEffect(() => {
    if (toPage(first) !== (project?.firstPage ?? null)) setFirst(project?.firstPage != null ? String(project.firstPage) : '');
    if (toPage(last) !== (project?.lastPage ?? null)) setLast(project?.lastPage != null ? String(project.lastPage) : '');
  }, [project?.id, project?.firstPage, project?.lastPage]);
  useEffect(() => {
    if (!project || !format || project.firstPage != null || project.lastPage != null) return;
    const anchor = format.pageNumbers.left;
    if (anchor == null) return;
    const end = anchor + (photos.length - 1) * step + (step - 1);
    st.setPages(anchor <= 2 ? anchor : null, end);
  }, [format?.id]);
  // Sparas medan man skriver (rutorna fylls i från projektet igen bara när värdet ändras utifrån).
  const editFirst = (t: string) => { setFirst(t); st.setPages(toPage(t), toPage(last)); };
  const editLast = (t: string) => { setLast(t); st.setPages(toPage(first), toPage(t)); };

  // Hur många uppslag spannet rymmer, jämfört med antalet foton.
  const coverage = (() => {
    const f = project?.firstPage, l = project?.lastPage;
    if (f == null || l == null) return null;
    if (l < f) return { tone: 'warn' as const, text: 'The last page comes before the first page.' };
    const spreads = Math.floor((l - f) / step) + 1;
    const n = photos.length;
    if (spreads === n) return { tone: 'ok' as const, text: `${n} ${n === 1 ? 'spread' : 'spreads'} in pages ${f}–${l}, and ${n === 1 ? 'one photo' : `${n} photos`}.` };
    if (spreads > n) return { tone: 'warn' as const, text: `Pages ${f}–${l} are ${spreads} spreads, and you've added ${n} ${n === 1 ? 'photo' : 'photos'}. Add the rest now or later — the paper logbook fixes wait until every spread is scanned.` };
    return { tone: 'warn' as const, text: `Pages ${f}–${l} are ${spreads} spreads, but you've added ${n} photos. Check the page numbers.` };
  })();

  const pagesOf = (i: number) => {
    const e = project ? expectedPages(project, format, i) : null;
    return e ? (e.right != null && e.right !== e.left ? `p. ${e.left}–${e.right}` : `p. ${e.left}`) : null;
  };

  // ── Lägga till foton ──
  const pickSource = (src: 'camera' | 'library') => {
    setSourcePicker(false);
    setTimeout(() => { (src === 'camera' ? takePhotos() : choosePhotos()).catch(() => {}); }, 320);
  };
  const choosePhotos = async () => {
    // quality 1: ingen omkodning i väljaren (förberedelsen skalar och kodar ändå) → snabbare tillbaka.
    setAdding(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'], quality: 1, allowsMultipleSelection: true, selectionLimit: 0, orderedSelection: true,
      });
      if (result.canceled || !result.assets?.length) return;
      await st.addPhotos(result.assets.map((a) => ({ uri: a.uri, width: a.width, height: a.height })));
    } finally {
      setAdding(false);
    }
  };
  const takePhotos = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Camera access needed', 'Allow camera access in Settings to photograph your logbook.'); return; }
    router.push('/import/scan-camera?book=1');
  };

  const photoMenu = (ph: BookPhoto, i: number) => {
    if (ph.savedIn != null) return;
    const label = `Spread ${i + 1}${pagesOf(i) ? ` · ${pagesOf(i)}` : ''}`;
    const canEarlier = i > 0 && photos[i - 1].savedIn == null;
    const canLater = i < photos.length - 1;
    Alert.alert(label, ph.status === 'failed' ? "This photo couldn't be prepared. Remove it and add it again." : ph.found === false ? "The logbook wasn't found in this photo, so the whole photo is read." : undefined, [
      ...(ph.status !== 'failed' && canEarlier ? [{ text: 'Move earlier', onPress: () => st.movePhoto(ph.id, -1) }] : []),
      ...(ph.status !== 'failed' && canLater ? [{ text: 'Move later', onPress: () => st.movePhoto(ph.id, 1) }] : []),
      { text: 'Remove', style: 'destructive' as const, onPress: () => st.removePhoto(ph.id) },
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  // ── En del granskas: samma granskning som en vanlig skanning, med förberedda foton och bokens format ──
  const startPart = async (part: BookSession) => {
    if (!(await askAiConsent())) return;
    const project = useScanBookStore.getState().project;   // färskt (sidspannet kan just ha ändrats)
    if (!project) return;
    const usable = part.photos.filter((ph) => ph.status === 'ready');
    if (!usable.length) return;
    const images: ScanImage[] = usable.map((ph) => {
      const idx = project.photos.findIndex((x) => x.id === ph.id);
      return {
        base64: '', mediaType: 'image/jpeg', width: ph.w, height: ph.h, cropped: true, oriented: true,
        prepared: {
          uri: photoFile(project, ph), wordsUri: wordsFile(project, ph), readUri: readFile(project, ph),
          expected: expectedPages(project, format, idx) ?? undefined,
        },
      };
    });
    for (let i = 0; i < images.length; i++) await useScanQuotaStore.getState().consumeScan();
    setScanBatch(images);
    setScanBookSession({
      projectId: project.id, photoIds: usable.map((ph) => ph.id), formatId: project.formatId,
      ctx: project.lastContext, ledger: ledgerRange(project, format),
    });
    router.push('/flight/scan-review');
  };

  const discard = () => {
    Alert.alert('Discard this logbook scan?', allSaved
      ? 'Your flights are saved. This removes the photos and the list of parts.'
      : 'The photos and the parts you haven\'t saved are removed. Flights you already saved stay in your logbook.', [
      { text: 'Keep', style: 'cancel' },
      { text: 'Discard', style: 'destructive', onPress: () => { st.discard(); router.back(); } },
    ]);
  };
  const finish = () => { st.discard(); router.back(); };

  // Ungefär vad ett uppslag kostar (proxyns skanningspris: halv vikt för Premium).
  const coinsPerSpread = Math.round(30 * scanQuotaWeight());
  const tile = Math.floor((W - 32 - 28 - (COLS - 1) * 8) / COLS);
  const nextPart = sessions.find((x) => !x.saved);

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
      <View style={s.hero}>
        <Text style={s.title}>Scan your whole logbook</Text>
        <Text style={s.subtitle}>
          Add every spread at once. Blades straightens each photo and reads your logbook's format right away, then you check {SESSION_SIZE} spreads at a time. Stop whenever you like — everything is kept on your phone.
        </Text>
      </View>

      {photos.length === 0 ? (
        <TouchableOpacity style={s.uploadCard} onPress={() => setSourcePicker(true)} disabled={adding} activeOpacity={0.9}>
          <View style={s.uploadIconWrap}>
            {adding ? <ActivityIndicator color={Colors.primary} size="large" /> : <Ionicons name="images-outline" size={30} color={Colors.primary} />}
          </View>
          <Text style={s.uploadTitle}>{adding ? 'Adding photos…' : 'Add your spreads'}</Text>
          {!adding && <Text style={s.uploadSub}>One spread per photo, in page order. Choose them from your photos, or take them with the camera.</Text>}
        </TouchableOpacity>
      ) : (
        <>
          {/* Fotona: miniatyrer i bokens ordning, med sidnummer och läge */}
          <View style={s.card}>
            <View style={s.cardHead}>
              <Text style={s.cardTitle}>Photos · {photos.length}</Text>
              <Text style={[s.cardStatus, working ? null : failed ? { color: Colors.warning } : { color: Colors.success }]}>
                {working ? `Straightening ${ready + 1} of ${photos.length}…` : failed ? `${failed} couldn't be prepared` : 'All straightened'}
              </Text>
            </View>
            <View style={s.grid}>
              {photos.map((ph, i) => (
                <TouchableOpacity key={ph.id} style={{ width: tile }} onPress={() => photoMenu(ph, i)} activeOpacity={0.8}
                  accessibilityLabel={`Spread ${i + 1}${pagesOf(i) ? `, ${pagesOf(i)}` : ''}`}>
                  <View style={[s.thumb, { width: tile, height: Math.round(tile * 0.68) }, ph.savedIn != null && { opacity: 0.55 }]}>
                    {(ph.status === 'ready' || ph.savedIn != null) && project
                      ? <Image source={{ uri: thumbFile(project, ph) }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                      : ph.status === 'failed'
                        ? <Ionicons name="alert-circle" size={20} color={Colors.danger} />
                        : ph.status === 'preparing'
                          ? <ActivityIndicator size="small" color={Colors.primary} />
                          : <Ionicons name="hourglass-outline" size={16} color={Colors.textMuted} />}
                    <View style={s.thumbNum}><Text style={s.thumbNumText}>{i + 1}</Text></View>
                    {ph.savedIn != null && <View style={s.thumbMark}><Ionicons name="checkmark-circle" size={16} color={Colors.success} /></View>}
                    {ph.savedIn == null && ph.status === 'ready' && ph.found === false && (
                      <View style={s.thumbMark}><Ionicons name="scan-outline" size={14} color={Colors.warning} /></View>
                    )}
                  </View>
                  {pagesOf(i) && <Text style={s.thumbPages} numberOfLines={1}>{pagesOf(i)}</Text>}
                </TouchableOpacity>
              ))}
              {!allSaved && (
                <TouchableOpacity style={{ width: tile }} onPress={() => setSourcePicker(true)} disabled={adding} activeOpacity={0.8} accessibilityLabel="Add more spreads">
                  <View style={[s.thumb, s.addTile, { width: tile, height: Math.round(tile * 0.68) }]}>
                    {adding ? <ActivityIndicator size="small" color={Colors.primary} /> : <Ionicons name="add" size={22} color={Colors.primary} />}
                  </View>
                </TouchableOpacity>
              )}
            </View>
            <Text style={s.note}>Tap a photo to move or remove it.</Text>
          </View>

          {/* Bokens format, läst en gång från första uppslaget */}
          <View style={s.card}>
            <View style={s.cardHead}>
              <Text style={s.cardTitle}>Logbook format</Text>
              {format && formatStatus === 'idle' && (
                <TouchableOpacity onPress={() => st.readFormat()} hitSlop={8} accessibilityRole="button">
                  <Text style={s.link}>Read again</Text>
                </TouchableOpacity>
              )}
            </View>
            {formatStatus === 'reading' ? (
              <View style={s.inline}>
                <ActivityIndicator size="small" color={Colors.primary} />
                <Text style={s.body}>Reading the format from the first spread…</Text>
              </View>
            ) : formatStatus === 'error' ? (
              <>
                <Text style={[s.body, { color: Colors.warning }]}>{formatError}</Text>
                <TouchableOpacity style={s.smallBtn} onPress={() => st.readFormat()} activeOpacity={0.8}>
                  <Text style={s.smallBtnText}>Try again</Text>
                </TouchableOpacity>
              </>
            ) : format ? (
              <>
                <Text style={s.formatLine}>
                  {format.columns.length} columns{format.rowsPerPage ? ` · ${format.rowsPerPage} rows per page` : ''} · {format.timeFormat === 'hhmm' ? 'hours:minutes' : 'decimal times'}
                </Text>
                {(['left', 'right'] as const).map((side) => {
                  const cols = format.columns.filter((c) => c.page === side);
                  if (!cols.length) return null;
                  return (
                    <View key={side} style={{ gap: 6 }}>
                      <Text style={s.sideLabel}>{side === 'left' ? 'Left page' : 'Right page'}</Text>
                      <View style={s.chips}>
                        {cols.map((c, k) => (
                          <View key={k} style={[s.chip, !c.field && s.chipMuted]}>
                            <Text style={[s.chipText, !c.field && { color: Colors.textMuted }]} numberOfLines={1}>
                              {c.field ? fieldLabel(c.field) : c.label}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  );
                })}
                {format.remarksPilotNames && <Text style={s.note}>The remarks hold the other pilot's name — set as PIC or SIC automatically.</Text>}
                <Text style={s.note}>Every part of this scan reads your logbook with this format, so it isn't worked out again for each part.</Text>
              </>
            ) : (
              <Text style={s.body}>Read from the first spread as soon as it's straightened.</Text>
            )}
          </View>

          {/* Sidspannet */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Pages</Text>
            <View style={s.pagesRow}>
              <View style={s.pageField}>
                <Text style={s.fieldLabel}>First page</Text>
                <TextInput style={s.input} value={first} onChangeText={editFirst} keyboardType="number-pad"
                  placeholder="1" placeholderTextColor={Colors.textMuted} returnKeyType="done" maxLength={4} accessibilityLabel="First page of your logbook" />
              </View>
              <Text style={s.dash}>–</Text>
              <View style={s.pageField}>
                <Text style={s.fieldLabel}>Last page</Text>
                <TextInput style={s.input} value={last} onChangeText={editLast} keyboardType="number-pad"
                  placeholder="—" placeholderTextColor={Colors.textMuted} returnKeyType="done" maxLength={4} accessibilityLabel="Last page you've written on" />
              </View>
            </View>
            <Text style={s.note}>The first page of your logbook and the last page you've written on.</Text>
            {coverage && (
              <View style={s.inline}>
                <Ionicons name={coverage.tone === 'ok' ? 'checkmark-circle' : 'alert-circle'} size={16} color={coverage.tone === 'ok' ? Colors.success : Colors.warning} />
                <Text style={[s.body, { flex: 1 }]}>{coverage.text}</Text>
              </View>
            )}
          </View>

          {/* Delarna, tio uppslag i taget */}
          {allSaved ? (
            <View style={[s.card, { borderColor: Colors.success + '55' }]}>
              <View style={s.inline}>
                <Ionicons name="checkmark-circle" size={20} color={Colors.success} />
                <Text style={s.doneTitle}>Your whole logbook is scanned</Text>
              </View>
              <Text style={s.body}>{project?.flightsSaved ?? 0} flights saved from {photos.length} spreads.</Text>
              <TouchableOpacity style={s.primaryBtn} onPress={finish} activeOpacity={0.85}>
                <Text style={s.primaryBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={s.card}>
              <Text style={s.cardTitle}>Parts · {SESSION_SIZE} spreads each</Text>
              <Text style={s.note}>
                Start reads the part's spreads with Claude, about {coinsPerSpread} coins each. Spreads that are read are kept: if you leave and open the part again, they aren't read again.
              </Text>
              {sessions.map((part) => {
                const from = part.start + 1, to = part.start + part.photos.length;
                const e1 = project ? expectedPages(project, format, part.start) : null;
                const e2 = project ? expectedPages(project, format, part.start + part.photos.length - 1) : null;
                const span = e1 && e2 ? `p. ${e1.left}–${e2.right ?? e2.left}` : null;
                const isNext = part === nextPart;
                const waiting = part.photos.some((ph) => ph.status === 'waiting' || ph.status === 'preparing');
                const bad = part.photos.filter((ph) => ph.status === 'failed').length;
                const blocked = waiting || formatStatus === 'reading';
                return (
                  <View key={`${part.number}-${part.start}`} style={s.partRow}>
                    <View style={[s.partBubble, part.saved && s.partBubbleDone, isNext && s.partBubbleNext]}>
                      {part.saved ? <Ionicons name="checkmark" size={14} color={Colors.success} /> : <Text style={[s.partNum, isNext && { color: Colors.primary }]}>{part.number}</Text>}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.partTitle}>{from === to ? `Spread ${from}` : `Spreads ${from}–${to}`}</Text>
                      <Text style={s.partSub} numberOfLines={2}>
                        {part.saved ? 'Saved' : waiting ? 'Straightening the photos…' : isNext && formatStatus === 'reading' ? 'Reading the format…' : bad ? `${bad} ${bad === 1 ? "photo couldn't" : "photos couldn't"} be prepared` : span ?? 'Ready'}
                      </Text>
                    </View>
                    {isNext && (
                      <TouchableOpacity style={[s.startBtn, blocked && { opacity: 0.45 }]} onPress={() => startPart(part)} disabled={blocked} activeOpacity={0.85} accessibilityRole="button">
                        <Text style={s.startBtnText}>{project?.sessionsSaved ? 'Continue' : 'Start'}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          <TouchableOpacity onPress={discard} style={{ alignSelf: 'center', paddingVertical: 8 }} hitSlop={8}>
            <Text style={s.discard}>Discard this logbook scan</Text>
          </TouchableOpacity>
        </>
      )}

      <GlassDialog
        visible={sourcePicker}
        onClose={() => setSourcePicker(false)}
        eyebrow="SCAN YOUR WHOLE LOGBOOK"
        title="Add your spreads"
        body="One spread per photo, in page order."
        secondary={{ label: 'Cancel', onPress: () => setSourcePicker(false) }}
      >
        <View style={s.sourceList}>
          {([
            ['library', 'images-outline', 'Choose from your photos', 'Pick every spread at once — Blades keeps the order you choose them in.'],
            ...(cameraAvailable ? [['camera', 'camera-outline', 'Take photos', 'Turn the pages one by one. The camera takes each photo when the spread is sharp.']] : []),
          ] as [ 'library' | 'camera', keyof typeof Ionicons.glyphMap, string, string][]).map(([key, icon, title, sub]) => (
            <TouchableOpacity key={key} style={s.sourceRow} onPress={() => pickSource(key)} activeOpacity={0.8} accessibilityRole="button">
              <View style={s.rowIcon}><Ionicons name={icon} size={20} color={Colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>{title}</Text>
                <Text style={s.rowSub}>{sub}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={Colors.textSecondary} />
            </TouchableOpacity>
          ))}
        </View>
      </GlassDialog>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 48, gap: 12 },

  // Samma mått och färger som Scan logbook (app/import/scan.tsx).
  hero: { gap: 4, marginBottom: 2 },
  title: { color: Colors.textPrimary, fontSize: 24, fontWeight: '800' },
  subtitle: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20 },
  uploadCard: {
    alignItems: 'center', gap: 8, paddingVertical: 26, paddingHorizontal: 18,
    borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.primary + '80',
    backgroundColor: Colors.primary + '0D',
  },
  uploadIconWrap: {
    width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary + '1A', borderWidth: 1, borderColor: Colors.primary + '33',
  },
  uploadTitle: { color: Colors.textPrimary, fontSize: 17, fontWeight: '800', marginTop: 2 },
  uploadSub: { color: Colors.textSecondary, fontSize: 12.5, textAlign: 'center', lineHeight: 17 },

  card: { backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.cardBorder, padding: 14, gap: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardTitle: { color: Colors.textMuted, fontSize: 10.5, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase' },
  cardStatus: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700' },
  body: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  note: { color: Colors.textMuted, fontSize: 12, lineHeight: 17 },
  link: { color: Colors.primary, fontSize: 13, fontWeight: '700' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumb: {
    borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: Colors.border,
  },
  addTile: { borderStyle: 'dashed', borderWidth: 1, borderColor: Colors.primary + '66', backgroundColor: Colors.primary + '0D' },
  thumbNum: { position: 'absolute', left: 4, bottom: 4, minWidth: 18, paddingHorizontal: 4, height: 16, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center' },
  thumbNumText: { color: '#fff', fontSize: 10, fontWeight: '800', fontVariant: ['tabular-nums'] },
  thumbMark: { position: 'absolute', right: 4, top: 4, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.55)', padding: 1 },
  thumbPages: { color: Colors.textMuted, fontSize: 10.5, marginTop: 3, textAlign: 'center', fontVariant: ['tabular-nums'] },

  formatLine: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
  sideLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 7, backgroundColor: Colors.primary + '14', borderWidth: 1, borderColor: Colors.primary + '33' },
  chipMuted: { backgroundColor: Colors.surface, borderColor: Colors.border },
  chipText: { color: Colors.textPrimary, fontSize: 11.5, fontWeight: '600' },
  smallBtn: { alignSelf: 'flex-start', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 9, borderWidth: 1, borderColor: Colors.primary + '66' },
  smallBtnText: { color: Colors.primary, fontSize: 13, fontWeight: '700' },

  pagesRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  pageField: { flex: 1, gap: 6 },
  fieldLabel: { color: Colors.textSecondary, fontSize: 12, fontWeight: '700' },
  input: {
    height: 44, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface,
    paddingHorizontal: 12, color: Colors.textPrimary, fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'],
  },
  dash: { color: Colors.textMuted, fontSize: 18, paddingBottom: 10 },

  partRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  partBubble: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.surface },
  partBubbleDone: { borderColor: Colors.success + '66', backgroundColor: Colors.success + '14' },
  partBubbleNext: { borderColor: Colors.primary + '88', backgroundColor: Colors.primary + '1A' },
  partNum: { color: Colors.textSecondary, fontSize: 12.5, fontWeight: '800' },
  partTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
  partSub: { color: Colors.textSecondary, fontSize: 12.5, marginTop: 2 },
  startBtn: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 10, backgroundColor: Colors.primary },
  startBtnText: { color: Colors.background, fontSize: 14, fontWeight: '800' },
  doneTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '800' },
  primaryBtn: { alignItems: 'center', paddingVertical: 12, borderRadius: 12, backgroundColor: Colors.primary },
  primaryBtnText: { color: Colors.background, fontSize: 15, fontWeight: '800' },
  discard: { color: Colors.dangerLight, fontSize: 13.5, fontWeight: '700' },

  sourceList: { alignSelf: 'stretch', gap: 8, marginTop: 14 },
  sourceRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(255,255,255,0.06)',
  },
  rowIcon: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary + '1A', borderWidth: 1, borderColor: Colors.primary + '33',
  },
  rowTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700' },
  rowSub: { color: Colors.textSecondary, fontSize: 12.5, lineHeight: 17, marginTop: 2 },
});
