# Handoff: BLADES — Insights page (redesign)

## Overview

A **redesign of the Insights surface** for the BLADES Joint Logbook app
(pilot-manned / fixed-wing & helicopter). Today the equivalent content lives
inside the Log tab as two swipe-carousels (flight-hours/month, 14-day rolling
load, "when will I reach X h", and the PPL/CPL/ATPL requirements) plus a totals
block and the DUAL/INSTR/NVG backfill modals. The redesign promotes Insights to
its **own tab** and reorganises everything into one clean, scrollable surface —
no hidden carousels.

**Important: this changes presentation only. Every number, rate, threshold and
calculation comes from data the app already computes — nothing new is invented.**

## About the design files

`source/` is a **design reference built in HTML / React + Babel** — a working
prototype of the intended look, motion and interactions. It is **not production
code**. Recreate it in the app's existing **React Native / Expo** stack, reusing
the real `Colors` tokens, fonts (Fraunces / JetBrains Mono / system), and the
existing data functions. Translate `<div>`/CSS → `View`/`Text`/`StyleSheet`,
inline SVG → `react-native-svg`, the scroll/snap bars → `ScrollView`
(`horizontal pagingEnabled`) or `FlatList`.

**Prototype-only scaffolding — do NOT port:** `insights/ios-frame.jsx` (fake
device bezel), `insights/tweaks-panel.jsx` + the `TweaksPanel` block in
`insights/app.jsx` (accent / monthly-chart-style explorer), and the
`injectAccent` CSS-variable helper (in RN the accent is just a colour constant).

## Fidelity

High-fidelity. Final colours, spacing, type, motion. Build on a ~393-pt-wide
screen; sizes in the source are CSS px at that width.

## File map (source/insights/)

| File | Contents |
|---|---|
| `shared.jsx` | `IN_C` palette, `IN_DATA` demo data + `haveFor`/`rateFor`/`forecast`, fonts, `IIcon` set, primitives (`Card`, `SectionHead`, `ProgressBar`, `Pill`). **Read this first** — the data shapes map 1:1 to app functions. |
| `charts.jsx` | All visualisations: `MonthlyBars` / `MonthlyLine` / `MonthlyHeatmap`, `LoadBars` / `LoadLine` / `LoadMonthHeatmap` (the 3D iso diagram), `JourneyChart`, helpers (`monthDailyHours`, `dailyHistory`, `isoWeek`, `monthlyBaseline`). |
| `sections.jsx` | The card components: `HeroTotals`, `ActivitySection`, `GoalCard`, `LicenceJourney` (+ `LicenceChart`), `HoursBank`. |
| `app.jsx` | Tab scaffold, scroll page assembly, missing-hours modal, `IN_DEFAULTS`, Tweaks (prototype-only). |

## The page (top → bottom)

A single vertical scroll on `Colors.background`. A plain "Insights" title, then:

### 1. Total flight time — `HeroTotals`
Compact card. Row 1: **Total** (big) + **This year** (YTD). Row 2: Last 3 / 6 / 12
months. Row 3: **Pick range** → opens a from/to stepper sheet; on Apply, the
"This year" cell is replaced by the chosen range's **dates + summed hours** (with
an ✕ to clear back to YTD). Sources: `getHourTotals()` / `sumSince()` for the
windows; the range query sums flights between two dates. No decorative glow.

### 2. Hours bank — `HoursBank`
All flight-time categories + landings. A **"Grouped" / "All"** toggle (Grouped
default):
- **Grouped**: labelled sections — **Roles** (PIC, Co-pilot, Dual, PICUS),
  **Special roles** (Instructor, Multi-pilot, NVG, Sim), **Rules & conditions**
  (IFR, Night, Cross-ctry), **Landings** (Total, Day, Night).
- **All**: flat compact 4-column grid of every category + a landings row.
- **Backfill missing hours**: a collapsible toggle (chevron) listing only the
  categories currently at **0 h** — each opens the app's existing guided
  fix-flow modal (DUAL / INSTR / NVG …). Keep those modals as-is.
