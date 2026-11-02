// Köpta Blade coins ("Extra coins") under månadens mätare i Settings — samma i pilot- och drönarläget. Coins
// delas mellan lägena (saldot hämtas per enhet från proxyn, store/tokenQuotaStore), så det som köps i det ena
// läget syns i det andra. Egen guldfärgad stapel: de går aldrig ut och används efter månadens. Skalan är det
// största paketet (500 coins).
import { View, Text } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const GOLD = '#FFB830';
const CELLS = 10;

export function ExtraCoinsBar({ coins, captionColor }: { coins: number; captionColor: string }) {
  if (!(coins > 0)) return null;
  const xf = Math.min(1, coins / 500) * CELLS;
  return (
    <View style={{ marginTop: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, fontSize: 13, fontWeight: '700', color: GOLD }}>Extra coins</Text>
        <Text style={{ fontFamily: 'Menlo', fontSize: 15, fontWeight: '700', color: GOLD }}>{coins.toLocaleString('en-US')}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 4, marginTop: 8, marginBottom: 6 }}>
        {Array.from({ length: CELLS }).map((_, i) => {
          const isFull = i < Math.floor(xf);
          const part = i === Math.floor(xf) ? xf - Math.floor(xf) : 0;
          return (
            <View key={i} style={{ flex: 1, height: 8, borderRadius: 2, backgroundColor: '#2A2414' }}>
              {isFull ? (
                <LinearGradient colors={['#FFE29A', '#F2B53A']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }}
                  style={{ flex: 1, borderRadius: 2, shadowColor: '#FFC24A', shadowOpacity: 0.35, shadowRadius: 6, shadowOffset: { width: 0, height: 0 } }} />
              ) : part > 0 ? (
                <View style={{ width: `${Math.max(10, Math.round(part * 100))}%`, height: '100%', borderRadius: 2, backgroundColor: '#F2B53A' }} />
              ) : null}
            </View>
          );
        })}
      </View>
      <Text style={{ fontSize: 12, color: captionColor }}>Purchased · never expire · shared by pilot and drone mode</Text>
    </View>
  );
}
