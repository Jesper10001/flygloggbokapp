# Blades – att lösa inför lansering

Uppdaterad 2026-10-18. Bocka av med `[x]`.

## Måste lösas före App Store-inskickning (uppskjutet)

- [ ] **Export compliance.** SQLCipher drar in OpenSSL, så svaret "använder inte icke-undantagen kryptering" är tveksamt. Välj en väg:
  - kompilera SQLCipher mot Apples CommonCrypto, så att svaret stämmer
  - eller svara "Yes – standard encryption" i App Store Connect vid inskickningen
- [ ] **Licenser och källhänvisningar i appen.** Medvetet uppskjutet, med risk.
  - Bygg en Acknowledgements-sida (SQLCipher/OpenSSL, typsnitt, landsgränser, npm-paket).
  - Lägg till en kredit per Wikipedia-bild i flottan (CC BY-SA).
  - Fyll därefter i Content Rights i App Store Connect.

## Gör snart

- [ ] **Testa senaste TestFlight-bygget** – se listan längst ner.
- [ ] **Nytt bygge** så att den inbäddade jordgloben följer med. Testa sedan globen i flygplansläge.
- [ ] **Ladda upp sajten** (integritetspolicyn nämner inte längre unpkg):
  `npx wrangler pages deploy website --project-name blades-website`
- [ ] **Cloudflare: stäng av Bot Fight Mode** under Security → Bots för blades-app.com.
  - Skyddet sätter cookien `cf_clearance`, medan integritetspolicyn lovar "inga cookies".
  - Det kan också stoppa appens anrop till api.blades-app.com.
  - Be Claude kontrollera efteråt att cookien är borta.
- [ ] **Besluta om kraschrapportering (Sentry).**
  - JavaScript-fel rapporteras idag ingenstans.
  - Sentry kräver ett gratiskonto, ett nytt bygge och tillägget "Crash Data" i integritetspolicyn och App Privacy.

## Kan vänta

- [ ] **Esri-nyckel** (ArcGIS Location Platform, privilegiet Basemaps):
  - `cd proxy && npx wrangler secret put ARCGIS_API_KEY`
  - slå sedan på Route-lagret med `ROUTE_LAYER_ENABLED = true` i `FlightShareCard.tsx` och bygg nytt
  - nyckeln löper ut efter max 1 år
- [ ] **iCloud:** testa återställning på en annan enhet.
- [ ] **Sajten:**
  - drönarvarianter för How it works och kartan
  - ev. ta om Insights-bilden, som visar PIC "May 2039"
- [ ] **Flygplatsdatabasen:** verifiera ~4 000 äldre poster mot OurAirports, och radera inget i blindo.

## Klart

- [x] Proxyn deployad (2026-10-18)
- [x] RevenueCat (paywall, Customer Center, promokoder)
- [x] Jordgloben inbäddad i appen – kräver nytt bygge

---

## Testa i nästa bygge

- [ ] **Jordgloben i flygplansläge** (pilot och drönare). Den ska visas med texturer utan nät.
- [ ] **Best week / Longest XC – placering #2–5 öppnas:**
  - Tryck på #2–5 i topp 5-listan längst ner. Samma vy ska visas för den veckan eller flygningen, med "Top 5 · Week #N" överst.
  - Byt placering därifrån. Innehållet ska bytas på plats och sidan börja om från toppen.
  - Tryck på #1, tillbaka-pilen eller svep nedåt. Du ska komma tillbaka till bästa veckan respektive längsta XC.
  - "BEST" ska bara stå vid #1.
- [ ] **Drönarens Log flight – siktläge och flygregler:**
  - **Växlaren VLOS / EVLOS / BVLOS:**
    - Fyll i plats och flygtid. Då ska staplarna VLOS, EVLOS och BVLOS visas, med NIGHT och "Auto night" under.
    - Välj ett läge i växlaren. Hela flygtiden ska hamna där.
    - Dra BVLOS till t.ex. 40 %. VLOS ska då få resten, och växlaren ska byta till BVLOS när BVLOS blir störst.
    - Skriv tid direkt i rutorna till höger. Det ska fungera.
  - **VFR / Y/Z / IFR:**
    - Pilen till höger fäller ut VFR/IFR-staplarna. De ska vara dolda från början.
    - Väljer man Y/Z ska staplarna fällas ut direkt.
  - **"Type of flight"** längre ner ska vara borta.
  - **Spara en flygning med delad tid**, t.ex. 0:20 VLOS + 0:10 BVLOS. Kontrollera att:
    - detaljvyn visar "VLOS 0:20 · BVLOS 0:10" och BVLOS-märket
    - loggbokens VLOS- och BVLOS-kolumner delar upp tiden
    - flygningen syns i både VLOS- och BVLOS-filtret
    - drönarstatistiken räknar rätt, utan dubbelräkning
    - redigering laddar tillbaka uppdelningen
  - **Loggbokslistan och dashboardkortet** ska visa "VLOS+BVLOS" respektive "VLOS/BVLOS" för en flygning med delad tid.
  - **CSV-export (drönare):** kolumnerna VLOS, EVLOS och BVLOS ska ha exakt tid per flygning, och totalraden ska summera. Importera sedan exporten igen. Uppdelningen ska följa med.
  - **Rubrikerna** "Pilot function" och "Operation" ska ha samma färg som Drone och Registration.
