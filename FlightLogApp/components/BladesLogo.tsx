import { Image, useWindowDimensions } from 'react-native';

interface Props {
  size?: 'small' | 'medium' | 'large';
}

export function BladesLogo({ size = 'medium' }: Props) {
  const { width: screenW } = useWindowDimensions();
  // Önskad höjd per storlek; "large" skalas upp till max ~88% av skärmbredden
  if (size === 'small') {
    return <Image source={require('../assets/blades-logo.png')} style={{ width: 34 * 2.56, height: 34 }} resizeMode="contain" />;
  }
  if (size === 'medium') {
    return <Image source={require('../assets/blades-logo.png')} style={{ width: 70 * 2.56, height: 70 }} resizeMode="contain" />;
  }
  // large — anpassa efter skärmbredd
  const maxW = screenW * 0.88;
  const width = maxW;
  const height = width / 2.56;
  return (
    <Image
      source={require('../assets/blades-logo.png')}
      style={{ width, height }}
      resizeMode="contain"
    />
  );
}

export function BladesLogo_Compat(props: Props & { showWordmark?: boolean }) {
  return <BladesLogo size={props.size} />;
}
