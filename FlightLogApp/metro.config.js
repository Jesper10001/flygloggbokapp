// Lärnings: vissa bildexporter får versalt .PNG. Metro behandlar bara gemena
// extensioner (t.ex. 'png') som assets — versalt .PNG tolkades som källkod och
// kraschade bundlingen. Här registreras versala bildextensioner som assets så
// require('../assets/Foo.PNG') fungerar (och framtida .PNG-filer också).
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const upperImageExts = ['PNG', 'JPG', 'JPEG'];
for (const ext of upperImageExts) {
  if (!config.resolver.assetExts.includes(ext)) {
    config.resolver.assetExts.push(ext);
  }
}

// Web: expo-sqlite kör via wa-sqlite.wasm — Metro måste behandla .wasm som asset,
// och dev-servern måste skicka COOP/COEP-headers (SharedArrayBuffer i sqlite-workern).
if (!config.resolver.assetExts.includes('wasm')) {
  config.resolver.assetExts.push('wasm');
}
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => (req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
    middleware(req, res, next);
  },
};

// Web-förhandsvisning: react-native-maps är native-only och stoppar hela
// web-bundlingen. Stubba den (och undermoduler) med en placeholder på web —
// kartskärmar renderar då utan karta i stället för att krascha.
const path = require('path');
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && (moduleName === 'react-native-maps' || moduleName.startsWith('react-native-maps/'))) {
    return { type: 'sourceFile', filePath: path.resolve(__dirname, 'web-mocks/react-native-maps.js') };
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
