// Liten info-knapp (ikon + popup) som förklarar Flight load-/stressindikatorn. Självförsörjande (egen
// öppet-state) → läggs in i stress-cirkeln i både pilot- och drönar-dashboarden. Delad så texten hålls lika.
import { useState } from 'react';
import { View, Text, TouchableOpacity, Modal, Pressable, ScrollView, StyleSheet, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { GlassDialog, DialogIcon } from './GlassDialog';
import { loadZoneColor } from './WorkloadGauge';

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
        <Ionicons name="information-circle-outline" size={16} color={Colors.textSecondary} />
      </TouchableOpacity>
      <GlassDialog
        visible={open}
        onClose={() => setOpen(false)}
        icon={<DialogIcon name="pulse" color={accent} />}
        eyebrow="How it works"
        title="Flight load"
        primary={{ label: 'Got it', onPress: () => setOpen(false) }}
      >
        <ScrollView style={{ alignSelf: 'stretch', maxHeight: 380, marginTop: 12 }} showsVerticalScrollIndicator keyboardShouldPersistTaps="handled">
              <Text style={{ color: Colors.textSecondary, fontSize: 13.5, lineHeight: 20 }}>
                Flight load compares how much you've flown recently against your own normal pace, so you can spot when you're ramping up faster than usual.
              </Text>
              <Text style={{ color: Colors.textSecondary, fontSize: 13.5, lineHeight: 20, marginTop: 12 }}>
                <Text style={{ color: Colors.textPrimary, fontWeight: '700' }}>How it's calculated: </Text>
                your flight hours over the last <Text style={{ color: Colors.textPrimary, fontWeight: '700' }}>14 days</Text> divided by your normal 14-day total, shown as a percentage. Your normal changes over time: it's based on the past 12 months, with recent months counting more, so it follows how you fly now.
              </Text>
              <Text style={{ color: Colors.textSecondary, fontSize: 13.5, lineHeight: 20, marginTop: 12 }}>
                <Text style={{ color: Colors.textPrimary, fontWeight: '700' }}>100%</Text> = flying at your usual pace. Above 100% means more than normal (higher load); below means less.
              </Text>
              <View style={{ marginTop: 14 }}>
                <Row z="LOW" c={loadZoneColor('low')} label="Well below your normal — plenty of margin" />
                <Row z="LIGHT" c={loadZoneColor('light')} label="Below your usual pace — a good time to refresh skills" />
                <Row z="NORMAL" c={Colors.success} label="Around your usual pace" />
                <Row z="ELEVATED" c={Colors.warning} label="Busier than normal — keep an eye on rest" />
                <Row z="HIGH" c={Colors.danger} label="Well above normal — watch for fatigue" />
                <Row z="CRITICAL" c={Colors.danger} label="Far above your baseline over a short period" />
              </View>
              <Text style={{ color: Colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 14 }}>
                New to Blades? While it learns your normal pace, Flight load rests at 100% (your first couple of weeks) and then gradually starts to follow your real numbers. Imported flights count right away. Totals you add as a lump sum (manual import, previous experience) don't count as recent flying. This is an awareness cue about workload and fatigue risk — not a medical or official fitness-to-fly measure.
              </Text>
            </ScrollView>
      </GlassDialog>
    </>
  );
}
