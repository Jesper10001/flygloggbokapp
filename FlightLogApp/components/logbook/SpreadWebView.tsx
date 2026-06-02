// Ett uppslag i en WebView — delas mellan "Dina böcker"-vyn och helskärms-
// ifyllnadsvyn. interactive=false döljer de tappbara "+"-rutorna (statisk vy).

import { memo, useMemo } from 'react';
import { View, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { renderSpreadHTML } from '../../services/logbook/renderSpread';
import type { LogbookTemplate } from '../../constants/logbookTemplates';
import type { LogbookSpread } from '../../services/logbook/paginate';
import type { SignatureData } from '../SignaturePad';

export const SpreadWebView = memo(function SpreadWebView({
  spread, template, pilotName, timeFormat, width, signature, interactive = true, centerVertical = false, onAssign,
}: {
  spread: LogbookSpread;
  template: LogbookTemplate;
  pilotName: string;
  timeFormat: 'decimal' | 'hhmm';
  width: number;
  signature?: SignatureData | null;
  interactive?: boolean;
  centerVertical?: boolean;
  onAssign?: (colId: string) => void;
}) {
  const html = useMemo(
    () => renderSpreadHTML({ template, spread, rowsPerSpread: template.rows_per_spread, pilotName, timeFormat, signature, interactive, centerVertical }),
    [template, spread, pilotName, timeFormat, signature, interactive, centerVertical],
  );
  return (
    <View style={{ width, flex: 1 }}>
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        style={{ flex: 1, backgroundColor: '#ECE3CC' }}
        showsVerticalScrollIndicator={false}
        scalesPageToFit={Platform.OS === 'android'}
        scrollEnabled
        onMessage={(e) => {
          try { const m = JSON.parse(e.nativeEvent.data); if (m?.type === 'assignCol' && onAssign) onAssign(m.colId); } catch {}
        }}
      />
    </View>
  );
});
