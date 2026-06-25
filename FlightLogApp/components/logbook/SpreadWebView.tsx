// Ett uppslag i en WebView — delas mellan "Dina böcker"-vyn och helskärms-
// ifyllnadsvyn. interactive=false döljer de tappbara "+"-rutorna (statisk vy).
// onAspect rapporterar uppslagets höjd/bredd-förhållande (för tight preview).

import { memo, useMemo } from 'react';
import { View, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { renderSpreadHTML } from '../../services/logbook/renderSpread';
import type { LogbookTemplate } from '../../constants/logbookTemplates';
import type { LogbookSpread } from '../../services/logbook/paginate';
import type { SignatureData } from '../SignaturePad';

export const SpreadWebView = memo(function SpreadWebView({
  spread, template, pilotName, timeFormat, width, signature, interactive = true, centerVertical = false, margin, bare = false, bgColor = '#ECE3CC', side, onAssign, onAspect,
}: {
  spread: LogbookSpread;
  template: LogbookTemplate;
  pilotName: string;
  timeFormat: 'decimal' | 'hhmm';
  width: number;
  signature?: SignatureData | null;
  interactive?: boolean;
  centerVertical?: boolean;
  margin?: number;
  bare?: boolean;        // ingen beige bakgrund/skugga runt sidan
  bgColor?: string;      // bakgrund bakom uppslaget (t.ex. navy i inline-vyn)
  side?: 'left' | 'right'; // rendera bara en halva (en fysisk sida)
  onAssign?: (colId: string) => void;
  onAspect?: (ratio: number) => void;   // ratio = renderad höjd / bredd
}) {
  const html = useMemo(
    () => renderSpreadHTML({ template, spread, rowsPerSpread: template.rows_per_spread, pilotName, timeFormat, signature, interactive, centerVertical, margin, bare, side }),
    [template, spread, pilotName, timeFormat, signature, interactive, centerVertical, margin, bare, side],
  );
  // Vid behov: mät uppslagets naturliga höjd/bredd och rapportera tillbaka.
  const injected = onAspect
    ? `(function(){var p=function(){try{window.ReactNativeWebView.postMessage(JSON.stringify({type:'size',ratio:document.body.scrollHeight/window.innerWidth}));}catch(e){}};p();setTimeout(p,120);setTimeout(p,400);})();true;`
    : undefined;
  return (
    <View style={{ width, flex: 1, backgroundColor: bgColor }}>
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        style={{ flex: 1, backgroundColor: bgColor }}
        showsVerticalScrollIndicator={false}
        scalesPageToFit={Platform.OS === 'android'}
        scrollEnabled
        injectedJavaScript={injected}
        onMessage={(e) => {
          try {
            const m = JSON.parse(e.nativeEvent.data);
            if (m?.type === 'assignCol' && onAssign) onAssign(m.colId);
            else if (m?.type === 'size' && onAspect && m.ratio > 0) onAspect(m.ratio);
          } catch {}
        }}
      />
    </View>
  );
});
