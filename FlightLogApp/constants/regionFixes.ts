// Kurerade rättningar för region-hulls/-gruppering på globala kartan (regionDrill).
// Bakgrund: gränserna ritas som hull av regionens flygplatser. Felmärkta flygplatser och avlägsna
// öar drar iväg hullen. Det mesta löses ALGORITMISKT i hullOf (självkalibrerande spik-borttagning),
// men två saker kräver kurering:
//  1) REGION_OVERRIDES — äkta mislabels där rätt region är känd → rättar BÅDE drill-gruppering och hull.
//  2) HULL_EXCLUDE — antimeridian-KLUSTER som den självkalibrerande regeln missar (paren ligger nära
//     varandra så deras närmaste egen-regions-granne är kort). Hålls utanför hullen men visas/borras
//     fortfarande normalt under sin korrekta region.

// ICAO → korrekt ISO 3166-2-regionkod. Verifierat mot namn/plats.
export const REGION_OVERRIDES: Record<string, string> = {
  FANX: 'ZA-WC', // Diepkloof Airfield — ligger i Kapstaden (Western Cape), fel-taggat Eastern Cape
  FAWV: 'ZA-MP', // White River Mercy Air — White River ligger i Mpumalanga, fel-taggat Free State
  // Sverige — verifierat 2026-10-26 mot geoBoundaries SWE ADM1 i full upplösning (seedens länskod fel).
  'SE-0004': 'SE-U', // Norberg — Västmanlands län, fel-taggat Dalarnas län
  'SE-0009': 'SE-C', // Flygfältet Långtora (Enköping) — Uppsala län, fel-taggat Västmanlands län
  'SE-0022': 'SE-C', // Vassunda (Knivsta) — Uppsala län, fel-taggat Västmanlands län
  'SE-0051': 'SE-S', // Degerfors Grenlanda — ligger på Värmlandssidan av gränsen, fel-taggat Örebro län
};

// ICAO som ska hållas UTANFÖR hull-polygonen (men behålla korrekt drill/pin). Antimeridian-kluster
// som hullOf:s självkalibrerande regel inte fångar (de ligger parvis nära varandra).
export const HULL_EXCLUDE: Set<string> = new Set([
  'PASY', 'PAAT', // Aleuterna (Attu/Shemya, +172°) — spikar annars Alaskas hull över antimeridianen
  'NZCI', 'NZPT', // Chatham / Pitt Island (-176°) — spikar annars Wellingtons hull
]);
