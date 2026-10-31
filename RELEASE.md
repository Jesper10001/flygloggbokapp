# Släpprutin för Blades

## Grenar och taggar

- **`main`** är nästa version: allt som ska med i nästa bygge eller nästa rättning.
- **En tagg per bygge:** `ios/<version>-<bygge>`, till exempel `ios/1.0.0-14`, på exakt den commit som byggdes. EAS bygger bara committad kod (`requireCommit`), så taggen är bygget.
- **Vad som är nytt sedan en version:**
  ```
  git log --oneline ios/1.0.0-14..main -- FlightLogApp
  ```
  Den användarvänliga versionen står i `CHANGELOG.md` under "Unreleased".
- **Större funktioner** byggs i en egen gren, `feature/<namn>`, och slås ihop med `main` när de är klara. Små rättningar går direkt på `main`.
- **Rätta en släppt version medan `main` har annat på gång:**
  ```
  git switch -c hotfix/1.0.1 ios/1.0.0-14
  ```
  Rätta, bygg och tagga från den grenen. Slå sedan ihop den med `main`.
- **Två sessioner samtidigt:** byt aldrig gren i en mapp där en annan session jobbar. Ge den andra en egen arbetskopia:
  ```
  git worktree add ../flygloggbokapp-<namn> <gren>
  ```

## Före varje bygge (App Store eller TestFlight)

1. **Commita allt.** EAS vägrar annars bygga.
2. **Databastestet:**
   ```
   node FlightLogApp/scripts/test-db-upgrade.cjs
   ```
   Det kör uppgraderingen från varje taggat bygge till dagens kod och måste sluta med "inga fel".
3. **`CHANGELOG.md`:** döp om "Unreleased" till versionen. Under What's New ska högst några rader stå, det viktigaste först, med `New:`, `Fixed:` eller `Improved:` först på varje rad.
4. **Bygg:** först `--profile testflight`, som är din telefon och läser testkanalen, sedan `--profile production` för App Store. Se TODO.md under "Nästa bygge".
5. **Tagga båda byggena** och skicka upp taggarna:
   ```
   git tag -a ios/<version>-<bygge> <commit> -m "…"
   git push origin --tags
   ```
6. **App Store Connect:** klistra in What's New-raderna i "What's New in This Version". Appens popup visar automatiskt de tre första.

## Rättning via EAS Update (utan granskning)

1. Kör databastestet, eftersom rättningen kan innehålla nya migrationer.
2. `node FlightLogApp/scripts/publish-update.mjs preview "<vad som rättats>"`. Testa sedan i TestFlight-appen genom att starta om den två gånger.
3. Efter "publicera": `node FlightLogApp/scripts/publish-update.mjs production`.
4. Lägg till raden i `CHANGELOG.md`.

## Backa

- **En EAS-uppdatering:** `npx eas-cli update:rollback` från `FlightLogApp`. Användarna får förra koden vid nästa start. Gammal kod fungerar på en uppgraderad databas, eftersom databastestet kontrollerar det.
- **Ett App Store-bygge** kan inte backas hos användarna. Släpp i stället en ny version byggd från förra taggen:
  ```
  git switch -c hotfix/<ny version> ios/<förra taggen>
  ```
  Bygg, skicka in och begär snabbgranskning (Request Expedited Review). Använd Phased Release vid större uppdateringar, så kan utrullningen pausas.

## Användarnas data

- **Migrationsreglerna** står överst i `runMigrations` i `FlightLogApp/db/database.ts`:
  - bara lägga till, aldrig ta bort eller döpa om
  - allt körs vid varje start
  - engångsändringar skyddas med en flagga
- **En användare som ligger flera versioner efter** får allt som saknas på en gång. Det är testat från april-versionen och alla byggen fram till i dag.
- **Före varje uppgradering** tar appen en verifierad kopia av loggboken på enheten. De två senaste sparas. Skulle något gå snett kan en återställning skickas som EAS-uppdatering.
