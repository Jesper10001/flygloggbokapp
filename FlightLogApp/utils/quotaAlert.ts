import { Alert } from 'react-native';
import { useScanQuotaStore } from '../store/scanQuotaStore';

type TranslateFn = (key: string) => string;

export function showQuotaExceededAlert(t: TranslateFn, reason: string) {
  Alert.alert(
    t('quota_exceeded_title'),
    `${reason}\n\n${t('quota_topup_body')}`,
    [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('quota_topup_btn'),
        onPress: () => {
          useScanQuotaStore.getState().topUpMonthly();
        },
      },
    ],
  );
}
