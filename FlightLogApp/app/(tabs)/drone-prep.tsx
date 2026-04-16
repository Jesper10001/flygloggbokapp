import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Linking, Alert, Modal } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { Colors } from '../../constants/colors';
import { useTranslation } from '../../hooks/useTranslation';
import { useAppModeStore } from '../../store/appModeStore';

interface GeoLink {
  key: string;
  country: string;
  name: string;
  url: (lat?: number, lon?: number) => string;
}

const GEO_SOURCES: GeoLink[] = [
  {
    key: 'ts_se',
    country: 'SE',
    name: 'Transportstyrelsen (Sverige)',
    url: () => 'https://daim.lfv.se/echarts/dronechart/',
  },
  {
    key: 'easa',
    country: 'EU',
    name: 'EASA Geo-Zones Portal',
    url: () => 'https://www.easa.europa.eu/en/domains/drones-air-mobility/drones-geographical-zones',
  },
  {
    key: 'faa_uk',
    country: 'UK',
    name: 'NATS Drone Assist',
    url: () => 'https://dronesafe.uk/',
  },
  {
    key: 'faa_us',
    country: 'US',
    name: 'FAA B4UFLY',
    url: () => 'https://www.faa.gov/uas/recreational_flyers/where_can_i_fly/b4ufly',
  },
];

export default function DronePrep() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const styles = makeStyles();
  const mode = useAppModeStore((s) => s.mode);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [loadingLoc, setLoadingLoc] = useState(false);
  const [mapUrl, setMapUrl] = useState<string | null>(null);

  const getLocation = async () => {
    setLoadingLoc(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('permission_required'), t('location_permission_body'));
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
    } catch (e: any) {
      Alert.alert(t('error'), e.message);
    } finally {
      setLoadingLoc(false);
    }
  };

  useFocusEffect(useCallback(() => {
    if (!coords) getLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []));

  const openExternal = (url: string) => {
    Linking.openURL(url).catch(() => Alert.alert(t('error'), t('could_not_open_link')));
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Location header */}
      <View style={styles.locationCard}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ionicons name="location" size={18} color={Colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={styles.locationLabel}>{t('your_location')}</Text>
            {coords ? (
              <Text style={styles.locationValue}>
                {coords.lat.toFixed(5)}, {coords.lon.toFixed(5)}
              </Text>
            ) : (
              <Text style={styles.locationPending}>{loadingLoc ? t('locating') : t('no_location_yet')}</Text>
            )}
          </View>
          <TouchableOpacity style={styles.refreshBtn} onPress={getLocation} disabled={loadingLoc} activeOpacity={0.7}>
            <Ionicons name="refresh" size={14} color={Colors.primary} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Geo-zone check */}
      <Text style={styles.sectionTitle}>{t('geo_zone_check')}</Text>
      <Text style={styles.sectionBody}>{t('geo_zone_check_body')}</Text>

      {GEO_SOURCES.map((g) => (
        <TouchableOpacity
          key={g.key}
          style={styles.linkRow}
          onPress={() => {
            if (g.key === 'ts_se' && coords) {
              setMapUrl(g.url(coords.lat, coords.lon));
            } else {
              openExternal(g.url(coords?.lat, coords?.lon));
            }
          }}
          activeOpacity={0.8}
        >
          <View style={styles.countryPill}><Text style={styles.countryPillText}>{g.country}</Text></View>
          <Text style={styles.linkTitle}>{g.name}</Text>
          <Ionicons name={g.key === 'ts_se' ? 'map' : 'open-outline'} size={14} color={Colors.textMuted} />
        </TouchableOpacity>
      ))}

      <View style={styles.disclaimer}>
        <Ionicons name="information-circle-outline" size={14} color={Colors.textMuted} />
        <Text style={styles.disclaimerText}>{t('geo_zone_disclaimer')}</Text>
      </View>

      {/* Coming soon sections — platsholder för framtida checks */}
      <Text style={styles.sectionTitle}>{t('other_checks')}</Text>
      <View style={styles.comingCard}>
        <PrepItem
          icon="cloud-outline"
          label={t('prep_weather')}
          sub={t('prep_weather_sub')}
          onPress={() => {
            const url = coords
              ? `https://www.windy.com/?${coords.lat},${coords.lon},13`
              : `https://www.windy.com/`;
            openExternal(url);
          }}
        />
        <PrepItem
          icon="notifications-outline"
          label={t('prep_notams')}
          sub={t('prep_notams_sub')}
          onPress={() => openExternal('https://aro.lfv.se/Editorial/View/IAIP?folderId=19')}
        />
        <PrepItem
          icon="sunny-outline"
          label={t('prep_sunset')}
          sub={t('prep_sunset_sub')}
          onPress={() => {
            const url = coords
              ? `https://www.timeanddate.com/sun/@${coords.lat},${coords.lon}`
              : 'https://www.timeanddate.com/sun/';
            openExternal(url);
          }}
        />
      </View>

      {/* WebView modal för TS drönarkarta */}
      <Modal visible={!!mapUrl} animationType="slide" onRequestClose={() => setMapUrl(null)}>
        <View style={[styles.webViewContainer, { paddingTop: insets.top }]}>
          <View style={styles.webViewHeader}>
            <TouchableOpacity onPress={() => setMapUrl(null)} style={{ padding: 6 }}>
              <Ionicons name="close" size={22} color={Colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.webViewTitle}>{t('ts_dronechart')}</Text>
            <TouchableOpacity onPress={() => mapUrl && openExternal(mapUrl)} style={{ padding: 6 }}>
              <Ionicons name="open-outline" size={20} color={Colors.primary} />
            </TouchableOpacity>
          </View>
          {mapUrl && (
            <WebView
              source={{ uri: mapUrl }}
              style={{ flex: 1 }}
              originWhitelist={['*']}
            />
          )}
        </View>
      </Modal>
    </ScrollView>
  );
}

