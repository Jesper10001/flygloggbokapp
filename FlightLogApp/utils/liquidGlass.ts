// Liquid Glass bara när både iOS 26+ och native-modulen (expo-glass-effect) finns. Modulen kräver ett bygge där
// den är länkad — saknas den kastar kontrollen, och då används blur i stället (ingen krasch).
// Delas av GlassTabBar och UpdateAvailableModal.
let liquidGlass: boolean | null = null;

export function canUseLiquidGlass(): boolean {
  if (liquidGlass === null) {
    try {
      const glass = require('expo-glass-effect');
      liquidGlass = !!glass.isLiquidGlassAvailable() && !!glass.isGlassEffectAPIAvailable();
    } catch {
      liquidGlass = false;
    }
  }
  return liquidGlass;
}
