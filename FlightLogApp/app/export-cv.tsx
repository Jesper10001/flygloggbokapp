// Pilot CV (Settings → Export to PDF): ett CV som användaren bygger själv. Överst en förhandsvisning av den färdiga
// sidan, som ritas om medan man ändrar; under den fyra flikar:
//   Design      – välj en av fyra designer och ett färgtema; finjustering (färger, typsnitt, storlek) under en rad
//   Details     – uppgifterna, ett kort per del (om dig, kontakt, licens, behörigheter, erfarenhet, utbildning,
//                 kunskaper, språk …) med ett reglage per kort för om delen ska med. Hämtas från profilen första
//                 gången och är sedan CV:ts egna.
//   Flight data – det som räknas ur loggboken: vilka totaler, typer, senaste tolv månaderna, milstolpar
//   Logbook     – de senaste uppslagen ur den digitala boken, hämtade direkt ur boken
// Allt man ställer in sparas (services/pdfExport/cvConfig.ts); siffrorna räknas alltid ur loggboken.

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
  loadCv, saveCv, profileDetails, newId, TILES, MAX_TILES, FONTS, ACCENTS, SIDES, TEMPLATES, THEMES, LEADS, SKILL_IDEAS,
  type CvConfig, type TileKey, type SectionKey, type TemplateKey,
} from '../services/pdfExport/cvConfig';
import { suggestSummary } from '../services/pdfExport/cvTemplate';
import { loadCvData, type CvData } from '../services/pdfExport/cvData';
import { cvHtml, exportCvPdf, loadCvSpreads, type Spreads } from '../services/pdfExport/exportCV';