Sources: `getHourTotals()` for every column, landing counts from stats.

### 3. Activity — `ActivitySection` (combines monthly + 14-day load)
One card, a **Heatmap / Bars / Line** segmented switch (Heatmap is default) that
drives BOTH charts in lockstep.

**Hours / month (top):**
- **Bars**: horizontally **scrollable back in time** (swipe). At the present the
  recent 12 months show a grey previous-year ghost beside each cyan bar and the
  legend shows both years; scrolling back hides the ghosts + grey legend dot +
  the gold average baseline, and the cyan legend label updates to the year most
  in view. Gold baseline = average of all flown months (`monthlyBaseline`).
- **Line**: cumulative hours this year (cyan) vs last year (grey), with elegant
  end-markers — accent marker shows current cumulative, grey marker shows last
  year's cumulative at the same point in the year; the two markers auto-offset
  (one above, one below its dot) so they never collide.
- **Heatmap**: a 2-row month×year grid with **‹ / › year-step arrows** (placed
  just left of the grey year label and right of the current-year label). Each
  cell is **tappable** → loads that month into the 3D diagram below and gets a
  gold active ring. The month containing the **year's busiest day** has a gold
  border; the month with the **all-time busiest day** has a purple border.

**14-day rolling load (below, same switch):**
- **Bars**: looks like the original 14-bar window but is **swipeable** to older
  14-day periods (snap pages). Present shows grey previous-period ghosts +
  baseline + dd/mm–dd/mm legend; swiping back hides those and switches the cyan
  label to a **week range** ("Week 21–22"). The footer combines a "← Swipe to
  scroll back" hint and "x% over/under annual baseline" on one line with a
  separator. Sum text = "x.xh this period" for the visible window.
