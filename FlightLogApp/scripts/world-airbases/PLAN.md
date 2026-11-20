# Världens flygbaser: plan och läge

Startad 2026-11-19. Samma metod som Europa (scripts/eu-airbases), men **utan Scramble.nl** (användarens beslut)
och bara öppen information. Ukraina tas inte med (OPSEC).

## Så fortsätter man efter ett avbrott

1. `ls raw/`: varje färdigt land har en fil `<grupp>__<ISO2>.json`.
2. För varje grupp nedan med länder som saknar fil: starta en agent med uppdraget
   "Read and follow the brief at …/scripts/world-airbases/brief.md. Your group: `<grupp>`. Countries: …"
   (agenten hoppar själv över länder som redan har en fil). En US-grupp har en enda fil, `<grupp>__US.json`;
   om sista radens note innehåller `"partial": true` ska gruppen köras om med uppdraget att fortsätta den filen.
3. När allt finns: sammanställ som Europa (compile.py i scratchpad/eu-bases → flygbaser_världen.csv/.xlsx per
   förbandsland), bygg assets/world-airbases.json och slå ihop i utils/milAirbases.ts (s: 'world').

`raw/eu-abroad__ALL.json`: europeiska förband utanför Europa (Mount Pleasant FK, NL på Fort Hood) ur Europa-sökningen.

## Grupper

| Grupp | Länder |
|---|---|
| usaf | US: USAF active duty, flygande förband i de 50 delstaterna och territorierna |
| usang | US: Air National Guard och Air Force Reserve, flygande förband |
| usnavy | US: Navy och Marine Corps air stations i USA och territorierna |
| usarmy | US: Army aviation-flygfält i USA och Coast Guard air stations |
| usabroad | US: fast baserade flygförband utanför USA och utanför Europa (Japan, Sydkorea, Diego Garcia, Djibouti …) |
| namerica | CA MX GT BZ SV HN NI CR PA CU DO HT JM TT BS BB |
| samerica | BR AR CL PE CO VE EC BO PY UY GY SR |
| mideast | IL JO LB SY IQ IR SA AE QA BH KW OM YE |
| southasia | IN PK BD LK NP AF |
| centralasia | GE AM AZ KZ UZ TM KG TJ MN |
| africanw | EG LY TN DZ MA MR SN ML NE BF TD NG GH CI CM GA CF GN SL LR TG BJ GM GW CV GQ CG |
| africase | ET ER DJ SO SD SS KE UG TZ RW BI CD AO ZM ZW MW MZ NA BW ZA LS SZ MG MU SC KM |
| china | CN KP |
| eastasia | JP KR TW |
| seasia | ID MY SG TH VN PH MM KH LA BN TL AU NZ PG FJ TO |

## 2026-11-20: kontroll mot källorna (obligatorisk före sammanställning)

Första omgången skrev många rader ur minnet (flyttade till raw/_from-memory/, används INTE). Sedan dess kräver
briefen `urls` på varje rad, och `verify.py` hämtar sidorna och:
- behåller raden bara om basnamnet/ICAO står på sidan,
- behåller bara förband och typer som står på en sida om basen, eller nära basnamnet på en listsida (WINDOW),
- skriver bortrensade rader till _rejected.json.
Kör: `python3 -I verify.py raw <ut> <cache>` och sammanställ BARA ur <ut>.
ICAO-koder från agenterna ska kontrolleras mot OurAirports (land + namn) i sammanställningen innan de används.

## Läge 2026-11-20

Alla 15 grupper klara (omgång 2 med källkrav). verify.py: 924/956 rader godkända. compile.py → flygbaser_varlden.csv/.xlsx:
873 baser, 107 förbandsländer, 758 med plats på kartan (OurAirports via kod/namn; sammanslagningar.txt visar rader som
hamnat på samma flygplats, alla granskade). bortrensade.json = rader som inte klarade kontrollen.
Luckor (ingen källa angav bas): JM BS GY SZ FJ TL TO SL CF CG GM CV. Inte med: UA (OPSEC), SY YE AF (inga nuvarande förband i källorna).
Kvar före appen: build-world-airbases.mjs (som build-eu-airbases.mjs, roller för fler typer), s:'world' i utils/milAirbases.ts,
världstext i Source-rutan.
