# Blades – att göra

Uppdaterad 2026-10-31. Bocka av med `[x]` och flytta klara punkter till arkivet längst ner. Filen hette tidigare LAUNCH-TODO.md.

## Nu

- [ ] **App Review för 1.0** (bygge 14, inskickad 2026-10-28). Svara på eventuella frågor från Apple i App Store Connect (Resolution Center). Ops mejlar dig när statusen ändras.
- [ ] **Släpp 1.0** när den är godkänd: tryck "Release This Version" (manuell release).
- [ ] **Håll koll de första dagarna** i Ops: "Fel i appen" och Intäkter.
- [ ] **Kolla mejlen** efter "ITMS-91053 Missing API declaration" från Apple (privacy manifest). Expo-modulerna har egna manifest, men tredjeparts-SDK:er kan sakna.
- [ ] **Testmejl till support@** från en annan adress än Gmail, till exempel iCloud. Det ska komma fram i Gmail och visas som "1 i dag" under Supportmejl i Ops. Kommer det inte fram inom 5 minuter: byt tillbaka Email Routing-regeln till "Send to an email".
- [ ] **Always Use HTTPS** i Cloudflare (SSL/TLS → Edge Certificates). I dag ger `http://www.blades-app.com` fel 522.
- [ ] **Beslut: regiongränser från OpenStreetMap (ODbL)** för DR Kongo och Kazakstan. De krediteras och erbjuds på begäran, vilket uppfyller licensen. Alternativet Natural Earth är public domain men föråldrat där. Säg till om du vill byta.
- [ ] **Beslut: PDF-exportens typsnitt** hämtas från Google Fonts (`services/pdfExport/templates/modernBlades.ts` och `editorial.ts`). Det skickar användarens IP-adress till Google och står inte i integritetspolicyn. Rekommenderat: bädda in typsnitten (Inter och Cormorant är OFL), så kan det följa med 1.0.1.

## Nästa bygge (1.0.1)

Efter att 1.0 är släppt, i den här ordningen. Hela släpprutinen står i `RELEASE.md`, och vad som är nytt står i `CHANGELOG.md`.

1. [ ] **Påminnelse: källkartor till Sentry (cirka 10 minuter för dig).** Då visar varje krasch exakt fil och rad, i stället för en position i den hopbakade appkoden. Det görs före bygget, eftersom det ändrar byggkonfigurationen.
   - **Du:** skapa en token i Sentry (Settings → Organization Tokens). Spara den som hemlighet i EAS med `cd FlightLogApp && npx eas-cli env:create`: namnet `SENTRY_AUTH_TOKEN`, synligheten "secret" och miljön "production". Klistra in token när kommandot frågar, aldrig i chatten.
   - **Claude:** tar bort `SENTRY_DISABLE_AUTO_UPLOAD` i `eas.json`, byter `metro.config.js` till `getSentryExpoConfig` och lägger till uppladdning av källkartor i publiceringsskriptet för rättningar.
2. [ ] **Licenser:** `cd FlightLogApp && node scripts/gen-licenses.mjs` (cirka 2 minuter), som före varje release.
3. [ ] **Version:** höj `"version"` i `FlightLogApp/app.json` till `1.0.1`. Döp om "Unreleased" i `CHANGELOG.md` till 1.0.1 och välj What's New-raderna.
4. [ ] **Commita allt och kör databastestet:** `node FlightLogApp/scripts/test-db-upgrade.cjs`, som ska sluta med "inga fel". EAS bygger bara committad kod.
5. [ ] **Bygg två gånger:** först `npx eas-cli build -p ios --profile testflight`, sedan `npx eas-cli build -p ios --profile production`. Skicka båda med `npx eas-cli submit -p ios --profile production --latest` efter varje bygge. Testflight-bygget får det lägre numret: installera det på din telefon, det läser testkanalen för rättningar. Det högre numret skickas in för granskning. Tagga båda (`ios/1.0.1-<bygge>`) och skicka upp taggarna med `git push origin --tags`.
6. [ ] **Integritetspolicyn:** lägg till Expo före inskickningen. Förslag: *"App updates: when you open the app it checks Expo (EAS Update) for a newer version of the app's code. Expo receives your IP address, your device platform and a random installation ID to deliver the update. No logbook data is sent."* Se också över App Privacy i App Store Connect.
7. [ ] **Verifiera rättningar utan granskning:** Claude publicerar en liten teständring till testkanalen. Starta om TestFlight-appen två gånger: första starten hämtar, andra visar ändringen.
8. [ ] **Testa** enligt testlistan nedan, och skicka sedan in.

