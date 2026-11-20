# Brief: Airport Info for small Swedish airfields (own websites)

You collect data for the app's "Airport Info" card for small Swedish airfields that are not in the AIP.
The user's rule: **no false information**. Never write anything from your own knowledge, never guess.

## Allowed sources (only these)
- The airfield's **own** website: the operator, the flying club that runs the field, or the municipality /
  company that owns it. Find it with WebSearch (e.g. "<name> flygfält", "<name> flygklubb fältinfo") or the
  `home_link` given in the list. Check that the page is really about THIS airfield.
- Not allowed: forums, Wikipedia, aggregator/directory sites, social media posts, other clubs' pages.
- Must be **current**: skip a page that is clearly outdated (e.g. says "2019 season", or the field is closed).
  If the page states a date ("updated 2026-04-02"), put it in `as_of`.

Use WebSearch (mode "standard") and WebFetch (load them with ToolSearch `select:WebSearch,WebFetch` if not in
your tool list). Budget: about 3–5 tool calls per airfield. If you find no own website, or it has none of the
fields, write the airfield with `"status": "no_source"` and move on.

## Every value needs `url` + `quote`
`quote` = a short passage copied EXACTLY from that page (Swedish as written; do not translate the quote).
`url` = the exact page it is on. A script fetches each url and drops values whose quote is not on the page.
The English `note`/`text` you write must say nothing the quote does not say.

## Output
Write the file given in your task as a JSON array (overwrite after every ~5 airfields), one object each:

```json
{
  "key": "ES-0012", "name": "…", "status": "ok | no_source",
  "website": { "value": "https://…", "url": "https://…", "quote": "…" },
  "ppr": { "status": "required | not_required | partial | unknown", "note": "short English", "phone": "", "request_url": "", "url": "", "quote": "" },
  "fuel": { "types": ["AVGAS 100LL", "MOGAS", "UL91", "JET A-1"], "note": "e.g. Self-service with card", "hours": "", "url": "", "quote": "" },
  "hours": { "ad": "as written, e.g. 'Dagsljus' or 'Sommartid helger'", "note": "", "url": "", "quote": "" },
  "contacts": [ { "label": "Field manager | Club | Fuel | PPR | …", "phone": "+46 …", "url": "", "quote": "" } ],
  "good_to_know": [ { "text": "short English (e.g. 'Grass runway, soft after rain', 'Glider activity weekends', 'Landing fee via Swish')", "url": "", "quote": "" } ],
  "as_of": ""
}
```
- Omit fields the source does not give. At most 4 `good_to_know` items, the most useful for a visiting pilot.
- Phone numbers only when the page says what they are for (label them by that).
- When done, reply with: airfields done, how many with a source, and any problems. Under 100 words.