function PrepItem({ icon, label, sub, onPress }: { icon: any; label: string; sub: string; onPress: () => void }) {
  const styles = makeStyles();
  return (
    <TouchableOpacity style={styles.prepRow} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.prepIcon}>
        <Ionicons name={icon} size={18} color={Colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.prepLabel}>{label}</Text>
        <Text style={styles.prepSub}>{sub}</Text>
      </View>
      <Ionicons name="open-outline" size={14} color={Colors.textMuted} />
    </TouchableOpacity>
  );
}

function makeStyles() {
  return StyleSheet.create({
    container: { flex: 1, backgroundColor: Colors.background },
    content: { padding: 16, gap: 8, paddingBottom: 40 },

    locationCard: {
      backgroundColor: Colors.card, borderRadius: 12, padding: 14,
      borderWidth: 1, borderColor: Colors.primary + '44',
    },
    locationLabel: {
      color: Colors.textSecondary, fontSize: 10, fontWeight: '700',
      textTransform: 'uppercase', letterSpacing: 1,
    },
    locationValue: {
      color: Colors.textPrimary, fontSize: 16, fontWeight: '700',
      fontFamily: 'Menlo', fontVariant: ['tabular-nums'], marginTop: 2,
    },
    locationPending: { color: Colors.textMuted, fontSize: 13, marginTop: 2 },
    refreshBtn: {
      padding: 8, borderRadius: 8,
      backgroundColor: Colors.primary + '18',
      borderWidth: 1, borderColor: Colors.primary + '44',
    },

    sectionTitle: {
      color: Colors.textSecondary, fontSize: 11, fontWeight: '700',
      textTransform: 'uppercase', letterSpacing: 1, marginTop: 16, marginBottom: 2,
    },
    sectionBody: { color: Colors.textSecondary, fontSize: 12, lineHeight: 17, marginBottom: 6 },

    linkRow: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: Colors.card, borderRadius: 10, padding: 12,
      borderWidth: 1, borderColor: Colors.cardBorder,
    },
    countryPill: {
      paddingHorizontal: 7, paddingVertical: 3, borderRadius: 4,
      backgroundColor: Colors.primary + '22',
    },
    countryPillText: { color: Colors.primary, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
    linkTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: '600', flex: 1 },

    disclaimer: {
      flexDirection: 'row', alignItems: 'flex-start', gap: 8,
      backgroundColor: Colors.warning + '14', borderRadius: 8,
      padding: 10, borderWidth: 1, borderColor: Colors.warning + '44',
      marginTop: 6,
    },
    disclaimerText: { color: Colors.textSecondary, fontSize: 11, lineHeight: 16, flex: 1 },

    comingCard: {
      backgroundColor: Colors.card, borderRadius: 10,
      borderWidth: 1, borderColor: Colors.cardBorder, overflow: 'hidden',
    },
    prepRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      padding: 14, borderBottomWidth: 0.5, borderBottomColor: Colors.separator,
    },
    prepIcon: {
      width: 34, height: 34, borderRadius: 8,
      backgroundColor: Colors.primary + '22',
      alignItems: 'center', justifyContent: 'center',
    },
    prepLabel: { color: Colors.textPrimary, fontSize: 14, fontWeight: '600' },
    prepSub: { color: Colors.textSecondary, fontSize: 12, marginTop: 1 },

    webViewContainer: { flex: 1, backgroundColor: Colors.background },
    webViewHeader: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 12, paddingVertical: 10,
      borderBottomWidth: 0.5, borderBottomColor: Colors.border,
      backgroundColor: Colors.surface,
    },
    webViewTitle: { color: Colors.textPrimary, fontSize: 15, fontWeight: '700' },
  });
}
