# Brief: Airport Info from the Swedish AIP (official source)

You turn the official AIP text of Swedish aerodromes into the data for the app's "Airport Info" card.
The user's rule: **no false information**. Use ONLY the text in the files you are given
(`aip/<ICAO>.txt`, sections AD 2.2, 2.3, 2.4, 2.20 of the current AIP). Do not use your own knowledge, do
not search the web, do not guess. If the text does not say something, leave it out (or use "unknown").

**Every value needs a `quote`: a short passage copied EXACTLY (character for character) from the file
that supports it.** A script checks each quote against the file and drops anything whose quote is not
found. Keep quotes short (one line or phrase), copied verbatim — do not fix spelling or spacing.

## Output: one JSON file per batch

Write `raw/aip-<batch>.json` (path given in your task) as a JSON array, one object per aerodrome:

```json
{
  "icao": "ESSA",
  "source": "AIP Sweden AD 2 ESSA",
  "ppr": {
    "status": "required | not_required | partial | unknown",
    "note": "short English, e.g. 'VFR traffic: PPR required' or 'GA: 24 h before'",
    "phone": "+46 8 585 544 50 (if the text gives a PPR phone)",
    "request_url": "a URL the text gives for PPR requests, else empty",
    "quote": "PPR for all VFR traffic TEL +46 8 585 544 50"
  },
  "fuel": {
    "types": ["JET A-1", "AVGAS 100LL"],
    "note": "short, e.g. 'Truck', 'Self-service', 'Military only', 'On request'",
    "hours": "fuelling hours as written, e.g. 'H24' or 'MON-FRI 0600-1600 (0500-1500)'",
    "quote": "verbatim passage naming the fuel types"
  },
  "hours": {
    "ad": "aerodrome operating hours as written in 2.3 (e.g. 'H24', 'MON-FRI 0600-2000 (0500-1900)')",
    "note": "anything short that matters (e.g. 'Outside hours: PPR'), else empty",
    "quote": "verbatim"
  },
  "contacts": [
    { "label": "Aerodrome operator | Tower | PPR | Fuel service | Handling | Briefing (FPC) | …", "phone": "+46 …", "quote": "verbatim" }
  ],
  "email": { "value": "…", "quote": "verbatim" },
  "website": { "value": "www.… (as written)", "quote": "verbatim" },
  "good_to_know": [
    { "text": "short English sentence a pilot should know (restrictions, who may land, PPR conditions, training bans, noise rules, military-only, slot required, closed periods)", "quote": "verbatim passage it is based on" }
  ]
}
```

Rules:
- Times in the AIP are UTC; summer times are in parentheses. Copy them as written — do not convert.
- `contacts`: only numbers the text clearly attributes (operator, PPR, fuel, handling, ATS/tower,
  briefing). Label them by what the text says they are for.
- `good_to_know`: at most 4 items, the most useful for a visiting pilot, from AD 2.20 mostly (and 2.2
  remarks). Plain, short English. Each must be fully supported by its quote — no added facts.
- Omit a field (or use `"status": "unknown"`) when the text does not cover it.
- When done, reply with: aerodromes done, and any that were hard (e.g. text unclear). Under 100 words.