- [ ] **Drönarens Log flight – roller och besättning:**
  - **OTHER** under DUAL/INSTRUCTOR öppnar en lista: RPIC, Payload operator, Mission commander, Observer, Safety pilot, Examiner.
    - Välj en roll. Knappen ska visa rollens namn, t.ex. "PAYLOAD OPERATOR".
    - "Clear special role" i listan ska ta dig tillbaka till PIC.
  - **i-ikonen** till höger om "Pilot function" ska öppna en helskärmssida som beskriver alla tio roller och vilken loggbokskolumn tiden hamnar i.
  - **Second pilot** under rollerna ska se ut och fungera som i pilotläget, men med drönarroller och drönarens färger:
    - roll till vänster, namn till höger
    - "+" i namnrutan öppnar Name/Callsign
    - "+figur" lägger till fler piloter, och ✕ tar bort en extra pilot
  - **Bara en PIC:**
    - Sätt medpiloten till PIC eller RPIC när du själv är PIC. Du ska då bli SIC.
    - Väljer du själv PIC igen ska medpiloten bli SIC.
  - **Automatisk PIC:** var Observer och lägg till ett namn utan roll. Namnet ska få rollen PIC.
  - **Spara en flygning** som Payload operator med två medpiloter. Kontrollera att:
    - detaljvyn visar "Crew" med din roll och medpiloterna
    - loggboken (Book) har 0 i PIC, och raden "SIC: …, OBS: …" står sist i Remarks
    - redigering laddar tillbaka roll och medpiloter, utan att besättningsraden dubbleras i Remarks-rutan
    - nästa nya flygning föreslår namnen (RECENT och per drönarmodell)
  - **Rundturen:** drönarsteget "Log a flight" ska inte längre nämna quick entry.
  - **Observer-rutan ska vara borta.** Observatören läggs till under Second pilot med rollen OBS, och detaljvyn visar den under "Crew".
  - **Äldre flygning med Observer:** öppna den för redigering.
    - Namnet ska ligga under Second pilot som OBS.
    - Raden "Observer: …" ska vara borta ur Remarks-rutan.
    - Spara två gånger. Ingenting ska dubbleras.
- [ ] **Settings → Logbook PILOT/DRONE – bekräftelsedialogen:**
  - Den ska se ut som förut, med titel, text och knapparna Cancel/Switch.
  - Den ska ha en grön rad med sköld: "All data in Pilot mode is saved." När man byter tillbaka ska det stå "All data in Drone mode is saved."
  - Cancel stänger utan byte. Switch tonar ut dialogen och byter läge, och knoppen hamnar på rätt sida.
- [ ] **Drönarens Max alt i fot:**
  - Stapeln visar ft, 0–24 000 ft. Dra ger steg om 200 ft, och −/+ ger steg om 10 ft.
  - Detaljvyn visar höjden i ft.
  - Över 394 ft (120 m) i A1–A3 ska varningen visa ft.
  - En äldre flygning sparad i meter ska visas omräknad till fot, t.ex. 120 m → 394 ft.
- [ ] **Drönarens CSV-export (båda knapparna, i Settings och i drönarinställningarna):**
  - "Pilot function" och en tidskolumn per roll ska finnas: PIC, SIC/Co-pilot, Dual, Instructor, RPIC, Payload operator, Mission commander, Observer, Safety pilot och Examiner.
    - En kolumn syns bara om någon flygning har tid där.
    - Instruktör, RPIC och examinator räknas även som PIC, och safety pilot som co-pilot, som i loggboken.
  - "Crew" ersätter den gamla Observer-kolumnen, och höjden heter "Max altitude (ft)".
  - Importera exporten igen. Roll, besättning och höjd ska följa med.
  - Remarks på flera rader ska inte ge extra, trasiga flygningar.

## Testlista – senaste TestFlight-bygget

Redan bekräftat av skärmdumparna:
- pilotimportens totaler
- drönarglobens platser
- starttider och COM/PRI i drönarloggboken

- [ ] **Settings:** växla Pilot/Drone fram och tillbaka flera gånger. Knoppen ska alltid hamna på vald sida.
- [ ] **Settings:** titeln ska ha samma serif-typsnitt som Logbook.
- [ ] **Drönarflottan:** "X models · X registrations" ska stå ovanför linjen.
- [ ] **Tomma lägen** (ny profil): "Create logbook" och "Add your first aircraft/drone" ska ha ramad stil utan "+".
- [ ] **Global map → Favorites:** nålarna ska synas även helt utzoomat, i både Cluster- och Region-läge, och kartan ska zooma in så att favoriterna syns.
- [ ] **Onboarding → Profile:** rutan med "?" och "Your name" ska vara borta.
- [ ] **Placera plats på karta → sök:** pinnen ska hamna rätt (Apples sökning).
- [ ] **Share card:** bara Performance och Postcard ska finnas.
- [ ] **Import:** varningarna i förhandsvisningen ska vara på engelska.
- [ ] **Drönarimport:** ingen "No date column was found"-varning.
- [ ] **Loggboken:** en skolflygning från 2018 ska sakna co-pilot-tid.
