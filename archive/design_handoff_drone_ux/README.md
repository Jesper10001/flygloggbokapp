# Handoff: BLADES — Drone UX redesign

## Overview

A redesign of the **drone (unmanned) mode** of the BLADES Joint Logbook app.
Drone mode shares the pilot-manned app's navy foundation so it reads as **one
app**, but carries its **own accent colour** and a set of screens tuned to what
drone pilots actually log (categories, flight modes, missions, fleet, batteries,
competency/recency, multi-pass flight time).

**Scope: drone / unmanned mode only.** This does not touch pilot-manned screens —
it mirrors their patterns where useful (settings layout, add-flight date header,
multi-pass flight-time entry) and diverges where the domain differs.

### The chosen configuration (build this)
The prototype exposes several tweaks for exploration. **The selected, locked-in
configuration to implement is:**

| Setting | Value |
|---|---|
| Dashboard layout | **A — editorial stack** (hero total time → category mix → flight modes → location map → recent flights) |
| Density | **Compact** |
| Location map | **Shown** |
| Accent | **Cyan `#22D3EE`** |
| Flight-time format | MM:SS per flight (default) |

The prototype's `DR_DEFAULTS` (in `drone-ux/app.jsx`) is already set to exactly
this. The other tweak options (layout B, cozy density, amber/violet/lime accents,
H:MM format) are exploration only — **ignore them for the build** unless you want
to keep accent/format as a user setting.

## About the design files

`source/` is a **design reference built in HTML / React+Babel** — a clickable
prototype of the intended look, motion and behaviour. It is **not production
code**. Recreate it in the app's existing **React Native / Expo** stack, reusing
the real `Colors` tokens, fonts, components and the `db/drones.ts` data layer.
Translate `<div>`/CSS to `View`/`Text`/`StyleSheet`, SVG to `react-native-svg`.

**Prototype-only scaffolding — do NOT port:** `drone-ux/ios-frame.jsx` (fake
device bezel), `drone-ux/tweaks-panel.jsx` + `drone-ux/app.jsx`'s TweaksPanel
block (the exploration controls), and the `injectAccent` CSS-variable helper
(in RN the accent is just a colour constant/prop). The real screen mounts
full-screen inside the app's existing drone tab navigator.

## Fidelity

**High-fidelity.** Final colours, type, spacing, motion. Recreate faithfully on a
~393-pt-wide screen. Sizes below are CSS px at that width.

---

## Information architecture (tab bar)

Bottom tab bar, 5 slots: **Home · Log · [＋ FAB] · Book · More(settings)**.
The center FAB opens the add-flight flow as a full-screen modal (tab bar hidden).

| Tab | Screen | Source file |
|---|---|---|
| Home | Dashboard (layout A, compact) | `drone-ux/dashboard.jsx` |
| Log | Flights (month-grouped) + Fleet (drones/batteries) sub-tabs | `drone-ux/log.jsx` |
| ＋ | New drone flight (form) | `drone-ux/flight.jsx` → `AddFlightScreen` |
| Book | Physical logbook entry (preview + buttons, spread comes later) | `drone-ux/compliance.jsx` → `BookScreen` |
| More | Settings (profile → certificates → sections → about) | `drone-ux/settings.jsx` |
| — | Flight detail (from any flight row) | `drone-ux/flight.jsx` → `FlightDetailScreen` |
| — | Certificates & competency (from Settings) | `drone-ux/settings.jsx` → `CertificatesScreen` |
| — | Location map (from dashboard map card) | `drone-ux/app.jsx` → `MapScreen` |

`drone-ux/shared.jsx` holds the palette, demo data, icon set, formatters and
shared primitives (Card / Chip / SectionLabel / ProgressBar / Donut).

---

## Screens

### 1. Dashboard (layout A, compact) — `DashboardScreen`
Vertical stack, compact spacing (`gap: 10`):
1. **Hero total time** — big serif `312:40` (H:MM total) with an "active drones"
   chip and a 3-up sub-row: This year · Flights · Last 30 d. Accent glow.
2. **Category mix** — a donut (Specific / A2 / A3 / A1 / Certified) + legend with
   percentages.
3. **Flight modes** — VLOS / EVLOS / BVLOS, each a row "KEY · {n} flt · {pct}%"
   with a progress bar.
