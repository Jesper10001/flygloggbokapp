// Pilot CV (Settings → Export to PDF): ett CV som användaren bygger själv. Överst en förhandsvisning av den färdiga
// sidan, som ritas om medan man ändrar; under den fyra flikar: uppgifterna (hämtade från profilen första gången,
// sedan CV:ts egna), innehållet (vilka delar och vilka totaler), utseendet (färger, typsnitt, storlek) och
// loggbokssidorna (de senaste uppslagen ur den digitala boken, hämtade direkt ur boken). Allt man ställer in
// sparas (services/pdfExport/cvConfig.ts); siffrorna räknas alltid ur loggboken.

import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, Switch, ActivityIndicator, Keyboard, StyleSheet, useWindowDimensions } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import * as Haptics from 'expo-haptics';
import { Colors } from '../constants/colors';
import { AppBackground } from '../components/AppBackground';
import { useToastStore } from '../components/Toast';
import { listDigitalBooks, type DigitalBook } from '../db/digitalBooks';
import {
  loadCv, saveCv, profileDetails, newId, TILES, MAX_TILES, FONTS, ACCENTS, SIDES, SECTIONS,
  type CvConfig, type TileKey, type SectionKey,
} from '../services/pdfExport/cvConfig';
import { loadCvData, type CvData } from '../services/pdfExport/cvData';
import { cvHtml, exportCvPdf, loadCvSpreads, type Spreads } from '../services/pdfExport/exportCV';

type Tab = 'details' | 'content' | 'look' | 'pages';
const TABS: { k: Tab; label: string }[] = [
  { k: 'details', label: 'Details' }, { k: 'content', label: 'Content' }, { k: 'look', label: 'Look' }, { k: 'pages', label: 'Logbook' },
];
const SPREAD_CHOICES = [0, 1, 3, 5, 10];
const MONO = 'JetBrainsMono';
const SERIF = 'Fraunces';