### Testlista

Det mesta bör redan finnas i bygge 14 och kan testas nu. Rättningen av AMC1-loggbokens summarader, säkerhetskopian och den nya uppdateringspopupen kommer med 1.0.1.

- [ ] **Säkerhetskopia före uppgradering** (1.0.1):
  - Installera 1.0.1 ovanpå 1.0, utan att radera appen. Den första starten kan ta en sekund eller två extra. Alla flygningar ska finnas kvar.
  - Gör det både med extra kryptering påslagen och avslagen.
  - Claude kontrollerar sedan via en EAS-uppdatering eller loggen att kopian `preupdate-….db` finns bredvid loggboken.
  - Nästa uppdatering ska inte göra en ny kopia förrän versionen ändras.

- [ ] **Loggboken EASA AMC1 FCL.050, summaraderna** (kod rättad 2026-10-28 i `services/logbook/renderSpread.ts`): under FSTD session → "Type" ska Total this page, Brought forward och Total to date vara en hel ruta i bandet, utan hack. Bara rutan under Remarks ska vara öppen. Kolla både en tom bok och en med flygningar, och PDF-exporten.
- [ ] **Fotokredit på Fleet-korten:**
  - En nyhämtad bild ska visa "Photo: <namn> · CC BY-SA 4.0 · Wikimedia Commons" uppe till vänster i bannern. Tryck på den: filens sida på Wikimedia ska öppnas.
  - Gamla bilder ska få kredit cirka 10 s efter start.
  - En egen bild ur biblioteket ska inte ha någon kredit.
  - Rundturens Fleet-kort och Fleet-tomtillståndet ska också visa kredit, i tomtillståndet som en rad under korten.
  - Efter en CSV-import med många typer ska alla kort få bild.
- [ ] **Acknowledgements** (Settings → About, pilot och drönare): tre sektioner. Tryck på en rad för att se upphovsrätt, licenstext och länk.
- [ ] **Workload för nya användare och ett rättat snitt (pilot + drönare):**
  - **Ny användare:** logga den första flygningen. Stapeln och ringen ska lägga sig mitt på, på 100 % (NORMAL), inte på max. De första cirka två månaderna glider värdet mjukt mot det verkliga, och därefter gäller det fullt ut.
  - **CSV-import med historik:** de verkliga värdena ska gälla direkt.
  - **Klumpsummor räknas inte:** manuell blockimport ("Block import manually") och "Fill in missing hours" ska inte påverka workload alls.
  - **Befintlig historik:** värdet kan ändras lite. Snittet räknas nu per kalenderdag under dina aktiva månader. Förut blev det för högt för den som flyger få veckodagar (till exempel bara helger), och för lågt i början.
  - **Info-knappen (i):** den förklarar att mätaren står på 100 % medan den lär sig ditt normala tempo.
- [ ] **Insights: Experience & projections flyttas tills det finns historik (pilot):**
  - Har du bara flygningar i innevarande månad ska sektionen ligga längst ner, under Milestones.
  - När flygningarna spänner över två kalendermånader, eller om du har importerad historik, ska den ligga på sin vanliga plats direkt efter Hours bank.
- [ ] **Karusellerna följer kortets höjd:** avståndet mellan kortet och sidprickarna ska vara detsamma på varje kort, även när kortens höjd skiljer sig. Ett exempel är en flygning med natt-raden ("40 % night") bredvid en utan.
  - Gäller dashboardens senaste flygningar (pilot och drönare) och Fleet (pilot och drönare). Knappen Add aircraft/drone ligger alltid lika nära.
  - När du sveper mellan ett högt och ett lågt kort ska höjden glida mjukt, utan hopp.
