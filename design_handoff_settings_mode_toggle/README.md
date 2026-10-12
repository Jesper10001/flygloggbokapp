# Handoff: Settings – Logbook mode toggle + Blades introduction (variant B4)

Scope: ONLY the two buttons at the bottom of Settings ("Shift to Drone/Pilot logbook" and "Blades introduction") in `FlightLogApp/app/(tabs)/settings.tsx`. Everything else stays.

Reference: `Settings Mode Intro B.html` → artboard **B4**. The other variants are discarded.

## Replace
The two `TouchableOpacity` blocks after the About `<Card>`:
- `LinearGradient` "Shift to Pilot/Drone logbook" button (circle icon + swap icon)
- "Blades introduction" card (compass icon + subtitle + chevron)

## 1. Logbook row with toggle
- Container: marginHorizontal 20, marginTop 24, height 64, paddingLeft 20, paddingRight 10, radius 16
- Background `Colors.card` (#11202F), 1pt border `Colors.cardBorder` (#1D3350)
- Left: "LOGBOOK" 12pt bold, uppercase, letterSpacing 2.4, `Colors.textMuted` (#7F98B2), flex 1
- Right: segmented toggle, width 176, height 44, radius 11, padding 4, background `Colors.background` (#0A1628), 1pt border #1D3350
  - Two equal segments: "PILOT" | "DRONE", 11pt bold, letterSpacing 1.8
  - Knob: half width, radius 8, background `rgba(0,200,232,.14)`, 1pt border `rgba(0,200,232,.5)`
  - Active label `Colors.primary` (#00C8E8), inactive #7F98B2
  - Knob glides (Animated / Reanimated translateX, ~350ms, ease-out spring-ish). Same feel as other glidable toggles in the app.
- Active side = current `appMode` (`manned` → PILOT, `drone` → DRONE)

### Behavior
- Tap the inactive side (or anywhere on the toggle) → animate knob → run existing switch logic:
  - to Drone: `switchProfile('pilot-unmanned', existing subRole ?? 'commercial')`
  - to Pilot: `switchProfile('pilot-manned', existing subRole ?? 'fixed')`
- Since it switches the whole app mode, show a confirm alert before switching:
  "Switch to Drone logbook?" / "Switch to Pilot logbook?" → Cancel / Switch. On cancel, animate knob back.
- Haptic light impact on switch.
- Accessibility: role "adjustable"/tab group, label "Logbook, Pilot selected".

## 2. Blades introduction link
- Centered text link, marginTop 26, marginBottom 28, height ≥ 44 (tap target)
- Text: "Take the Blades introduction", 13pt medium, #7F98B2
- 1pt underline below text, color #2A4260, 2pt gap
- No card, no icon, no chevron
- onPress: `beginTour(isDrone ? 'drone' : 'pilot')` (unchanged)

## Tokens
bg #0A1628 · card #11202F · border #1D3350 · muted #7F98B2 · cyan #00C8E8 · underline #2A4260
