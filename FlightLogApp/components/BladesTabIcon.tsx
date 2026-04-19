import { Image } from 'react-native';

const iconDefault = require('../assets/blades-tab-icon.png');
const iconActive = require('../assets/blades-tab-icon-active.png');

interface Props {
  size?: number;
  focused?: boolean;
}

export function BladesTabIcon({ size = 32, focused = false }: Props) {
  const h = size * 0.65;
  const w = h * (830 / 153);
  return (
    <Image
      source={focused ? iconActive : iconDefault}
      style={{ width: w, height: h, marginTop: 6 }}
      resizeMode="contain"
    />
  );
}