- [ ] **Workload-panelen på dashboarden (stapel + ring), pilot och drönare:**
  - **Stapeln och ringen** är lugna, i appens cyan: dämpad till klar fram till en liten vit prick med cyan kant. De har ingen regnbågsskala och ska kännas naturliga mot resten av dashboarden.
  - **Mittmarkeringen** på stapeln och toppmarkeringen på ringen visar 100 % (ditt snitt). Pricken glider fram vid start och efter en loggad flygning.
  - **Zonfärgen syns bara** i etiketten vid "WORKLOAD · 14D", i den lilla zontexten under ringen och i värdet för 14D/AVG.
  - **TOTAL och YTD** är alltid cyan.
  - **Info-knappen (i):** förklaringen har även zonen LIGHT (cyan).
- [ ] **Ny bakgrund (navy-gradient bakom flikarna):**
  - Flikskärmarna har inte längre en platt navy, utan blått ljus uppifrån (även bakom statusraden och headern), ett svagt cyan sken nere till vänster (drönarens accentfärg i drönarläget) och en djupare botten. Gäller dashboard, loggbok (List, Book och Fleet), Insights och Settings i båda lägena.
  - **Inga platta block:** inga ytor ska ligga som platta navy-rutor ovanpå gradienten. Kolla särskilt sökbandet överst i loggboken, de öppnade sektionerna i Settings och telemetripanelen på dashboarden.
  - **Korten** ska fortfarande synas tydligt mot bakgrunden, även högst upp där skenet är starkast.
  - **Tangentbordet:** öppna flygplatssökningen på dashboarden. När vyn flyttas upp ska gradienten synas bakom, aldrig en vit yta.
  - Modaler och undersidor (till exempel Log flight och Settings-undersidor) har fortfarande platt navy. Det är medvetet tills vidare.
- [ ] **Glas-flikrad (flytande kapsel):**
  - Flikraden ska sväva som en rundad kapsel strax ovanför hemindikatorn. Innehållet ska synas suddigt genom den när du rullar, på dashboard, loggbok (List, Book och Fleet), Insights och Settings, i både pilot- och drönarläge.
  - På iOS 26 ska det vara Apples Liquid Glass med ljusbrytning i kanterna. Om native-delen saknas visas en mörk blur i stället, och det ska aldrig krascha.
  - Aktiv flik: cyan ikon och text med en ljus kapsel bakom, som glider mjukt när du byter flik. I drönarläget har den drönarens accentfärg.
  - Texten "Dashboard" ska rymmas helt i kapseln. Dashboard och Settings ska ha lika stora kapslar som följer barens rundade ändar (spegelvänt), och flikarna ska vara jämnt fördelade. Kolla gärna även på en smal telefon (SE/mini).
  - **B-loggan** ska ligga centrerad i kapseln och öppna Log flight. Tryck även nära kanten av Logbook-ikonen: den ska öppna Logbook, inte Log flight.
  - **Sista raden** i varje lista ska gå att rulla fram ovanför baren, så att inget fastnar bakom glaset. Testa längst ner i loggboken, Settings, Insights och dashboardens global map-meny.
  - **Rundturen:** steget "Log a flight" ska fortfarande ge B-loggan en cyan ram, och info-kortet ska ligga ovanför baren.
  - **Byte pilot ↔ drönare:** baren ska byta flikar direkt, utan tom eller felplacerad kapsel.
