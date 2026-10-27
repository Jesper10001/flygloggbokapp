// Acknowledgements — öppen data, öppen källkod och typsnitt som skeppas i appen. Licenserna (MIT, BSD, Apache,
// CC BY, ODbL, OFL …) kräver att upphovsrätt + licenstext följer med appen → här, under Settings → About.
// Innehållet genereras av scripts/gen-licenses.mjs → constants/licenses.json (kör om före release).
import { useMemo, useState } from 'react';
import { View, Text, SectionList, TouchableOpacity, StyleSheet, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import LICENSES from '../../constants/licenses.json';

type Entry = {
  name: string;
  version?: string;
  license: string;
  url?: string;
  copyright?: string[];
  text?: string;
  credit?: string;
  note?: string;
};
type Section = { key: 'data' | 'software' | 'fonts'; title: string; data: Entry[] };

const TEXTS = LICENSES.texts as Record<string, string>;
const prettyUrl = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

export default function AcknowledgementsScreen() {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });

  const sections = useMemo<Section[]>(() => [
    { key: 'data', title: 'Data & content', data: LICENSES.data as Entry[] },
    { key: 'software', title: `Open-source software · ${LICENSES.software.length}`, data: LICENSES.software as Entry[] },
    { key: 'fonts', title: 'Fonts & icons', data: LICENSES.fonts as Entry[] },
  ], []);

  const renderItem = ({ item, section, index }: { item: Entry; section: Section; index: number }) => {
    const k = `${section.key}:${item.name}`;
    const expanded = open.has(k);
    const hasDetail = !!(item.text || item.note || (section.key !== 'data' && item.copyright && item.copyright.length > 1));
    const last = index === section.data.length - 1;
    return (
      <View style={[s.row, index === 0 && s.rowFirst, last && s.rowLast]}>
        <TouchableOpacity activeOpacity={hasDetail ? 0.7 : 1} disabled={!hasDetail} onPress={() => toggle(k)} style={s.rowHead}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={s.name}>
              {item.name}
              {item.version ? <Text style={s.version}>  {item.version}</Text> : null}
            </Text>
            {item.credit ? <Text style={s.credit}>{item.credit}</Text> : null}
            <Text style={s.meta} numberOfLines={expanded ? undefined : 1}>
              {item.license}
              {!expanded && section.key !== 'data' && item.copyright?.[0] ? `  ·  ${item.copyright[0]}` : ''}
            </Text>
          </View>
          {hasDetail ? <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={15} color={Colors.textMuted} style={{ marginTop: 2 }} /> : null}
        </TouchableOpacity>

        {expanded ? (
          <View style={s.detail}>
            {item.copyright?.map((c) => <Text key={c} style={s.copyright}>{c}</Text>)}
            {item.note ? <Text style={s.note}>{item.note}</Text> : null}
            {item.text ? <Text style={s.licenseText} selectable>{TEXTS[item.text]}</Text> : null}
          </View>
        ) : null}

        {item.url && (expanded || section.key === 'data') ? (
          <TouchableOpacity onPress={() => { Linking.openURL(item.url!).catch(() => {}); }} hitSlop={6} style={s.linkRow} activeOpacity={0.7}>
            <Ionicons name="open-outline" size={12} color={Colors.primary} />
            <Text style={s.link} numberOfLines={1}>{prettyUrl(item.url)}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  return (
    <View style={s.screen}>
      <SectionList
        sections={sections}
        keyExtractor={(item, i) => `${item.name}:${i}`}
        renderItem={renderItem}
        renderSectionHeader={({ section }) => <Text style={s.sectionTitle}>{section.title}</Text>}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={s.content}
        initialNumToRender={24}
        ListHeaderComponent={(
          <View style={s.hero}>
            <View style={s.heroBadge}><Ionicons name="ribbon-outline" size={24} color={Colors.primary} /></View>
            <Text style={s.heroTitle}>Acknowledgements</Text>
            <Text style={s.heroSub}>
              Blades is built on open data and open-source software. Thank you to everyone who shares their work.
            </Text>
          </View>
        )}
        ListFooterComponent={(
          <Text style={s.footer}>
            Tap an entry to read its license. Licenses are reproduced as provided by each project.
          </Text>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 20, paddingBottom: 48 },
  hero: { alignItems: 'center', gap: 8, marginBottom: 8, paddingHorizontal: 8 },
  heroBadge: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: Colors.primary + '1A',
    borderWidth: 1, borderColor: Colors.primary + '44', alignItems: 'center', justifyContent: 'center',
  },
  heroTitle: { fontFamily: 'Georgia', fontSize: 23, fontWeight: '400', color: Colors.textPrimary },
  heroSub: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 19 },
  sectionTitle: {
    fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', color: Colors.textMuted,
    marginTop: 22, marginBottom: 8, paddingHorizontal: 4,
  },
  row: {
    backgroundColor: Colors.card, borderLeftWidth: 1, borderRightWidth: 1, borderColor: Colors.cardBorder,
    borderBottomWidth: 0.5, borderBottomColor: Colors.separator, paddingVertical: 12, paddingHorizontal: 16,
  },
  rowFirst: { borderTopWidth: 1, borderTopColor: Colors.cardBorder, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  rowLast: { borderBottomWidth: 1, borderBottomColor: Colors.cardBorder, borderBottomLeftRadius: 16, borderBottomRightRadius: 16 },
  rowHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  name: { fontSize: 14.5, fontWeight: '600', color: Colors.textPrimary },
  version: { fontSize: 11.5, fontWeight: '400', color: Colors.textMuted, fontFamily: 'Menlo' },
  credit: { fontSize: 12.5, color: Colors.textSecondary, lineHeight: 18 },
  meta: { fontSize: 11, color: Colors.textMuted, fontFamily: 'Menlo' },
  detail: { marginTop: 10, gap: 6 },
  copyright: { fontSize: 12, color: Colors.textSecondary },
  note: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  licenseText: { fontSize: 11, color: Colors.textMuted, lineHeight: 16, marginTop: 4 },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 8, alignSelf: 'flex-start' },
  link: { fontSize: 12, color: Colors.primary },
  footer: { fontSize: 11.5, color: Colors.textMuted, lineHeight: 16, textAlign: 'center', marginTop: 20, paddingHorizontal: 12 },
});
