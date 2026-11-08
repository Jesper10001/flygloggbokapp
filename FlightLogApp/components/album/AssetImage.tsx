// En bild ur flygalbumet: löser fotobibliotekets id (eller en fil) till en visningsbar miniatyr när rutan ritas
// (services/photoSync thumbFor, fyra åt gången och cachat), så att långa listor bara läser det som syns.
import { memo, useEffect, useState } from 'react';
import { View, Image, type StyleProp, type ImageStyle } from 'react-native';
import { thumbFor, peekThumb } from '../../services/photoSync';

export const AssetImage = memo(function AssetImage({ localId, uri, isVideo, style }: {
  localId: string | null; uri?: string | null; isVideo: boolean; style: StyleProp<ImageStyle>;
}) {
  const key = localId ?? uri ?? '';
  const direct = uri && !isVideo ? uri : null; // en bild som lagts till för hand är redan en fil
  const [src, setSrc] = useState<string | null>(direct ?? peekThumb(key) ?? null);
  useEffect(() => {
    if (direct) { setSrc(direct); return; }
    const known = peekThumb(key);
    if (known) { setSrc(known); return; }
    let alive = true;
    setSrc(null);
    thumbFor(localId, isVideo, uri).then((u) => { if (alive) setSrc(u); }).catch(() => {});
    return () => { alive = false; };
  }, [key, isVideo]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!src) return <View style={[style as any, { backgroundColor: '#0F1E3A' }]} />;
  return <Image source={{ uri: src }} style={style} resizeMode="cover" />;
});