4. **Location map card** — a tappable map preview (→ Location map screen).
5. **Recent flights** — list of recent flights (mission, mode chip, drone·place,
   MM:SS duration, relative date) → each row opens Flight detail. "All →" → Log.

> The dashboard intentionally does **NOT** show a "Your logbook" card or a
> "Competency & recency" strip — both were removed. Logbook lives in the Book tab
> + Settings; competency lives under Settings → Certificates.

Source data: `getDroneFlightStats()`-style aggregates — total/YTD/last-30 minutes
&amp; counts, category counts, mode counts, recent flights. All already computed or
trivially derivable from `db/drones.ts` (`getDroneFlights`, `listDrones`,
`listBatteries`).

### 2. Log — `LogScreen`
Two sub-tabs:
- **Flights** — summary trio (total flights / total time / last 30 d) then
  month-grouped flight rows (mission icon, mode + category chips, drone · place,
  MM:SS, relative date) → Flight detail.
- **Fleet** — "Drones · N" list (model, id, flights, hours, battery count, a
  "Service" chip when in maintenance) and "Batteries · N" list (id, drone,
  cycles, a health % chip + bar coloured by health). Both have "+ Add".

### 3. New drone flight — `AddFlightScreen`  ← key interactions
- **Date in the header** (mirrors pilot-manned add-flight): a `Colors.surface`
  bar with the date centered big in **Fraunces serif** ("Thu 11 June"), a
  "TAP TO CHANGE" affordance beneath, and a close/back button at the left.
  Tapping opens a **date bottom-sheet** (prev/next-day chevrons + Today /
  Yesterday quick picks). In the app, use the existing native date picker — keep
  the big-serif-date-in-header presentation.
- **Scan controller log** shortcut card (DJI / Autel export → OCR autofill).
- **Drone** picker, **Mission type** chips (Inspection / Mapping / Survey / Film /
  SAR), **Operating category** segmented (A1 / A2 / A3 / Specific), **Flight mode**
  segmented (VLOS / EVLOS / BVLOS).
- **Flight time = multi-pass** (this is the app's existing model — replicate
  exactly): a "Flight time" section where you add **up to 5 passes**, each an
  editable **MM:SS** field labelled "Pass 1 / Pass 2 …". Passes after the first
  have a red ✕ remove button. Below them a **glowing accent total bar**
  (stopwatch icon + "FLIGHT TIME" + the **summed** MM:SS in big mono) updates
  live as passes are edited/added/removed. An "Add pass" dashed button appears
  until 5 passes exist. This matches `app/drone-flight/add.tsx`'s
  `passes[]` → `passesToDecimal` → total model — reuse `DroneDurationInput`,
  `mmssToDecimal`, `decimalToMMSS` in the real build.
- **Max altitude** field (m AGL), **Location**, **Battery cycle**, **Observer**.
- Sticky **Save flight** button.

### 4. Book — `BookScreen`
Physical-logbook entry point: a book-cover preview (flights · drones count, a
"Spread view · coming soon" chip) and three buttons — **Open logbook spread**,
**Choose layout**, **Export PDF**. These are intentionally non-functional for now
(the actual EASA spread renders later, reusing the manned logbook engine which
already accepts `appMode: 'drone'`). The note explains drone-specific columns
(category, mode, MTOW, battery) render in the same EASA spread.

### 5. Settings — `SettingsScreen` (mirrors pilot-manned settings)
- **Profile card**: person row (pilot · operator · op-id), **"Certificates &
  competency"** row (shield icon, "{n} credentials · {m} expiring"), Blades
  Premium row.
- **Collapsible sections** (one open at a time): **Logbook** (logbook type,
  manage drones, your logbook, audit log), **Import** (CSV, scan controller log,
  add manually), **Data & Export** (iCloud, CSV, logbook pages, custom export),
  **App** (language, accent, flight-time format toggle).
- **About** group (version, local storage, support, website, privacy).

### 6. Certificates & competency — `CertificatesScreen`
Opened from the Settings profile card. **Credentials** list (EASA UAS:
A1/A2 CofC, A1/A3 training, Specific PDRA-S01 authorisation, operator
registration — each with valid/expiring/expired status + expiry date) and a
**Recency by category** section (days-since-last-flight per category vs a 90-day
limit, coloured progress bars). This is the drone analogue of manned "currency".