- [ ] **Extra kryptering som val (Settings → App → Encryption):**
  - **Uppgradering först:** installera bygget ovanpå nuvarande TestFlight-version, utan att radera appen. Reglaget "Extra encryption (AES-256)" ska stå på, och all data ska finnas kvar.
  - **Slå av:** en dialog ska förklara att inget raderas. Sedan visas "Removing extra encryption…", därefter en bock och reglaget av. Rubriken ska byta till "Protected by iOS". Kontrollera flygningar, flotta och böcker, starta om appen och kontrollera igen.
  - **Slå på:** dialogen ska varna att loggboken inte går att öppna om nyckeln försvinner, och den nämner iCloud Sync. Sedan visas "Encrypting your logbook…" och en bock. Data ska finnas kvar, även efter omstart.
  - **Spinnern ska snurra** under konverteringen (UI:t fryser inte). Med full flygplatsdatabas bör det ta några sekunder.
  - **Avbrott:** stäng appen hårt mitt i konverteringen. Vid nästa start ska loggboken vara hel, i det gamla eller nya läget. Slå sedan av och på igen.
  - **Ny installation** (radera appen först): reglaget ska stå av. Onboardingens säkerhetssida ska säga "protected by iOS — with optional AES-256 encryption".
  - **iCloud, på:** ta en backup och återställ på en annan enhet eller efter ominstallation. Data ska komma tillbaka, och reglaget ska slås på av sig självt.
  - **iCloud, av:** gör samma sak med reglaget av. Data ska komma tillbaka, och reglaget ska förbli av.
  - **Reglaget är låst** medan en iCloud-backup pågår, med texten "Wait for the iCloud backup to finish…".
  - **Rundturen:** säkerhetssteget öppnar Encryption och lägger en cyan ram runt reglaget utan att trycka på det. Kortet heter "Your data stays yours".
  - **Inställningsraden** heter "Encryption" med "Protected by iOS · optional AES-256", i både pilot- och drönarläge.
- [ ] **Blades introduction – en hel flygning loggas (pilot):** starta rundturen från Settings → Blades introduction.
  - "Log a flight" ska öppna Log flight i Quicklog. I steget "Quicklog or Full" ska växlaren få en cyan ram och formuläret byta till Full.
  - Tryck på Next. Info-kortet ska bytas mot en smal rad längst ner med "LOGGING AN EXAMPLE FLIGHT", det som fylls i just nu och en tunn förloppslinje. Raden får aldrig skymma fältet som fylls i, inte heller i sökrutan eller Sun route.
  - Demon ska göra detta, med cyan ram eller "tryck" på varje del:
    - **Avgång:** ESSA skrivs tecken för tecken, flygplatsen hittas och off-block-tiden fylls i.
    - **Ankomst via sök:** sökknappen trycks och "LANDVETTER" skrivs i sökrutan utan att tangentbordet visas. Träffen trycks, sedan ICAO-knappen ESGG (inte GOT). Därefter fylls on-block-tiden i.
    - **Uträknat:** total, distans och natt växer fram.
    - **Stops / via:** chippet trycks och "Choose type" → "Hot refuel" väljs. ESOE skrivs och Add trycks. Stoppet ska synas mellan ESSA och ESGG, och distans och natt räknas om.
    - **Sun route:** sol-globen trycks och kartan spelar upp flygningen. Man ska se dag → skymning → natt, och bildtexten ska byta till "Night falls at HH:MM UTC — the landing at ESGG is in darkness". Kartan stängs efter cirka 11 s.
    - **Flight rules:** Y/Z trycks. I villkoren dras IFR till 60 % och VFR blir 40 %. Natt-baren ska visa cirka 30 %.
    - **Farkost, roll och andrepilot.**
    - **Starter/landningar:** Take-offs Day 2, Landings Day 1 och Night 1 (stoppet + nattlandning i ESGG).
    - **Approach:** 3D → ILS → ILS → RWY 21 vid ESGG trycks i tur och ordning. ESGG ILS 21 ska hamna i remarks.
    - **Remarks** skrivs, och till sist trycks Save.
  - Remarks ska innehålla "Example flight · Blades introduction", "ESOE HR", "ESGG ILS 21" och andrepiloten.
  - **Egen farkost och andrepilot** ska användas om de finns. Rutten är alltid ESSA → ESOE → ESGG.
  - **Ny profil:** AT72 SE-MKG med Anna Berg. Helikopterprofil: H145 SE-HEM.
  - Tiden ska alltid ligga i går eller i dag, aldrig i framtiden. Starten ska vara före mörkret, och flygningen ska avslutas i mörker.
  - **Övergången till loggboken ska gå lugnt:**
    - "Saved" syns en stund.
    - Loggboken visas cirka 1,5 s.
    - Den nya raden överst får en cyan ram i cirka 2 s, sedan trycks den och översikten öppnas.
    - Info-kortet ska säga att flygningen ligger överst under sitt år och sin månad.
  - Gratiskonto med 20 flygningar: ingen Premium-popup ska visas under rundturen.
  - Exempel-flygningen ska vara borta efter Done i checklistan, efter Skip (även mitt i demon) och efter att appen startats om mitt i rundturen. Gratispotten ska vara orörd.
  - Back från "Your logbook" ska köra demon igen, utan att den gamla exempel-flygningen blir kvar.
