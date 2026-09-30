// Demo-flygplatser för onboarding-globen (skärm 5). Nya användare har inga flugna flygplatser än,
// så vi visar en kurerad uppsättning RIKTIGA flygplatser som pulserande ripple-ringar — så att globen
// känns levande. 70 st, minst 5 per kontinent, utspridda över hela världen (koordinater ≈ 2 decimaler).
// Endast dekorativt (onboarding). Riktiga besökta flygplatser byggs ur användarens flygningar i appen.
export const ONBOARDING_AIRPORTS: { lat: number; lng: number }[] = [
  // ── Europa (11) ──
  { lat: 51.47, lng: -0.45 },  // London Heathrow
  { lat: 49.01, lng: 2.55 },   // Paris CDG
  { lat: 50.03, lng: 8.56 },   // Frankfurt
  { lat: 52.31, lng: 4.76 },   // Amsterdam
  { lat: 40.47, lng: -3.56 },  // Madrid
  { lat: 41.80, lng: 12.25 },  // Rome Fiumicino
  { lat: 59.65, lng: 17.92 },  // Stockholm Arlanda
  { lat: 41.28, lng: 28.75 },  // Istanbul
  { lat: 47.46, lng: 8.55 },   // Zürich
  { lat: 48.35, lng: 11.79 },  // Munich
  { lat: 55.62, lng: 12.65 },  // Copenhagen

  // ── Asien (11) ──
  { lat: 35.55, lng: 139.78 }, // Tokyo Haneda
  { lat: 40.08, lng: 116.58 }, // Beijing Capital
  { lat: 1.36, lng: 103.99 },  // Singapore Changi
  { lat: 25.25, lng: 55.36 },  // Dubai
  { lat: 22.31, lng: 113.91 }, // Hong Kong
  { lat: 28.57, lng: 77.10 },  // Delhi
  { lat: 13.69, lng: 100.75 }, // Bangkok Suvarnabhumi
  { lat: 37.46, lng: 126.44 }, // Seoul Incheon
  { lat: 25.27, lng: 51.61 },  // Doha
  { lat: 19.09, lng: 72.87 },  // Mumbai
  { lat: 2.74, lng: 101.71 },  // Kuala Lumpur

  // ── Nordamerika (11) ──
  { lat: 40.64, lng: -73.78 }, // New York JFK
  { lat: 33.94, lng: -118.41 },// Los Angeles
  { lat: 41.98, lng: -87.90 }, // Chicago O'Hare
  { lat: 43.68, lng: -79.63 }, // Toronto Pearson
  { lat: 33.64, lng: -84.43 }, // Atlanta
  { lat: 32.90, lng: -97.04 }, // Dallas/Fort Worth
  { lat: 19.44, lng: -99.07 }, // Mexico City
  { lat: 49.19, lng: -123.18 },// Vancouver
  { lat: 37.62, lng: -122.38 },// San Francisco
  { lat: 47.45, lng: -122.31 },// Seattle
  { lat: 25.80, lng: -80.29 }, // Miami

  // ── Sydamerika (11) ──
  { lat: -23.43, lng: -46.47 },// São Paulo Guarulhos
  { lat: -34.82, lng: -58.54 },// Buenos Aires Ezeiza
  { lat: 4.70, lng: -74.15 },  // Bogotá
  { lat: -12.02, lng: -77.11 },// Lima
  { lat: -33.39, lng: -70.79 },// Santiago
  { lat: -22.81, lng: -43.25 },// Rio de Janeiro Galeão
  { lat: -0.13, lng: -78.36 }, // Quito
  { lat: 10.60, lng: -66.99 }, // Caracas
  { lat: -34.84, lng: -56.03 },// Montevideo
  { lat: -16.51, lng: -68.19 },// La Paz
  { lat: -25.24, lng: -57.52 },// Asunción

  // ── Afrika (11) ──
  { lat: -26.13, lng: 28.24 }, // Johannesburg
  { lat: 30.12, lng: 31.41 },  // Cairo
  { lat: -1.32, lng: 36.93 },  // Nairobi
  { lat: 6.58, lng: 3.32 },    // Lagos
  { lat: 33.37, lng: -7.59 },  // Casablanca
  { lat: 8.98, lng: 38.80 },   // Addis Ababa
  { lat: -33.97, lng: 18.60 }, // Cape Town
  { lat: 5.61, lng: -0.17 },   // Accra
  { lat: 36.69, lng: 3.22 },   // Algiers
  { lat: -6.87, lng: 39.20 },  // Dar es Salaam
  { lat: 36.85, lng: 10.23 },  // Tunis

  // ── Oceanien (10) ──
  { lat: -33.95, lng: 151.18 },// Sydney
  { lat: -37.67, lng: 144.84 },// Melbourne
  { lat: -37.01, lng: 174.79 },// Auckland
  { lat: -27.38, lng: 153.12 },// Brisbane
  { lat: -31.94, lng: 115.97 },// Perth
  { lat: -17.75, lng: 177.45 },// Nadi (Fiji)
  { lat: -9.44, lng: 147.22 }, // Port Moresby
  { lat: -43.49, lng: 172.53 },// Christchurch
  { lat: -34.95, lng: 138.53 },// Adelaide
  { lat: 21.32, lng: -157.92 },// Honolulu

  // ── Antarktis (5) ──
  { lat: -77.87, lng: 166.47 },// McMurdo / Williams Field
  { lat: -67.57, lng: -68.13 },// Rothera
  { lat: -70.83, lng: 11.61 }, // Novolazarevskaya
  { lat: -71.96, lng: 2.45 },  // Troll Airfield
  { lat: -64.24, lng: -56.63 },// Marambio
];
