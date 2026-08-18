// Logbook-page redesign — lokala konstanter som inte finns i Colors.
// Allt annat (bg/card/surface/border/primary/text…) läses från Colors (tema-medvetet).

export const FONT_SERIF = 'Fraunces';
export const FONT_MONO = 'JetBrainsMono';

// Platina-fyll för natt-andelen i NightRoute + natt-caption (tema-oberoende).
export const NIGHT_FILL = '#C7CDDA';
// Natt-badge (blå måne) — design-specifik.
export const NIGHT_BADGE = '#5DA9FF';
// Hot refuel-badge (bärnstensgul tankningssymbol).
export const REFUEL_BADGE = '#F5A623';
// NVG-badge (mörkgrön kikare/goggles) — visas när NVG-tid loggats.
export const NVG_BADGE = '#2E7D32';

// Typ-rating: antal dagar före utgång som räknas som "expiring".
export const RATING_EXPIRY_WARN_DAYS = 90;
