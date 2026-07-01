// Hjälpare för route-connectorns landsflaggor.
// (Helikopter vs flygplan avgörs INTE här längre — det läses från farkostens lagrade
//  kategori i aircraft_registry, som anges när farkosten läggs till. Se getAircraftCategory.)

// ISO 3166-1 alpha-2 → flagg-emoji. Tom sträng om koden är ogiltig.
export function flagEmoji(cc?: string): string {
  const c = (cc || '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return '';
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}
