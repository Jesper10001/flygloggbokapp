// Land (ISO 3166-1 alpha-2) → kontinent. Används för level-of-detail-klustring
// på den globala flygplatskartan (kontinent → land → enskilda flygplatser).

export type Continent =
  | 'Nordamerika' | 'Sydamerika' | 'Europa' | 'Afrika' | 'Asien' | 'Oceanien' | 'Antarktis';

const BY_CONTINENT: Record<Continent, string[]> = {
  Nordamerika: ['US', 'CA', 'MX', 'GT', 'BZ', 'SV', 'HN', 'NI', 'CR', 'PA', 'CU', 'JM', 'HT', 'DO', 'BS', 'BB', 'TT', 'GD', 'LC', 'VC', 'AG', 'DM', 'KN', 'PR', 'GL', 'BM', 'KY', 'AW', 'CW', 'SX', 'TC', 'VG', 'VI', 'AI', 'MS', 'BQ', 'GP', 'MQ', 'BL', 'MF', 'PM'],
  Sydamerika: ['BR', 'AR', 'CL', 'CO', 'PE', 'VE', 'EC', 'BO', 'PY', 'UY', 'GY', 'SR', 'GF', 'FK'],
  Europa: ['GB', 'IE', 'FR', 'DE', 'ES', 'PT', 'IT', 'NL', 'BE', 'LU', 'CH', 'AT', 'DK', 'SE', 'NO', 'FI', 'IS', 'PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'GR', 'HR', 'SI', 'RS', 'BA', 'ME', 'MK', 'AL', 'XK', 'LT', 'LV', 'EE', 'BY', 'UA', 'MD', 'RU', 'CY', 'MT', 'AD', 'MC', 'SM', 'VA', 'LI', 'FO', 'GI', 'IM', 'JE', 'GG', 'AX', 'SJ'],
  Afrika: ['EG', 'LY', 'TN', 'DZ', 'MA', 'EH', 'MR', 'ML', 'NE', 'TD', 'SD', 'SS', 'ET', 'ER', 'DJ', 'SO', 'KE', 'UG', 'RW', 'BI', 'TZ', 'CD', 'CG', 'CF', 'CM', 'GA', 'GQ', 'ST', 'NG', 'BJ', 'TG', 'GH', 'CI', 'LR', 'SL', 'GN', 'GW', 'SN', 'GM', 'CV', 'BF', 'ZA', 'NA', 'BW', 'ZW', 'ZM', 'MZ', 'MW', 'LS', 'SZ', 'MG', 'KM', 'MU', 'SC', 'RE', 'YT', 'AO'],
  Asien: ['CN', 'JP', 'KR', 'KP', 'MN', 'TW', 'HK', 'MO', 'IN', 'PK', 'BD', 'LK', 'NP', 'BT', 'MV', 'AF', 'IR', 'IQ', 'SA', 'YE', 'OM', 'AE', 'QA', 'BH', 'KW', 'JO', 'IL', 'PS', 'LB', 'SY', 'TR', 'GE', 'AM', 'AZ', 'KZ', 'UZ', 'TM', 'TJ', 'KG', 'TH', 'VN', 'LA', 'KH', 'MM', 'MY', 'SG', 'ID', 'PH', 'BN', 'TL'],
  Oceanien: ['AU', 'NZ', 'PG', 'FJ', 'SB', 'VU', 'NC', 'PF', 'WS', 'TO', 'KI', 'FM', 'MH', 'PW', 'NR', 'TV', 'CK', 'NU', 'GU', 'MP', 'WF', 'TK', 'AS'],
  Antarktis: ['AQ', 'TF', 'GS', 'BV', 'HM'],
};

const COUNTRY_TO_CONTINENT: Record<string, Continent> = {};
(Object.keys(BY_CONTINENT) as Continent[]).forEach((cont) => {
  for (const cc of BY_CONTINENT[cont]) COUNTRY_TO_CONTINENT[cc] = cont;
});

export function continentForCountry(cc: string): Continent | null {
  return COUNTRY_TO_CONTINENT[(cc || '').toUpperCase()] ?? null;
}

/** Flaggemoji från 2-bokstavs landskod (t.ex. "SE" → 🇸🇪). */
export function flagEmoji(cc: string): string {
  const c = (cc || '').toUpperCase();
  if (c.length !== 2 || !/^[A-Z]{2}$/.test(c)) return '🏳️';
  return String.fromCodePoint(...[...c].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}
