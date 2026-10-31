# Blades – ändringslogg

Varje version har två delar:
- **What's New:** det som går till App Store ("What's New in This Version") och till uppdateringspopupen i appen. Det är på engelska och bara det väsentligaste, med det viktigaste först. Popupen visar de tre första raderna som börjar med `New:`, `Fixed:` eller `Improved:`, och "And more fixes and improvements" om det finns fler.
- **Alla ändringar:** den kompletta listan, för oss.

Claude fyller i "Unreleased" varje gång appen ändras. Vid ett bygge döps avsnittet om till versionen. Se RELEASE.md.

## Unreleased (blir 1.0.1)

### What's New
- New: Small fixes now reach you right away, without waiting for an App Store update.
- New: Your logbook is automatically backed up on your device before every update.
- Fixed: Logbook totals in the EASA AMC1 layout now fill every column, also in PDF exports.
- Improved: A clearer "What's new" message when a new version is available.

### Alla ändringar
- **Loggboken:** summaraderna i mallen EASA AMC1 FCL.050 har inget hack under FSTD "Type" längre. Det gäller även PDF-exporten (`services/logbook/renderSpread.ts`).
- **Rättningar utan granskning (EAS Update med Expo):**
  - expo-updates med runtime-version via fingerprint.
  - Kanalerna `production` (App Store) och `preview` (din TestFlight-app, byggprofilen `testflight`).
  - Publiceringsskriptet `scripts/publish-update.mjs`, som spärrar mot läckta nycklar.
- **Säkerhetskopia före uppgradering:** loggboken kopieras och verifieras första gången en ny version eller EAS-uppdatering startar, innan migrationerna körs. De två senaste kopiorna sparas (`db/database.ts`).
- **Uppdateringspopupen:**
  - Nytt glaskort (Liquid Glass på iOS 26) med App Storens "What's New".
  - Urvalet är högst tre rader med etiketterna NEW, FIXED och IMPROVED, och knapparna heter "Update" och "Not now".
  - Bannern "Update available" på dashboarden är borttagen.
- **Dev-builden låtsas att nästa version finns** (`DEV_SIMULATE_UPDATE`), för att visa popupen. Det påverkar aldrig riktiga byggen.
- **Bygg bara från committad kod** (`requireCommit` i `eas.json`).
- **Uppgraderingstestet för databasen** (`scripts/test-db-upgrade.cjs`) körs mot alla taggade byggen.

## 1.0.0 (14) – inskickad 2026-10-28

Första versionen i App Store. Taggen är `ios/1.0.0-14` (commit `cf3b5af`). Tidigare TestFlight-byggen har taggarna `ios/1.0.0-1` till `-13`.
