// EASA-krav för CPL och ATPL (FCL.515 / FCL.510)
export const EASA_CPL_REQUIREMENTS = {
  total_flight_time: { required: 150, label: 'Total flight time' },
  pic: { required: 70, label: 'PIC time' },
  cross_country_pic: { required: 20, label: 'Cross-country PIC' },
  instrument_time: { required: 10, label: 'Instrument time (incl. 5h in aeroplane)' },
  night_flight: { required: 5, label: 'Night flight' },
};

export const EASA_ATPL_REQUIREMENTS = {
  total_flight_time: { required: 1500, label: 'Total flight time' },
  pic: { required: 500, label: 'PIC time' },
  cross_country_pic: { required: 200, label: 'Cross-country PIC' },
  instrument_time: { required: 75, label: 'Instrument time' },
  night_flight: { required: 100, label: 'Night flight' },
  multi_pilot: { required: 500, label: 'Multi-pilot' },
};

// Gratisgräns: antal MANUELLT inmatade flygningar en free-användare kan logga (importerade/scannade
// räknas inte). Gäller per läge — pilot och drönare har varsin pott. Premium = obegränsat.
export const FREE_TIER_LIMIT = 20;
export const FREE_TIER_LIMIT_DRONE = 20;
