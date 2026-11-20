# Brief: landing and parking fees for Swedish airfields (Airport Info card)

The user's rule: **no false information**. Only the airfield operator's own published prices (price list /
"prislista" / "avgifter" page or PDF on the operator's or airfield's own website). No forums, directories,
old news, or your own knowledge. If you find no current price list: write nothing for that airfield.

For each airfield in your list (key, name, and a known website if any):
1. Find the operator's current price list (e.g. Swedavia "airport charges", municipal airport "avgifter",
   flying club "landningsavgift"). Use WebSearch (mode "standard") / WebFetch / Bash curl. Prefer the current
   year; skip pages that are clearly outdated (older than 2025).
2. Copy the quote from the RAW page text (curl -sL -A "Mozilla/5.0" "<url>" | sed -e 's/<[^>]*>/ /g' | tr -s ' \n'),
   not from a WebFetch summary. For a PDF, only use it if you can get its text verbatim; otherwise skip.

Output (JSON array, one object per airfield that HAS prices; overwrite the file every ~5 airfields):
```json
{ "key": "ESSB", "fees": {
    "landing": "from 640 SEK (MTOW ≤ 2 t)",      // short English, only what the source says
    "parking": "220 SEK/night",                  // omit if not stated
    "note": "excl. VAT; pay via Swish",          // omit if nothing
    "year": "2026",                              // year the list applies to, if stated
    "url": "https://…", "quote": "verbatim passage with the landing price" ,
    "quote_parking": "verbatim passage with the parking price (if parking given)" } }
```
Reply with: airfields with prices found, and problems. Under 80 words.
