import { Image, useWindowDimensions } from 'react-native';

interface Props {
  size?: 'small' | 'medium' | 'large';
}

const LOGO = require('../assets/Logo-andtext.PNG');
const AR = 1774 / 887; // ≈ 2.0 (Logo-andtext: logo + text)

export function BladesLogo({ size = 'medium' }: Props) {
  const { width: screenW } = useWindowDimensions();
  // Önskad höjd per storlek; "large" skalas upp till max ~88% av skärmbredden
  if (size === 'small') {
    return <Image source={LOGO} style={{ width: 34 * AR, height: 34 }} resizeMode="contain" />;
  }
  if (size === 'medium') {
    return <Image source={LOGO} style={{ width: 70 * AR, height: 70 }} resizeMode="contain" />;
  }
  // large — anpassa efter skärmbredd
  const width = screenW * 0.88;
  const height = width / AR;
  return (
    <Image source={LOGO} style={{ width, height }} resizeMode="contain" />
  );
}

export function BladesLogo_Compat(props: Props & { showWordmark?: boolean }) {
  return <BladesLogo size={props.size} />;
}
