// Liten info-knapp (ikon + popup) som förklarar Flight load-/stressindikatorn. Självförsörjande (egen
// öppet-state) → läggs in i stress-cirkeln i både pilot- och drönar-dashboarden. Delad så texten hålls lika.
import { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, ScrollView, StyleSheet, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';

export function StressInfoButton({ accent = Colors.primary, style }: { accent?: string; style?: ViewStyle }) {
  const [open, setOpen] = useState(false);
  const Row = ({ z, c, label }: { z: string; c: string; label: string }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
      <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: c }} />
      <Text style={{ color: Colors.textPrimary, fontSize: 12.5, fontWeight: '700', width: 72 }}>{z}</Text>
      <Text style={{ color: Colors.textSecondary, fontSize: 12.5, flex: 1 }}>{label}</Text>
    </View>
  );
  return (
    <>
      <TouchableOpacity onPress={() => setOpen(true)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} activeOpacity={0.7} style={style}>
        <Ionicons name="information-circle-outline" size={16} color={Colors.textMuted} />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        {/* Backdrop som SYSKON (absolut bakom) → sheet:en har ingen Pressable-förälder, så ScrollView:n
            scrollar fritt (en Pressable runt scrollen äter annars svep-gesten på iOS). */}
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Pressable onPress={() => setOpen(false)} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)' }]} />
          <View style={{ width: '100%', maxWidth: 400, maxHeight: '82%', backgroundColor: Colors.card, borderRadius: 16, borderWidth: 1, borderColor: Colors.cardBorder, padding: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <Ionicons name="pulse" size={20} color={accent} />
              <Text style={{ color: Colors.textPrimary, fontSize: 16, fontWeight: '800', flex: 1 }}>Flight load</Text>
              <TouchableOpacity onPress={() => setOpen(false)} hitSlop={8}><Ionicons name="close" size={20} color={Colors.textMuted} /></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 400 }} showsVerticalScrollIndicator keyboardShouldPersistTaps="handled">
              <Text style={{ color: Colors.textSecondary, fontSize: 13.5, lineHeight: 20 }}>
                Flight load compares how much you've flown recently against your own normal pace, so you can spot when you're ramping up faster than usual.
              </Text>
              <Text style={{ color: Colors.textSecondary, fontSize: 13.5, lineHeight: 20, marginTop: 12 }}>
                <Text style={{ color: Colors.textPrimary, fontWeight: '700' }}>How it's calculated: </Text>
                your flight hours over the last <Text style={{ color: Colors.textPrimary, fontWeight: '700' }}>14 days</Text> divided by your typical 14-day total (your average over the past 12 months), shown as a percentage.
              </Text>
              <Text style={{ color: Colors.textSecondary, fontSize: 13.5, lineHeight: 20, marginTop: 12 }}>
                <Text style={{ color: Colors.textPrimary, fontWeight: '700' }}>100%</Text> = flying at your usual pace. Above 100% means more than normal (higher load); below means less.
              </Text>
              <View style={{ marginTop: 14 }}>
                <Row z="LOW" c={Colors.textMuted} label="Well below your normal — plenty of margin" />
                <Row z="NORMAL" c={Colors.success} label="Around your usual pace" />
                <Row z="ELEVATED" c={Colors.warning} label="Busier than normal — keep an eye on rest" />
                <Row z="HIGH" c={Colors.danger} label="Well above normal — watch for fatigue" />
                <Row z="CRITICAL" c={Colors.danger} label="Far above your baseline over a short period" />
              </View>
              <Text style={{ color: Colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 14 }}>
                It needs some flight history to compare against, so it only appears once you've built a baseline. This is an awareness cue about workload and fatigue risk — not a medical or official fitness-to-fly measure.
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}
