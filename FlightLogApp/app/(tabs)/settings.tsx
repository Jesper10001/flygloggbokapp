import { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, Alert, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFlightStore } from '../../store/flightStore';
import { Colors } from '../../constants/colors';
import { exportToCSV, exportToPDF } from '../../services/export';
import { clearAllFlights } from '../../db/flights';
import { FREE_TIER_LIMIT } from '../../constants/easa';

function SettingsRow({
  icon, label, sub, onPress, rightEl, danger, locked,
}: {
  icon: string;
  label: string;
  sub?: string;
  onPress?: () => void;
  rightEl?: React.ReactNode;
  danger?: boolean;
  locked?: boolean;
}) {
  return (
    <TouchableOpacity
      style={styles.settingsRow}
      onPress={onPress}
      disabled={!onPress && !rightEl}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <View style={[styles.settingsIcon, danger && { backgroundColor: Colors.danger + '22' }]}>
        <Ionicons name={icon as any} size={18} color={danger ? Colors.danger : Colors.primary} />
      </View>
      <View style={styles.settingsText}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={[styles.settingsLabel, danger && { color: Colors.danger }]}>{label}</Text>
          {locked && (
            <View style={styles.premiumTag}>
              <Ionicons name="star" size={9} color={Colors.gold} />
              <Text style={styles.premiumTagText}>Premium</Text>
            </View>
          )}
        </View>
        {sub ? <Text style={styles.settingsSub}>{sub}</Text> : null}
      </View>
      {rightEl ?? (onPress ? <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} /> : null)}
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const { isPremium, setIsPremium, flightCount, loadFlights, loadStats } = useFlightStore();
  const [exportingCSV, setExportingCSV] = useState(false);
  const [exportingPDF, setExportingPDF] = useState(false);

  const handleExportCSV = async () => {
    setExportingCSV(true);
    try {
      await exportToCSV();
    } catch (e: any) {
      Alert.alert('Export misslyckades', e.message);
    } finally {
      setExportingCSV(false);
    }
  };

  const handleExportPDF = async () => {
    setExportingPDF(true);
    try {
      await exportToPDF();
    } catch (e: any) {
      Alert.alert('Export misslyckades', e.message);
    } finally {
      setExportingPDF(false);
    }
  };

  const handleClearAll = () => {
    Alert.alert(
      'Rensa all data',
      `Detta tar bort alla ${flightCount} loggade flygningar och ändringsloggen permanent. Åtgärden går inte att ångra.`,
      [
        { text: 'Avbryt', style: 'cancel' },
        {
          text: 'Rensa allt',
          style: 'destructive',
          onPress: async () => {
            await clearAllFlights();
            await Promise.all([loadFlights(), loadStats()]);
            Alert.alert('Klart', 'All loggboksdata har raderats.');
          },
        },
      ]
    );
  };

  const handleUpgrade = () => {
    Alert.alert(
      'Premium',
      'I en produktionsapp ansluts RevenueCat här. Aktivera Premium för testning?',
      [
        { text: 'Avbryt', style: 'cancel' },
        { text: 'Aktivera (test)', onPress: () => setIsPremium(true) },
      ]
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Premium-banner */}
      {!isPremium ? (
        <TouchableOpacity style={styles.premiumCard} onPress={handleUpgrade} activeOpacity={0.85}>
          <View style={styles.premiumLeft}>
            <View style={styles.premiumBadge}>
              <Ionicons name="star" size={20} color={Colors.textInverse} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.premiumTitle}>Tailwind Premium</Text>
              <Text style={styles.premiumSub}>Obegränsat · OCR · PDF · EASA-krav</Text>
              <Text style={styles.premiumPrice}>~$3–5/månad · ~$30/år</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={18} color={Colors.gold} />
        </TouchableOpacity>
      ) : (
        <View style={[styles.premiumCard, { borderColor: Colors.success + '55' }]}>
          <View style={styles.premiumLeft}>
            <View style={[styles.premiumBadge, { backgroundColor: Colors.success }]}>
              <Ionicons name="checkmark" size={20} color={Colors.textInverse} />
            </View>
            <View>
              <Text style={styles.premiumTitle}>Premium aktiverat</Text>
              <Text style={styles.premiumSub}>Alla funktioner tillgängliga</Text>
            </View>
          </View>
        </View>
      )}

      {/* Datafilosofi */}
      <View style={styles.dataPhilosophy}>
        <Ionicons name="shield-checkmark" size={16} color={Colors.primary} />
        <Text style={styles.dataPhilosophyText}>
          Din data tillhör dig. CSV-export är alltid gratis oavsett prenumerationsstatus.
          Data låses aldrig in.
        </Text>
      </View>

      {/* Abonnemang */}
      <Text style={styles.sectionTitle}>Abonnemang</Text>
      <View style={styles.card}>
        <SettingsRow
          icon="airplane"
          label="Flygningar loggade"
          sub={`${flightCount} av ${isPremium ? '∞' : FREE_TIER_LIMIT}`}
        />
        {!isPremium ? (
          <SettingsRow
            icon="star"
            label="Uppgradera till Premium"
            sub="Obegränsat, OCR, PDF-export, EASA-krav"
            onPress={handleUpgrade}
          />
        ) : (
          <SettingsRow
            icon="star-outline"
            label="Avsluta Premium"
            onPress={() => Alert.alert('Avsluta', 'Inaktivera Premium?', [
              { text: 'Avbryt', style: 'cancel' },
              { text: 'Ja', onPress: () => setIsPremium(false) },
            ])}
          />
        )}
        <SettingsRow
          icon="refresh"
          label="Återställ köp"
          sub="Om du redan köpt Premium"
          onPress={() => Alert.alert('Återställ', 'Kontaktar App Store... (RevenueCat i produktion)')}
        />
      </View>

      {/* Import */}
      <Text style={styles.sectionTitle}>Import</Text>
      <View style={styles.card}>
        <SettingsRow
          icon="cloud-upload"
          label="Importera från annan app"
          sub="ForeFlight, LogTen Pro, MyFlightbook m.fl."
          onPress={() => router.push('/import')}
        />
        <SettingsRow
          icon="create-outline"
          label="Registrera erfarenhet manuellt"
          sub="Fyll i dina timmar per år — alltid gratis"
          onPress={() => router.push('/import/manual')}
        />
      </View>

      {/* Export */}
      <Text style={styles.sectionTitle}>Export</Text>
      <View style={styles.card}>
        <SettingsRow
          icon="document-text"
          label="Exportera till CSV"
          sub="Alltid gratis — alla fält, EASA-format"
          onPress={handleExportCSV}
          rightEl={exportingCSV ? <ActivityIndicator size="small" color={Colors.primary} /> : undefined}
        />
        <SettingsRow
          icon="print"
          label="Exportera till PDF"
          sub={isPremium ? 'EASA-format, klar för utskrift' : 'Kräver Premium'}
          locked={!isPremium}
          onPress={isPremium ? handleExportPDF : handleUpgrade}
          rightEl={exportingPDF ? <ActivityIndicator size="small" color={Colors.primary} /> : undefined}
        />
      </View>

      {/* Databas & spårbarhet */}
      <Text style={styles.sectionTitle}>Databas & spårbarhet</Text>
      <View style={styles.card}>
        <SettingsRow
          icon="location"
          label="Hantera flygplatser"
          sub="Lägg till egna ICAO-koder"
          onPress={() => router.push('/settings/airport')}
        />
        <SettingsRow
          icon="time"
          label="Ändringslogg"
          sub="Alla ändringar loggade med originalvärde"
          onPress={() => router.push('/settings/auditlog')}
        />
      </View>

      {/* Danger zone */}
      <Text style={styles.sectionTitle}>Felsökning</Text>
      <View style={styles.card}>
        <SettingsRow
          icon="trash"
          label="Rensa all loggboksdata"
          sub="Tar bort alla flygningar och ändringsloggen"
          onPress={handleClearAll}
          danger
        />
      </View>

      {/* Om appen */}
      <Text style={styles.sectionTitle}>Om appen</Text>
      <View style={styles.card}>
        <SettingsRow icon="information-circle" label="Tailwind" sub="Version 1.0.0 · EASA FCL.050" />
        <SettingsRow icon="shield-checkmark" label="Lokal datalagring" sub="All data på din enhet — ingenting i molnet utan din tillåtelse" />
        <SettingsRow
          icon="mail"
          label="Support"
          sub="support@flightlogpro.se"
          onPress={() => Alert.alert('Support', 'Kontakta oss på support@flightlogpro.se')}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 40, gap: 8 },

  premiumCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.card, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: Colors.gold + '55', marginBottom: 8,
  },
  premiumLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  premiumBadge: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: Colors.gold, alignItems: 'center', justifyContent: 'center',
  },
  premiumTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
  premiumSub: { color: Colors.textSecondary, fontSize: 12, marginTop: 1 },
  premiumPrice: { color: Colors.gold, fontSize: 12, fontWeight: '600', marginTop: 2 },

  dataPhilosophy: {
    flexDirection: 'row', gap: 8, alignItems: 'flex-start',
    backgroundColor: Colors.primary + '18', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: Colors.primary + '33', marginBottom: 8,
  },
  dataPhilosophyText: { color: Colors.textSecondary, fontSize: 13, flex: 1, lineHeight: 18 },

  sectionTitle: {
    color: Colors.textSecondary, fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 1,
    marginTop: 16, marginBottom: 4, marginLeft: 4,
  },

  card: {
    backgroundColor: Colors.card, borderRadius: 12,
    borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden',
  },
  settingsRow: {
    flexDirection: 'row', alignItems: 'center',
    padding: 14, gap: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.separator,
  },
  settingsIcon: {
    width: 34, height: 34, borderRadius: 8,
    backgroundColor: Colors.primary + '22', alignItems: 'center', justifyContent: 'center',
  },
  settingsText: { flex: 1 },
  settingsLabel: { color: Colors.textPrimary, fontSize: 14, fontWeight: '500' },
  settingsSub: { color: Colors.textSecondary, fontSize: 12, marginTop: 1 },
  premiumTag: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: Colors.gold + '33', borderRadius: 3,
    paddingHorizontal: 4, paddingVertical: 1,
  },
  premiumTagText: { color: Colors.gold, fontSize: 9, fontWeight: '700' },
});
