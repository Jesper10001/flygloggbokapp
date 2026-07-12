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
  spread, template, pilotName, timeFormat, width, signature, interactive = true, centerVertical = false, margin, bare = false, bgColor = '#ECE3CC', side, onAssign, onAspect, onGeometry,
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
  // Datarutornas geometri (CSS-px) för transkriberings-rektangeln: första dataradens
  // topp, sista dataradens botten, sista summeringsradens botten + exakta kolumnkanter
  // (colX = varje cells vänsterkant + sista cellens högerkant, mätt i DOM:en).
  onGeometry?: (g: { top: number; botData: number; botSum: number; colX?: number[] }) => void;
}) {
  const html = useMemo(
    () => renderSpreadHTML({ template, spread, rowsPerSpread: template.rows_per_spread, pilotName, timeFormat, signature, interactive, centerVertical, margin, bare, side }),
    [template, spread, pilotName, timeFormat, signature, interactive, centerVertical, margin, bare, side],
  );
  // Vid behov: mät uppslagets naturliga höjd/bredd + datarutornas Y-gränser och rapportera tillbaka.
  const injected = (onAspect || onGeometry)
    ? `(function(){var p=function(){try{var W=window.ReactNativeWebView;`
      + `W.postMessage(JSON.stringify({type:'size',ratio:document.body.scrollHeight/window.innerWidth}));`
      + `var rows=document.querySelectorAll('tr.row'),sums=document.querySelectorAll('tr.sum');`
      + `if(rows.length){var r0=rows[0],t=r0.getBoundingClientRect().top,bd=rows[rows.length-1].getBoundingClientRect().bottom,bs=sums.length?sums[sums.length-1].getBoundingClientRect().bottom:bd;`
      + `var cc=r0.children,cx=[];for(var i=0;i<cc.length;i++)cx.push(cc[i].getBoundingClientRect().left);if(cc.length)cx.push(cc[cc.length-1].getBoundingClientRect().right);`
      + `W.postMessage(JSON.stringify({type:'geom',top:t,botData:bd,botSum:bs,colX:cx}));}`
      + `}catch(e){}};p();setTimeout(p,120);setTimeout(p,400);})();true;`
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
            else if (m?.type === 'geom' && onGeometry) onGeometry({ top: m.top, botData: m.botData, botSum: m.botSum, colX: m.colX });
          } catch {}
        }}
      />
    </View>
  );
});
