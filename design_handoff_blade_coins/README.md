# Handoff: Settings – Blade-coins meter (variant B2)

Scope: ONLY the Blade-coins meter block in `FlightLogApp/app/(tabs)/settings.tsx` (the `tokenUsage && (() => …)()` block between the Profile/Premium card and "Flights logged"). Nothing else changes.

Reference: `Settings Blade-coins B.html` → artboard **B2**. Other variants are discarded.

## Layout
- Container: paddingHorizontal 20, paddingVertical 12 (unchanged), no card/background – floats on the page like today
- Row: coin image left + content column right, gap 16, alignItems center

### Coin
- `assets/Blade_coin.PNG`, 64 × 64, resizeMode contain (was 68 – keep 64 so the block stays compact)

### Content column (flex 1)
1. **Top row** (row, alignItems center)
   - "Blade-coins" 15pt semibold, `Colors.textPrimary`
   - 6pt gap, then the existing help button (`help-circle-outline`, 16, `Colors.textMuted`) → opens the coin info modal (unchanged)
   - Right-aligned count, Menlo/Geist Mono 15pt bold:
     - remaining coins in cyan `#00C8E8` (e.g. "195")
     - then " / 250" in `#56708C`, weight 500
2. **Segmented meter**, marginTop 10, marginBottom 6
   - 10 equal cells in a row, gap 4, height 8, radius 2
   - Empty cell: `#1A2D45`
   - Filled cell: vertical gradient `#7DF2FF` → `#00B4D8`, soft glow (shadow `rgba(0,214,255,.35)`, radius 8)
   - Partial cell: horizontal split, filled part `#1CD8F5`, rest `#1A2D45` (use a View with width % inside the cell)
3. **Caption** 12pt, `Colors.textMuted` (#7F98B2)
   - Premium (monthly): "Left this month · refills monthly"
   - Free (lifetime): "Free one-time Blade-coins · upgrade for a monthly refill" (keep existing copy)

## Logic change: show REMAINING, not used
```ts
const usedCoins  = tokensToCoins(tokenUsage.used);
const limitCoins = tokensToCoins(tokenUsage.limit);
const leftCoins  = Math.max(0, limitCoins - usedCoins);
const leftPct    = limitCoins > 0 ? leftCoins / limitCoins : 0; // 0..1
const cells      = 10;
const fill       = leftPct * cells;       // e.g. 7.8
// cell i: full if i < Math.floor(fill), partial (fill % 1) if i === Math.floor(fill), else empty
```
Count text: `${leftCoins} / ${limitCoins}` (formatted with `toLocaleString('en-US')`).

## Edge cases
- 0 left: all cells empty, count "0" in `#7F98B2` instead of cyan
- ≤ 10% left: filled cells in amber `#FFB830` (gradient `#FFD27A` → `#FFB830`) as a gentle warning

## Tokens
cyan #00C8E8 · cyan light #7DF2FF · cyan deep #00B4D8 · empty cell #1A2D45 · muted #7F98B2 · dim #56708C · amber #FFB830