- [ ] **Blades introduction – ett helt pass loggas (drönare):**
  - Demon ska fylla i:
    - mission, plats och starttid
    - 1st flight 0:25, sedan trycks "Add 2nd flight" och 0:18 fylls i
    - siktläge: BVLOS-baren dras till 70 %, VLOS får 30 % och växlaren byter till BVLOS
    - drönare och pilot function
    - besättning, t.ex. Erik Lind som Observer
    - operation, 2 landningar och max höjd (360 ft eller 110 m)
    - remarks, och sedan sparas passet
  - Det sparade passet ska ha kategorin Specific. Detaljvyn ska visa "VLOS 0:13 · BVLOS 0:30" (eller motsvarande 30/70).
  - Utan egna drönare ska exempeldrönaren Mavic 3 Enterprise (SE-D001) användas. Den ska försvinna när rundturen slutar, även ur Fleet och Manage drones.
  - Loggbokens Flights-flik ska fälla ut rätt månad. Raden ska få en ram, tryckas och sedan ska passets översikt öppnas, i samma lugna tempo som för piloten.
- [ ] **Drönarens Insights:**
  - **Currency → i-knappen** till höger om rubriken ska öppna en ruta som förklarar Current/Stale (90 dagar) och kategorierna A1, A2, A3, Specific och Certified. Tryck utanför eller på ✕ för att stänga.
  - **By category / By flight mode:** timmarna och "h" ska stå på en rad, även för t.ex. 224:53 och 427:49. Staplarna ska vara lika långa på alla rader.
  - **Activity:** en streckad vågrät linje ska gå genom staplarna på snitthöjden (flygningar per månad under de 12 månaderna), med etiketten "AVG x.x" i högerkanten.
  - **Rundturens drönarpass** (kategori Specific) ska räknas in under Specific i By category och Currency.
- [ ] **Uppdaterad flygplatsdata (2026-10-26):**
  - **Första start efter uppdateringen:** flygplatsdatabasen läses in på nytt, vilket tar några sekunder. Appen ska starta normalt och dina flygningar ska se ut som förut.
  - **Nya koder:** skriv UZTT (Tashkent), OKKK (Kuwait) och VNPR (Pokhara) i Log flight. De ska få grön bock och rätt namn, och koden du skrev ska stå kvar i loggboken.
  - **Sökrutan:** sök "UZTT". Tashkent ska visas som UZTT och fyllas i med UZTT.
  - **Ny flygplats:** VOVI (Visakhapatnam/Bhogapuram) ska gå att hitta.
  - **Frekvenser:** CYVR (Vancouver) ska visa TWR 118.7 (inte 23.66) och LTFJ (Sabiha Gökçen) TWR 118.8.
  - **Banor:** EDDW (Bremen) ska ha 08/26 i stället för 09/27.
  - **Stängda fält:** EGBE (Coventry), EICM (Galway) och ESSK (Gävle) ska inte synas på kartan med standardfiltret. Gamla flygningar dit ska fortfarande visa plats och namn.
  - **Nya IATA-koder:** DJT ska ge Palm Beach (KPBI), RMO Chișinău (LUKK), BSZ Bishkek Manas (UAFM) och GNJ Ganja (UBBG). De gamla koderna PBI, KIV, FRU och KVD ska inte längre ge träff.
  - **Global map → info-knappen (Airport data):** det ska stå "Last updated: 26 October 2026", och källorna airportmap.de och OurAirports ska nämnas.
