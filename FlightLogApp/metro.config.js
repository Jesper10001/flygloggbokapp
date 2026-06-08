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

module.exports = config;
