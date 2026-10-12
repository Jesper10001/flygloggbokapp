# Handoff: Settings – Profile + Blades Premium (variant D)

Scope: ONLY the two top entries on the Settings screen (Profile row + Blades Premium row). Everything else on Settings stays as-is.

Reference: `Settings Profile Premium.html` → artboard **D** (far right). A/B/C are discarded alternatives.

## Layout
Vertical stack, 10pt gap, placed directly under the "Settings" large title, above the existing list.

### 1. Profile row (card)
- Height 72, horizontal padding 20, corner radius 18
- Background `#11202F`, 1pt border `#1D3350`
- Left: two-line text block
  - Caption "PROFILE": 13pt, bold, uppercase, letter-spacing 2.4, color `#7F98B2`
  - Value (user's name, e.g. "Jesper Toreld"): 17pt semibold, color `#F4F7FA`, 6pt below caption
- Right: chevron, 2pt stroke, color `#00C8E8` (cyan)
- Tap → Profile screen (existing destination)
- Match the existing LOGBOOK / IMPORT rows below so the screen reads as one system

### 2. Blades Premium strip
- Height 52, horizontal padding 18, corner radius 14
- Background: horizontal gradient `rgba(255,184,48,.14)` → `rgba(255,184,48,.03)`
- 1pt border `rgba(255,184,48,.30)`
- Left: "BLADES PREMIUM" 12pt bold uppercase, letter-spacing 2.4, color `#FFB830`
- Right: status text in Geist Mono 12pt medium, color `#C9B07A`, then chevron in `#FFB830`
- Status text:
  - Subscribed → "Active"
  - Promo code → "Active" (or "Promo" if you want to distinguish)
  - Free → "20 flights free" or "Upgrade" (pick one; keep it short)
- Tap → existing Blades Premium screen

## Tokens
- bg `#0A1628`, card `#11202F`, card border `#1D3350`
- text primary `#F4F7FA`, secondary `#7F98B2`
- cyan `#00C8E8`, gold `#FFB830`, muted gold `#C9B07A`
- Fonts: Geist (text), Geist Mono (status). Use the app's existing font tokens if they map to these.

## Remove
- Avatar/initials circle and icon tile from the current Profile/Premium buttons
- Any separate "Active" pill/badge – status is now plain text inside the strip

## Accessibility
- Both rows are full-width tap targets (≥44pt)
- VoiceOver: "Profile, Jesper Toreld, button" / "Blades Premium, Active, button"
