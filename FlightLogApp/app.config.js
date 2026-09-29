// Dynamisk Expo-config: läser app.json (som `config`) och ger DEV-bygget ett eget bundle-id + namn
// så det kan samexistera med TestFlight/App Store-appen på samma enhet. Produktion/preview behåller
// det kanoniska id:t (com.blades.jointlogbook) som är kopplat till App Store Connect-appen.
//
// EAS sätter APP_VARIANT=development i "development"-profilen (eas.json). Allt annat = produktion.
module.exports = ({ config }) => {
  if (process.env.APP_VARIANT === 'development') {
    config.name = 'Blades (Dev)';
    config.ios = { ...(config.ios || {}), bundleIdentifier: 'com.blades.jointlogbook.dev' };
    config.android = { ...(config.android || {}), package: 'com.blades.jointlogbook.dev' };
  }
  return config;
};