### 7. Location map — `MapScreen`
Drone flights store GPS, so this is the drone analogue of manned "visited
airports". The prototype shows a **stylized** pin field (proposal). **In the app,
render the native Apple map** (`components/GlobalAirportMap` / `react-native-maps`,
the same map used under Settings → Manage airports), fed the drone flights'
stored coordinates, with the site/region/country counts overlaid. Treat the
stylized version as a stand-in only.

---

## Design tokens (Navy base + cyan accent)

Navy surfaces are **identical to pilot-manned** (`constants/colors.ts`) so the
two modes read as one app. Only the accent differs.

| Token | Value | Use |
|---|---|---|
| background | `#0A1628` | screen (same as manned) |
| (deep) | `#06101E` | map/scrim backdrops |
| surface / card | `#0F1E3A` | cards, header bar |
| surface2 | `#132845` | book cover, raised |
| elevated | `#16314E` | inner tiles, icon chips |
| border | `#1A3A5A` | hairlines |
| separator | `#122030` | dividers |
| **accent (chosen)** | **`#22D3EE` cyan** | hero numbers, chips, bars, FAB, total bar, active tab. Soft = `rgba(34,211,238,0.14)`, line = `rgba(34,211,238,0.42)` |
| success | `#3FB950` | valid credentials, healthy battery |
| warning | `#FFC857` | expiring credential, mid battery |
| danger | `#FF6B5B` | stale recency, low battery, remove ✕ |
| textPrimary | `#FFFFFF` | headings, values |
| textSecondary | `#A8BFD6` | body |
| text3 | `#7FA8C8` | sub-labels |
| textMuted | `#5A7FA0` | meta / mono captions |
| ink-on-accent | `#0A1628` | text on accent fills (FAB, save button) |

> **Accent is a single value threaded everywhere.** In the prototype it's the
> `--acc` CSS variable (+ derived `--acc-soft` / `--acc-line`); in RN make it one
> colour constant (or a user setting) and derive the soft/line tints with alpha.
> Cyan `#22D3EE` is the chosen default; amber `#FF8C42`, violet `#A855F7`, lime
> `#7BE25B` exist as alternates only.

**Type:** Fraunces (serif display — hero numbers, screen titles, the add-flight
header date), JetBrains Mono (data — durations, ICAO/ids, labels, meta), Inter /
SF (body). All already loaded by the app.

**Time formats:** total time = **H:MM** (e.g. `312:40`); per-flight = **MM:SS**
(short drone sorties). The multi-pass total sums in MM:SS. A user toggle for
MM:SS ↔ H:MM per-flight exists in Settings → App (optional to keep).

## Data — invent nothing new
Everything maps to `db/drones.ts` and the existing drone models: drone flights
(date, drone, mission, category, mode, passes→duration, max altitude, location,
battery cycle, observer, GPS), the drone registry (`listDrones`), batteries
(`listBatteries`, cycles/health), and EASA credentials/recency the app already
tracks. The demo numbers in `shared.jsx` (`DR_DATA`, operator "SkyMap Survey AB")
are illustrative — wire to the real store.

## Assets
No bundled imagery. All icons are inline SVG (`DIcon` in `shared.jsx`) — map them
to the app's existing icon set (Ionicons) where equivalents exist. The map screen
uses the native map, not an asset.

## Files in this bundle
| File | What it is |
|---|---|
| `source/Drone UX.html` | Open in a browser to view the full clickable prototype. Defaults to the **chosen config** (layout A, compact, map on, cyan). Tweaks toolbar lets you explore the alternates. |
| `source/drone-ux/shared.jsx` | Palette, `DR_DATA` demo data, icon set, formatters, primitives. **Primary reference for tokens & data shapes.** |
| `source/drone-ux/dashboard.jsx` | Dashboard (both layouts; build **A**). |
| `source/drone-ux/log.jsx` | Log — flights + fleet sub-tabs. |
| `source/drone-ux/flight.jsx` | Add-flight (date header + multi-pass flight time) + flight detail. |
| `source/drone-ux/settings.jsx` | Settings + Certificates/competency detail. |
| `source/drone-ux/compliance.jsx` | Book entry screen (+ an older standalone Compliance screen, unused — competency now lives in settings). |
| `source/drone-ux/app.jsx` | Router + tab bar + Location map screen + `DR_DEFAULTS` (the chosen config) + Tweaks (prototype-only). |
| `source/drone-ux/ios-frame.jsx`, `tweaks-panel.jsx` | Prototype-only scaffolding — do not port. |
