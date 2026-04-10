// EASA-krav för CPL och ATPL (FCL.515 / FCL.510)
export const EASA_CPL_REQUIREMENTS = {
  total_flight_time: { required: 150, label: 'Total flygtid' },
  pic: { required: 70, label: 'PIC-tid' },
  cross_country_pic: { required: 20, label: 'Cross-country PIC' },
  instrument_time: { required: 10, label: 'Instrumenttid (varav 5h i flygplan)' },
  night_flight: { required: 5, label: 'Nattflyg' },
};

export const EASA_ATPL_REQUIREMENTS = {
  total_flight_time: { required: 1500, label: 'Total flygtid' },
  pic: { required: 500, label: 'PIC-tid' },
  cross_country_pic: { required: 200, label: 'Cross-country PIC' },
  instrument_time: { required: 75, label: 'Instrumenttid' },
  night_flight: { required: 100, label: 'Nattflyg' },
  multi_pilot: { required: 500, label: 'Multi-pilot' },
};

export const FREE_TIER_LIMIT = 50;