- [ ] **Frekvenserna på flygplatskorten:**
  - **Find airport och global map → flyg till en flygplats** (t.ex. EDDV): TWR, GND, ATIS och APP ska stå i egna kolumner med en tunn vertikal linje emellan. Långa frekvenser som 121.955 och 136.575 får inte gå ihop.
  - **Kartornas vanliga infokort** (tryck på en flygplatsnål): frekvenserna ska stå två och två, t.ex. "TWR … │ GND …", med en linje emellan.
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
- [ ] **Delningskortet → Route-lagret:** lagret ska finnas igen, med satellitbilder runt flygplatserna och den lilla inbrända texten "Powered by Esri · Source: …". Texten är nu hälften så stor; kontrollera att den går att läsa i den delade bilden.
- [ ] **Delningskortet → mindre förhandsvisning:**
  - Bilden eller videon ska vara cirka 20 % mindre, så att fler reglage syns under den.
  - Den delade bilden ska se exakt ut som förut, med samma textstorlek i förhållande till bilden.
  - Dra overlayn. Den ska följa fingret exakt och inte släpa.
  - Tryck i Max alt, Taxi eller postcard-texten. Förhandsvisningen ska krympa till en tumnagel och fältet synas ovanför tangentbordet.
  - Tryck på Done. Förhandsvisningen ska växa tillbaka.
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

**Från debug-kontrollen:**

- [ ] **Testa efter nytt bygge (debug-kontrollen):**
  - Skanna loggbok (gratiskonto) när skanningarna tar slut: Premium-betalväggen ska visas. Ingen "Buy"/"Top up" som ger skanningar gratis.
  - "Build logbook" när AI-gränsen nåtts: betalväggen för gratis, ett coin-besked för Premium.
  - Felmeddelanden från AI och import ska vara på engelska och utan tekniska detaljer.
  - Radera en drönare med flygningar: dialogen ska säga hur många flygningar som påverkas.
  - Settings → iCloud → slå på med en befintlig backup: texten ska säga att "Keep this device" ersätter backupen.
  - Delete everything: drönarfoton och -videor ska också försvinna.
  - Flygplansläge vid start: appen ska nå dashboard/onboarding inom några sekunder och inte fastna på en tom skärm.

**Småkontroller:**

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

## Senare

- [ ] **Ta bort den gamla Esri-nyckeln** (den som går ut 2027-01-24). Skriv "klart" till Claude in Chrome. Ops påminner 30 dagar innan.
- [ ] **Förnya Esri-nyckeln** före cirka 2027-10-26 (exakt datum i ArcGIS): skapa en ny och kör `cd proxy && npx wrangler secret put ARCGIS_API_KEY`, annars försvinner Route-lagret och satellitbilden på sajten. Ops påminner.
- [ ] **xlsx (Excel-import):** npm-versionen har kända brister och underhålls inte längre på npm. Byt till SheetJS egen version, `npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`, och testa sedan Excel-importen.
- [ ] **Loggboken i hh:mm-läge:** fyrsiffriga totaler (t.ex. 1049:00) klipps i smala kolumner som IFR. Sajtens demokopia har en CSS-fix, men appen har det inte.
- [ ] **iCloud:** testa återställning på en annan enhet.
- [ ] **Flygplatsdatabasen:** verifiera cirka 4 000 äldre poster mot OurAirports, och radera inget i blindo.

## Bra att veta

- **Rättningar utan granskning (EAS Update):**
  1. Ett fel syns i Ops, och du skickar det till Claude.
  2. Claude rättar, committar och publicerar till testkanalen.
  3. Du provar i TestFlight-appen och skriver "publicera".
  4. Alla får rättningen vid nästa start.
  - Det gäller bara rättningar och små förbättringar. Nya funktioner, behörigheter och inbyggda moduler går som vanlig uppdatering.
  - Ändringar i `eas.json`, `.gitignore`, ikoner eller inbyggda bibliotek ger en ny runtime-version. Då når rättningar bara nya byggen. Claude kontrollerar det.
- **Deployregler:** hemsidan deployar Claude själv med `./deploy-website.sh`. Kör aldrig `… pages deploy website`, det är den gamla sajten. Proxyn deployas bara när du ber om det.
  - Sajten ska fortsätta utan cookies, analys och tredjepartstypsnitt, annars måste §11 i policyn ändras.
  - Sajten måste behålla sökvägarna `/privacy`, `/terms` och `/support`, eftersom appen och App Store länkar dit.