- **Line**: cumulative over the 14 days.
- **Heatmap (3D)**: `LoadMonthHeatmap` — an **isometric 3D bar chart of the
  selected month**, each day a bar (height = that day's hours), viewed from the
  right. Calendar orientation (weekend Sat/Sun columns at the right of each
  row). Bars ≥1 h print whole-hours on the top face. Empty days are flat tiles —
  **weekends tinted red, weekdays white** — with the **ordinal date** (1st, 2nd,
  25th…) written in the top-right corner, rotated to sit flat on the tile face
  (as if hand-written). Back/forward month arrows step months. **Highlight
  bars** (one max per month — its single busiest day): **silver** = busiest day
  that month, **gold** = busiest day this year, **purple (glowing)** = busiest
  day ever. Tapping a bar opens a day popup (date, hours, that day's flights);
  tapping again calls `window.__openLogbookDay(date)` → see Wiring. The popup
  shows a record badge: "Most this month" / "Most this year" / "Most all time".

Sources: `getMonthlyHours()` (this/last year), `getStressHours()` →
`recent14` / `yearAvg14` for the load baseline & %, and per-day flight-hour sums
for the 3D month view (in the prototype these are synthesised by
`monthDailyHours` / `dailyHistory`; wire to real daily sums).

### 4. Experience & projections — `GoalCard`
A cumulative **hours-over-time journey** (`JourneyChart`): X = time, Y =
cumulative hours, solid accent line to a "now" dot. A **Total time / PIC time**
toggle swaps the series + rate. **Project forward** preset buttons (+500 / +1000)
draw a dashed gold projection from now to the goal with a forecast date + "Xh to
go · N mo at R h/mo".

**Custom** opens a multi-category target builder (e.g. a job's hour
requirements): a category dropdown — **Total, PIC, IFR, NVG, VFR-Night,
Multi-pilot, PIC + IFR, PIC + NVG, PIC + Night**, plus **"Other…"** which reveals
a second dropdown of all remaining logbook categories (Co-pilot, Dual, PICUS,
Night, Cross-country, Instructor, Sim) — a numeric hours field, and Add. Each
target becomes a chip; below, a multi-curve projection chart (like the licence
chart) shows one curve per category with completion circles + dates.

> **Combined categories are INTERSECTIONS, not sums.** "PIC + Night" = hours
> flown that were *simultaneously* PIC **and** night — its own logbook measure,
> not PIC-hours + night-hours. In the prototype these live in
> `IN_DATA.combos` (`{have, rate}`); in the app, compute each as a query over
> flights where both conditions hold. `haveFor`/`rateFor` in `shared.jsx` show
> the contract.

Forecast math = `forecast(remaining, ratePerMonth)` using
`getAdaptiveRates()` (how long the pilot has logged + recent pace).

### 5. Licence journey — `LicenceJourney`
Focuses on the **next licence** the pilot is working toward (ATPL in the demo),
shown large with per-requirement progress bars (have/req h + forecast date).
Completed licences (PPL, CPL) collapse behind a "Show completed" toggle.

A **List / Chart** button (right of "Next licence") swaps the bars for a
**time-series chart** (`LicenceChart`): X = years, Y = progress, a gold dashed
TARGET 100% line (label top-left), a NOW marker, one colored curve per
requirement. Met requirements stop at a filled circle on the target line at the
date achieved (the curve does **not** continue past it); unmet requirements run
to now then dash-project to a hollow circle at the forecast date. A legend lists
each requirement with **have/req hours** (e.g. "989/1500h") + date ("✓ DD/MM/YY"
met, "→ DD/MM/YY" projected). Requirements at 0 h are not plotted.

Sources: the EASA PPL/CPL/ATPL hour tables the app already encodes
(`IN_DATA.licences`), values via `getHourTotals()`, rates via
`getAdaptiveRates()`.

## Wiring the app needs to provide

- `window.__openLogbookDay(date)` (prototype hook) → in the app, **navigate to
  that day in the logbook** (filter the logbook list / open the day). The 3D
  heatmap calls it on the second tap of a day bar (first tap shows the popup).
- The guided **backfill modals** (DUAL / INSTR / NVG) already exist — wire the
  Hours bank "Add" rows to them unchanged.
- The range picker's Apply should run the existing date-range hour sum.

## Design tokens (Navy theme — `constants/colors.ts`)

| Token | Value | Use |
|---|---|---|
| background | `#0A1628` | screen |
| (deep) | `#06101E` | chart/scrim backdrops |
| card | `#102441` | cards |
| surface / elevated | `#0F1E3A` / `#16314E` | rows, toggles, tiles |
| separator | `#122030` | dividers / bar tracks |
| **accent (primary)** | **`#00C8E8` cyan** | lines, bars, active toggle, markers. Tweakable (cyan/gold/mint/blue) |
| gold | `#FFB830` | baselines, target line, year-record ring, gold highlight bar |
| purple | `#A855F7` | all-time-record ring + glowing highlight bar |
| silver | `#C8D2DE` | month-record highlight bar |
| success / warning / danger | `#00E8A0` / `#FFB830` / `#FF6B5B` | met / over-pace / stale & under |
| weekend tile | red tint | empty weekend day tiles in 3D heatmap (weekdays = white) |
| text / text2 / text3 / muted / faint | `#FFFFFF` / `#A8BFD6` / `#7FA8C8` / `#5A7FA0` / `#3A5A7A` | text ramp |

**Type:** Fraunces (serif display — hero numbers, titles), JetBrains Mono (data —
values, labels, dates, axis ticks), Inter / SF (body). All already loaded.

## Data-source cheat-sheet (invent nothing)
`getHourTotals()` (every category + total), landing counts, `getMonthlyHours()`,
`getStressHours()` (`recent14` / `yearAvg14`), `getAdaptiveRates()`, the
date-range hour sum, per-day flight-hour sums (for the 3D month view), the EASA
PPL/CPL/ATPL hour tables, and intersection queries for the combined categories.
The `IN_DATA` block in `shared.jsx` documents every field and maps it to these.

## Files in this bundle
- `source/Insights.html` — open in a browser to view & click the full prototype
  (Tweaks toolbar = accent + monthly-chart style; prototype-only).
- `source/insights/*.jsx` — the reference implementation (see file map above).
