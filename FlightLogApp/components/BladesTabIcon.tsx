import { Image } from 'react-native';

const iconDefault = require('../assets/logo-goldfloating.PNG');
const iconActive = require('../assets/logo-cyanfloating.PNG');

interface Props {
  size?: number;
  focused?: boolean;
}

export function BladesTabIcon({ size = 32, focused = false }: Props) {
  const h = size;
  const w = h * (1024 / 1536); // floating-loggans proportion (porträtt)
  return (
    <Image
      source={focused ? iconActive : iconDefault}
      style={{ width: w, height: h, marginTop: 2 }}
      resizeMode="contain"
    />
  );
}
