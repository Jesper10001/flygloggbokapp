import { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Image, Alert, ScrollView, ActivityIndicator,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useFlightStore } from '../../store/flightStore';
import { setScanImage } from '../../store/scanStore';
import { Colors } from '../../constants/colors';

export default function ScanScreen() {
  const router = useRouter();
  const { isPremium } = useFlightStore();
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [rotation, setRotation] = useState(0); // 0, 90, 180, 270
  const [scanning, setScanning] = useState(false);

  const pickImage = async (fromCamera: boolean) => {
    let result;
    if (fromCamera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Behörighet krävs', 'Kameraåtkomst behövs för att skanna loggböcker.');
        return;
      }
      result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'] as any,
        quality: 0.85,
        base64: false, // Hämtas efter eventuell rotation
      });
    } else {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'] as any,
        quality: 0.85,
        base64: false,
      });
    }

    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
      setRotation(0);
    }
  };

  const rotateImage = () => {
    setRotation((prev) => (prev + 90) % 360);
  };

  const handleScan = async () => {
    if (!imageUri) return;
    setScanning(true);
    try {
      // Applicera rotation om nödvändigt och exportera som base64
      const actions: ImageManipulator.Action[] = [];
      if (rotation !== 0) {
        actions.push({ rotate: rotation });
      }

      const manipulated = await ImageManipulator.manipulateAsync(
        imageUri,
        actions,
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );

      if (!manipulated.base64) {
        Alert.alert('Fel', 'Kunde inte behandla bilden. Försök igen.');
        return;
      }

      setScanImage(manipulated.base64, 'image/jpeg');
      router.push('/flight/review');
    } catch (e: any) {
      Alert.alert('Fel', e.message);
    } finally {
      setScanning(false);
    }
  };

  if (!isPremium) {
    return (
      <View style={styles.lockedContainer}>
        <View style={styles.lockedCard}>
          <Ionicons name="star" size={48} color={Colors.gold} />
          <Text style={styles.lockedTitle}>Premium-funktion</Text>
          <Text style={styles.lockedText}>
            OCR-skanning av fysiska loggböcker är tillgängligt med Premium-abonnemang.
          </Text>
          <View style={styles.featureList}>
            {[
              'Skanna med kamera eller välj bild',
              'AI-tolkning av handskrift (Claude)',
              'Granska och korrigera innan sparning',
              'Obegränsat antal flygningar',
              'Export till CSV och PDF',
            ].map((f) => (
              <View key={f} style={styles.featureRow}>
                <Ionicons name="checkmark-circle" size={16} color={Colors.success} />
                <Text style={styles.featureText}>{f}</Text>
              </View>
            ))}
          </View>
          <TouchableOpacity
            style={styles.upgradeBtn}
            onPress={() => router.push('/(tabs)/settings')}
            activeOpacity={0.8}
          >
            <Ionicons name="star" size={18} color={Colors.textInverse} />
            <Text style={styles.upgradeBtnText}>Uppgradera till Premium</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Skanna loggbok</Text>
      <Text style={styles.subtitle}>
        Ta ett foto av en sida i din loggbok. Rotera bilden om det behövs innan du skannar.
      </Text>

      {!imageUri ? (
        <View style={styles.pickRow}>
          <TouchableOpacity style={styles.pickBtn} onPress={() => pickImage(true)} activeOpacity={0.8}>
            <Ionicons name="camera" size={32} color={Colors.primary} />
            <Text style={styles.pickBtnText}>Kamera</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.pickBtn} onPress={() => pickImage(false)} activeOpacity={0.8}>
            <Ionicons name="images" size={32} color={Colors.primary} />
            <Text style={styles.pickBtnText}>Bildbibliotek</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {/* Förhandsvisning med rotation */}
          <View style={styles.previewContainer}>
            <Image
              source={{ uri: imageUri }}
              style={[
                styles.preview,
                { transform: [{ rotate: `${rotation}deg` }] },
              ]}
              resizeMode="contain"
            />
          </View>

          {/* Åtgärdsrad */}
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.actionBtn} onPress={() => { setImageUri(null); setRotation(0); }}>
              <Ionicons name="close-circle-outline" size={20} color={Colors.textSecondary} />
              <Text style={styles.actionBtnText}>Byt bild</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.actionBtn} onPress={rotateImage}>
              <Ionicons name="refresh" size={20} color={Colors.primary} />
              <Text style={[styles.actionBtnText, { color: Colors.primary }]}>
                Rotera {rotation}°
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.scanBtn, scanning && { opacity: 0.6 }]}
            onPress={handleScan}
            disabled={scanning}
            activeOpacity={0.8}
          >
            {scanning ? (
              <>
                <ActivityIndicator color={Colors.textInverse} />
                <Text style={styles.scanBtnText}>Analyserar...</Text>
              </>
            ) : (
              <>
                <Ionicons name="scan" size={22} color={Colors.textInverse} />
                <Text style={styles.scanBtnText}>Analysera med Claude AI</Text>
              </>
            )}
          </TouchableOpacity>
        </>
      )}

      <View style={styles.tipsCard}>
        <Text style={styles.tipsTitle}>Tips för bästa resultat</Text>
        {[
          'God belysning — undvik skuggor och reflexer',
          'Håll kameran rakt ovanför sidan',
          'All text ska vara skarp och i fokus',
          'Skanna en sida i taget',
          'Rotera bilden om loggboken är stående',
        ].map((tip) => (
          <View key={tip} style={styles.tipRow}>
            <Ionicons name="bulb-outline" size={14} color={Colors.gold} />
            <Text style={styles.tipText}>{tip}</Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 20, paddingBottom: 40, gap: 16 },

  title: { color: Colors.textPrimary, fontSize: 24, fontWeight: '800' },
  subtitle: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20 },

  pickRow: { flexDirection: 'row', gap: 14, marginTop: 8 },
  pickBtn: {
    flex: 1, backgroundColor: Colors.card, borderRadius: 16,
    padding: 24, alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: Colors.border, borderStyle: 'dashed',
  },
  pickBtnText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '600' },

  previewContainer: {
    width: '100%', height: 300, borderRadius: 12,
    backgroundColor: Colors.card, overflow: 'hidden',
    alignItems: 'center', justifyContent: 'center',
  },
  preview: { width: '100%', height: '100%' },

  actionRow: { flexDirection: 'row', gap: 10 },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, backgroundColor: Colors.card, borderRadius: 10,
    paddingVertical: 10, borderWidth: 1, borderColor: Colors.border,
  },
  actionBtnText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' },

  scanBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.primary, borderRadius: 12, paddingVertical: 15, gap: 8,
  },
  scanBtnText: { color: Colors.textInverse, fontSize: 17, fontWeight: '700' },

  tipsCard: {
    backgroundColor: Colors.card, borderRadius: 12, padding: 16, gap: 8,
    borderWidth: 1, borderColor: Colors.cardBorder,
  },
  tipsTitle: { color: Colors.textPrimary, fontSize: 14, fontWeight: '700', marginBottom: 4 },
  tipRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  tipText: { color: Colors.textSecondary, fontSize: 13, flex: 1 },

  lockedContainer: { flex: 1, backgroundColor: Colors.background, padding: 20, justifyContent: 'center' },
  lockedCard: {
    backgroundColor: Colors.card, borderRadius: 16, padding: 24,
    gap: 12, alignItems: 'center', borderWidth: 1, borderColor: Colors.gold + '44',
  },
  lockedTitle: { color: Colors.textPrimary, fontSize: 22, fontWeight: '800' },
  lockedText: { color: Colors.textSecondary, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  featureList: { alignSelf: 'stretch', gap: 8, marginVertical: 8 },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  featureText: { color: Colors.textPrimary, fontSize: 14 },
  upgradeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.gold, borderRadius: 12,
    paddingVertical: 14, paddingHorizontal: 24, gap: 8, marginTop: 8, alignSelf: 'stretch',
  },
  upgradeBtnText: { color: Colors.textInverse, fontSize: 16, fontWeight: '700' },
});
