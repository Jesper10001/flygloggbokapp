// Central videospelare byggd på expo-video (ersätter deprecated expo-av <Video>).
// Kapslar useVideoPlayer-hooken så anropssidorna slipper hantera player-instanser.
import { useEffect, useRef } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import { useVideoPlayer, VideoView, type VideoContentFit } from 'expo-video';

export function FlightVideo({
  uri, style, contentFit = 'cover', loop = false, muted = false, autoPlay = false, nativeControls = false,
}: {
  uri: string;
  style?: StyleProp<ViewStyle>;
  contentFit?: VideoContentFit;
  loop?: boolean;
  muted?: boolean;
  autoPlay?: boolean;
  nativeControls?: boolean;
}) {
  const player = useVideoPlayer(uri, (p) => { p.loop = loop; p.muted = muted; if (autoPlay) p.play(); });
  // Byt källa om uri ändras utan remount (t.ex. om-koppling); hoppa över mount (redan satt).
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    player.replace(uri);
    player.loop = loop; player.muted = muted;
    if (autoPlay) player.play();
  }, [uri]); // eslint-disable-line react-hooks/exhaustive-deps
  return <VideoView player={player} style={style} contentFit={contentFit} nativeControls={nativeControls} />;
}
