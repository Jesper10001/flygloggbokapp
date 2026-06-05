# Projektstruktur — Blades (FlightLogApp)

En karta över mapparna, i klartext. Tänk: **`app/` = skärmarna man ser, allt annat = byggdelar de använder.**

## Toppnivå-mappar

| Mapp | Vad det är | Liknelse |
|---|---|---|
| **`app/`** | Alla **skärmar/sidor** i appen. Mappstrukturen styr också **navigeringen** (Expo Router) — flytta inte filer här hur som helst, då ändras rutterna. | Rummen i huset |
| **`components/`** | **Återanvändbara UI-bitar** (knappar, kort, diagram, kartor, modaler) som skärmarna sätter ihop. | Möblerna |
| **`services/`** | **Logiken** bakom kulisserna: OCR-skanning, export, import, kart-/layout-byggare. Pratar med AI:n och bearbetar data. | Maskinrummet |
| **`db/`** | **Databasen** (SQLite) — sparar flygningar, böcker, flygplatser lokalt på telefonen. | Arkivet |
| **`store/`** | **Appens minne** medan den körs (zustand) — t.ex. vald flik, premium-status, kvoter. | Korttidsminnet |
| **`constants/`** | **Fasta värden**: färger (`colors`), texter/översättningar (`i18n`), loggboksmallar, kontinent-data. | Reglerna |
| **`hooks/`** | Små **React-hjälpare** (t.ex. översättning, tidsformat) som skärmar/komponenter återanvänder. | Verktygslådan |
| **`types/`** | **TypeScript-typer** — beskriver hur data ser ut (t.ex. en `Flight`). | Ritningarna |
| **`utils/`** | **Småfunktioner** som inte passar någon annanstans. | Diverse-lådan |
| **`assets/`** | **Bilder**: appikon, splash, loggor, flygplatsdatabasen (`icao-airports.json`). | Förrådet |
| **`proxy/`** | **Cloudflare Worker** som lägger på API-nyckeln mellan appen och AI:n. | Vakten vid grinden |

## Viktiga filer i roten

| Fil | Vad |
|---|---|
| **`app.json`** | Appens grundinställningar (namn, ikon, splash, behörigheter, plugins). |
| **`eas.json`** | Bygg-profiler för EAS (development / preview / production). |
| **`.env`** | **HEMLIGHETER** (proxy-URL + API-nyckel). Ligger MEDVETET inte i git — backa upp den separat! |
| **`package.json`** | Lista över alla bibliotek appen använder. |
| **`tsconfig.json`** | TypeScript-inställningar. |

## Bra att veta
- **JavaScript-ändringar** (mappar utom `app/`-rutter, logik, UI) syns direkt via Metro — ingen ombyggnad.
- **Native-ändringar** (nya bibliotek, ikon, splash) kräver en **EAS-build**.
- Flyttar man en kodfil bryts alla `import`-sökvägar som pekar på den — därför gör vi sånt försiktigt + verifierar med `npx tsc --noEmit`.
