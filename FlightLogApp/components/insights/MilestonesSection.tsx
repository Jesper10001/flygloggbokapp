// Milestones (Best Week + Longest XC) — flyttad från dashboarden till insights botten.
// Självförsörjande: hämtar stats/premium/detaljer själv och renderar de två korten med kartan som förhandsbild.
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors } from '../../constants/colors';
import { useFlightStore } from '../../store/flightStore';
import { useTranslation } from '../../hooks/useTranslation';
import { decimalToHHMM } from '../../hooks/useTimeFormat';
import { monthShort } from '../../utils/dateLabels';
import { useBestWeekDetails, useLongestXcLegs } from '../../hooks/useMilestoneDetails';
import { BestWeekMapCard, LongestXcMapCard } from '../milestones/MilestoneMapCards';
import { presentPaywall } from '../../services/purchases';

function lxDateShort(iso: string | undefined, language: string): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return '—';
  return `${String(d).padStart(2, '0')} ${monthShort(language, m - 1)} ${y}`;
}

export function MilestonesSection() {
  const router = useRouter();
  const st = useFlightStore((s) => s.stats);
  const isPremium = useFlightStore((s) => s.isPremium);
  const { t, language } = useTranslation();

  const bestWeek = useBestWeekDetails(st?.best_week_start || undefined);
  const xcLegs = useLongestXcLegs(st?.longest_xc_date || undefined);


  return (
    <View>
      <Text style={sx.sectionHeader}>{t('ms.section_milestones')}</Text>
      <View style={sx.milestoneRow}>
        <BestWeekMapCard
          hoursLabel={decimalToHHMM(st?.best_week_hours ?? 0)}
          weekLabel={st?.best_week_label || '—'}
          details={bestWeek}
          onPress={() => {
            if (!isPremium) { presentPaywall('Best week'); return; }
            if (st?.best_week_start) router.push('/milestones/best-week');
          }}
        />
        <LongestXcMapCard
          distanceNm={st?.longest_xc_km ?? 0}
          routeFrom={st?.longest_xc_first_dep || '—'}
          routeTo={st?.longest_xc_last_arr || '—'}
          dateShort={lxDateShort(st?.longest_xc_date, language)}
          legs={xcLegs}
          onPress={() => {
            if (!isPremium) { presentPaywall('Longest XC'); return; }
            if (st?.longest_xc_id) router.push('/milestones/longest-xc');
          }}
        />
      </View>
    </View>
  );
}

const sx = StyleSheet.create({
  sectionHeader: { fontSize: 11, fontWeight: '700', color: Colors.textMuted, letterSpacing: 1.4, fontFamily: 'Menlo', marginTop: 6, marginBottom: 10 },
  milestoneRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
});
