# Brief: tower / AFIS phone numbers for Swedish AIP aerodromes

You look up the telephone number to the **air traffic service unit** (control tower, TWR, or AFIS unit) at
Swedish aerodromes, for the app's AD info card. The user's rule: **no false information**. Never write a
number from your own knowledge, never guess, never combine digits from different places.

## What we want
A number a pilot can call to reach the **tower or AFIS unit itself** at that aerodrome (e.g. "TWR", "Tornet",
"Flygledningen", "AFIS", "Flyginformationstjänsten", "Watch supervisor", "ATS"). Not the airport switchboard,
not handling, not fuel, not PPR booking, not the national briefing office (FPC) — we already have those.
If the official page lists the tower number together with a purpose (e.g. "Tornet – endast PPR"), keep it and
say so in the label.

## Allowed sources (only these)
- The ATS provider's own website: LFV (lfv.se), ACR (acr-sweden.se / acr-aviation.com), AFAB / Aviation
  Capacity Resources, NAVIAIR, or whoever the AIP or aerodrome names as ATS provider.
- The aerodrome operator's own website (e.g. swedavia.se/…, the municipal airport's own site).
- LFV's eAIP / VFG pages (aro.lfv.se).
- Försvarsmakten (forsvarsmakten.se) for military aerodromes.
- NOT allowed: Scramble, Wikipedia, forums, aggregators/directories (e.g. airport-data, skyvector,
  ourairports, acukwik, flightradar), social media, other clubs' pages, cached/archived copies.
- Must be **current**: skip pages that are clearly outdated.

Use WebSearch (mode "standard") and WebFetch (load them with ToolSearch `select:WebSearch,WebFetch` if not in
your tool list). Search in Swedish and English (e.g. "<name> flygplats tornet telefon", "<name> TWR telefon",
"<name> AFIS telefon", "<ATS provider> <name> kontakt"). Budget about 3–5 tool calls per aerodrome; you MUST
actually search for every aerodrome before writing `no_source`.

## Every number needs `url` + `quote`
`quote` = a short passage copied EXACTLY from that page that contains BOTH the number and the words saying it
is the tower/AFIS (Swedish as written; do not translate the quote). `url` = the exact page. A script fetches
each url and drops entries whose quote is not on the page or whose number is not inside the quote.

## Output
Write the file given in your task as a JSON array (overwrite after every ~5 aerodromes), one object each:

```json
{ "key": "ESGJ", "name": "JÖNKÖPING", "status": "ok | no_source",
  "contacts": [ { "label": "Tower (TWR)", "phone": "+46 36 …", "url": "https://…", "quote": "…" } ],
  "searched": ["short note of what you checked when no_source"] }
```
- `label` in English: "Tower (TWR)", "AFIS", "Tower watch supervisor", plus a short purpose in brackets if the
  page gives one. At most 2 contacts per aerodrome.
- Phone exactly as written on the page (you may add +46 only if the page itself writes it that way).
- When done, reply with: aerodromes done, how many with a number, and any problems. Under 100 words.
