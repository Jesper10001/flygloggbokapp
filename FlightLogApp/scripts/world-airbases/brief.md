# Brief: world military air bases (open sources)

You are compiling an open-source list of military air bases for the map layer of an aviation logbook app
(Global map → Air Bases → Specific). Europe and Russia are already done. Your group's countries are given in
your task message.

## What to list

For each country in your list: every military air base, air station, naval air station or army aviation
airfield that **today (2025–2026)** is the permanent home of that country's own flying units (air force,
navy, army, marines, military coast guard, gendarmerie air units). For each base: the flying units based
there and the aircraft types they fly.

Also include **permanently based foreign flying units** in your countries (operator = the foreign country),
except United States units (another group covers those, unless your group *is* a US group).

Skip: bases that only host ground or non-flying units; closed bases; temporary deployments, rotations,
exercises and detachments; civil airports with no based military flying unit.

## Never from memory (most important rule)

**Every row must rest on pages you actually fetched in this run** (WebFetch, or curl of the Wikipedia page).
Writing rows from your own knowledge is forbidden — even as a "first pass", even when time or the usage
limit is short. A short file of verified rows is worth far more than a long file from memory. Each row gets
`"urls"`: the exact page URL(s) you fetched that name **this base together with its unit or aircraft**.
A verification script fetches every URL afterwards and **drops rows whose base name does not appear on the
cited page**, so a row without a real, matching URL is wasted work.

If WebSearch or WebFetch is not in your tool list, load them first with ToolSearch, query
`select:WebSearch,WebFetch`. If they still do not work, fetch Wikipedia wikitext with curl
(`curl -s -A "BladesBaseResearch/1.0" "https://en.wikipedia.org/w/index.php?title=<Title>&action=raw"`).
If no way of fetching works, stop and say so — do not fall back to memory.

## Safety rules (must follow)

- **Do not use Scramble.nl** or any subscription/paywalled order-of-battle source (Scramble, Janes, IISS
  Military Balance tables, Forecast International, etc.). Do not try to get around a paywall or block.
- **Skip Ukraine entirely** (no bases in Ukraine, no Ukrainian units anywhere).
- For countries at war or in civil war (e.g. Sudan, Myanmar, Yemen, Syria, Israel, Iran, Libya), list only
  long-established home bases as published in encyclopedic or official sources. Never search for or include
  current wartime positions, dispersals, strike-related deployments, battle damage or movements.
- Do not invent anything. If a detail is uncertain, leave it out or put it in `note`.

## Sources (open information only), in order of preference

1. English Wikipedia (lists such as "List of … Air Force bases", articles on each base, wing or squadron),
   and the native-language Wikipedia when it is better.
2. The country's air force / ministry of defence / navy / army official pages.
3. Other open publications: GlobalSecurity.org, official government documents, reputable aviation press
   (Key Aero, The Aviationist, Aviation Week open articles, FlightGlobal open articles), China Aerospace
   Studies Institute (CASI) open reports for China.

Use WebSearch (mode "standard") and WebFetch. Be efficient: prefer pages that list many units at once
(a Wikipedia "list of air bases" or an air force "units" page) over one page per squadron. Budget roughly
8–12 tool calls per large country and 2–4 per small one. A country with no military flying units: write an
empty array for it and move on.

## Output: one file per country, written as soon as that country is done

Write each country's result **as soon as you finish that country** (before starting the next), with the
Write tool, to:

    /Users/jespertoreld/Developer/flygloggbokapp/FlightLogApp/scripts/world-airbases/raw/<GROUP>__<ISO2>.json

`<GROUP>` is your group name and `<ISO2>` the operator country's ISO-2 code (for a US group: `US`). Before you
start a country, check whether its file already exists (`ls` the raw folder) — if it does and its rows have
`urls`, the country was done in an earlier run: skip it. A file whose rows lack `urls` (written from memory
on 2026-11-20) must be redone from sources and overwritten. This lets the work resume after an interruption. A US group that is cut short
writes what it has so far to its file and adds `"partial": true` in the note of the last row.

Each file is a JSON array; each element:

```json
{"operator":"JP", "base":"Misawa Air Base", "icao":"RJSM", "location":"JP", "region":"Aomori",
 "command":"Northern Air Defense Force", "units":["3rd Air Wing"], "aircraft":["F-35A"],
 "sources":["Wikipedia","JASDF"],
 "urls":["https://en.wikipedia.org/wiki/Misawa_Air_Base"], "note":""}
```

- `operator`: ISO-2 of the country whose units these are ("NATO" or "UN" for those).
- `base`: common English name. `icao`: ICAO code if it has one, else "".
- `location`: ISO-2 of the country the base is in. `region`: state/province/prefecture, English.
- `command`: higher command, short, English ("" if unknown).
- `units`: official unit names (English, or the official native name).
- `aircraft`: types as commonly written ("F-16C/D", "C-130J Hercules", "AW139", "Mi-17V-5", "J-20").
- `sources`: which sources the row rests on. `urls`: the pages you fetched (required, see above).
- `note`: anything uncertain or dated.

One element per base per operator country.

## Reply

When all your countries are done, reply with only: bases per country, and any problems (a source that
could not be fetched, a country you could not finish). Under 120 words.
