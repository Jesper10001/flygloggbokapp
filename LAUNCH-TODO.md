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
- [ ] **Deploya proxyn: modellbyte + automatisk uppgradering:** `cd proxy && npx wrangler deploy`
  - Alla installerade appar byter direkt: Sonnet 4.6 → 5.5 för skanning och import, Haiku 4.5 → 5.5 för nyheterna. Det är billigare per token med samma resultat i testerna. Användarnas coins räcker 13–30 % kortare; potterna är oförändrade, enligt beslut.
  - Opus 4.8 (loggboks-OCR) behålls tills den är testad med en riktig loggbokssida.
  - Fasas en modell ut väljer proxyn automatiskt den senaste modellen i samma familj ur Anthropics modellista, även framtida modeller som Haiku 6. En daglig kontroll 04:17 UTC pekar om i förväg.
  - Nödspak utan deploy (behövs normalt inte): `npx wrangler kv key put --binding=QUOTA_KV model-map '{"<gammalt-id>":"<nytt-id>"}' --remote`
    - Ångra med `npx wrangler kv key delete --binding=QUOTA_KV model-map --remote`.
  - Nästa app-build begär Sonnet 5.5 direkt och skickar ingen temperatur till 5.x-modeller.
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
  - Etiketten "Personal best · …" överst ska vara borta på båda sidorna.
  - Tryck på #2–5 i topp 5-listan längst ner. Samma vy ska visas för den veckan eller flygningen, med rubriken "#N best week" respektive "#N longest XC".
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
- [ ] **Drönarens Log flight – Mission:** fältet ska vara tomt när man öppnar en ny flygning, med bara platshållaren "Type of mission".
  - Det ska vara tomt även när det finns tidigare flygningar.
  - Dropdownen ska fortfarande fylla i ett val.
  - "Log next in session" ska behålla den mission man valt.
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
- [ ] **Global map → Sverige → Region:**
  - Alla 21 län ska visas med officiella namn, t.ex. "Stockholms län", "Västra Götalands län" och "Örebro län".
  - Västra Götalands län ska ha egen gräns och ungefär 29 flygplatser.
  - Hallands län ska ha 4 flygplatser, inte 21.
- [ ] **Settings → Logbook PILOT/DRONE – bekräftelsedialogen:**
  - Den ska se ut som förut, med titel, text och knapparna Cancel/Switch.
  - Under texten ska det stå "All data in Pilot mode is saved." i grönt, som vanlig text utan ikon eller ruta. När man byter tillbaka ska det stå "All data in Drone mode is saved."
  - Cancel stänger utan byte. Switch tonar ut dialogen och byter läge, och knoppen hamnar på rätt sida.
- [ ] **Drönarens höjdenhet (Settings → General → Altitude m/ft, under Time format):**
  - Standard är ft. Stapeln går 0–24 000 ft, dra ger steg om 200 och −/+ steg om 10.
  - Byt till m. Stapeln ska gå 0–7 300 m, dra ge steg om 50 och −/+ steg om 5. Samma flygning ska visas omräknad, t.ex. 394 ft ⇄ 120 m.
  - Detaljvyn och 120 m-varningen i A1–A3 ska följa vald enhet.
  - CSV-exporten ska ha rubriken "Max altitude (m)" eller "(ft)" efter inställningen. En återimport ska ge samma höjd.
- [ ] **Pilotens ACARS/Instrument scan** (scan-knappen på dashboarden eller scan-ikonen i Log flights header):
  - Väljaren ska heta "ACARS/Instrument scan".
  - Fota en ACARS-/AOC-sida FLT LOG. Granskningskortet ska visa:
    - datum (09AUG → årets 9 augusti; /23 → den 23:e denna månad)
    - From/To ur ORIG-DEST
    - Off blocks = OUT och On blocks = IN, utan sekunder
    - Landings 1
    - Total time med Block och Flight att välja mellan
  - Tre rader ska gå till remarks:
    - "Flight no." är förbockad.
    - "Takeoff / landing" och "Fuel" är valbara.
  - Apply ska ge rätt blocktid, t.ex. 05:02 → 07:48 = 2:46. Remarks ska få t.ex. "AFR66SQ", "Takeoff 05:12 · Landing 07:37 UTC" och "Fuel 7.8 → 2.1 t, used 5.7 t, refuel 5.26 t".
  - En sida där IN saknas (flygningen pågår) ska bara ge Off blocks och flygtid.
  - Ett gammalt datum utan år ska ge varningen "Year or month not shown — check the date".
  - Instrumentbilder, t.ex. AW109-exemplet, ska fungera som förut.
- [ ] **Drönarens Instrument scan:**
  - Starta från scan-knappen på dashboarden, scan-ikonen i Log flights header eller Settings → Import → Scan controller log.
  - Välj en DJI-skärmdump, t.ex. Flight Data Center. "Reading flights…" ska visas i cirka 10 s.
  - Datumväljaren ska visa datumen, senaste först och förvalt med märkningen LATEST.
    - Varje datum ska visa antal flygningar, total tid, maxhöjd i vald enhet och plats om den syns.
    - Datum som redan finns i loggboken ska ha en gul varning.
  - Välj ett datum och tryck på Log. Datum, flygtider (1st, 2nd, 3rd flight…), dagens högsta höjd och plats ska fyllas i.
    - Rader med "Map Loading" ska inte ge någon plats.
    - En plats som Lüneburg ska få koordinater och synas på drönarglobens karta.
  - Tryck på Save. "Log more flights from the image?" ska visas med näst senaste datum förvalt. Upprepa.
  - Done ska avbryta och gå tillbaka. När sista dagen är loggad ska toasten "All flights from the image are logged" visas.
  - Testa även en lista med dag/månad-datum (16/03/2017). 04/03 ska bli 4 mars, inte 3 april.
  - Utan Blade-coins ska du få Premium-erbjudandet, eller beskedet "Out of Blade-coins" om du redan är Premium.
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
