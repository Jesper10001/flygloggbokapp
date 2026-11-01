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
  // Lokala utvecklingsservern (`expo start`): runtime-versionen med policy "fingerprint" räknas annars om
  // vid VARJE manifest-anrop (~20 s) → dev-bygget ger upp med "Could not reach". Dev-klienten bryr sig inte
  // om runtime-versionen när den laddar från Metro, så en fast sträng räcker där. Expo-updates löser
  // versionen i en barnprocess (runtimeversion:resolve) som läser den här filen igen utan "start" i argv —
  // därför miljövariabeln, som barnprocesserna ärver. EAS-byggen, `eas update` och `expo export` startas
  // inte via "start" och får den riktiga fingeravtrycks-policyn från app.json.
  if (process.argv[2] === 'start' && !process.env.EAS_BUILD) process.env.BLADES_DEV_SERVER = '1';
  if (process.env.BLADES_DEV_SERVER === '1' && !process.env.EAS_BUILD) {
    config.runtimeVersion = 'dev-server';
  }
  return config;
};