type Tab = 'design' | 'details' | 'data' | 'pages';
const TABS: { k: Tab; label: string }[] = [
  { k: 'design', label: 'Design' }, { k: 'details', label: 'Details' }, { k: 'data', label: 'Flight data' }, { k: 'pages', label: 'Logbook' },
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
  const [tab, setTab] = useState<Tab>('design');
  const [openCard, setOpenCard] = useState<string | null>('about');
  const [fine, setFine] = useState(false);
  const [skillDraft, setSkillDraft] = useState('');
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
  const setSection = (k: SectionKey, v: boolean) => set((c) => ({ ...c, sections: { ...c.sections, [k]: v } }));
  const addSkill = (x: string) => { const v = x.trim(); if (!v) return; set((c) => (c.skills.some((y) => y.toLowerCase() === v.toLowerCase()) ? c : { ...c, skills: [...c.skills, v] })); };
  // Ett kort i Details: rubrik, vad som är ifyllt, reglage för om delen ska med, och fälten när kortet är öppet.
  const card = (id: string, title: string, status: string, section: SectionKey | null, children: React.ReactNode) => (
    <Card key={id} title={title} status={status} open={openCard === id} onOpen={() => { tap(); setOpenCard((o) => (o === id ? null : id)); }}
      included={section ? cfg!.sections[section] : undefined} onInclude={section ? (v) => { tap(); setSection(section, v); } : undefined}>
      {children}
    </Card>
  );
  const count = (n: number, one: string, many: string) => (n === 0 ? 'Empty' : n === 1 ? `1 ${one}` : `${n} ${many}`);
  const filled = (...v: string[]) => (v.some((x) => x.trim()) ? 'Filled in' : 'Empty');

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

            {tab === 'design' ? (
              <>
                <Text style={s.lbl}>CHOOSE A DESIGN</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -18, marginTop: 10 }} contentContainerStyle={{ paddingHorizontal: 18, gap: 10 }}>
                  {TEMPLATES.map((t) => {
                    const on = cfg.template === t.k;
                    return (
                      <Pressable key={t.k} onPress={() => { tap(); set((c) => ({ ...c, template: t.k })); setView('cv'); }} style={[s.tpl, on && s.tplOn]}
                        accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${t.label}. ${t.hint}`}>
                        <Thumb k={t.k} side={cfg.look.side} accent={cfg.look.accent} />
                        <Text style={[s.tplName, on && { color: Colors.textPrimary }]}>{t.label}</Text>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <Text style={s.note}>{TEMPLATES.find((t) => t.k === cfg.template)?.hint}.</Text>

                <Text style={[s.lbl, { marginTop: 20 }]}>COLOUR THEME</Text>
                <View style={s.chips}>
                  {THEMES.map((t) => {
                    const on = cfg.look.accent.toLowerCase() === t.accent.toLowerCase() && cfg.look.side.toLowerCase() === t.side.toLowerCase();
                    return (
                      <Pressable key={t.k} onPress={() => { tap(); setLook({ accent: t.accent, side: t.side }); setHexDraft(t.accent); }} style={[s.chip, s.theme, on && s.chipOn]}
                        accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${t.label} theme`}>
                        <View style={[s.dot, { backgroundColor: t.side }]} /><View style={[s.dot, { backgroundColor: t.accent, marginLeft: -7 }]} />
                        <Text style={[s.chipText, on && { color: '#FFFFFF' }]}>{t.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={[s.lbl, { marginTop: 20 }]}>WHAT COMES FIRST</Text>
                <View style={s.chips}>
                  {LEADS.map((l) => <Chip key={l.k} label={l.label} on={cfg.lead === l.k} onPress={() => { tap(); set((c) => ({ ...c, lead: l.k })); }} />)}
                </View>
                <Text style={s.note}>Hours first suits an experienced pilot. With few hours, lead with your education or experience.</Text>

                <Pressable onPress={() => { tap(); setFine((v) => !v); }} style={s.fine} accessibilityRole="button" accessibilityState={{ expanded: fine }}>
                  <Text style={s.fineText}>Fine-tune colours, typeface and size</Text>
                  <Ionicons name={fine ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.textSecondary} />
                </Pressable>
                {fine ? (
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
                    {cfg.template === 'sidebar' || cfg.template === 'banner' ? (
                      <>
                        <Text style={[s.lbl, { marginTop: 20 }]}>{cfg.template === 'banner' ? 'HEADER COLOUR' : 'SIDE PANEL'}</Text>
                        <View style={s.swatches}>
                          {SIDES.map((c) => <Swatch key={c} color={c} on={cfg.look.side.toLowerCase() === c.toLowerCase()} onPress={() => { tap(); setLook({ side: c }); }} />)}
                        </View>
                        {cfg.template === 'sidebar' ? (
                          <View style={[s.chips, { marginTop: 12 }]}>
                            <Chip label="Panel on the left" on={!cfg.look.sideRight} onPress={() => { tap(); setLook({ sideRight: false }); }} />
                            <Chip label="Panel on the right" on={cfg.look.sideRight} onPress={() => { tap(); setLook({ sideRight: true }); }} />
                          </View>
                        ) : null}
                        <View style={[s.row, { marginTop: 8 }]}>
                          <Text style={s.rowText}>Show my initials</Text>
                          <Switch value={cfg.sections.monogram} onValueChange={(v) => { tap(); setSection('monogram', v); }} trackColor={{ true: Colors.primary, false: 'rgba(127,168,200,0.25)' }} accessibilityLabel="Show my initials" />
                        </View>
                      </>
                    ) : null}
                    <Text style={[s.lbl, { marginTop: 20 }]}>TYPEFACE</Text>
                    <View style={s.chips}>
                      {FONTS.map((f) => <Chip key={f.k} label={f.label} on={cfg.look.font === f.k} onPress={() => { tap(); setLook({ font: f.k }); }} />)}
                    </View>
                    <Text style={[s.lbl, { marginTop: 20 }]}>TEXT SIZE</Text>
                    <View style={s.chips}>
                      {(['compact', 'regular', 'large'] as const).map((z) => (
                        <Chip key={z} label={z.charAt(0).toUpperCase() + z.slice(1)} on={cfg.look.size === z} onPress={() => { tap(); setLook({ size: z }); }} />
                      ))}
                    </View>
                  </>
                ) : null}
              </>
            ) : null}

            {tab === 'details' ? (
              <>
                <Text style={s.note}>Open a part to fill it in. The switch decides whether it is on your CV. Your profile details were filled in for you; changes here stay with the CV.</Text>

                {card('about', 'About you', filled(cfg.details.firstName, cfg.details.lastName), null, (
                  <>
                    <View style={s.two}>
                      <Field label="First name" value={cfg.details.firstName} onChange={(v) => setDetail('firstName', v)} cap="words" />
                      <Field label="Last name" value={cfg.details.lastName} onChange={(v) => setDetail('lastName', v)} cap="words" />
                    </View>
                    <Field label="Title" value={cfg.details.title} onChange={(v) => setDetail('title', v)} placeholder="Helicopter pilot · HEMS captain" />
                  </>
                ))}

                {card('summary', 'Profile text', filled(cfg.details.summary), 'summary', (
                  <>
                    <Field label="Two or three sentences about you as a pilot" value={cfg.details.summary} onChange={(v) => setDetail('summary', v)} multiline />
                    {data ? (
                      <Pressable onPress={() => { tap(); setDetail('summary', suggestSummary(cfg, data)); }} style={s.link} accessibilityRole="button">
                        <Ionicons name="sparkles-outline" size={15} color={Colors.primary} />
                        <Text style={s.linkText}>{cfg.details.summary.trim() ? 'Replace with a suggestion from my logbook' : 'Suggest a text from my logbook'}</Text>
                      </Pressable>
                    ) : null}
                  </>
                ))}

                {card('contact', 'Contact', filled(cfg.details.email, cfg.details.phone, cfg.details.base), 'contact', (
                  <>
                    <View style={s.two}>
                      <Field label="Email" value={cfg.details.email} onChange={(v) => setDetail('email', v)} keyboard="email-address" cap="none" />
                      <Field label="Phone" value={cfg.details.phone} onChange={(v) => setDetail('phone', v)} keyboard="phone-pad" />
                    </View>
                    <View style={s.two}>
                      <Field label="Base" value={cfg.details.base} onChange={(v) => setDetail('base', v)} placeholder="Stockholm (ESSA)" />
                      <Field label="Nationality" value={cfg.details.nationality} onChange={(v) => setDetail('nationality', v)} cap="words" />
                    </View>
                    <Field label="Date of birth" value={cfg.details.dob} onChange={(v) => setDetail('dob', v)} placeholder="Leave empty to leave it out" />
                  </>
                ))}

                {card('licence', 'Licence', filled(cfg.details.licence, cfg.details.licenceNo), 'licence', (
                  <View style={s.two}>
                    <Field label="Licence" value={cfg.details.licence} onChange={(v) => setDetail('licence', v)} placeholder="ATPL(H) · EASA" cap="characters" />
                    <Field label="Licence number" value={cfg.details.licenceNo} onChange={(v) => setDetail('licenceNo', v)} cap="characters" />
                  </View>
                ))}

                {card('certs', 'Ratings and certificates', count(cfg.certs.filter((x) => x.name.trim()).length, 'entry', 'entries'), 'certs', (
                  <>
                    {cfg.certs.map((x) => (
                      <ListRow key={x.id} onRemove={() => set((c) => ({ ...c, certs: c.certs.filter((y) => y.id !== x.id) }))}>
                        <Field flex={1.4} label="Name" value={x.name} placeholder="IR(H)" onChange={(v) => set((c) => ({ ...c, certs: c.certs.map((y) => (y.id === x.id ? { ...y, name: v } : y)) }))} />
                        <Field label="Valid to" value={x.valid} placeholder="2027-08-31" onChange={(v) => set((c) => ({ ...c, certs: c.certs.map((y) => (y.id === x.id ? { ...y, valid: v } : y)) }))} />
                      </ListRow>
                    ))}
                    <AddRow label="Add a rating or certificate" onPress={() => { tap(); set((c) => ({ ...c, certs: [...c.certs, { id: newId(), name: '', valid: '' }] })); }} />
                  </>
                ))}

                {card('experience', 'Experience', count(cfg.experience.filter((x) => x.role.trim() || x.detail.trim()).length, 'role', 'roles'), 'experience', (
                  <>
                    {cfg.experience.map((x) => (
                      <ListRow key={x.id} column onRemove={() => set((c) => ({ ...c, experience: c.experience.filter((y) => y.id !== x.id) }))}>
                        <View style={s.two}>
                          <Field label="Years" value={x.period} placeholder="2021–" onChange={(v) => set((c) => ({ ...c, experience: c.experience.map((y) => (y.id === x.id ? { ...y, period: v } : y)) }))} />
                          <Field flex={2} label="Role" value={x.role} placeholder="HEMS captain" onChange={(v) => set((c) => ({ ...c, experience: c.experience.map((y) => (y.id === x.id ? { ...y, role: v } : y)) }))} />
                        </View>
                        <Field label="Employer and what you did" value={x.detail} multiline placeholder="Operator, aircraft, kind of flying. Numbers help." onChange={(v) => set((c) => ({ ...c, experience: c.experience.map((y) => (y.id === x.id ? { ...y, detail: v } : y)) }))} />
                      </ListRow>
                    ))}
                    <AddRow label="Add a role" onPress={() => { tap(); set((c) => ({ ...c, experience: [...c.experience, { id: newId(), period: '', role: '', detail: '' }] })); }} />
                    <Text style={s.note}>Newest first.</Text>
                  </>
                ))}

                {card('education', 'Education', count(cfg.education.filter((x) => x.school.trim() || x.detail.trim()).length, 'entry', 'entries'), 'education', (
                  <>
                    {cfg.education.map((x) => (
                      <ListRow key={x.id} column onRemove={() => set((c) => ({ ...c, education: c.education.filter((y) => y.id !== x.id) }))}>
                        <View style={s.two}>
                          <Field label="Years" value={x.period} placeholder="2014–2016" onChange={(v) => set((c) => ({ ...c, education: c.education.map((y) => (y.id === x.id ? { ...y, period: v } : y)) }))} />
                          <Field flex={2} label="School" value={x.school} placeholder="Flight academy or university" onChange={(v) => set((c) => ({ ...c, education: c.education.map((y) => (y.id === x.id ? { ...y, school: v } : y)) }))} />
                        </View>
                        <Field label="Course or degree" value={x.detail} placeholder="Integrated CPL(H) with IR" onChange={(v) => set((c) => ({ ...c, education: c.education.map((y) => (y.id === x.id ? { ...y, detail: v } : y)) }))} />
                      </ListRow>
                    ))}
                    <AddRow label="Add a school or course" onPress={() => { tap(); set((c) => ({ ...c, education: [...c.education, { id: newId(), period: '', school: '', detail: '' }] })); }} />
                  </>
                ))}

                {card('skills', 'Skills', count(cfg.skills.length, 'skill', 'skills'), 'skills', (
                  <>
                    {cfg.skills.length ? (
                      <View style={s.chips}>
                        {cfg.skills.map((x) => (
                          <Pressable key={x} onPress={() => { tap(); set((c) => ({ ...c, skills: c.skills.filter((y) => y !== x) })); }} style={[s.chip, s.chipOn, s.theme]}
                            accessibilityRole="button" accessibilityLabel={`Remove ${x}`}>
                            <Text style={[s.chipText, { color: '#FFFFFF' }]}>{x}</Text>
                            <Ionicons name="close" size={14} color="#FFFFFF" />
                          </Pressable>
                        ))}
                      </View>
                    ) : null}
                    <View style={[s.two, { alignItems: 'flex-end' }]}>
                      <Field flex={3} label="Add your own" value={skillDraft} onChange={setSkillDraft} placeholder="Type a skill" />
                      <Pressable onPress={() => { tap(); addSkill(skillDraft); setSkillDraft(''); }} style={s.addBtn} accessibilityRole="button" accessibilityLabel="Add the skill">
                        <Text style={s.linkText}>Add</Text>
                      </Pressable>
                    </View>
                    <Text style={[s.flbl, { marginTop: 16 }]}>TAP TO ADD</Text>
                    <View style={[s.chips, { marginTop: 4 }]}>
                      {SKILL_IDEAS.filter((x) => !cfg.skills.some((y) => y.toLowerCase() === x.toLowerCase())).map((x) => (
                        <Chip key={x} label={`+ ${x}`} on={false} onPress={() => { tap(); addSkill(x); }} />
                      ))}
                    </View>
                  </>
                ))}

                {card('languages', 'Languages', count(cfg.languages.filter((x) => x.name.trim()).length, 'language', 'languages'), 'languages', (
                  <>
                    {cfg.languages.map((x) => (
                      <ListRow key={x.id} onRemove={() => set((c) => ({ ...c, languages: c.languages.filter((y) => y.id !== x.id) }))}>
                        <Field label="Language" value={x.name} cap="words" onChange={(v) => set((c) => ({ ...c, languages: c.languages.map((y) => (y.id === x.id ? { ...y, name: v } : y)) }))} />
                        <Field label="Level" value={x.level} placeholder="ICAO Level 6" onChange={(v) => set((c) => ({ ...c, languages: c.languages.map((y) => (y.id === x.id ? { ...y, level: v } : y)) }))} />
                      </ListRow>
                    ))}
                    <AddRow label="Add a language" onPress={() => { tap(); set((c) => ({ ...c, languages: [...c.languages, { id: newId(), name: '', level: '' }] })); }} />
                  </>
                ))}

                {card('additional', 'Additional information', filled(cfg.additional), 'additional', (
                  <Field label="Anything else worth knowing" value={cfg.additional} multiline placeholder="Security clearance, medical class, right to work …" onChange={(v) => set((c) => ({ ...c, additional: v }))} />
                ))}

                {card('references', 'References', filled(cfg.references), 'references', (
                  <Field label="References" value={cfg.references} multiline onChange={(v) => set((c) => ({ ...c, references: v }))} />
                ))}

                <Pressable onPress={async () => { tap(); const p = await profileDetails(); set((c) => ({ ...c, details: { ...c.details, ...Object.fromEntries(Object.entries(p.details).filter(([, v]) => v)) } })); }}
                  style={s.link} accessibilityRole="button">
                  <Ionicons name="refresh" size={15} color={Colors.primary} />
                  <Text style={s.linkText}>Fetch my profile details again</Text>
                </Pressable>
              </>
            ) : null}

            {tab === 'data' ? (
              <>
                <Text style={s.note}>These come straight from your logbook and are worked out again every time you create the PDF.</Text>
                {([['totals', 'Total flight time and totals'], ['aircraft', 'Aircraft types'], ['last12', 'Last 12 months'], ['milestones', 'Milestones'], ['footer', 'Footnote about the totals']] as [SectionKey, string][]).map(([key, l]) => (
                  <View key={key} style={s.row}>
                    <Text style={s.rowText}>{l}</Text>
                    <Switch value={cfg.sections[key]} onValueChange={(v) => { tap(); setSection(key, v); }}
                      trackColor={{ true: Colors.primary, false: 'rgba(127,168,200,0.25)' }} accessibilityLabel={l} />
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
                        set((c) => ({ ...c, tiles: on ? c.tiles.filter((x) => x !== t.k) : [...c.tiles, t.k as TileKey] }));
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

// Ett kort i Details: tryck på raden för att öppna, reglaget avgör om delen ska med på CV:t.
function Card({ title, status, open, onOpen, included, onInclude, children }: {
  title: string; status: string; open: boolean; onOpen: () => void; included?: boolean; onInclude?: (v: boolean) => void; children: React.ReactNode;
}) {
  const off = included === false;
  return (
    <View style={[s.card, open && { borderColor: 'rgba(0,200,232,0.45)' }]}>
      <View style={s.cardHead}>
        <Pressable onPress={onOpen} style={s.cardTap} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${title}, ${status}`}>
          <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={17} color={Colors.textSecondary} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[s.cardTitle, off && { color: Colors.textSecondary }]} numberOfLines={1}>{title}</Text>
            <Text style={[s.cardStatus, status !== 'Empty' && !off && { color: Colors.success }]}>{off ? 'Not on your CV' : status}</Text>
          </View>
        </Pressable>
        {onInclude ? (
          <Switch value={!!included} onValueChange={onInclude} trackColor={{ true: Colors.primary, false: 'rgba(127,168,200,0.25)' }} accessibilityLabel={`${title} on my CV`} />
        ) : null}
      </View>
      {open ? <View style={s.cardBody}>{children}</View> : null}
    </View>
  );
}

function AddRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={s.addRow} accessibilityRole="button">
      <Ionicons name="add" size={18} color={Colors.primary} />
      <Text style={s.linkText}>{label}</Text>
    </Pressable>
  );
}

// En liten bild av designen, i valda färger.
function Thumb({ k, side, accent }: { k: TemplateKey; side: string; accent: string }) {
  const line = (w: number | string, c = '#C3CEDB', h = 2) => <View style={{ width: w as any, height: h, borderRadius: 1, backgroundColor: c }} />;
  const bars = <View style={{ height: 14, flexDirection: 'row', alignItems: 'flex-end', gap: 2 }}>{[6, 9, 12, 14, 10, 7].map((h, i) => <View key={i} style={{ flex: 1, height: h, backgroundColor: accent }} />)}</View>;
  const body = (
    <View style={{ flex: 1, padding: 7, gap: 4 }}>
      {line(34, '#0A1628', 5)}{line(24, accent)}
      <View style={{ height: 13, borderRadius: 2, backgroundColor: '#E9EFF5', marginTop: 2 }} />
      {line('100%')}{line('100%')}{bars}{line('100%')}{line('70%')}
    </View>
  );
  if (k === 'sidebar') {
    return (
      <View style={s.thumb}>
        <View style={{ width: 24, backgroundColor: side, padding: 5, gap: 4 }}>
          <View style={{ width: 11, height: 11, borderRadius: 6, borderWidth: 1, borderColor: accent }} />
          {line(12, accent)}{line(14, '#8FA3BA')}{line(14, '#8FA3BA')}{line(12, accent)}{line(14, '#8FA3BA')}
        </View>
        {body}
      </View>
    );
  }
  if (k === 'banner') {
    return (
      <View style={[s.thumb, { flexDirection: 'column' }]}>
        <View style={{ height: 24, backgroundColor: side, padding: 6, gap: 3, justifyContent: 'center' }}>{line(30, '#FFFFFF', 4)}{line(20, accent)}</View>
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View style={{ flex: 1.8, padding: 6, gap: 4 }}><View style={{ height: 12, borderRadius: 2, backgroundColor: '#E9EFF5' }} />{line('100%')}{line('100%')}{bars}{line('100%')}</View>
          <View style={{ flex: 1, padding: 6, paddingLeft: 0, gap: 4 }}>{line(14, accent)}{line('100%')}{line('100%')}{line(14, accent)}{line('100%')}</View>
        </View>
      </View>
    );
  }
  if (k === 'classic') {
    return (
      <View style={[s.thumb, { flexDirection: 'column', padding: 7, gap: 4, alignItems: 'center' }]}>
        {line(38, '#0A1628', 5)}{line(26, accent)}{line('100%', '#0A1628', 1)}
        <View style={{ alignSelf: 'stretch', gap: 4 }}>{line(16, accent)}{line('100%')}{line('100%')}{line(16, accent)}{bars}{line(16, accent)}{line('100%')}{line('70%')}</View>
      </View>
    );
  }
  return (
    <View style={[s.thumb, { flexDirection: 'column', padding: 7, gap: 5 }]}>
      {line(38, '#0A1628', 5)}{line(26, accent)}
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 5, borderTopWidth: 1, borderTopColor: '#DCE3EB', paddingTop: 4 }}>
          <View style={{ width: 16 }}>{line(14, accent)}</View>
          <View style={{ flex: 1, gap: 3 }}>{i === 1 ? bars : <>{line('100%')}{line('80%')}</>}</View>
        </View>
      ))}
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
  tpl: { width: 104, padding: 7, borderRadius: 14, borderWidth: 2, borderColor: 'transparent', backgroundColor: 'rgba(15,30,58,0.55)', alignItems: 'center', gap: 7 },
  tplOn: { borderColor: Colors.primary, backgroundColor: 'rgba(0,200,232,0.12)' },
  tplName: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary },
  thumb: { width: 86, height: 120, borderRadius: 5, overflow: 'hidden', backgroundColor: '#FFFFFF', flexDirection: 'row' },
  theme: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  fine: { flexDirection: 'row', alignItems: 'center', minHeight: 48, marginTop: 20, paddingHorizontal: 14, borderRadius: 13, borderWidth: 1, borderColor: Colors.border, backgroundColor: 'rgba(15,30,58,0.55)' },
  fineText: { flex: 1, fontSize: 14.5, fontWeight: '700', color: Colors.textPrimary },
  card: { marginTop: 10, borderRadius: 15, borderWidth: 1, borderColor: Colors.border, backgroundColor: 'rgba(15,30,58,0.55)' },
  cardHead: { flexDirection: 'row', alignItems: 'center', minHeight: 58, paddingRight: 12 },
  cardTap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 12, paddingVertical: 9, minHeight: 58 },
  cardTitle: { fontSize: 15.5, fontWeight: '700', color: Colors.textPrimary },
  cardStatus: { fontFamily: MONO, fontSize: 10.5, fontWeight: '600', color: Colors.textSecondary, marginTop: 2 },
  cardBody: { paddingHorizontal: 12, paddingBottom: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.07)' },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 44, marginTop: 8 },
  addBtn: { height: 46, paddingHorizontal: 16, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(0,200,232,0.45)', alignItems: 'center', justifyContent: 'center' },
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
