import { useEffect, useState } from 'react';
import {
  View, Text, FlatList, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getAllAuditLog } from '../../db/flights';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import type { AuditEntry } from '../../types/flight';

const FIELD_LABELS: Record<string, string> = {
  date: 'Date', aircraft_type: 'Type', registration: 'Reg',
  dep_place: 'Departure', dep_utc: 'Dep.time', arr_place: 'Arrival', arr_utc: 'Arr.time',
  total_time: 'Flight time', pic: 'PIC', co_pilot: 'Co-pilot', dual: 'Dual',
  ifr: 'IFR', night: 'Night', landings_day: 'Land.day', landings_night: 'Land.night',
  remarks: 'Remarks', status: 'Status',
};

function makeStyles() {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 10 },
    emptyText: { color: Colors.textPrimary, fontSize: 16, fontWeight: '700' },
    emptySubtext: { color: Colors.textSecondary, fontSize: 13, textAlign: 'center' },

    notice: {
      flexDirection: 'row', gap: 6, alignItems: 'center',
      backgroundColor: Colors.card, padding: 10,
      borderBottomWidth: 1, borderBottomColor: Colors.border,
    },
    noticeText: { color: Colors.textMuted, fontSize: 12, flex: 1 },

    row: {
      backgroundColor: Colors.card, borderRadius: 10, padding: 12,
      borderWidth: 1, borderColor: Colors.cardBorder, gap: 6,
    },
    rowHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    rowFlight: { color: Colors.textPrimary, fontSize: 13, fontWeight: '700' },
    rowDate: { color: Colors.textMuted, fontSize: 11 },
    rowBody: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    fieldName: { color: Colors.textSecondary, fontSize: 12, width: 80 },
    changeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
    oldValue: { color: Colors.danger, fontSize: 12, textDecorationLine: 'line-through' },
    newValue: { color: Colors.success, fontSize: 12, fontWeight: '600' },
    reason: { color: Colors.textMuted, fontSize: 11, fontStyle: 'italic' },
  });
}

export default function AuditLogScreen() {
  const styles = makeStyles();
  const { t } = useTranslation();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAllAuditLog().then((rows) => {
      setEntries(rows as AuditEntry[]);
    }).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (!entries.length) {
    return (
      <View style={styles.center}>
        <Ionicons name="document-text-outline" size={40} color={Colors.textMuted} />
        <Text style={styles.emptyText}>{t('no_changes_logged')}</Text>
        <Text style={styles.emptySubtext}>{t('no_changes_logged_sub')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.notice}>
        <Ionicons name="lock-closed" size={14} color={Colors.textMuted} />
        <Text style={styles.noticeText}>{t('change_log_notice')}</Text>
      </View>

      <FlatList
        data={entries}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <AuditRow entry={item} />}
        contentContainerStyle={{ padding: 12, paddingBottom: 32, gap: 8 }}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
      />
    </View>
  );
}

function AuditRow({ entry }: { entry: AuditEntry }) {
  const styles = makeStyles();
  const { t } = useTranslation();
  const fieldLabel = FIELD_LABELS[entry.field_name] ?? entry.field_name;
  const date = new Date(entry.changed_at).toLocaleString('sv-SE');

  return (
    <View style={styles.row}>
      <View style={styles.rowHeader}>
        <Text style={styles.rowFlight}>
          {entry.dep_place && entry.arr_place
            ? `${entry.dep_place}→${entry.arr_place} · ${entry.date}`
            : `Flight #${entry.flight_id}`}
        </Text>
        <Text style={styles.rowDate}>{date}</Text>
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.fieldName}>{fieldLabel}</Text>
        <View style={styles.changeRow}>
          <Text style={styles.oldValue}>{entry.old_value ?? '–'}</Text>
          <Ionicons name="arrow-forward" size={12} color={Colors.textMuted} />
          <Text style={styles.newValue}>{entry.new_value ?? '–'}</Text>
        </View>
      </View>
      {entry.reason ? (
        <Text style={styles.reason}>{t('reason')} {entry.reason}</Text>
      ) : null}
    </View>
  );
}