- **När AI-krediten fylls på:** uppdatera `OPS_CREDIT_USD` och `OPS_CREDIT_SINCE` i `proxy/wrangler.toml` och deploya proxyn, annars blir "Kvar av krediten" fel.
- **Modellbyte utan deploy** (nödspak, behövs normalt inte): `npx wrangler kv key put --binding=QUOTA_KV model-map '{"<gammalt-id>":"<nytt-id>"}' --remote`. Ångra med `npx wrangler kv key delete --binding=QUOTA_KV model-map --remote`.
- **Larmmejl från Ops** som hamnar i skräpposten: markera dem som "Inte skräppost".
- **"What's New in This Version" i App Store Connect** visas i appens uppdateringspopup.
  - Skriv en rad per nyhet och börja med `New:`, `Fixed:` eller `Improved:`. Då får raden rätt etikett.
  - Popupen visar de tre första sådana raderna, och "And more fixes and improvements." om det finns fler. Ta texterna från What's New i CHANGELOG.md.
  - Exempel: `Fixed: Logbook totals in the EASA AMC1 layout now fill every column.`
- **Visa popupen i dev-builden igen:** sätt `DEV_SIMULATE_UPDATE` till `true` i `FlightLogApp/store/versionStore.ts`. Det påverkar aldrig riktiga byggen.

## Arkiv (klart)

- 2026-10-31 · Blades Ops v4 deployad:
  - fasta siffror överst (prenumeranter, nedladdningar hittills, MRR)
  - "Fråga Claude"
  - hopfälld uppgiftsruta
  - testfel filtreras bort
  - automatisk omladdning efter deploy
- 2026-10-31 · Blades Ops v3 deployad: felrapporter med "Skicka till Claude" och assistenten "Fråga Claude". EAS Update uppsatt i koden.
- 2026-10-28 · 1.0 (bygge 14) inskickad till App Review tillsammans med Blades Premium Monthly (39 kr / 2,99 USD), med manuell release.
  - Klart i samma veva: Content Rights, granskningsanteckningar, beskrivning, åldersgräns 4+, 175 länder, skärmdumpar och nyckelord.
  - App Store Server Notifications går till RevenueCat.
- 2026-10-28 · Blades Ops live: grafer, timbevakning med larmmejl, uppgifter till Claude, SessionStart-hook och support@ via Workern.
- 2026-10-28 · www.blades-app.com skickar vidare till blades-app.com (301).
- 2026-10-28 · Verifierat på bygge 14:
  - SQLCipher via CommonCrypto: uppgradering med kryptering, all data kvar.
  - AI-samtycket.
  - Sentry: sessioner, 100 % kraschfria.
- 2026-10-27 · App Privacy publicerad (Crash Data, inte kopplad). Sentry-konto och projekt i EU.
- 2026-10-27 · Export compliance: SQLCipher via Apples CommonCrypto (patch i `FlightLogApp/patches/`), och `ITSAppUsesNonExemptEncryption: false`.
- 2026-10-27 · AI-samtycke (5.1.2(i)). Integritetspolicy och supportsida uppdaterade. Licenser och källhänvisningar (Acknowledgements). Död kod borttagen.
- 2026-10-27 · Proxyn: AI-svar utan tankeblock för 5.5-modellerna, och webbplatsens flygplatskort (`/web/imagery`).
- 2026-10-27 · Nya sajten publicerad, Bot Fight Mode avstängd.
- 2026-10-26 · Proxyn: modellbyte till 5.5 med automatisk uppgradering, debug-kontrollen och Esri-nyckeln.
- 2026-10-18 · Proxyn deployad. RevenueCat (paywall, Customer Center, promokoder). Jordgloben inbäddad i appen.
- Bekräftat av skärmdumpar tidigare: pilotimportens totaler, drönarglobens platser, och starttider och COM/PRI i drönarloggboken.
- Lanseringslistans fullständiga text finns i git-historiken för `LAUNCH-TODO.md`.
