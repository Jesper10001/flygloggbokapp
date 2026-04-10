# FlightLog Pro

EASA-kompatibel flygloggbok för iOS, riktad mot CPL/ATPL-piloter.

## Installation

### 1. Installera Node.js (om du inte har det)
```bash
brew install node
```

### 2. Installera beroenden
```bash
cd FlightLogApp
npm install
```

### 3. Konfigurera API-nyckel
Redigera `.env` och lägg in din Anthropic API-nyckel:
```
EXPO_PUBLIC_ANTHROPIC_API_KEY=sk-ant-...
```

### 4. Starta appen
```bash
npx expo start
```
Tryck `i` för iOS Simulator eller skanna QR-koden med Expo Go.

## Struktur

```
app/
  (tabs)/
    index.tsx     — Dashboard med statistik
    log.tsx       — Loggbok med sökfunktion
    scan.tsx      — OCR-skanning (Premium)
    settings.tsx  — Inställningar & export
  flight/
    add.tsx       — Logga ny flygning
    [id].tsx      — Visa/redigera flygning
    review.tsx    — Granska OCR-data
  settings/
    airport.tsx   — Hantera ICAO-flygplatser

db/
  database.ts     — SQLite-initialisering
  flights.ts      — CRUD för flygningar
  icao.ts         — ICAO-databas med ~150 europeiska flygplatser

services/
  ocr.ts          — Claude API (claude-haiku-4-5) för bildanalys
  export.ts       — CSV och PDF/HTML-export

store/
  flightStore.ts  — Zustand state management
```

## Funktioner

### Gratis
- Logga flygningar manuellt med alla EASA-fält
- Dashboard med totaler och statistik
- Loggbok med sökfunktion
- Max 50 flygningar

### Premium
- Obegränsat antal flygningar
- OCR-skanning via Claude AI
- Granska och korrigera OCR-data innan sparning
- Export till CSV och PDF
- EASA CPL/ATPL-kravöversikt med progressbars

## Nästa steg

1. **RevenueCat** — Lägg till `react-native-purchases` och konfigurera in-app köp
2. **Ikon & splash** — Lägg till `assets/icon.png` (1024x1024) och `assets/splash.png`
3. **EAS Build** — `npx eas build --platform ios` för App Store-distribution
4. **TestFlight** — Distribuera via `npx eas submit`