export default function ExportCv() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: H } = useWindowDimensions();
  const [cfg, setCfg] = useState<CvConfig | null>(null);
  const [data, setData] = useState<CvData | null>(null);
  const [spreads, setSpreads] = useState<Spreads | null>(null);
  const [books, setBooks] = useState<DigitalBook[]>([]);
  const [tab, setTab] = useState<Tab>('details');
  const [view, setView] = useState<'cv' | 'pages'>('cv');
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false);
  const [html, setHtml] = useState('');
  const [kb, setKb] = useState(false);
  const [hexDraft, setHexDraft] = useState('');
  const loaded = useRef(false);

  useEffect(() => {
    loadCv().then((c) => { setCfg(c); setHexDraft(c.look.accent); }).catch(() => {});
    loadCvData().then(setData).catch(() => {});
    listDigitalBooks('digital').then(setBooks).catch(() => {});
    const a = Keyboard.addListener('keyboardWillShow', () => setKb(true));
    const b = Keyboard.addListener('keyboardWillHide', () => setKb(false));
    return () => { a.remove(); b.remove(); };
  }, []);

  // Uppslagen hämtas om när antalet eller boken ändras.
  const spreadKey = cfg ? `${cfg.spreads}:${cfg.bookId ?? 'a'}` : '';
  useEffect(() => {
    if (!cfg) return;
    let dead = false;
    loadCvSpreads(cfg).then((s) => { if (!dead) { setSpreads(s); if (!s) setView('cv'); } });
    return () => { dead = true; };
  }, [spreadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Förhandsvisningen ritas om strax efter senaste ändringen, och ändringen sparas.
  useEffect(() => {
    if (!cfg || !data) return;
    const first = !loaded.current;
    loaded.current = true;
    const t = setTimeout(() => { setHtml(cvHtml(cfg, data, spreads, true)); if (!first) saveCv(cfg); }, first ? 0 : 320);
    return () => clearTimeout(t);
  }, [cfg, data, spreads]);

  const pagesHtml = useMemo(
    () => (spreads ? spreads.html.replace('<head>', `<head><meta name="viewport" content="width=${spreads.pageWidthPx}, user-scalable=yes" />`) : ''),
    [spreads],
  );

  const tap = () => { Haptics.selectionAsync().catch(() => {}); };
  const set = (fn: (c: CvConfig) => CvConfig) => setCfg((c) => (c ? fn(c) : c));
  const setDetail = (k: keyof CvConfig['details'], v: string) => set((c) => ({ ...c, details: { ...c.details, [k]: v } }));
  const setLook = (p: Partial<CvConfig['look']>) => set((c) => ({ ...c, look: { ...c.look, ...p } }));

  const create = async () => {
    if (!cfg || busy) return;
    setBusy(true);
    try {
      await saveCv(cfg);
      const r = await exportCvPdf(cfg);
      if (cfg.spreads > 0 && spreads && !r.merged) useToastStore.getState().show('The logbook pages could not be attached. The CV was created without them.');
    } catch {
      useToastStore.getState().show('The PDF could not be created. Try again.');
    } finally { setBusy(false); }
  };

  if (!cfg) {
    return <View style={{ flex: 1, backgroundColor: Colors.background }}><AppBackground /><ActivityIndicator color={Colors.primary} style={{ marginTop: insets.top + 120 }} /></View>;
  }

  const previewH = full ? undefined : Math.round(H * (kb ? 0.24 : 0.38));
  const showPages = view === 'pages' && !!spreads;

  return (
    <View style={{ flex: 1, backgroundColor: Colors.background }}>
      <AppBackground />
      <View style={[s.head, { paddingTop: insets.top + 4 }]}>
        <Pressable onPress={() => router.back()} style={s.hbtn} hitSlop={6} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="chevron-back" size={24} color={Colors.textPrimary} />
        </Pressable>
        <Text style={s.title}>Pilot CV</Text>
        <Pressable onPress={create} disabled={busy} style={s.share} accessibilityRole="button" accessibilityLabel="Create PDF">
          {busy ? <ActivityIndicator size="small" color={Colors.textInverse} /> : <Text style={s.shareText}>Create PDF</Text>}
        </Pressable>
      </View>

      {/* ── Förhandsvisningen ── */}
      <View style={[s.preview, full ? { flex: 1 } : { height: previewH }]}>
        {html ? (
          <WebView key={showPages ? 'pages' : 'cv'} originWhitelist={['*']} source={{ html: showPages ? pagesHtml : html }}
            style={{ flex: 1, backgroundColor: '#FFFFFF' }} javaScriptEnabled={false} bounces={false}
            accessibilityLabel={showPages ? 'Preview of the attached logbook pages' : 'Preview of your CV'} />
        ) : <ActivityIndicator color={Colors.primary} style={{ marginTop: 40 }} />}
        <Pressable onPress={() => { tap(); Keyboard.dismiss(); setFull((v) => !v); }} style={s.expand} hitSlop={6}
          accessibilityRole="button" accessibilityLabel={full ? 'Smaller preview' : 'Larger preview'}>
          <Ionicons name={full ? 'contract-outline' : 'expand-outline'} size={18} color="#FFFFFF" />
        </Pressable>
        {spreads ? (
          <View style={s.pvTabs}>
            {(['cv', 'pages'] as const).map((k) => (
              <Pressable key={k} onPress={() => { tap(); setView(k); }} style={[s.pvTab, view === k && s.pvTabOn]}
                accessibilityRole="button" accessibilityState={{ selected: view === k }}>
                <Text style={[s.pvTabText, view === k && { color: Colors.textInverse }]}>{k === 'cv' ? 'CV' : `Logbook pages · ${spreads.n}`}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      {full ? null : (
        <>
          <View style={s.tabs}>
            {TABS.map((t) => (
              <Pressable key={t.k} onPress={() => { tap(); setTab(t.k); }} style={[s.tab, tab === t.k && s.tabOn]}
                accessibilityRole="tab" accessibilityState={{ selected: tab === t.k }}>
                <Text style={[s.tabText, tab === t.k && { color: Colors.textInverse }]}>{t.label}</Text>
              </Pressable>
            ))}
          </View>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 18, paddingTop: 6, paddingBottom: insets.bottom + 40 }}
            keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets showsVerticalScrollIndicator={false}>

            {tab === 'details' ? (
              <>
                <Text style={s.note}>Filled in from your profile the first time. What you change here is saved for your CV and leaves your profile as it is.</Text>
                <View style={s.two}>
                  <Field label="First name" value={cfg.details.firstName} onChange={(v) => setDetail('firstName', v)} cap="words" />
                  <Field label="Last name" value={cfg.details.lastName} onChange={(v) => setDetail('lastName', v)} cap="words" />
                </View>
                <Field label="Title" value={cfg.details.title} onChange={(v) => setDetail('title', v)} placeholder="Helicopter pilot · HEMS captain" />
                <Field label="Profile text" value={cfg.details.summary} onChange={(v) => setDetail('summary', v)} multiline
                  placeholder="Two or three sentences about you as a pilot." />
                <View style={s.two}>
                  <Field label="Email" value={cfg.details.email} onChange={(v) => setDetail('email', v)} keyboard="email-address" cap="none" />
                  <Field label="Phone" value={cfg.details.phone} onChange={(v) => setDetail('phone', v)} keyboard="phone-pad" />
                </View>
                <View style={s.two}>
                  <Field label="Base" value={cfg.details.base} onChange={(v) => setDetail('base', v)} placeholder="Stockholm (ESSA)" />
                  <Field label="Nationality" value={cfg.details.nationality} onChange={(v) => setDetail('nationality', v)} cap="words" />
                </View>
                <View style={s.two}>
                  <Field label="Licence" value={cfg.details.licence} onChange={(v) => setDetail('licence', v)} placeholder="ATPL(H) · EASA" cap="characters" />
                  <Field label="Licence number" value={cfg.details.licenceNo} onChange={(v) => setDetail('licenceNo', v)} cap="characters" />
                </View>
                <Field label="Date of birth" value={cfg.details.dob} onChange={(v) => setDetail('dob', v)} placeholder="Leave empty to leave it out" />

                <ListHead title="Ratings and certificates" onAdd={() => set((c) => ({ ...c, certs: [...c.certs, { id: newId(), name: '', valid: '' }] }))} />
                {cfg.certs.map((x) => (
                  <ListRow key={x.id} onRemove={() => set((c) => ({ ...c, certs: c.certs.filter((y) => y.id !== x.id) }))}>
                    <Field flex={1.4} label="Name" value={x.name} placeholder="IR(H)" onChange={(v) => set((c) => ({ ...c, certs: c.certs.map((y) => (y.id === x.id ? { ...y, name: v } : y)) }))} />
                    <Field label="Valid to" value={x.valid} placeholder="2027-08-31" onChange={(v) => set((c) => ({ ...c, certs: c.certs.map((y) => (y.id === x.id ? { ...y, valid: v } : y)) }))} />
                  </ListRow>
                ))}

                <ListHead title="Languages" onAdd={() => set((c) => ({ ...c, languages: [...c.languages, { id: newId(), name: '', level: '' }] }))} />
                {cfg.languages.map((x) => (
                  <ListRow key={x.id} onRemove={() => set((c) => ({ ...c, languages: c.languages.filter((y) => y.id !== x.id) }))}>
                    <Field label="Language" value={x.name} cap="words" onChange={(v) => set((c) => ({ ...c, languages: c.languages.map((y) => (y.id === x.id ? { ...y, name: v } : y)) }))} />
                    <Field label="Level" value={x.level} placeholder="ICAO Level 6" onChange={(v) => set((c) => ({ ...c, languages: c.languages.map((y) => (y.id === x.id ? { ...y, level: v } : y)) }))} />
                  </ListRow>
                ))}

                <ListHead title="Experience" onAdd={() => set((c) => ({ ...c, experience: [...c.experience, { id: newId(), period: '', role: '', detail: '' }] }))} />
                {cfg.experience.map((x) => (
                  <ListRow key={x.id} column onRemove={() => set((c) => ({ ...c, experience: c.experience.filter((y) => y.id !== x.id) }))}>
                    <View style={s.two}>
                      <Field label="Years" value={x.period} placeholder="2021–" onChange={(v) => set((c) => ({ ...c, experience: c.experience.map((y) => (y.id === x.id ? { ...y, period: v } : y)) }))} />
                      <Field flex={2} label="Role" value={x.role} placeholder="HEMS captain" onChange={(v) => set((c) => ({ ...c, experience: c.experience.map((y) => (y.id === x.id ? { ...y, role: v } : y)) }))} />
                    </View>
                    <Field label="Employer and details" value={x.detail} placeholder="Operator, aircraft, kind of flying" onChange={(v) => set((c) => ({ ...c, experience: c.experience.map((y) => (y.id === x.id ? { ...y, detail: v } : y)) }))} />
                  </ListRow>
                ))}

                <Pressable onPress={async () => { tap(); const p = await profileDetails(); set((c) => ({ ...c, details: { ...c.details, ...Object.fromEntries(Object.entries(p.details).filter(([, v]) => v)) } })); }}
                  style={s.link} accessibilityRole="button">
                  <Ionicons name="refresh" size={15} color={Colors.primary} />
                  <Text style={s.linkText}>Fetch my profile details again</Text>
                </Pressable>
              </>
            ) : null}

            {tab === 'content' ? (
              <>
                <Text style={s.lbl}>WHAT TO INCLUDE</Text>
                {SECTIONS.map((x) => (
                  <View key={x.k} style={s.row}>
                    <Text style={s.rowText}>{x.label}</Text>
                    <Switch value={cfg.sections[x.k]} onValueChange={(v) => { tap(); set((c) => ({ ...c, sections: { ...c.sections, [x.k as SectionKey]: v } })); }}
                      trackColor={{ true: Colors.primary, false: 'rgba(127,168,200,0.25)' }} accessibilityLabel={x.label} />
                  </View>
                ))}
                <Text style={[s.lbl, { marginTop: 22 }]}>TOTALS TO SHOW · {cfg.tiles.length} OF {MAX_TILES}</Text>
                <Text style={s.note}>Total flight time is always shown. Tap to add or remove; they appear in the order you add them.</Text>
                <View style={s.chips}>
                  {TILES.map((t) => {
                    const on = cfg.tiles.includes(t.k);
                    const blocked = !on && cfg.tiles.length >= MAX_TILES;
                    return (
                      <Chip key={t.k} label={t.label} on={on} dim={blocked} onPress={() => {
                        if (blocked) return;
                        tap();
                        set((c) => ({ ...c, tiles: on ? c.tiles.filter((k) => k !== t.k) : [...c.tiles, t.k as TileKey] }));
                      }} />
                    );
                  })}
                </View>
                <Text style={[s.lbl, { marginTop: 22 }]}>AIRCRAFT TYPES IN THE TABLE</Text>
                <View style={s.chips}>
                  {[[4, 'Top 4'], [6, 'Top 6'], [99, 'All']].map(([n, l]) => (
                    <Chip key={String(n)} label={String(l)} on={cfg.aircraftRows === n} onPress={() => { tap(); set((c) => ({ ...c, aircraftRows: n as number })); }} />
                  ))}
                </View>
              </>
            ) : null}

            {tab === 'look' ? (
              <>
                <Text style={s.lbl}>ACCENT COLOUR</Text>
                <View style={s.swatches}>
                  {ACCENTS.map((c) => <Swatch key={c} color={c} on={cfg.look.accent.toLowerCase() === c.toLowerCase()} onPress={() => { tap(); setLook({ accent: c }); setHexDraft(c); }} />)}
                </View>
                <View style={[s.two, { alignItems: 'flex-end' }]}>
                  <Field label="Your own colour" value={hexDraft} placeholder="#00A6C8" cap="characters"
                    onChange={(v) => { setHexDraft(v); const m = /^#?([0-9a-fA-F]{6})$/.exec(v.trim()); if (m) setLook({ accent: `#${m[1].toUpperCase()}` }); }} />
                  <View style={{ flex: 1 }} />
                </View>
                <Text style={[s.lbl, { marginTop: 20 }]}>SIDE PANEL</Text>
                <View style={s.swatches}>
                  {SIDES.map((c) => <Swatch key={c} color={c} on={cfg.look.side.toLowerCase() === c.toLowerCase()} onPress={() => { tap(); setLook({ side: c }); }} />)}
                </View>
                <View style={[s.chips, { marginTop: 12 }]}>
                  <Chip label="Panel on the left" on={!cfg.look.sideRight} onPress={() => { tap(); setLook({ sideRight: false }); }} />
                  <Chip label="Panel on the right" on={cfg.look.sideRight} onPress={() => { tap(); setLook({ sideRight: true }); }} />
                </View>
                <Text style={[s.lbl, { marginTop: 22 }]}>TYPEFACE</Text>
                <View style={s.chips}>
                  {FONTS.map((f) => <Chip key={f.k} label={f.label} on={cfg.look.font === f.k} onPress={() => { tap(); setLook({ font: f.k }); }} />)}
                </View>
                <Text style={[s.lbl, { marginTop: 22 }]}>TEXT SIZE</Text>
                <View style={s.chips}>
                  {(['compact', 'regular', 'large'] as const).map((z) => (
                    <Chip key={z} label={z.charAt(0).toUpperCase() + z.slice(1)} on={cfg.look.size === z} onPress={() => { tap(); setLook({ size: z }); }} />
                  ))}
                </View>
              </>
            ) : null}

            {tab === 'pages' ? (
              <>
                <Text style={s.lbl}>LOGBOOK SPREADS TO ATTACH</Text>
                <View style={s.chips}>
                  {SPREAD_CHOICES.map((n) => (
                    <Chip key={n} label={n === 0 ? 'None' : String(n)} on={cfg.spreads === n} onPress={() => { tap(); set((c) => ({ ...c, spreads: n })); if (n > 0) setView('pages'); }} />
                  ))}
                </View>
                {books.length > 1 ? (
                  <>
                    <Text style={[s.lbl, { marginTop: 20 }]}>FROM WHICH BOOK</Text>
                    <View style={s.chips}>
                      <Chip label="The active book" on={cfg.bookId == null} onPress={() => { tap(); set((c) => ({ ...c, bookId: null })); }} />
                      {books.map((b) => <Chip key={b.id} label={b.name} on={cfg.bookId === b.id} onPress={() => { tap(); set((c) => ({ ...c, bookId: b.id })); }} />)}
                    </View>
                  </>
                ) : null}
                <Text style={[s.note, { marginTop: 16 }]}>
                  {books.length === 0 ? 'You have no digital logbook yet. Create one under Logbook, Book, and its pages can be attached here.'
                    : cfg.spreads === 0 ? 'No logbook pages are attached.'
                    : spreads ? `The ${spreads.n === 1 ? 'latest spread' : `${spreads.n} latest spreads`}, pages ${spreads.pageFrom} to ${spreads.pageTo}, from "${spreads.bookName}". They are taken straight from your book, one spread a page, after the CV.`
                    : 'This book has no pages yet.'}
                </Text>
              </>
            ) : null}
          </ScrollView>
        </>
      )}
    </View>
  );
}

function Field({ label, value, onChange, placeholder, multiline, keyboard, cap = 'sentences', flex = 1 }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean;
  keyboard?: 'email-address' | 'phone-pad'; cap?: 'none' | 'sentences' | 'words' | 'characters'; flex?: number;
}) {
  return (
    <View style={{ flex, minWidth: 0, marginTop: 12 }}>
      <Text style={s.flbl}>{label.toUpperCase()}</Text>
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={Colors.textMuted}
        multiline={multiline} keyboardType={keyboard} autoCapitalize={cap} autoCorrect={!!multiline}
        style={[s.input, multiline && { height: 92, paddingTop: 11, textAlignVertical: 'top' }]} accessibilityLabel={label} />
    </View>
  );
}

function ListHead({ title, onAdd }: { title: string; onAdd: () => void }) {
  return (
    <View style={s.lhead}>
      <Text style={[s.lbl, { flex: 1, marginTop: 0 }]}>{title.toUpperCase()}</Text>
      <Pressable onPress={onAdd} style={s.add} hitSlop={6} accessibilityRole="button" accessibilityLabel={`Add to ${title}`}>
        <Ionicons name="add" size={17} color={Colors.primary} />
        <Text style={s.linkText}>Add</Text>
      </Pressable>
    </View>
  );
}

function ListRow({ children, onRemove, column }: { children: React.ReactNode; onRemove: () => void; column?: boolean }) {
  return (
    <View style={s.lrow}>
      <View style={[{ flex: 1, minWidth: 0 }, column ? null : { flexDirection: 'row', gap: 10 }]}>{children}</View>
      <Pressable onPress={onRemove} style={s.remove} hitSlop={4} accessibilityRole="button" accessibilityLabel="Remove">
        <Ionicons name="close" size={18} color={Colors.textSecondary} />
      </Pressable>
    </View>
  );
}

function Chip({ label, on, dim, onPress }: { label: string; on: boolean; dim?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.chip, on && s.chipOn, dim && { opacity: 0.35 }]} accessibilityRole="button" accessibilityState={{ selected: on, disabled: !!dim }}>
      <Text style={[s.chipText, on && { color: '#FFFFFF' }]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

function Swatch({ color, on, onPress }: { color: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[s.swatch, on && { borderColor: Colors.primary }]} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`Colour ${color}`}>
      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: color, borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)' }} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 6, gap: 4 },
  hbtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontFamily: SERIF, fontSize: 24, fontWeight: '600', color: Colors.textPrimary },
  share: { height: 40, minWidth: 108, paddingHorizontal: 14, marginRight: 8, borderRadius: 13, backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center' },
  shareText: { fontSize: 14.5, fontWeight: '800', color: Colors.textInverse },
  preview: { marginHorizontal: 18, borderRadius: 12, overflow: 'hidden', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: Colors.border },
  expand: { position: 'absolute', right: 8, top: 8, width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(10,22,40,0.72)', alignItems: 'center', justifyContent: 'center' },
  pvTabs: { position: 'absolute', left: 8, bottom: 8, flexDirection: 'row', gap: 6 },
  pvTab: { height: 30, paddingHorizontal: 11, borderRadius: 15, backgroundColor: 'rgba(10,22,40,0.78)', alignItems: 'center', justifyContent: 'center' },
  pvTabOn: { backgroundColor: Colors.primary },
  pvTabText: { fontFamily: MONO, fontSize: 10.5, fontWeight: '700', color: '#FFFFFF' },
  tabs: { flexDirection: 'row', gap: 6, marginHorizontal: 18, marginTop: 12, padding: 4, borderRadius: 14, backgroundColor: 'rgba(15,30,58,0.7)', borderWidth: 1, borderColor: Colors.border },
  tab: { flex: 1, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  tabOn: { backgroundColor: Colors.primary },
  tabText: { fontSize: 13.5, fontWeight: '700', color: Colors.textSecondary },
  note: { fontSize: 12.5, lineHeight: 18, color: Colors.textSecondary, marginTop: 10 },
  lbl: { fontFamily: MONO, fontSize: 10.5, fontWeight: '700', letterSpacing: 1.6, color: Colors.textSecondary, marginTop: 16 },
  flbl: { fontFamily: MONO, fontSize: 9.5, fontWeight: '700', letterSpacing: 1.3, color: Colors.textSecondary, marginBottom: 5 },
  input: { height: 46, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, backgroundColor: 'rgba(15,30,58,0.6)', paddingHorizontal: 12, fontSize: 15, color: Colors.textPrimary },
  two: { flexDirection: 'row', gap: 10 },
  lhead: { flexDirection: 'row', alignItems: 'center', marginTop: 26 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 36, paddingHorizontal: 8 },
  lrow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  remove: { width: 40, height: 46, alignItems: 'center', justifyContent: 'center' },
  link: { flexDirection: 'row', alignItems: 'center', gap: 7, height: 44, marginTop: 20 },
  linkText: { fontSize: 13.5, fontWeight: '700', color: Colors.primary },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 46, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' },
  rowText: { flex: 1, fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: { height: 40, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(127,168,200,0.25)', backgroundColor: 'rgba(15,30,58,0.55)', justifyContent: 'center', maxWidth: '100%' },
  chipOn: { borderColor: Colors.primary, backgroundColor: 'rgba(0,200,232,0.16)' },
  chipText: { fontFamily: MONO, fontSize: 12.5, fontWeight: '600', color: '#CFE0EE' },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  swatch: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
});
