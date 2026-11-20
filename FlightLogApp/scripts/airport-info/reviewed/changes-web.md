# Fact-check changes (web-1..5)

- **ESNP** `fuel.types`: ['MOGAS'] -> ['AVGAS 91']  
  Reason: Text says "AVGAS 91 available on request", not MOGAS
- **ESNP** `ppr.note`: PPR 1 Oct - 30 Apr due to irregular snow clearing; use email or SMS/WhatsApp; check NOTAM for closures -> PPR 1 Oct - 30 Apr due to irregular snow clearing; preferably email or SMS/WhatsApp; check NOTAM for temporary closure due to other activity  
  Reason: "Preferably" email/SMS; NOTAM remark is about temporary closure
- **ESNP** `contacts[0].label`: Airport manager -> Airport manager / PPR contact (email or SMS/WhatsApp preferred)  
  Reason: Page lists number after "airport manager ... preferably email or SMS/WhatsApp" next to PPR address; not explicitly the manager's own number
- **ESGE** `fuel.note`: Self-service with Visa/Mastercard. AVGAS 100LL and Jet A1 listed as temporarily unavailable -> Self-service for 91/96 UL, attendant when needed; credit card Visa/Mastercard (not Carnet). AVGAS 100LL and Jet A1 listed as not available at present  
  Reason: Card payment/self-service wording made exact; "temporarily" -> "at present" (ej tillgängligt för tillfället)
- **ESGE** `hours.ad`: Mon-Thu 07-22, Fri 07-20, Sat-Sun/holidays 08-20 (Jun-Aug 08-18) local time -> Mon-Thu 07:00-22:00, Fri 07:00-20:00, Sat-Sun and holidays Sep-May 08:00-20:00, Jun-Aug 08:00-18:00 (local time)  
  Reason: Season for weekend hours made explicit
- **ESGL** `fuel.note`: Jet A1: contact the airport; see source for flying-club contact -> Page text: "Avgas 100LL BP 91/96 - contact the motor flying club; for Jet A1 contact the airport"  
  Reason: Original implied flying-club contact only for Jet A1/unstated; text is ambiguous so reproduced
- **ESGL** `good_to_know`: Touch-and-go practice only 07:00-19:00 local time -> Take-off and landing practice allowed 07:00-19:00 local time; in darkness only on non-holiday Tuesdays 19:00-21:00 local time  
  Reason: "Only 07-19" omitted the night exception; "touch-and-go" -> "start och landningsövningar"; quote extended with adjacent sentence
- **ESNC** `good_to_know`: Restaurant on site, open three days a week (Thu-Sat in summer) -> Restaurant on site, open three days a week; Thu-Sat in summer from mid-June, and at larger events  
  Reason: Added exact season wording (from mid-June, larger events)
- **SE-0011** `fuel.note`: Pay cash, Swish or prepay. 27 SEK/l non-members, 24 SEK/l members (updated 2026-10-01) -> Pay cash, Swish or prepayment. 27 SEK/l non-members, 24 SEK/l members (updated 2026-10-01); prices may change at short notice  
  Reason: Added page caveat that prices may change at short notice; "prepay" -> prepayment
- **SE-0011** `good_to_know`: Seaplane base with room for four aircraft at the dock and one at the ramp -> Flying harbour (flyghamn) has room for four aircraft at the dock and one at the ramp  
  Reason: "Seaplane base" not stated on the quoted page; text says flyghamn
- **ESSM** `good_to_know`: Advanced (aerobatic) flying takes place over the field -> Advanced flying takes place over the field; communicate carefully on the radio  
  Reason: "aerobatic" not in text (avancerad flygning)
- **ESTF** `ppr.note`: PPR via Lars or Roland; field soft after rain -> PPR: call Lars or Roland (call for field check); field soft after rain  
  Reason: Text: "ring för fältkontroll"; note: page also says field is closed all 2026 (time-bound, expires end of 2026)
- **ESME** `good_to_know`: Event-day instruction: taxi via A towards Flightline and wait for a place assigned by an official -> (deleted)  
  Reason: Time-bound air-show/family-day instruction (NOTAM dates 2024-06-29) on page, outdated
- **ESSN** `ppr.note`: PPR required for night landings (fee 100 SEK) -> PPR required for touch-and-go circuits (TGL) in darkness; fee 100 SEK  
  Reason: TGL = circuit training, not night landings; status kept "partial" (only some activity)
- **ESSN** `hours.ad`: No landings 22-07 LT weekdays and 19-09 LT weekends -> (removed; moved to good_to_know as "No touch-and-go circuits (TGL) 22-07 LT weekdays, 19-09 LT weekends")  
  Reason: Quote says "Inga TGL" (no circuits), not "no landings"; not aerodrome opening hours
- **SE-0059** `good_to_know`: Activity on most holidays in season, weather permitting; call the field first to check someone is there -> (deleted)  
  Reason: From news post dated 10 June 2013 (outdated); also summary added "weather permitting"/"most holidays in season" beyond quote
- **ESKV** `fuel.note`: Avgas UL91 listed under fuel price -> Page lists "Avgas UL91"  
  Reason: "listed under fuel price" not in text
- **ESSG** `contacts.label`: Airport manager (Ludvika Flygplatsförening) -> Ludvika Flygplatsförening (Stefan Enberg)  
  Reason: Page lists Stefan Enberg under the airport association, not as "airport manager"
- **ESSW** `fuel.note`: Card payment at pump (Visa/Mastercard) -> Automated fuel, Visa/Mastercard  
  Reason: "at pump" not in text ("Automat")
- **SE-0047** `ppr.status/note`: required / Must phone before landing for information -> unknown / Must phone before landing for more information (page does not use the term PPR)  
  Reason: Text requires a call before landing but never says PPR

## Flags (no change made)
- ESTF: page says field closed all of 2026 and no fuel in 2026 season; items are correct now but expire after 2026-12-31.
- ESMG: fuel info from a page whose post is dated 2018 (footer 2022); ESQO page updated 2023-04-21; ESSE page footer 2022; ESNY as_of 2025-10-28; ESVM page updated 2025-06-14. Kept because nothing is season-bound, but treat as less fresh.
- ESUE, ESMC, ESNY: PPR "required" kept; text states PPR with no exception for visitors.
- ESSZ: PPR left "unknown" (page says both PPR and PN).
