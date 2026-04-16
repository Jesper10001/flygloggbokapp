import { useCallback, useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, TextInput,
  Modal, Pressable, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import {
  listBooks, addBook, deleteBook, renameBook, setActiveBook,
  type LogbookBook,
} from '../../db/logbookBooks';
import { LOGBOOK_TEMPLATES, getTemplate } from '../../constants/logbookTemplates';

export default function LogbookBooksScreen() {
  const { t } = useTranslation();
  const [books, setBooks] = useState<LogbookBook[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<LogbookBook | null>(null);

  const load = async () => setBooks(await listBooks());
  useFocusEffect(useCallback(() => { load(); }, []));

  const handleDelete = (b: LogbookBook) => {
    Alert.alert(
      `${t('delete_book_title')} (${b.name})`,
      t('delete_book_body'),
      [
        { text: t('cancel'), style: 'cancel' },
        {
          text: t('delete'), style: 'destructive',
          onPress: async () => { await deleteBook(b.id); await load(); },
        },
      ],
    );
  };

  const handleActivate = async (id: number) => {
    await setActiveBook(id);
    await load();
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.subtitle}>{t('logbook_books_subtitle')}</Text>

      {books.map((b) => {
        const tpl = getTemplate(b.template_id);
        return (
          <View key={b.id} style={[styles.row, b.is_active === 1 && styles.rowActive]}>
            <TouchableOpacity style={{ flex: 1 }} onPress={() => setEditing(b)} activeOpacity={0.75}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.rowTitle}>{b.name}</Text>
                {b.is_active === 1 && (
                  <View style={styles.activeBadge}>
                    <Text style={styles.activeBadgeText}>{t('active')}</Text>
                  </View>
                )}
              </View>
              <Text style={styles.rowMeta}>
                {tpl.name} · {t('starting_page')} {b.starting_page} · {b.transcribed_spreads} {t('spreads_written')}
              </Text>
            </TouchableOpacity>
            {b.is_active !== 1 && (
              <TouchableOpacity onPress={() => handleActivate(b.id)} hitSlop={8} style={{ padding: 4 }}>
                <Ionicons name="radio-button-off" size={18} color={Colors.textMuted} />
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => handleDelete(b)} hitSlop={8} style={{ padding: 4 }}>
              <Ionicons name="trash-outline" size={16} color={Colors.textMuted} />
            </TouchableOpacity>
          </View>
        );
      })}

      {books.length === 0 && (
        <View style={styles.empty}>
          <Ionicons name="book-outline" size={40} color={Colors.textMuted} />
          <Text style={styles.emptyText}>{t('logbook_books_empty')}</Text>
        </View>
      )}

      <TouchableOpacity style={styles.addBtn} onPress={() => setAdding(true)} activeOpacity={0.8}>
        <Ionicons name="add" size={18} color={Colors.textInverse} />
        <Text style={styles.addBtnText}>{t('add_logbook_book')}</Text>
      </TouchableOpacity>

      <BookFormModal
        visible={adding}
        initial={null}
        onClose={() => setAdding(false)}
        onSaved={async () => { await load(); setAdding(false); }}
      />
      <BookFormModal
        visible={!!editing}
        initial={editing}
        onClose={() => setEditing(null)}
        onSaved={async () => { await load(); setEditing(null); }}
      />
    </ScrollView>
  );
}

function BookFormModal({
  visible, initial, onClose, onSaved,
}: {
  visible: boolean;
  initial: LogbookBook | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [startPage, setStartPage] = useState('1');
  const [templateId, setTemplateId] = useState<string>(LOGBOOK_TEMPLATES[0].id);

  useEffect(() => {
    if (!visible) return;
    if (initial) {
      setName(initial.name);
      setStartPage(String(initial.starting_page));
      setTemplateId(initial.template_id);
    } else {
      setName('');
      setStartPage('1');
      setTemplateId(LOGBOOK_TEMPLATES[0].id);
    }
  }, [visible, initial]);

  const save = async () => {
    const n = name.trim();
    if (!n) { Alert.alert(t('error'), t('enter_name') as string); return; }
    const sp = parseInt(startPage, 10) || 1;
    const tpl = getTemplate(templateId);
    if (initial) {
      await renameBook(initial.id, n);
    } else {
      await addBook(n, templateId, sp, tpl.rows_per_spread);
    }
    onSaved();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.modalBackdrop} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>{initial ? t('edit_book') : t('add_logbook_book')}</Text>

          <Text style={styles.label}>{t('book_name')}</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Bok 1"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="words"
          />

          {!initial && (
            <>
              <Text style={styles.label}>{t('starting_page')}</Text>
              <TextInput
                style={styles.input}
                value={startPage}
                onChangeText={(v) => setStartPage(v.replace(/\D/g, ''))}
                placeholder="1"
                placeholderTextColor={Colors.textMuted}
                keyboardType="number-pad"
              />

              <Text style={styles.label}>{t('template')}</Text>
              <View style={{ gap: 6 }}>
                {LOGBOOK_TEMPLATES.map((tpl) => {
                  const active = templateId === tpl.id;
                  return (
                    <TouchableOpacity
                      key={tpl.id}
                      style={[styles.tplBtn, active && styles.tplBtnActive]}
                      onPress={() => setTemplateId(tpl.id)}
                      activeOpacity={0.75}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.tplName, active && { color: Colors.primary }]}>{tpl.name}</Text>
                        <Text style={styles.tplMeta}>
                          {tpl.rows_per_spread} {t('rows_per_spread')} · {tpl.time_format === 'decimal' ? 'decimal' : 'HH:MM'}
                        </Text>
                      </View>
                      {active && <Ionicons name="checkmark" size={18} color={Colors.primary} />}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
            <TouchableOpacity style={styles.cancel} onPress={onClose} activeOpacity={0.7}>
              <Text style={styles.cancelText}>{t('cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.saveBtn} onPress={save} activeOpacity={0.85}>
              <Text style={styles.saveText}>{t('save')}</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, gap: 8, paddingBottom: 40 },
  subtitle: { color: Colors.textSecondary, fontSize: 13, marginBottom: 6 },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.card, borderRadius: 12, padding: 14,
    borderWidth: 0.5, borderColor: Colors.cardBorder,
  },
  rowActive: { borderColor: Colors.primary, borderWidth: 1 },
  rowTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
  rowMeta: { color: Colors.textSecondary, fontSize: 12, marginTop: 2 },
  activeBadge: {
    backgroundColor: Colors.primary + '22', borderRadius: 4,
    paddingHorizontal: 6, paddingVertical: 2,
    borderWidth: 0.5, borderColor: Colors.primary + '88',
  },
  activeBadgeText: { color: Colors.primary, fontSize: 9, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' },

  empty: { alignItems: 'center', gap: 10, paddingVertical: 40 },
  emptyText: { color: Colors.textSecondary, fontSize: 13, textAlign: 'center' },

  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 13, marginTop: 8,
  },
  addBtnText: { color: Colors.textInverse, fontSize: 14, fontWeight: '800' },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 18, borderTopRightRadius: 18,
    padding: 20, paddingBottom: 36, gap: 6,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 8 },
  sheetTitle: { color: Colors.textPrimary, fontSize: 17, fontWeight: '800', marginBottom: 8 },
  label: { color: Colors.textSecondary, fontSize: 11, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 6 },
  input: {
    backgroundColor: Colors.elevated, borderRadius: 10, borderWidth: 0.5, borderColor: Colors.border,
    color: Colors.textPrimary, fontSize: 14, paddingHorizontal: 12, paddingVertical: 10,
  },
  tplBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.elevated, borderRadius: 10, padding: 12,
    borderWidth: 0.5, borderColor: Colors.border,
  },
  tplBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '14' },
  tplName: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700' },
  tplMeta: { color: Colors.textSecondary, fontSize: 11, marginTop: 2 },

  cancel: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    backgroundColor: Colors.elevated, alignItems: 'center',
    borderWidth: 0.5, borderColor: Colors.border,
  },
  cancelText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '700' },
  saveBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    backgroundColor: Colors.primary, alignItems: 'center',
  },
  saveText: { color: Colors.textInverse, fontSize: 14, fontWeight: '800' },
});
